namespace Ingredo.Api.Auth;

public sealed record RegisterRequest(string Email, string Password, string DisplayName);

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record LogoutRequest(string RefreshToken);

public sealed record UserResponse(
    Guid Id,
    string Email,
    string DisplayName,
    Guid HouseholdId,
    string HouseholdName);

public sealed record AuthResponse(string AccessToken, string RefreshToken, UserResponse User);
