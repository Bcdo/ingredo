using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Sync;

public sealed partial class SyncService(AppDbContext db) : ISyncService
{
    public async Task<SyncPullResponse> PullAsync(
        Guid householdId, long since, CancellationToken cancellationToken)
    {
        var recipes = await db.Recipes
            .IgnoreQueryFilters()
            .Where(r => r.HouseholdId == householdId && r.SyncSeq > since)
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .OrderBy(r => r.SyncSeq)
            .ToListAsync(cancellationToken);
        var entries = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .Where(e => e.HouseholdId == householdId && e.SyncSeq > since)
            .OrderBy(e => e.SyncSeq)
            .ToListAsync(cancellationToken);
        var items = await db.ShoppingItems
            .IgnoreQueryFilters()
            .Where(i => i.HouseholdId == householdId && i.SyncSeq > since)
            .OrderBy(i => i.SyncSeq)
            .ToListAsync(cancellationToken);

        var cursor = new[]
        {
            since,
            recipes.Count > 0 ? recipes[^1].SyncSeq : 0,
            entries.Count > 0 ? entries[^1].SyncSeq : 0,
            items.Count > 0 ? items[^1].SyncSeq : 0,
        }.Max();

        return new SyncPullResponse(
            recipes.Select(ToRow).ToList(),
            entries.Select(ToRow).ToList(),
            items.Select(ToRow).ToList(),
            cursor);
    }

    private static long Ms(DateTimeOffset value) => value.ToUnixTimeMilliseconds();

    private static long? Ms(DateTimeOffset? value) => value?.ToUnixTimeMilliseconds();

    private static SyncRecipeRow ToRow(Recipe recipe) =>
        new(
            recipe.Id, recipe.Title, recipe.Description, recipe.Servings, recipe.Notes,
            Ms(recipe.CreatedAt), Ms(recipe.UpdatedAt), Ms(recipe.DeletedAt),
            recipe.Ingredients
                .OrderBy(i => i.SortOrder)
                .Select(i => new SyncIngredientRow(
                    i.Id, i.Name, i.Quantity, i.Unit,
                    i.Scaling.ToString().ToLowerInvariant(), i.SortOrder))
                .ToList(),
            recipe.Instructions
                .OrderBy(i => i.SortOrder)
                .Select(i => new SyncInstructionRow(i.Id, i.Text, i.SortOrder))
                .ToList());

    private static SyncMealPlanRow ToRow(MealPlanEntry entry) =>
        new(
            entry.Id, entry.Date.ToString("yyyy-MM-dd"), entry.RecipeId,
            entry.Servings, entry.SortOrder,
            Ms(entry.CreatedAt), Ms(entry.UpdatedAt), Ms(entry.DeletedAt));

    private static SyncShoppingRow ToRow(ShoppingItem item) =>
        new(
            item.Id, item.Name, item.NormalizedName, item.Quantity, item.Unit,
            item.Sources, item.Status.ToString().ToLowerInvariant(), Ms(item.PurchasedAt),
            Ms(item.CreatedAt), Ms(item.UpdatedAt), Ms(item.DeletedAt));

    public Task<SyncPushResponse> PushAsync(
        Guid householdId, SyncPushRequest request, CancellationToken cancellationToken) =>
        throw new NotImplementedException("Task 4 of the sync-endpoints slice.");
}
