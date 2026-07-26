using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class MultiMembershipTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // ApiClientExtensions.RegisterUserAsync always registers with this fixed
    // password; the email is retrievable off the returned AuthResponse
    // (UserResponse.Email), so no change to ApiClientExtensions is needed.
    private const string RegisteredPassword = "passord123";

    private async Task<RecipeResponse> CreateRecipeNamed(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, title, null, 2, null,
                [new IngredientRequest(null, "Salt", null, null, "fixed", 0)],
                [new InstructionRequest(null, "Rør.", 0)]));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<RecipeResponse>())!;
    }

    [Fact]
    public async Task Create_returns_the_new_household_active_and_owned()
    {
        var (client, first) = await factory.RegisterUserAsync();

        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var auth = await create.Content.ReadFromJsonAsync<AuthResponse>();

        Assert.NotEqual(first.User.HouseholdId, auth!.User.HouseholdId);
        Assert.Equal("Tur", auth.User.HouseholdName);
        client.UseTokens(auth);
        var household = await client.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        Assert.Equal("owner", household!.Members.Single().Role);
    }

    [Fact]
    public async Task List_shows_every_membership_with_the_active_marker()
    {
        var (client, first) = await factory.RegisterUserAsync();
        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var auth = await create.Content.ReadFromJsonAsync<AuthResponse>();
        client.UseTokens(auth!);

        var list = await client.GetFromJsonAsync<List<HouseholdSummaryResponse>>("/api/v1/households");

        Assert.Equal(2, list!.Count);
        var active = Assert.Single(list, h => h.IsActive);
        Assert.Equal(auth!.User.HouseholdId, active.Id);
        var personal = Assert.Single(list, h => h.Id == first.User.HouseholdId);
        Assert.False(personal.IsActive);
        Assert.Equal(1, personal.MemberCount);
        Assert.Matches("^[A-Z2-9]{3}-[A-Z2-9]{3}$", personal.JoinCode);
    }

    [Fact]
    public async Task Switch_changes_the_active_household_and_content_scope()
    {
        var (client, first) = await factory.RegisterUserAsync();
        await CreateRecipeNamed(client, "Hjemme-taco");
        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        client.UseTokens((await create.Content.ReadFromJsonAsync<AuthResponse>())!);
        await CreateRecipeNamed(client, "Tur-suppe");

        var back = await client.PostAsJsonAsync(
            "/api/v1/households/switch", new { householdId = first.User.HouseholdId });
        var auth = await back.Content.ReadFromJsonAsync<AuthResponse>();
        client.UseTokens(auth!);

        Assert.Equal(first.User.HouseholdId, auth!.User.HouseholdId);
        var recipes = await client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(recipes!, r => r.Title == "Hjemme-taco");
        Assert.DoesNotContain(recipes!, r => r.Title == "Tur-suppe");
    }

    [Fact]
    public async Task Switch_to_a_household_you_do_not_belong_to_is_404()
    {
        var (client, _) = await factory.RegisterUserAsync();
        var (otherClient, otherAuth) = await factory.RegisterUserAsync();
        _ = otherClient;

        var response = await client.PostAsJsonAsync(
            "/api/v1/households/switch", new { householdId = otherAuth.User.HouseholdId });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Two_families_hold_different_active_households_simultaneously()
    {
        var (deviceA, first) = await factory.RegisterUserAsync();
        var create = await deviceA.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var tripAuth = await create.Content.ReadFromJsonAsync<AuthResponse>();
        deviceA.UseTokens(tripAuth!);

        // Device B: fresh login → oldest membership (the personal one).
        var login = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = first.User.Email, password = RegisteredPassword });
        var deviceBAuth = await login.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(first.User.HouseholdId, deviceBAuth!.User.HouseholdId);

        // Each family refreshes into ITS household.
        var refreshA = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = tripAuth!.RefreshToken });
        var refreshedA = await refreshA.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(tripAuth.User.HouseholdId, refreshedA!.User.HouseholdId);

        var refreshB = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = deviceBAuth.RefreshToken });
        var refreshedB = await refreshB.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(first.User.HouseholdId, refreshedB!.User.HouseholdId);
    }

    [Fact]
    public async Task Create_with_a_blank_name_is_400()
    {
        var (client, _) = await factory.RegisterUserAsync();

        var response = await client.PostAsJsonAsync("/api/v1/households", new { name = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
