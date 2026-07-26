using Ingredo.Api.Auth;
using Ingredo.Api.Common;

namespace Ingredo.Api.Households;

public interface IHouseholdService
{
    Task<HouseholdResponse> GetAsync(Guid householdId, CancellationToken cancellationToken);
    Task<HouseholdResponse> RenameAsync(Guid householdId, string name, CancellationToken cancellationToken);
    Task<HouseholdResponse> RegenerateCodeAsync(Guid householdId, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> JoinAsync(Guid userId, Guid currentHouseholdId, string code, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> LeaveAsync(Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken);
    Task<AuthResponse> CreateAsync(Guid userId, string name, CancellationToken cancellationToken);
    Task<List<HouseholdSummaryResponse>> ListAsync(Guid userId, Guid activeHouseholdId, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> SwitchAsync(Guid userId, Guid householdId, CancellationToken cancellationToken);
}
