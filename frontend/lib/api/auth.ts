import { apiFetch } from './client';
import {
  applyAuthResponse,
  getStoredRefreshToken,
  setSessionSignedOut,
  setStoredRefreshToken,
} from './session';
import type { AuthResponseDto, HouseholdDto } from './types';

export async function register(
  email: string,
  password: string,
  displayName: string
): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
    skipAuth: true,
  });
  await applyAuthResponse(auth);
}

export async function signIn(email: string, password: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
  });
  await applyAuthResponse(auth);
}

export async function signOut(): Promise<void> {
  const refreshToken = await getStoredRefreshToken();
  if (refreshToken) {
    try {
      await apiFetch('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        skipAuth: true,
      });
    } catch {
      // Best-effort revocation — signing out must never fail locally.
    }
  }
  await setStoredRefreshToken(null);
  setSessionSignedOut();
}

export function normalizeJoinCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
}

export async function getHousehold(): Promise<HouseholdDto> {
  return apiFetch<HouseholdDto>('/api/v1/household');
}

export async function joinHousehold(code: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/household/join', {
    method: 'POST',
    body: { code: normalizeJoinCode(code) },
  });
  await applyAuthResponse(auth);
}

export async function leaveHousehold(): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/household/leave', {
    method: 'POST',
  });
  await applyAuthResponse(auth);
}
