import {
  ApiError,
  apiFetch,
  NetworkError,
  pendingRefresh,
  refreshSession,
  restoreSession,
} from '../lib/api/client';
import {
  applyAuthResponse,
  getAccessToken,
  getSession,
  getStoredRefreshToken,
  resetSessionForTests,
  setSessionSignedOut,
  setStoredRefreshToken,
} from '../lib/api/session';
import type { AuthResponseDto } from '../lib/api/types';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/config', () => ({
  getApiBaseUrl: () => 'http://api.test',
}));

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(async () => {
  resetSessionForTests();
  await setStoredRefreshToken(null);
  fetchMock.mockReset();
});

describe('apiFetch', () => {
  it('attaches the bearer token when signed in', async () => {
    await applyAuthResponse(auth);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await apiFetch('/api/v1/household');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/household');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('sends no auth header with skipAuth', async () => {
    await applyAuthResponse(auth);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiFetch('/api/v1/auth/login', { method: 'POST', body: { a: 1 }, skipAuth: true });

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('throws ApiError with status on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { title: 'not found' }));

    const promise = apiFetch('/api/v1/household', { skipAuth: true });

    await expect(promise).rejects.toMatchObject({ status: 404 });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it('throws NetworkError when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(apiFetch('/api/v1/household', { skipAuth: true })).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('on 401: refreshes once, retries with the new token', async () => {
    await applyAuthResponse(auth);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ...auth, accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { fine: true }));

    const result = await apiFetch<{ fine: boolean }>('/api/v1/household');

    expect(result).toEqual({ fine: true });
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/v1/auth/refresh');
    const retryInit = fetchMock.mock.calls[2][1];
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-2');
  });

  it('when refresh returns 401: clears stored token, signs out, original error propagates', async () => {
    await applyAuthResponse(auth);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));

    await expect(apiFetch('/api/v1/household')).rejects.toMatchObject({ status: 401 });
    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBeNull();
  });
});

describe('refreshSession', () => {
  it('is single-flight: two concurrent calls make one request', async () => {
    await setStoredRefreshToken('refresh-1');
    let release: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const first = refreshSession();
    const second = refreshSession();
    release(jsonResponse(200, auth));

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('network error: signed out but stored token kept', async () => {
    await setStoredRefreshToken('refresh-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(refreshSession()).resolves.toBe(false);
    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
  });

  it('server error (5xx): signed out but stored token kept', async () => {
    await setStoredRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));

    await expect(refreshSession()).resolves.toBe(false);
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
  });

  it('no stored token: resolves false without any request', async () => {
    await expect(refreshSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('malformed refresh response body: resolves false, stored token kept', async () => {
    await setStoredRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    );

    await expect(refreshSession()).resolves.toBe(false);
    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
  });

  it('sign-out during an in-flight refresh is not resurrected by its completion', async () => {
    await setStoredRefreshToken('refresh-1');
    let release: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const pending = refreshSession();
    // What signOut does locally, mid-flight:
    await setStoredRefreshToken(null);
    setSessionSignedOut();
    release(jsonResponse(200, auth));

    await expect(pending).resolves.toBe(false);
    expect(getSession().status).toBe('signedOut');
    await expect(getStoredRefreshToken()).resolves.toBeNull();
  });
});

describe('pendingRefresh', () => {
  it('resolves immediately when no refresh is in flight', async () => {
    await expect(pendingRefresh()).resolves.toBeUndefined();
  });

  it('settles together with an in-flight refresh', async () => {
    await setStoredRefreshToken('refresh-1');
    let release: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const refreshing = refreshSession();
    let settled = false;
    const waiter = pendingRefresh().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release(jsonResponse(200, auth));
    await refreshing;
    await waiter;
    expect(settled).toBe(true);
  });
});

describe('restoreSession', () => {
  it('does nothing without a stored token — zero network calls signed out', async () => {
    await restoreSession();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSession().status).toBe('signedOut');
  });

  it('restores a session from a stored token', async () => {
    await setStoredRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, auth));

    await restoreSession();

    expect(getSession().status).toBe('signedIn');
    expect(getAccessToken()).toBe('access-1');
  });
});
