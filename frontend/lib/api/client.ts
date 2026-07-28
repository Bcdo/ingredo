import { db } from '../db/client';
import { getApiBaseUrl } from './config';
import {
  applyAuthResponse,
  getAccessToken,
  getSession,
  getSessionEpoch,
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

// Thrown instead of retrying a 401 when the caller pinned an
// expectedHouseholdId and the refresh that just ran landed the session on a
// DIFFERENT household. The refresh itself is legitimate (the backend 401s
// dead-membership tokens on purpose so clients refresh) — but replaying the
// original request body under the new household's token would silently
// write one household's data into another's partition. Callers that care
// about this (the sync engine) detect it with instanceof and abort instead
// of failing.
export class HouseholdRotatedError extends Error {}

export type ApiInit = {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
  // When set, a 401-triggered refresh that lands the session on a household
  // other than this one aborts the retry (see HouseholdRotatedError) instead
  // of replaying the request under the new household's token.
  expectedHouseholdId?: string;
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
      if (
        init.expectedHouseholdId !== undefined &&
        getSession().householdId !== init.expectedHouseholdId
      ) {
        throw new HouseholdRotatedError();
      }
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

// Settles when any in-flight refresh does (resolved immediately otherwise).
// signOut awaits this so a refresh completion can never interleave its
// token persist with sign-out's clear.
export function pendingRefresh(): Promise<unknown> {
  return refreshInFlight ?? Promise.resolve();
}

async function doRefresh(): Promise<boolean> {
  const epoch = getSessionEpoch();
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
  if (getSessionEpoch() !== epoch) {
    // Signed out while this refresh was in flight — do not resurrect the
    // session or re-persist the rotated token.
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
