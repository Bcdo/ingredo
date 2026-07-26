using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Households;

public sealed class HouseholdService(
    AppDbContext db,
    IAuthService auth,
    IJoinCodeService joinCodes,
    IChangeNotifier notifier) : IHouseholdService
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

        var alreadyMember = await db.HouseholdMembers.AnyAsync(
            m => m.UserId == userId && m.HouseholdId == target.Id, cancellationToken);
        if (alreadyMember) return ServiceResult<AuthResponse>.Conflict();

        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = target.Id,
            Role = HouseholdRole.Member,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Concurrent double-join: the (UserId, HouseholdId) unique index
            // is the arbiter.
            return ServiceResult<AuthResponse>.Conflict();
        }

        await notifier.NotifyHouseholdChangedAsync(target.Id, cancellationToken);
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, target.Id, cancellationToken));
    }

    public async Task<ServiceResult<AuthResponse>> LeaveAsync(
        Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Serialize all membership changes for this user: the safety clause
        // below trusts a snapshot of the user's OTHER memberships, and two
        // concurrent leaves from different households would otherwise each
        // see the other as a landing spot (write-skew under READ COMMITTED)
        // and strand the user with zero memberships. User rows first, then
        // the household row — a deadlock-safe order.
        await db.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM "HouseholdMembers" WHERE "UserId" = {userId} FOR UPDATE""",
            cancellationToken);
        await db.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM "Households" WHERE "Id" = {currentHouseholdId} FOR UPDATE""",
            cancellationToken);

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var others = await db.HouseholdMembers
            .Where(m => m.HouseholdId == currentHouseholdId && m.UserId != userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);
        var otherMemberships = await db.HouseholdMembers
            .Where(m => m.UserId == userId && m.HouseholdId != currentHouseholdId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);

        if (others.Count == 0 && otherMemberships.Count == 0)
        {
            // Sole member, nowhere to land: leaving would destroy content
            // just to mint an identical empty household — and the client's
            // leave dialog promises content survives.
            return ServiceResult<AuthResponse>.Conflict();
        }

        if (others.Count > 0 && membership.Role == HouseholdRole.Owner)
        {
            others[0].Role = HouseholdRole.Owner;
        }
        db.HouseholdMembers.Remove(membership);
        await db.SaveChangesAsync(cancellationToken);

        if (others.Count == 0)
        {
            // Last member out: the household and its content go with them.
            await db.Households
                .Where(h => h.Id == currentHouseholdId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        Guid nextHouseholdId;
        if (otherMemberships.Count > 0)
        {
            nextHouseholdId = otherMemberships[0].HouseholdId;
        }
        else
        {
            var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
            var now = DateTimeOffset.UtcNow;
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
            nextHouseholdId = personal.Id;
        }

        await transaction.CommitAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, nextHouseholdId, cancellationToken));
    }

    public async Task<AuthResponse> CreateAsync(
        Guid userId, string name, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Households.Add(household);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = household.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        return await auth.IssueTokensAsync(userId, household.Id, cancellationToken);
    }

    public async Task<List<HouseholdSummaryResponse>> ListAsync(
        Guid userId, Guid activeHouseholdId, CancellationToken cancellationToken)
    {
        var memberships = await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .Join(
                db.Households,
                m => m.HouseholdId,
                h => h.Id,
                (m, h) => new { h.Id, h.Name, h.JoinCode, m.Role, m.CreatedAt })
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        var counts = await db.HouseholdMembers
            .Where(m => memberships.Select(x => x.Id).Contains(m.HouseholdId))
            .GroupBy(m => m.HouseholdId)
            .Select(g => new { HouseholdId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var countById = counts.ToDictionary(c => c.HouseholdId, c => c.Count);

        return memberships
            .Select(x => new HouseholdSummaryResponse(
                x.Id,
                x.Name,
                JoinCodeGenerator.FormatForDisplay(x.JoinCode),
                countById.GetValueOrDefault(x.Id, 1),
                x.Role.ToString().ToLowerInvariant(),
                x.Id == activeHouseholdId))
            .ToList();
    }

    public async Task<ServiceResult<AuthResponse>> SwitchAsync(
        Guid userId, Guid householdId, CancellationToken cancellationToken)
    {
        var isMember = await db.HouseholdMembers.AnyAsync(
            m => m.UserId == userId && m.HouseholdId == householdId, cancellationToken);
        if (!isMember) return ServiceResult<AuthResponse>.NotFound();
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, householdId, cancellationToken));
    }
}
