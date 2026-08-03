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
        // Invite-first ordering is deliberate: without a live code you
        // cannot probe which emails exist.
        var canonicalInvite = JoinCodeGenerator.Canonicalize(request.InviteCode ?? string.Empty);
        if (canonicalInvite is null) return ServiceResult<AuthResponse>.Forbidden();
        var invite = await db.InviteCodes.FirstOrDefaultAsync(
            i => i.Code == canonicalInvite && i.UsedAt == null, cancellationToken);
        if (invite is null) return ServiceResult<AuthResponse>.Forbidden();

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

        // First household: the client sends a localized default ("Hjem"/
        // "Home"); older clients omit it and keep the person's name.
        // Renameable via PUT /household either way.
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = string.IsNullOrWhiteSpace(request.HouseholdName)
                ? user.DisplayName
                : request.HouseholdName.Trim(),
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

        invite.UsedAt = now;
        invite.UsedByUserId = user.Id;

        db.Users.Add(user);
        db.Households.Add(household);
        db.HouseholdMembers.Add(membership);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), household.Id, now);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two registrations raced one code; the other one won.
            return ServiceResult<AuthResponse>.Forbidden();
        }

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

        var household = await OldestHouseholdOf(user.Id, cancellationToken);
        var refreshValue = IssueRefreshToken(user.Id, familyId: Guid.NewGuid(), household.Id, DateTimeOffset.UtcNow);
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

        // The device's remembered household normally still exists, but it can
        // die from under it (sole-member join/leave merges + deletes it) —
        // that's not theft, just a stale device. Land it on the user's
        // current oldest membership instead of hard-failing the refresh, the
        // same claim a fresh login would produce.
        //
        // The family's household is only valid while the user is still a
        // MEMBER of it — leaving a household (which may survive with other
        // members) must re-home this family exactly like household deletion
        // does. The rotated token below stamps the landing permanently.
        var household = await db.HouseholdMembers
            .Where(m => m.UserId == stored.UserId && m.HouseholdId == stored.HouseholdId)
            .Join(db.Households, m => m.HouseholdId, h => h.Id, (m, h) => h)
            .FirstOrDefaultAsync(cancellationToken);
        var user = await db.Users.SingleAsync(u => u.Id == stored.UserId, cancellationToken);
        household ??= await OldestHouseholdOf(user.Id, cancellationToken);

        stored.RevokedAt = now;
        var refreshValue = IssueRefreshToken(user.Id, stored.FamilyId, household.Id, now);
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
        // slice-④ note: this reports the OLDEST household for lack of request
        // context (MeAsync only receives userId, not the claim household).
        // The frontend's Account section uses getHousehold() — the singular
        // claim-scoped endpoint — for display, so nothing user-visible
        // depends on this household.
        var household = await OldestHouseholdOf(userId, cancellationToken);
        return ServiceResult<UserResponse>.Ok(ToUserResponse(user, household));
    }

    // Used by household membership moves: mints a fresh token pair whose
    // household claim reflects the given household. Call only after the
    // membership change has committed.
    public async Task<AuthResponse> IssueTokensAsync(
        Guid userId, Guid householdId, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        var refreshValue = IssueRefreshToken(userId, familyId: Guid.NewGuid(), householdId, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(cancellationToken);
        return BuildAuthResponse(user, household, refreshValue);
    }

    public async Task<ServiceResult<bool>> ResetPasswordAsync(
        ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        // Every failure below returns the same bare Forbidden: wrong email,
        // wrong/expired/used/raced code must be indistinguishable from
        // outside — no oracle for account existence or code state.
        var canonical = JoinCodeGenerator.Canonicalize(request.Code);
        if (canonical is null) return ServiceResult<bool>.Forbidden();

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null) return ServiceResult<bool>.Forbidden();

        var now = DateTimeOffset.UtcNow;
        var hash = PasswordResetCode.HashCode(canonical);
        var reset = await db.PasswordResetCodes.FirstOrDefaultAsync(
            r => r.UserId == user.Id && r.CodeHash == hash
                && r.UsedAt == null && r.ExpiresAt > now,
            cancellationToken);
        if (reset is null) return ServiceResult<bool>.Forbidden();

        user.PasswordHash = passwordHasher.HashPassword(user, request.NewPassword);
        user.UpdatedAt = now;
        reset.UsedAt = now;

        // A reset means the old credential may be compromised: sign the
        // account out everywhere. Tracked updates (not ExecuteUpdate) so the
        // revocation commits atomically with the code consumption.
        var liveTokens = await db.RefreshTokens
            .Where(t => t.UserId == user.Id && t.RevokedAt == null)
            .ToListAsync(cancellationToken);
        foreach (var token in liveTokens)
        {
            token.RevokedAt = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two resets raced one code; the other one won.
            return ServiceResult<bool>.Forbidden();
        }

        return ServiceResult<bool>.Ok(true);
    }

    private string IssueRefreshToken(Guid userId, Guid familyId, Guid householdId, DateTimeOffset now)
    {
        var value = tokens.CreateRefreshTokenValue();
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FamilyId = familyId,
            HouseholdId = householdId,
            TokenHash = tokens.HashRefreshToken(value),
            ExpiresAt = now.AddDays(jwtOptions.Value.RefreshTokenDays),
            CreatedAt = now,
        });
        return value;
    }

    // Deterministic-oldest: with multiple memberships this is the user's
    // longest-standing household, used wherever there's no request-scoped
    // claim to resolve instead (register/login mint, and MeAsync below).
    private async Task<Household> OldestHouseholdOf(Guid userId, CancellationToken cancellationToken) =>
        await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .Join(db.Households, m => m.HouseholdId, h => h.Id, (m, h) => h)
            .FirstAsync(cancellationToken);

    private AuthResponse BuildAuthResponse(User user, Household household, string refreshValue) =>
        new(tokens.CreateAccessToken(user, household.Id), refreshValue, ToUserResponse(user, household));

    private static UserResponse ToUserResponse(User user, Household household) =>
        new(user.Id, user.Email, user.DisplayName, household.Id, household.Name);
}
