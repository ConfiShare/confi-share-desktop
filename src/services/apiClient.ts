/**
 * Minimal JSON client for the ConfiShare API v1 (`<origin>/api/v1`).
 *
 * Error shapes handled (from the API docs):
 *  - validation 400: { success: false, field, message }
 *  - application:    { success: false, message, httpStatusCode, error, data: { code } }
 *  - auth 401:       { message: "Token validation error", status: false }
 */
import { authSession } from './authSession';

/** Same origin the app already used for DRM activation. */
export const API_BASE_URL = 'https://server.confishare.io/api/v1';

export const NETWORK_ERROR_MESSAGE =
  'Unable to reach ConfiShare. Check your internet connection and try again.';

export class ApiError extends Error {
  status: number;
  /** Top-level `error`, e.g. "ACCESS_DENIED". */
  error?: string;
  /** `data.code`, e.g. "EMAIL_OTP_REQUIRED". */
  code?: string;
  field?: string;
  data?: Record<string, unknown>;

  constructor(status: number, message: string, extra: Partial<Pick<ApiError, 'error' | 'code' | 'field' | 'data'>> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    Object.assign(this, extra);
  }
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

type AuthMode = 'none' | 'optional' | 'required';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** optional = send the token if signed in; required = fail without one. */
  auth?: AuthMode;
  query?: Record<string, string | number | undefined>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = 'none', query } = options;

  const url = new URL(API_BASE_URL + path);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let sentToken = false;
  if (auth !== 'none') {
    const token = authSession.getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      sentToken = true;
    } else if (auth === 'required') {
      throw new ApiError(401, 'Please sign in to continue.');
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const data = asRecord(json.data);
    const message =
      typeof json.message === 'string' && json.message.trim()
        ? json.message
        : `Request failed (${response.status})`;
    if (response.status === 401 && sentToken) authSession.notifyUnauthorized();
    throw new ApiError(response.status, message, {
      error: typeof json.error === 'string' ? json.error : undefined,
      code: typeof data?.code === 'string' ? data.code : undefined,
      field: typeof json.field === 'string' ? json.field : undefined,
      data,
    });
  }

  return json as T;
}

/** Most endpoints wrap the payload as `{ message, data }`. */
export function unwrapData<T>(body: unknown): T {
  const record = asRecord(body);
  return (record && 'data' in record ? record.data : body) as T;
}
