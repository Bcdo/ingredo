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
        Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/v1/meal-plan-entries")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/v1/shopping-items")).StatusCode);

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
