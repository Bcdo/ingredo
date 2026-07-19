# Authentication — Design Spec

**Date:** 2026-07-19
**Slice:** Phase 3 (roadmap: Registration, Login, JWT). Backend-only — the frontend keeps working locally and gets its login UI when Phase 5 wires it to the API.
**Scope:** Lean custom identity (own tables, vetted primitives): register/login/refresh/logout/me endpoints, JWT access + rotating refresh tokens with reuse detection, personal-household ownership attached to the recipe API, and real authorization (household-scoped queries) on the existing endpoints.
**Builds on:** backend foundation (`2026-07-19-backend-foundation-design.md`): controllers → services → `AppDbContext`, `ServiceResult`, FluentValidation-in-controller, Testcontainers rig, compose/.env secrets flow. `docs/ARCHITECTURE.md`'s entity sketch (User/Household/HouseholdMember, recipes household-owned).

## Goals

- Real accounts: register, log in, stay logged in on a phone without weekly re-authentication (15-minute access token + 30-day rotating refresh token).
- Ownership done once, correctly: content is household-owned from the first authorized request — Phase 4 adds *sharing* of households, not a re-homing migration.
- Authorization actually exercised: the recipe API goes behind `[Authorize]` with household-scoped queries and cross-tenant isolation tests — not decorative auth endpoints on an open API.
- Learning value (per `docs/DECISIONS.md`): every moving part visible — token issuance, validation, rotation, hashing — built on vetted primitives, no hand-rolled crypto.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Email verification, password reset | Requires email infrastructure — its own slice, before any public deployment |
| Login rate limiting / account lockout | Deferred hardening; must land before public exposure (tracked, not forgotten) |
| Household joining, invites, multi-member, role enforcement | Phase 4 (`Role` is stored now, unused) |
| Frontend login UI / token storage on device | Phase 5 (offline queue + sync wires the app to the API) |
| Token-family cleanup job (expired refresh rows) | Housekeeping slice; rows are small and bounded per user until then |
| OAuth/social login | Not planned |

## Key decisions

1. **Lean custom identity.** Own `User` table; password hashing via ASP.NET's `PasswordHasher<User>` (PBKDF2, versioned, upgrade-friendly — from `Microsoft.Extensions.Identity.Core`, not the full Identity framework). Email stored twice: as entered (display) and normalized lowercase invariant with a unique index (identity).
2. **Personal household at registration.** Registering creates, in one transaction: the `User`, a `Household` named after the display name (no baked-in language — renameable in Phase 4), and an `Owner` `HouseholdMember` row. Every user has exactly one household until Phase 4.
3. **Recipes become household-owned.** `Recipe.HouseholdId` (required FK). The migration assumes disposable dev data (none exists in production; compose-volume reset is the documented upgrade path). All recipe queries scope to the caller's household; foreign or nonexistent recipes are indistinguishable — **404, never 403** (no existence leak). The create-duplicate-id check stays global (ids stay globally unique for Phase 5 sync); with random Guids the 409 probe surface is not meaningful — accepted.
4. **Tokens.** Access: JWT, HS256, 15-minute lifetime, claims `sub` (user id) and `household` (household id — safe while membership is static; the short lifetime bounds staleness when Phase 4 makes it dynamic), issuer/audience validated. Signing key from configuration (`Jwt:Key` via env/`.env`; startup fails fast if missing or < 32 bytes). Refresh: 256-bit cryptographically random opaque value returned once to the client; stored server-side only as SHA-256 hash with expiry (30 days), creation, and revocation metadata.
5. **Rotation with reuse detection.** `/refresh` accepts a refresh token, and if valid: revokes it, records its replacement, issues a new access+refresh pair. If the presented token is *already revoked/rotated* (the reuse signal — likely theft), the entire token family (chained via replacement links back to the original) is revoked and the request gets 401. `/logout` revokes the presented refresh token (204, idempotent).
6. **Endpoints (`/api/v1/auth`, JSON):**
   - `POST /register` `{ email, password, displayName }` → 201 `{ accessToken, refreshToken, user }`; 400 validation (email format; password length ≥ 8, no composition rules; display name non-empty ≤ 100); 409 duplicate email.
   - `POST /login` `{ email, password }` → 200 token pair + user; 401 on unknown email or wrong password — same response either way (no user enumeration; register's 409 is the accepted enumeration point).
   - `POST /refresh` `{ refreshToken }` → 200 new pair; 401 invalid/expired/reused (family revoked on reuse).
   - `POST /logout` `{ refreshToken }` → 204 (idempotent, including unknown tokens).
   - `GET /me` (authorized) → 200 `{ id, email, displayName, householdId, householdName }`.
7. **Recipe API changes.** `[Authorize]` on `RecipesController`; `IRecipeService` methods take the caller's household id (from the `household` claim, parsed by the controller); create stamps `HouseholdId`; list/get/update/delete filter by it. Anonymous requests → 401 (default challenge). Existing integration tests gain an authenticated client helper; new isolation tests prove cross-tenant 404s.
8. **Validation and errors follow the house pattern.** FluentValidation validated in controllers → `ValidationProblemDetails`; auth outcomes travel as `ServiceResult`-style values (Ok/Conflict/Unauthorized) — no exceptions for expected outcomes; `GlobalExceptionMiddleware` unchanged.
9. **Config/testing.** `Jwt:Key`/`Issuer`/`Audience` in `appsettings.Development.json` (dev-only key, matching the established dev-credentials stance) and via compose env for the container; the test factory injects its own generated key. Integration tests (Testcontainers, existing rig + `[Collection("Api")]`): register→login→me round-trip; duplicate email 409; wrong password and unknown email both 401; anonymous recipes 401; **two-user isolation** (B cannot list/get/update/delete A's recipes — all 404/absent); refresh rotation issues a working pair and kills the old; reuse revokes the family; logout revokes. Validator unit tests for the email/password/displayName matrix. Definition of green unchanged (zero warnings, all tests, compose smoke).

## Components

### `backend/Ingredo.Api/Domain/` (extended)

- `User`, `Household`, `HouseholdMember` (+ `HouseholdRole` enum stored as text), `RefreshToken` — shapes per decisions 1–5; `Recipe.HouseholdId` added.

### `backend/Ingredo.Api/Data/`

- `AppDbContext`: new DbSets, unique index on `User.NormalizedEmail`, unique `(UserId, HouseholdId)` on members, index on `RefreshToken.TokenHash`, required FK `Recipe.HouseholdId`; new migration `AddIdentity`.

### `backend/Ingredo.Api/Auth/` (new feature folder)

- `AuthController`, `IAuthService`/`AuthService` (register/login/refresh/logout/me; owns hashing, token family logic), `TokenService` (JWT issuance + refresh-token generation/hashing), auth DTOs, validators, JWT wiring extensions for `Program.cs` (`AddAuthentication().AddJwtBearer(...)`, fail-fast key check).

### `backend/Ingredo.Api/Recipes/` (modified)

- Controller: `[Authorize]`, household claim extraction; service methods gain `householdId` parameter and scoped queries.

### `backend/Ingredo.Api.Tests/`

- `Integration/AuthApiTests.cs`, isolation additions to `RecipesApiTests`, an authenticated-client helper on/next to `ApiFactory`; `Validators/AuthValidatorTests.cs`.

### Infra

- `docker-compose.yml`: `Jwt__Key` (+ issuer/audience) env pass-through; `.env.example` gains a placeholder key with a "generate your own" comment; README auth section (endpoints, token lifetimes, curl example).

## Error handling

Per decision 8. 401s come from JWT bearer middleware (missing/invalid token) or explicit auth-service outcomes; no stack traces or failure-reason detail in any 401 body.

## Testing

Per decision 9. Rough new-test count: ~10 auth integration + ~3 recipes-isolation + ~8 validator units on top of the existing 26.

## Rollout

Feature branch `feature/authentication` off `develop`, merged per the usual flow. Existing dev databases (compose volume, Testcontainers) are recreated — documented in README. Frontend and theme branches untouched.
