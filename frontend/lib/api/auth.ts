import { apiFetch, pendingRefresh } from './client';
import {
  applyAuthResponse,
  getStoredRefreshToken,
  setSessionSignedOut,
  setStoredRefreshToken,
} from './session';
import type { AuthResponseDto, HouseholdDto, HouseholdSummaryDto } from './types';

export async function register(
  email: string,
  password: string,
  displayName: string,
  householdName: string,
  inviteCode: string
): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, displayName, householdName, inviteCode },
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

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  await apiFetch('/api/v1/auth/reset-password', {
    method: 'POST',
    body: { email, code, newPassword },
    skipAuth: true,
  });
}

export async function signOut(): Promise<void> {
  await pendingRefresh();
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

export async function renameHousehold(name: string): Promise<HouseholdDto> {
  return apiFetch<HouseholdDto>('/api/v1/household', {
    method: 'PUT',
    body: { name },
  });
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

export async function listHouseholds(): Promise<HouseholdSummaryDto[]> {
  return apiFetch<HouseholdSummaryDto[]>('/api/v1/households');
}

export async function createHousehold(name: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/households', {
    method: 'POST',
    body: { name },
  });
  await applyAuthResponse(auth);
}

export async function switchHousehold(householdId: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/households/switch', {
    method: 'POST',
    body: { householdId },
  });
  await applyAuthResponse(auth);
}
