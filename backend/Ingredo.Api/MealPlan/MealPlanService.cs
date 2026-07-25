using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.MealPlan;

public sealed class MealPlanService(AppDbContext db, IChangeNotifier notifier) : IMealPlanService
{
    public async Task<List<MealPlanEntryResponse>> ListAsync(
        Guid householdId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        var query = db.MealPlanEntries.Where(e => e.HouseholdId == householdId);
        if (from is { } fromDate) query = query.Where(e => e.Date >= fromDate);
        if (to is { } toDate) query = query.Where(e => e.Date <= toDate);

        return await query
            .OrderBy(e => e.Date)
            .ThenBy(e => e.SortOrder)
            .Select(e => ToResponse(e))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> GetAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var entry = await Find(householdId, id, cancellationToken);
        return entry is null
            ? ServiceResult<MealPlanEntryResponse>.NotFound()
            : ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> CreateAsync(
        Guid householdId, MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        if (!await RecipeIsOurs(householdId, request.RecipeId, cancellationToken))
        {
            return ServiceResult<MealPlanEntryResponse>.Invalid();
        }

        if (request.Id is { } requestedId)
        {
            var exists = await db.MealPlanEntries
                .IgnoreQueryFilters()
                .AnyAsync(e => e.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<MealPlanEntryResponse>.Conflict();
        }

        var now = DateTimeOffset.UtcNow;
        var entry = new MealPlanEntry
        {
            Id = request.Id ?? Guid.NewGuid(),
            HouseholdId = householdId,
            Date = request.Date,
            RecipeId = request.RecipeId,
            Servings = request.Servings,
            SortOrder = request.SortOrder,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.MealPlanEntries.Add(entry);
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> UpdateAsync(
        Guid householdId, Guid id, MealPlanEntryRequest request, CancellationToken cancellationToken)
    {
        var entry = await Find(householdId, id, cancellationToken);
        if (entry is null) return ServiceResult<MealPlanEntryResponse>.NotFound();

        if (!await RecipeIsOurs(householdId, request.RecipeId, cancellationToken))
        {
            return ServiceResult<MealPlanEntryResponse>.Invalid();
        }

        entry.Date = request.Date;
        entry.RecipeId = request.RecipeId;
        entry.Servings = request.Servings;
        entry.SortOrder = request.SortOrder;
        entry.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    public async Task<ServiceResult<MealPlanEntryResponse>> DeleteAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var entry = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                e => e.Id == id && e.HouseholdId == householdId, cancellationToken);
        if (entry is null) return ServiceResult<MealPlanEntryResponse>.NotFound();
        if (entry.DeletedAt is not null) return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));

        var now = DateTimeOffset.UtcNow;
        entry.DeletedAt = now;
        entry.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<MealPlanEntryResponse>.Ok(ToResponse(entry));
    }

    private Task<MealPlanEntry?> Find(Guid householdId, Guid id, CancellationToken cancellationToken) =>
        db.MealPlanEntries.FirstOrDefaultAsync(
            e => e.Id == id && e.HouseholdId == householdId, cancellationToken);

    // The one referential rule: the recipe must be a live recipe in the
    // caller's household. Foreign and nonexistent are indistinguishable.
    private Task<bool> RecipeIsOurs(Guid householdId, Guid recipeId, CancellationToken cancellationToken) =>
        db.Recipes.AnyAsync(
            r => r.Id == recipeId && r.HouseholdId == householdId, cancellationToken);

    private static MealPlanEntryResponse ToResponse(MealPlanEntry entry) =>
        new(entry.Id, entry.Date, entry.RecipeId, entry.Servings, entry.SortOrder,
            entry.CreatedAt, entry.UpdatedAt);
}
