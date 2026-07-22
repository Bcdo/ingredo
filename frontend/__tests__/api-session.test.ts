import * as SecureStore from 'expo-secure-store';

import {
  applyAuthResponse,
  getAccessToken,
  getSession,
  getStoredRefreshToken,
  resetSessionForTests,
  setSessionRestoring,
  setSessionSignedOut,
  setStoredRefreshToken,
} from '../lib/api/session';
import type { AuthResponseDto } from '../lib/api/types';

const auth: AuthResponseDto = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: {
    id: 'user-1',
    email: 'kari@example.test',
    displayName: 'Kari',
    householdId: 'household-1',
    householdName: 'Karis husstand',
  },
};

describe('session store', () => {
  beforeEach(async () => {
    resetSessionForTests();
    await setStoredRefreshToken(null);
    jest.clearAllMocks();
  });

  it('starts signed out with no access token', () => {
    expect(getSession()).toEqual({
      status: 'signedOut',
      user: null,
      householdId: null,
      householdName: null,
    });
    expect(getAccessToken()).toBeNull();
  });

  it('applyAuthResponse persists the refresh token, keeps access in memory, signs in', async () => {
    await applyAuthResponse(auth);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('ingredo.refreshToken', 'refresh-1');
    expect(getAccessToken()).toBe('access-1');
    const session = getSession();
    expect(session.status).toBe('signedIn');
    expect(session.user?.email).toBe('kari@example.test');
    expect(session.householdId).toBe('household-1');
    expect(session.householdName).toBe('Karis husstand');
  });

  it('rotation: a second applyAuthResponse overwrites the stored token', async () => {
    await applyAuthResponse(auth);
    await applyAuthResponse({ ...auth, accessToken: 'access-2', refreshToken: 'refresh-2' });
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-2');
    expect(getAccessToken()).toBe('access-2');
  });

  it('setSessionSignedOut clears memory but not storage', async () => {
    await applyAuthResponse(auth);
    setSessionSignedOut();
    expect(getSession().status).toBe('signedOut');
    expect(getAccessToken()).toBeNull();
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
  });

  it('setStoredRefreshToken(null) deletes from secure storage', async () => {
    await setStoredRefreshToken('some-token');
    await setStoredRefreshToken(null);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('ingredo.refreshToken');
    await expect(getStoredRefreshToken()).resolves.toBeNull();
  });

  it('restoring state is observable', () => {
    setSessionRestoring();
    expect(getSession().status).toBe('restoring');
  });
});
