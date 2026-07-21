using Ingredo.Api.Common;

namespace Ingredo.Api.Shopping;

public interface IShoppingService
{
    Task<List<ShoppingItemResponse>> ListAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> GetAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> CreateAsync(Guid householdId, ShoppingItemRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> UpdateAsync(Guid householdId, Guid id, ShoppingItemRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<ShoppingItemResponse>> DeleteAsync(Guid householdId, Guid id, CancellationToken cancellationToken);
}
