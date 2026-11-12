/**
 * Stable per-installation device id, sent as `deviceId` on DRM Activate.
 * It appears in the document owner's audit log and alert emails.
 * Generated once and kept in the encrypted secure store.
 */
const NAMESPACE = '__confishare_device__';
const KEY = 'deviceId';

let cached: Promise<string | undefined> | null = null;

export function getDeviceId(): Promise<string | undefined> {
  if (!cached) {
    cached = (async () => {
      if (!window.drmApi) return undefined;
      try {
        const existing = await window.drmApi.getSecureData(NAMESPACE, KEY);
        if (existing) return existing;
        const id = crypto.randomUUID();
        await window.drmApi.setSecureData(NAMESPACE, KEY, id);
        return id;
      } catch (err) {
        console.error('Failed to load device id:', err);
        return undefined;
      }
    })();
  }
  return cached;
}
