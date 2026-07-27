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

        // …Kari additively joins Ola's household — her personal household
        // survives the join (join no longer re-homes content or deletes
        // anything)…
        var joined = await kari.PostAsJsonAsync("/api/v1/household/join", new JoinRequest(olaCode));
        Assert.Equal(HttpStatusCode.OK, joined.StatusCode);

        // …then Kari, still on her ORIGINAL (personal-household) token,
        // leaves that household. She's its sole member, but now has Ola's
        // household to land on, so leaving is allowed — and the now-empty
        // personal household is actually deleted: the "dead household" this
        // test is about.
        var left = await kari.PostAsJsonAsync("/api/v1/household/leave", new { });
        Assert.Equal(HttpStatusCode.OK, left.StatusCode);

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
    public async Task Refresh_recovers_a_family_whose_household_was_left()
    {
        // Device B keeps refreshing a family pinned to a shared household
        // after the roamer leaves that household from device A. The
        // household SURVIVES the leave (the host remains a member) — so the
        // pre-fix "resolve by EXISTENCE" fallback would keep minting claims
        // for a household the roamer no longer belongs to, and the guard
        // would 401 every subsequent request forever. Refresh must instead
        // re-home the family onto a membership that still exists.
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (roamerClient, roamerAuth) = await factory.RegisterUserAsync();
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");

        // Roamer joins the shared household — additive, so the roamer's
        // personal household (roamerAuth's) survives untouched as a landing
        // spot once the shared one is left.
        var join = await roamerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();
        var joinedAuth = (await join.Content.ReadFromJsonAsync<AuthResponse>())!;

        // Device B: an INDEPENDENT refresh-token family, also pinned to the
        // shared household, minted via switch so it shares nothing with the
        // tokens used for the leave below — refresh rotates (a used token
        // dies), so the leave and the eventual recovery-refresh each need
        // their OWN live pair.
        var deviceB = factory.CreateClient();
        deviceB.UseTokens(joinedAuth);
        var switchB = await deviceB.PostAsJsonAsync(
            "/api/v1/households/switch", new { householdId = joinedAuth.User.HouseholdId });
        switchB.EnsureSuccessStatusCode();
        var deviceBAuth = (await switchB.Content.ReadFromJsonAsync<AuthResponse>())!;

        // Device A: the join's own tokens, still scoped to the shared
        // household — used only to perform the leave. Leave reads the
        // ACCESS token's household claim, not the refresh token, so this
        // never touches device B's family.
        var deviceA = factory.CreateClient();
        deviceA.UseTokens(joinedAuth);
        var leave = await deviceA.PostAsJsonAsync("/api/v1/household/leave", new { });
        leave.EnsureSuccessStatusCode();

        // Device B's family predates the leave and its refresh token was
        // never used, so it's still live. Refreshing it now must land on a
        // household the roamer still belongs to — the personal one — not
        // 401, and not resurrect the departed membership.
        var recover = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = deviceBAuth.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, recover.StatusCode);
        var recovered = (await recover.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.Equal(roamerAuth.User.HouseholdId, recovered.User.HouseholdId);

        var probe = factory.CreateClient();
        probe.UseTokens(recovered);
        Assert.Equal(HttpStatusCode.OK, (await probe.GetAsync("/api/v1/recipes")).StatusCode);
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

    [Fact]
    public async Task Tokens_for_a_household_you_left_fail_with_401()
    {
        // Join is additive — it doesn't remove any membership, so a token for
        // a household you merely joined-away-from no longer exists under the
        // new semantics. To exercise the "you left" case, the joiner must
        // actually leave: join the host's household, then leave it again.
        // The household itself survives (the host remains a member) — only
        // the joiner's membership row is gone, which is what the guard
        // checks. The pre-leave token (scoped to that shared household) is
        // the one under test.
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();
        var joinedAuth = (await join.Content.ReadFromJsonAsync<AuthResponse>())!;
        joinerClient.UseTokens(joinedAuth);

        var stale = factory.CreateClient();
        stale.UseTokens(joinedAuth); // token scoped to the (still-existing) shared household

        var leave = await joinerClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        leave.EnsureSuccessStatusCode();

        var response = await stale.GetAsync("/api/v1/recipes");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
