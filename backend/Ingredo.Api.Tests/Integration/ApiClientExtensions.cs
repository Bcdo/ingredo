using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ingredo.Api.Auth;

namespace Ingredo.Api.Tests.Integration;

public static class ApiClientExtensions
{
    // Registers a fresh throwaway user and returns a client with its Bearer
    // token attached — each call is an isolated household.
    public static async Task<HttpClient> CreateAuthenticatedClientAsync(this ApiFactory factory)
    {
        var client = factory.CreateClient();
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", "Test Bruker");
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
        var register = new RegisterRequest(
            $"user-{Guid.NewGuid():N}@test.local", "passord123", displayName);
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
