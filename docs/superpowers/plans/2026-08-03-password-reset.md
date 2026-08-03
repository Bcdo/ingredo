# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator-delivered single-use password-reset codes (hashed at rest, 60-minute TTL, all sessions revoked on success) with an in-app "Glemt passord?" flow — no email infrastructure.

**Architecture:** A `PasswordResetCodes` table mirroring the invite-code machinery (single-use `UsedAt` concurrency token) but storing only the SHA-256 hex of the code. One anonymous, rate-limited endpoint verifies email+code, sets the new password, and revokes every live refresh token in one `SaveChanges`. `mint-reset.sh <email>` is the operator interface; a shared lowercase-hex encoding (pinned by a test vector in both C# and the script) keeps the two sides honest. A later email slice adds only a request endpoint.

**Tech Stack:** .NET 10 (EF Core, FluentValidation, built-in rate limiter policy "auth"), xUnit + Testcontainers (Docker required); Expo RN frontend (one new screen). Spec: `docs/superpowers/specs/2026-08-03-password-reset-design.md`.

## Global Constraints

- Code format: `JoinCodeGenerator` alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, canonical 6 chars, `ABC-DEF` display, `Canonicalize` on input. TTL 60 minutes.
- Hash encoding: lowercase-hex SHA-256 of the canonical code. Pinned test vector, identical in C# test and script comment: `sha256("ABC234") = 8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4`.
- Every code-path failure (wrong email, wrong/expired/used/raced code) → the same bare HTTP **403**; validation (empty fields, password <8 or >128) → 400. Success → **204**, no auto-login.
- A successful reset revokes ALL of the user's live refresh tokens in the same `SaveChanges` that consumes the code.
- i18n (both `nb.json`/`en.json`, exact — the spec's decision-6 table governs): `account.forgotPassword` "Glemt passord?"/"Forgot password?"; `resetTitle` "Tilbakestill passord"/"Reset password"; `resetHint` "Be om en tilbakestillingskode og skriv den inn her innen én time."/"Ask for a reset code and enter it here within one hour."; `resetCode` "Tilbakestillingskode"/"Reset code"; `newPassword` "Nytt passord"/"New password"; `resetSubmit` "Sett nytt passord"/"Set new password"; `resetDone` "Passordet er endret — logg inn."/"Password changed — sign in."; `errors.resetInvalid` "Ugyldig eller utløpt kode."/"Invalid or expired code.".
- Backend gate: `dotnet test` from `backend/` (Docker running; currently 151 green). Frontend gates from `frontend/`: `npx jest`, `npx tsc --noEmit`, `npm run lint` (10-file prettier baseline; changed files clean).
- Commit prefixes house style; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Git from repo root.

---

### Task 1: Backend — PasswordResetCode + reset endpoint

**Files:**
- Create: `backend/Ingredo.Api/Domain/PasswordResetCode.cs`
- Modify: `backend/Ingredo.Api/Data/AppDbContext.cs` (+DbSet, +config)
- Create: migration via `dotnet ef migrations add AddPasswordResetCodes` (from `backend/Ingredo.Api/`)
- Modify: `backend/Ingredo.Api/Auth/AuthDtos.cs`, `AuthValidators.cs`, `IAuthService.cs`, `AuthService.cs`, `AuthController.cs`
- Create: `backend/Ingredo.Api.Tests/Auth/PasswordResetCodeTests.cs` (hash-vector unit test)
- Modify: `backend/Ingredo.Api.Tests/Integration/ApiClientExtensions.cs` (+`MintResetCodeAsync`)
- Create: `backend/Ingredo.Api.Tests/Integration/PasswordResetTests.cs`

**Interfaces:**
- Produces: `POST /api/v1/auth/reset-password` (`{ email, code, newPassword }` → 204/403/400); `PasswordResetCode.HashCode(string canonical): string` (lowercase hex); `factory.MintResetCodeAsync(Guid userId, TimeSpan? ttl = null): Task<string>` returning the canonical code. Task 2's script must match the hash encoding and table identifiers; Task 3's app calls the endpoint.

- [ ] **Step 1: Write `backend/Ingredo.Api/Domain/PasswordResetCode.cs`:**

```csharp
using System.Security.Cryptography;
using System.Text;

namespace Ingredo.Api.Domain;

// Operator-delivered password reset: single-use, 60-minute TTL. Only the
// SHA-256 of the code is stored — a live reset code is an account-takeover
// secret, unlike invite codes. UsedAt is the concurrency token (InviteCode
// precedent); UserId has deliberately NO foreign key (RefreshToken
// precedent: bookkeeping must never block or cascade user deletion).
public class PasswordResetCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string CodeHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }

    // Lowercase hex so the operator script's `sha256sum` output matches
    // byte-for-byte. Test vector: HashCode("ABC234") =
    // "8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4".
    public static string HashCode(string canonicalCode) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalCode)));
}
```

- [ ] **Step 2: Hash-vector unit test** at `backend/Ingredo.Api.Tests/Auth/PasswordResetCodeTests.cs` (namespace/style per the existing files in that folder):

```csharp
using Ingredo.Api.Domain;

namespace Ingredo.Api.Tests.Auth;

public sealed class PasswordResetCodeTests
{
    [Fact]
    public void HashCode_MatchesTheOperatorScriptEncoding() =>
        Assert.Equal(
            "8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4",
            PasswordResetCode.HashCode("ABC234"));
}
```

Run: `cd backend && dotnet test --filter "FullyQualifiedName~PasswordResetCodeTests"` → PASS (entity compiles standalone; this pins the encoding before anything depends on it).

- [ ] **Step 3: Register the entity.** `AppDbContext.cs`: add the `PasswordResetCodes` DbSet beside the others (match the file's property style) and in `OnModelCreating`:

```csharp
        modelBuilder.Entity<PasswordResetCode>(reset =>
        {
            reset.Property(r => r.CodeHash).HasMaxLength(64);
            reset.HasIndex(r => r.CodeHash).IsUnique();
            reset.HasIndex(r => r.UserId);
            reset.Property(r => r.UsedAt).IsConcurrencyToken();
        });
```

Then: `cd backend/Ingredo.Api && dotnet ef migrations add AddPasswordResetCodes`. Inspect `Up()`: one CreateTable + two indexes (unique on CodeHash, plain on UserId), nothing else.

- [ ] **Step 4: Failing integration tests.** Add to `ApiClientExtensions.cs`:

```csharp
    // Inserts a hashed reset code for the user — the operator mint step,
    // minus the shell script. Returns the canonical code.
    public static async Task<string> MintResetCodeAsync(
        this ApiFactory factory, Guid userId, TimeSpan? ttl = null)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var code = JoinCodeGenerator.NewCode();
        db.PasswordResetCodes.Add(new PasswordResetCode
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CodeHash = PasswordResetCode.HashCode(code),
            CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.Add(ttl ?? TimeSpan.FromMinutes(60)),
        });
        await db.SaveChangesAsync();
        return code;
    }
```

New file `backend/Ingredo.Api.Tests/Integration/PasswordResetTests.cs` (collection-fixture signature per `AuthApiTests.cs`; adapt `AuthResponse` property access — user id/email/refresh token — to the shapes that file already uses):

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Integration;

[Collection(ApiTestCollection.Name)]
public sealed class PasswordResetTests(ApiFactory factory)
{
    [Fact]
    public async Task Reset_WithValidCode_SetsPasswordAndRevokesSessions()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var email = auth.User.Email;
        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password", new
        {
            email,
            code = JoinCodeGenerator.FormatForDisplay(code),
            newPassword = "nyttpassord123",
        });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var oldLogin = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = "passord123" });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);

        var newLogin = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = "nyttpassord123" });
        newLogin.EnsureSuccessStatusCode();

        var refresh = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = auth.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task Reset_CodeIsSingleUse()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "enda-et-passord1" });
        Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
    }

    [Fact]
    public async Task Reset_ExpiredCode_Is403AndPasswordUnchanged()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id, TimeSpan.FromMinutes(-1));
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.Forbidden, reset.StatusCode);

        var login = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = auth.User.Email, password = "passord123" });
        login.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Reset_WrongEmailWithLiveCode_Is403()
    {
        var (_, kari) = await factory.RegisterUserAsync("Kari");
        var (_, ola) = await factory.RegisterUserAsync("Ola");
        var code = await factory.MintResetCodeAsync(kari.User.Id);
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = ola.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.Forbidden, reset.StatusCode);
    }

    [Fact]
    public async Task Reset_RacingTheSameCode_AdmitsExactlyOne()
    {
        var (_, auth) = await factory.RegisterUserAsync("Racer");
        var code = await factory.MintResetCodeAsync(auth.User.Id);

        async Task<HttpStatusCode> Attempt(string password)
        {
            using var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
                new { email = auth.User.Email, code, newPassword = password });
            return response.StatusCode;
        }

        var results = await Task.WhenAll(Attempt("racerpassordA1"), Attempt("racerpassordB2"));
        Assert.Single(results, s => s == HttpStatusCode.NoContent);
        Assert.Single(results, s => s == HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Reset_WeakPassword_400AndCodeNotConsumed()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var weak = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "kort" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var retry = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    }
}
```

- [ ] **Step 5: Run to verify failure**

Run: `cd backend && dotnet test --filter "FullyQualifiedName~PasswordResetTests"`
Expected: FAIL — 404 on the endpoint (doesn't exist).

- [ ] **Step 6: Implement.** `AuthDtos.cs`:

```csharp
public sealed record ResetPasswordRequest(string Email, string Code, string NewPassword);
```

`AuthValidators.cs`:

```csharp
public sealed class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty();
        RuleFor(r => r.Code).NotEmpty();
        // Same length-only policy as registration (NIST-style guidance).
        RuleFor(r => r.NewPassword).NotEmpty().MinimumLength(8).MaximumLength(128);
    }
}
```

`IAuthService.cs`: add `Task<ServiceResult<bool>> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken);`

`AuthService.cs`:

```csharp
    public async Task<ServiceResult<bool>> ResetPasswordAsync(
        ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        // Every failure below returns the same bare Forbidden: wrong email,
        // wrong/expired/used/raced code must be indistinguishable from
        // outside — no oracle for account existence or code state.
        var canonical = JoinCodeGenerator.Canonicalize(request.Code);
        if (canonical is null) return ServiceResult<bool>.Forbidden();

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null) return ServiceResult<bool>.Forbidden();

        var now = DateTimeOffset.UtcNow;
        var hash = PasswordResetCode.HashCode(canonical);
        var reset = await db.PasswordResetCodes.FirstOrDefaultAsync(
            r => r.UserId == user.Id && r.CodeHash == hash
                && r.UsedAt == null && r.ExpiresAt > now,
            cancellationToken);
        if (reset is null) return ServiceResult<bool>.Forbidden();

        user.PasswordHash = passwordHasher.HashPassword(user, request.NewPassword);
        user.UpdatedAt = now;
        reset.UsedAt = now;

        // A reset means the old credential may be compromised: sign the
        // account out everywhere. Tracked updates (not ExecuteUpdate) so the
        // revocation commits atomically with the code consumption.
        var liveTokens = await db.RefreshTokens
            .Where(t => t.UserId == user.Id && t.RevokedAt == null)
            .ToListAsync(cancellationToken);
        foreach (var token in liveTokens)
        {
            token.RevokedAt = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two resets raced one code; the other one won.
            return ServiceResult<bool>.Forbidden();
        }

        return ServiceResult<bool>.Ok(true);
    }
```

`AuthController.cs`: inject `IValidator<ResetPasswordRequest> resetValidator` in the primary constructor and add (matching however the invite slice's Register maps `ServiceStatus.Forbidden` to 403 — reuse that exact idiom):

```csharp
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        var validation = await resetValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.ResetPasswordAsync(request, cancellationToken);
        return result.Status == ServiceStatus.Forbidden
            ? StatusCode(StatusCodes.Status403Forbidden)
            : NoContent();
    }
```

(using `Microsoft.AspNetCore.RateLimiting` if not already imported.)

- [ ] **Step 7: Full backend suite**

Run: `cd backend && dotnet test`
Expected: 158 green (151 + 1 unit + 6 integration).

- [ ] **Step 8: Commit**

```bash
git add backend/Ingredo.Api backend/Ingredo.Api.Tests
git commit -m "feat: password reset via single-use hashed codes"
```

---

### Task 2: mint-reset.sh + production docs

**Files:**
- Create: `backend/deploy/mint-reset.sh` (mode 755)
- Modify: `backend/README.md` (Production section, after the Invite codes subsection)

**Interfaces:**
- Consumes: Task 1's table (`"PasswordResetCodes"` with `"Id"`, `"UserId"`, `"CodeHash"`, `"CreatedAt"`, `"ExpiresAt"`, `"UsedAt"`) and the pinned hash encoding.

- [ ] **Step 1: Write `backend/deploy/mint-reset.sh`:**

```bash
#!/usr/bin/env bash
# Mint a single-use password-reset code (60-minute TTL) for one user of the
# ingredo-prod database and print it for hand-off. Only the SHA-256 hex of
# the code is stored (see Domain/PasswordResetCode.cs — pinned vector:
# sha256("ABC234") = 8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4).
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: mint-reset.sh <email>" >&2
  exit 1
fi

EMAIL="$1"
CONTAINER="${CONTAINER:-ingredo-prod-postgres-1}"
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'

NORMALIZED=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)
case "$NORMALIZED" in
  *"'"* )
    echo "invalid email" >&2
    exit 1
    ;;
esac

USER_ID=$(docker exec "$CONTAINER" psql -U ingredo -d ingredo -At -c \
  "SELECT \"Id\" FROM \"Users\" WHERE \"NormalizedEmail\" = '$NORMALIZED';")
if [ -z "$USER_ID" ]; then
  echo "No user with email: $EMAIL" >&2
  exit 1
fi

code=''
for _ in $(seq 1 6); do
  idx=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % ${#ALPHABET} ))
  code+="${ALPHABET:idx:1}"
done
hash=$(printf '%s' "$code" | sha256sum | cut -d' ' -f1)

docker exec "$CONTAINER" psql -U ingredo -d ingredo -q -c \
  "INSERT INTO \"PasswordResetCodes\" (\"Id\", \"UserId\", \"CodeHash\", \"CreatedAt\", \"ExpiresAt\") VALUES (gen_random_uuid(), '$USER_ID', '$hash', now(), now() + interval '60 minutes');"

echo "Reset code for $EMAIL (valid 60 minutes, single-use):"
echo "  ${code:0:3}-${code:3}"
echo "Outstanding codes: docker exec $CONTAINER psql -U ingredo -d ingredo -c 'SELECT \"UserId\", \"CreatedAt\", \"ExpiresAt\", \"UsedAt\" FROM \"PasswordResetCodes\" ORDER BY \"CreatedAt\" DESC LIMIT 10;'"
```

- [ ] **Step 2: Verify.** `chmod +x backend/deploy/mint-reset.sh && bash -n backend/deploy/mint-reset.sh` (silent). Identifier check: `grep -n 'PasswordResetCodes\|CodeHash\|ExpiresAt\|NormalizedEmail' backend/Ingredo.Api/Data/Migrations/*AddPasswordResetCodes.cs backend/Ingredo.Api/Data/Migrations/AppDbContextModelSnapshot.cs | head` — quoted SQL names must match exactly ("Users"/"NormalizedEmail" come from the existing schema; confirm casing in the snapshot). Scratch verification (NO docker lines) in `/tmp/claude-1000/`: argument guard rejects 0 and 2 args and a quote-bearing email; `printf '%s' "ABC234" | sha256sum | cut -d' ' -f1` equals the pinned vector exactly.

- [ ] **Step 3: Document.** In `backend/README.md`, directly after the "Invite codes" subsection:

```markdown
### Password resets

A locked-out tester messages the operator; mint them a code:

```bash
~/srv/ingredo/backend/deploy/mint-reset.sh tester@example.com   # prints ABC-DEF
```

The code is single-use, dies after 60 minutes, and only its hash is stored.
The tester enters it under "Glemt passord?" on the sign-in screen with their
new password. A successful reset signs their account out of every device.
```

- [ ] **Step 4: Commit**

```bash
git add backend/deploy/mint-reset.sh backend/README.md
git commit -m "feat: operator script to mint password-reset codes"
```

---

### Task 3: Frontend — reset screen, sign-in link, strings

**Files:**
- Modify: `frontend/lib/api/auth.ts` (+`resetPassword`)
- Create: `frontend/app/account/reset.tsx`
- Modify: `frontend/app/account/sign-in.tsx` (forgot link + success notice)
- Modify: `frontend/lib/i18n/nb.json` / `en.json` (Global Constraints table)
- Test: `frontend/__tests__/api-auth.test.ts`, `frontend/__tests__/account-screens.test.tsx`
- Modify: `docs/TESTING.md` (append manual pass)

**Interfaces:**
- Consumes: Task 1's endpoint contract (204/403/400); the `Input` `secureToggle` prop; `ApiError`/`NetworkError`.
- Produces: `resetPassword(email: string, code: string, newPassword: string): Promise<void>`.

- [ ] **Step 1: i18n.** Add the eight keys from Global Constraints to BOTH locales (`errors.resetInvalid` inside `account.errors`, the rest inside `account`).

- [ ] **Step 2: Failing tests.** `api-auth.test.ts` — import `resetPassword` and add:

```ts
  it('resetPassword posts the reset body without auth', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);

    await resetPassword('kari@example.test', 'abc-def', 'nyttpassord123');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/reset-password', {
      method: 'POST',
      body: { email: 'kari@example.test', code: 'abc-def', newPassword: 'nyttpassord123' },
      skipAuth: true,
    });
  });
```

`account-screens.test.tsx` — three mock-layer edits first: (1) add `resetPassword: jest.fn(),` to the `jest.mock('../lib/api/auth', …)` factory, import it, and add `const resetPasswordMock = resetPassword as jest.Mock;`; (2) extend the `expo-router` mock factory with `replace` and `useLocalSearchParams`:

```tsx
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockSearchParams,
}));
```

(keeping whatever the current factory already exposes; reset `mockSearchParams = {};` in the top-level `beforeEach`); (3) `import ResetScreen from '../app/account/reset';`. Then the new tests:

```tsx
describe('ResetScreen', () => {
  const fillValid = () => {
    fireEvent.changeText(screen.getByTestId('reset-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('reset-code'), 'ABC-DEF');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'nyttpassord123');
    fireEvent.changeText(screen.getByTestId('reset-confirm'), 'nyttpassord123');
  };

  it('submits and lands back on sign-in with the done flag', async () => {
    resetPasswordMock.mockResolvedValueOnce(undefined);
    render(<ResetScreen />);

    fillValid();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Set new password' }));
    });

    expect(resetPasswordMock).toHaveBeenCalledWith(
      'kari@example.test', 'ABC-DEF', 'nyttpassord123');
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/account/sign-in',
      params: { reset: 'done' },
    });
  });

  it('blocks mismatched passwords without calling the API', async () => {
    render(<ResetScreen />);

    fillValid();
    fireEvent.changeText(screen.getByTestId('reset-confirm'), 'noe-annet-1');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Set new password' }));
    });

    expect(resetPasswordMock).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeOnTheScreen();
  });

  it('maps a rejected code to its own error', async () => {
    resetPasswordMock.mockRejectedValueOnce(new ApiError(403, null));
    render(<ResetScreen />);

    fillValid();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Set new password' }));
    });

    expect(screen.getByText('Invalid or expired code.')).toBeOnTheScreen();
  });
});
```

and inside `describe('SignInScreen', …)`:

```tsx
  it('links to the reset screen', () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('Forgot password?'));
    expect(mockPush).toHaveBeenCalledWith('/account/reset');
  });

  it('shows the reset-done notice when arriving from a reset', () => {
    mockSearchParams = { reset: 'done' };
    render(<SignInScreen />);
    expect(screen.getByText('Password changed — sign in.')).toBeOnTheScreen();
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx jest __tests__/api-auth.test.ts __tests__/account-screens.test.tsx`
Expected: FAIL — no `resetPassword` export, no reset module, no link.

- [ ] **Step 4: Implement.** `lib/api/auth.ts`:

```ts
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
```

`app/account/reset.tsx` (mirrors the register screen's structure and error idiom):

```tsx
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { resetPassword } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { t } from '../../lib/i18n';

export default function ResetScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password !== confirm) {
      setError(t('account.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      router.replace({ pathname: '/account/sign-in', params: { reset: 'done' } });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setError(t('account.errors.resetInvalid'));
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
      <Text className="mb-2 font-display text-xl text-ink">{t('account.resetTitle')}</Text>
      <Text className="mb-6 font-body text-sm text-ink opacity-80">{t('account.resetHint')}</Text>
      <Input
        testID="reset-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="reset-code"
        label={t('account.resetCode')}
        value={code}
        onChangeText={setCode}
        placeholder="ABC-DEF"
        autoCapitalize="characters"
        className="mb-4"
      />
      <Input
        testID="reset-password"
        label={t('account.newPassword')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="reset-confirm"
        label={t('account.confirmPassword')}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.resetSubmit')} onPress={submit} disabled={busy} />
    </View>
  );
}
```

`app/account/sign-in.tsx`: add `useLocalSearchParams` to the expo-router import; inside the component `const params = useLocalSearchParams<{ reset?: string }>();`; directly above the error line render:

```tsx
      {params.reset === 'done' ? (
        <View className="mb-3 rounded-card bg-sage px-4 py-3">
          <Text className="font-body text-sm text-cream">{t('account.resetDone')}</Text>
        </View>
      ) : null}
```

and below the existing "New here?" pressable add:

```tsx
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/account/reset')}
        className="mt-3 items-center">
        <Text className="font-body text-sm text-ink underline">
          {t('account.forgotPassword')}
        </Text>
      </Pressable>
```

(The route file exists by this step, so typed routes should accept `'/account/reset'`; if `npx tsc --noEmit` still complains about the route string, run `npx expo start` once to regenerate the gitignored typed-routes file — known quirk, see the TESTING.md habits note — and re-run tsc.)

- [ ] **Step 5: Run the gates**

Run: `cd frontend && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green (~490 tests: 484 + 6 new).

- [ ] **Step 6: Append to `docs/TESTING.md`** (end of file):

```markdown
## Password reset (manual pass)

- Sign-in → "Glemt passord?" → the reset screen renders with email, code and
  two password fields.
- Mint a code for a test account (`mint-reset.sh <email>`), enter it with a
  new password → back on sign-in with "Passordet er endret — logg inn."; the
  old password fails, the new one signs in.
- The other signed-in device for that account stops syncing (sessions
  revoked) and must sign in again.
- Reusing the same code → "Ugyldig eller utløpt kode."; a code older than an
  hour behaves the same.
```

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/auth.ts frontend/app/account/reset.tsx frontend/app/account/sign-in.tsx frontend/lib/i18n/nb.json frontend/lib/i18n/en.json frontend/__tests__/api-auth.test.ts frontend/__tests__/account-screens.test.tsx docs/TESTING.md
git commit -m "feat: in-app password reset with operator-minted codes"
```

---

## Post-merge rollout (operator checklist — not plan tasks)

1. Merge → push develop → ff master → push → `deploy.sh` (additive migration, zero user impact).
2. `npm run publish:beta` — the reset flow reaches phones OTA.
3. Nothing to mint until someone is actually locked out; then `mint-reset.sh <their-email>` and message them the code.
