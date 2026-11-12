import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext, type AuthContextValue, type AuthNotice, type AuthScreen } from './authContext';
import type { AuthSessionData, AuthUser } from '../services/authService';
import { sessionStore } from '../services/sessionStore';
import { authSession } from '../services/authSession';

/**
 * Authentication state.
 *
 * Sign in once (online) → the account + access token are saved in the
 * encrypted secure store → later launches restore the session even offline.
 * The token is sent on DRM Activate so the owner's audit log records who
 * opened each document. If the API rejects the token (401, e.g. after its
 * 8-hour lifetime) the user is asked to sign in again.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [screen, setScreen] = useState<AuthScreen>('login');
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // Restore a previous sign-in (works offline).
  useEffect(() => {
    let active = true;
    sessionStore
      .load()
      .then((session) => {
        if (!active || !session) return;
        authSession.set({ accessToken: session.accessToken, expiresAt: session.expiresAt });
        setUser(session.user);
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const goTo = useCallback<AuthContextValue['goTo']>((next, options) => {
    setScreen(next);
    setNotice(options?.notice ?? null);
    if (options?.email !== undefined) setPrefillEmail(options.email);
  }, []);

  const completeLogin = useCallback(async (session: AuthSessionData) => {
    authSession.set({ accessToken: session.accessToken, expiresAt: session.expiresAt });
    try {
      await sessionStore.save(session);
    } catch (err) {
      // Still let the user in; they will just be asked to sign in next launch.
      console.error('Failed to save session for offline use:', err);
    }
    setUser(session.user);
    setNotice(null);
  }, []);

  const endSession = useCallback((nextNotice: AuthNotice) => {
    authSession.set(null);
    sessionStore.clear().catch((err) => console.error('Failed to clear saved session:', err));
    setPrefillEmail(userRef.current?.email ?? '');
    setUser(null);
    setScreen('login');
    setNotice(nextNotice);
  }, []);

  const logout = useCallback(async () => {
    // The API has no logout endpoint; the access token simply expires.
    endSession({ kind: 'info', message: 'You have been signed out.' });
  }, [endSession]);

  const expireSession = useCallback(
    (message?: string) => {
      endSession({ kind: 'info', message: message ?? 'Your session has expired. Please sign in again.' });
    },
    [endSession]
  );

  // Any API call rejected with 401 while a token was sent ends the session.
  useEffect(() => {
    authSession.onUnauthorized(() => expireSession());
    return () => authSession.onUnauthorized(null);
  }, [expireSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isRestoring, screen, notice, prefillEmail, goTo, completeLogin, logout, expireSession }),
    [user, isRestoring, screen, notice, prefillEmail, goTo, completeLogin, logout, expireSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
