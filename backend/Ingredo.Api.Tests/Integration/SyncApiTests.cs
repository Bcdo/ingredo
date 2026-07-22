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
