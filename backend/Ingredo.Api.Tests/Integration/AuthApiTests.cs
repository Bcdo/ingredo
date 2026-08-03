using System.Linq;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class AuthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static RegisterRequest NewUser(string? email = null, string? inviteCode = null) =>
        new(email ?? $"user-{Guid.NewGuid():N}@test.local", "passord123", "Kari Test", InviteCode: inviteCode);

    private async Task<AuthResponse> Register(RegisterRequest request)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/register", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
    }

    [Fact]
    public async Task Register_returns_tokens_and_me_works_with_the_access_token()
    {
        var request = NewUser(inviteCode: await factory.MintInviteCodeAsync());
        var auth = await Register(request);

        Assert.NotEmpty(auth.AccessToken);
        Assert.NotEmpty(auth.RefreshToken);
        Assert.Equal("Kari Test", auth.User.DisplayName);
        Assert.Equal("Kari Test", auth.User.HouseholdName);

        var me = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
        me.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var meResponse = await _client.SendAsync(me);
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);
        var user = await meResponse.Content.ReadFromJsonAsync<UserResponse>();
        Assert.Equal(auth.User.Id, user!.Id);
        Assert.Equal(request.Email, user.Email);
    }

    [Fact]
    public async Task Register_conflicts_on_duplicate_email_case_insensitively()
    {
        var request = NewUser(inviteCode: await factory.MintInviteCodeAsync());
        await Register(request);

        // A fresh code — the invite used above is already consumed, and the
        // point of this test is the email conflict, not the invite gate.
        var secondInvite = await factory.MintInviteCodeAsync();
        var duplicate = await _client.PostAsJsonAsync(
            "/api/v1/auth/register",
            request with { Email = request.Email.ToUpperInvariant(), InviteCode = secondInvite });

        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task Login_works_and_wrong_password_and_unknown_email_are_identical_401s()
    {
        var request = NewUser(inviteCode: await factory.MintInviteCodeAsync());
        await Register(request);

        var ok = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest(request.Email, request.Password));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var wrongPassword = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest(request.Email, "feil-passord"));
        var unknownEmail = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new LoginRequest("nobody@test.local", request.Password));

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);

        static string Normalized(string body) =>
            System.Text.RegularExpressions.Regex.Replace(body, "\"traceId\":\"[^\"]*\"", "\"traceId\":\"-\"");
        Assert.Equal(
            Normalized(await wrongPassword.Content.ReadAsStringAsync()),
            Normalized(await unknownEmail.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task Refresh_rotates_and_reuse_revokes_the_whole_family()
    {
        var auth = await Register(NewUser(inviteCode: await factory.MintInviteCodeAsync()));

        var rotated = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var second = (await rotated.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.NotEqual(auth.RefreshToken, second.RefreshToken);

        // Reusing the first (already rotated) token is the theft signal…
        var reuse = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        // …which must kill the whole family, including the fresh token.
        var afterReuse = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(second.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, afterReuse.StatusCode);
    }

    [Fact]
    public async Task Logout_revokes_the_refresh_token_and_is_idempotent()
    {
        var auth = await Register(NewUser(inviteCode: await factory.MintInviteCodeAsync()));

        var logout = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        var refreshAfter = await _client.PostAsJsonAsync(
            "/api/v1/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, refreshAfter.StatusCode);

        var again = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        var unknown = await _client.PostAsJsonAsync(
            "/api/v1/auth/logout", new LogoutRequest("no-such-token"));
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
    }

    [Fact]
    public async Task Me_requires_authentication()
    {
        var anonymous = await _client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    [Fact]
    public async Task Register_WithHouseholdName_NamesTheFirstHousehold()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"hjem-{Guid.NewGuid():N}@example.test",
            password = "passord123",
            displayName = "Kari",
            householdName = "Hjem",
            inviteCode = await factory.MintInviteCodeAsync(),
        });
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;

        var authed = factory.CreateClient();
        authed.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var household = (await authed.GetFromJsonAsync<HouseholdResponse>("/api/v1/household"))!;
        Assert.Equal("Hjem", household.Name);
    }

    [Fact]
    public async Task Register_WithoutHouseholdName_FallsBackToDisplayName()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"fallback-{Guid.NewGuid():N}@example.test",
            password = "passord123",
            displayName = "Ola Fallback",
            inviteCode = await factory.MintInviteCodeAsync(),
        });
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;

        var authed = factory.CreateClient();
        authed.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var household = (await authed.GetFromJsonAsync<HouseholdResponse>("/api/v1/household"))!;
        Assert.Equal("Ola Fallback", household.Name);
    }

    [Fact]
    public async Task Register_WithWhitespaceHouseholdName_IsRejected()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"blank-{Guid.NewGuid():N}@example.test",
            password = "passord123",
            displayName = "Kari",
            householdName = "   ",
            inviteCode = await factory.MintInviteCodeAsync(),
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_WithoutInviteCode_IsRejected()
    {
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"nocode-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_WithUnknownInviteCode_Is403AndCreatesNoUser()
    {
        using var client = factory.CreateClient();
        var email = $"unknown-{Guid.NewGuid():N}@test.local";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email,
            password = "passord123",
            displayName = "Kari",
            inviteCode = "ZZZ-ZZZ",
        });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "passord123" });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task Register_ConsumesTheCode_SoReuseIs403()
    {
        var code = await factory.MintInviteCodeAsync();
        using var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"first-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        first.EnsureSuccessStatusCode();

        var second = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"second-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Ola",
            inviteCode = code,
        });
        Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
    }

    [Fact]
    public async Task Register_EmailConflict_DoesNotConsumeTheCode()
    {
        var (_, existing) = await factory.RegisterUserAsync("Kari");
        var code = await factory.MintInviteCodeAsync();
        using var client = factory.CreateClient();

        var conflict = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = existing.User.Email,
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);

        var retry = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = $"fresh-{Guid.NewGuid():N}@test.local",
            password = "passord123",
            displayName = "Kari",
            inviteCode = code,
        });
        retry.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Register_RacingTheSameCode_AdmitsExactlyOne()
    {
        var code = await factory.MintInviteCodeAsync();

        async Task<HttpStatusCode> Attempt(string tag)
        {
            using var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
            {
                email = $"race-{tag}-{Guid.NewGuid():N}@test.local",
                password = "passord123",
                displayName = "Racer",
                inviteCode = code,
            });
            return response.StatusCode;
        }

        var results = await Task.WhenAll(Attempt("a"), Attempt("b"));
        Assert.Single(results.Where(s => s == HttpStatusCode.Created));
        Assert.Single(results.Where(s => s == HttpStatusCode.Forbidden));
    }
}
