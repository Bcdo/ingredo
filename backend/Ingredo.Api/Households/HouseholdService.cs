using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Households;

public sealed class HouseholdService(
    AppDbContext db,
    IAuthService auth,
    IJoinCodeService joinCodes) : IHouseholdService
{
    public async Task<HouseholdResponse> GetAsync(Guid householdId, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        var members = await db.HouseholdMembers
            .Where(m => m.HouseholdId == householdId)
            .Join(
                db.Users,
                m => m.UserId,
                u => u.Id,
                (m, u) => new
                {
                    u.Id,
                    u.DisplayName,
                    m.Role,
                    m.CreatedAt,
                })
            .ToListAsync(cancellationToken);

        return new HouseholdResponse(
            household.Id,
            household.Name,
            JoinCodeGenerator.FormatForDisplay(household.JoinCode),
            members
                .OrderBy(m => m.CreatedAt)
                .ThenBy(m => m.Id)
                .Select(m => new MemberResponse(
                    m.Id, m.DisplayName, m.Role.ToString().ToLowerInvariant(), m.CreatedAt))
                .ToList());
    }

    public async Task<HouseholdResponse> RenameAsync(
        Guid householdId, string name, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        household.Name = name.Trim();
        household.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetAsync(householdId, cancellationToken);
    }

    public async Task<HouseholdResponse> RegenerateCodeAsync(
        Guid householdId, CancellationToken cancellationToken)
    {
        var household = await db.Households.SingleAsync(h => h.Id == householdId, cancellationToken);
        household.JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken);
        household.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetAsync(householdId, cancellationToken);
    }

    public async Task<ServiceResult<AuthResponse>> JoinAsync(
        Guid userId, Guid currentHouseholdId, string code, CancellationToken cancellationToken)
    {
        var canonical = JoinCodeGenerator.Canonicalize(code);
        if (canonical is null) return ServiceResult<AuthResponse>.NotFound();

        var target = await db.Households.FirstOrDefaultAsync(
            h => h.JoinCode == canonical, cancellationToken);
        if (target is null) return ServiceResult<AuthResponse>.NotFound();
        if (target.Id == currentHouseholdId) return ServiceResult<AuthResponse>.Conflict();

        var now = DateTimeOffset.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var remaining = await db.HouseholdMembers
            .Where(m => m.HouseholdId == currentHouseholdId && m.UserId != userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);
        var othersRemain = remaining.Count > 0;

        // The joiner may have been the owner of a shared household they're
        // leaving behind — promote the earliest-standing remaining member so
        // the household they leave isn't left ownerless.
        if (othersRemain && membership.Role == HouseholdRole.Owner)
        {
            remaining[0].Role = HouseholdRole.Owner;
        }

        db.HouseholdMembers.Remove(membership);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = target.Id,
            Role = HouseholdRole.Member,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);

        if (!othersRemain)
        {
            // Personal household: the content merges into the new home, then
            // the empty shell is deleted. Re-home BEFORE delete — the FK
            // cascade would otherwise take the recipes down with the shell.
            await db.Recipes
                .IgnoreQueryFilters()
                .Where(r => r.HouseholdId == currentHouseholdId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(r => r.HouseholdId, target.Id)
                        .SetProperty(r => r.UpdatedAt, now),
                    cancellationToken);
            await db.Households
                .Where(h => h.Id == currentHouseholdId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(await auth.IssueTokensAsync(userId, cancellationToken));
    }

    public async Task<ServiceResult<AuthResponse>> LeaveAsync(
        Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken)
    {
        var others = await db.HouseholdMembers
            .Where(m => m.HouseholdId == currentHouseholdId && m.UserId != userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);
        if (others.Count == 0) return ServiceResult<AuthResponse>.Conflict();

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        if (membership.Role == HouseholdRole.Owner)
        {
            others[0].Role = HouseholdRole.Owner;
        }
        db.HouseholdMembers.Remove(membership);

        var personal = new Household
        {
            Id = Guid.NewGuid(),
            Name = user.DisplayName,
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Households.Add(personal);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = personal.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(await auth.IssueTokensAsync(userId, cancellationToken));
    }
}
