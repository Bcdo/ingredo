# Public-Exposure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invite-gated registration (10 single-use codes for beta testers), rate limiting on sensitive endpoints, and authenticated-by-default authorization — closing the real gaps now that the API is public at `https://api.kodesmien.no`.

**Architecture:** New `InviteCodes` table with a `UsedAt` concurrency token; registration checks the invite before anything else and consumes it in the same `SaveChanges` that creates the user. ASP.NET's built-in rate limiter partitions by `CF-Connecting-IP` (trustworthy: the origin is tunnel-only). A `FallbackPolicy` makes authentication the default; the four anonymous auth endpoints and `/health` opt out explicitly. An operator script mints codes into the prod database.

**Tech Stack:** .NET 10 (EF Core migrations, `Microsoft.AspNetCore.RateLimiting` — built in, no new packages), xUnit + Testcontainers (Docker required for `dotnet test`); Expo RN frontend (one new field + strings). Spec: `docs/superpowers/specs/2026-08-03-hardening-design.md`.

## Global Constraints

- Invite code alphabet/format: `JoinCodeGenerator.Alphabet` = `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 6 chars canonical, `ABC-DEF` for display; canonicalization via `JoinCodeGenerator.Canonicalize` (tolerates case/spaces/hyphen).
- Check order in registration: invite validity FIRST, email-taken second. A failed registration never consumes a code.
- Invalid/used/raced invite → HTTP **403**. Rate-limit rejection → HTTP **429** + `Retry-After`.
- Production limits: auth policy 10/min per client, global 300/min per client; `/health` and `/hubs` exempt. Limits configurable under `RateLimiting:Auth:PermitLimit` / `RateLimiting:Global:PermitLimit`.
- i18n (both `nb.json` and `en.json`, exact): `account.inviteCode` "Invitasjonskode"/"Invite code"; `account.errors.inviteInvalid` "Ugyldig invitasjonskode."/"That invite code isn't valid.".
- Backend gate: `dotnet test` from `backend/` (Docker running; currently 142 green). Frontend gates from `frontend/`: `npx jest`, `npx tsc --noEmit`, `npm run lint` (10-file prettier-drift baseline accepted; changed files clean).
- Commit prefixes house style; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Git from repo root.

---

### Task 1: InviteCode entity + invite-gated registration

**Files:**
- Create: `backend/Ingredo.Api/Domain/InviteCode.cs`
- Modify: `backend/Ingredo.Api/Data/AppDbContext.cs` (+DbSet, +entity config)
- Create: migration via `dotnet ef migrations add AddInviteCodes` (from `backend/Ingredo.Api/`)
- Modify: `backend/Ingredo.Api/Common/ServiceResult.cs` (+`Forbidden`)
- Modify: `backend/Ingredo.Api/Auth/AuthDtos.cs`, `AuthValidators.cs`, `AuthService.cs`, `AuthController.cs`
- Modify: `backend/Ingredo.Api.Tests/Integration/ApiClientExtensions.cs` (+`MintInviteCodeAsync`, helpers pass codes)
- Modify: `backend/Ingredo.Api.Tests/Integration/AuthApiTests.cs` (existing register posts gain codes; new invite tests)

**Interfaces:**
- Produces: `POST /api/v1/auth/register` requires `inviteCode` (400 when missing, 403 when unknown/used/raced); `factory.MintInviteCodeAsync()` returns a canonical unused code (Task 2's tests and every existing helper use it); `ServiceStatus.Forbidden`. Task 4's frontend sends `inviteCode`.

- [ ] **Step 1: Write `backend/Ingredo.Api/Domain/InviteCode.cs`:**

```csharp
namespace Ingredo.Api.Domain;

// Single-use beta gate: one code admits exactly one registration. UsedAt is
// the concurrency token, so two racing registrations cannot both stamp the
// same code. Deliberately NO foreign key on UsedByUserId (RefreshToken
// precedent): audit bookkeeping must never block or cascade user deletion.
public class InviteCode
{
    public Guid Id { get; set; }
    public required string Code { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public Guid? UsedByUserId { get; set; }
}
```

- [ ] **Step 2: Register it in `AppDbContext.cs`.** Add `public DbSet<InviteCode> InviteCodes => Set<InviteCode>();` beside the other DbSets (match the file's property style — if the others use `{ get; set; }` auto-properties, use that instead), and in `OnModelCreating`, following the existing per-entity block style:

```csharp
        modelBuilder.Entity<InviteCode>(invite =>
        {
            invite.Property(i => i.Code).HasMaxLength(16);
            invite.HasIndex(i => i.Code).IsUnique();
            invite.Property(i => i.UsedAt).IsConcurrencyToken();
        });
```

- [ ] **Step 3: Generate the migration**

Run: `cd backend/Ingredo.Api && dotnet ef migrations add AddInviteCodes`
Expected: new files under `Data/Migrations/` creating the `InviteCodes` table with the unique `Code` index. Inspect the generated `Up()`: it must create the table and unique index and nothing else.

- [ ] **Step 4: Add `Forbidden` to `ServiceResult.cs`:** extend the enum with `Forbidden,` after `Invalid,` and add the factory `public static ServiceResult<T> Forbidden() => new(ServiceStatus.Forbidden, default);`.

- [ ] **Step 5: Failing tests.** First update the two helpers in `ApiClientExtensions.cs` — add the mint helper and route both register helpers through it:

```csharp
    // Inserts an unused invite code directly into the test database — the
    // operator-side mint step, minus the shell script.
    public static async Task<string> MintInviteCodeAsync(this ApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var code = JoinCodeGenerator.NewCode();
        db.InviteCodes.Add(new InviteCode
        {
            Id = Guid.NewGuid(),
            Code = code,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return code;
    }
```

(add `using Ingredo.Api.Data;`, `using Ingredo.Api.Domain;`, `using Ingredo.Api.Households;`, `using Microsoft.Extensions.DependencyInjection;` as needed), and in BOTH `CreateAuthenticatedClientAsync` and `RegisterUserAsync`, mint first and pass the code:

```csharp
        var invite = await factory.MintInviteCodeAsync();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", "Test Bruker", InviteCode: invite);
```

(`RegisterUserAsync` keeps its `displayName` parameter in place of the literal.) Then in `AuthApiTests.cs`: every existing direct register post (including the three `householdName` tests from the beta-polish slice and any older ones posting anonymous objects) gains `inviteCode = await factory.MintInviteCodeAsync(),` in its payload. Then add the new tests:

```csharp
    [Fact]
    public async Task Register_WithoutInviteCode_IsRejected()
    {
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"nocode-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_WithUnknownInviteCode_Is403AndCreatesNoUser()
    {
        using var client = factory.CreateClient();
        var email = $"unknown-{Guid.NewGuid():N}@test.local";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email,
            password = "passord123",
            displayName = "Kari",
            inviteCode = "ZZZ-ZZZ",
        });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "passord123" });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task Register_ConsumesTheCode_SoReuseIs403()
    {
        var code = await factory.MintInviteCodeAsync();
        using var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"first-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        first.EnsureSuccessStatusCode();

        var second = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"second-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Ola",
            inviteCode = code,
        });
        Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
    }

    [Fact]
    public async Task Register_EmailConflict_DoesNotConsumeTheCode()
    {
        var (_, existing) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintInviteCodeAsync();
        using var client = factory.CreateClient();

        var conflict = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = existing.User.Email,
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);

        var retry = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"fresh-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        retry.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Register_RacingTheSameCode_AdmitsExactlyOne()
    {
        var code = await factory.MintInviteCodeAsync();

        async Task<HttpStatusCode> Attempt(string tag)
        {
            using var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
            {
                email = $"race-{tag}-{Guid.NewGuid():N}@test.local",
                password = "passord123",
                displayName = "Racer",
                inviteCode = code,
            });
            return response.StatusCode;
        }

        var results = await Task.WhenAll(Attempt("a"), Attempt("b"));
        Assert.Single(results.Where(s => s == HttpStatusCode.Created));
        Assert.Single(results.Where(s => s == HttpStatusCode.Forbidden));
    }
```

(Adjust `existing.User.Email` access to the `AuthResponse` shape the file already uses.)

- [ ] **Step 6: Run to verify failure**

Run: `cd backend && dotnet test --filter "FullyQualifiedName~AuthApiTests"`
Expected: new tests FAIL (unknown `inviteCode` ignored, registrations succeed); the without-code test fails (201 instead of 400).

- [ ] **Step 7: Implement.** `AuthDtos.cs`:

```csharp
public sealed record RegisterRequest(
    string Email, string Password, string DisplayName,
    string? HouseholdName = null, string? InviteCode = null);
```

`AuthValidators.cs` — add to `RegisterRequestValidator`'s constructor:

```csharp
        RuleFor(r => r.InviteCode).NotEmpty();
```

`AuthService.RegisterAsync` — insert at the very top, BEFORE the email check (invite-first ordering is deliberate: without a live code you cannot probe which emails exist):

```csharp
        var canonicalInvite = JoinCodeGenerator.Canonicalize(request.InviteCode ?? string.Empty);
        if (canonicalInvite is null) return ServiceResult<AuthResponse>.Forbidden();
        var invite = await db.InviteCodes.FirstOrDefaultAsync(
            i => i.Code == canonicalInvite && i.UsedAt == null, cancellationToken);
        if (invite is null) return ServiceResult<AuthResponse>.Forbidden();
```

then, next to where the user/household/membership rows are added (before the save that persists them):

```csharp
        invite.UsedAt = now;
        invite.UsedByUserId = user.Id;
```

and wrap the method's `SaveChanges` call so a lost race maps to the same 403:

```csharp
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two registrations raced one code; the other one won.
            return ServiceResult<AuthResponse>.Forbidden();
        }
```

(If `RegisterAsync` saves more than once, the guard wraps the save that persists the invite stamp; read the method and place it accordingly.) `AuthController.Register` — extend the result mapping:

```csharp
        return result.Status switch
        {
            ServiceStatus.Conflict => Conflict(),
            ServiceStatus.Forbidden => Forbid(),
            _ => StatusCode(StatusCodes.Status201Created, result.Value),
        };
```

Note: `Forbid()` with JWT bearer returns 403 via the authentication handler's forbid flow. If the integration tests see anything other than a bare 403 (e.g., a challenge header quirk), use `StatusCode(StatusCodes.Status403Forbidden)` instead — behavior over idiom.

- [ ] **Step 8: Full backend suite**

Run: `cd backend && dotnet test`
Expected: all green — 142 existing (now minting codes through the helpers) + 5 new = 147.

- [ ] **Step 9: Commit**

```bash
git add backend/Ingredo.Api backend/Ingredo.Api.Tests
git commit -m "feat: gate registration behind single-use invite codes"
```

---

### Task 2: Rate limiting + fallback authorization

**Files:**
- Modify: `backend/Ingredo.Api/Program.cs` (rate limiter registration + middleware + anonymous endpoint metadata)
- Modify: `backend/Ingredo.Api/Auth/AuthSetupExtensions.cs` (fallback policy)
- Modify: `backend/Ingredo.Api/Auth/AuthController.cs` (+`[EnableRateLimiting("auth")]` on Register and Login)
- Modify: `backend/Ingredo.Api/Households/HouseholdController.cs` (+`[EnableRateLimiting("auth")]` on Join and Leave)
- Modify: `backend/Ingredo.Api.Tests/Integration/ApiFactory.cs` (high default limits for the suite)
- Create: `backend/Ingredo.Api.Tests/Integration/SecurityTests.cs`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the suite's minting helpers.
- Produces: policy name `"auth"`; config keys `RateLimiting:Auth:PermitLimit` / `RateLimiting:Global:PermitLimit`; `/health` stays anonymous.

- [ ] **Step 1: Failing tests.** `backend/Ingredo.Api.Tests/Integration/SecurityTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;

namespace Ingredo.Api.Tests.Integration;

[Collection(ApiTestCollection.Name)]
public sealed class SecurityTests(ApiFactory factory)
{
    [Fact]
    public async Task Login_IsRateLimited_PerClient()
    {
        using var limited = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("RateLimiting:Auth:PermitLimit", "2"));
        using var client = limited.CreateClient();
        var body = new { email = "nobody@test.local", password = "wrong-password" };

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/login", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/login", body)).StatusCode);

        var third = await client.PostAsJsonAsync("/api/v1/auth/login", body);
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.True(third.Headers.Contains("Retry-After"));
    }

    [Fact]
    public async Task Health_StaysAnonymousAndUnlimited()
    {
        using var limited = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("RateLimiting:Global:PermitLimit", "1"));
        using var client = limited.CreateClient();

        for (var i = 0; i < 5; i++)
        {
            var response = await client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task DataEndpoint_WithoutToken_Is401()
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/v1/recipes");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
```

(Match the file's collection-fixture idiom to how `AuthApiTests.cs` declares it — copy its class signature style verbatim.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && dotnet test --filter "FullyQualifiedName~SecurityTests"`
Expected: rate-limit test FAILS (three 401s, never 429). The 401 and health tests may already pass — that's fine; they pin behavior the fallback-policy change could silently alter.

- [ ] **Step 3: Implement the limiter in `Program.cs`.** After the `AddHealthChecks` line:

```csharp
builder.Services.AddRateLimiter(options =>
{
    var authLimit = builder.Configuration.GetValue("RateLimiting:Auth:PermitLimit", 10);
    var globalLimit = builder.Configuration.GetValue("RateLimiting:Global:PermitLimit", 300);

    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = (context, _) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        return ValueTask.CompletedTask;
    };

    // Behind the tunnel every socket peer is cloudflared; the real client
    // is CF-Connecting-IP, and the origin is reachable ONLY through the
    // tunnel, so the header cannot be spoofed from outside.
    static string ClientKey(HttpContext context) =>
        context.Request.Headers["CF-Connecting-IP"].FirstOrDefault()
        ?? context.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/health") || path.StartsWithSegments("/hubs"))
        {
            return RateLimitPartition.GetNoLimiter("exempt");
        }
        return RateLimitPartition.GetFixedWindowLimiter(ClientKey(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = globalLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });

    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(ClientKey(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});
```

(usings: `System.Threading.RateLimiting` and `Microsoft.AspNetCore.RateLimiting`.) In the pipeline, directly after `app.UseSerilogRequestLogging();`:

```csharp
app.UseRateLimiter();
```

and mark the exempt/anonymous endpoint mappings:

```csharp
app.MapHealthChecks("/health").AllowAnonymous();
```

plus, inside the existing dev-only gate, append `.AllowAnonymous()` to both `app.MapOpenApi()` and `app.MapScalarApiReference()`.

- [ ] **Step 4: Attribute the sensitive endpoints.** `[EnableRateLimiting("auth")]` (using `Microsoft.AspNetCore.RateLimiting`) on: `AuthController.Register`, `AuthController.Login`, `HouseholdController.Join`, `HouseholdController.Leave`.

- [ ] **Step 5: Fallback policy in `AuthSetupExtensions.cs`.** Replace `services.AddAuthorization();` with:

```csharp
        services.AddAuthorization(options =>
        {
            // Authenticated-by-default: an endpoint that forgets [Authorize]
            // is closed, not open. Anonymous endpoints opt out explicitly.
            options.FallbackPolicy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
        });
```

(using `Microsoft.AspNetCore.Authorization`.)

- [ ] **Step 6: Give the test suite headroom.** In `ApiFactory.ConfigureWebHost`, add:

```csharp
        builder.UseSetting("RateLimiting:Auth:PermitLimit", "100000");
        builder.UseSetting("RateLimiting:Global:PermitLimit", "100000");
```

(`WithWebHostBuilder` overrides applied by individual tests win over these because they are applied later in the configuration chain — the SecurityTests rely on that.)

- [ ] **Step 7: Full backend suite**

Run: `cd backend && dotnet test`
Expected: all green — 147 + 3 = 150. Watch specifically for realtime/SignalR tests (hub exempt from limiting, still authenticated) and health checks.

- [ ] **Step 8: Commit**

```bash
git add backend/Ingredo.Api backend/Ingredo.Api.Tests
git commit -m "feat: rate-limit sensitive endpoints and require auth by default"
```

---

### Task 3: mint-invites.sh + production docs

**Files:**
- Create: `backend/deploy/mint-invites.sh` (mode 755)
- Modify: `backend/README.md` (Production section)

**Interfaces:**
- Consumes: the `InviteCodes` table (Task 1) and prod container `ingredo-prod-postgres-1` naming.

- [ ] **Step 1: Write `backend/deploy/mint-invites.sh`:**

```bash
#!/usr/bin/env bash
# Mint N single-use invite codes (default 10) into the ingredo-prod database
# and print them in hand-out form. Re-runnable: a colliding code is skipped,
# not overwritten. Uses the same I/L/O/0/1-free alphabet as join codes.
set -euo pipefail

N="${1:-10}"
CONTAINER="${CONTAINER:-ingredo-prod-postgres-1}"
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'

codes=()
for _ in $(seq 1 "$N"); do
  code=''
  for _ in $(seq 1 6); do
    idx=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % ${#ALPHABET} ))
    code+="${ALPHABET:idx:1}"
  done
  codes+=("$code")
done

values=$(printf "(gen_random_uuid(), '%s', now())," "${codes[@]}")
docker exec "$CONTAINER" psql -U ingredo -d ingredo -q -c \
  "INSERT INTO \"InviteCodes\" (\"Id\", \"Code\", \"CreatedAt\") VALUES ${values%,} ON CONFLICT (\"Code\") DO NOTHING;"

echo "Minted (hand out one per tester):"
for code in "${codes[@]}"; do
  echo "  ${code:0:3}-${code:3}"
done

unused=$(docker exec "$CONTAINER" psql -U ingredo -d ingredo -At -c \
  'SELECT count(*) FROM "InviteCodes" WHERE "UsedAt" IS NULL;')
echo "Unused codes in the database: $unused"
echo "Usage overview: docker exec $CONTAINER psql -U ingredo -d ingredo -c 'SELECT \"Code\", \"CreatedAt\", \"UsedAt\" FROM \"InviteCodes\" ORDER BY \"CreatedAt\";'"
```

- [ ] **Step 2: Syntax-check and verify the table name.** Run `chmod +x backend/deploy/mint-invites.sh && bash -n backend/deploy/mint-invites.sh` (silent, exit 0). Confirm the quoted `"InviteCodes"` / column names match the Task 1 migration exactly (`grep -n 'InviteCodes\|UsedAt' backend/Ingredo.Api/Data/Migrations/*AddInviteCodes.cs`); EF quotes PascalCase names, so the SQL must too.

- [ ] **Step 3: Document.** In `backend/README.md`'s `## Production` section, append after the Backups subsection:

```markdown
### Invite codes

Registration requires a single-use invite code. Mint a batch on the host:

```bash
~/srv/ingredo/backend/deploy/mint-invites.sh 10   # prints codes like ABC-DEF
```

Hand out one code per tester; a code dies on use. The script prints how many
unused codes remain and the query for a usage overview. Sensitive endpoints
are rate-limited (10/min per client on login/register/join; 429 + Retry-After
beyond that) — a locked-out tester just waits a minute.
```

- [ ] **Step 4: Commit**

```bash
git add backend/deploy/mint-invites.sh backend/README.md
git commit -m "feat: operator script to mint single-use invite codes"
```

---

### Task 4: Frontend invite field + strings + manual pass

**Files:**
- Modify: `frontend/lib/api/auth.ts` (register gains `inviteCode`)
- Modify: `frontend/app/account/register.tsx` (field + 403 mapping)
- Modify: `frontend/lib/i18n/nb.json` / `en.json` (two keys)
- Test: `frontend/__tests__/api-auth.test.ts`, `frontend/__tests__/account-screens.test.tsx`
- Modify: `docs/TESTING.md` (append manual pass)

**Interfaces:**
- Consumes: Task 1's wire contract — `inviteCode` in the register body; 403 on invalid/used.
- Produces: `register(email, password, displayName, householdName, inviteCode): Promise<void>` (5 required params).

- [ ] **Step 1: i18n.** Both locales: `account.inviteCode` = "Invitasjonskode" / "Invite code"; inside `account.errors`: `inviteInvalid` = "Ugyldig invitasjonskode." / "That invite code isn't valid.".

- [ ] **Step 2: Failing tests.** `api-auth.test.ts` — the register test's call and body become:

```ts
    await register('kari@example.test', 'passord123', 'Kari', 'Hjem', 'abc-def');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'kari@example.test',
        password: 'passord123',
        displayName: 'Kari',
        householdName: 'Hjem',
        inviteCode: 'abc-def',
      },
      skipAuth: true,
    });
```

(the raw value goes through untouched — the backend canonicalizes). `account-screens.test.tsx` — every existing RegisterScreen test that submits gains, next to its other fills:

```tsx
    fireEvent.changeText(screen.getByTestId('register-invite'), 'ABC-DEF');
```

the submit test's assertion becomes the 5-arg form ending `'Home', 'ABC-DEF'`; and add:

```tsx
  it('maps a rejected invite code to its own error', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(403, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ZZZ-ZZZ');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(screen.getByText("That invite code isn't valid.")).toBeOnTheScreen();
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx jest __tests__/api-auth.test.ts __tests__/account-screens.test.tsx`
Expected: FAIL — register has 4 params, no `register-invite` testID.

- [ ] **Step 4: Implement.** `lib/api/auth.ts`:

```ts
export async function register(
  email: string,
  password: string,
  displayName: string,
  householdName: string,
  inviteCode: string
): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, displayName, householdName, inviteCode },
    skipAuth: true,
  });
  await applyAuthResponse(auth);
}
```

`register.tsx`: add `const [invite, setInvite] = useState('');`; ABOVE the name field insert:

```tsx
      <Input
        testID="register-invite"
        label={t('account.inviteCode')}
        value={invite}
        onChangeText={setInvite}
        placeholder="ABC-DEF"
        autoCapitalize="characters"
        className="mb-4"
      />
```

the register call becomes `await register(email.trim(), password, displayName.trim(), t('account.defaultHouseholdName'), invite.trim());` and the catch chain gains, before the 400 branch:

```tsx
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError(t('account.errors.inviteInvalid'));
```

- [ ] **Step 5: Run the gates**

Run: `cd frontend && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green (tsc enforces the 5th argument at the single call site; key-parity covers the strings).

- [ ] **Step 6: Append to `docs/TESTING.md`** (end of file):

```markdown
## Hardening (manual pass)

- Register with no invite code → friendly validation error; with a made-up
  code ("ZZZ-ZZZ") → "Ugyldig invitasjonskode."; with a code from
  `mint-invites.sh` → account created.
- The same code a second time → "Ugyldig invitasjonskode." (single-use).
- Existing accounts sign in exactly as before; sync and realtime unaffected.
- Hammer sign-in with a wrong password 10+ times inside a minute → the
  generic error (429 behind it); a minute later it works again.
```

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/auth.ts frontend/app/account/register.tsx frontend/lib/i18n/nb.json frontend/lib/i18n/en.json frontend/__tests__/api-auth.test.ts frontend/__tests__/account-screens.test.tsx docs/TESTING.md
git commit -m "feat: invite code field at registration"
```

---

## Post-merge rollout (operator checklist — not plan tasks)

Order matters: backend first (old app + new backend blocks NEW registrations only; both current users are already registered and unaffected).

1. Merge → push develop → ff master → push master → `~/srv/ingredo/backend/deploy.sh`.
2. `npm run publish:beta` (registration screen reaches phones OTA).
3. `~/srv/ingredo/backend/deploy/mint-invites.sh 10` → hand codes to testers (they install the APK from the EAS link / Expo Go for iPhones).
4. Run the TESTING.md "Hardening" manual pass.
5. Memory/note: audience is now ~12 testers; password reset is the next slice candidate.
