import type { CdcContainer } from '../types';
import { ApiError, apiRequest, unwrapData } from './apiClient';
import { getDeviceId } from './deviceId';

export interface ActivationResponse {
  offlineToken: string;
  offlineExpiresAt: string;
  offlineDays: number;
}

interface DecryptedDocumentData {
  // decryptedPayload -> JSON.parse(...) produces this structure.
  // `file` is a base64 string; AppContext turns it back into a Blob.
  file: string;
  docId?: string;
  id?: string;
  [key: string]: unknown;
}

type DrmUnlockErrorKind =
  | 'invalid_access_code'
  | 'access_revoked'
  | 'activation_failed'
  // Viewer access control (403 ACCESS_DENIED data.code / 401)
  | 'auth_required'
  | 'email_otp_required'
  | 'invalid_email_otp'
  | 'not_a_recipient'
  | 'session_expired';

export class DrmUnlockError extends Error {
  kind: DrmUnlockErrorKind;
  status?: number;
  /** For email_otp_required: where the 5-digit code was sent (data.email). */
  email?: string;

  constructor(kind: DrmUnlockErrorKind, message: string, status?: number, email?: string) {
    super(message);
    this.name = 'DrmUnlockError';
    this.kind = kind;
    this.status = status;
    this.email = email;
  }
}

/** Map an Activate failure to DrmUnlockError, branching on data.code (never on message). */
function toActivationError(error: ApiError): DrmUnlockError {
  const { status, message } = error;

  if (status === 401) {
    return new DrmUnlockError('session_expired', 'Your session has expired. Please sign in again.', status);
  }

  if (error.error === 'ACCESS_DENIED') {
    switch (error.code) {
      case 'AUTH_REQUIRED':
        return new DrmUnlockError('auth_required', 'Sign in to ConfiShare to open this document.', status);
      case 'EMAIL_OTP_REQUIRED':
        return new DrmUnlockError(
          'email_otp_required',
          message,
          status,
          typeof error.data?.email === 'string' ? error.data.email : undefined
        );
      case 'INVALID_EMAIL_OTP':
        return new DrmUnlockError('invalid_email_otp', message, status);
      case 'NOT_A_RECIPIENT':
        return new DrmUnlockError(
          'not_a_recipient',
          "This document wasn't shared with your account. Sign in with the email address it was sent to.",
          status
        );
      case 'RECIPIENT_REVOKED':
        return new DrmUnlockError('access_revoked', 'Access to this document has been revoked by the owner.', status);
    }
  }

  // Previous behaviour for everything else.
  if (status === 403 || status === 410 || isRevocationMessage(message)) {
    return new DrmUnlockError('access_revoked', 'Access to this document has been revoked by the owner.', status);
  }
  return new DrmUnlockError('activation_failed', message || 'Failed to activate document', status);
}

function isRevocationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('revok') ||
    normalized.includes('withdrawn') ||
    normalized.includes('no longer available') ||
    normalized.includes('access denied')
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export function isAccessRevokedError(error: unknown): boolean {
  if (error instanceof DrmUnlockError) {
    return error.kind === 'access_revoked';
  }
  const message = getErrorMessage(error, '');
  return isRevocationMessage(message);
}

export const drmService = {
  /**
   * POST /drm/activate { docId, passKey, deviceId, otp? } to get an offline token.
   * Sends `Authorization: Bearer` when the user is signed in, so the open is
   * recorded in the owner's audit log under their account.
   */
  async activate(docId: string, passKey: string, otp?: string): Promise<ActivationResponse> {
    const deviceId = await getDeviceId();
    try {
      const body = await apiRequest('/drm/activate', {
        method: 'POST',
        auth: 'optional',
        body: { docId, passKey, ...(deviceId ? { deviceId } : {}), ...(otp ? { otp } : {}) },
      });
      // Backend returns { message: "...", data: { ... } }
      return unwrapData<ActivationResponse>(body);
    } catch (error) {
      if (error instanceof ApiError) throw toActivationError(error);
      throw error;
    }
  },

  /**
   * Attempts to unlock a document. 
   * Follows the refined flow: always prompt for passKey, 
   * skip backend activation if a valid offline token exists.
   */
  async unlockDocument(
    docId: string,
    container: CdcContainer,
    passKey: string,
    options?: { otp?: string }
  ): Promise<{ decryptedData: DecryptedDocumentData; realDocId: string; offlineExpiresAt?: string }> {
    if (!window.drmApi) {
      console.error('window.drmApi is undefined. Preload script may have failed to load.');
      throw new Error('Internal Error: DRM interface not available. Please restart the application.');
    }

    // 1. Decipher container with passKey to recover realDocId AND contentKey
    // This also serves as validation of the passKey
    let decryptedPayload = '';
    let contentKey = '';
    try {
      const result = await window.drmApi.decryptCDC(container, passKey);
      decryptedPayload = result.decryptedPayload;
      contentKey = result.contentKey;
    } catch (e) {
      console.error('Decryption failed during unlock:', e);
      throw new DrmUnlockError(
        'invalid_access_code',
        'Invalid access code. Please check and try again.'
      );
    }
    
    const decryptedData = JSON.parse(decryptedPayload) as DecryptedDocumentData;
    const realDocId = decryptedData.docId ?? decryptedData.id;

    if (!realDocId) {
       throw new Error("Invalid document: docId missing from payload");
    }

    // 2. Check if we already have a valid offline token and content key for this realDocId
    const expiresAtStr = await window.drmApi.getSecureData(realDocId, 'offlineExpiresAt');
    const now = new Date();
    const isTokenValid = expiresAtStr && new Date(expiresAtStr) > now;

    if (isTokenValid) {
       console.log('Token is still valid, skipping backend activation.');
       // We've already decrypted the payload, so we're good to go
       return { decryptedData, realDocId, offlineExpiresAt: expiresAtStr };
    }

    // 3. Token missing or expired: Activate with backend using the REAL docId
    console.log('Token invalid or missing, activating with backend...');
    let activation: ActivationResponse;
    try {
      activation = await this.activate(realDocId, passKey, options?.otp);
    } catch (error) {
      if (error instanceof DrmUnlockError && error.kind !== 'access_revoked' && error.kind !== 'activation_failed') {
        throw error; // viewer access-control outcomes are handled by the UI
      }
      if (isAccessRevokedError(error)) {
        throw new DrmUnlockError(
          'access_revoked',
          'Access to this document has been revoked by the owner.'
        );
      }
      if (error instanceof DrmUnlockError) {
        throw error;
      }
      throw new DrmUnlockError(
        'activation_failed',
        getErrorMessage(error, 'Failed to activate document')
      );
    }
    console.log('Activation Successful:', activation);

    // 4. Store activation data, contentKey, and passKey securely
    if (activation.offlineToken && activation.offlineExpiresAt) {
      await window.drmApi.setSecureData(realDocId, 'offlineToken', activation.offlineToken);
      await window.drmApi.setSecureData(realDocId, 'offlineExpiresAt', activation.offlineExpiresAt);
      await window.drmApi.setSecureData(realDocId, 'contentKey', contentKey);
      await window.drmApi.setSecureData(realDocId, 'passKey', passKey);
      
      // Map local id to real id
      await window.drmApi.setSecureData(docId, 'realDocId', realDocId);
    }

    return { decryptedData, realDocId, offlineExpiresAt: activation.offlineExpiresAt };
  },

  /**
   * Checks if a document is locally unlocked and valid.
   */
  async isDocumentUnlocked(docId: string): Promise<boolean> {
    if (!window.drmApi) return false;

    // Check for realDocId mapping
    const realDocId = await window.drmApi.getSecureData(docId, 'realDocId');
    const effectiveId = realDocId || docId;

    const expiresAtStr = await window.drmApi.getSecureData(effectiveId, 'offlineExpiresAt');
    if (!expiresAtStr) return false;
    return new Date(expiresAtStr) > new Date();
  }
};
