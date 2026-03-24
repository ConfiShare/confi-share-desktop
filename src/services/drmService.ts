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
   * First checks for a cached contentKey and valid token.
   * If not found, requires activation with passKey.
   */
  async unlockDocument(docId: string, container: any, passKey?: string): Promise<{ decryptedData: any; realDocId: string }> {
    if (!window.drmApi) {
      console.error('window.drmApi is undefined. Preload script may have failed to load.');
      throw new Error('Internal Error: DRM interface not available. Please restart the application.');
    }

    // 1. Try to find the realDocId if we've unlocked this before in this session
    // Check if we have a cached realDocId for this local docId
    const cachedRealDocId = await window.drmApi.getSecureData(docId, 'realDocId');
    const effectiveRealDocId = cachedRealDocId || docId;

    // 2. Check if we already have a valid offline token and content key
    const expiresAtStr = await window.drmApi.getSecureData(effectiveRealDocId, 'offlineExpiresAt');
    const now = new Date();
    const isTokenValid = expiresAtStr && new Date(expiresAtStr) > now;

    if (isTokenValid) {
       const cachedContentKey = await window.drmApi.getSecureData(effectiveRealDocId, 'contentKey');
       if (cachedContentKey) {
         try {
           const decryptedJson = await window.drmApi.decryptPayload(container, cachedContentKey);
           const decryptedData = JSON.parse(decryptedJson);
           const rId = decryptedData.docId || decryptedData.id;
           return { decryptedData, realDocId: rId };
         } catch (e) {
           console.error("Cached content key decryption failed", e);
         }
       }
    }

    // 3. If no valid token or decryption failed, we need the passKey
    if (!passKey) {
      throw new Error('Access code required');
    }

    // 4. Decrypt container with passKey to recover realDocId AND contentKey
    const { decryptedPayload, contentKey } = await window.drmApi.decryptCDC(container, passKey);
    console.log('Decrypted Payload:', decryptedPayload);
    
    const decryptedData = JSON.parse(decryptedPayload);
    const realDocId = decryptedData.docId || decryptedData.id;

    if (!realDocId) {
       console.error('Full Decrypted Data Object:', decryptedData);
       throw new Error("Invalid document: docId missing from payload");
    }

    // 5. Activate with backend using the REAL docId
    const activation = await this.activate(realDocId, passKey);
    console.log('Activation Response Data:', activation);

    // 6. Store activation data and contentKey securely, indexed by realDocId
    // Ensure all arguments to setSecureData are defined and non-null
    if (activation.offlineToken && activation.offlineExpiresAt) {
      await window.drmApi.setSecureData(realDocId, 'offlineToken', activation.offlineToken);
      await window.drmApi.setSecureData(realDocId, 'offlineExpiresAt', activation.offlineExpiresAt);
      await window.drmApi.setSecureData(realDocId, 'contentKey', contentKey);
      
      // Also store a mapping from local docId to realDocId so we can find it next time
      await window.drmApi.setSecureData(docId, 'realDocId', realDocId);
    }

    return { decryptedData, realDocId };
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
