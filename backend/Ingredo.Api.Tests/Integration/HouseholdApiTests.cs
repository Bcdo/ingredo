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

    private static async Task CreateRecipeNamed(HttpClient client, string title) =>
        (await client.PostAsJsonAsync("/api/v1/recipes", NewRecipe(title))).EnsureSuccessStatusCode();

    // Registers a user with retrievable credentials — RegisterUserAsync only
    // returns the issued tokens, but a couple of tests below need to
    // re-login later to prove the personal household survived.
    private static async Task<(HttpClient Client, string Email, string Password)> RegisterWithCredentialsAsync(
        ApiFactory factory, string displayName = "Test Bruker")
    {
        const string password = "passord123";
        var email = $"user-{Guid.NewGuid():N}@test.local";
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/register", new RegisterRequest(email, password, displayName));
        response.EnsureSuccessStatusCode();
        client.UseTokens((await response.Content.ReadFromJsonAsync<AuthResponse>())!);
        return (client, email, password);
    }

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
    public async Task Join_is_additive_both_households_keep_their_content()
    {
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, joinerEmail, joinerPassword) = await RegisterWithCredentialsAsync(factory);
        await CreateRecipeNamed(hostClient, "Vertens taco");
        await CreateRecipeNamed(joinerClient, "Egen suppe");
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");

        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        var auth = await join.Content.ReadFromJsonAsync<AuthResponse>();
        joinerClient.UseTokens(auth!);

        // Active is now the joined household: host content visible, own not.
        var joined = await joinerClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(joined!, r => r.Title == "Vertens taco");
        Assert.DoesNotContain(joined!, r => r.Title == "Egen suppe");

        // The personal household still exists with its content: prove
        // persistence via a fresh login, which lands on the OLDEST
        // membership — the personal one, created first at registration.
        var relogin = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login",
            new LoginRequest(joinerEmail, joinerPassword));
        var personalAuth = await relogin.Content.ReadFromJsonAsync<AuthResponse>();
        var personalClient = factory.CreateClient();
        personalClient.UseTokens(personalAuth!);
        var personal = await personalClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(personal!, r => r.Title == "Egen suppe");
    }

    [Fact]
    public async Task Joining_a_household_you_already_belong_to_conflicts()
    {
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        var code = (await Household(hostClient)).JoinCode;
        await Join(joinerClient, code);

        var second = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new JoinRequest(code));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Join_from_a_shared_household_adds_membership_without_leaving()
    {
        var (a, _) = await factory.RegisterUserAsync("A");
        var (b, _) = await factory.RegisterUserAsync("B");
        var (c, _) = await factory.RegisterUserAsync("C");
        await a.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Felles gryte"));
        await Join(b, (await Household(a)).JoinCode); // A+B share; the recipe is theirs

        await Join(a, (await Household(c)).JoinCode); // A additionally joins C's household

        // A's active household is now C's — empty, additive join moved nothing.
        Assert.Empty(await Recipes(a));
        // B still has the shared content and the A+B household is untouched.
        Assert.Equal(
            ["Felles gryte"], (await Recipes(b)).Select(r => r.Title));
        var bHousehold = await Household(b);
        Assert.Equal(2, bHousehold.Members.Count); // A remains a member alongside B
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
    public async Task Leave_lands_on_the_oldest_remaining_membership()
    {
        // Joiner has personal (oldest) + host household; leaving the host
        // household lands back on personal, and the host household keeps
        // its members and content.
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        await CreateRecipeNamed(joinerClient, "Egen suppe");
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        joinerClient.UseTokens((await join.Content.ReadFromJsonAsync<AuthResponse>())!);

        var leave = await joinerClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        var auth = await leave.Content.ReadFromJsonAsync<AuthResponse>();
        joinerClient.UseTokens(auth!);

        var recipes = await joinerClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(recipes!, r => r.Title == "Egen suppe");
        var hostView = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        Assert.Single(hostView!.Members);
    }

    [Fact]
    public async Task Sole_member_with_no_other_membership_cannot_leave()
    {
        var (client, _) = await factory.RegisterUserAsync();

        var leave = await client.PostAsJsonAsync("/api/v1/household/leave", new { });

        Assert.Equal(HttpStatusCode.Conflict, leave.StatusCode);
    }

    [Fact]
    public async Task Last_member_leaving_a_shared_household_deletes_it()
    {
        // A creates content in own household, joins B's household, then the
        // OLD personal household (A was sole member, A has another
        // membership) is deleted when A leaves it. Requires switching back
        // to it — via login (oldest membership IS the personal one).
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (roamerClient, roamerEmail, roamerPassword) = await RegisterWithCredentialsAsync(factory);
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await roamerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        var relogin = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest(roamerEmail, roamerPassword));
        var personalClient = factory.CreateClient();
        personalClient.UseTokens((await relogin.Content.ReadFromJsonAsync<AuthResponse>())!);

        var leave = await personalClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        var auth = await leave.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(household.Id, auth!.User.HouseholdId); // landed on the shared one
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
