using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Ingredo.Api.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Ingredo.Api.Auth;

public interface ITokenService
{
    string CreateAccessToken(User user, Guid householdId);
    string CreateRefreshTokenValue();
    string HashRefreshToken(string value);
}

public sealed class TokenService(IOptions<JwtOptions> options) : ITokenService
{
    // Raw claim name — MapInboundClaims is off, so consumers read it verbatim.
    public const string HouseholdClaim = "household";

    public string CreateAccessToken(User user, Guid householdId)
    {
        var jwt = options.Value;
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: jwt.Issuer,
            audience: jwt.Audience,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(HouseholdClaim, householdId.ToString()),
            ],
            expires: DateTime.UtcNow.AddMinutes(jwt.AccessTokenMinutes),
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshTokenValue() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    public string HashRefreshToken(string value) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
