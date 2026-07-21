using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Shopping;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class ShoppingApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HttpClient _client = null!;

    public async Task InitializeAsync() => _client = await factory.CreateAuthenticatedClientAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static ShoppingItemRequest NewItem(
        string name = "Melk", string status = "active", Guid? id = null) =>
        new(id, name, name.ToLowerInvariant(), 1000, "ml", "[\"Pannekaker\"]", status, null);

    [Fact]
    public async Task Create_then_get_round_trips_including_opaque_sources()
    {
        var created = await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await created.Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var fetched = await _client.GetFromJsonAsync<ShoppingItemResponse>(
            $"/api/v1/shopping-items/{item!.Id}");
        Assert.Equal("Melk", fetched!.Name);
        Assert.Equal("melk", fetched.NormalizedName);
        Assert.Equal("[\"Pannekaker\"]", fetched.Sources);
        Assert.Equal("active", fetched.Status);
        Assert.Null(fetched.PurchasedAt);
    }

    [Fact]
    public async Task Status_and_purchased_at_are_client_owned_row_state()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var purchasedAt = DateTimeOffset.UtcNow;
        var updated = await _client.PutAsJsonAsync(
            $"/api/v1/shopping-items/{created!.Id}",
            NewItem(status: "Purchased") with { PurchasedAt = purchasedAt });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var item = await updated.Content.ReadFromJsonAsync<ShoppingItemResponse>();

        Assert.Equal("purchased", item!.Status);
        Assert.NotNull(item.PurchasedAt);
        Assert.True(item.UpdatedAt >= created.UpdatedAt);
    }

    [Fact]
    public async Task Create_honors_client_id_and_conflicts_on_reuse()
    {
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created,
            (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem(id: id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Ost", id: id))).StatusCode);
    }

    [Fact]
    public async Task List_excludes_deleted_and_orders_newest_first()
    {
        var a = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Eldst")))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();
        await Task.Delay(10);
        await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem("Nyest"));
        await _client.DeleteAsync($"/api/v1/shopping-items/{a!.Id}");

        var list = await _client.GetFromJsonAsync<List<ShoppingItemResponse>>("/api/v1/shopping-items");
        var only = Assert.Single(list!);
        Assert.Equal("Nyest", only.Name);
    }

    [Fact]
    public async Task Delete_is_soft_and_idempotent_and_unknown_is_404()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.GetAsync($"/api/v1/shopping-items/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _client.DeleteAsync($"/api/v1/shopping-items/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Households_are_isolated()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/shopping-items", NewItem()))
            .Content.ReadFromJsonAsync<ShoppingItemResponse>();

        var other = await factory.CreateAuthenticatedClientAsync();
        Assert.Empty((await other.GetFromJsonAsync<List<ShoppingItemResponse>>(
            "/api/v1/shopping-items"))!);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.GetAsync($"/api/v1/shopping-items/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync(
                $"/api/v1/shopping-items/{created.Id}", NewItem("Kapret"))).StatusCode);
    }
}
