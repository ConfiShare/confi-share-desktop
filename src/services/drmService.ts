import type { CdcContainer } from '../types';

const BASE_URL = 'https://confishare-api.onrender.com/api/v1';

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

type DrmUnlockErrorKind = 'invalid_access_code' | 'access_revoked' | 'activation_failed';

export class DrmUnlockError extends Error {
  kind: DrmUnlockErrorKind;
  status?: number;

  constructor(kind: DrmUnlockErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'DrmUnlockError';
    this.kind = kind;
    this.status = status;
  }
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
   * Calls the backend activation endpoint to get an offline token.
   */
  async activate(docId: string, passKey: string): Promise<ActivationResponse> {
    const response = await fetch(`${BASE_URL}/drm/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docId, passKey }),
    });

    const result = await response.json().catch(() => ({} as Record<string, unknown>));

    if (!response.ok) {
      const message =
        typeof result.message === 'string' && result.message.trim()
          ? result.message
          : 'Failed to activate document';

      if (response.status === 403 || response.status === 410 || isRevocationMessage(message)) {
        throw new DrmUnlockError(
          'access_revoked',
          'Access to this document has been revoked by the owner.',
          response.status
        );
      }

      throw new DrmUnlockError('activation_failed', message, response.status);
    }

    // Backend returns { message: "...", data: { ... } }
    return result.data as ActivationResponse;
  },

  /**
   * Attempts to unlock a document. 
   * Follows the refined flow: always prompt for passKey, 
   * skip backend activation if a valid offline token exists.
   */
  async unlockDocument(
    docId: string,
    container: CdcContainer,
    passKey: string
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
      activation = await this.activate(realDocId, passKey);
    } catch (error) {
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
