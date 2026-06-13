namespace RestApiProject.DTOs;

/// <summary>
/// Modern DTOs using C# Records for User operations
/// 
/// LEARNING NOTES:
/// - Records are IMMUTABLE by default (safer than classes)
/// - Perfect for DTOs (data that shouldn't change after creation)
/// - Automatic equality comparison
/// - Less boilerplate code
/// - Primary constructors make code cleaner
/// </summary>

// Response DTOs (what we send back to client)
public record UserResponseDto(
    int Id,
    string UserName,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    DateTime DateOfBirth,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    bool IsEmailVerified,
    string? ProfilePictureUrl,
    string? Bio,
    string FullName,
    int Age,
    List<UserRoleDto> Roles
);

public record UserRoleDto(
    int RoleId,
    string RoleName,
    DateTime AssignedAt
);

public record UserSummaryDto(
    int Id,
    string FullName,
    string Email,
    bool IsEmailVerified
);

// Command DTOs (for creating/updating)
public record CreateUserDto(
    string FirstName,
    string LastName,
    string Email,
    string Password,
    string? PhoneNumber,
    DateTime DateOfBirth,
    string? Bio
);

public record UpdateUserDto(
    string FirstName,
    string LastName,
    string? PhoneNumber,
    DateTime DateOfBirth,
    string? Bio
);

public record ChangePasswordDto(
    string CurrentPassword,
    string NewPassword
);

public record UpdateProfilePictureDto(
    string ProfilePictureUrl
);

// Query DTOs (for filtering/searching)
public record GetUsersQuery(
    string? SearchTerm = null,
    bool? IsEmailVerified = null,
    int Page = 1,
    int PageSize = 10,
    string SortBy = "CreatedAt",
    string SortDirection = "desc"
);

/// <summary>
/// LEARNING NOTES: Why Records are Better for DTOs
/// 
/// ❌ OLD WAY (Classes):
/// public class CreateUserDto 
/// {
///     public string FirstName { get; set; } = string.Empty;
///     public string LastName { get; set; } = string.Empty;
///     // ... lots of boilerplate
/// }
/// 
/// ✅ NEW WAY (Records):
/// public record CreateUserDto(string FirstName, string LastName);
/// 
/// Benefits:
/// 1. IMMUTABLE - Can't accidentally modify
/// 2. LESS CODE - Primary constructor syntax
/// 3. BUILT-IN EQUALITY - Compares by value, not reference
/// 4. THREAD SAFE - Immutability prevents race conditions
/// 5. BETTER TESTING - Predictable equality behavior
/// </summary>