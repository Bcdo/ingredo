using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Recipes;

public sealed class RecipeService(AppDbContext db) : IRecipeService
{
    public async Task<List<RecipeSummaryResponse>> ListAsync(CancellationToken cancellationToken)
    {
        return await db.Recipes
            .OrderByDescending(r => r.UpdatedAt)
            .Select(r => new RecipeSummaryResponse(r.Id, r.Title, r.Servings, r.UpdatedAt))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<RecipeResponse>> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        var recipe = await LoadAggregate(id, cancellationToken);
        return recipe is null
            ? ServiceResult<RecipeResponse>.NotFound()
            : ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> CreateAsync(
        RecipeRequest request, CancellationToken cancellationToken)
    {
        if (request.Id is { } requestedId)
        {
            var exists = await db.Recipes
                .IgnoreQueryFilters()
                .AnyAsync(r => r.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<RecipeResponse>.Conflict();
        }

        var recipe = request.ToEntity(DateTimeOffset.UtcNow);
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> UpdateAsync(
        Guid id, RecipeRequest request, CancellationToken cancellationToken)
    {
        var recipe = await LoadAggregate(id, cancellationToken);
        if (recipe is null) return ServiceResult<RecipeResponse>.NotFound();

        recipe.Title = request.Title.Trim();
        recipe.Description = request.Description;
        recipe.Servings = request.Servings;
        recipe.Notes = request.Notes;
        recipe.UpdatedAt = DateTimeOffset.UtcNow;

        // Full-aggregate replace, matching the frontend's edit semantics.
        var newIngredients = request.Ingredients.Select(i => i.ToEntity()).ToList();
        var newInstructions = request.Instructions.Select(i => i.ToEntity()).ToList();

        recipe.Ingredients.Clear();
        recipe.Ingredients.AddRange(newIngredients);
        recipe.Instructions.Clear();
        recipe.Instructions.AddRange(newInstructions);

        // The freshly minted children already carry a non-default (Guid.NewGuid)
        // key. EF only infers Added state for a whole graph when the root is
        // explicitly Add()-ed (as in CreateAsync); here the root Recipe is
        // already tracked as Unchanged, so children reached only via
        // navigation fixup are assumed to already exist once their key is
        // set, and EF would emit UPDATE instead of INSERT for them. Mark
        // them Added explicitly so SaveChanges inserts them.
        db.RecipeIngredients.AddRange(newIngredients);
        db.RecipeInstructions.AddRange(newInstructions);

        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var recipe = await db.Recipes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (recipe is null) return ServiceResult<RecipeResponse>.NotFound();
        if (recipe.DeletedAt is not null) return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());

        var now = DateTimeOffset.UtcNow;
        recipe.DeletedAt = now;
        recipe.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    private Task<Domain.Recipe?> LoadAggregate(Guid id, CancellationToken cancellationToken) =>
        db.Recipes
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
}
