import {
  createHousehold,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  listHouseholds,
  normalizeJoinCode,
  register,
  renameHousehold,
  signIn,
  signOut,
  switchHousehold,
} from '../lib/api/auth';
import { apiFetch, pendingRefresh } from '../lib/api/client';
import {
  getSession,
  getStoredRefreshToken,
  resetSessionForTests,
  setStoredRefreshToken,
} from '../lib/api/session';
import type { AuthResponseDto } from '../lib/api/types';

jest.mock('../lib/api/client', () => ({
  apiFetch: jest.fn(),
  pendingRefresh: jest.fn(async () => {}),
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

const apiFetchMock = apiFetch as jest.Mock;

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

beforeEach(async () => {
  resetSessionForTests();
  await setStoredRefreshToken(null);
  apiFetchMock.mockReset();
});

describe('normalizeJoinCode', () => {
  it.each([
    ['abcdef', 'ABC-DEF'],
    ['ABC-DEF', 'ABC-DEF'],
    ['  abc def ', 'ABC-DEF'],
    ['ab', 'AB'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeJoinCode(input)).toBe(expected);
  });
});

describe('auth wrappers', () => {
  it('register posts and applies the auth response', async () => {
    apiFetchMock.mockResolvedValueOnce(auth);

    await register('kari@example.test', 'passord123', 'Kari', 'Hjem');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'kari@example.test',
        password: 'passord123',
        displayName: 'Kari',
        householdName: 'Hjem',
      },
      skipAuth: true,
    });
    expect(getSession().status).toBe('signedIn');
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
  });

  it('renameHousehold PUTs the new name and returns the household', async () => {
    const renamed = { id: 'household-1', name: 'Hjem', joinCode: 'ABC-DEF', members: [] };
    apiFetchMock.mockResolvedValueOnce(renamed);

    const result = await renameHousehold('Hjem');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/household', {
      method: 'PUT',
      body: { name: 'Hjem' },
    });
    expect(result).toEqual(renamed);
  });

  it('signIn posts to login and applies the auth response', async () => {
    apiFetchMock.mockResolvedValueOnce(auth);

    await signIn('kari@example.test', 'passord123');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'kari@example.test', password: 'passord123' },
      skipAuth: true,
    });
    expect(getSession().status).toBe('signedIn');
  });

  it('signOut revokes server-side, clears storage and session', async () => {
    await setStoredRefreshToken('refresh-1');
    apiFetchMock.mockResolvedValueOnce(undefined);

    await signOut();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: 'refresh-1' },
      skipAuth: true,
    });
    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBeNull();
  });

  it('signOut still clears locally when the server call fails', async () => {
    await setStoredRefreshToken('refresh-1');
    apiFetchMock.mockRejectedValueOnce(new Error('down'));

    await signOut();

    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBeNull();
  });

  it('signOut quiesces any in-flight refresh before clearing', async () => {
    await setStoredRefreshToken('refresh-1');
    apiFetchMock.mockResolvedValueOnce(undefined);

    await signOut();

    expect(pendingRefresh).toHaveBeenCalled();
  });

  it('getHousehold fetches the household', async () => {
    const household = { id: 'h', name: 'Hjemme', joinCode: 'ABC-DEF', members: [] };
    apiFetchMock.mockResolvedValueOnce(household);

    await expect(getHousehold()).resolves.toEqual(household);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/household');
  });

  it('joinHousehold normalizes the code and applies the rotated auth response', async () => {
    apiFetchMock.mockResolvedValueOnce({ ...auth, refreshToken: 'refresh-2' });

    await joinHousehold('abc def');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/household/join', {
      method: 'POST',
      body: { code: 'ABC-DEF' },
    });
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-2');
  });

  it('leaveHousehold applies the rotated auth response', async () => {
    apiFetchMock.mockResolvedValueOnce({ ...auth, refreshToken: 'refresh-3' });

    await leaveHousehold();

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/household/leave', { method: 'POST' });
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-3');
  });
});

describe('households API', () => {
  it('listHouseholds fetches the plural endpoint', async () => {
    const summaries = [
      {
        id: 'h1',
        name: 'Hjemme',
        joinCode: 'ABC-DEF',
        memberCount: 2,
        role: 'owner',
        isActive: true,
      },
    ];
    apiFetchMock.mockResolvedValueOnce(summaries);

    await expect(listHouseholds()).resolves.toEqual(summaries);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households');
  });

  it('createHousehold posts the name and activates the returned household', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ...auth,
      user: { ...auth.user, householdId: 'h-new', householdName: 'Hytta' },
    });

    await createHousehold('Hytta');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households', {
      method: 'POST',
      body: { name: 'Hytta' },
    });
    expect(getSession().householdId).toBe('h-new');
  });

  it('switchHousehold posts the id and activates the returned household', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ...auth,
      user: { ...auth.user, householdId: 'h2', householdName: 'Hytta' },
    });

    await switchHousehold('h2');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households/switch', {
      method: 'POST',
      body: { householdId: 'h2' },
    });
    expect(getSession().householdId).toBe('h2');
  });
});
