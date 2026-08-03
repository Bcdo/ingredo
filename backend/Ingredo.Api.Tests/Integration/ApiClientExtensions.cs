using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Households;
using Microsoft.Extensions.DependencyInjection;

namespace Ingredo.Api.Tests.Integration;

public static class ApiClientExtensions
{
    // Inserts an unused invite code directly into the test database — the
    // operator-side mint step, minus the shell script.
    public static async Task<string> MintInviteCodeAsync(this ApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var code = JoinCodeGenerator.NewCode();
        db.InviteCodes.Add(new InviteCode
        {
            Id = Guid.NewGuid(),
            Code = code,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return code;
    }

    // Registers a fresh throwaway user and returns a client with its Bearer
    // token attached — each call is an isolated household.
    public static async Task<HttpClient> CreateAuthenticatedClientAsync(this ApiFactory factory)
    {
        var client = factory.CreateClient();
        var invite = await factory.MintInviteCodeAsync();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", "Test Bruker", InviteCode: invite);
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", register);
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return client;
    }

    // Like CreateAuthenticatedClientAsync, but also returns the auth payload
    // (tokens + user) for tests that need ids or re-authentication.
    public static async Task<(HttpClient Client, AuthResponse Auth)> RegisterUserAsync(
        this ApiFactory factory, string displayName = "Test Bruker")
    {
        var client = factory.CreateClient();
        var invite = await factory.MintInviteCodeAsync();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", displayName, InviteCode: invite);
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", register);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }

    public static void UseTokens(this HttpClient client, AuthResponse auth) =>
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth.AccessToken);
}
