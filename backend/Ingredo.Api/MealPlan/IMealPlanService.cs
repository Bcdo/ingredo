using Ingredo.Api.Common;

namespace Ingredo.Api.MealPlan;

public interface IMealPlanService
{
    Task<List<MealPlanEntryResponse>> ListAsync(
        Guid householdId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> CreateAsync(Guid householdId, MealPlanEntryRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> UpdateAsync(Guid householdId, Guid id, MealPlanEntryRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<MealPlanEntryResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
