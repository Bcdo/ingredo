using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class RecipesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static RecipeRequest NewRecipe(string title = "Pannekaker", Guid? id = null) =>
        new(
            Id: id,
            Title: title,
            Description: "Klassiske",
            Servings: 4,
            Notes: null,
            Ingredients:
            [
                new IngredientRequest(null, "Hvetemel", 400, "g", "linear", 0),
                new IngredientRequest(null, "Salt", null, null, "fixed", 1),
            ],
            Instructions:
            [
                new InstructionRequest(null, "Visp sammen.", 0),
                new InstructionRequest(null, "Stek.", 1),
            ]);

    [Fact]
    public async Task Create_then_get_round_trips_the_aggregate()
    {
        var created = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var recipe = await created.Content.ReadFromJsonAsync<RecipeResponse>();
        Assert.NotNull(recipe);

        var fetched = await _client.GetFromJsonAsync<RecipeResponse>($"/api/v1/recipes/{recipe.Id}");
        Assert.NotNull(fetched);
        Assert.Equal("Pannekaker", fetched.Title);
        Assert.Equal(["Hvetemel", "Salt"], fetched.Ingredients.Select(i => i.Name));
        Assert.Equal("linear", fetched.Ingredients[0].Scaling);
        Assert.Equal(400, fetched.Ingredients[0].Quantity);
        Assert.Equal(["Visp sammen.", "Stek."], fetched.Instructions.Select(i => i.Text));
    }

    [Fact]
    public async Task Create_honors_a_client_minted_id_and_conflicts_on_reuse()
    {
        var id = Guid.NewGuid();

        var first = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe(id: id));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var recipe = await first.Content.ReadFromJsonAsync<RecipeResponse>();
        Assert.Equal(id, recipe!.Id);

        var second = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Vafler", id));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_invalid_payload_with_validation_problem()
    {
        var invalid = NewRecipe() with
        {
            Title = " ",
            Ingredients = [new IngredientRequest(null, "Mel", 0, "g", "cubic", 0)],
        };

        var response = await _client.PostAsJsonAsync("/api/v1/recipes", invalid);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Title", body);
        Assert.Contains("Quantity", body);
        Assert.Contains("Scaling", body);
    }

    [Fact]
    public async Task Update_replaces_the_aggregate_and_bumps_updated_at()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Tacos")))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var replacement = NewRecipe("Tacos deluxe") with
        {
            Servings = 6,
            Ingredients = [new IngredientRequest(null, "Kjøttdeig", 400, "g", "linear", 0)],
            Instructions = [new InstructionRequest(null, "Stek kjøttdeigen.", 0)],
        };
        var updated = await _client.PutAsJsonAsync($"/api/v1/recipes/{created!.Id}", replacement);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);

        var fetched = await _client.GetFromJsonAsync<RecipeResponse>($"/api/v1/recipes/{created.Id}");
        Assert.Equal("Tacos deluxe", fetched!.Title);
        Assert.Equal(6, fetched.Servings);
        Assert.Single(fetched.Ingredients);
        Assert.Single(fetched.Instructions);
        Assert.True(fetched.UpdatedAt > created.UpdatedAt);
    }

    [Fact]
    public async Task Update_of_unknown_recipe_is_404()
    {
        var response = await _client.PutAsJsonAsync($"/api/v1/recipes/{Guid.NewGuid()}", NewRecipe());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_is_soft_and_idempotent()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Suppe")))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var first = await _client.DeleteAsync($"/api/v1/recipes/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);

        var gone = await _client.GetAsync($"/api/v1/recipes/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);

        var again = await _client.DeleteAsync($"/api/v1/recipes/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        var never = await _client.DeleteAsync($"/api/v1/recipes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, never.StatusCode);
    }

    [Fact]
    public async Task List_returns_summaries_newest_first_excluding_deleted()
    {
        var a = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("List-A")))
            .Content.ReadFromJsonAsync<RecipeResponse>();
        var b = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("List-B")))
            .Content.ReadFromJsonAsync<RecipeResponse>();
        await _client.DeleteAsync($"/api/v1/recipes/{a!.Id}");

        var list = await _client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");

        Assert.NotNull(list);
        Assert.DoesNotContain(list, r => r.Id == a.Id);
        var bSummary = Assert.Single(list, r => r.Id == b!.Id);
        Assert.Equal("List-B", bSummary.Title);
        var ourTitles = list.Where(r => r.Title.StartsWith("List-")).Select(r => r.Title).ToList();
        Assert.Equal(["List-B"], ourTitles);
    }
}
