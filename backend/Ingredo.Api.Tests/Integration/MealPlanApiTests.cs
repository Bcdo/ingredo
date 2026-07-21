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
