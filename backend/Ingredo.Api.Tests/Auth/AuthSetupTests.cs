using Ingredo.Api.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ingredo.Api.Tests.Auth;

public class AuthSetupTests
{
    private static IConfiguration Config(string? key) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = key,
                ["Jwt:Issuer"] = "i",
                ["Jwt:Audience"] = "a",
            })
            .Build();

    [Theory]
    [InlineData(null)]
    [InlineData("short-key")]
    public void Startup_fails_fast_on_missing_or_short_key(string? key)
    {
        var services = new ServiceCollection();
        Assert.Throws<InvalidOperationException>(() => services.AddIngredoAuth(Config(key)));
    }

    [Fact]
    public void Startup_accepts_a_32_byte_key()
    {
        var services = new ServiceCollection();
        services.AddIngredoAuth(Config("0123456789abcdef0123456789abcdef"));
    }
}
