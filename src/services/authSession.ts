/**
 * In-memory holder for the current access token, so API calls can attach
 * `Authorization: Bearer <token>` without depending on React state.
 * AuthProvider fills it (from the secure store or a fresh login) and clears it.
 */

export interface SessionTokens {
  accessToken: string;
  /** `token.expire_at` from the login response (8 h lifetime). */
  expiresAt?: string;
}

let current: SessionTokens | null = null;
let unauthorizedHandler: (() => void) | null = null;

export const authSession = {
  set(tokens: SessionTokens | null) {
    current = tokens;
  },
  getAccessToken(): string | null {
    return current?.accessToken ?? null;
  },
  /** AuthProvider registers this to send the user back to sign in on 401. */
  onUnauthorized(handler: (() => void) | null) {
    unauthorizedHandler = handler;
  },
  notifyUnauthorized() {
    unauthorizedHandler?.();
  },
};
