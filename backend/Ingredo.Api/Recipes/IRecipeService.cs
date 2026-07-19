using Ingredo.Api.Common;

namespace Ingredo.Api.Recipes;

public interface IRecipeService
{
    Task<List<RecipeSummaryResponse>> ListAsync(CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> GetAsync(Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> CreateAsync(RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> UpdateAsync(Guid id, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid id, CancellationToken cancellationToken);
}
