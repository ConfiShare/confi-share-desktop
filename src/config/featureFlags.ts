/**
 * Feature flags for the account features (connected to ConfiShare API v1).
 *
 * Both are ON by default (dev and production). Turn one off with a Vite env
 * var (e.g. in `.env.local`) to get the previous behaviour back:
 *   VITE_ENABLE_AUTH_PREVIEW=false      → no sign-in gate (anonymous Activate)
 *   VITE_ENABLE_TRACKING_PREVIEW=false  → hide tracking view + activity panel
 *
 * (The names keep "PREVIEW" for compatibility with existing .env files.)
 */

function readFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export const featureFlags = {
  /** Require sign-in (once, online) before using the app. */
  authPreview: readFlag(import.meta.env.VITE_ENABLE_AUTH_PREVIEW, true),
  /** Shared-file tracking view + document activity panel. */
  trackingPreview: readFlag(import.meta.env.VITE_ENABLE_TRACKING_PREVIEW, true),
} as const;
