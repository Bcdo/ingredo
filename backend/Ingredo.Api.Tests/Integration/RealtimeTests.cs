using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class RealtimeTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // LongPolling because WebSockets don't run over TestServer; the token
    // rides the query string — the exact pattern React Native clients use.
    private HubConnection BuildConnection(string accessToken)
    {
        return new HubConnectionBuilder()
            .WithUrl(
                $"{factory.Server.BaseAddress}hubs/sync?access_token={Uri.EscapeDataString(accessToken)}",
                options =>
                {
                    options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();
    }

    private async Task<HubConnection> ConnectAsync(string accessToken)
    {
        var connection = BuildConnection(accessToken);
        await connection.StartAsync();
        return connection;
    }

    [Fact]
    public async Task Authenticated_member_can_connect()
    {
        var (_, auth) = await factory.RegisterUserAsync();

        await using var connection = await ConnectAsync(auth.AccessToken);

        Assert.Equal(HubConnectionState.Connected, connection.State);
    }

    [Fact]
    public async Task Anonymous_connection_is_rejected()
    {
        var connection = BuildConnection(string.Empty);

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }

    [Fact]
    public async Task Dead_household_token_is_rejected()
    {
        // B's original token references a household that stops existing the
        // moment sole-member B joins A (shell delete) — the guard's job.
        // RegisterUserAsync's client is already authenticated (Bearer token
        // attached), so we reuse it directly instead of CreateClient + UseTokens.
        var (host, hostAuth) = await factory.RegisterUserAsync();
        var (joinerClient, joinerAuth) = await factory.RegisterUserAsync();
        var household = await host.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var joinResponse = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        joinResponse.EnsureSuccessStatusCode();

        var connection = BuildConnection(joinerAuth.AccessToken);

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }
}
