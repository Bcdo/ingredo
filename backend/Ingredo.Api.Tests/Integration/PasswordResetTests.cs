using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class PasswordResetTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Reset_WithValidCode_SetsPasswordAndRevokesSessions()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var email = auth.User.Email;

        // A second, independent session (its own refresh-token family) —
        // revocation must reach every live session, not just the one that
        // happens to be first in some limited query.
        var secondLogin = await factory.CreateClient().PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = "passord123" });
        secondLogin.EnsureSuccessStatusCode();
        var secondAuth = (await secondLogin.Content.ReadFromJsonAsync<AuthResponse>())!;

        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password", new
        {
            email,
            code = JoinCodeGenerator.FormatForDisplay(code),
            newPassword = "nyttpassord123",
        });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var oldLogin = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = "passord123" });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);

        var newLogin = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = "nyttpassord123" });
        newLogin.EnsureSuccessStatusCode();

        var refresh = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = auth.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);

        var secondRefresh = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = secondAuth.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, secondRefresh.StatusCode);
    }

    [Fact]
    public async Task Reset_CodeIsSingleUse()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "enda-et-passord1" });
        Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
    }

    [Fact]
    public async Task Reset_ExpiredCode_Is403AndPasswordUnchanged()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id, TimeSpan.FromMinutes(-1));
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.Forbidden, reset.StatusCode);

        var login = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = auth.User.Email, password = "passord123" });
        login.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Reset_WrongEmailWithLiveCode_Is403()
    {
        var (_, kari) = await factory.RegisterUserAsync("Kari");
        var (_, ola) = await factory.RegisterUserAsync("Ola");
        var code = await factory.MintResetCodeAsync(kari.User.Id);
        using var client = factory.CreateClient();

        var reset = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = ola.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.Forbidden, reset.StatusCode);
    }

    [Fact]
    public async Task Reset_RacingTheSameCode_AdmitsExactlyOne()
    {
        var (_, auth) = await factory.RegisterUserAsync("Racer");
        var code = await factory.MintResetCodeAsync(auth.User.Id);

        async Task<(HttpStatusCode Status, string Password)> Attempt(string password)
        {
            using var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
                new { email = auth.User.Email, code, newPassword = password });
            return (response.StatusCode, password);
        }

        var results = await Task.WhenAll(Attempt("racerpassordA1"), Attempt("racerpassordB2"));
        Assert.Single(results, r => r.Status == HttpStatusCode.NoContent);
        Assert.Single(results, r => r.Status == HttpStatusCode.Forbidden);

        // Not just "one 204 and one 403" — the 204 must be the one that
        // actually took effect. A split-transaction bug can let the loser's
        // password become live while it still gets 403.
        var winnerPassword = results.Single(r => r.Status == HttpStatusCode.NoContent).Password;
        var loserPassword = results.Single(r => r.Status == HttpStatusCode.Forbidden).Password;

        using var loginClient = factory.CreateClient();
        var winnerLogin = await loginClient.PostAsJsonAsync("/api/v1/auth/login",
            new { email = auth.User.Email, password = winnerPassword });
        Assert.Equal(HttpStatusCode.OK, winnerLogin.StatusCode);

        var loserLogin = await loginClient.PostAsJsonAsync("/api/v1/auth/login",
            new { email = auth.User.Email, password = loserPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, loserLogin.StatusCode);
    }

    [Fact]
    public async Task Reset_WeakPassword_400AndCodeNotConsumed()
    {
        var (_, auth) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintResetCodeAsync(auth.User.Id);
        using var client = factory.CreateClient();

        var weak = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "kort" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var retry = await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new { email = auth.User.Email, code, newPassword = "nyttpassord123" });
        Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    }
}
