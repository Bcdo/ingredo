using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Shopping;

public sealed class ShoppingService(AppDbContext db, IChangeNotifier notifier) : IShoppingService
{
    public async Task<List<ShoppingItemResponse>> ListAsync(
        Guid householdId, CancellationToken cancellationToken)
    {
        return await db.ShoppingItems
            .Where(i => i.HouseholdId == householdId)
            .OrderByDescending(i => i.UpdatedAt)
            .Select(i => ToResponse(i))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<ShoppingItemResponse>> GetAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var item = await Find(householdId, id, cancellationToken);
        return item is null
            ? ServiceResult<ShoppingItemResponse>.NotFound()
            : ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> CreateAsync(
        Guid householdId, ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        if (request.Id is { } requestedId)
        {
            var exists = await db.ShoppingItems
                .IgnoreQueryFilters()
                .AnyAsync(i => i.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<ShoppingItemResponse>.Conflict();
        }

        var now = DateTimeOffset.UtcNow;
        var item = new ShoppingItem
        {
            Id = request.Id ?? Guid.NewGuid(),
            HouseholdId = householdId,
            Name = request.Name.Trim(),
            NormalizedName = request.NormalizedName.Trim(),
            Quantity = request.Quantity,
            Unit = request.Unit,
            Sources = request.Sources,
            Status = Enum.Parse<ShoppingItemStatus>(request.Status, true),
            PurchasedAt = request.PurchasedAt,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.ShoppingItems.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> UpdateAsync(
        Guid householdId, Guid id, ShoppingItemRequest request, CancellationToken cancellationToken)
    {
        var item = await Find(householdId, id, cancellationToken);
        if (item is null) return ServiceResult<ShoppingItemResponse>.NotFound();

        item.Name = request.Name.Trim();
        item.NormalizedName = request.NormalizedName.Trim();
        item.Quantity = request.Quantity;
        item.Unit = request.Unit;
        item.Sources = request.Sources;
        item.Status = Enum.Parse<ShoppingItemStatus>(request.Status, true);
        item.PurchasedAt = request.PurchasedAt;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    public async Task<ServiceResult<ShoppingItemResponse>> DeleteAsync(
        Guid householdId, Guid id, CancellationToken cancellationToken)
    {
        var item = await db.ShoppingItems
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                i => i.Id == id && i.HouseholdId == householdId, cancellationToken);
        if (item is null) return ServiceResult<ShoppingItemResponse>.NotFound();
        if (item.DeletedAt is not null) return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));

        var now = DateTimeOffset.UtcNow;
        item.DeletedAt = now;
        item.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
        return ServiceResult<ShoppingItemResponse>.Ok(ToResponse(item));
    }

    private Task<ShoppingItem?> Find(Guid householdId, Guid id, CancellationToken cancellationToken) =>
        db.ShoppingItems.FirstOrDefaultAsync(
            i => i.Id == id && i.HouseholdId == householdId, cancellationToken);

    private static ShoppingItemResponse ToResponse(ShoppingItem item) =>
        new(item.Id, item.Name, item.NormalizedName, item.Quantity, item.Unit, item.Sources,
            item.Status.ToString().ToLowerInvariant(), item.PurchasedAt,
            item.CreatedAt, item.UpdatedAt);
}
