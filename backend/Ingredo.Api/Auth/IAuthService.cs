using Ingredo.Api.Common;

namespace Ingredo.Api.Auth;

public interface IAuthService
{
    Task<ServiceResult<AuthResponse>> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> RefreshAsync(string refreshToken, CancellationToken cancellationToken);
    Task LogoutAsync(string refreshToken, CancellationToken cancellationToken);
    Task<ServiceResult<UserResponse>> MeAsync(Guid userId, CancellationToken cancellationToken);
    Task<AuthResponse> IssueTokensAsync(Guid userId, Guid householdId, CancellationToken cancellationToken);
}
