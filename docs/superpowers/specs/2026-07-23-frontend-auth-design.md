# Frontend Auth — Design Spec

**Date:** 2026-07-23
**Slice:** Phase 5 slice ③ (see `2026-07-22-sync-architecture.md`). Opt-in sign-in: screens, secure token storage, and an authenticated API client with refresh plumbing. No sync — the engine (slice ④) builds on this client.
**Scope:** `lib/api/` module (config, client, auth, session), an Account section in settings, sign-in/register screens, household membership management (join code, members, join, leave), sign out. Signed-out mode untouched.
**Builds on:** backend auth (register/login/refresh/logout, 15-min HS256 access + 30-day rotating refresh), household endpoints (`GET /api/v1/household`, `POST /api/v1/household/join`, `POST /api/v1/household/leave` — join/leave return a fresh `AuthResponse` because the household claim changes), the settings key-value store and the module-state + subscriber-hook pattern (`lib/locale.ts`, `lib/colorMode.ts`), the UI kit (`Input`, `Button`, `Card`, `SegmentedControl`), i18n with nb/en key parity.

## Goals

- A user can create an account, sign in, see and share their household join code, join another household by code, leave a household, and sign out — all from Settings.
- Tokens are stored and refreshed correctly: refresh token in `expo-secure-store`, access token in memory only, transparent 401 → refresh → retry in one place.
- Local-only stays first-class: signed out, the app makes zero network calls and behaves exactly as today.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Adoption flow (pushing local rows after first sign-in) | Slice ④ |
| Any push/pull, dirty-flag reads, cursor storage | Slice ④ |
| Sync status UI / conflict surfacing | Slice ④ |
| Reconciling local SQLite after join/leave (cursor reset, full pull) | Slice ④ (architecture decision 6) |
| Household rename + join-code regeneration UI (endpoints exist) | Whenever a need appears — trivial additions to the household card |
| Email verification, password reset | Pre-public-exposure backlog (with rate limiting) |
| Biometric lock on the stored session | Not planned |

## Key decisions

1. **Thin module layer, house-pattern state — no context provider, no state library.** `lib/api/session.ts` holds module-level state `{ status: 'signedOut' | 'restoring' | 'signedIn', user: { id, email, displayName } | null, householdId: string | null }` with `useSession()` built on the same subscribe/version idiom as `useLocaleVersion`. Only settings/account screens consume it.
2. **Token handling.** Refresh token: `expo-secure-store` (new dependency), key `ingredo.refreshToken`. Access token: module memory only — never persisted (15-min lifetime makes persistence pointless and riskier). App start: if a stored refresh token exists, session enters `restoring` and a silent refresh runs; success → `signedIn`, failure (401 or network error) → `signedOut` with the stored token kept on network error but cleared on 401 (revoked/expired family). No UI blocks on restore.
3. **Base URL resolution** (`lib/api/config.ts`): settings-table override key `api_base_url` (device-local, same never-sync comment as `color_mode`) → else build-time default from `app.config`/`app.json` `extra.apiUrl` → else dev default `http://10.0.2.2:8080` (Android emulator loopback). The settings screen's Account section shows a small "Server" input only in dev builds (`__DEV__`) or when an override is already set.
4. **`apiFetch` refresh plumbing** (`lib/api/client.ts`): attaches `Authorization: Bearer <access>` when signed in; on 401 response it performs ONE refresh (single-flight: concurrent 401s await the same refresh promise) and retries the original request once; if the refresh itself fails with 401, it clears the session and stored refresh token (signed-out state) and the original 401 propagates as `ApiError`. Refresh rotation: every refresh/login/register/join/leave response carries a new refresh token — always persist it before proceeding (the backend revokes reused tokens family-wide).
5. **Auth + household API** (`lib/api/auth.ts`): `register(email, password, displayName)`, `signIn(email, password)`, `signOut()` (POST logout with the refresh token, then clear local session state regardless of response — sign-out must never fail locally), `getHousehold()` (code, members), `joinHousehold(code)`, `leaveHousehold()`. Join/leave responses are `AuthResponse`s — treat them exactly like a login (store rotated tokens, update session householdId). Join-code input accepts with or without the dash, uppercases, and sends the normalized `XXX-XXX` form.
6. **Screens.** `app/settings.tsx` gains an Account section above Appearance: signed out → explanatory line ("sync across devices") + Sign-in button → `app/account/sign-in.tsx`; link to `app/account/register.tsx` from the sign-in screen. Signed in → email + display name, household card (household name as title, join code formatted `XXX-XXX` with a copy affordance, member display-name list), join-another-household input + button, Leave household (native confirm `Alert` — copy states server content is unaffected and local data stays), Sign out. Screens use the existing UI kit and stack navigation; no new visual patterns.
7. **Errors.** `ApiError { status, code?, message }` thrown by `apiFetch` for non-2xx; auth screens map: 401 login → "wrong email or password", 409 register → "email already registered", 404 join → "no household with that code", 409 join → backend conflict text generalized to a translated message, network failure → "cannot reach server". All strings in nb + en (key-parity test covers them). No toasts; inline text under the relevant field, matching form validation styling.
8. **Local data is untouched by every action in this slice.** Register, sign in, join, leave, sign out: none of them read or write the content tables. The engine slice owns adoption and reconciliation. A first sign-in therefore shows an empty household server-side until slice ④ pushes — acceptable interim state, noted in TESTING.md.

## Components

- `lib/api/config.ts` — base URL resolution + settings override get/set.
- `lib/api/client.ts` — `apiFetch`, `ApiError`, single-flight refresh, sign-out-on-refresh-failure.
- `lib/api/auth.ts` — endpoint wrappers, token persistence, session updates, join-code normalization.
- `lib/api/session.ts` — module state, `useSession()`, `restoreSession()` (called from root layout effect), test-only reset.
- `app/settings.tsx` — Account section (both states) + dev server field.
- `app/account/sign-in.tsx`, `app/account/register.tsx` — form screens on the existing stack.
- `lib/i18n` dictionaries — new `account.*` keys, nb + en.
- Tests: `lib/api` unit tests (mocked fetch + mocked `expo-secure-store`), screen tests for the three screens/states per existing RNTL patterns.

## Error handling

Per decision 7. Restore-time failures are silent (land signed out). Sign-out clears local state even when the network is down.

## Testing

Unit: base URL precedence (override > config > dev default); Bearer attachment; 401 → single refresh → retry (and single-flight under two concurrent 401s); refresh-401 → session cleared + stored token cleared; refresh network-error → signed out but stored token kept; rotation persisted from every AuthResponse. Screen: signed-out section renders sign-in CTA and no network calls occur; sign-in success updates section to signed-in state; wrong password shows inline error; register duplicate email shows inline error; join normalizes code input and updates household; leave confirm flow; sign out returns section to signed-out. Full frontend pass: suite, lint zero warnings, `tsc`, android export bundle.

## Rollout

Feature branch `feature/frontend-auth` off `develop`. New dependency: `expo-secure-store` (Expo SDK 54 built-in support). Manual checklist appended to `docs/TESTING.md` (two-device flows need the compose backend running). Signed-out behavior verifiably unchanged — existing screen tests must pass untouched.
