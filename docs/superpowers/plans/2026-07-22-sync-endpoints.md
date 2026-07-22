# Backend Sync Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trigger-assigned `SyncSeq` change sequencing on the three content tables, `GET /api/v1/sync/changes` (delta pull with tombstones and cursor), `POST /api/v1/sync/push` (per-row LWW with client-authored epoch-ms timestamps), and the guard fail-closed inversion.

**Architecture:** `Sync/` feature folder on the house pattern. `SyncSeq` is assigned by Postgres `BEFORE INSERT OR UPDATE` triggers from one shared sequence — every write path (CRUD, sync-applied, `ExecuteUpdate` re-home) is covered structurally; EF maps the column `ValueGeneratedOnAddOrUpdate` and never writes it. Sync push rows are mapped onto the CRUD request records and validated by the EXISTING validators (single source of validation truth); the meal-plan referential check is sync-specific (row existence incl. tombstoned → else per-row `conflict`). Client timestamps enter only here.

**Tech Stack:** existing backend stack; no new packages.

**Spec:** `docs/superpowers/specs/2026-07-22-sync-endpoints-design.md` (+ umbrella `2026-07-22-sync-architecture.md`)

## Global Constraints

- `SyncSeq bigint NOT NULL` on Recipes/MealPlanEntries/ShoppingItems only; `DEFAULT nextval('sync_seq')` + BEFORE INSERT OR UPDATE trigger per table (one shared `set_sync_seq()` function); EF: `ValueGeneratedOnAddOrUpdate` + `HasDefaultValueSql`; index `(HouseholdId, SyncSeq)` per table; drift check clean after the hand-edited migration.
- Pull: caller's household, `SyncSeq > since`, `IgnoreQueryFilters`, recipes as full aggregates, timestamps as epoch ms, `cursor` = max returned SyncSeq (or `since` when empty). The cursor-gap race is ACCEPTED and documented (spec decision 1) — do not add watermark machinery.
- Push LWW per row: absent → insert (client timestamps verbatim, caller's household); present in household → apply iff client `updatedAt` strictly > server `updatedAt` (compare epoch ms against `ToUnixTimeMilliseconds`), else `superseded`; present in another household → `conflict`; meal-plan row whose recipe has no row (any state) in the household → `conflict`. Apply order: recipes, entries, shopping. One transaction; single `SaveChangesAsync`; cursor from a post-save max query inside the transaction. Applied rows keep client timestamps — NO server-side `UpdatedAt` bump.
- Validation: map sync rows → CRUD request records → existing validators; any invalid row → whole-batch 400 `ValidationProblemDetails`. Meal-plan referential rule NOT reused (see above). Recipe children replace uses the established explicit-`AddRange` pattern (EF graph heuristic).
- Guard inversion: `[AllowAnonymous]` on register/login/refresh/logout; middleware skips ONLY on `IAllowAnonymous` metadata (IsAuthenticated precondition unchanged). Existing guard tests pass UNCHANGED.
- Keep csproj pins, `public partial class Program;`, `[Collection("Api")]`. Run from `/home/mrb/Work/Programming/ingredo/backend`. Green bar: zero warnings, full suite green (Docker running).

## File Structure

- Create: `Ingredo.Api/Sync/{SyncDtos,ISyncService,SyncService,SyncController}.cs`; `Ingredo.Api.Tests/Integration/SyncApiTests.cs`
- Modify: `Domain/{Recipe,MealPlanEntry,ShoppingItem}.cs` (+`SyncSeq`), `Data/AppDbContext.cs` (+ migration `AddSyncSeq` with hand-added SQL), `Auth/AuthController.cs`, `Common/HouseholdGuardMiddleware.cs`, `Program.cs` (DI), `Ingredo.Api.Tests/Integration/HouseholdGuardTests.cs`, `backend/README.md`, root `docs/TESTING.md`

---

### Task 1: SyncSeq column, triggers, migration

**Files:**
- Modify: `Domain/Recipe.cs`, `Domain/MealPlanEntry.cs`, `Domain/ShoppingItem.cs`, `Data/AppDbContext.cs`; generate + hand-extend migration `AddSyncSeq`.

**Interfaces:**
- Produces (used by Tasks 3–4): `SyncSeq long` on the three entities, trigger-assigned on every insert/update.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/sync-endpoints
cd backend
```

- [ ] **Step 1: Domain + DbContext**

Add to each of `Domain/Recipe.cs`, `Domain/MealPlanEntry.cs`, `Domain/ShoppingItem.cs` (after `DeletedAt`):

```csharp
    public long SyncSeq { get; set; }
```

In `Data/AppDbContext.cs`, inside each of the three entity configuration blocks, add:

```csharp
            recipe.Property(r => r.SyncSeq)
                .HasDefaultValueSql("nextval('sync_seq')")
                .ValueGeneratedOnAddOrUpdate();
            recipe.HasIndex(r => new { r.HouseholdId, r.SyncSeq });
```

(adjusting the lambda parameter per block: `recipe`/`entry`/`item`).

- [ ] **Step 2: Generate and hand-extend the migration**

```bash
dotnet tool restore
dotnet tool run dotnet-ef -- migrations add AddSyncSeq --project Ingredo.Api --output-dir Data/Migrations
```

Hand-edit the generated `*_AddSyncSeq.cs`: at the very START of `Up(...)` (the sequence must exist before the column defaults reference it):

```csharp
            migrationBuilder.Sql("""CREATE SEQUENCE sync_seq;""");
```

and at the END of `Up(...)` (after the generated AddColumn/CreateIndex operations):

```csharp
            // Trigger-assigned change sequencing: EVERY write path — CRUD,
            // sync-applied, and ExecuteUpdate bulk paths — gets a fresh
            // sequence value, structurally. The column default covers plain
            // SQL inserts; the trigger covers updates and overrides inserts.
            migrationBuilder.Sql("""
                CREATE FUNCTION set_sync_seq() RETURNS trigger AS $$
                BEGIN
                    NEW."SyncSeq" := nextval('sync_seq');
                    RETURN NEW;
                END $$ LANGUAGE plpgsql;

                CREATE TRIGGER recipes_sync_seq BEFORE INSERT OR UPDATE ON "Recipes"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                CREATE TRIGGER meal_plan_sync_seq BEFORE INSERT OR UPDATE ON "MealPlanEntries"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                CREATE TRIGGER shopping_sync_seq BEFORE INSERT OR UPDATE ON "ShoppingItems"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                """);
```

In `Down(...)`: at the START drop the triggers/function, and after the generated drops, the sequence:

```csharp
            migrationBuilder.Sql("""
                DROP TRIGGER recipes_sync_seq ON "Recipes";
                DROP TRIGGER meal_plan_sync_seq ON "MealPlanEntries";
                DROP TRIGGER shopping_sync_seq ON "ShoppingItems";
                DROP FUNCTION set_sync_seq();
                """);
```

(and at the END of `Down`:)

```csharp
            migrationBuilder.Sql("""DROP SEQUENCE sync_seq;""");
```

- [ ] **Step 3: Verify**

```bash
dotnet build
dotnet tool run dotnet-ef -- migrations has-pending-model-changes --project Ingredo.Api
dotnet test
```

Expected: zero warnings; drift clean; full suite green (108/108) — every existing CRUD/household test now exercises the triggers implicitly (any trigger error would fail them loudly). If EF's RETURNING read-back conflicts with the trigger (Npgsql emits `RETURNING "SyncSeq"` for ValueGeneratedOnAddOrUpdate and the trigger's value IS what returns — expected to work), capture any failure verbatim and STOP as BLOCKED rather than working around.

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add trigger-assigned sync sequence to content tables"
```

---

### Task 2: Guard fail-closed inversion

**Files:**
- Modify: `Auth/AuthController.cs`, `Common/HouseholdGuardMiddleware.cs`, `Ingredo.Api.Tests/Integration/HouseholdGuardTests.cs`

**Interfaces:**
- Produces: authenticated requests are guarded unless the endpoint explicitly allows anonymous access.

- [ ] **Step 1: Write the failing test**

Append to `HouseholdGuardTests`:

```csharp
    [Fact]
    public void Guard_fails_closed_only_anonymous_marked_endpoints_are_exempt()
    {
        // Structural assertion: every AuthController action that must stay
        // reachable with stale tokens carries [AllowAnonymous]; me does not.
        var anonymous = new[] { "Register", "Login", "Refresh", "Logout" };
        foreach (var name in anonymous)
        {
            var method = typeof(Ingredo.Api.Auth.AuthController).GetMethod(name)!;
            Assert.NotNull(
                method.GetCustomAttributes(
                    typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true)
                    .FirstOrDefault());
        }
        var me = typeof(Ingredo.Api.Auth.AuthController).GetMethod("Me")!;
        Assert.Empty(me.GetCustomAttributes(
            typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter HouseholdGuardTests`
Expected: the new test FAILS (no `[AllowAnonymous]` attributes exist); the two existing tests still pass.

- [ ] **Step 3: Implement**

1. `Auth/AuthController.cs`: add `using Microsoft.AspNetCore.Authorization;` and `[AllowAnonymous]` on `Register`, `Login`, `Refresh`, `Logout` (NOT `Me`).
2. `Common/HouseholdGuardMiddleware.cs`: replace the metadata check

```csharp
        // Skip guard for endpoints that don't require authorization
        var endpoint = context.GetEndpoint();
        var requiresAuth = endpoint?.Metadata.GetOrderedMetadata<IAuthorizeData>().Any() ?? false;

        if (context.User.Identity?.IsAuthenticated == true && requiresAuth)
```

with the fail-closed inversion:

```csharp
        // Fail closed: only endpoints that explicitly allow anonymous access
        // are exempt. A future endpoint that forgets [Authorize] is still
        // guarded; the anonymous refresh escape hatch is explicit.
        var endpoint = context.GetEndpoint();
        var allowsAnonymous =
            endpoint?.Metadata.GetMetadata<IAllowAnonymous>() is not null;

        if (!allowsAnonymous && context.User.Identity?.IsAuthenticated == true)
```

and swap the now-unused `using Microsoft.AspNetCore.Authorization;` if the interface moves — `IAllowAnonymous` lives in `Microsoft.AspNetCore.Authorization`; keep the using.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 109 (108 + 1). The existing dead-household + escape-hatch tests passing UNCHANGED is the proof the inversion preserved behavior.

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "harden: household guard fails closed with explicit anonymous exemptions"
```

---

### Task 3: Sync DTOs and delta pull

**Files:**
- Create: `Ingredo.Api/Sync/SyncDtos.cs`, `Sync/ISyncService.cs`, `Sync/SyncService.cs` (pull half), `Sync/SyncController.cs` (GET), first half of `Ingredo.Api.Tests/Integration/SyncApiTests.cs`
- Modify: `Program.cs` (DI)

**Interfaces:**
- Produces (used by Task 4): the DTO records; `ISyncService.PullAsync(Guid householdId, long since, CancellationToken): Task<SyncPullResponse>`.

- [ ] **Step 1: DTOs**

Create `Ingredo.Api/Sync/SyncDtos.cs`:

```csharp
namespace Ingredo.Api.Sync;

// Sync rows speak the frontend's native dialect: epoch-millisecond
// timestamps (Date.now()) and yyyy-MM-dd date strings. This is the ONLY
// surface where client-authored timestamps enter the server.
public sealed record SyncIngredientRow(Guid Id, string Name, decimal? Quantity, string? Unit, string Scaling, int SortOrder);

public sealed record SyncInstructionRow(Guid Id, string Text, int SortOrder);

public sealed record SyncRecipeRow(
    Guid Id,
    string Title,
    string? Description,
    int Servings,
    string? Notes,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt,
    List<SyncIngredientRow> Ingredients,
    List<SyncInstructionRow> Instructions);

public sealed record SyncMealPlanRow(
    Guid Id,
    string Date,
    Guid RecipeId,
    int Servings,
    int SortOrder,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt);

public sealed record SyncShoppingRow(
    Guid Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    long? PurchasedAt,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt);

public sealed record SyncPullResponse(
    List<SyncRecipeRow> Recipes,
    List<SyncMealPlanRow> MealPlanEntries,
    List<SyncShoppingRow> ShoppingItems,
    long Cursor);

public sealed record SyncPushRequest(
    List<SyncRecipeRow>? Recipes,
    List<SyncMealPlanRow>? MealPlanEntries,
    List<SyncShoppingRow>? ShoppingItems);

public sealed record SyncPushResponse(Dictionary<Guid, string> Results, long Cursor);
```

- [ ] **Step 2: Write the failing pull tests**

Create `Ingredo.Api.Tests/Integration/SyncApiTests.cs` (helpers reused across Task 4 — write the class shell + pull tests now):

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.MealPlan;
using Ingredo.Api.Recipes;
using Ingredo.Api.Shopping;
using Ingredo.Api.Sync;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class SyncApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HttpClient _client = null!;

    public async Task InitializeAsync() => _client = await factory.CreateAuthenticatedClientAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<SyncPullResponse> Pull(long since = 0, HttpClient? client = null) =>
        (await (client ?? _client).GetFromJsonAsync<SyncPullResponse>(
            $"/api/v1/sync/changes?since={since}"))!;

    private async Task<RecipeResponse> CreateRecipe(string title = "Taco")
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, title, null, 4, null,
                [new IngredientRequest(null, "Mel", 400, "g", "linear", 0)],
                [new InstructionRequest(null, "Bland.", 0)]));
        return (await response.Content.ReadFromJsonAsync<RecipeResponse>())!;
    }

    [Fact]
    public async Task Full_pull_returns_crud_written_content_with_aggregates_and_cursor()
    {
        var recipe = await CreateRecipe("Pull-test");
        await _client.PostAsJsonAsync("/api/v1/shopping-items",
            new ShoppingItemRequest(null, "Melk", "melk", 1000, "ml", "[]", "active", null));

        var pull = await Pull();

        var syncRecipe = Assert.Single(pull.Recipes, r => r.Id == recipe.Id);
        Assert.Equal("Pull-test", syncRecipe.Title);
        Assert.Equal("Mel", Assert.Single(syncRecipe.Ingredients).Name);
        Assert.Equal("Bland.", Assert.Single(syncRecipe.Instructions).Text);
        Assert.True(syncRecipe.UpdatedAt > 0);
        Assert.Null(syncRecipe.DeletedAt);
        Assert.Single(pull.ShoppingItems);
        Assert.True(pull.Cursor > 0);
    }

    [Fact]
    public async Task Incremental_pull_returns_only_changes_after_the_cursor_including_tombstones()
    {
        await CreateRecipe("Old");
        var first = await Pull();

        var newer = await CreateRecipe("New");
        await _client.DeleteAsync($"/api/v1/recipes/{newer.Id}");

        var second = await Pull(first.Cursor);

        Assert.DoesNotContain(second.Recipes, r => r.Title == "Old");
        var tombstone = Assert.Single(second.Recipes, r => r.Id == newer.Id);
        Assert.NotNull(tombstone.DeletedAt);
        Assert.True(second.Cursor > first.Cursor);

        var third = await Pull(second.Cursor);
        Assert.Empty(third.Recipes);
        Assert.Equal(second.Cursor, third.Cursor);
    }

    [Fact]
    public async Task Pull_is_household_scoped()
    {
        await CreateRecipe("Mine");
        var other = await factory.CreateAuthenticatedClientAsync();

        var pull = await Pull(0, other);

        Assert.Empty(pull.Recipes);
        Assert.Empty(pull.ShoppingItems);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `dotnet build && dotnet test --filter SyncApiTests`
Expected: build succeeds (DTOs exist); tests 404 (no controller). RED.

- [ ] **Step 4: Implement the pull half**

Create `Ingredo.Api/Sync/ISyncService.cs`:

```csharp
namespace Ingredo.Api.Sync;

public interface ISyncService
{
    Task<SyncPullResponse> PullAsync(Guid householdId, long since, CancellationToken cancellationToken);
    Task<SyncPushResponse> PushAsync(Guid householdId, SyncPushRequest request, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/Sync/SyncService.cs` with the pull implementation (Push throws `NotImplementedException` until Task 4 — commit note: intra-slice placeholder, removed next task):

```csharp
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Sync;

public sealed partial class SyncService(AppDbContext db) : ISyncService
{
    public async Task<SyncPullResponse> PullAsync(
        Guid householdId, long since, CancellationToken cancellationToken)
    {
        var recipes = await db.Recipes
            .IgnoreQueryFilters()
            .Where(r => r.HouseholdId == householdId && r.SyncSeq > since)
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .OrderBy(r => r.SyncSeq)
            .ToListAsync(cancellationToken);
        var entries = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .Where(e => e.HouseholdId == householdId && e.SyncSeq > since)
            .OrderBy(e => e.SyncSeq)
            .ToListAsync(cancellationToken);
        var items = await db.ShoppingItems
            .IgnoreQueryFilters()
            .Where(i => i.HouseholdId == householdId && i.SyncSeq > since)
            .OrderBy(i => i.SyncSeq)
            .ToListAsync(cancellationToken);

        var cursor = new[]
        {
            since,
            recipes.Count > 0 ? recipes[^1].SyncSeq : 0,
            entries.Count > 0 ? entries[^1].SyncSeq : 0,
            items.Count > 0 ? items[^1].SyncSeq : 0,
        }.Max();

        return new SyncPullResponse(
            recipes.Select(ToRow).ToList(),
            entries.Select(ToRow).ToList(),
            items.Select(ToRow).ToList(),
            cursor);
    }

    private static long Ms(DateTimeOffset value) => value.ToUnixTimeMilliseconds();

    private static long? Ms(DateTimeOffset? value) => value?.ToUnixTimeMilliseconds();

    private static SyncRecipeRow ToRow(Recipe recipe) =>
        new(
            recipe.Id, recipe.Title, recipe.Description, recipe.Servings, recipe.Notes,
            Ms(recipe.CreatedAt), Ms(recipe.UpdatedAt), Ms(recipe.DeletedAt),
            recipe.Ingredients
                .OrderBy(i => i.SortOrder)
                .Select(i => new SyncIngredientRow(
                    i.Id, i.Name, i.Quantity, i.Unit,
                    i.Scaling.ToString().ToLowerInvariant(), i.SortOrder))
                .ToList(),
            recipe.Instructions
                .OrderBy(i => i.SortOrder)
                .Select(i => new SyncInstructionRow(i.Id, i.Text, i.SortOrder))
                .ToList());

    private static SyncMealPlanRow ToRow(MealPlanEntry entry) =>
        new(
            entry.Id, entry.Date.ToString("yyyy-MM-dd"), entry.RecipeId,
            entry.Servings, entry.SortOrder,
            Ms(entry.CreatedAt), Ms(entry.UpdatedAt), Ms(entry.DeletedAt));

    private static SyncShoppingRow ToRow(ShoppingItem item) =>
        new(
            item.Id, item.Name, item.NormalizedName, item.Quantity, item.Unit,
            item.Sources, item.Status.ToString().ToLowerInvariant(), Ms(item.PurchasedAt),
            Ms(item.CreatedAt), Ms(item.UpdatedAt), Ms(item.DeletedAt));

    public Task<SyncPushResponse> PushAsync(
        Guid householdId, SyncPushRequest request, CancellationToken cancellationToken) =>
        throw new NotImplementedException("Task 4 of the sync-endpoints slice.");
}
```

Create `Ingredo.Api/Sync/SyncController.cs`:

```csharp
using System.Security.Claims;
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Sync;

[ApiController]
[Route("api/v1/sync")]
[Authorize]
public sealed class SyncController(ISyncService service) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);

    [HttpGet("changes")]
    public Task<SyncPullResponse> Changes(
        [FromQuery] long since, CancellationToken cancellationToken) =>
        service.PullAsync(HouseholdId, since, cancellationToken);
}
```

In `Program.cs`: `using Ingredo.Api.Sync;` and `builder.Services.AddScoped<ISyncService, SyncService>();`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 112 (109 + 3).

- [ ] **Step 6: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add sync delta pull with trigger-backed cursor"
```

---

### Task 4: LWW push

**Files:**
- Modify: `Sync/SyncService.cs` (replace the Push placeholder), `Sync/SyncController.cs` (POST), `Ingredo.Api.Tests/Integration/SyncApiTests.cs` (push scenarios)

**Interfaces:**
- Consumes: everything.
- Produces: the complete sync surface.

- [ ] **Step 1: Write the failing push tests**

Append to `SyncApiTests` (a `PushHelper` + scenarios; timestamps use explicit epoch values so LWW comparisons are deterministic):

```csharp
    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private async Task<SyncPushResponse> Push(SyncPushRequest request, HttpClient? client = null)
    {
        var response = await (client ?? _client).PostAsJsonAsync("/api/v1/sync/push", request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SyncPushResponse>())!;
    }

    private static SyncRecipeRow ClientRecipe(
        Guid id, string title, long updatedAt, long? deletedAt = null) =>
        new(id, title, null, 4, null, updatedAt - 10, updatedAt, deletedAt,
            [new SyncIngredientRow(Guid.NewGuid(), "Mel", 400, "g", "linear", 0)],
            [new SyncInstructionRow(Guid.NewGuid(), "Bland.", 0)]);

    [Fact]
    public async Task Push_inserts_new_rows_with_client_timestamps_verbatim()
    {
        var id = Guid.NewGuid();
        var updatedAt = Now() - 60_000; // authored a minute ago on-device

        var push = await Push(new SyncPushRequest([ClientRecipe(id, "Fra mobilen", updatedAt)], null, null));

        Assert.Equal("applied", push.Results[id]);
        var pulled = Assert.Single((await Pull()).Recipes, r => r.Id == id);
        Assert.Equal(updatedAt, pulled.UpdatedAt); // no server bump
        Assert.Equal("Fra mobilen", pulled.Title);
    }

    [Fact]
    public async Task Push_applies_newer_and_supersedes_older()
    {
        var recipe = await CreateRecipe("Server-versjon");
        var serverUpdatedAt = Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).UpdatedAt;

        var stale = await Push(new SyncPushRequest(
            [ClientRecipe(recipe.Id, "Gammel klient", serverUpdatedAt - 1000)], null, null));
        Assert.Equal("superseded", stale.Results[recipe.Id]);
        Assert.Equal("Server-versjon",
            Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).Title);

        var fresh = await Push(new SyncPushRequest(
            [ClientRecipe(recipe.Id, "Nyere klient", serverUpdatedAt + 1000)], null, null));
        Assert.Equal("applied", fresh.Results[recipe.Id]);
        Assert.Equal("Nyere klient",
            Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).Title);
    }

    [Fact]
    public async Task Tombstone_pushes_obey_the_same_clock()
    {
        var recipe = await CreateRecipe("Slettes kanskje");
        var serverUpdatedAt = Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).UpdatedAt;

        var newerDelete = await Push(new SyncPushRequest(
            [ClientRecipe(recipe.Id, "Slettes kanskje", serverUpdatedAt + 1000, serverUpdatedAt + 1000)],
            null, null));
        Assert.Equal("applied", newerDelete.Results[recipe.Id]);
        Assert.NotNull(Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).DeletedAt);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}")).StatusCode);

        var olderEdit = await Push(new SyncPushRequest(
            [ClientRecipe(recipe.Id, "For sent", serverUpdatedAt + 500)], null, null));
        Assert.Equal("superseded", olderEdit.Results[recipe.Id]);
    }

    [Fact]
    public async Task Cross_household_ids_conflict_without_leaking()
    {
        var mine = await CreateRecipe("Min");
        var other = await factory.CreateAuthenticatedClientAsync();

        var push = await Push(new SyncPushRequest(
            [ClientRecipe(mine.Id, "Kapret", Now() + 100_000)], null, null), other);

        Assert.Equal("conflict", push.Results[mine.Id]);
        Assert.Equal("Min", Assert.Single((await Pull()).Recipes, r => r.Id == mine.Id).Title);
    }

    [Fact]
    public async Task Meal_plan_rows_resolve_in_batch_and_conflict_without_their_recipe()
    {
        var recipeId = Guid.NewGuid();
        var entryId = Guid.NewGuid();
        var orphanId = Guid.NewGuid();
        var now = Now();

        var push = await Push(new SyncPushRequest(
            [ClientRecipe(recipeId, "Batch-oppskrift", now)],
            [
                new SyncMealPlanRow(entryId, "2026-07-25", recipeId, 4, 0, now, now, null),
                new SyncMealPlanRow(orphanId, "2026-07-25", Guid.NewGuid(), 4, 1, now, now, null),
            ],
            null));

        Assert.Equal("applied", push.Results[recipeId]);
        Assert.Equal("applied", push.Results[entryId]);
        Assert.Equal("conflict", push.Results[orphanId]);
        Assert.Single((await Pull()).MealPlanEntries, e => e.Id == entryId);
    }

    [Fact]
    public async Task Invalid_rows_fail_the_whole_batch_with_400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/sync/push", new SyncPushRequest(
            [ClientRecipe(Guid.NewGuid(), "", Now())], null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Title", body);
    }

    [Fact]
    public async Task Push_returns_a_cursor_covering_its_own_writes()
    {
        var id = Guid.NewGuid();
        var push = await Push(new SyncPushRequest([ClientRecipe(id, "Cursor-test", Now())], null, null));

        var incremental = await Pull(push.Cursor);
        Assert.DoesNotContain(incremental.Recipes, r => r.Id == id);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter SyncApiTests`
Expected: pull tests green; every push test fails with 500 (`NotImplementedException`). RED.

- [ ] **Step 3: Implement push**

In `Sync/SyncService.cs`, replace the placeholder `PushAsync` (the class gains constructor deps `IValidator<RecipeRequest> recipeValidator, IValidator<MealPlanEntryRequest> mealPlanValidator, IValidator<ShoppingItemRequest> shoppingValidator` — add usings for `FluentValidation`, `Ingredo.Api.Recipes`, `Ingredo.Api.MealPlan`, `Ingredo.Api.Shopping`, `Ingredo.Api.Common`):

```csharp
    public async Task<SyncPushResponse> PushAsync(
        Guid householdId, SyncPushRequest request, CancellationToken cancellationToken)
    {
        await ValidateBatchAsync(request, cancellationToken);

        var results = new Dictionary<Guid, string>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        foreach (var row in request.Recipes ?? [])
        {
            results[row.Id] = await ApplyRecipeAsync(householdId, row, cancellationToken);
        }
        foreach (var row in request.MealPlanEntries ?? [])
        {
            results[row.Id] = await ApplyMealPlanAsync(householdId, row, cancellationToken);
        }
        foreach (var row in request.ShoppingItems ?? [])
        {
            results[row.Id] = await ApplyShoppingAsync(householdId, row, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        var cursor = await CurrentCursorAsync(householdId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new SyncPushResponse(results, cursor);
    }
```

with the helpers:

```csharp
    private const string Applied = "applied";
    private const string Superseded = "superseded";
    private const string Conflict = "conflict";

    private static DateTimeOffset FromMs(long value) => DateTimeOffset.FromUnixTimeMilliseconds(value);

    private static DateTimeOffset? FromMs(long? value) =>
        value is { } ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : null;

    private async Task ValidateBatchAsync(SyncPushRequest request, CancellationToken cancellationToken)
    {
        foreach (var row in request.Recipes ?? [])
        {
            var mapped = new RecipeRequest(row.Id, row.Title, row.Description, row.Servings, row.Notes,
                row.Ingredients.Select(i => new IngredientRequest(
                    i.Id, i.Name, i.Quantity, i.Unit, i.Scaling, i.SortOrder)).ToList(),
                row.Instructions.Select(i => new InstructionRequest(i.Id, i.Text, i.SortOrder)).ToList());
            (await recipeValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
        foreach (var row in request.MealPlanEntries ?? [])
        {
            if (!DateOnly.TryParseExact(row.Date, "yyyy-MM-dd", out var date))
            {
                throw new SyncValidationException(row.Id, "Date", "Date must be yyyy-MM-dd.");
            }
            var mapped = new MealPlanEntryRequest(row.Id, date, row.RecipeId, row.Servings, row.SortOrder);
            (await mealPlanValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
        foreach (var row in request.ShoppingItems ?? [])
        {
            var mapped = new ShoppingItemRequest(row.Id, row.Name, row.NormalizedName, row.Quantity,
                row.Unit, row.Sources, row.Status, FromMs(row.PurchasedAt));
            (await shoppingValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
    }
```

Add a tiny exception + extension in the same file (bottom):

```csharp
public sealed class SyncValidationException(Guid rowId, string field, string message)
    : Exception($"{field}: {message}")
{
    public Guid RowId { get; } = rowId;
    public string Field { get; } = field;
    public string ErrorMessage { get; } = message;
}

file static class ValidationResultExtensions
{
    public static void ThrowIfInvalid(this FluentValidation.Results.ValidationResult result, Guid rowId)
    {
        if (result.IsValid) return;
        var first = result.Errors[0];
        throw new SyncValidationException(rowId, first.PropertyName, first.ErrorMessage);
    }
}
```

Apply helpers (LWW cores):

```csharp
    private async Task<string> ApplyRecipeAsync(
        Guid householdId, SyncRecipeRow row, CancellationToken cancellationToken)
    {
        var existing = await db.Recipes
            .IgnoreQueryFilters()
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .FirstOrDefaultAsync(r => r.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        var ingredients = row.DeletedAt is null
            ? row.Ingredients.Select(i => new RecipeIngredient
            {
                Id = i.Id, Name = i.Name.Trim(), Quantity = i.Quantity, Unit = i.Unit,
                Scaling = Enum.Parse<ScalingMode>(i.Scaling, true), SortOrder = i.SortOrder,
            }).ToList()
            : [];
        var instructions = row.DeletedAt is null
            ? row.Instructions.Select(i => new RecipeInstruction
            {
                Id = i.Id, Text = i.Text.Trim(), SortOrder = i.SortOrder,
            }).ToList()
            : [];

        if (existing is null)
        {
            db.Recipes.Add(new Recipe
            {
                Id = row.Id, HouseholdId = householdId, Title = row.Title.Trim(),
                Description = row.Description, Servings = row.Servings, Notes = row.Notes,
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
                Ingredients = ingredients, Instructions = instructions,
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Title = row.Title.Trim();
        existing.Description = row.Description;
        existing.Servings = row.Servings;
        existing.Notes = row.Notes;
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);
        existing.Ingredients.Clear();
        existing.Ingredients.AddRange(ingredients);
        existing.Instructions.Clear();
        existing.Instructions.AddRange(instructions);
        // Established EF pattern: children reached via navigation on a
        // tracked root need explicit Added state.
        db.RecipeIngredients.AddRange(ingredients);
        db.RecipeInstructions.AddRange(instructions);
        return Applied;
    }

    private async Task<string> ApplyMealPlanAsync(
        Guid householdId, SyncMealPlanRow row, CancellationToken cancellationToken)
    {
        var existing = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        // FK safety, not the CRUD live-recipe rule: a tombstoned recipe is a
        // legal replicated target. Local-pending recipes from the same batch
        // are visible here (tracked inserts flush on SaveChanges — use Local).
        var recipeExists =
            db.Recipes.Local.Any(r => r.Id == row.RecipeId && r.HouseholdId == householdId)
            || await db.Recipes.IgnoreQueryFilters()
                .AnyAsync(r => r.Id == row.RecipeId && r.HouseholdId == householdId, cancellationToken);
        if (!recipeExists) return Conflict;

        var date = DateOnly.ParseExact(row.Date, "yyyy-MM-dd");
        if (existing is null)
        {
            db.MealPlanEntries.Add(new MealPlanEntry
            {
                Id = row.Id, HouseholdId = householdId, Date = date, RecipeId = row.RecipeId,
                Servings = row.Servings, SortOrder = row.SortOrder,
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Date = date;
        existing.RecipeId = row.RecipeId;
        existing.Servings = row.Servings;
        existing.SortOrder = row.SortOrder;
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);
        return Applied;
    }

    private async Task<string> ApplyShoppingAsync(
        Guid householdId, SyncShoppingRow row, CancellationToken cancellationToken)
    {
        var existing = await db.ShoppingItems
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(i => i.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        var status = Enum.Parse<ShoppingItemStatus>(row.Status, true);
        if (existing is null)
        {
            db.ShoppingItems.Add(new ShoppingItem
            {
                Id = row.Id, HouseholdId = householdId, Name = row.Name.Trim(),
                NormalizedName = row.NormalizedName.Trim(), Quantity = row.Quantity,
                Unit = row.Unit, Sources = row.Sources, Status = status,
                PurchasedAt = FromMs(row.PurchasedAt),
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Name = row.Name.Trim();
        existing.NormalizedName = row.NormalizedName.Trim();
        existing.Quantity = row.Quantity;
        existing.Unit = row.Unit;
        existing.Sources = row.Sources;
        existing.Status = status;
        existing.PurchasedAt = FromMs(row.PurchasedAt);
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);
        return Applied;
    }

    private async Task<long> CurrentCursorAsync(Guid householdId, CancellationToken cancellationToken)
    {
        var recipeMax = await db.Recipes.IgnoreQueryFilters()
            .Where(r => r.HouseholdId == householdId)
            .MaxAsync(r => (long?)r.SyncSeq, cancellationToken) ?? 0;
        var entryMax = await db.MealPlanEntries.IgnoreQueryFilters()
            .Where(e => e.HouseholdId == householdId)
            .MaxAsync(e => (long?)e.SyncSeq, cancellationToken) ?? 0;
        var itemMax = await db.ShoppingItems.IgnoreQueryFilters()
            .Where(i => i.HouseholdId == householdId)
            .MaxAsync(i => (long?)i.SyncSeq, cancellationToken) ?? 0;
        return Math.Max(recipeMax, Math.Max(entryMax, itemMax));
    }
```

IMPORTANT ordering fix inside `PushAsync`: `CurrentCursorAsync` must run AFTER `SaveChangesAsync` (triggers assigned the values) and BEFORE `CommitAsync` — as written above. The class needs `using Ingredo.Api.Domain;`.

Controller: add to `SyncController` (validation exception → 400):

```csharp
    [HttpPost("push")]
    public async Task<IActionResult> Push(SyncPushRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await service.PushAsync(HouseholdId, request, cancellationToken));
        }
        catch (SyncValidationException invalid)
        {
            ModelState.AddModelError($"{invalid.RowId}.{invalid.Field}", invalid.ErrorMessage);
            return ValidationProblem(ModelState);
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: all green — 119 (112 + 7).

- [ ] **Step 5: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add LWW sync push"
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

- [ ] **Step 2: Compose two-device convergence smoke**

```bash
docker compose down -v
docker compose up -d --build
sleep 18
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"sync@test.local","password":"passord123","displayName":"Sync"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
NOW=$(date +%s%3N)
RID=$(python3 -c "import uuid; print(uuid.uuid4())")
curl -s -X POST http://localhost:8080/api/v1/sync/push -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"recipes\":[{\"id\":\"$RID\",\"title\":\"Synket taco\",\"description\":null,\"servings\":4,\"notes\":null,\"createdAt\":$NOW,\"updatedAt\":$NOW,\"deletedAt\":null,\"ingredients\":[],\"instructions\":[]}],\"mealPlanEntries\":null,\"shoppingItems\":null}" \
  | grep -o '"applied"'
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/sync/changes?since=0" \
  | grep -o '"title":"Synket taco"' && echo SMOKE-OK
docker compose down
```

Expected: both greps match ("device 2" is the pull with a fresh cursor).

- [ ] **Step 3: Docs**

`backend/README.md`, after the Meal plan & shopping section:

```markdown
## Sync

- `GET /api/v1/sync/changes?since=<cursor>` — everything in your household
  changed after the cursor, tombstones included; returns the next cursor.
- `POST /api/v1/sync/push` — batch of full row states with CLIENT-authored
  epoch-ms timestamps; per-row last-writer-wins (`applied` / `superseded` /
  `conflict`). The only endpoint that accepts client timestamps.
- Every server write gets a `SyncSeq` from a DB trigger — CRUD edits and
  sync edits are indistinguishable to pullers.
```

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Sync endpoints (manual pass)

- Via Scalar: pull with `since=0` → all your content incl. anything you've deleted (tombstones with `deletedAt`); pull again with the returned cursor → empty.
- Create a recipe via the normal API → it appears in the next incremental pull.
- Push a recipe row with an old `updatedAt` (before the server's) → `superseded`, content unchanged; with a newer one → `applied`.
- Push a tombstone (`deletedAt` = `updatedAt`, newer than server) → recipe vanishes from the app-facing API but travels in pulls.
- A second user's pull never contains your household's rows.
- Stale compose volume: `docker compose down -v` once (SyncSeq column + triggers).
```

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/README.md docs/TESTING.md
git commit -m "docs: add sync endpoints to README and manual checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (trigger sequencing incl. every-write-path claim + accepted cursor race → T1), 2 (cursor semantics → T3/T4), 3 (pull shape/aggregates/epoch-ms → T3), 4 (LWW matrix, batch order, validator mapping, meal-plan FK-existence rule, in-batch resolution via `db.Recipes.Local` → T4), 5 (trust boundary: only push writes client timestamps; applied rows never server-bumped → T4 tests assert verbatim round-trip), 6 (guard inversion + structural test + unchanged existing tests → T2), 7 (patterns, smoke → T3–T5).
- **Known judgment calls:** validation-before-transaction means a 400 batch does zero writes (validate-then-apply, cheapest correct order). The whole-batch-400 uses a small `SyncValidationException` caught in the controller — a pragmatic bridge between service-layer validation and `ValidationProblem` (house shape kept). `CurrentCursorAsync` is 3 max-queries inside the push transaction; per-household maxes make the push cursor cover exactly the caller's visible rows (a concurrent other-household write advancing the global sequence is irrelevant to this cursor — and a concurrent SAME-household write is the accepted race, same as pull). `file static class` for the extension keeps it out of the public surface. Tombstoned recipe pushes drop children (spec decision 4); pulls of tombstoned recipes return whatever children exist server-side (none after such a push) — asymmetry is harmless because display ignores children of deleted recipes. Push tests use relative-to-server timestamps (serverUpdatedAt ± deltas) rather than wall-clock races.
- **Type consistency check:** `SyncRecipeRow` field order matches its construction in `ToRow` and tests' `ClientRecipe`; `Ms`/`FromMs` are inverse pairs (`ToUnixTimeMilliseconds`/`FromUnixTimeMilliseconds`, both UTC-safe on DateTimeOffset); LWW comparisons convert the SERVER value to ms (client long vs server DateTimeOffset — one conversion direction only, no precision mismatch since server values written via FromMs are ms-exact); validator DTO mapping matches the CRUD records' positional shapes from their slices; `ScalingMode`/`ShoppingItemStatus` parses are safe behind the reused validators (closed-set checks); `SyncController.HouseholdId` matches the established accessor idiom (guard-protected).
