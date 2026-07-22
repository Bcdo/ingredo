using FluentValidation;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.MealPlan;
using Ingredo.Api.Recipes;
using Ingredo.Api.Shopping;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Sync;

public sealed class SyncService(
    AppDbContext db,
    IValidator<RecipeRequest> recipeValidator,
    IValidator<MealPlanEntryRequest> mealPlanValidator,
    IValidator<ShoppingItemRequest> shoppingValidator) : ISyncService
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

    public async Task<SyncPushResponse> PushAsync(
        Guid householdId, SyncPushRequest request, CancellationToken cancellationToken)
    {
        await ValidateBatchAsync(request, cancellationToken);

        var results = new Dictionary<Guid, string>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        foreach (var row in request.Recipes ?? [])
        {
            results[row.Id] = await ApplyRecipeAsync(householdId, row, cancellationToken);
        }
        foreach (var row in request.MealPlanEntries ?? [])
        {
            results[row.Id] = await ApplyMealPlanAsync(householdId, row, cancellationToken);
        }
        foreach (var row in request.ShoppingItems ?? [])
        {
            results[row.Id] = await ApplyShoppingAsync(householdId, row, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        var cursor = await CurrentCursorAsync(householdId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new SyncPushResponse(results, cursor);
    }

    private const string Applied = "applied";
    private const string Superseded = "superseded";
    private const string Conflict = "conflict";

    private static DateTimeOffset FromMs(long value) => DateTimeOffset.FromUnixTimeMilliseconds(value);

    private static DateTimeOffset? FromMs(long? value) =>
        value is { } ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : null;

    private async Task ValidateBatchAsync(SyncPushRequest request, CancellationToken cancellationToken)
    {
        foreach (var row in request.Recipes ?? [])
        {
            var mapped = new RecipeRequest(row.Id, row.Title, row.Description, row.Servings, row.Notes,
                row.Ingredients.Select(i => new IngredientRequest(
                    i.Id, i.Name, i.Quantity, i.Unit, i.Scaling, i.SortOrder)).ToList(),
                row.Instructions.Select(i => new InstructionRequest(i.Id, i.Text, i.SortOrder)).ToList());
            (await recipeValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
        foreach (var row in request.MealPlanEntries ?? [])
        {
            if (!DateOnly.TryParseExact(row.Date, "yyyy-MM-dd", out var date))
            {
                throw new SyncValidationException(row.Id, "Date", "Date must be yyyy-MM-dd.");
            }
            var mapped = new MealPlanEntryRequest(row.Id, date, row.RecipeId, row.Servings, row.SortOrder);
            (await mealPlanValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
        foreach (var row in request.ShoppingItems ?? [])
        {
            var mapped = new ShoppingItemRequest(row.Id, row.Name, row.NormalizedName, row.Quantity,
                row.Unit, row.Sources, row.Status, FromMs(row.PurchasedAt));
            (await shoppingValidator.ValidateAsync(mapped, cancellationToken))
                .ThrowIfInvalid(row.Id);
        }
    }

    private async Task<string> ApplyRecipeAsync(
        Guid householdId, SyncRecipeRow row, CancellationToken cancellationToken)
    {
        var existing = await db.Recipes
            .IgnoreQueryFilters()
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .FirstOrDefaultAsync(r => r.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        if (existing is null)
        {
            var ingredients = row.DeletedAt is null
                ? row.Ingredients.Select(i => new RecipeIngredient
                {
                    Id = i.Id, Name = i.Name.Trim(), Quantity = i.Quantity, Unit = i.Unit,
                    Scaling = Enum.Parse<ScalingMode>(i.Scaling, true), SortOrder = i.SortOrder,
                }).ToList()
                : [];
            var instructions = row.DeletedAt is null
                ? row.Instructions.Select(i => new RecipeInstruction
                {
                    Id = i.Id, Text = i.Text.Trim(), SortOrder = i.SortOrder,
                }).ToList()
                : [];
            db.Recipes.Add(new Recipe
            {
                Id = row.Id, HouseholdId = householdId, Title = row.Title.Trim(),
                Description = row.Description, Servings = row.Servings, Notes = row.Notes,
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
                Ingredients = ingredients, Instructions = instructions,
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Title = row.Title.Trim();
        existing.Description = row.Description;
        existing.Servings = row.Servings;
        existing.Notes = row.Notes;
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);

        // Merge children in place rather than clear+replace: a sync client
        // keeps stable child ids across edits, so resending an existing id
        // would double-track that key if we materialized fresh entities and
        // AddRange'd them. Instead we reconcile against the tracked
        // collection: drop children absent from the incoming set (this also
        // implements the tombstone rule, since a deleted recipe sends an
        // empty child list), update ones that still match by id, and only
        // explicitly Add brand-new ids (children reached via navigation on
        // an already-tracked root still need explicit Added state).
        var incomingIngredients = row.DeletedAt is null ? row.Ingredients : [];
        foreach (var stale in existing.Ingredients
            .Where(current => incomingIngredients.All(i => i.Id != current.Id)).ToList())
        {
            existing.Ingredients.Remove(stale);
            db.RecipeIngredients.Remove(stale);
        }
        foreach (var incoming in incomingIngredients)
        {
            var current = existing.Ingredients.FirstOrDefault(c => c.Id == incoming.Id);
            if (current is null)
            {
                var added = new RecipeIngredient
                {
                    Id = incoming.Id, Name = incoming.Name.Trim(), Quantity = incoming.Quantity,
                    Unit = incoming.Unit, Scaling = Enum.Parse<ScalingMode>(incoming.Scaling, true),
                    SortOrder = incoming.SortOrder,
                };
                existing.Ingredients.Add(added);
                db.RecipeIngredients.Add(added);
            }
            else
            {
                current.Name = incoming.Name.Trim();
                current.Quantity = incoming.Quantity;
                current.Unit = incoming.Unit;
                current.Scaling = Enum.Parse<ScalingMode>(incoming.Scaling, true);
                current.SortOrder = incoming.SortOrder;
            }
        }

        var incomingInstructions = row.DeletedAt is null ? row.Instructions : [];
        foreach (var stale in existing.Instructions
            .Where(current => incomingInstructions.All(i => i.Id != current.Id)).ToList())
        {
            existing.Instructions.Remove(stale);
            db.RecipeInstructions.Remove(stale);
        }
        foreach (var incoming in incomingInstructions)
        {
            var current = existing.Instructions.FirstOrDefault(c => c.Id == incoming.Id);
            if (current is null)
            {
                var added = new RecipeInstruction
                {
                    Id = incoming.Id, Text = incoming.Text.Trim(), SortOrder = incoming.SortOrder,
                };
                existing.Instructions.Add(added);
                db.RecipeInstructions.Add(added);
            }
            else
            {
                current.Text = incoming.Text.Trim();
                current.SortOrder = incoming.SortOrder;
            }
        }

        return Applied;
    }

    private async Task<string> ApplyMealPlanAsync(
        Guid householdId, SyncMealPlanRow row, CancellationToken cancellationToken)
    {
        var existing = await db.MealPlanEntries
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        // FK safety, not the CRUD live-recipe rule: a tombstoned recipe is a
        // legal replicated target. Local-pending recipes from the same batch
        // are visible here (tracked inserts flush on SaveChanges — use Local).
        var recipeExists =
            db.Recipes.Local.Any(r => r.Id == row.RecipeId && r.HouseholdId == householdId)
            || await db.Recipes.IgnoreQueryFilters()
                .AnyAsync(r => r.Id == row.RecipeId && r.HouseholdId == householdId, cancellationToken);
        if (!recipeExists) return Conflict;

        var date = DateOnly.ParseExact(row.Date, "yyyy-MM-dd");
        if (existing is null)
        {
            db.MealPlanEntries.Add(new MealPlanEntry
            {
                Id = row.Id, HouseholdId = householdId, Date = date, RecipeId = row.RecipeId,
                Servings = row.Servings, SortOrder = row.SortOrder,
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Date = date;
        existing.RecipeId = row.RecipeId;
        existing.Servings = row.Servings;
        existing.SortOrder = row.SortOrder;
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);
        return Applied;
    }

    private async Task<string> ApplyShoppingAsync(
        Guid householdId, SyncShoppingRow row, CancellationToken cancellationToken)
    {
        var existing = await db.ShoppingItems
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(i => i.Id == row.Id, cancellationToken);
        if (existing is not null && existing.HouseholdId != householdId) return Conflict;

        var status = Enum.Parse<ShoppingItemStatus>(row.Status, true);
        if (existing is null)
        {
            db.ShoppingItems.Add(new ShoppingItem
            {
                Id = row.Id, HouseholdId = householdId, Name = row.Name.Trim(),
                NormalizedName = row.NormalizedName.Trim(), Quantity = row.Quantity,
                Unit = row.Unit, Sources = row.Sources, Status = status,
                PurchasedAt = FromMs(row.PurchasedAt),
                CreatedAt = FromMs(row.CreatedAt), UpdatedAt = FromMs(row.UpdatedAt),
                DeletedAt = FromMs(row.DeletedAt),
            });
            return Applied;
        }

        if (row.UpdatedAt <= existing.UpdatedAt.ToUnixTimeMilliseconds()) return Superseded;

        existing.Name = row.Name.Trim();
        existing.NormalizedName = row.NormalizedName.Trim();
        existing.Quantity = row.Quantity;
        existing.Unit = row.Unit;
        existing.Sources = row.Sources;
        existing.Status = status;
        existing.PurchasedAt = FromMs(row.PurchasedAt);
        existing.UpdatedAt = FromMs(row.UpdatedAt);
        existing.DeletedAt = FromMs(row.DeletedAt);
        return Applied;
    }

    private async Task<long> CurrentCursorAsync(Guid householdId, CancellationToken cancellationToken)
    {
        var recipeMax = await db.Recipes.IgnoreQueryFilters()
            .Where(r => r.HouseholdId == householdId)
            .MaxAsync(r => (long?)r.SyncSeq, cancellationToken) ?? 0;
        var entryMax = await db.MealPlanEntries.IgnoreQueryFilters()
            .Where(e => e.HouseholdId == householdId)
            .MaxAsync(e => (long?)e.SyncSeq, cancellationToken) ?? 0;
        var itemMax = await db.ShoppingItems.IgnoreQueryFilters()
            .Where(i => i.HouseholdId == householdId)
            .MaxAsync(i => (long?)i.SyncSeq, cancellationToken) ?? 0;
        return Math.Max(recipeMax, Math.Max(entryMax, itemMax));
    }
}

public sealed class SyncValidationException(Guid rowId, string field, string message)
    : Exception($"{field}: {message}")
{
    public Guid RowId { get; } = rowId;
    public string Field { get; } = field;
    public string ErrorMessage { get; } = message;
}

file static class ValidationResultExtensions
{
    public static void ThrowIfInvalid(this FluentValidation.Results.ValidationResult result, Guid rowId)
    {
        if (result.IsValid) return;
        var first = result.Errors[0];
        throw new SyncValidationException(rowId, first.PropertyName, first.ErrorMessage);
    }
}
