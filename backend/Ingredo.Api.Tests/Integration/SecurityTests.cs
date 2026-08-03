using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class SecurityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Login_IsRateLimited_PerClient()
    {
        using var limited = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("RateLimiting:Auth:PermitLimit", "2"));
        using var client = limited.CreateClient();
        var body = new { email = "nobody@test.local", password = "wrong-password" };

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/login", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/login", body)).StatusCode);

        var third = await client.PostAsJsonAsync("/api/v1/auth/login", body);
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.True(third.Headers.Contains("Retry-After"));
    }

    [Fact]
    public async Task Health_StaysAnonymousAndUnlimited()
    {
        using var limited = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("RateLimiting:Global:PermitLimit", "1"));
        using var client = limited.CreateClient();

        for (var i = 0; i < 5; i++)
        {
            var response = await client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task DataEndpoint_WithoutToken_Is401()
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/v1/recipes");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
