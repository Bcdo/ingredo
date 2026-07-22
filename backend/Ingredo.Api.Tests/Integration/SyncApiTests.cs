using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
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

    private static SyncShoppingRow ClientShopping(
        Guid id, string name, string status, long updatedAt, long? purchasedAt = null) =>
        new(id, name, name.ToLowerInvariant(), 1000, "ml", "[]", status, purchasedAt,
            updatedAt - 10, updatedAt, null);

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

    [Fact]
    public async Task Recipe_update_pushes_reusing_child_ids_apply_cleanly()
    {
        var recipeId = Guid.NewGuid();
        var ingredientId = Guid.NewGuid();
        var instructionId = Guid.NewGuid();
        var now = Now();
        SyncRecipeRow Version(string title, long updatedAt, string ingredientName) =>
            new(recipeId, title, null, 4, null, now - 10, updatedAt, null,
                [new SyncIngredientRow(ingredientId, ingredientName, 400, "g", "linear", 0)],
                [new SyncInstructionRow(instructionId, "Bland.", 0)]);

        var first = await Push(new SyncPushRequest([Version("V1", now, "Mel")], null, null));
        Assert.Equal("applied", first.Results[recipeId]);

        var second = await Push(new SyncPushRequest([Version("V2", now + 1000, "Hvetemel")], null, null));
        Assert.Equal("applied", second.Results[recipeId]);

        var pulled = Assert.Single((await Pull()).Recipes, r => r.Id == recipeId);
        Assert.Equal("V2", pulled.Title);
        var ingredient = Assert.Single(pulled.Ingredients);
        Assert.Equal(ingredientId, ingredient.Id);
        Assert.Equal("Hvetemel", ingredient.Name);
        Assert.Equal(instructionId, Assert.Single(pulled.Instructions).Id);
    }

    [Fact]
    public async Task Join_rehome_rows_surface_in_the_target_households_next_incremental_pull()
    {
        // B's recipe is created first, so its insert-time SyncSeq is the
        // smallest relevant value — well below the cursor A is about to
        // capture. A's pre-join cursor is then strictly greater than that
        // insert-time SyncSeq (the sequence is global, shared across
        // households). That means the only way B's recipe can still show up
        // in A's incremental pull afterwards is if joining re-homed it with
        // a *fresh*, trigger-assigned SyncSeq — if the DB trigger never
        // fired, B's row would keep its original (too-old) SyncSeq and stay
        // invisible to a pull since preJoinCursor. So this ordering makes
        // the trigger firing the only way the assertion below can pass.
        var (bClient, _) = await factory.RegisterUserAsync("B");
        var bRecipeResponse = await bClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "B sin oppskrift", null, 4, null,
                [new IngredientRequest(null, "Mel", 400, "g", "linear", 0)],
                [new InstructionRequest(null, "Bland.", 0)]));
        var bRecipe = (await bRecipeResponse.Content.ReadFromJsonAsync<RecipeResponse>())!;

        await CreateRecipe("A sin egen oppskrift");
        var preJoinCursor = (await Pull()).Cursor;

        // B is the sole member of its own (personal) household, so joining
        // A's household re-homes B's content into A's household via
        // ExecuteUpdateAsync — the one write path that bypasses EF value
        // generation, relying on the DB trigger to assign a fresh SyncSeq.
        var aHousehold = await _client.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var joinResponse = await bClient.PostAsJsonAsync(
            "/api/v1/household/join", new JoinRequest(aHousehold!.JoinCode));
        Assert.Equal(HttpStatusCode.OK, joinResponse.StatusCode);
        var joinAuth = (await joinResponse.Content.ReadFromJsonAsync<AuthResponse>())!;
        bClient.UseTokens(joinAuth); // B now carries a token scoped to A's household

        var pull = await Pull(preJoinCursor);
        var rehomed = Assert.Single(pull.Recipes, r => r.Id == bRecipe.Id);
        Assert.Equal("B sin oppskrift", rehomed.Title);
    }

    [Fact]
    public async Task Shopping_push_applies_lww_and_round_trips_purchased_state()
    {
        var id = Guid.NewGuid();
        var updatedAt = Now() - 60_000;

        var insert = await Push(new SyncPushRequest(
            null, null, [ClientShopping(id, "Melk", "active", updatedAt)]));
        Assert.Equal("applied", insert.Results[id]);

        var pulled = Assert.Single((await Pull()).ShoppingItems, i => i.Id == id);
        Assert.Equal("Melk", pulled.Name);
        Assert.Equal("active", pulled.Status);
        Assert.Equal(1000m, pulled.Quantity);

        var stale = await Push(new SyncPushRequest(
            null, null, [ClientShopping(id, "Gammel melk", "active", updatedAt - 1000)]));
        Assert.Equal("superseded", stale.Results[id]);
        Assert.Equal("Melk", Assert.Single((await Pull()).ShoppingItems, i => i.Id == id).Name);

        var purchasedAt = updatedAt + 2000;
        var purchase = await Push(new SyncPushRequest(
            null, null, [ClientShopping(id, "Melk", "purchased", updatedAt + 1000, purchasedAt)]));
        Assert.Equal("applied", purchase.Results[id]);

        var final = Assert.Single((await Pull()).ShoppingItems, i => i.Id == id);
        Assert.Equal("purchased", final.Status);
        Assert.Equal(purchasedAt, final.PurchasedAt);
    }

    [Fact]
    public async Task Tombstoned_recipe_resurrects_cleanly_on_a_newer_non_deleted_push()
    {
        var recipe = await CreateRecipe("Kanskje tilbake");
        var serverUpdatedAt = Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).UpdatedAt;

        var tombstone = await Push(new SyncPushRequest(
            [ClientRecipe(recipe.Id, "Kanskje tilbake", serverUpdatedAt + 1000, serverUpdatedAt + 1000)],
            null, null));
        Assert.Equal("applied", tombstone.Results[recipe.Id]);
        Assert.NotNull(Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id).DeletedAt);

        // Children were dropped when the tombstone applied; the resurrection
        // resends fresh child ids and must re-add them cleanly rather than
        // conflict with anything left dangling.
        var ingredientId = Guid.NewGuid();
        var instructionId = Guid.NewGuid();
        var resurrected = new SyncRecipeRow(
            recipe.Id, "Tilbake igjen", null, 4, null,
            serverUpdatedAt - 10, serverUpdatedAt + 2000, null,
            [new SyncIngredientRow(ingredientId, "Mel", 400, "g", "linear", 0)],
            [new SyncInstructionRow(instructionId, "Bland.", 0)]);

        var revive = await Push(new SyncPushRequest([resurrected], null, null));
        Assert.Equal("applied", revive.Results[recipe.Id]);

        var pulled = Assert.Single((await Pull()).Recipes, r => r.Id == recipe.Id);
        Assert.Null(pulled.DeletedAt);
        Assert.Equal("Tilbake igjen", pulled.Title);
        var ingredient = Assert.Single(pulled.Ingredients);
        Assert.Equal(ingredientId, ingredient.Id);
        Assert.Equal(instructionId, Assert.Single(pulled.Instructions).Id);
    }
}
