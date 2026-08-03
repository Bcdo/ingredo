# Password Reset — Design Spec

**Date:** 2026-08-03
**Slice:** password-reset — operator-delivered single-use reset codes with an in-app flow; the delivery channel (operator → transactional email) is swappable in a later slice without touching the machinery built here.
**Context:** ~12 invited beta testers; a forgotten password today means the operator edits the database. No email-sending infrastructure exists and none is added in this slice. Builds directly on the hardening slice's patterns (single-use codes, `UsedAt` concurrency token, mint script, "auth" rate-limit policy, uniform-403 no-oracle responses).

## Goals

- A locked-out tester regains access without operator database surgery: they message the operator, receive a short-lived code, and set a new password in the app.
- A successful reset signs the account out everywhere (all refresh-token families revoked).
- Nothing built here is thrown away when real email delivery arrives: the future slice adds only a "request" endpoint + provider.

## Non-goals

- Email sending, `POST /forgot`, provider accounts, SPF/DKIM — the follow-up slice.
- Password change while signed in (different feature; testers can use reset meanwhile).
- Admin UI — the operator interface is a script, like invites.

## Key decisions

1. **`PasswordResetCode` entity + table**: `Id` (guid), `UserId` (guid, deliberately NO foreign key — RefreshToken/InviteCode precedent), `CodeHash` (string, unique index), `CreatedAt`, `ExpiresAt`, `UsedAt` (nullable, EF concurrency token). Codes are account-takeover secrets, so unlike invite codes only the **hash** is stored: lowercase-hex SHA-256 of the canonical code, computed by a small static helper (`PasswordResetCode.HashCode(string canonical)`) so the C# side and the operator script (`sha256sum`) provably agree. One EF migration.
2. **Code format** reuses `JoinCodeGenerator`: canonical 6 chars from the I/L/O/0/1-free alphabet, `ABC-DEF` display form, `Canonicalize` tolerance on input. Expiry: **60 minutes** from minting.
3. **One endpoint**: `POST /api/v1/auth/reset-password`, `[AllowAnonymous]` + `[EnableRateLimiting("auth")]` (the existing 10/min policy blunts brute force; 31⁶ space × 60-min TTL × single-use makes enumeration hopeless). Request `{ Email, Code, NewPassword }`; validator: all three non-empty, `NewPassword` same rules as registration (8–128 chars) → 400 on violation.
   - Service flow: canonicalize code (null → 403); find user by normalized email; find that user's reset row where `CodeHash` matches and `UsedAt == null` and `ExpiresAt > now`; any miss → **the same bare 403** (wrong email, wrong code, expired, used, and raced are indistinguishable — no oracle). On match: set `PasswordHash` via the existing `IPasswordHasher<User>`, stamp `UsedAt`, and revoke every active refresh token for the user (`RevokedAt = now` on all rows with `UserId` and `RevokedAt == null`) — one `SaveChanges`; `DbUpdateConcurrencyException` (raced code) → 403. Success → **204 NoContent** (no auto-login; the user signs in with the new password).
4. **`mint-reset.sh <email>`** (`backend/deploy/`, mode 755, conventions of `mint-invites.sh` incl. the positive-argument discipline): requires exactly one argument (an email); resolves the user id in the prod database by normalized email — unknown email exits 1 loudly with a message; generates a canonical code; inserts `(gen_random_uuid(), <userId>, <sha256-hex>, now(), now() + interval '60 minutes')`; prints the display-form code, the expiry time, and a hint query for outstanding codes. Multiple mints for one user are allowed (each single-use; old ones simply expire).
5. **Frontend flow**:
   - Sign-in screen gains a "Glemt passord?" / "Forgot password?" text link under the submit button → `app/account/reset.tsx`.
   - Reset screen: instruction line; email field; code field (`autoCapitalize="characters"`, placeholder `ABC-DEF`); new password + confirm fields (both `secureTextEntry` + `secureToggle`, client-side mismatch guard reusing the register screen's pattern and `errors.passwordMismatch` string); submit button.
   - On 204: navigate back to sign-in and show a success notice there (one-shot state passed via router params or a module-level flag — plan decides, matching existing idioms). On 403: `errors.resetInvalid`. On 400: existing `errors.invalidRegistration` (password-rule wording fits). Mismatch: existing `errors.passwordMismatch`.
6. **Strings** (both locales; parity test):

   | Key (`account.`) | nb | en |
   |---|---|---|
   | `forgotPassword` | "Glemt passord?" | "Forgot password?" |
   | `resetTitle` | "Tilbakestill passord" | "Reset password" |
   | `resetHint` | "Be om en tilbakestillingskode og skriv den inn her innen én time." | "Ask for a reset code and enter it here within one hour." |
   | `resetCode` | "Tilbakestillingskode" | "Reset code" |
   | `newPassword` | "Nytt passord" | "New password" |
   | `resetSubmit` | "Sett nytt passord" | "Set new password" |
   | `resetDone` | "Passordet er endret — logg inn." | "Password changed — sign in." |
   | `errors.resetInvalid` | "Ugyldig eller utløpt kode." | "Invalid or expired code." |

   (`confirmPassword`, `passwordMismatch`, `invalidRegistration`, eye labels already exist.)

## Components

- `backend/Ingredo.Api/Domain/PasswordResetCode.cs` (+`HashCode` helper), `Data/AppDbContext.cs`, one migration.
- `backend/Ingredo.Api/Auth/AuthDtos.cs` (+`ResetPasswordRequest`), `AuthValidators.cs`, `IAuthService.cs`/`AuthService.cs` (+`ResetPasswordAsync`), `AuthController.cs` (+endpoint).
- `backend/deploy/mint-reset.sh`; `backend/README.md` Production section (reset runbook paragraph).
- `frontend/app/account/reset.tsx` (new), `app/account/sign-in.tsx` (link + success notice), `lib/api/auth.ts` (+`resetPassword(email, code, newPassword)`), i18n both locales.
- `docs/TESTING.md` (+manual pass).

## Error handling

All code-path failures collapse to 403 → `resetInvalid`; validation failures 400 → `invalidRegistration`; network → existing mapping. The script is `set -euo pipefail`, loud on unknown email, and cannot insert an unhashed or non-canonical value (it inserts only the hash of a generated canonical code).

## Testing

- Backend: full lifecycle — mint (via a test helper inserting a hashed code directly), reset with the code → 204, login with the new password succeeds, the OLD password fails, and a refresh with a pre-reset refresh token is rejected (families revoked); reuse of the code → 403; expired code (insert with past `ExpiresAt`) → 403; wrong email with a live code → 403 (uniformity); raced double-reset → exactly one 204 (concurrency token); weak password → 400 with code NOT consumed.
- Script: `bash -n`, identifier check against the migration, argument-guard checks (0 args, 2 args), and a scratch-file verification that bash `sha256sum` of a known code equals the C# helper's documented hex encoding (test vector pinned in both the script comment and a backend unit test: `HashCode("ABC234") = <hex>` — the plan computes the actual vector).
- Frontend: reset screen sends `{email, code, newPassword}`; mismatch blocks locally; 403 → `resetInvalid` text; success navigates to sign-in and the notice renders; sign-in link navigates. Parity test covers the string table.
- Manual (TESTING.md): full operator round-trip — mint for a real test account, reset from the phone, old session's sync stops (revoked), sign in with the new password.

## Rollout

Branch `feature/password-reset` off develop, subagent-driven. Deploy backend, `publish:beta`; no data migration concerns (additive table). The future email slice swaps decision 4's delivery: `POST /api/v1/auth/forgot` + provider sends the same codes; the reset endpoint, table, and app screen are unchanged.
