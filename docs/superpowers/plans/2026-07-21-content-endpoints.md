# Meal-Plan & Shopping Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Household-scoped CRUD for meal-plan entries and shopping items (the recipes contract, twice — client Guids, full-replace PUT, tombstone DELETE), plus two hardening items: a deferrable unique constraint making one-household-per-user structural, and a guard middleware turning dead-household tokens into clean 401s.

**Architecture:** Feature folders `MealPlan/` and `Shopping/` on the house pattern. `ServiceStatus` gains `Invalid` for the one referential rule (meal-plan `RecipeId` must be a live recipe in the caller's household; foreign and nonexistent ids → identical 400). `HouseholdGuardMiddleware` sits after authorization and before endpoints; the anonymous `/auth/refresh` remains the escape hatch by construction.

**Tech Stack:** existing backend stack; no new packages.

**Spec:** `docs/superpowers/specs/2026-07-21-content-endpoints-design.md`

## Global Constraints

- `MealPlanEntry` and `ShoppingItem` exactly as specced (decisions 1–2): soft-delete filters, `DateOnly` date, lowercase `active|purchased` text status, opaque `Sources` string, indexes `(HouseholdId, Date)` / `(HouseholdId, Status)`.
- Endpoint contract identical to recipes: list household-scoped non-deleted (meal plan ordered `Date` then `SortOrder`, optional `from`/`to`; shopping ordered `UpdatedAt` desc), get/put/delete 404 on missing/deleted/foreign, POST honors client Guids with GLOBAL duplicate check → 409, PUT full-replace bumps `UpdatedAt`, DELETE soft + idempotent (already-deleted 204, never-existed 404).
- Referential rule: create/update of a meal-plan entry requires the recipe to exist, be non-deleted, and belong to the caller's household — violations return `ValidationProblemDetails` keyed `RecipeId`, identical whether foreign or nonexistent.
- Deferrable unique constraint on `HouseholdMembers.UserId` via raw SQL in the migration (`UNIQUE … DEFERRABLE INITIALLY DEFERRED`) — join/leave transactions must keep passing.
- Guard middleware: authenticated request with unparseable household claim OR nonexistent household row → bare 401; anonymous endpoints (health, login, register, refresh, logout) unaffected.
- Server does not enforce status↔purchasedAt consistency. No operation endpoints. Recipes API untouched except none.
- Keep csproj properties/pins, `public partial class Program;`, `[Collection("Api")]`. Run all commands from `/home/mrb/Work/Programming/ingredo/backend`. Green bar: `dotnet build` zero warnings, `dotnet test` green (Docker running).

## File Structure

- Create: `Ingredo.Api/Domain/{MealPlanEntry,ShoppingItem,ShoppingItemStatus}.cs`; `Ingredo.Api/Common/HouseholdGuardMiddleware.cs`; `Ingredo.Api/MealPlan/{MealPlanDtos,MealPlanValidators,IMealPlanService,MealPlanService,MealPlanController}.cs`; `Ingredo.Api/Shopping/{ShoppingDtos,ShoppingValidators,IShoppingService,ShoppingService,ShoppingController}.cs`; tests `Integration/{HouseholdGuardTests,MealPlanApiTests,ShoppingApiTests}.cs`, `Validators/{MealPlanValidatorTests,ShoppingValidatorTests}.cs`
- Modify: `Data/AppDbContext.cs` (+ migration `AddMealPlanAndShopping`), `Common/ServiceResult.cs` (+`Invalid`), `Program.cs`, `backend/README.md`, root `docs/TESTING.md`

---

### Task 1: Domain, DbContext, migration, and the deferrable constraint

**Files:**
- Create: `Ingredo.Api/Domain/MealPlanEntry.cs`, `Domain/ShoppingItemStatus.cs`, `Domain/ShoppingItem.cs`
- Modify: `Data/AppDbContext.cs`; generate + hand-extend `Data/Migrations/*_AddMealPlanAndShopping*`

**Interfaces:**
- Produces (used by Tasks 3–4): the two entity shapes and DbSets `MealPlanEntries`, `ShoppingItems`; the decision-5 constraint.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/content-endpoints
```

- [ ] **Step 1: Domain entities**

Create `Ingredo.Api/Domain/MealPlanEntry.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class MealPlanEntry
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
    public DateOnly Date { get; set; }
    public Guid RecipeId { get; set; }
    public int Servings { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
```

Create `Ingredo.Api/Domain/ShoppingItemStatus.cs`:

```csharp
namespace Ingredo.Api.Domain;

public enum ShoppingItemStatus
{
    Active,
    Purchased,
}
```

Create `Ingredo.Api/Domain/ShoppingItem.cs`:

```csharp
namespace Ingredo.Api.Domain;

// A dumb replicated row store: all shopping behavior (merge-on-add, shelf
// grouping, purchase flows) is client logic. Sources is an opaque JSON
// string the client owns; the server never parses it.
public class ShoppingItem
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public decimal? Quantity { get; set; }
    public string? Unit { get; set; }
    public string Sources { get; set; } = "[]";
    public ShoppingItemStatus Status { get; set; } = ShoppingItemStatus.Active;
    public DateTimeOffset? PurchasedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
```

- [ ] **Step 2: DbContext configuration**

In `Data/AppDbContext.cs`, add DbSets:

```csharp
    public DbSet<MealPlanEntry> MealPlanEntries => Set<MealPlanEntry>();
    public DbSet<ShoppingItem> ShoppingItems => Set<ShoppingItem>();
```

and append inside `OnModelCreating`:

```csharp
        modelBuilder.Entity<MealPlanEntry>(entry =>
        {
            entry.HasQueryFilter(e => e.DeletedAt == null);
            entry.HasIndex(e => new { e.HouseholdId, e.Date });
            entry
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(e => e.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
            entry
                .HasOne<Recipe>()
                .WithMany()
                .HasForeignKey(e => e.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ShoppingItem>(item =>
        {
            item.Property(i => i.Name).IsRequired().HasMaxLength(500);
            item.Property(i => i.NormalizedName).IsRequired().HasMaxLength(500);
            item.Property(i => i.Unit).HasMaxLength(50);
            item.Property(i => i.Sources).IsRequired().HasMaxLength(4000);
            item
                .Property(i => i.Status)
                .HasConversion(
                    status => status.ToString().ToLowerInvariant(),
                    value => Enum.Parse<ShoppingItemStatus>(value, true))
                .HasMaxLength(16);
            item.HasQueryFilter(i => i.DeletedAt == null);
            item.HasIndex(i => new { i.HouseholdId, i.Status });
            item
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(i => i.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
        });
```

- [ ] **Step 3: Generate the migration, then hand-append the deferrable constraint**

```bash
dotnet tool restore
dotnet tool run dotnet-ef -- migrations add AddMealPlanAndShopping --project Ingredo.Api --output-dir Data/Migrations
```

Open the generated `*_AddMealPlanAndShopping.cs` and append at the END of `Up(...)`:

```csharp
            // One household per user, enforced structurally. Deferrable so the
            // join flow's remove+add inside one transaction stays legal — the
            // constraint is checked at commit, not per statement.
            migrationBuilder.Sql("""
                ALTER TABLE "HouseholdMembers"
                ADD CONSTRAINT "AK_HouseholdMembers_OneHouseholdPerUser"
                UNIQUE ("UserId") DEFERRABLE INITIALLY DEFERRED;
                """);
```

and at the START of `Down(...)`:

```csharp
            migrationBuilder.Sql("""
                ALTER TABLE "HouseholdMembers"
                DROP CONSTRAINT "AK_HouseholdMembers_OneHouseholdPerUser";
                """);
```

(The constraint is raw-SQL-only — deliberately not in the EF model, so `has-pending-model-changes` stays clean; verify that below.)

- [ ] **Step 4: Verify**

```bash
dotnet build
dotnet tool run dotnet-ef -- migrations has-pending-model-changes --project Ingredo.Api
dotnet test
```

Expected: zero warnings; "No changes have been made to the model since the last migration."; full suite green (78/78 — the join/leave scenarios run against the deferred constraint and must keep passing; if any membership test fails with a unique-violation, STOP and report the failure verbatim).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add meal plan and shopping tables with membership constraint"
```

---

### Task 2: Household guard middleware

**Files:**
- Create: `Ingredo.Api/Common/HouseholdGuardMiddleware.cs`, `Ingredo.Api.Tests/Integration/HouseholdGuardTests.cs`
- Modify: `Program.cs`

**Interfaces:**
- Consumes: `TokenService.HouseholdClaim`; the household join flow (test setup).
- Produces: every authenticated request past the middleware has a verified-live household claim (Tasks 3–4's controllers can trust it; so can the existing ones).

- [ ] **Step 1: Write the failing tests**

Create `Ingredo.Api.Tests/Integration/HouseholdGuardTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class HouseholdGuardTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Tokens_for_a_dead_household_fail_with_401_until_refreshed()
    {
        var (kari, kariAuth) = await factory.RegisterUserAsync("Kari");
        var (ola, _) = await factory.RegisterUserAsync("Ola");
        var olaCode = (await ola.GetFromJsonAsync<HouseholdResponse>("/api/v1/household"))!.JoinCode;

        // Keep a second client on Kari's ORIGINAL tokens…
        var stale = factory.CreateClient();
        stale.UseTokens(kariAuth);

        // …then Kari (sole member) joins Ola: her old household is deleted.
        var joined = await kari.PostAsJsonAsync("/api/v1/household/join", new JoinRequest(olaCode));
        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/v1/recipes")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/v1/household")).StatusCode);

        // The anonymous refresh endpoint is the escape hatch: Kari's original
        // refresh token resolves her CURRENT membership.
        var refreshed = await stale.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(kariAuth.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        stale.UseTokens((await refreshed.Content.ReadFromJsonAsync<AuthResponse>())!);
        Assert.Equal(HttpStatusCode.OK, (await stale.GetAsync("/api/v1/household")).StatusCode);
    }

    [Fact]
    public async Task Healthy_tokens_pass_and_anonymous_endpoints_are_unaffected()
    {
        var (client, _) = await factory.RegisterUserAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/recipes")).StatusCode);

        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/health")).StatusCode);
        var login = await anonymous.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest("nobody@test.local", "passord123"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode); // from auth logic, not the guard
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter HouseholdGuardTests`
Expected: FAIL — the stale-token assertions get 200/500/empty behavior instead of 401 (no guard exists). The second test may already pass; that's fine.

- [ ] **Step 3: Implement**

Create `Ingredo.Api/Common/HouseholdGuardMiddleware.cs`:

```csharp
using Ingredo.Api.Auth;
using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Common;

// An access token can outlive its household: a sole-member join-away deletes
// the old household while issued tokens still carry its claim for up to the
// token lifetime. Fail those requests clean — 401 — so clients refresh and
// get tokens for their current membership. Also catches malformed claims,
// so downstream Guid.Parse accessors are safe by construction. Anonymous
// endpoints (health, login, register, refresh, logout) pass through
// untouched; refresh being anonymous is the deliberate escape hatch.
public sealed class HouseholdGuardMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var claim = context.User.FindFirst(TokenService.HouseholdClaim)?.Value;
            if (!Guid.TryParse(claim, out var householdId)
                || !await db.Households.AnyAsync(h => h.Id == householdId, context.RequestAborted))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }

        await next(context);
    }
}
```

In `Program.cs`, after `app.UseAuthorization();` add:

```csharp
app.UseMiddleware<HouseholdGuardMiddleware>();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 80 tests (78 + 2).

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: reject tokens for dead households with 401"
```

---

### Task 3: Meal-plan surface

**Files:**
- Create: `Ingredo.Api/MealPlan/{MealPlanDtos,MealPlanValidators,IMealPlanService,MealPlanService,MealPlanController}.cs`, `Ingredo.Api.Tests/Validators/MealPlanValidatorTests.cs`, `Ingredo.Api.Tests/Integration/MealPlanApiTests.cs`
- Modify: `Common/ServiceResult.cs` (+`Invalid`), `Program.cs` (DI)

**Interfaces:**
- Consumes: Task 1 entities; guard from Task 2 (implicit).
- Produces: `/api/v1/meal-plan-entries`; `ServiceStatus.Invalid` (also used by nothing else yet — shopping doesn't need it).

- [ ] **Step 1: Extend ServiceResult**

In `Common/ServiceResult.cs`: add enum member `Invalid` (after `Unauthorized`) and factory `public static ServiceResult<T> Invalid() => new(ServiceStatus.Invalid, default);`.

- [ ] **Step 2: Write the failing tests**

Create `Ingredo.Api.Tests/Validators/MealPlanValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Ingredo.Api.MealPlan;

namespace Ingredo.Api.Tests.Validators;

public class MealPlanValidatorTests
{
    private readonly MealPlanEntryRequestValidator _validator = new();

    private static MealPlanEntryRequest Valid() =>
        new(null, new DateOnly(2026, 7, 21), Guid.NewGuid(), 4, 0);

    [Fact]
    public void Accepts_a_valid_entry()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    public void Rejects_non_positive_servings(int servings)
    {
        _validator.TestValidate(Valid() with { Servings = servings })
            .ShouldHaveValidationErrorFor(r => r.Servings);
    }

    [Fact]
    public void Rejects_negative_sort_order_and_accepts_zero()
    {
        _validator.TestValidate(Valid() with { SortOrder = -1 })
            .ShouldHaveValidationErrorFor(r => r.SortOrder);
        _validator.TestValidate(Valid() with { SortOrder = 0 }).ShouldNotHaveAnyValidationErrors();
    }
}
```

Create `Ingredo.Api.Tests/Integration/MealPlanApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.MealPlan;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class MealPlanApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HttpClient _client = null!;
    private Guid _recipeId;

    public async Task InitializeAsync()
    {
        _client = await factory.CreateAuthenticatedClientAsync();
        var recipe = await (await _client.PostAsJsonAsync(
                "/api/v1/recipes",
                new RecipeRequest(null, "Taco", null, 4, null, [], [])))
            .Content.ReadFromJsonAsync<RecipeResponse>();
        _recipeId = recipe!.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private MealPlanEntryRequest NewEntry(
        string date = "2026-07-21", int servings = 4, int sortOrder = 0, Guid? id = null) =>
        new(id, DateOnly.Parse(date), _recipeId, servings, sortOrder);

    [Fact]
    public async Task Create_then_get_round_trips()
    {
        var created = await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var entry = await created.Content.ReadFromJsonAsync<MealPlanEntryResponse>();

        var fetched = await _client.GetFromJsonAsync<MealPlanEntryResponse>(
            $"/api/v1/meal-plan-entries/{entry!.Id}");
        Assert.Equal(new DateOnly(2026, 7, 21), fetched!.Date);
        Assert.Equal(_recipeId, fetched.RecipeId);
        Assert.Equal(4, fetched.Servings);
    }

    [Fact]
    public async Task Create_honors_client_id_and_conflicts_on_reuse()
    {
        var id = Guid.NewGuid();
        var first = await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry(id: id));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry(id: id));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Unknown_and_foreign_recipes_get_the_identical_400()
    {
        var unknown = await _client.PostAsJsonAsync(
            "/api/v1/meal-plan-entries",
            NewEntry() with { RecipeId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        var unknownBody = await unknown.Content.ReadAsStringAsync();
        Assert.Contains("RecipeId", unknownBody);

        var (other, _) = await factory.RegisterUserAsync();
        var foreignRecipe = await (await other.PostAsJsonAsync(
                "/api/v1/recipes", new RecipeRequest(null, "Fremmed", null, 2, null, [], [])))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var foreign = await _client.PostAsJsonAsync(
            "/api/v1/meal-plan-entries",
            NewEntry() with { RecipeId = foreignRecipe!.Id });
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);

        static string Normalized(string body) =>
            System.Text.RegularExpressions.Regex.Replace(
                body, "\"traceId\":\"[^\"]*\"", "\"traceId\":\"-\"");
        Assert.Equal(Normalized(unknownBody), Normalized(await foreign.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task List_filters_by_date_range_and_orders_by_date_then_sort_order()
    {
        await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry("2026-07-22", sortOrder: 1));
        await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry("2026-07-22", sortOrder: 0));
        await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry("2026-07-20"));
        await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry("2026-07-28"));

        var all = await _client.GetFromJsonAsync<List<MealPlanEntryResponse>>("/api/v1/meal-plan-entries");
        Assert.Equal(4, all!.Count);
        Assert.Equal(
            [("2026-07-20", 0), ("2026-07-22", 0), ("2026-07-22", 1), ("2026-07-28", 0)],
            all.Select(e => (e.Date.ToString("yyyy-MM-dd"), e.SortOrder)));

        var week = await _client.GetFromJsonAsync<List<MealPlanEntryResponse>>(
            "/api/v1/meal-plan-entries?from=2026-07-20&to=2026-07-26");
        Assert.Equal(3, week!.Count);
        Assert.DoesNotContain(week, e => e.Date == new DateOnly(2026, 7, 28));
    }

    [Fact]
    public async Task Update_replaces_and_bumps_updated_at()
    {
        var created = await (await _client.PostAsJsonAsync(
                "/api/v1/meal-plan-entries", NewEntry(servings: 2)))
            .Content.ReadFromJsonAsync<MealPlanEntryResponse>();

        await Task.Delay(10);
        var updated = await _client.PutAsJsonAsync(
            $"/api/v1/meal-plan-entries/{created!.Id}",
            NewEntry("2026-07-23", servings: 6, sortOrder: 2));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var entry = await updated.Content.ReadFromJsonAsync<MealPlanEntryResponse>();

        Assert.Equal(6, entry!.Servings);
        Assert.Equal(new DateOnly(2026, 7, 23), entry.Date);
        Assert.True(entry.UpdatedAt > created.UpdatedAt);
    }

    [Fact]
    public async Task Delete_is_soft_and_idempotent_and_update_of_unknown_is_404()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry()))
            .Content.ReadFromJsonAsync<MealPlanEntryResponse>();

        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/meal-plan-entries/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.GetAsync($"/api/v1/meal-plan-entries/{created.Id}")).StatusCode);
        Assert.Empty((await _client.GetFromJsonAsync<List<MealPlanEntryResponse>>(
            "/api/v1/meal-plan-entries"))!);
        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/meal-plan-entries/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.DeleteAsync($"/api/v1/meal-plan-entries/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.PutAsJsonAsync(
                $"/api/v1/meal-plan-entries/{Guid.NewGuid()}", NewEntry())).StatusCode);
    }

    [Fact]
    public async Task Households_are_isolated()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/meal-plan-entries", NewEntry()))
            .Content.ReadFromJsonAsync<MealPlanEntryResponse>();

        var other = await factory.CreateAuthenticatedClientAsync();
        Assert.Empty((await other.GetFromJsonAsync<List<MealPlanEntryResponse>>(
            "/api/v1/meal-plan-entries"))!);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.GetAsync($"/api/v1/meal-plan-entries/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.DeleteAsync($"/api/v1/meal-plan-entries/{created.Id}")).StatusCode);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — the MealPlan types don't exist (RED).

- [ ] **Step 4: Implement**

Create `Ingredo.Api/MealPlan/MealPlanDtos.cs`:

```csharp
namespace Ingredo.Api.MealPlan;

public sealed record MealPlanEntryRequest(
    Guid? Id,
    DateOnly Date,
    Guid RecipeId,
    int Servings,
    int SortOrder);

public sealed record MealPlanEntryResponse(
    Guid Id,
    DateOnly Date,
    Guid RecipeId,
    int Servings,
    int SortOrder,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
```

Create `Ingredo.Api/MealPlan/MealPlanValidators.cs`:

```csharp
using FluentValidation;

namespace Ingredo.Api.MealPlan;

public sealed class MealPlanEntryRequestValidator : AbstractValidator<MealPlanEntryRequest>
{
    public MealPlanEntryRequestValidator()
    {
        RuleFor(r => r.Servings).GreaterThanOrEqualTo(1);
        RuleFor(r => r.SortOrder).GreaterThanOrEqualTo(0);
    }
}
```

Create `Ingredo.Api/MealPlan/IMealPlanService.cs`:

```csharp
using Ingredo.Api.Common;

namespace Ingredo.Api.MealPlan;

public interface IMealPlanService
{
    Task<List<MealPlanEntryResponse>> ListAsync(
        Guid householdId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> CreateAsync(Guid householdId, MealPlanEntryRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> UpdateAsync(Guid householdId, Guid id, MealPlanEntryRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/MealPlan/MealPlanService.cs`:

```csharp
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.MealPlan;

public sealed class MealPlanService(AppDbContext db) : IMealPlanService
{
    public async Task<List<MealPlanEntryResponse>> ListAsync(
        Guid householdId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        var query = db.MealPlanEntries.Where(e => e.HouseholdId == householdId);
        if (from is { } fromDate) query = query.Where(e => e.Date >= fromDate);
        if (to is { } toDate) query = query.Where(e => e.Date <= toDate);

        return await query
            .OrderBy(e => e.Date)
            .ThenBy(e => e.SortOrder)
            .Select(e => ToResponse(e))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> GetAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var entry = await Find(householdId, id, cancellationToken);
        return entry is null
            ? ServiceResult<MealPlanEntryResponse>.NotFound()
            : ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> CreateAsync(
        Guid householdId, MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        if (!await RecipeIsOurs(householdId, request.RecipeId, cancellationToken))
        {
            return ServiceResult<MealPlanEntryResponse>.Invalid();
        }

        if (request.Id is { } requestedId)
        {
            var exists = await db.MealPlanEntries
                .IgnoreQueryFilters()
                .AnyAsync(e => e.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<MealPlanEntryResponse>.Conflict();
        }

        var now = DateTimeOffset.UtcNow;
        var entry = new MealPlanEntry
        {
            Id = request.Id ?? Guid.NewGuid(),
            HouseholdId = householdId,
            Date = request.Date,
            RecipeId = request.RecipeId,
            Servings = request.Servings,
            SortOrder = request.SortOrder,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.MealPlanEntries.Add(entry);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> UpdateAsync(
        Guid householdId, Guid id, MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        var entry = await Find(householdId, id, cancellationToken);
        if (entry is null) return ServiceResult<MealPlanEntryResponse>.NotFound();

        if (!await RecipeIsOurs(householdId, request.RecipeId, cancellationToken))
        {
            return ServiceResult<MealPlanEntryResponse>.Invalid();
        }

        entry.Date = request.Date;
        entry.RecipeId = request.RecipeId;
        entry.Servings = request.Servings;
        entry.SortOrder = request.SortOrder;
        entry.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> DeleteAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var entry = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                e => e.Id == id && e.HouseholdId == householdId, cancellationToken);
        if (entry is null) return ServiceResult<MealPlanEntryResponse>.NotFound();
        if (entry.DeletedAt is not null) return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));

        var now = DateTimeOffset.UtcNow;
        entry.DeletedAt = now;
        entry.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    private Task<MealPlanEntry?> Find(Guid householdId, Guid id, CancellationToken cancellationToken) =>
        db.MealPlanEntries.FirstOrDefaultAsync(
            e => e.Id == id && e.HouseholdId == householdId, cancellationToken);

    // The one referential rule: the recipe must be a live recipe in the
    // caller's household. Foreign and nonexistent are indistinguishable.
    private Task<bool> RecipeIsOurs(Guid householdId, Guid recipeId, CancellationToken cancellationToken) =>
        db.Recipes.AnyAsync(
            r => r.Id == recipeId && r.HouseholdId == householdId, cancellationToken);

    private static MealPlanEntryResponse ToResponse(MealPlanEntry entry) =>
        new(entry.Id, entry.Date, entry.RecipeId, entry.Servings, entry.SortOrder,
            entry.CreatedAt, entry.UpdatedAt);
}
```

Create `Ingredo.Api/MealPlan/MealPlanController.cs`:

```csharp
using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.MealPlan;

[ApiController]
[Route("api/v1/meal-plan-entries")]
[Authorize]
public sealed class MealPlanController(
    IMealPlanService service,
    IValidator<MealPlanEntryRequest> validator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);

    [HttpGet]
    public Task<List<MealPlanEntryResponse>> List(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken) =>
        service.ListAsync(HouseholdId, from, to, cancellationToken);

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(HouseholdId, id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> Create(
        MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.CreateAsync(HouseholdId, request, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.Invalid => UnknownRecipeProblem(),
            ServiceStatus.Conflict => Conflict(),
            _ => CreatedAtAction(nameof(Get), new { id = result.Value!.Id }, result.Value),
        };
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id, MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.UpdateAsync(HouseholdId, id, request, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.NotFound => NotFound(),
            ServiceStatus.Invalid => UnknownRecipeProblem(),
            _ => Ok(result.Value),
        };
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(HouseholdId, id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : NoContent();
    }

    private IActionResult UnknownRecipeProblem()
    {
        ModelState.AddModelError("RecipeId", "Unknown recipe.");
        return ValidationProblem(ModelState);
    }
}
```

In `Program.cs`, add DI (with the other services): `builder.Services.AddScoped<IMealPlanService, MealPlanService>();` and `using Ingredo.Api.MealPlan;`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 91 tests (80 + 4 validator + 7 integration; report actual).

- [ ] **Step 6: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add meal plan entry endpoints"
```

---

### Task 4: Shopping surface

**Files:**
- Create: `Ingredo.Api/Shopping/{ShoppingDtos,ShoppingValidators,IShoppingService,ShoppingService,ShoppingController}.cs`, `Ingredo.Api.Tests/Validators/ShoppingValidatorTests.cs`, `Ingredo.Api.Tests/Integration/ShoppingApiTests.cs`
- Modify: `Program.cs` (DI)

**Interfaces:**
- Consumes: Task 1 entities.
- Produces: `/api/v1/shopping-items`.

- [ ] **Step 1: Write the failing tests**

Create `Ingredo.Api.Tests/Validators/ShoppingValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Ingredo.Api.Shopping;

namespace Ingredo.Api.Tests.Validators;

public class ShoppingValidatorTests
{
    private readonly ShoppingItemRequestValidator _validator = new();

    private static ShoppingItemRequest Valid() =>
        new(null, "Melk", "melk", 1000, "ml", "[]", "active", null);

    [Fact]
    public void Accepts_a_valid_item_and_a_purchased_variant()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
        _validator.TestValidate(Valid() with
        {
            Status = "Purchased",
            PurchasedAt = DateTimeOffset.UtcNow,
        }).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_names(string value)
    {
        var result = _validator.TestValidate(Valid() with { Name = value, NormalizedName = value });
        result.ShouldHaveValidationErrorFor(r => r.Name);
        result.ShouldHaveValidationErrorFor(r => r.NormalizedName);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_non_positive_quantity_but_accepts_null(decimal quantity)
    {
        _validator.TestValidate(Valid() with { Quantity = quantity })
            .ShouldHaveValidationErrorFor(r => r.Quantity);
        _validator.TestValidate(Valid() with { Quantity = null }).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("bought")]
    [InlineData("")]
    [InlineData("2")]
    public void Rejects_unknown_status(string status)
    {
        _validator.TestValidate(Valid() with { Status = status })
            .ShouldHaveValidationErrorFor(r => r.Status);
    }

    [Fact]
    public void Rejects_missing_sources()
    {
        _validator.TestValidate(Valid() with { Sources = "" })
            .ShouldHaveValidationErrorFor(r => r.Sources);
    }
}
```

Create `Ingredo.Api.Tests/Integration/ShoppingApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Shopping;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class ShoppingApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HttpClient _client = null!;

    public async Task InitializeAsync() => _client = await factory.CreateAuthenticatedClientAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static ShoppingItemRequest NewItem(
        string name = "Melk", string status = "active", Guid? id = null) =>
        new(id, name, name.ToLowerInvariant(), 1000, "ml", "[\"Pannekaker\"]", status, null);

    [Fact]
    public async Task Create_then_get_round_trips_including_opaque_sources()
    {
        var created = await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await created.Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var fetched = await _client.GetFromJsonAsync<ShoppingItemResponse>(
            $"/api/v1/shopping-items/{item!.Id}");
        Assert.Equal("Melk", fetched!.Name);
        Assert.Equal("melk", fetched.NormalizedName);
        Assert.Equal("[\"Pannekaker\"]", fetched.Sources);
        Assert.Equal("active", fetched.Status);
        Assert.Null(fetched.PurchasedAt);
    }

    [Fact]
    public async Task Status_and_purchased_at_are_client_owned_row_state()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var purchasedAt = DateTimeOffset.UtcNow;
        var updated = await _client.PutAsJsonAsync(
            $"/api/v1/shopping-items/{created!.Id}",
            NewItem(status: "Purchased") with { PurchasedAt = purchasedAt });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var item = await updated.Content.ReadFromJsonAsync<ShoppingItemResponse>();

        Assert.Equal("purchased", item!.Status);
        Assert.NotNull(item.PurchasedAt);
        Assert.True(item.UpdatedAt >= created.UpdatedAt);
    }

    [Fact]
    public async Task Create_honors_client_id_and_conflicts_on_reuse()
    {
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created,
            (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem(id: id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Ost", id: id))).StatusCode);
    }

    [Fact]
    public async Task List_excludes_deleted_and_orders_newest_first()
    {
        var a = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Eldst")))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();
        await Task.Delay(10);
        await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Nyest"));
        await _client.DeleteAsync($"/api/v1/shopping-items/{a!.Id}");

        var list = await _client.GetFromJsonAsync<List<ShoppingItemResponse>>("/api/v1/shopping-items");
        var only = Assert.Single(list!);
        Assert.Equal("Nyest", only.Name);
    }

    [Fact]
    public async Task Delete_is_soft_and_idempotent_and_unknown_is_404()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.GetAsync($"/api/v1/shopping-items/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Households_are_isolated()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var other = await factory.CreateAuthenticatedClientAsync();
        Assert.Empty((await other.GetFromJsonAsync<List<ShoppingItemResponse>>(
            "/api/v1/shopping-items"))!);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.GetAsync($"/api/v1/shopping-items/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync(
                $"/api/v1/shopping-items/{created.Id}", NewItem("Kapret"))).StatusCode);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet build`
Expected: FAIL to compile — Shopping types don't exist (RED).

- [ ] **Step 3: Implement**

Create `Ingredo.Api/Shopping/ShoppingDtos.cs`:

```csharp
namespace Ingredo.Api.Shopping;

public sealed record ShoppingItemRequest(
    Guid? Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    DateTimeOffset? PurchasedAt);

public sealed record ShoppingItemResponse(
    Guid Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    DateTimeOffset? PurchasedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
```

Create `Ingredo.Api/Shopping/ShoppingValidators.cs`:

```csharp
using FluentValidation;
using Ingredo.Api.Domain;

namespace Ingredo.Api.Shopping;

public sealed class ShoppingItemRequestValidator : AbstractValidator<ShoppingItemRequest>
{
    public ShoppingItemRequestValidator()
    {
        RuleFor(r => r.Name)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Name must not be empty.")
            .MaximumLength(500);
        RuleFor(r => r.NormalizedName)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Normalized name must not be empty.")
            .MaximumLength(500);
        RuleFor(r => r.Quantity).GreaterThan(0).When(r => r.Quantity.HasValue);
        RuleFor(r => r.Unit).MaximumLength(50);
        RuleFor(r => r.Sources).NotEmpty().MaximumLength(4000);
        RuleFor(r => r.Status)
            .Must(status =>
                Enum.TryParse<ShoppingItemStatus>(status, true, out var parsed)
                && Enum.IsDefined(parsed))
            .WithMessage("Status must be 'active' or 'purchased'.");
    }
}
```

Create `Ingredo.Api/Shopping/IShoppingService.cs`:

```csharp
using Ingredo.Api.Common;

namespace Ingredo.Api.Shopping;

public interface IShoppingService
{
    Task<List<ShoppingItemResponse>> ListAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> CreateAsync(Guid householdId, ShoppingItemRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> UpdateAsync(Guid householdId, Guid id, ShoppingItemRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/Shopping/ShoppingService.cs`:

```csharp
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Shopping;

public sealed class ShoppingService(AppDbContext db) : IShoppingService
{
    public async Task<List<ShoppingItemResponse>> ListAsync(
        Guid householdId, CancellationToken cancellationToken)
    {
        return await db.ShoppingItems
            .Where(i => i.HouseholdId == householdId)
            .OrderByDescending(i => i.UpdatedAt)
            .Select(i => ToResponse(i))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<ShoppingItemResponse>> GetAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var item = await Find(householdId, id, cancellationToken);
        return item is null
            ? ServiceResult<ShoppingItemResponse>.NotFound()
            : ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> CreateAsync(
        Guid householdId, ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        if (request.Id is { } requestedId)
        {
            var exists = await db.ShoppingItems
                .IgnoreQueryFilters()
                .AnyAsync(i => i.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<ShoppingItemResponse>.Conflict();
        }

        var now = DateTimeOffset.UtcNow;
        var item = new ShoppingItem
        {
            Id = request.Id ?? Guid.NewGuid(),
            HouseholdId = householdId,
            Name = request.Name.Trim(),
            NormalizedName = request.NormalizedName.Trim(),
            Quantity = request.Quantity,
            Unit = request.Unit,
            Sources = request.Sources,
            Status = Enum.Parse<ShoppingItemStatus>(request.Status, true),
            PurchasedAt = request.PurchasedAt,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.ShoppingItems.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> UpdateAsync(
        Guid householdId, Guid id, ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        var item = await Find(householdId, id, cancellationToken);
        if (item is null) return ServiceResult<ShoppingItemResponse>.NotFound();

        item.Name = request.Name.Trim();
        item.NormalizedName = request.NormalizedName.Trim();
        item.Quantity = request.Quantity;
        item.Unit = request.Unit;
        item.Sources = request.Sources;
        item.Status = Enum.Parse<ShoppingItemStatus>(request.Status, true);
        item.PurchasedAt = request.PurchasedAt;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> DeleteAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var item = await db.ShoppingItems
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                i => i.Id == id && i.HouseholdId == householdId, cancellationToken);
        if (item is null) return ServiceResult<ShoppingItemResponse>.NotFound();
        if (item.DeletedAt is not null) return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));

        var now = DateTimeOffset.UtcNow;
        item.DeletedAt = now;
        item.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    private Task<ShoppingItem?> Find(Guid householdId, Guid id, CancellationToken cancellationToken) =>
        db.ShoppingItems.FirstOrDefaultAsync(
            i => i.Id == id && i.HouseholdId == householdId, cancellationToken);

    private static ShoppingItemResponse ToResponse(ShoppingItem item) =>
        new(item.Id, item.Name, item.NormalizedName, item.Quantity, item.Unit, item.Sources,
            item.Status.ToString().ToLowerInvariant(), item.PurchasedAt,
            item.CreatedAt, item.UpdatedAt);
}
```

Create `Ingredo.Api/Shopping/ShoppingController.cs`:

```csharp
using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Shopping;

[ApiController]
[Route("api/v1/shopping-items")]
[Authorize]
public sealed class ShoppingController(
    IShoppingService service,
    IValidator<ShoppingItemRequest> validator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);

    [HttpGet]
    public Task<List<ShoppingItemResponse>> List(CancellationToken cancellationToken) =>
        service.ListAsync(HouseholdId, cancellationToken);

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(HouseholdId, id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> Create(ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.CreateAsync(HouseholdId, request, cancellationToken);
        return result.Status == ServiceStatus.Conflict
            ? Conflict()
            : CreatedAtAction(nameof(Get), new { id = result.Value!.Id }, result.Value);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id, ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.UpdateAsync(HouseholdId, id, request, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(HouseholdId, id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : NoContent();
    }
}
```

In `Program.cs`, add DI: `builder.Services.AddScoped<IShoppingService, ShoppingService>();` and `using Ingredo.Api.Shopping;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 105 tests (91 + 8 validator + 6 integration; report actual).

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add shopping item endpoints"
```

---

### Task 5: Docs, compose smoke, and final verification

**Files:**
- Modify: `backend/README.md`, root `docs/TESTING.md`

- [ ] **Step 1: Full automated pass**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build
dotnet test
```

Expected: zero warnings, full suite green.

- [ ] **Step 2: Compose smoke (content endpoints ride the established two-user setup)**

```bash
docker compose down -v
docker compose up -d --build
sleep 18
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"passord123","displayName":"Smoke"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
RECIPE_ID=$(curl -s -X POST http://localhost:8080/api/v1/recipes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Taco","servings":4,"ingredients":[],"instructions":[]}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST http://localhost:8080/api/v1/meal-plan-entries -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"date\":\"2026-07-25\",\"recipeId\":\"$RECIPE_ID\",\"servings\":4,\"sortOrder\":0}" \
  | grep -o '"date":"2026-07-25"'
curl -s -X POST http://localhost:8080/api/v1/shopping-items -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Melk","normalizedName":"melk","quantity":1000,"unit":"ml","sources":"[]","status":"active"}' \
  | grep -o '"name":"Melk"' && echo SMOKE-OK
docker compose down
```

Expected: both greps match.

- [ ] **Step 3: Docs**

In `backend/README.md`, after the Household section add:

```markdown
## Meal plan & shopping

- `/api/v1/meal-plan-entries` and `/api/v1/shopping-items` — household-scoped CRUD
  with the same contract as recipes (client-mintable ids, full-replace PUT,
  soft DELETE). Meal-plan list accepts `?from=`/`?to=` (ISO dates).
- The server is a row store: shopping/meal-plan behavior (merging, shelf,
  purchase flows) is client logic. `sources` is opaque client JSON.
- Tokens whose household no longer exists get 401 everywhere — refresh to
  recover (the refresh endpoint resolves your current membership).
```

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Meal plan & shopping endpoints (manual pass)

- Via Scalar with a Bearer token: create a recipe → create a meal-plan entry for it → list with `from`/`to` covering the date → present; outside the range → absent.
- A meal-plan entry pointing at a made-up recipe id → 400 mentioning RecipeId.
- Create a shopping item; update it to `"status":"purchased"` with a `purchasedAt` → round-trips verbatim; DELETE → gone from list, second DELETE still 204.
- Second household sees none of it (list empty, direct GET 404).
- After a sole-member join-away, requests with the OLD access token → 401 (was 500/empty); `POST /auth/refresh` with the old refresh token recovers.
- Stale compose volume: `docker compose down -v` once (new tables + constraint).
```

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/README.md docs/TESTING.md
git commit -m "docs: add content endpoints to README and manual checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decisions 1–2 (entities/indexes/filters → T1), 3 (contract, ordering, date filters → T3–T4), 4 (referential rule + identical 400, traceId-normalized comparison test → T3), 5 (deferrable constraint riding the same migration, drift-check verified → T1), 6 (guard middleware + escape-hatch reasoning + both tests → T2), 7 (house patterns, smoke → all). Non-goals untouched: no operation endpoints, no aggregation, frontend untouched.
- **Known judgment calls:** the guard runs before authorization challenges bare-401 responses are… note: the guard sits after `UseAuthorization()`, so `[Authorize]`'s own 401 for anonymous requests happens at the endpoint layer — anonymous users never reach the guard's DB query (IsAuthenticated false → pass through, endpoint rejects). Meal-plan `Date` uses `DateOnly.Parse` in tests (ISO) matching System.Text.Json's default DateOnly handling. `Status_and_purchased_at_are_client_owned_row_state` asserts `UpdatedAt >=` (not `>`): a same-millisecond update is possible; `>=` avoids flake while the delete test keeps the strict `>` with its `Task.Delay`. The shopping list test relies on `UpdatedAt` ordering with a 10 ms delay. `ServiceStatus.Invalid` is meal-plan-only by design. The guard adds one indexed PK lookup per authenticated request incl. integration tests — accepted per spec.
- **Type consistency check:** `MealPlanEntryRequest` positional shape identical across validator tests, integration tests (`with` expressions), service, and controller; `ShoppingItemRequest` likewise; both controllers' `HouseholdId` accessor matches the established pattern (now guard-protected); `RegisterUserAsync`/`CreateAuthenticatedClientAsync`/`UseTokens` helpers already exist from prior slices with the shapes used here; `HouseholdResponse`/`JoinRequest`/`RefreshRequest`/`LoginRequest`/`AuthResponse` imports in guard tests match their defining namespaces.
