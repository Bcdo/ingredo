using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Households;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Ingredo.Api.Auth;

public sealed class AuthService(
    AppDbContext db,
    ITokenService tokens,
    IPasswordHasher<User> passwordHasher,
    IOptions<JwtOptions> jwtOptions,
    IJoinCodeService joinCodes) : IAuthService
{
    public async Task<ServiceResult<AuthResponse>> RegisterAsync(
        RegisterRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var exists = await db.Users.AnyAsync(u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (exists) return ServiceResult<AuthResponse>.Conflict();

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = request.Email.Trim(),
            NormalizedEmail = normalizedEmail,
            DisplayName = request.DisplayName.Trim(),
            PasswordHash = string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        // Personal household: named after the person (no baked-in language),
        // renameable when Phase 4 brings sharing.
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = user.DisplayName,
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
        var membership = new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            HouseholdId = household.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        };

        db.Users.Add(user);
        db.Households.Add(household);
        db.HouseholdMembers.Add(membership);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), now);
        await db.SaveChangesAsync(cancellationToken);

        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    // A fixed hash to verify against when the account doesn't exist, so an
    // unknown email costs the same PBKDF2 work as a wrong password — no
    // timing oracle for account existence.
    private static readonly string DummyHash =
        new PasswordHasher<User>().HashPassword(new User
        {
            Email = "-", NormalizedEmail = "-", DisplayName = "-", PasswordHash = "-",
        }, "timing-equalizer-password");

    public async Task<ServiceResult<AuthResponse>> LoginAsync(
        LoginRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null)
        {
            passwordHasher.VerifyHashedPassword(
                new User { Email = "-", NormalizedEmail = "-", DisplayName = "-", PasswordHash = "-" },
                DummyHash, request.Password);
            return ServiceResult<AuthResponse>.Unauthorized();
        }

        var verdict = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verdict == PasswordVerificationResult.Failed)
        {
            return ServiceResult<AuthResponse>.Unauthorized();
        }
        if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
            user.UpdatedAt = DateTimeOffset.UtcNow;
        }

        var household = await HouseholdOf(user.Id, cancellationToken);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    public async Task<ServiceResult<AuthResponse>> RefreshAsync(
        string refreshToken, CancellationToken cancellationToken)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(
            t => t.TokenHash == hash, cancellationToken);
        if (stored is null) return ServiceResult<AuthResponse>.Unauthorized();

        var now = DateTimeOffset.UtcNow;
        if (stored.RevokedAt is not null)
        {
            // Reuse of a rotated/revoked token: likely theft — revoke the family.
            await db.RefreshTokens
                .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(t => t.RevokedAt, now), cancellationToken);
            return ServiceResult<AuthResponse>.Unauthorized();
        }
        if (stored.ExpiresAt <= now) return ServiceResult<AuthResponse>.Unauthorized();

        stored.RevokedAt = now;
        var user = await db.Users.SingleAsync(u => u.Id == stored.UserId, cancellationToken);
        var household = await HouseholdOf(user.Id, cancellationToken);
        var refreshValue = IssueRefreshToken(user.Id, stored.FamilyId, now);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(BuildAuthResponse(user, household, refreshValue));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(
            t => t.TokenHash == hash, cancellationToken);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ServiceResult<UserResponse>> MeAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null) return ServiceResult<UserResponse>.NotFound();
        var household = await HouseholdOf(userId, cancellationToken);
        return ServiceResult<UserResponse>.Ok(ToUserResponse(user, household));
    }

    private string IssueRefreshToken(Guid userId, Guid familyId, DateTimeOffset now)
    {
        var value = tokens.CreateRefreshTokenValue();
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FamilyId = familyId,
            TokenHash = tokens.HashRefreshToken(value),
            ExpiresAt = now.AddDays(jwtOptions.Value.RefreshTokenDays),
            CreatedAt = now,
        });
        return value;
    }

    private async Task<Household> HouseholdOf(Guid userId, CancellationToken cancellationToken) =>
        await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .Join(db.Households, m => m.HouseholdId, h => h.Id, (m, h) => h)
            .FirstAsync(cancellationToken);

    private AuthResponse BuildAuthResponse(User user, Household household, string refreshValue) =>
        new(tokens.CreateAccessToken(user, household.Id), refreshValue, ToUserResponse(user, household));

    private static UserResponse ToUserResponse(User user, Household household) =>
        new(user.Id, user.Email, user.DisplayName, household.Id, household.Name);
}
