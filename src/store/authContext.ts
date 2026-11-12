import { createContext, useContext } from 'react';
import type { AuthSessionData, AuthUser } from '../services/authService';

export type AuthScreen = 'login' | 'signup' | 'verify_email' | 'forgot_password' | 'reset_password';

export interface AuthNotice {
  kind: 'success' | 'info';
  message: string;
}

export interface AuthContextValue {
  /** Signed-in identity (persisted in the secure store; no password). */
  user: AuthUser | null;
  /** True while a saved session is being restored at startup. */
  isRestoring: boolean;
  screen: AuthScreen;
  /** Optional one-off banner for the next screen (e.g. "Account created"). */
  notice: AuthNotice | null;
  /** Email to prefill when moving between screens. */
  prefillEmail: string;
  goTo: (screen: AuthScreen, options?: { notice?: AuthNotice; email?: string }) => void;
  completeLogin: (session: AuthSessionData) => Promise<void>;
  logout: () => Promise<void>;
  /** Token rejected / sign-in required: clear the session and show sign-in. */
  expireSession: (message?: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
