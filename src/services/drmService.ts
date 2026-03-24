const BASE_URL = 'https://confishare-api.onrender.com/api/v1';

export interface ActivationResponse {
  offlineToken: string;
  offlineExpiresAt: string;
  offlineDays: number;
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

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Failed to activate document');
    }

    // Backend returns { message: "...", data: { ... } }
    return result.data;
  },

  /**
   * Attempts to unlock a document. 
   * Follows the refined flow: always prompt for passKey, 
   * skip backend activation if a valid offline token exists.
   */
  async unlockDocument(docId: string, container: any, passKey: string): Promise<{ decryptedData: any; realDocId: string; offlineExpiresAt?: string }> {
    if (!window.drmApi) {
      console.error('window.drmApi is undefined. Preload script may have failed to load.');
      throw new Error('Internal Error: DRM interface not available. Please restart the application.');
    }

    // 1. Decrypt container with passKey to recover realDocId AND contentKey
    // This also serves as validation of the passKey
    const { decryptedPayload, contentKey } = await window.drmApi.decryptCDC(container, passKey);
    console.log('Decrypted Payload recovered');
    
    const decryptedData = JSON.parse(decryptedPayload);
    const realDocId = decryptedData.docId || decryptedData.id;

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
    const activation = await this.activate(realDocId, passKey);
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
