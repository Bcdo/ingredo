# Household Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistent 6-character join codes, join-with-merge for personal households, self-service leave with owner promotion, any-member rename/regenerate, fresh token pairs on membership change — with the recipes API untouched and sharing emerging purely from the existing household scoping.

**Architecture:** New `Households/` feature folder (house pattern: controller validates → service → `ServiceResult`). `JoinCodeGenerator` (static: alphabet, canonicalize, format) + `IJoinCodeService` (unique-code minting with retry, used by registration and household ops). `IAuthService` gains `IssueTokensAsync(userId)` so membership moves return login-shaped `AuthResponse`s. The join-with-transfer runs in an explicit DB transaction (tracked writes + `ExecuteUpdate` re-homing must commit atomically).

**Tech Stack:** existing backend stack; no new packages.

**Spec:** `docs/superpowers/specs/2026-07-21-household-mechanics-design.md`

## Global Constraints

- Join code: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (I/L/O/0/1 excluded), stored canonical (uppercase, no hyphen), unique index, unbiased generation (`RandomNumberGenerator.GetInt32`), display format `XXX-XXX`, input canonicalized case-insensitively with optional hyphen/spaces; malformed input → same 404 as unknown code.
- Join: membership moves; content (recipes) re-homes ONLY when the joiner was sole member, then the emptied household is deleted; re-homing bumps recipe `UpdatedAt`; re-home MUST precede household delete (FK cascade); the whole operation is one explicit transaction. Own household → 409; unknown code → 404.
- Leave: fresh personal household (display-name name, new code, Owner); content stays; sole member → 409; departing owner promotes the longest-standing remaining member (earliest membership `CreatedAt`, id tiebreak).
- Join and leave return `AuthResponse` (new access token with new `household` claim + new refresh family) issued AFTER the membership change commits.
- Rename/regenerate: any member; name non-blank ≤ 200.
- Recipes API untouched. Keep csproj properties/pins, `public partial class Program;`, established test collection.
- Run all commands from `/home/mrb/Work/Programming/ingredo/backend`. Green bar: `dotnet build` zero warnings, `dotnet test` green (Docker running).

## File Structure

- Create: `Ingredo.Api/Households/{JoinCodeGenerator,JoinCodeService,HouseholdDtos,HouseholdValidators,IHouseholdService,HouseholdService,HouseholdController}.cs`; `Ingredo.Api.Tests/Households/JoinCodeGeneratorTests.cs`; `Ingredo.Api.Tests/Validators/HouseholdValidatorTests.cs`; `Ingredo.Api.Tests/Integration/HouseholdApiTests.cs`
- Modify: `Domain/Household.cs`, `Data/AppDbContext.cs` (+ migration `AddJoinCodes`), `Auth/{IAuthService,AuthService}.cs`, `Program.cs`, `Ingredo.Api.Tests/Integration/ApiClientExtensions.cs`, `backend/README.md`, root `docs/TESTING.md`

---

### Task 1: Join-code generator and unique-code service

**Files:**
- Create: `Ingredo.Api/Households/JoinCodeGenerator.cs`, `Households/JoinCodeService.cs`
- Test: `Ingredo.Api.Tests/Households/JoinCodeGeneratorTests.cs` (new)

**Interfaces:**
- Produces (used by Tasks 2–4): `JoinCodeGenerator.Alphabet`, `.NewCode(): string`, `.Canonicalize(string): string?`, `.FormatForDisplay(string): string`; `IJoinCodeService { NewUniqueCodeAsync(CancellationToken): Task<string> }` + `JoinCodeService(AppDbContext)`.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/household-mechanics
```

- [ ] **Step 1: Write the failing tests**

Create `Ingredo.Api.Tests/Households/JoinCodeGeneratorTests.cs`:

```csharp
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Households;

public class JoinCodeGeneratorTests
{
    [Fact]
    public void Generated_codes_are_six_alphabet_characters_and_vary()
    {
        var seen = new HashSet<string>();
        for (var i = 0; i < 500; i++)
        {
            var code = JoinCodeGenerator.NewCode();
            Assert.Equal(6, code.Length);
            Assert.All(code, c => Assert.Contains(c, JoinCodeGenerator.Alphabet));
            seen.Add(code);
        }
        Assert.True(seen.Count > 490); // collisions in 500 draws from 30^6 are ~impossible
    }

    [Theory]
    [InlineData("KJN4MM", "KJN4MM")]
    [InlineData("kjn-4mm", "KJN4MM")]
    [InlineData("  kjn 4mm ", "KJN4MM")]
    [InlineData("KJN-4MM", "KJN4MM")]
    public void Canonicalize_is_forgiving(string input, string expected)
    {
        Assert.Equal(expected, JoinCodeGenerator.Canonicalize(input));
    }

    [Theory]
    [InlineData("")]
    [InlineData("AB")]
    [InlineData("KJN4MMX")]
    [InlineData("KJN-4M!")]
    [InlineData("KJN-4LM")] // L is not in the alphabet
    [InlineData("KJN-40M")] // 0 is not in the alphabet
    public void Canonicalize_rejects_invalid_input(string input)
    {
        Assert.Null(JoinCodeGenerator.Canonicalize(input));
    }

    [Fact]
    public void Display_format_inserts_the_hyphen()
    {
        Assert.Equal("KJN-4MM", JoinCodeGenerator.FormatForDisplay("KJN4MM"));
    }

    [Fact]
    public void Alphabet_excludes_confusable_characters()
    {
        Assert.DoesNotContain('I', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('L', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('O', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('0', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('1', JoinCodeGenerator.Alphabet);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — `JoinCodeGenerator` doesn't exist (RED for new types).

- [ ] **Step 3: Implement**

Create `Ingredo.Api/Households/JoinCodeGenerator.cs`:

```csharp
using System.Security.Cryptography;

namespace Ingredo.Api.Households;

// Join codes get read aloud across a kitchen — I/L/O/0/1 are excluded so a
// code survives handwriting and shouting. Codes gate joining only, never
// authentication; the 30^6 space behind an authenticated endpoint is not
// practically enumerable.
public static class JoinCodeGenerator
{
    public const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    public const int Length = 6;

    public static string NewCode()
    {
        var chars = new char[Length];
        for (var i = 0; i < Length; i++)
        {
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }
        return new string(chars);
    }

    public static string? Canonicalize(string input)
    {
        var cleaned = new string(
            input.Trim().ToUpperInvariant().Where(c => c is not ('-' or ' ')).ToArray());
        if (cleaned.Length != Length) return null;
        return cleaned.All(Alphabet.Contains) ? cleaned : null;
    }

    public static string FormatForDisplay(string canonical) =>
        $"{canonical[..3]}-{canonical[3..]}";
}
```

Create `Ingredo.Api/Households/JoinCodeService.cs`:

```csharp
using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Households;

public interface IJoinCodeService
{
    Task<string> NewUniqueCodeAsync(CancellationToken cancellationToken);
}

public sealed class JoinCodeService(AppDbContext db) : IJoinCodeService
{
    public async Task<string> NewUniqueCodeAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var code = JoinCodeGenerator.NewCode();
            var taken = await db.Households.AnyAsync(h => h.JoinCode == code, cancellationToken);
            if (!taken) return code;
        }
        throw new InvalidOperationException("Could not generate a unique join code.");
    }
}
```

(This compiles against Task 2's `Household.JoinCode` — if implementing strictly in order, the `AnyAsync` predicate won't compile until Task 2 adds the property. Acceptable orderings: EITHER add the `JoinCode` property to `Domain/Household.cs` in this task as a bare `public required string JoinCode { get; set; }` with the DbContext/migration following in Task 2, OR defer `JoinCodeService.cs` creation to the start of Task 2. Choose the first: add the property here, and make `AuthService.RegisterAsync`'s household initializer compile by setting `JoinCode = "TEMP01"` temporarily — Task 2 replaces it with real minting. Record the choice in the report.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test --filter JoinCodeGeneratorTests`
Expected: PASS — 13 tests (theories expanded). Then full `dotnet test` — all green.

- [ ] **Step 5: Lint-equivalent and commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add join code generator and unique-code service"
```

---

### Task 2: JoinCode column, migration, and registration minting

**Files:**
- Modify: `Domain/Household.cs` (if not done in Task 1), `Data/AppDbContext.cs` (+ migration `AddJoinCodes`), `Auth/AuthService.cs`, `Program.cs` (DI for `IJoinCodeService`)

**Interfaces:**
- Consumes: Task 1's `IJoinCodeService`.
- Produces: every household (including registration's personal one) carries a real unique code.

- [ ] **Step 1: Domain + DbContext**

Ensure `Domain/Household.cs` has (after `Name`):

```csharp
    public required string JoinCode { get; set; }
```

In `AppDbContext.OnModelCreating`, extend the `Household` block:

```csharp
        modelBuilder.Entity<Household>(household =>
        {
            household.Property(h => h.Name).IsRequired().HasMaxLength(200);
            household.Property(h => h.JoinCode).IsRequired().HasMaxLength(6);
            household.HasIndex(h => h.JoinCode).IsUnique();
        });
```

- [ ] **Step 2: Registration mints a real code**

In `Auth/AuthService.cs`:

1. Add the constructor dependency (primary constructor parameter list): `IJoinCodeService joinCodes` (with `using Ingredo.Api.Households;`).
2. In `RegisterAsync`, the household initializer becomes:

```csharp
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = user.DisplayName,
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
```

(Removing any Task-1 `"TEMP01"` placeholder.)

In `Program.cs`, add with the other scoped registrations (plus `using Ingredo.Api.Households;`):

```csharp
builder.Services.AddScoped<IJoinCodeService, JoinCodeService>();
```

- [ ] **Step 3: Migration and verify**

```bash
dotnet tool restore
dotnet tool run dotnet-ef -- migrations add AddJoinCodes --project Ingredo.Api --output-dir Data/Migrations
dotnet build
dotnet test
```

Expected: migration adds the column + unique index; zero warnings; full suite green (registration now mints codes; no existing assertion inspects them).

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add household join codes with registration minting"
```

---

### Task 3: DTOs, validators, and token-pair issuance refactor

**Files:**
- Create: `Ingredo.Api/Households/HouseholdDtos.cs`, `Households/HouseholdValidators.cs`, `Ingredo.Api.Tests/Validators/HouseholdValidatorTests.cs`
- Modify: `Auth/IAuthService.cs`, `Auth/AuthService.cs`

**Interfaces:**
- Produces (used by Task 4): records `HouseholdResponse(Id, Name, JoinCode, Members)`, `MemberResponse(UserId, DisplayName, Role, JoinedAt)`, `RenameRequest(Name)`, `JoinRequest(Code)`; validators; `IAuthService.IssueTokensAsync(Guid userId, CancellationToken): Task<AuthResponse>`.

- [ ] **Step 1: Write the failing tests**

Create `Ingredo.Api.Tests/Validators/HouseholdValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Validators;

public class HouseholdValidatorTests
{
    private readonly RenameRequestValidator _rename = new();
    private readonly JoinRequestValidator _join = new();

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rename_rejects_blank_names(string name)
    {
        _rename.TestValidate(new RenameRequest(name)).ShouldHaveValidationErrorFor(r => r.Name);
    }

    [Fact]
    public void Rename_accepts_boundary_and_rejects_overlong()
    {
        _rename.TestValidate(new RenameRequest(new string('a', 200)))
            .ShouldNotHaveAnyValidationErrors();
        _rename.TestValidate(new RenameRequest(new string('a', 201)))
            .ShouldHaveValidationErrorFor(r => r.Name);
    }

    [Fact]
    public void Join_requires_a_code()
    {
        _join.TestValidate(new JoinRequest("")).ShouldHaveValidationErrorFor(r => r.Code);
        _join.TestValidate(new JoinRequest("KJN-4MM")).ShouldNotHaveAnyValidationErrors();
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — the records/validators don't exist.

- [ ] **Step 3: Implement DTOs, validators, and IssueTokensAsync**

Create `Ingredo.Api/Households/HouseholdDtos.cs`:

```csharp
namespace Ingredo.Api.Households;

public sealed record MemberResponse(
    Guid UserId,
    string DisplayName,
    string Role,
    DateTimeOffset JoinedAt);

public sealed record HouseholdResponse(
    Guid Id,
    string Name,
    string JoinCode,
    List<MemberResponse> Members);

public sealed record RenameRequest(string Name);

public sealed record JoinRequest(string Code);
```

Create `Ingredo.Api/Households/HouseholdValidators.cs`:

```csharp
using FluentValidation;

namespace Ingredo.Api.Households;

public sealed class RenameRequestValidator : AbstractValidator<RenameRequest>
{
    public RenameRequestValidator()
    {
        RuleFor(r => r.Name)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Household name must not be empty.")
            .MaximumLength(200);
    }
}

public sealed class JoinRequestValidator : AbstractValidator<JoinRequest>
{
    public JoinRequestValidator()
    {
        RuleFor(r => r.Code).NotEmpty();
    }
}
```

In `Auth/IAuthService.cs`, add to the interface:

```csharp
    Task<AuthResponse> IssueTokensAsync(Guid userId, CancellationToken cancellationToken);
```

In `Auth/AuthService.cs`, add the implementation (after `MeAsync`):

```csharp
    // Used by household membership moves: mints a fresh token pair whose
    // household claim reflects the user's CURRENT membership. Call only
    // after the membership change has committed.
    public async Task<AuthResponse> IssueTokensAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        var household = await HouseholdOf(userId, cancellationToken);
        var refreshValue = IssueRefreshToken(userId, familyId: Guid.NewGuid(), DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(cancellationToken);
        return BuildAuthResponse(user, household, refreshValue);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test --filter HouseholdValidatorTests`
Expected: PASS — 5 tests. Then full `dotnet test` green.

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add household DTOs, validators, and token issuance refactor"
```

---

### Task 4: Household service, controller, and the integration scenario suite

**Files:**
- Create: `Ingredo.Api/Households/IHouseholdService.cs`, `Households/HouseholdService.cs`, `Households/HouseholdController.cs`, `Ingredo.Api.Tests/Integration/HouseholdApiTests.cs`
- Modify: `Program.cs` (DI), `Ingredo.Api.Tests/Integration/ApiClientExtensions.cs`

**Interfaces:**
- Consumes: everything from Tasks 1–3; `TokenService.HouseholdClaim`.
- Produces: the `/api/v1/household` surface per spec decision 6.

- [ ] **Step 1: Extend the test helper and write the failing integration tests**

In `Ingredo.Api.Tests/Integration/ApiClientExtensions.cs`, add alongside the existing method:

```csharp
    // Like CreateAuthenticatedClientAsync, but also returns the auth payload
    // (tokens + user) for tests that need ids or re-authentication.
    public static async Task<(HttpClient Client, AuthResponse Auth)> RegisterUserAsync(
        this ApiFactory factory, string displayName = "Test Bruker")
    {
        var client = factory.CreateClient();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", displayName);
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", register);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }

    public static void UseTokens(this HttpClient client, AuthResponse auth) =>
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth.AccessToken);
```

Create `Ingredo.Api.Tests/Integration/HouseholdApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class HouseholdApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static RecipeRequest NewRecipe(string title) =>
        new(null, title, null, 4, null, [], []);

    private static async Task<HouseholdResponse> Household(HttpClient client) =>
        (await client.GetFromJsonAsync<HouseholdResponse>("/api/v1/household"))!;

    private static async Task<AuthResponse> Join(HttpClient client, string code)
    {
        var response = await client.PostAsJsonAsync("/api/v1/household/join", new JoinRequest(code));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.UseTokens(auth);
        return auth;
    }

    private static async Task<List<RecipeSummaryResponse>> Recipes(HttpClient client) =>
        (await client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes"))!;

    [Fact]
    public async Task Get_returns_household_with_formatted_code_and_owner_member()
    {
        var (client, auth) = await factory.RegisterUserAsync("Kari");

        var household = await Household(client);

        Assert.Equal("Kari", household.Name);
        Assert.Matches(new Regex("^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$"), household.JoinCode);
        var member = Assert.Single(household.Members);
        Assert.Equal(auth.User.Id, member.UserId);
        Assert.Equal("owner", member.Role);
    }

    [Fact]
    public async Task Join_merges_personal_content_both_ways_and_deletes_the_empty_shell()
    {
        var (kari, _) = await factory.RegisterUserAsync("Kari");
        var (ola, _) = await factory.RegisterUserAsync("Ola");
        await kari.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Karis vafler"));
        await ola.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Olas taco"));
        var kariOldCode = (await Household(kari)).JoinCode;
        var olaCode = (await Household(ola)).JoinCode;

        await Join(kari, olaCode);

        Assert.Equal(
            ["Karis vafler", "Olas taco"],
            (await Recipes(kari)).Select(r => r.Title).OrderBy(t => t));
        Assert.Equal(
            ["Karis vafler", "Olas taco"],
            (await Recipes(ola)).Select(r => r.Title).OrderBy(t => t));
        Assert.Equal(2, (await Household(kari)).Members.Count);

        // Kari's emptied personal household is gone — its code no longer joins.
        var (third, _) = await factory.RegisterUserAsync("Nils");
        var stale = await third.PostAsJsonAsync(
            "/api/v1/household/join", new JoinRequest(kariOldCode));
        Assert.Equal(HttpStatusCode.NotFound, stale.StatusCode);
    }

    [Fact]
    public async Task Join_from_a_shared_household_moves_alone_and_content_stays()
    {
        var (a, _) = await factory.RegisterUserAsync("A");
        var (b, _) = await factory.RegisterUserAsync("B");
        var (c, _) = await factory.RegisterUserAsync("C");
        await a.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Felles gryte"));
        await Join(b, (await Household(a)).JoinCode); // A+B share; the recipe is theirs

        await Join(a, (await Household(c)).JoinCode); // A leaves the shared pool for C's

        Assert.Empty(await Recipes(a));                       // content stayed behind
        Assert.Equal(
            ["Felles gryte"], (await Recipes(b)).Select(r => r.Title));
        var bHousehold = await Household(b);
        var bMember = Assert.Single(bHousehold.Members);      // B is alone now…
        Assert.Equal("owner", bMember.Role);                  // …and was promoted
    }

    [Fact]
    public async Task Join_rejects_own_code_unknown_codes_and_malformed_codes()
    {
        var (client, _) = await factory.RegisterUserAsync();
        var own = (await Household(client)).JoinCode;

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync("/api/v1/household/join", new JoinRequest(own))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(
                "/api/v1/household/join", new JoinRequest("ZZZ-ZZZ"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(
                "/api/v1/household/join", new JoinRequest("not a code"))).StatusCode);
    }

    [Fact]
    public async Task Join_accepts_forgiving_code_input()
    {
        var (kari, _) = await factory.RegisterUserAsync("Kari");
        var (ola, _) = await factory.RegisterUserAsync("Ola");
        var code = (await Household(ola)).JoinCode; // "XXX-XXX"

        await Join(kari, code.Replace("-", "").ToLowerInvariant());

        Assert.Equal(2, (await Household(kari)).Members.Count);
    }

    [Fact]
    public async Task Leave_creates_a_fresh_personal_household_and_content_stays()
    {
        var (kari, _) = await factory.RegisterUserAsync("Kari");
        var (ola, _) = await factory.RegisterUserAsync("Ola");
        await Join(kari, (await Household(ola)).JoinCode);
        await kari.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Felles kake"));

        var leave = await kari.PostAsJsonAsync("/api/v1/household/leave", new { });
        Assert.Equal(HttpStatusCode.OK, leave.StatusCode);
        kari.UseTokens((await leave.Content.ReadFromJsonAsync<AuthResponse>())!);

        Assert.Empty(await Recipes(kari));
        var fresh = await Household(kari);
        Assert.Equal("Kari", fresh.Name);
        Assert.Equal("owner", Assert.Single(fresh.Members).Role);
        Assert.Equal(["Felles kake"], (await Recipes(ola)).Select(r => r.Title));
    }

    [Fact]
    public async Task Leave_as_sole_member_conflicts()
    {
        var (client, _) = await factory.RegisterUserAsync();
        var response = await client.PostAsJsonAsync("/api/v1/household/leave", new { });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Owner_leaving_promotes_the_longest_standing_member()
    {
        var (owner, _) = await factory.RegisterUserAsync("Eier");
        var (first, firstAuth) = await factory.RegisterUserAsync("Førstemann");
        var (second, _) = await factory.RegisterUserAsync("Andremann");
        var code = (await Household(owner)).JoinCode;
        await Join(first, code);
        await Join(second, code);

        var leave = await owner.PostAsJsonAsync("/api/v1/household/leave", new { });
        Assert.Equal(HttpStatusCode.OK, leave.StatusCode);

        var household = await Household(first);
        Assert.Equal(2, household.Members.Count);
        Assert.Equal(
            "owner",
            household.Members.Single(m => m.UserId == firstAuth.User.Id).Role);
    }

    [Fact]
    public async Task Rename_and_regenerate_are_any_member_actions_and_old_codes_die()
    {
        var (kari, _) = await factory.RegisterUserAsync("Kari");
        var (ola, _) = await factory.RegisterUserAsync("Ola");
        var oldCode = (await Household(ola)).JoinCode;
        await Join(kari, oldCode);

        // Kari (a non-owner member) renames…
        var rename = await kari.PutAsJsonAsync("/api/v1/household", new RenameRequest("Vårt kjøkken"));
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        Assert.Equal("Vårt kjøkken", (await Household(ola)).Name);

        // …and regenerates the code.
        var regenerate = await kari.PostAsJsonAsync("/api/v1/household/regenerate-code", new { });
        var updated = (await regenerate.Content.ReadFromJsonAsync<HouseholdResponse>())!;
        Assert.NotEqual(oldCode, updated.JoinCode);

        var (nils, _) = await factory.RegisterUserAsync("Nils");
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await nils.PostAsJsonAsync("/api/v1/household/join", new JoinRequest(oldCode))).StatusCode);
        await Join(nils, updated.JoinCode);
        Assert.Equal(3, (await Household(nils)).Members.Count);
    }

    [Fact]
    public async Task Rename_rejects_blank_names()
    {
        var (client, _) = await factory.RegisterUserAsync();
        var response = await client.PutAsJsonAsync("/api/v1/household", new RenameRequest("  "));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build && dotnet test --filter HouseholdApiTests`
Expected: build succeeds (DTOs exist); tests FAIL with 404s (no controller). Capture as RED.

- [ ] **Step 3: Implement service, controller, DI**

Create `Ingredo.Api/Households/IHouseholdService.cs`:

```csharp
using Ingredo.Api.Auth;
using Ingredo.Api.Common;

namespace Ingredo.Api.Households;

public interface IHouseholdService
{
    Task<HouseholdResponse> GetAsync(Guid householdId, CancellationToken cancellationToken);
    Task<HouseholdResponse> RenameAsync(Guid householdId, string name, CancellationToken cancellationToken);
    Task<HouseholdResponse> RegenerateCodeAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> JoinAsync(Guid userId, Guid currentHouseholdId, string code, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> LeaveAsync(Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/Households/HouseholdService.cs`:

```csharp
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Households;

public sealed class HouseholdService(
    AppDbContext db,
    IAuthService auth,
    IJoinCodeService joinCodes) : IHouseholdService
{
    public async Task<HouseholdResponse> GetAsync(Guid householdId, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        var members = await db.HouseholdMembers
            .Where(m => m.HouseholdId == householdId)
            .Join(
                db.Users,
                m => m.UserId,
                u => u.Id,
                (m, u) => new
                {
                    u.Id,
                    u.DisplayName,
                    m.Role,
                    m.CreatedAt,
                })
            .ToListAsync(cancellationToken);

        return new HouseholdResponse(
            household.Id,
            household.Name,
            JoinCodeGenerator.FormatForDisplay(household.JoinCode),
            members
                .OrderBy(m => m.CreatedAt)
                .ThenBy(m => m.Id)
                .Select(m => new MemberResponse(
                    m.Id, m.DisplayName, m.Role.ToString().ToLowerInvariant(), m.CreatedAt))
                .ToList());
    }

    public async Task<HouseholdResponse> RenameAsync(
        Guid householdId, string name, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        household.Name = name.Trim();
        household.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetAsync(householdId, cancellationToken);
    }

    public async Task<HouseholdResponse> RegenerateCodeAsync(
        Guid householdId, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        household.JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken);
        household.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetAsync(householdId, cancellationToken);
    }

    public async Task<ServiceResult<AuthResponse>> JoinAsync(
        Guid userId, Guid currentHouseholdId, string code, CancellationToken cancellationToken)
    {
        var canonical = JoinCodeGenerator.Canonicalize(code);
        if (canonical is null) return ServiceResult<AuthResponse>.NotFound();

        var target = await db.Households.FirstOrDefaultAsync(
            h => h.JoinCode == canonical, cancellationToken);
        if (target is null) return ServiceResult<AuthResponse>.NotFound();
        if (target.Id == currentHouseholdId) return ServiceResult<AuthResponse>.Conflict();

        var now = DateTimeOffset.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var othersRemain = await db.HouseholdMembers.AnyAsync(
            m => m.HouseholdId == currentHouseholdId && m.UserId != userId, cancellationToken);

        db.HouseholdMembers.Remove(membership);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = target.Id,
            Role = HouseholdRole.Member,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);

        if (!othersRemain)
        {
            // Personal household: the content merges into the new home, then
            // the empty shell is deleted. Re-home BEFORE delete — the FK
            // cascade would otherwise take the recipes down with the shell.
            await db.Recipes
                .IgnoreQueryFilters()
                .Where(r => r.HouseholdId == currentHouseholdId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(r => r.HouseholdId, target.Id)
                        .SetProperty(r => r.UpdatedAt, now),
                    cancellationToken);
            await db.Households
                .Where(h => h.Id == currentHouseholdId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(await auth.IssueTokensAsync(userId, cancellationToken));
    }

    public async Task<ServiceResult<AuthResponse>> LeaveAsync(
        Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken)
    {
        var others = await db.HouseholdMembers
            .Where(m => m.HouseholdId == currentHouseholdId && m.UserId != userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);
        if (others.Count == 0) return ServiceResult<AuthResponse>.Conflict();

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        if (membership.Role == HouseholdRole.Owner)
        {
            others[0].Role = HouseholdRole.Owner;
        }
        db.HouseholdMembers.Remove(membership);

        var personal = new Household
        {
            Id = Guid.NewGuid(),
            Name = user.DisplayName,
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Households.Add(personal);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = personal.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(await auth.IssueTokensAsync(userId, cancellationToken));
    }
}
```

Create `Ingredo.Api/Households/HouseholdController.cs`:

```csharp
using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Households;

[ApiController]
[Route("api/v1/household")]
[Authorize]
public sealed class HouseholdController(
    IHouseholdService service,
    IValidator<RenameRequest> renameValidator,
    IValidator<JoinRequest> joinValidator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);
    private Guid UserId => Guid.Parse(User.FindFirstValue("sub")!);

    [HttpGet]
    public async Task<HouseholdResponse> Get(CancellationToken cancellationToken) =>
        await service.GetAsync(HouseholdId, cancellationToken);

    [HttpPut]
    public async Task<IActionResult> Rename(RenameRequest request, CancellationToken cancellationToken)
    {
        var validation = await renameValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        return Ok(await service.RenameAsync(HouseholdId, request.Name, cancellationToken));
    }

    [HttpPost("regenerate-code")]
    public async Task<HouseholdResponse> RegenerateCode(CancellationToken cancellationToken) =>
        await service.RegenerateCodeAsync(HouseholdId, cancellationToken);

    [HttpPost("join")]
    public async Task<IActionResult> Join(JoinRequest request, CancellationToken cancellationToken)
    {
        var validation = await joinValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.JoinAsync(UserId, HouseholdId, request.Code, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.NotFound => NotFound(),
            ServiceStatus.Conflict => Conflict(),
            _ => Ok(result.Value),
        };
    }

    [HttpPost("leave")]
    public async Task<IActionResult> Leave(CancellationToken cancellationToken)
    {
        var result = await service.LeaveAsync(UserId, HouseholdId, cancellationToken);
        return result.Status == ServiceStatus.Conflict ? Conflict() : Ok(result.Value);
    }
}
```

In `Program.cs`, add:

```csharp
builder.Services.AddScoped<IHouseholdService, HouseholdService>();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 79 tests (69 after Task 3 + 10 household integration; report actual).

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add household join, leave, rename, and code endpoints"
```

---

### Task 5: Docs, compose smoke, and final verification

**Files:**
- Modify: `backend/README.md`, root `docs/TESTING.md`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Full automated pass**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build
dotnet test
```

Expected: zero warnings; full suite green.

- [ ] **Step 2: Compose two-user join smoke**

```bash
docker compose up -d --build
sleep 15
TOKEN_A=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"kari@test.local","password":"passord123","displayName":"Kari"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
TOKEN_B=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ola@test.local","password":"passord123","displayName":"Ola"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST http://localhost:8080/api/v1/recipes -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"title":"Karis vafler","servings":4,"ingredients":[],"instructions":[]}' > /dev/null
CODE_B=$(curl -s -H "Authorization: Bearer $TOKEN_B" http://localhost:8080/api/v1/household \
  | grep -o '"joinCode":"[^"]*"' | cut -d'"' -f4)
TOKEN_A2=$(curl -s -X POST http://localhost:8080/api/v1/household/join -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE_B\"}" \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -H "Authorization: Bearer $TOKEN_B" http://localhost:8080/api/v1/recipes | grep -o '"title":"Karis vafler"'  # Ola sees Kari's recipe
curl -s -H "Authorization: Bearer $TOKEN_A2" http://localhost:8080/api/v1/household | grep -o '"displayName":"Ola"' && echo SMOKE-OK
docker compose down
```

Expected: both greps match. (Fresh volume — after the JoinCode migration a stale volume needs the documented `docker compose down -v` once; do that first if startup fails.)

- [ ] **Step 3: Docs**

In `backend/README.md`, add after the Auth section:

```markdown
## Household

- `GET /api/v1/household` — name, join code (`XXX-XXX`), members.
- `PUT /api/v1/household` `{ name }`, `POST /api/v1/household/regenerate-code` — any member.
- `POST /api/v1/household/join` `{ code }` — moves you to that household; if you
  were alone, your recipes move with you and your empty household is deleted.
  Returns a fresh token pair (the old access token's household claim is stale).
- `POST /api/v1/household/leave` — back to a fresh personal household; content
  stays with the household you left. Also returns a fresh token pair.
```

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Household mechanics (manual pass)

- Register two users via Scalar; read user B's join code from `GET /household`; join as A → response carries new tokens; with them, both users list BOTH users' pre-join recipes.
- A's old join code now 404s for a third user (empty personal household deleted).
- Rename and regenerate-code as the NON-owner member → visible to the other; the old code stops working, the new one joins.
- Leave as A → A gets a fresh personal household (empty recipe list); B keeps the shared recipes; B shows as owner.
- Sole-member leave and joining your own code both return 409; a garbage code 404s.
- Stale volume after upgrading: `docker compose down -v` once (JoinCode column).
```

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/README.md docs/TESTING.md
git commit -m "docs: add household endpoints to README and manual checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (alphabet/canonical/unique/retry/format → T1–T2), 2 (join semantics incl. sole-member transfer, re-home-before-delete, transaction → T4), 3 (leave/promotion/sole-member 409 → T4), 4 (AuthResponse on join/leave via `IssueTokensAsync` post-commit → T3–T4), 5 (any-member rename/regenerate + validation → T3–T4), 6 (endpoint surface → T4), 7 (recipes API untouched — no recipes file modified anywhere; sharing proven by the merge tests), 8 (house patterns, generator unit tests → T1/T3/T4). Non-goals untouched.
- **Known judgment calls:** `IssueTokensAsync` runs after the join/leave transaction commits — a crash between commit and token issuance leaves the membership moved with the client holding stale tokens; recoverable by login/refresh (HouseholdOf resolves the new membership), accepted. Join's `SingleAsync` on current membership relies on the claim's household matching an actual membership — a stale claim (user moved on another device within the 15-min window) throws → 500; same accepted staleness class as the auth spec, ledger-noted. `GetAsync` composes the anonymous projection client-side for ordering (small member counts). `HouseholdResponse.JoinCode` is always display-formatted; tests join with both formatted and raw variants. Leave posts an empty JSON body (`new { }`) — the endpoint takes no request DTO. The promotion updates `others[0]` loaded pre-removal — deterministic by the ORDER BY. Regenerate-while-joining race: a join validated against the old code that commits after regeneration is benign (membership added to the intended household); unique-index protects code collisions.
- **Type consistency check:** `IHouseholdService` signatures match every controller call; `IssueTokensAsync` added to `IAuthService` (T3) before `HouseholdService` consumes it (T4); `RegisterUserAsync`/`UseTokens` helper shapes match all test call sites; `MemberResponse.Role` is the lowercase string the tests assert (`"owner"`); the join test's regex `[A-HJKMNP-Z2-9]` equals the generator alphabet (A–H, J, K, M, N, P–Z, 2–9 — I, L, O, 0, 1 excluded) in both halves; `RecipeRequest(null, title, null, 4, null, [], [])` matches the record's positional shape from the recipes slice.
