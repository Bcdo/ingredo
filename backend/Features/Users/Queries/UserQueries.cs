using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Users.Queries;

/// <summary>
/// All User Queries (Read Operations)
/// 
/// LEARNING NOTES:
/// - Queries represent READ operations (Get, Search, List)
/// - They should NOT modify any data
/// - They can be cached for performance
/// - They often return different DTOs than commands
/// - They can be optimized separately from commands
/// </summary>

// Get single user by ID
public record GetUserByIdQuery(int UserId) : IRequest<Result<UserResponseDto>>;

// Get user by email (for authentication)
public record GetUserByEmailQuery(string Email) : IRequest<Result<UserResponseDto>>;

// Get all users with pagination and filtering
public record GetUsersQuery(
    string? SearchTerm = null,
    bool? IsEmailVerified = null,
    int Page = 1,
    int PageSize = 10,
    string SortBy = "CreatedAt",
    string SortDirection = "desc"
) : IRequest<Result<PagedResult<UserSummaryDto>>>;

// Get user's roles
public record GetUserRolesQuery(int UserId) : IRequest<Result<List<UserRoleDto>>>;

// Check if email exists (for registration validation)
public record CheckEmailExistsQuery(string Email) : IRequest<Result<bool>>;

// Get user statistics (admin feature)
public record GetUserStatsQuery() : IRequest<Result<UserStatsDto>>;

// Search users by name or email
public record SearchUsersQuery(string SearchTerm, int MaxResults = 20) : IRequest<Result<List<UserSummaryDto>>>;

/// <summary>
/// Supporting DTOs for complex query results
/// </summary>
public record PagedResult<T>(
    List<T> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages
)
{
    public bool HasNextPage => Page < TotalPages;
    public bool HasPreviousPage => Page > 1;
}

public record UserStatsDto(
    int TotalUsers,
    int ActiveUsers,
    int VerifiedUsers,
    int NewUsersToday,
    int NewUsersThisWeek,
    int NewUsersThisMonth
);

/// <summary>
/// LEARNING NOTES: Query vs Command Differences
/// 
/// COMMANDS (Write):
/// ✅ Modify data
/// ✅ Return Result<T> with created/updated data
/// ✅ Have business logic validation
/// ✅ Can trigger side effects (emails, notifications)
/// ✅ Should be idempotent when possible
/// 
/// QUERIES (Read):
/// ✅ Never modify data
/// ✅ Return Result<T> with requested data
/// ✅ Focus on performance and caching
/// ✅ Can be cached aggressively
/// ✅ Can be optimized with raw SQL if needed
/// 
/// SEPARATION BENEFITS:
/// - Commands optimized for writes (normalization)
/// - Queries optimized for reads (denormalization)
/// - Different performance characteristics
/// - Independent scaling
/// - Easier testing
/// </summary>