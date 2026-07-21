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
