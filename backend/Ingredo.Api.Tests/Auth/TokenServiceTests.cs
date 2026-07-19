using System.IdentityModel.Tokens.Jwt;
using Ingredo.Api.Auth;
using Ingredo.Api.Domain;
using Microsoft.Extensions.Options;

namespace Ingredo.Api.Tests.Auth;

public class TokenServiceTests
{
    private static TokenService NewService() =>
        new(Options.Create(new JwtOptions
        {
            Key = "unit-test-signing-key-0123456789abcdef-extra",
            Issuer = "ingredo-api",
            Audience = "ingredo-app",
        }));

    private static User NewUser() => new()
    {
        Id = Guid.NewGuid(),
        Email = "a@b.no",
        NormalizedEmail = "a@b.no",
        DisplayName = "A",
        PasswordHash = "x",
    };

    [Fact]
    public void Access_token_carries_sub_household_issuer_audience_and_15_minute_expiry()
    {
        var user = NewUser();
        var householdId = Guid.NewGuid();

        var token = new JwtSecurityTokenHandler().ReadJwtToken(
            NewService().CreateAccessToken(user, householdId));

        Assert.Equal(user.Id.ToString(), token.Claims.Single(c => c.Type == "sub").Value);
        Assert.Equal(householdId.ToString(), token.Claims.Single(c => c.Type == "household").Value);
        Assert.Equal("ingredo-api", token.Issuer);
        Assert.Contains("ingredo-app", token.Audiences);
        var lifetime = token.ValidTo - DateTime.UtcNow;
        Assert.InRange(lifetime, TimeSpan.FromMinutes(13), TimeSpan.FromMinutes(16));
    }

    [Fact]
    public void Refresh_token_values_are_long_and_unique()
    {
        var service = NewService();
        var first = service.CreateRefreshTokenValue();
        var second = service.CreateRefreshTokenValue();

        Assert.True(first.Length >= 40);
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Refresh_token_hash_is_deterministic_and_not_the_value()
    {
        var service = NewService();
        var value = service.CreateRefreshTokenValue();

        Assert.Equal(service.HashRefreshToken(value), service.HashRefreshToken(value));
        Assert.NotEqual(value, service.HashRefreshToken(value));
    }
}
