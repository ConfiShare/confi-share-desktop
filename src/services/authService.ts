/**
 * Authentication service: ConfiShare API v1, `/auth/*` endpoints.
 *
 *   POST /auth/signup           { accountType: 'individual', firstName, lastName, email, password }
 *   POST /auth/verify-email     { email, otp }            (5-digit code, valid 5 min)
 *   POST /auth/resend-otp       { email }
 *   POST /auth/login            { email, password }       → token.access_token (8 h), user
 *   POST /auth/forgot-password  { email }                 → emails a reset link (valid 5 min)
 *   POST /auth/reset-password   { email, token, newPassword }
 *
 * Passwords are sent to the API only; they are never stored by the app.
 */
import { ApiError, apiRequest, unwrapData } from './apiClient';

export interface AuthUser {
  id?: string;
  email: string;
  fullName?: string;
}

export interface AuthSessionData {
  user: AuthUser;
  accessToken: string;
  expiresAt?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  email: string;
  token: string;
  newPassword: string;
}

export const OFFLINE_AUTH_MESSAGE =
  'No internet connection. You need to be online to sign in the first time. After that, ConfiShare works offline.';

function ensureOnline() {
  if (!navigator.onLine) throw new ApiError(0, OFFLINE_AUTH_MESSAGE);
}

interface LoginPayload {
  token?: { access_token?: string; expire_at?: string | number };
  user?: {
    _id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
}

export const authService = {
  async login({ email, password }: LoginInput): Promise<AuthSessionData> {
    ensureOnline();
    const body = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    const payload = unwrapData<LoginPayload>(body);
    const accessToken = payload?.token?.access_token;
    if (!accessToken) throw new Error('Unexpected sign-in response from the server. Please try again.');

    const u = payload.user ?? {};
    const fullName =
      u.companyName || [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined;
    return {
      user: { id: u._id, email: u.email ?? email, fullName },
      accessToken,
      expiresAt: payload.token?.expire_at !== undefined ? String(payload.token.expire_at) : undefined,
    };
  },

  async signup({ firstName, lastName, email, password }: SignupInput): Promise<void> {
    ensureOnline();
    await apiRequest('/auth/signup', {
      method: 'POST',
      body: { accountType: 'individual', firstName, lastName, email, password },
    });
  },

  async verifyEmail(email: string, otp: string): Promise<void> {
    ensureOnline();
    await apiRequest('/auth/verify-email', { method: 'POST', body: { email, otp } });
  },

  async resendVerificationCode(email: string): Promise<void> {
    ensureOnline();
    await apiRequest('/auth/resend-otp', { method: 'POST', body: { email } });
  },

  async requestPasswordReset(email: string): Promise<void> {
    ensureOnline();
    await apiRequest('/auth/forgot-password', { method: 'POST', body: { email } });
  },

  async resetPassword({ email, token, newPassword }: ResetPasswordInput): Promise<void> {
    ensureOnline();
    await apiRequest('/auth/reset-password', { method: 'POST', body: { email, token, newPassword } });
  },
};
