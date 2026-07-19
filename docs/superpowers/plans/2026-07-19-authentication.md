# Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lean custom identity for the Ingredo backend — register/login/refresh/logout/me, JWT access (15 min) + rotating refresh tokens (30 days) with family revocation on reuse, personal household per user, and the recipe API behind `[Authorize]` with household-scoped queries.

**Architecture:** New `Auth/` feature folder following the house pattern (controller validates → service returns `ServiceResult` → `AppDbContext`). `TokenService` owns JWT issuance and refresh-token generation/hashing; `AuthService` owns account/rotation logic with `PasswordHasher<User>` (PBKDF2). Recipes gain `HouseholdId` and every recipe query scopes to the caller's `household` claim; foreign recipes are 404s.

**Tech Stack:** existing backend stack + `Microsoft.AspNetCore.Authentication.JwtBearer`, `Microsoft.Extensions.Identity.Core` (hasher only, not the Identity framework).

**Spec:** `docs/superpowers/specs/2026-07-19-authentication-design.md`

## Global Constraints

- Access token: HS256, 15 min, claims `sub` + `household` (raw claim names — `MapInboundClaims = false`), issuer/audience validated; startup fails fast when `Jwt:Key` is missing or < 32 bytes.
- Refresh token: 32 random bytes (base64) returned once; stored only as SHA-256 hash; 30-day expiry; rotation revokes the used token; presenting an already-revoked token revokes its whole `FamilyId` group → 401; logout revokes and is idempotent (unknown token still 204).
- Login returns identical 401 for unknown email and wrong password. Register 409 on duplicate normalized (trimmed, lowercase-invariant) email.
- Registration creates User + Household (named after display name) + Owner membership + first refresh token in ONE `SaveChangesAsync`.
- Recipes: `[Authorize]`; all service methods take `Guid householdId`; list/get/update/delete scope to it; foreign/nonexistent → 404 (never 403); create stamps `HouseholdId`; the duplicate-id 409 check stays global.
- Password policy: length ≥ 8 and ≤ 128, no composition rules. Display name non-blank, ≤ 100. Email ≤ 320, format-validated.
- No secrets committed beyond dev-only values in `appsettings.Development.json` and `.env.example` placeholders (established stance).
- Package pins carry the fallback rule: if a pin fails to restore, use latest stable of the same major and record it. Keep `AllowMissingPrunePackageData`, existing advisory pins, and `public partial class Program;` intact. If a new package introduces a vulnerability warning, apply the established direct-pin remedy.
- Run all commands from `/home/mrb/Work/Programming/ingredo/backend`. Definition of green before every commit: `dotnet build` zero warnings, `dotnet test` green (Docker running).

## File Structure

- Create: `Ingredo.Api/Domain/{User,Household,HouseholdMember,HouseholdRole,RefreshToken}.cs`; `Ingredo.Api/Auth/{JwtOptions,TokenService,AuthSetupExtensions,AuthDtos,AuthValidators,IAuthService,AuthService,AuthController}.cs`; `Ingredo.Api.Tests/{Auth/TokenServiceTests.cs,Auth/AuthSetupTests.cs,Validators/AuthValidatorTests.cs,Integration/AuthApiTests.cs,Integration/ApiClientExtensions.cs}`
- Modify: `Domain/Recipe.cs`, `Data/AppDbContext.cs` (+2 migrations: `AddIdentity`, `AddRecipeOwnership`), `Common/ServiceResult.cs` (+`Unauthorized`), `Recipes/{IRecipeService,RecipeService,RecipesController}.cs`, `Program.cs`, `appsettings.json`, `appsettings.Development.json`, `Ingredo.Api.csproj`, `Ingredo.Api.Tests` recipes tests, `docker-compose.yml`, `.env.example`, `README.md`, root `docs/TESTING.md`

---

### Task 1: Identity domain and migration

**Files:**
- Create: `Ingredo.Api/Domain/User.cs`, `Domain/Household.cs`, `Domain/HouseholdRole.cs`, `Domain/HouseholdMember.cs`, `Domain/RefreshToken.cs`
- Modify: `Data/AppDbContext.cs`; generate `Data/Migrations/*_AddIdentity*`

**Interfaces:**
- Produces (used by Tasks 2–5): the five entity shapes below and DbSets `Users`, `Households`, `HouseholdMembers`, `RefreshTokens`.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/authentication
```

- [ ] **Step 1: Domain entities**

Create `Ingredo.Api/Domain/User.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class User
{
    public Guid Id { get; set; }
    public required string Email { get; set; }
    public required string NormalizedEmail { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

Create `Ingredo.Api/Domain/Household.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class Household
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

Create `Ingredo.Api/Domain/HouseholdRole.cs`:

```csharp
namespace Ingredo.Api.Domain;

// Stored now, enforced in Phase 4 (household sharing).
public enum HouseholdRole
{
    Owner,
    Member,
}
```

Create `Ingredo.Api/Domain/HouseholdMember.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class HouseholdMember
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid HouseholdId { get; set; }
    public HouseholdRole Role { get; set; } = HouseholdRole.Member;
    public DateTimeOffset CreatedAt { get; set; }
}
```

Create `Ingredo.Api/Domain/RefreshToken.cs`:

```csharp
namespace Ingredo.Api.Domain;

// The opaque token value is returned to the client exactly once and never
// stored — only its SHA-256 hash. FamilyId groups every rotation descended
// from one login/registration so reuse detection can revoke the whole line.
public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid FamilyId { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
```

- [ ] **Step 2: DbContext configuration**

In `Data/AppDbContext.cs`, add DbSets after the existing three:

```csharp
    public DbSet<User> Users => Set<User>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<HouseholdMember> HouseholdMembers => Set<HouseholdMember>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
```

and append inside `OnModelCreating` (after the existing entity blocks):

```csharp
        modelBuilder.Entity<User>(user =>
        {
            user.Property(u => u.Email).IsRequired().HasMaxLength(320);
            user.Property(u => u.NormalizedEmail).IsRequired().HasMaxLength(320);
            user.HasIndex(u => u.NormalizedEmail).IsUnique();
            user.Property(u => u.DisplayName).IsRequired().HasMaxLength(100);
            user.Property(u => u.PasswordHash).IsRequired();
        });

        modelBuilder.Entity<Household>(household =>
        {
            household.Property(h => h.Name).IsRequired().HasMaxLength(200);
        });

        modelBuilder.Entity<HouseholdMember>(member =>
        {
            member.HasIndex(m => new { m.UserId, m.HouseholdId }).IsUnique();
            member
                .HasOne<User>()
                .WithMany()
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            member
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(m => m.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
            member
                .Property(m => m.Role)
                .HasConversion(
                    role => role.ToString().ToLowerInvariant(),
                    value => Enum.Parse<HouseholdRole>(value, true))
                .HasMaxLength(16);
        });

        modelBuilder.Entity<RefreshToken>(token =>
        {
            token.Property(t => t.TokenHash).IsRequired().HasMaxLength(88);
            token.HasIndex(t => t.TokenHash).IsUnique();
            token.HasIndex(t => t.FamilyId);
            token
                .HasOne<User>()
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
```

- [ ] **Step 3: Generate the migration and verify**

```bash
dotnet tool restore
dotnet tool run dotnet-ef -- migrations add AddIdentity --project Ingredo.Api --output-dir Data/Migrations
dotnet build
dotnet test
```

Expected: migration files appear; zero warnings; all 26 existing tests still green (nothing consumes the new tables yet).

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add identity domain and migration"
```

---

### Task 2: Token service and JWT wiring

**Files:**
- Create: `Ingredo.Api/Auth/JwtOptions.cs`, `Auth/TokenService.cs`, `Auth/AuthSetupExtensions.cs`, `Ingredo.Api.Tests/Auth/TokenServiceTests.cs`, `Ingredo.Api.Tests/Auth/AuthSetupTests.cs`
- Modify: `Ingredo.Api.csproj` (packages), `Program.cs`, `appsettings.json`, `appsettings.Development.json`, `Ingredo.Api.Tests/Integration/ApiFactory.cs`

**Interfaces:**
- Produces (used by Tasks 4–5): `ITokenService { CreateAccessToken(User, Guid householdId): string; CreateRefreshTokenValue(): string; HashRefreshToken(string): string }`; `TokenService.HouseholdClaim = "household"`; `JwtOptions { Key, Issuer, Audience, AccessTokenMinutes = 15, RefreshTokenDays = 30 }`; authenticated pipeline (`UseAuthentication`/`UseAuthorization`).

- [ ] **Step 1: Add packages**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet add Ingredo.Api package Microsoft.AspNetCore.Authentication.JwtBearer --version 10.0.0
dotnet add Ingredo.Api package Microsoft.Extensions.Identity.Core --version 10.0.0
```

- [ ] **Step 2: Write the failing tests**

Create `Ingredo.Api.Tests/Auth/TokenServiceTests.cs`:

```csharp
using System.IdentityModel.Tokens.Jwt;
using Ingredo.Api.Auth;
using Ingredo.Api.Domain;
using Microsoft.Extensions.Options;

namespace Ingredo.Api.Tests.Auth;

public class TokenServiceTests
{
    private static TokenService NewService() =>
        new(Options.Create(new JwtOptions
        {
            Key = "unit-test-signing-key-0123456789abcdef-extra",
            Issuer = "ingredo-api",
            Audience = "ingredo-app",
        }));

    private static User NewUser() => new()
    {
        Id = Guid.NewGuid(),
        Email = "a@b.no",
        NormalizedEmail = "a@b.no",
        DisplayName = "A",
        PasswordHash = "x",
    };

    [Fact]
    public void Access_token_carries_sub_household_issuer_audience_and_15_minute_expiry()
    {
        var user = NewUser();
        var householdId = Guid.NewGuid();

        var token = new JwtSecurityTokenHandler().ReadJwtToken(
            NewService().CreateAccessToken(user, householdId));

        Assert.Equal(user.Id.ToString(), token.Claims.Single(c => c.Type == "sub").Value);
        Assert.Equal(householdId.ToString(), token.Claims.Single(c => c.Type == "household").Value);
        Assert.Equal("ingredo-api", token.Issuer);
        Assert.Contains("ingredo-app", token.Audiences);
        var lifetime = token.ValidTo - DateTime.UtcNow;
        Assert.InRange(lifetime, TimeSpan.FromMinutes(13), TimeSpan.FromMinutes(16));
    }

    [Fact]
    public void Refresh_token_values_are_long_and_unique()
    {
        var service = NewService();
        var first = service.CreateRefreshTokenValue();
        var second = service.CreateRefreshTokenValue();

        Assert.True(first.Length >= 40);
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Refresh_token_hash_is_deterministic_and_not_the_value()
    {
        var service = NewService();
        var value = service.CreateRefreshTokenValue();

        Assert.Equal(service.HashRefreshToken(value), service.HashRefreshToken(value));
        Assert.NotEqual(value, service.HashRefreshToken(value));
    }
}
```

Create `Ingredo.Api.Tests/Auth/AuthSetupTests.cs`:

```csharp
using Ingredo.Api.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ingredo.Api.Tests.Auth;

public class AuthSetupTests
{
    private static IConfiguration Config(string? key) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = key,
                ["Jwt:Issuer"] = "i",
                ["Jwt:Audience"] = "a",
            })
            .Build();

    [Theory]
    [InlineData(null)]
    [InlineData("short-key")]
    public void Startup_fails_fast_on_missing_or_short_key(string? key)
    {
        var services = new ServiceCollection();
        Assert.Throws<InvalidOperationException>(() => services.AddIngredoAuth(Config(key)));
    }

    [Fact]
    public void Startup_accepts_a_32_byte_key()
    {
        var services = new ServiceCollection();
        services.AddIngredoAuth(Config("0123456789abcdef0123456789abcdef"));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — `JwtOptions`, `TokenService`, `AddIngredoAuth` don't exist (compile failure is the RED state).

- [ ] **Step 4: Implement**

Create `Ingredo.Api/Auth/JwtOptions.cs`:

```csharp
namespace Ingredo.Api.Auth;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public required string Key { get; set; }
    public required string Issuer { get; set; }
    public required string Audience { get; set; }
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
}
```

Create `Ingredo.Api/Auth/TokenService.cs`:

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Ingredo.Api.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Ingredo.Api.Auth;

public interface ITokenService
{
    string CreateAccessToken(User user, Guid householdId);
    string CreateRefreshTokenValue();
    string HashRefreshToken(string value);
}

public sealed class TokenService(IOptions<JwtOptions> options) : ITokenService
{
    // Raw claim name — MapInboundClaims is off, so consumers read it verbatim.
    public const string HouseholdClaim = "household";

    public string CreateAccessToken(User user, Guid householdId)
    {
        var jwt = options.Value;
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: jwt.Issuer,
            audience: jwt.Audience,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(HouseholdClaim, householdId.ToString()),
            ],
            expires: DateTime.UtcNow.AddMinutes(jwt.AccessTokenMinutes),
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshTokenValue() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    public string HashRefreshToken(string value) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
```

Create `Ingredo.Api/Auth/AuthSetupExtensions.cs`:

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace Ingredo.Api.Auth;

public static class AuthSetupExtensions
{
    public static IServiceCollection AddIngredoAuth(
        this IServiceCollection services, IConfiguration configuration)
    {
        var jwt = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>();
        if (jwt is null || string.IsNullOrWhiteSpace(jwt.Key) || Encoding.UTF8.GetByteCount(jwt.Key) < 32)
        {
            throw new InvalidOperationException(
                "Jwt configuration is missing or Jwt:Key is shorter than 32 bytes — set it via configuration/environment.");
        }

        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.AddScoped<ITokenService, TokenService>();

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwt.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwt.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1),
                };
            });
        services.AddAuthorization();
        return services;
    }
}
```

In `Program.cs`: add `using Ingredo.Api.Auth;`; after the `AddValidatorsFromAssemblyContaining` line add:

```csharp
builder.Services.AddIngredoAuth(builder.Configuration);
```

and in the pipeline, between `app.UseSerilogRequestLogging();` and the Development block, add:

```csharp
app.UseAuthentication();
app.UseAuthorization();
```

In `appsettings.json`, add after `"AllowedHosts"`:

```json
  "Jwt": {
    "Issuer": "ingredo-api",
    "Audience": "ingredo-app"
  }
```

(No key — non-dev environments supply it via env.) In `appsettings.Development.json`, add a sibling of `ConnectionStrings`:

```json
  "Jwt": {
    "Key": "dev-only-signing-key-change-me-0123456789abcdef",
    "Issuer": "ingredo-api",
    "Audience": "ingredo-app"
  }
```

In `Ingredo.Api.Tests/Integration/ApiFactory.cs`, add to `ConfigureWebHost` (after the connection-string `UseSetting`):

```csharp
        builder.UseSetting("Jwt:Key", "integration-test-signing-key-0123456789abcdef");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet build && dotnet test`
Expected: zero warnings; 31 tests green (26 existing + 3 token + 2 setup; the setup theory counts as 2).

- [ ] **Step 6: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add token service and JWT authentication wiring"
```

---

### Task 3: Auth DTOs and validators

**Files:**
- Create: `Ingredo.Api/Auth/AuthDtos.cs`, `Auth/AuthValidators.cs`, `Ingredo.Api.Tests/Validators/AuthValidatorTests.cs`

**Interfaces:**
- Produces (used by Tasks 4–5): records `RegisterRequest(Email, Password, DisplayName)`, `LoginRequest(Email, Password)`, `RefreshRequest(RefreshToken)`, `LogoutRequest(RefreshToken)`, `UserResponse(Id, Email, DisplayName, HouseholdId, HouseholdName)`, `AuthResponse(AccessToken, RefreshToken, User)`; validators for register/login/refresh.

- [ ] **Step 1: Write the failing tests**

Create `Ingredo.Api.Tests/Validators/AuthValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Ingredo.Api.Auth;

namespace Ingredo.Api.Tests.Validators;

public class AuthValidatorTests
{
    private readonly RegisterRequestValidator _register = new();
    private readonly LoginRequestValidator _login = new();
    private readonly RefreshRequestValidator _refresh = new();

    private static RegisterRequest ValidRegister() => new("kari@example.no", "passord123", "Kari");

    [Fact]
    public void Accepts_a_valid_registration()
    {
        _register.TestValidate(ValidRegister()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-email")]
    [InlineData("kari@")]
    public void Rejects_bad_emails(string email)
    {
        _register.TestValidate(ValidRegister() with { Email = email })
            .ShouldHaveValidationErrorFor(r => r.Email);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1234567")]
    public void Rejects_short_passwords(string password)
    {
        _register.TestValidate(ValidRegister() with { Password = password })
            .ShouldHaveValidationErrorFor(r => r.Password);
    }

    [Fact]
    public void Accepts_an_eight_character_password_without_composition_rules()
    {
        _register.TestValidate(ValidRegister() with { Password = "aaaaaaaa" })
            .ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_display_names(string name)
    {
        _register.TestValidate(ValidRegister() with { DisplayName = name })
            .ShouldHaveValidationErrorFor(r => r.DisplayName);
    }

    [Fact]
    public void Rejects_overlong_display_name_and_accepts_boundary()
    {
        _register.TestValidate(ValidRegister() with { DisplayName = new string('a', 101) })
            .ShouldHaveValidationErrorFor(r => r.DisplayName);
        _register.TestValidate(ValidRegister() with { DisplayName = new string('a', 100) })
            .ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Login_and_refresh_require_their_fields()
    {
        _login.TestValidate(new LoginRequest("", "")).ShouldHaveValidationErrorFor(r => r.Email);
        _login.TestValidate(new LoginRequest("", "")).ShouldHaveValidationErrorFor(r => r.Password);
        _refresh.TestValidate(new RefreshRequest("")).ShouldHaveValidationErrorFor(r => r.RefreshToken);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — the records/validators don't exist.

- [ ] **Step 3: Implement**

Create `Ingredo.Api/Auth/AuthDtos.cs`:

```csharp
namespace Ingredo.Api.Auth;

public sealed record RegisterRequest(string Email, string Password, string DisplayName);

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record LogoutRequest(string RefreshToken);

public sealed record UserResponse(
    Guid Id,
    string Email,
    string DisplayName,
    Guid HouseholdId,
    string HouseholdName);

public sealed record AuthResponse(string AccessToken, string RefreshToken, UserResponse User);
```

Create `Ingredo.Api/Auth/AuthValidators.cs`:

```csharp
using FluentValidation;

namespace Ingredo.Api.Auth;

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().EmailAddress().MaximumLength(320);
        // Length only — no composition rules (NIST-style guidance).
        RuleFor(r => r.Password).NotEmpty().MinimumLength(8).MaximumLength(128);
        RuleFor(r => r.DisplayName)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Display name must not be empty.")
            .MaximumLength(100);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty();
        RuleFor(r => r.Password).NotEmpty();
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator()
    {
        RuleFor(r => r.RefreshToken).NotEmpty();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test --filter AuthValidatorTests`
Expected: PASS — 12 tests (theories expanded).

- [ ] **Step 5: Full green and commit**

```bash
dotnet build
dotnet test
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add auth DTOs and validators"
```

---

### Task 4: Auth service, controller, and integration tests

**Files:**
- Create: `Ingredo.Api/Auth/IAuthService.cs`, `Auth/AuthService.cs`, `Auth/AuthController.cs`, `Ingredo.Api.Tests/Integration/AuthApiTests.cs`
- Modify: `Common/ServiceResult.cs` (+`Unauthorized`), `Program.cs` (DI)

**Interfaces:**
- Consumes: Tasks 1–3 outputs; `PasswordHasher<User>` from `Microsoft.Extensions.Identity.Core`.
- Produces (used by Task 5): a working authenticated flow (`/api/v1/auth/*`) that Task 5's authenticated-client helper builds on.

- [ ] **Step 1: Extend ServiceResult**

In `Common/ServiceResult.cs`, add an `Unauthorized` member to the enum and a factory:

```csharp
public enum ServiceStatus
{
    Ok,
    NotFound,
    Conflict,
    Unauthorized,
}
```

and inside the record:

```csharp
    public static ServiceResult<T> Unauthorized() => new(ServiceStatus.Unauthorized, default);
```

- [ ] **Step 2: Write the failing integration tests**

Create `Ingredo.Api.Tests/Integration/AuthApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ingredo.Api.Auth;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class AuthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static RegisterRequest NewUser(string? email = null) =>
        new(email ?? $"user-{Guid.NewGuid():N}@test.local", "passord123", "Kari Test");

    private async Task<AuthResponse> Register(RegisterRequest request)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/register", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
    }

    [Fact]
    public async Task Register_returns_tokens_and_me_works_with_the_access_token()
    {
        var request = NewUser();
        var auth = await Register(request);

        Assert.NotEmpty(auth.AccessToken);
        Assert.NotEmpty(auth.RefreshToken);
        Assert.Equal("Kari Test", auth.User.DisplayName);
        Assert.Equal("Kari Test", auth.User.HouseholdName);

        var me = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
        me.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var meResponse = await _client.SendAsync(me);
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);
        var user = await meResponse.Content.ReadFromJsonAsync<UserResponse>();
        Assert.Equal(auth.User.Id, user!.Id);
        Assert.Equal(request.Email, user.Email);
    }

    [Fact]
    public async Task Register_conflicts_on_duplicate_email_case_insensitively()
    {
        var request = NewUser();
        await Register(request);

        var duplicate = await _client.PostAsJsonAsync(
            "/api/v1/auth/register", request with { Email = request.Email.ToUpperInvariant() });

        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task Login_works_and_wrong_password_and_unknown_email_are_identical_401s()
    {
        var request = NewUser();
        await Register(request);

        var ok = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest(request.Email, request.Password));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var wrongPassword = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest(request.Email, "feil-passord"));
        var unknownEmail = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest("nobody@test.local", request.Password));

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal(
            await wrongPassword.Content.ReadAsStringAsync(),
            await unknownEmail.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Refresh_rotates_and_reuse_revokes_the_whole_family()
    {
        var auth = await Register(NewUser());

        var rotated = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var second = (await rotated.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.NotEqual(auth.RefreshToken, second.RefreshToken);

        // Reusing the first (already rotated) token is the theft signal…
        var reuse = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        // …which must kill the whole family, including the fresh token.
        var afterReuse = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(second.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, afterReuse.StatusCode);
    }

    [Fact]
    public async Task Logout_revokes_the_refresh_token_and_is_idempotent()
    {
        var auth = await Register(NewUser());

        var logout = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        var refreshAfter = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, refreshAfter.StatusCode);

        var again = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        var unknown = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest("no-such-token"));
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
    }

    [Fact]
    public async Task Me_requires_authentication()
    {
        var anonymous = await _client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — `IAuthService`/`AuthController` missing? No — the tests reference only DTOs (Task 3) and HTTP; the build succeeds and `dotnet test --filter AuthApiTests` fails with 404s (no controller). Both are acceptable RED evidence; capture whichever occurs.

- [ ] **Step 4: Implement service, controller, DI**

Create `Ingredo.Api/Auth/IAuthService.cs`:

```csharp
using Ingredo.Api.Common;

namespace Ingredo.Api.Auth;

public interface IAuthService
{
    Task<ServiceResult<AuthResponse>> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> RefreshAsync(string refreshToken, CancellationToken cancellationToken);
    Task LogoutAsync(string refreshToken, CancellationToken cancellationToken);
    Task<ServiceResult<UserResponse>> MeAsync(Guid userId, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/Auth/AuthService.cs`:

```csharp
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Ingredo.Api.Auth;

public sealed class AuthService(
    AppDbContext db,
    ITokenService tokens,
    IPasswordHasher<User> passwordHasher,
    IOptions<JwtOptions> jwtOptions) : IAuthService
{
    public async Task<ServiceResult<AuthResponse>> RegisterAsync(
        RegisterRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var exists = await db.Users.AnyAsync(u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (exists) return ServiceResult<AuthResponse>.Conflict();

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = request.Email.Trim(),
            NormalizedEmail = normalizedEmail,
            DisplayName = request.DisplayName.Trim(),
            PasswordHash = string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        // Personal household: named after the person (no baked-in language),
        // renameable when Phase 4 brings sharing.
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = user.DisplayName,
            CreatedAt = now,
            UpdatedAt = now,
        };
        var membership = new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            HouseholdId = household.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        };

        db.Users.Add(user);
        db.Households.Add(household);
        db.HouseholdMembers.Add(membership);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), now);
        await db.SaveChangesAsync(cancellationToken);

        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    public async Task<ServiceResult<AuthResponse>> LoginAsync(
        LoginRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null) return ServiceResult<AuthResponse>.Unauthorized();

        var verdict = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verdict == PasswordVerificationResult.Failed)
        {
            return ServiceResult<AuthResponse>.Unauthorized();
        }
        if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
            user.UpdatedAt = DateTimeOffset.UtcNow;
        }

        var household = await HouseholdOf(user.Id, cancellationToken);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    public async Task<ServiceResult<AuthResponse>> RefreshAsync(
        string refreshToken, CancellationToken cancellationToken)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(
            t => t.TokenHash == hash, cancellationToken);
        if (stored is null) return ServiceResult<AuthResponse>.Unauthorized();

        var now = DateTimeOffset.UtcNow;
        if (stored.RevokedAt is not null)
        {
            // Reuse of a rotated/revoked token: likely theft — revoke the family.
            await db.RefreshTokens
                .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(t => t.RevokedAt, now), cancellationToken);
            return ServiceResult<AuthResponse>.Unauthorized();
        }
        if (stored.ExpiresAt <= now) return ServiceResult<AuthResponse>.Unauthorized();

        stored.RevokedAt = now;
        var user = await db.Users.SingleAsync(u => u.Id == stored.UserId, cancellationToken);
        var household = await HouseholdOf(user.Id, cancellationToken);
        var refreshValue = IssueRefreshToken(user.Id, stored.FamilyId, now);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(
            t => t.TokenHash == hash, cancellationToken);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ServiceResult<UserResponse>> MeAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return ServiceResult<UserResponse>.NotFound();
        var household = await HouseholdOf(userId, cancellationToken);
        return ServiceResult<UserResponse>.Ok(ToUserResponse(user, household));
    }

    private string IssueRefreshToken(Guid userId, Guid familyId, DateTimeOffset now)
    {
        var value = tokens.CreateRefreshTokenValue();
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FamilyId = familyId,
            TokenHash = tokens.HashRefreshToken(value),
            ExpiresAt = now.AddDays(jwtOptions.Value.RefreshTokenDays),
            CreatedAt = now,
        });
        return value;
    }

    private async Task<Household> HouseholdOf(Guid userId, CancellationToken cancellationToken) =>
        await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .Join(db.Households, m => m.HouseholdId, h => h.Id, (m, h) => h)
            .FirstAsync(cancellationToken);

    private AuthResponse BuildAuthResponse(User user, Household household, string refreshValue) =>
        new(tokens.CreateAccessToken(user, household.Id), refreshValue, ToUserResponse(user, household));

    private static UserResponse ToUserResponse(User user, Household household) =>
        new(user.Id, user.Email, user.DisplayName, household.Id, household.Name);
}
```

Create `Ingredo.Api/Auth/AuthController.cs`:

```csharp
using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Auth;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(
    IAuthService service,
    IValidator<RegisterRequest> registerValidator,
    IValidator<LoginRequest> loginValidator,
    IValidator<RefreshRequest> refreshValidator) : ControllerBase
{
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var validation = await registerValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.RegisterAsync(request, cancellationToken);
        return result.Status == ServiceStatus.Conflict
            ? Conflict()
            : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var validation = await loginValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.LoginAsync(request, cancellationToken);
        return result.Status == ServiceStatus.Unauthorized ? Unauthorized() : Ok(result.Value);
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(RefreshRequest request, CancellationToken cancellationToken)
    {
        var validation = await refreshValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.RefreshAsync(request.RefreshToken, cancellationToken);
        return result.Status == ServiceStatus.Unauthorized ? Unauthorized() : Ok(result.Value);
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutRequest request, CancellationToken cancellationToken)
    {
        // Idempotent by design: unknown or already-revoked tokens still 204.
        await service.LogoutAsync(request.RefreshToken ?? string.Empty, cancellationToken);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var sub = User.FindFirstValue("sub");
        if (!Guid.TryParse(sub, out var userId)) return Unauthorized();

        var result = await service.MeAsync(userId, cancellationToken);
        return result.Status == ServiceStatus.Ok ? Ok(result.Value) : Unauthorized();
    }
}
```

In `Program.cs`, add imports `using Ingredo.Api.Domain;` and `using Microsoft.AspNetCore.Identity;`, and after the `AddIngredoAuth` line:

```csharp
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<IAuthService, AuthService>();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 49 tests (43 after Task 3 + 6 auth integration).

- [ ] **Step 6: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add auth endpoints with rotating refresh tokens"
```

---

### Task 5: Recipe ownership and authorization

**Files:**
- Modify: `Domain/Recipe.cs`, `Data/AppDbContext.cs` (+ migration `AddRecipeOwnership`), `Recipes/IRecipeService.cs`, `Recipes/RecipeService.cs`, `Recipes/RecipesController.cs`, `Ingredo.Api.Tests/Integration/RecipesApiTests.cs`
- Create: `Ingredo.Api.Tests/Integration/ApiClientExtensions.cs`

**Interfaces:**
- Consumes: Task 4's register endpoint (the helper registers throwaway users); `TokenService.HouseholdClaim`.
- Produces: the authorized, household-scoped recipe API.

- [ ] **Step 1: Write the authenticated-client helper and update tests first**

Create `Ingredo.Api.Tests/Integration/ApiClientExtensions.cs`:

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ingredo.Api.Auth;

namespace Ingredo.Api.Tests.Integration;

public static class ApiClientExtensions
{
    // Registers a fresh throwaway user and returns a client with its Bearer
    // token attached — each call is an isolated household.
    public static async Task<HttpClient> CreateAuthenticatedClientAsync(this ApiFactory factory)
    {
        var client = factory.CreateClient();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", "Test Bruker");
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", register);
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return client;
    }
}
```

In `Ingredo.Api.Tests/Integration/RecipesApiTests.cs`:

1. Make the class async-initialized — change the declaration and client field to:

```csharp
[Collection("Api")]
public class RecipesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HttpClient _client = null!;

    public async Task InitializeAsync() => _client = await factory.CreateAuthenticatedClientAsync();

    public Task DisposeAsync() => Task.CompletedTask;
```

(All existing tests keep using `_client` unchanged; they now run as one authenticated user per test-class instance — xUnit creates a fresh class instance per test, so each test gets its own user/household, which also makes `List_returns_summaries_newest_first_excluding_deleted` exact: drop that test's `List-` prefix filtering and assert the single-element list directly:)

```csharp
        var list = await _client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");

        Assert.NotNull(list);
        var only = Assert.Single(list);
        Assert.Equal(b!.Id, only.Id);
        Assert.Equal("List-B", only.Title);
```

2. Append the new tests:

```csharp
    [Fact]
    public async Task Anonymous_requests_are_401()
    {
        var anonymous = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/recipes")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PostAsJsonAsync("/api/v1/recipes", NewRecipe())).StatusCode);
    }

    [Fact]
    public async Task Users_cannot_reach_each_others_recipes()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Privat")))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var other = await factory.CreateAuthenticatedClientAsync();

        var list = await other.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.DoesNotContain(list!, r => r.Id == created!.Id);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await other.GetAsync($"/api/v1/recipes/{created!.Id}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync($"/api/v1/recipes/{created.Id}", NewRecipe("Kapret"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await other.DeleteAsync($"/api/v1/recipes/{created.Id}")).StatusCode);

        var mine = await _client.GetAsync($"/api/v1/recipes/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, mine.StatusCode);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build && dotnet test --filter RecipesApiTests`
Expected: FAIL — the anonymous test fails (endpoints are still open) and/or compile-adjacent failures once ownership lands mid-task; capture the state.

- [ ] **Step 3: Recipe ownership in domain, context, migration**

In `Domain/Recipe.cs`, add after `Id`:

```csharp
    public Guid HouseholdId { get; set; }
```

In `AppDbContext.OnModelCreating`, inside the `Recipe` entity block, add:

```csharp
            recipe
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(r => r.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
```

Generate the migration (disposable dev data — no backfill by design):

```bash
dotnet tool run dotnet-ef -- migrations add AddRecipeOwnership --project Ingredo.Api --output-dir Data/Migrations
```

- [ ] **Step 4: Scope the service and authorize the controller**

`Recipes/IRecipeService.cs` — every method gains a leading `Guid householdId` parameter:

```csharp
using Ingredo.Api.Common;

namespace Ingredo.Api.Recipes;

public interface IRecipeService
{
    Task<List<RecipeSummaryResponse>> ListAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> CreateAsync(Guid householdId, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> UpdateAsync(Guid householdId, Guid id, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
```

`Recipes/RecipeService.cs` — corresponding edits (unchanged logic elsewhere):

- `ListAsync(Guid householdId, …)`: prepend `.Where(r => r.HouseholdId == householdId)` before `OrderByDescending`.
- `GetAsync(Guid householdId, Guid id, …)`: pass `householdId` to `LoadAggregate`.
- `CreateAsync(Guid householdId, …)`: after `var recipe = request.ToEntity(DateTimeOffset.UtcNow);` add `recipe.HouseholdId = householdId;`. The duplicate-id check stays exactly as is (global by design).
- `UpdateAsync(Guid householdId, Guid id, …)`: pass `householdId` to `LoadAggregate`.
- `DeleteAsync(Guid householdId, Guid id, …)`: add `&& r.HouseholdId == householdId` to the `FirstOrDefaultAsync` predicate (foreign delete → 404).
- `LoadAggregate(Guid householdId, Guid id, …)`: predicate becomes `r => r.Id == id && r.HouseholdId == householdId`.

`Recipes/RecipesController.cs`:

1. Add imports `using Ingredo.Api.Auth;` and `using Microsoft.AspNetCore.Authorization;` and `using System.Security.Claims;`.
2. Add `[Authorize]` under `[ApiController]`.
3. Add a household accessor inside the class:

```csharp
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);
```

4. Pass `HouseholdId` as the first argument in all five service calls (e.g. `service.ListAsync(HouseholdId, cancellationToken)`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 51 tests (49 + 2 new; existing recipes tests now authenticated). The delete-timestamp test's direct DbContext read is unaffected.

- [ ] **Step 6: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: put recipe API behind household-scoped authorization"
```

---

### Task 6: Infra, docs, and end-to-end verification

**Files:**
- Modify: `backend/docker-compose.yml`, `backend/.env.example`, `backend/README.md`, root `docs/TESTING.md`

**Interfaces:**
- Consumes: everything.
- Produces: a compose stack that boots with JWT config and an authenticated end-to-end smoke.

- [ ] **Step 1: Compose and env**

In `docker-compose.yml`, add to the `api` service `environment:` block:

```yaml
      Jwt__Key: ${JWT_KEY:?set in backend/.env}
      Jwt__Issuer: ingredo-api
      Jwt__Audience: ingredo-app
```

Append to `.env.example`:

```
# JWT signing key — generate your own long random value (>= 32 bytes), e.g.:
#   openssl rand -base64 48
JWT_KEY=replace-with-a-long-random-string-of-at-least-32-bytes
```

- [ ] **Step 2: Full automated pass**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build
dotnet test
```

Expected: zero warnings; 51/51 green.

- [ ] **Step 3: Compose end-to-end authenticated smoke**

```bash
grep -q JWT_KEY .env || echo "JWT_KEY=$(openssl rand -base64 48)" >> .env
docker compose up -d --build
sleep 15
curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:8080/health
curl -s -o /dev/null -w 'anon %{http_code}\n' http://localhost:8080/api/v1/recipes   # expect 401
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"passord123","displayName":"Smoke"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:8080/api/v1/recipes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Composed","servings":2,"ingredients":[],"instructions":[]}' \
  | grep -o '"title":"Composed"'
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/recipes | grep -o '"title":"Composed"'
docker compose down
```

Expected: health 200, anonymous 401, both greps match. (Note: the compose volume may hold the pre-auth schema; if startup migration fails on old data, `docker compose down -v` once — the documented disposable-dev-data path — and rerun.)

- [ ] **Step 4: Docs**

In `backend/README.md`, add before the Migrations section:

```markdown
## Auth

- `POST /api/v1/auth/register` `{ email, password, displayName }` → tokens + user (auto-login)
- `POST /api/v1/auth/login` / `refresh` / `logout`, `GET /api/v1/auth/me`
- Access token: JWT, 15 min. Refresh token: 30 days, rotated on every refresh;
  reusing a rotated token revokes its whole family.
- All `/api/v1/recipes` endpoints require `Authorization: Bearer <accessToken>`;
  recipes belong to the caller's (personal, for now) household.
- Local config: `Jwt:Key` comes from `appsettings.Development.json` for
  `dotnet run` and from `JWT_KEY` in `.env` for docker compose.
```

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Authentication (manual pass)

- `docker compose up --build` (with `JWT_KEY` set in `.env`) → register via Scalar → response carries access + refresh tokens.
- Anonymous `GET /api/v1/recipes` is 401; with the Bearer token it lists; recipes created by a second registered user are invisible to the first (list, get, update, delete all behave as not-found).
- Duplicate registration with the same email (any casing) → 409; wrong password and unknown email on login → identical 401s.
- Refresh with the current refresh token → new pair; refresh with the OLD token afterwards → 401 AND the new pair stops refreshing too (family revoked). Logout → refresh 401, repeat logout still 204.
- Restart the api container: tokens issued before the restart still work (key from env, state in postgres).
```

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/ docs/TESTING.md
git commit -m "docs: add auth infra wiring, README section, and manual checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (lean identity, hasher, dual email columns → T1/T4), 2 (personal household in one SaveChanges → T4 register), 3 (HouseholdId + scoped queries + 404-not-403 + global duplicate check → T5), 4 (token shapes, fail-fast key, claims → T2), 5 (rotation + FamilyId reuse revocation + idempotent logout → T4), 6 (endpoint matrix incl. identical 401s and register 409 → T4), 7 (recipe API authorization + isolation tests → T5), 8 (ServiceResult.Unauthorized, house validation pattern → T3/T4), 9 (config/test strategy, compose env → T2/T6). Non-goals untouched.
- **Known judgment calls:** register/refresh have TOCTOU races (duplicate email, concurrent rotation) resolved by DB constraints as 500s rather than 409/401 — same accepted pattern as the recipe duplicate check, ledger-tracked for the hardening slice. `ExecuteUpdateAsync` in the reuse path commits immediately (separate from the tracked SaveChanges) — acceptable: family revocation must not be rolled back by later failures. Register's 201 uses `StatusCode(201, …)` without a Location header (no canonical GET-by-id for auth resources). Existing recipes tests get per-test users (xUnit per-test class instances + IAsyncLifetime), which strengthens the list test (exact single-element assert replaces prefix filtering). The compose smoke tolerates a stale pre-auth volume via the documented `down -v` path. `Me` translates NotFound to 401 (valid token for a deleted user should not reveal more).
- **Type consistency check:** `ITokenService`/`TokenService.HouseholdClaim` names match T5's controller accessor; `ServiceStatus.Unauthorized` added in T4 before both controllers switch on it; `RegisterRequest`/`AuthResponse` shapes used identically in T4 tests, T5 helper, and the service; `IRecipeService`'s new `householdId`-first signatures match every controller call site listed in T5; `JwtRegisteredClaimNames.Sub` with `MapInboundClaims = false` yields the literal `"sub"` claim the controller reads; test key strings are ≥ 32 bytes.
