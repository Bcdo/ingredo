import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { AuthResponseDto } from './types';

// Module-state + subscriber-hook idiom (see lib/locale.ts). The refresh
// token lives ONLY in secure storage; the access token ONLY in memory —
// its 15-minute lifetime makes persistence pointless and riskier.
export type SessionStatus = 'signedOut' | 'restoring' | 'signedIn';

export type SessionUser = { id: string; email: string; displayName: string };

export type Session = {
  status: SessionStatus;
  user: SessionUser | null;
  householdId: string | null;
  householdName: string | null;
};

const REFRESH_TOKEN_KEY = 'ingredo.refreshToken';

const SIGNED_OUT: Session = {
  status: 'signedOut',
  user: null,
  householdId: null,
  householdName: null,
};

let session: Session = SIGNED_OUT;
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession(): Session {
  return session;
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, getSession);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionRestoring(): void {
  session = { ...SIGNED_OUT, status: 'restoring' };
  emit();
}

export function setSessionSignedOut(): void {
  session = SIGNED_OUT;
  accessToken = null;
  emit();
}

export async function applyAuthResponse(auth: AuthResponseDto): Promise<void> {
  // Persist the rotated refresh token FIRST — the backend revokes reused
  // tokens family-wide, so losing a rotation signs the device out.
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, auth.refreshToken);
  accessToken = auth.accessToken;
  session = {
    status: 'signedIn',
    user: {
      id: auth.user.id,
      email: auth.user.email,
      displayName: auth.user.displayName,
    },
    householdId: auth.user.householdId,
    householdName: auth.user.householdName,
  };
  emit();
}

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setStoredRefreshToken(token: string | null): Promise<void> {
  if (token === null) {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } else {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  }
}

export function resetSessionForTests(): void {
  session = SIGNED_OUT;
  accessToken = null;
  listeners.clear();
}
