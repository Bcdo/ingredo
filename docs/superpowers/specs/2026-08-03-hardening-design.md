# Public-Exposure Hardening — Design Spec

**Date:** 2026-08-03
**Slice:** hardening — the security work deferred until the API left the LAN (it now serves `https://api.kodesmien.no`): invite-gated registration, rate limiting, fallback authorization. Also the vehicle for expanding the beta from 2 to ~12 testers (10 single-use invite codes).
**Context:** Backend-heavy + one registration-screen field. The origin is reachable ONLY through the Cloudflare Tunnel (no published ports), which several decisions below rely on.

## Goals

- A stranger who finds the API cannot create an account: registration requires a single-use invite code.
- The operator mints codes with one command and can see which are used.
- Credential guessing and join-code enumeration are throttled; a future endpoint that forgets `[Authorize]` is closed by default.
- Existing accounts, sign-in, sync, and realtime behave exactly as today.

## Non-goals (stay on the deferred list)

- Password reset / email infrastructure (next pressure point with ~12 testers — explicitly the following slice's candidate, not this one).
- Email verification, SignalR group eviction on leave, WAF rules, security headers, fail2ban-style banning.

## Key decisions

1. **`InviteCode` entity + table**: `Id` (guid), `Code` (string, unique index — canonical 6-char form using `JoinCodeGenerator.Alphabet`, the I/L/O/0/1-free set), `CreatedAt`, `UsedAt` (nullable), `UsedByUserId` (nullable guid, no FK — mirrors the RefreshToken precedent so user deletion never blocks on bookkeeping rows). One EF migration.
2. **Registration requires a code.** `RegisterRequest` gains required `InviteCode`. `RegisterAsync`: canonicalize via `JoinCodeGenerator.Canonicalize` (null → invalid); look up a row with that code and `UsedAt == null`; missing/used → new `ServiceStatus.Forbidden` mapped to **403** by the controller, before any user is created. On success, `UsedAt`/`UsedByUserId` are stamped in the same `SaveChanges` as user+household creation, with `UsedAt` configured as an EF concurrency token — two racing registrations on one code: one wins, the loser gets `DbUpdateConcurrencyException` mapped to the same 403. **Check order: invite first, then email.** Checking email first would let anyone without a valid code probe which emails exist; with invite-first, only holders of a live code can reach the 409. A failed registration (409 or validation) never consumes the code — consumption happens only in the success-path `SaveChanges`.
3. **Minting**: `backend/deploy/mint-invites.sh [N]` (default 10), run on the host. Generates N codes in bash from the same alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 6 chars, via `/dev/urandom`), `INSERT ... ON CONFLICT DO NOTHING` into the prod database through `docker exec ingredo-prod-postgres-1 psql`, then prints the inserted codes in `ABC-DEF` display form plus a count of unused codes remaining. Re-runnable; listing used/unused is `SELECT` away and the script prints the query as a hint. `BACKUP`-style env override for the container name mirrors `backup.sh`'s conventions.
4. **Frontend registration field**: invite-code `Input` (autoCapitalize characters, placeholder `ABC-DEF`) above the name field; the app sends the raw text (backend canonicalizes — same tolerance as join codes: case, spaces, hyphen). Error mapping: 403 → `account.errors.inviteInvalid`; all other mappings unchanged. Strings: `account.inviteCode` = "Invitasjonskode" / "Invite code"; `account.errors.inviteInvalid` = "Ugyldig invitasjonskode." / "That invite code isn't valid.". The signed-out settings hint and sign-in screen are untouched.
5. **Rate limiting** (ASP.NET `AddRateLimiter`, `app.UseRateLimiter()` before auth):
   - Partition key: `CF-Connecting-IP` header when present, else `RemoteIpAddress` — trustworthy because the origin has no path except the tunnel. Key resolution lives in one small helper used by both policies.
   - Policy `auth` on login, register, and household join/leave endpoints: fixed window, **10 requests/minute** per client.
   - Global limiter: fixed window, **300 requests/minute** per client — far above real app traffic (sync bursts included), pure runaway protection. `/health` and the SignalR hub path are exempt (hub connections are long-lived, and health is probed by tooling).
   - Rejection: **429** with `Retry-After`; the app's `apiFetch` already surfaces non-2xx as `ApiError` → the existing generic error line. No new frontend strings.
   - Limits live in configuration (`RateLimiting:Auth:PermitLimit` etc. in appsettings) so integration tests can tighten/loosen them; production uses the defaults above.
6. **Fallback authorization policy**: `options.FallbackPolicy = RequireAuthenticatedUser` in the auth setup. Explicit `[AllowAnonymous]` on: register, login, refresh, logout (the four `skipAuth` client calls), and the `/health` endpoint mapping (`.AllowAnonymous()`). Dev-only OpenAPI/Scalar mappings get `.AllowAnonymous()` inside the existing dev gate. Everything else keeps its `[Authorize]` — now redundant, kept for explicitness.

## Components

- `backend/Ingredo.Api/Domain/InviteCode.cs` (new), `Data/AppDbContext.cs` (+DbSet, config), one migration.
- `backend/Ingredo.Api/Auth/AuthDtos.cs` / `AuthValidators.cs` / `AuthService.cs` / `AuthController.cs` (invite flow, 403 mapping).
- `backend/Ingredo.Api/Program.cs` + `Auth/AuthSetupExtensions.cs` (rate limiter, fallback policy).
- `backend/deploy/mint-invites.sh` (new, 755).
- `backend/README.md` (Production section: minting + monitoring invites, the 429 policy, one line each).
- `frontend/app/account/register.tsx` (+invite field), `lib/api/auth.ts` (register body +`inviteCode`), i18n both locales, tests.
- `docs/TESTING.md` (manual pass lines: register without code fails friendly; with a minted code succeeds; code single-use).

## Error handling

Invalid/used/raced invite → 403 → `inviteInvalid` string; validator rejects empty invite (400 → existing `invalidRegistration` string covers it). 429s surface as the generic error and self-heal next minute. The mint script `set -euo pipefail`s and is idempotent on conflicts.

## Testing

- Backend: register without a code → 400; with an unknown code → 403 and no user row; with a valid code → 201, code stamped used (UsedAt/UsedByUserId); reusing it → 403; the email-taken path does NOT consume the code; two concurrent registrations on one code → exactly one succeeds (concurrency-token test). Rate limiting: with test-config PermitLimit=2, third login attempt → 429; global limiter leaves normal traffic alone; `/health` anonymous and unlimited. Fallback policy: a request without a token to a data endpoint → 401 (existing tests already cover several; add one for an endpoint relying only on the fallback).
- Frontend: register screen sends the invite code (5-arg register / body assertion); 403 maps to the invite error string; field renders with placeholder. Key-parity test covers the new strings.
- All existing suites stay green (backend fixture registers users — its helper gains a mint-a-code step against the test database).

## Rollout

Branch `feature/hardening` off develop, subagent-driven. Backend-first deploy order (old app + new backend would break registration — but both real phones are REGISTERED already; only new testers register, and they'll install after the OTA update): merge → push → ff master → `deploy.sh` → `publish:beta` → run `mint-invites.sh 10` → hand codes to testers. TESTING.md manual pass. Note for the audience memory: beta expands to ~12 testers; password reset moves up the queue.
