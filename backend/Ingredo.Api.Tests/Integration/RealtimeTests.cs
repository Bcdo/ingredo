using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
using Ingredo.Api.Recipes;
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
    public async Task Left_household_token_is_rejected()
    {
        // Join is additive now — it no longer kills any household. So to get
        // a token the guard must reject, the joiner has to actually LEAVE:
        // join the host's shared household, then leave it again. The shared
        // household still exists (the host remains a member) — only the
        // joiner's membership row in it is gone, which is what the guard
        // checks. The pre-leave token (scoped to that shared household) is
        // the one under test.
        var (host, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        var household = await host.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var joinResponse = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        joinResponse.EnsureSuccessStatusCode();
        var joinedAuth = (await joinResponse.Content.ReadFromJsonAsync<AuthResponse>())!;
        joinerClient.UseTokens(joinedAuth);

        var leaveResponse = await joinerClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        leaveResponse.EnsureSuccessStatusCode();

        var connection = BuildConnection(joinedAuth.AccessToken); // pre-leave token

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }

    private static Task<bool> Signal(HubConnection connection)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On("changed", () => tcs.TrySetResult(true));
        return tcs.Task;
    }

    private static async Task<bool> Arrived(Task<bool> signal) =>
        await Task.WhenAny(signal, Task.Delay(TimeSpan.FromSeconds(10))) == signal && signal.Result;

    [Fact]
    public async Task Crud_write_notifies_the_household_and_only_the_household()
    {
        var (memberClient, memberAuth) = await factory.RegisterUserAsync();
        var (outsiderClient, outsiderAuth) = await factory.RegisterUserAsync();
        _ = outsiderClient;
        await using var memberConnection = await ConnectAsync(memberAuth.AccessToken);
        await using var outsiderConnection = await ConnectAsync(outsiderAuth.AccessToken);
        var memberSignal = Signal(memberConnection);
        var outsiderSignal = Signal(outsiderConnection);

        var response = await memberClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "Varslet taco", null, 4, null,
                [new IngredientRequest(null, "Mel", 400, "g", "linear", 0)],
                [new InstructionRequest(null, "Bland.", 0)]));
        response.EnsureSuccessStatusCode();

        Assert.True(await Arrived(memberSignal));
        // The outsider's silence is asserted with a short grace window: the
        // member's signal already proves delivery latency is far below it.
        await Task.Delay(500);
        Assert.False(outsiderSignal.IsCompleted);
    }

    [Fact]
    public async Task Sync_push_notifies_when_rows_apply()
    {
        var (client, auth) = await factory.RegisterUserAsync();
        await using var connection = await ConnectAsync(auth.AccessToken);
        var signal = Signal(connection);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var push = await client.PostAsJsonAsync("/api/v1/sync/push", new
        {
            recipes = new[]
            {
                new
                {
                    id = Guid.NewGuid(),
                    title = "Synk-varslet",
                    description = (string?)null,
                    servings = 4,
                    notes = (string?)null,
                    createdAt = now,
                    updatedAt = now,
                    deletedAt = (long?)null,
                    ingredients = Array.Empty<object>(),
                    instructions = Array.Empty<object>(),
                }
            },
            mealPlanEntries = (object?)null,
            shoppingItems = (object?)null,
        });
        push.EnsureSuccessStatusCode();

        Assert.True(await Arrived(signal));
    }

    [Fact]
    public async Task Join_notifies_the_target_household()
    {
        var (hostClient, hostAuth) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        await using var hostConnection = await ConnectAsync(hostAuth.AccessToken);
        var hostSignal = Signal(hostConnection);
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");

        // Joiner has content — irrelevant to notification, but mirrors a
        // realistic join; additive join never moves it into the host household.
        var created = await joinerClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "Medgift", null, 2, null,
                [new IngredientRequest(null, "Salt", null, null, "fixed", 0)],
                [new InstructionRequest(null, "Ta med.", 0)]));
        created.EnsureSuccessStatusCode();
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        Assert.True(await Arrived(hostSignal));
    }
}
