/**
 * Persists the signed-in account so the user only has to sign in once
 * (online). After that the app opens offline, and when online the saved
 * access token is sent on DRM Activate so opens are recorded against them.
 *
 * Stored in the existing encrypted secure store (Electron safeStorage via
 * window.drmApi) under a reserved namespace. The password is never stored.
 */
import type { AuthSessionData } from './authService';

const NAMESPACE = '__confishare_account__';
const KEY = 'session';

interface StoredSession extends AuthSessionData {
  /** ISO time of the (online) sign-in. */
  signedInAt: string;
}

export const sessionStore = {
  async load(): Promise<AuthSessionData | null> {
    if (!window.drmApi) return null;
    try {
      const raw = await window.drmApi.getSecureData(NAMESPACE, KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      return parsed?.user?.email && parsed.accessToken ? parsed : null;
    } catch (err) {
      console.error('Failed to restore saved session:', err);
      return null;
    }
  },

  async save(session: AuthSessionData): Promise<void> {
    if (!window.drmApi) return;
    const stored: StoredSession = { ...session, signedInAt: new Date().toISOString() };
    await window.drmApi.setSecureData(NAMESPACE, KEY, JSON.stringify(stored));
  },

  async clear(): Promise<void> {
    if (!window.drmApi) return;
    await window.drmApi.removeDocData(NAMESPACE);
  },
};
