# Frontend Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in sign-in for Ingredo: secure token storage, an authenticated API client with transparent refresh, and Settings-based account + household management — with signed-out mode byte-for-byte unchanged.

**Architecture:** A thin `lib/api/` module layer using the codebase's module-state + `useSyncExternalStore` idiom (no context provider, no state library): `config` (base URL resolution), `session` (state + tokens; refresh token in `expo-secure-store`, access token in memory), `client` (`apiFetch` with single-flight 401→refresh→retry), `auth` (endpoint wrappers). Screens: an Account section in Settings plus `app/account/sign-in.tsx` and `app/account/register.tsx`.

**Tech Stack:** Expo SDK 54, expo-router, expo-secure-store (new), NativeWind, i18n-js (nb/en key parity), Jest + jest-expo + RNTL v13.

**Spec:** `docs/superpowers/specs/2026-07-23-frontend-auth-design.md`

## Global Constraints

- Signed out, the app makes ZERO network calls and behaves exactly as today; existing screen tests must pass UNTOUCHED.
- Refresh token ONLY in `expo-secure-store` under key `ingredo.refreshToken`; access token ONLY in module memory, never persisted.
- Refresh failure rules: HTTP 401 on refresh → clear stored token + session; network error or 5xx → signed out but stored token KEPT. Single-flight: concurrent 401s share one refresh.
- Every `AuthResponse` (register/login/refresh/join/leave) carries a ROTATED refresh token — persist it before anything else proceeds.
- Base URL precedence: settings override (`api_base_url`, device-local) → `app.json` `extra.apiUrl` → `http://10.0.2.2:8080`; trailing slashes stripped.
- All user-facing strings in BOTH `lib/i18n/nb.json` and `lib/i18n/en.json` (key-parity test enforces).
- Wire JSON is camelCase (ASP.NET default). Backend routes: `/api/v1/auth/{register,login,refresh,logout}`, `/api/v1/household` (GET), `/api/v1/household/join`, `/api/v1/household/leave`. Join/leave return an `AuthResponse`.
- Jest rules: variables referenced inside `jest.mock` factories must be `mock`-prefixed; RNTL v13 sync `render`; wrap state-changing async into `act()`.
- Green bar per task: `npx jest` full suite, `npx eslint . --max-warnings 0`, `npx tsc --noEmit`. Run from `/home/mrb/Work/Programming/ingredo/frontend`.

## File Structure

- Create: `lib/api/types.ts`, `lib/api/config.ts`, `lib/api/session.ts`, `lib/api/client.ts`, `lib/api/auth.ts`, `components/settings/AccountSection.tsx`, `app/account/sign-in.tsx`, `app/account/register.tsx`
- Modify: `app.json` (extra.apiUrl), `jest.setup.js` (secure-store mock), `components/ui/Input.tsx` (3 new optional props), `app/settings.tsx` (mount AccountSection), `app/_layout.tsx` (restore effect), `lib/i18n/{nb,en}.json`, root `docs/TESTING.md`
- Tests: `__tests__/api-config.test.ts`, `__tests__/api-session.test.ts`, `__tests__/api-client.test.ts`, `__tests__/api-auth.test.ts`, `__tests__/account-screens.test.tsx`, `__tests__/account-section.test.tsx`

---

### Task 1: Dependency, config module, base URL resolution

**Files:**
- Modify: `app.json`, `jest.setup.js`
- Create: `lib/api/config.ts`
- Test: `__tests__/api-config.test.ts`

**Interfaces:**
- Produces: `getApiBaseUrl(db: DB): string`, `getApiUrlOverride(db: DB): string | null`, `setApiUrlOverride(db: DB, url: string | null): void`.

- [ ] **Step 0: Branch + dependency**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/frontend-auth
cd frontend
npx expo install expo-secure-store
```

- [ ] **Step 1: app.json + jest.setup.js**

In `app.json`, inside the `"expo"` object (top level of it, e.g. after `"plugins"` if present — keep valid JSON), add:

```json
    "extra": {
      "apiUrl": "http://10.0.2.2:8080"
    }
```

(If an `"extra"` object already exists, add the `apiUrl` key to it instead.)

Append to `jest.setup.js`:

```js
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
    __store: store,
  };
});
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/api-config.test.ts`:

```ts
import Constants from 'expo-constants';

import { getApiBaseUrl, getApiUrlOverride, setApiUrlOverride } from '../lib/api/config';
import { makeTestDb } from './helpers/testDb';

describe('api config', () => {
  it('defaults to the app config apiUrl with trailing slash stripped', () => {
    const db = makeTestDb();
    const expoConfig = Constants.expoConfig as { extra?: Record<string, unknown> } | null;
    const previous = expoConfig?.extra?.apiUrl;
    if (expoConfig) expoConfig.extra = { ...expoConfig.extra, apiUrl: 'http://example.test:8080/' };
    expect(getApiBaseUrl(db)).toBe('http://example.test:8080');
    if (expoConfig) expoConfig.extra = { ...expoConfig.extra, apiUrl: previous };
  });

  it('prefers a stored override over the app config', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080/');
    expect(getApiUrlOverride(db)).toBe('http://192.168.1.50:8080/');
    expect(getApiBaseUrl(db)).toBe('http://192.168.1.50:8080');
  });

  it('clearing the override falls back again', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080');
    setApiUrlOverride(db, null);
    expect(getApiUrlOverride(db)).toBeNull();
  });

  it('treats blank input as clearing', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080');
    setApiUrlOverride(db, '   ');
    expect(getApiUrlOverride(db)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/api-config.test.ts`
Expected: FAIL — cannot find module `../lib/api/config`.

- [ ] **Step 4: Implement**

Create `lib/api/config.ts`:

```ts
import Constants from 'expo-constants';
import { eq } from 'drizzle-orm';

import { settings } from '../db/schema';
import type { DB } from '../db/types';

const API_URL_KEY = 'api_base_url';
const DEV_DEFAULT = 'http://10.0.2.2:8080';

// Device-local preference — must be excluded if settings ever sync.
export function getApiUrlOverride(db: DB): string | null {
  const row = db.select().from(settings).where(eq(settings.key, API_URL_KEY)).get();
  return row?.value ? row.value : null;
}

export function setApiUrlOverride(db: DB, url: string | null): void {
  const value = url?.trim() ?? '';
  if (!value) {
    db.delete(settings).where(eq(settings.key, API_URL_KEY)).run();
    return;
  }
  db.insert(settings)
    .values({ key: API_URL_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getApiBaseUrl(db: DB): string {
  const configured =
    getApiUrlOverride(db) ??
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
    DEV_DEFAULT;
  return configured.replace(/\/+$/, '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/api-config.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 4/4; full suite green (243 existing + 4).

- [ ] **Step 6: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add api base url config with dev override"
```

---

### Task 2: Session store and token persistence

**Files:**
- Create: `lib/api/types.ts`, `lib/api/session.ts`
- Test: `__tests__/api-session.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–6):
  - `lib/api/types.ts`: `UserResponseDto { id, email, displayName, householdId, householdName: string }`, `AuthResponseDto { accessToken, refreshToken: string, user: UserResponseDto }`, `MemberDto { userId, displayName, role, joinedAt: string }`, `HouseholdDto { id, name, joinCode: string, members: MemberDto[] }`
  - `lib/api/session.ts`: `Session`, `useSession(): Session`, `getSession(): Session`, `getAccessToken(): string | null`, `setSessionRestoring(): void`, `setSessionSignedOut(): void`, `applyAuthResponse(auth: AuthResponseDto): Promise<void>`, `getStoredRefreshToken(): Promise<string | null>`, `setStoredRefreshToken(token: string | null): Promise<void>`, `resetSessionForTests(): void`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-session.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api-session.test.ts`
Expected: FAIL — cannot find module `../lib/api/session`.

- [ ] **Step 3: Implement**

Create `lib/api/types.ts`:

```ts
// Wire DTOs — camelCase as serialized by the ASP.NET backend.
export type UserResponseDto = {
  id: string;
  email: string;
  displayName: string;
  householdId: string;
  householdName: string;
};

export type AuthResponseDto = {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
};

export type MemberDto = {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
};

export type HouseholdDto = {
  id: string;
  name: string;
  joinCode: string;
  members: MemberDto[];
};
```

Create `lib/api/session.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api-session.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 6/6; full suite green (247 + 6 = 253).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add session store with secure refresh-token persistence"
```

---

### Task 3: API client with single-flight refresh

**Files:**
- Create: `lib/api/client.ts`
- Test: `__tests__/api-client.test.ts`

**Interfaces:**
- Consumes: Task 1 `getApiBaseUrl`; Task 2 session functions.
- Produces (used by Tasks 4–6): `ApiError { status: number; problem: unknown }`, `NetworkError`, `apiFetch<T>(path: string, init?: ApiInit): Promise<T>` where `ApiInit = { method?: string; body?: unknown; skipAuth?: boolean }`, `refreshSession(): Promise<boolean>`, `restoreSession(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-client.test.ts`:

```ts
import { ApiError, apiFetch, NetworkError, refreshSession, restoreSession } from '../lib/api/client';
import {
  applyAuthResponse,
  getAccessToken,
  getSession,
  getStoredRefreshToken,
  resetSessionForTests,
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

    await expect(apiFetch('/api/v1/household', { skipAuth: true })).rejects.toMatchObject({
      status: 404,
    });
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api-client.test.ts`
Expected: FAIL — cannot find module `../lib/api/client`.

- [ ] **Step 3: Implement**

Create `lib/api/client.ts`:

```ts
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

  await applyAuthResponse((await response.json()) as AuthResponseDto);
  return true;
}

export async function restoreSession(): Promise<void> {
  const stored = await getStoredRefreshToken();
  if (!stored) return;
  setSessionRestoring();
  await refreshSession();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api-client.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 12/12; full suite green (253 + 12 = 265).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add api client with single-flight refresh plumbing"
```

---

### Task 4: Auth and household endpoint wrappers

**Files:**
- Create: `lib/api/auth.ts`
- Test: `__tests__/api-auth.test.ts`

**Interfaces:**
- Consumes: Task 3 `apiFetch`; Task 2 `applyAuthResponse`, `getStoredRefreshToken`, `setStoredRefreshToken`, `setSessionSignedOut`.
- Produces (used by Tasks 5–6): `register(email, password, displayName): Promise<void>`, `signIn(email, password): Promise<void>`, `signOut(): Promise<void>`, `getHousehold(): Promise<HouseholdDto>`, `joinHousehold(code: string): Promise<void>`, `leaveHousehold(): Promise<void>`, `normalizeJoinCode(input: string): string`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-auth.test.ts`:

```ts
import {
  getHousehold,
  joinHousehold,
  leaveHousehold,
  normalizeJoinCode,
  register,
  signIn,
  signOut,
} from '../lib/api/auth';
import { apiFetch } from '../lib/api/client';
import {
  getSession,
  getStoredRefreshToken,
  resetSessionForTests,
  setStoredRefreshToken,
} from '../lib/api/session';
import type { AuthResponseDto } from '../lib/api/types';

jest.mock('../lib/api/client', () => ({
  apiFetch: jest.fn(),
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

    await register('kari@example.test', 'passord123', 'Kari');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      body: { email: 'kari@example.test', password: 'passord123', displayName: 'Kari' },
      skipAuth: true,
    });
    expect(getSession().status).toBe('signedIn');
    await expect(getStoredRefreshToken()).resolves.toBe('refresh-1');
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api-auth.test.ts`
Expected: FAIL — cannot find module `../lib/api/auth`.

- [ ] **Step 3: Implement**

Create `lib/api/auth.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api-auth.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 11/11 (4 normalize cases + 7); full suite green (265 + 11 = 276).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add auth and household endpoint wrappers"
```

---

### Task 5: Sign-in and register screens

**Files:**
- Modify: `components/ui/Input.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Create: `app/account/sign-in.tsx`, `app/account/register.tsx`
- Test: `__tests__/account-screens.test.tsx`

**Interfaces:**
- Consumes: Task 4 `signIn`, `register`; Task 3 `ApiError`, `NetworkError`; Task 2 `useSession`.
- Produces: routes `/account/sign-in` and `/account/register` (used by Task 6's Account section).

- [ ] **Step 1: Extend Input (backward compatible)**

In `components/ui/Input.tsx`, extend the props type and pass-through:

```ts
type InputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  testID?: string;
  className?: string;
};
```

and in the component signature add `autoCapitalize = 'sentences'`, `secureTextEntry = false`, `testID`, forwarding all three to `<TextInput ... autoCapitalize={autoCapitalize} secureTextEntry={secureTextEntry} testID={testID} />`. Change nothing else — existing call sites must compile untouched.

- [ ] **Step 2: i18n keys**

Add to `lib/i18n/en.json` (top-level key `"account"`, alphabetical placement not required — match the file's existing ordering style):

```json
  "account": {
    "title": "Account",
    "signedOutHint": "Sign in to sync your recipes and plans across devices.",
    "signInCta": "Sign in",
    "signInTitle": "Sign in",
    "registerTitle": "Create account",
    "email": "Email",
    "password": "Password",
    "displayName": "Name",
    "submitSignIn": "Sign in",
    "submitRegister": "Create account",
    "noAccount": "New here? Create an account",
    "signedInAs": "Signed in as",
    "household": "Household",
    "members": "Members",
    "joinCode": "Join code",
    "shareCode": "Share code",
    "joinTitle": "Join another household",
    "joinPlaceholder": "ABC-DEF",
    "joinButton": "Join",
    "leave": "Leave household",
    "leaveConfirmTitle": "Leave household?",
    "leaveConfirmBody": "You get a fresh personal household. Nothing is deleted from this device, and the household keeps its content.",
    "cancel": "Cancel",
    "signOut": "Sign out",
    "server": "Server",
    "loading": "Loading…",
    "errors": {
      "wrongCredentials": "Wrong email or password.",
      "emailTaken": "That email is already registered.",
      "invalidRegistration": "Check the fields — the password needs at least 8 characters.",
      "joinNotFound": "No household with that code.",
      "joinConflict": "Could not join that household.",
      "network": "Cannot reach the server.",
      "generic": "Something went wrong. Try again."
    }
  }
```

Add to `lib/i18n/nb.json`:

```json
  "account": {
    "title": "Konto",
    "signedOutHint": "Logg inn for å synkronisere oppskrifter og planer mellom enheter.",
    "signInCta": "Logg inn",
    "signInTitle": "Logg inn",
    "registerTitle": "Opprett konto",
    "email": "E-post",
    "password": "Passord",
    "displayName": "Navn",
    "submitSignIn": "Logg inn",
    "submitRegister": "Opprett konto",
    "noAccount": "Ny her? Opprett en konto",
    "signedInAs": "Logget inn som",
    "household": "Husstand",
    "members": "Medlemmer",
    "joinCode": "Bli-med-kode",
    "shareCode": "Del kode",
    "joinTitle": "Bli med i en annen husstand",
    "joinPlaceholder": "ABC-DEF",
    "joinButton": "Bli med",
    "leave": "Forlat husstanden",
    "leaveConfirmTitle": "Forlate husstanden?",
    "leaveConfirmBody": "Du får en ny personlig husstand. Ingenting slettes fra denne enheten, og husstanden beholder innholdet sitt.",
    "cancel": "Avbryt",
    "signOut": "Logg ut",
    "server": "Server",
    "loading": "Laster…",
    "errors": {
      "wrongCredentials": "Feil e-post eller passord.",
      "emailTaken": "E-posten er allerede registrert.",
      "invalidRegistration": "Sjekk feltene — passordet må ha minst 8 tegn.",
      "joinNotFound": "Ingen husstand med den koden.",
      "joinConflict": "Kunne ikke bli med i husstanden.",
      "network": "Får ikke kontakt med serveren.",
      "generic": "Noe gikk galt. Prøv igjen."
    }
  }
```

- [ ] **Step 3: Write the failing screen tests**

Create `__tests__/account-screens.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import RegisterScreen from '../app/account/register';
import SignInScreen from '../app/account/sign-in';
import { register, signIn } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';
import { useSession } from '../lib/api/session';

jest.mock('../lib/api/auth', () => ({
  signIn: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../lib/api/session', () => ({
  useSession: jest.fn(),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args), push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const signInMock = signIn as jest.Mock;
const registerMock = register as jest.Mock;
const useSessionMock = useSession as jest.Mock;

const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

beforeEach(() => {
  jest.clearAllMocks();
  useSessionMock.mockReturnValue(signedOut);
});

describe('SignInScreen', () => {
  it('submits credentials', async () => {
    signInMock.mockResolvedValueOnce(undefined);
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByText('Sign in', { exact: true }));
    });

    expect(signInMock).toHaveBeenCalledWith('kari@example.test', 'passord123');
  });

  it('shows wrong-credentials error on 401', async () => {
    signInMock.mockRejectedValueOnce(new ApiError(401, null));
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'feil');
    await act(async () => {
      fireEvent.press(screen.getByText('Sign in', { exact: true }));
    });

    expect(screen.getByText('Wrong email or password.')).toBeOnTheScreen();
  });

  it('backs out once signed in', () => {
    useSessionMock.mockReturnValue({ ...signedOut, status: 'signedIn' });
    render(<SignInScreen />);
    expect(mockBack).toHaveBeenCalled();
  });

  it('links to registration', () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('New here? Create an account'));
    expect(mockPush).toHaveBeenCalledWith('/account/register');
  });
});

describe('RegisterScreen', () => {
  it('submits the three fields', async () => {
    registerMock.mockResolvedValueOnce(undefined);
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByText('Create account', { exact: true }));
    });

    expect(registerMock).toHaveBeenCalledWith('kari@example.test', 'passord123', 'Kari');
  });

  it('shows email-taken error on 409', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(409, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByText('Create account', { exact: true }));
    });

    expect(screen.getByText('That email is already registered.')).toBeOnTheScreen();
  });

  it('shows validation hint on 400', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(400, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'kort');
    await act(async () => {
      fireEvent.press(screen.getByText('Create account', { exact: true }));
    });

    expect(
      screen.getByText('Check the fields — the password needs at least 8 characters.')
    ).toBeOnTheScreen();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest __tests__/account-screens.test.tsx`
Expected: FAIL — cannot find module `../app/account/sign-in`.

- [ ] **Step 5: Implement the screens**

Create `app/account/sign-in.tsx`:

```tsx
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { signIn } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { t } from '../../lib/i18n';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signedIn') router.back();
  }, [session.status]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError(t('account.errors.wrongCredentials'));
      } else if (caught instanceof NetworkError) {
        setError(t('account.errors.network'));
      } else {
        setError(t('account.errors.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-cream px-4" style={{ paddingTop: insets.top + 12 }}>
      <Text className="mb-6 font-display text-xl text-ink">{t('account.signInTitle')}</Text>
      <Input
        testID="sign-in-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="sign-in-password"
        label={t('account.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        className="mb-4"
      />
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.submitSignIn')} onPress={submit} disabled={busy} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/account/register')}
        className="mt-6 items-center">
        <Text className="font-body text-base text-ink underline">{t('account.noAccount')}</Text>
      </Pressable>
    </View>
  );
}
```

Create `app/account/register.tsx`:

```tsx
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { register } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { t } from '../../lib/i18n';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signedIn') router.back();
  }, [session.status]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password, displayName.trim());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(t('account.errors.emailTaken'));
      } else if (caught instanceof ApiError && caught.status === 400) {
        setError(t('account.errors.invalidRegistration'));
      } else if (caught instanceof NetworkError) {
        setError(t('account.errors.network'));
      } else {
        setError(t('account.errors.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-cream px-4" style={{ paddingTop: insets.top + 12 }}>
      <Text className="mb-6 font-display text-xl text-ink">{t('account.registerTitle')}</Text>
      <Input
        testID="register-name"
        label={t('account.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        className="mb-4"
      />
      <Input
        testID="register-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="register-password"
        label={t('account.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        className="mb-4"
      />
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.submitRegister')} onPress={submit} disabled={busy} />
    </View>
  );
}
```

Note on the effect-based back-out: on sign-in success the session flips to `signedIn`, the effect fires, and the screen pops itself — from the register screen this lands on sign-in, whose own effect immediately pops again to Settings. No imperative double-back bookkeeping.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/account-screens.test.tsx` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 7/7; i18n key-parity test still green; full suite green (276 + 7 = 283).

- [ ] **Step 7: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add sign-in and register screens"
```

---

### Task 6: Settings Account section, session restore, docs

**Files:**
- Create: `components/settings/AccountSection.tsx`
- Modify: `app/settings.tsx`, `app/_layout.tsx`, root `docs/TESTING.md`
- Test: `__tests__/account-section.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useSession`; Task 4 `getHousehold`, `joinHousehold`, `leaveHousehold`, `signOut`; Task 1 `getApiUrlOverride`, `setApiUrlOverride`; Task 3 `ApiError`, `NetworkError`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/account-section.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { AccountSection } from '../components/settings/AccountSection';
import { getHousehold, joinHousehold, signOut } from '../lib/api/auth';
import { useSession } from '../lib/api/session';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/auth', () => ({
  getHousehold: jest.fn(),
  joinHousehold: jest.fn(),
  leaveHousehold: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('../lib/api/session', () => ({
  useSession: jest.fn(),
}));
jest.mock('../lib/api/config', () => ({
  getApiUrlOverride: jest.fn(() => null),
  setApiUrlOverride: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const useSessionMock = useSession as jest.Mock;
const getHouseholdMock = getHousehold as jest.Mock;
const joinHouseholdMock = joinHousehold as jest.Mock;
const signOutMock = signOut as jest.Mock;

const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };
const signedIn = {
  status: 'signedIn',
  user: { id: 'user-1', email: 'kari@example.test', displayName: 'Kari' },
  householdId: 'household-1',
  householdName: 'Karis husstand',
};
const household = {
  id: 'household-1',
  name: 'Karis husstand',
  joinCode: 'ABC-DEF',
  members: [
    { userId: 'user-1', displayName: 'Kari', role: 'owner', joinedAt: '2026-07-01T00:00:00Z' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AccountSection signed out', () => {
  it('shows the sign-in CTA and fetches nothing', () => {
    useSessionMock.mockReturnValue(signedOut);
    render(<AccountSection />);

    fireEvent.press(screen.getByText('Sign in'));
    expect(mockPush).toHaveBeenCalledWith('/account/sign-in');
    expect(getHouseholdMock).not.toHaveBeenCalled();
  });
});

describe('AccountSection signed in', () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue(signedIn);
    getHouseholdMock.mockResolvedValue(household);
  });

  it('shows email, household name, join code and members', async () => {
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('kari@example.test')).toBeOnTheScreen();
    expect(screen.getByText('Karis husstand')).toBeOnTheScreen();
    expect(screen.getByText('ABC-DEF')).toBeOnTheScreen();
    expect(screen.getByText('Kari')).toBeOnTheScreen();
  });

  it('joins another household with the typed code', async () => {
    joinHouseholdMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.changeText(screen.getByTestId('join-code-input'), 'xyz 234');
    await act(async () => {
      fireEvent.press(screen.getByText('Join'));
    });

    expect(joinHouseholdMock).toHaveBeenCalledWith('xyz 234');
  });

  it('asks for confirmation before leaving', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('Leave household'));

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('signs out', async () => {
    signOutMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(screen.getByText('Sign out'));
    });

    expect(signOutMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/account-section.test.tsx`
Expected: FAIL — cannot find module `../components/settings/AccountSection`.

- [ ] **Step 3: Implement the section**

Create `components/settings/AccountSection.tsx`:

```tsx
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { getHousehold, joinHousehold, leaveHousehold, signOut } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { getApiUrlOverride, setApiUrlOverride } from '../../lib/api/config';
import { useSession } from '../../lib/api/session';
import { db } from '../../lib/db/client';
import { t } from '../../lib/i18n';
import type { HouseholdDto } from '../../lib/api/types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

function joinErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 404) return t('account.errors.joinNotFound');
  if (caught instanceof ApiError && caught.status === 409) return t('account.errors.joinConflict');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

export function AccountSection() {
  const session = useSession();
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverOverride, setServerOverride] = useState(() => getApiUrlOverride(db) ?? '');
  const showServerField = __DEV__ || serverOverride !== '';

  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) {
      setHousehold(null);
      return;
    }
    let cancelled = false;
    getHousehold()
      .then((result) => {
        if (!cancelled) setHousehold(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(joinErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
    // householdId changes on join/leave — refetch then.
  }, [signedIn, session.householdId]);

  const join = async () => {
    setError(null);
    try {
      await joinHousehold(joinCode);
      setJoinCode('');
    } catch (caught) {
      setError(joinErrorMessage(caught));
    }
  };

  const confirmLeave = () => {
    Alert.alert(t('account.leaveConfirmTitle'), t('account.leaveConfirmBody'), [
      { text: t('account.cancel'), style: 'cancel' },
      {
        text: t('account.leave'),
        style: 'destructive',
        onPress: () => {
          leaveHousehold().catch((caught) => setError(joinErrorMessage(caught)));
        },
      },
    ]);
  };

  const serverField = showServerField ? (
    <Input
      testID="server-override-input"
      label={t('account.server')}
      value={serverOverride}
      onChangeText={(next) => {
        setServerOverride(next);
        setApiUrlOverride(db, next);
      }}
      autoCapitalize="none"
      className="mt-4"
    />
  ) : null;

  if (!signedIn) {
    return (
      <View testID="account-section" className="px-4 pt-2">
        <Text className="mb-2 font-body-bold text-sm text-ink">{t('account.title')}</Text>
        <Text className="mb-3 font-body text-sm text-ink">{t('account.signedOutHint')}</Text>
        <Button label={t('account.signInCta')} onPress={() => router.push('/account/sign-in')} />
        {serverField}
      </View>
    );
  }

  return (
    <View testID="account-section" className="px-4 pt-2">
      <Text className="mb-2 font-body-bold text-sm text-ink">{t('account.title')}</Text>
      <Text className="font-body text-sm text-ink">{t('account.signedInAs')}</Text>
      <Text className="mb-3 font-body-bold text-base text-ink">{session.user?.email}</Text>

      <Text className="font-body text-sm text-ink">{t('account.household')}</Text>
      <Text className="font-body-bold text-base text-ink">
        {household?.name ?? session.householdName ?? t('account.loading')}
      </Text>
      {household ? (
        <View className="mb-3">
          <View className="flex-row items-center gap-3">
            <Text className="font-body-bold text-lg text-ink">{household.joinCode}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => Share.share({ message: household.joinCode })}>
              <Text className="font-body text-sm text-ink underline">
                {t('account.shareCode')}
              </Text>
            </Pressable>
          </View>
          <Text className="mt-2 font-body text-sm text-ink">{t('account.members')}</Text>
          {household.members.map((member) => (
            <Text key={member.userId} className="font-body text-base text-ink">
              {member.displayName}
            </Text>
          ))}
        </View>
      ) : null}

      <Text className="mt-2 font-body text-sm text-ink">{t('account.joinTitle')}</Text>
      <View className="mt-1 flex-row items-center gap-2">
        <View className="flex-1">
          <Input
            testID="join-code-input"
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder={t('account.joinPlaceholder')}
            autoCapitalize="characters"
          />
        </View>
        <Button label={t('account.joinButton')} onPress={join} />
      </View>

      {error ? <Text className="mt-2 font-body text-sm text-clay">{error}</Text> : null}

      <View className="mt-4 gap-2">
        <Button label={t('account.leave')} onPress={confirmLeave} variant="ghost" />
        <Button
          label={t('account.signOut')}
          onPress={() => {
            void signOut();
          }}
          variant="ghost"
        />
      </View>
      {serverField}
    </View>
  );
}
```

- [ ] **Step 4: Mount it + restore on startup**

In `app/settings.tsx`, import and mount above the appearance section:

```tsx
import { AccountSection } from '../components/settings/AccountSection';
```

and directly under the header `View` (before `testID="appearance-section"`):

```tsx
      <AccountSection />
```

In `app/_layout.tsx`, add the import and a mount effect inside the root layout component (next to its existing effects):

```tsx
import { restoreSession } from '../lib/api/client';
```

```tsx
  useEffect(() => {
    void restoreSession();
  }, []);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/account-section.test.tsx`, then `npx jest __tests__/settings-*.test* __tests__/*.test.tsx` sanity for existing settings tests, then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: new file 6/6; existing settings/screen tests pass UNTOUCHED (if a settings screen test now fails because AccountSection renders network-touching code, the AccountSection mock boundary is wrong — AccountSection must render nothing network-touching when signed out; fix the component, not the tests; adding the new `jest.mock` entries to an EXISTING settings test file is allowed ONLY if compile-forced, disclose it). Full suite green (283 + 6 = 289). Export bundles cleanly.

- [ ] **Step 6: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Frontend auth (manual pass)

Backend running via `docker compose up` in `backend/` first. On a physical device, set the Server field (dev builds) to `http://<your-LAN-ip>:8080`.

- Signed out: app behaves exactly as before; airplane mode changes nothing.
- Settings → Account → Sign in → create account: lands back in Settings showing your email and a personal household with a join code.
- Kill + relaunch the app: still signed in (silent restore), no visible flicker signed out.
- Second device (or emulator + device): register another user, join with the first user's code → both see the same member list.
- Leave household: confirm dialog, then you get a fresh personal household; the old household still shows its content to remaining members (server-side).
- Sign out: Account section returns to signed-out state; local recipes/plans untouched.
- Wrong password shows the inline error; joining with a bogus code shows "no household with that code".
- NOTE until slice ④: signing in does NOT upload local content yet — the server-side household looks empty. That is expected.
```

- [ ] **Step 7: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: add settings account section with session restore"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (module layer + house-pattern state → T2/T3), 2 (token handling incl. restore rules → T2/T3), 3 (URL precedence + dev-only server field → T1/T6), 4 (single-flight refresh plumbing → T3), 5 (wrappers, sign-out-never-fails, join normalization, join/leave-as-login → T4), 6 (screens + account section incl. household name/code/members/share/leave-confirm → T5/T6), 7 (error mapping, all strings nb+en → T5/T6), 8 (no content-table touches anywhere — no task imports the content repositories). Goals' "zero network signed out" is asserted (restore no-op test, signed-out section test).
- **Judgment calls:** share-code uses RN `Share` (no new clipboard dependency; spec's "copy affordance" delivered as share). `sessionStatus`-effect back-out pattern replaces imperative double-back. Server field writes override on every keystroke — acceptable for a dev field; blank clears. `refreshSession`'s network-error path calls `setSessionSignedOut()` even when already signed out — harmless idempotent emit. AccountSection refetches household when `householdId` changes (post-join/leave) via the effect dependency.
- **Type consistency check:** `ApiInit` shape matches every call site (`method`/`body`/`skipAuth`); `AuthResponseDto`/`HouseholdDto` field names match backend camelCase serialization of `AuthResponse`/`HouseholdResponse`; session function names (`setSessionRestoring`/`setSessionSignedOut`/`applyAuthResponse`/`getStoredRefreshToken`/`setStoredRefreshToken`) are identical across T2 definition and T3/T4 imports; test mock module paths mirror real import paths; `normalizeJoinCode` referenced only within T4.
- **Mock-prefix rule:** in T5/T6 tests, `jest.mock` factories reference only `mock`-prefixed variables (`mockBack`, `mockPush`); other mocks are `jest.fn()` created inside factories and re-cast after import — matches existing test idiom.
