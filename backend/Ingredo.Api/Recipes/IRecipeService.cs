using Ingredo.Api.Common;

namespace Ingredo.Api.Recipes;

public interface IRecipeService
{
    Task<List<RecipeSummaryResponse>> ListAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> CreateAsync(Guid householdId, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> UpdateAsync(Guid householdId, Guid id, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
