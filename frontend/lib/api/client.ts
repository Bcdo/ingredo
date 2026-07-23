import { db } from '../db/client';
import { getApiBaseUrl } from './config';
import {
  applyAuthResponse,
  getAccessToken,
  getStoredRefreshToken,
  setSessionRestoring,
  setSessionSignedOut,
  setStoredRefreshToken,
} from './session';
import type { AuthResponseDto } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: unknown;

  constructor(status: number, problem: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.problem = problem;
  }
}

export class NetworkError extends Error {}

export type ApiInit = {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
};

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function rawFetch(path: string, init: ApiInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${getApiBaseUrl(db)}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new NetworkError(String(error));
  }
}

export async function apiFetch<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const token = init.skipAuth ? null : getAccessToken();
  let response = await rawFetch(path, init, token);

  if (response.status === 401 && !init.skipAuth && token) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawFetch(path, init, getAccessToken());
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseBody(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await parseBody(response)) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

// Single-flight: concurrent 401s share one refresh. Rotation makes a
// second parallel refresh not just wasteful but self-destructive (the
// backend revokes the whole token family on reuse).
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) {
    setSessionSignedOut();
    return false;
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl(db)}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Offline: keep the stored token — the session can restore later.
    setSessionSignedOut();
    return false;
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Revoked or expired family: the token is dead — forget it.
      await setStoredRefreshToken(null);
    }
    setSessionSignedOut();
    return false;
  }

  let auth: AuthResponseDto;
  try {
    auth = (await response.json()) as AuthResponseDto;
  } catch {
    // A 200 we cannot parse is a transient server fault, not a dead token.
    setSessionSignedOut();
    return false;
  }
  await applyAuthResponse(auth);
  return true;
}

export async function restoreSession(): Promise<void> {
  const stored = await getStoredRefreshToken();
  if (!stored) return;
  setSessionRestoring();
  await refreshSession();
}
