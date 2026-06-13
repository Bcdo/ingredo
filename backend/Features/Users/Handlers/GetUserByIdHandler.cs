using AutoMapper;
using MediatR;
using Microsoft.EntityFrameworkCore;
using RestApiProject.Common;
using RestApiProject.Data;
using RestApiProject.DTOs;
using RestApiProject.Features.Users.Queries;

namespace RestApiProject.Features.Users.Handlers;

/// <summary>
/// Handler for GetUserByIdQuery - Demonstrates modern QUERY patterns
/// 
/// LEARNING NOTES:
/// - Query handlers are OPTIMIZED for reading data
/// - They NEVER modify data
/// - They can use different DTOs than commands
/// - They can be cached aggressively
/// - They can use raw SQL for complex queries
/// - They focus on performance and data shaping
/// </summary>
public class GetUserByIdHandler : IRequestHandler<GetUserByIdQuery, Result<UserResponseDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<GetUserByIdHandler> _logger;

    public GetUserByIdHandler(
        ApplicationDbContext context,
        IMapper mapper,
        ILogger<GetUserByIdHandler> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }

    public async Task<Result<UserResponseDto>> Handle(GetUserByIdQuery request, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Retrieving user with ID: {UserId}", request.UserId);

            // Query optimized for reading - includes related data
            var user = await _context.Users
                .Include(u => u.UserRoles)           // Load user roles
                    .ThenInclude(ur => ur.Role)      // Load role details
                .Where(u => u.IsActive)             // Only active users
                .FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);

            if (user == null)
            {
                _logger.LogWarning("User not found with ID: {UserId}", request.UserId);
                return Result<UserResponseDto>.Failure("User not found");
            }

            // Map to response DTO
            var response = _mapper.Map<UserResponseDto>(user);

            _logger.LogDebug("Successfully retrieved user: {Email}", user.Email);

            return Result<UserResponseDto>.Success(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving user with ID: {UserId}", request.UserId);
            return Result<UserResponseDto>.Failure("An error occurred while retrieving the user");
        }
    }
}

/// <summary>
/// Handler for GetUsersQuery - Demonstrates pagination and filtering
/// </summary>
public class GetUsersHandler : IRequestHandler<Features.Users.Queries.GetUsersQuery, Result<PagedResult<UserSummaryDto>>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<GetUsersHandler> _logger;

    public GetUsersHandler(
        ApplicationDbContext context,
        IMapper mapper,
        ILogger<GetUsersHandler> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }

    public async Task<Result<PagedResult<UserSummaryDto>>> Handle(Features.Users.Queries.GetUsersQuery request, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Retrieving users - Page: {Page}, PageSize: {PageSize}, Search: {SearchTerm}", 
                request.Page, request.PageSize, request.SearchTerm);

            // Build the query with filters
            var query = _context.Users
                .Where(u => u.IsActive)
                .AsQueryable();

            // Apply search filter
            if (!string.IsNullOrEmpty(request.SearchTerm))
            {
                var searchLower = request.SearchTerm.ToLower();
                query = query.Where(u => 
                    u.FirstName.ToLower().Contains(searchLower) ||
                    u.LastName.ToLower().Contains(searchLower) ||
                    u.Email.ToLower().Contains(searchLower));
            }

            // Apply email verification filter
            if (request.IsEmailVerified.HasValue)
            {
                query = query.Where(u => u.IsEmailVerified == request.IsEmailVerified.Value);
            }

            // Get total count for pagination
            var totalCount = await query.CountAsync(cancellationToken);

            // Apply sorting
            query = request.SortBy.ToLower() switch
            {
                "name" => request.SortDirection.ToLower() == "desc" 
                    ? query.OrderByDescending(u => u.FirstName).ThenByDescending(u => u.LastName)
                    : query.OrderBy(u => u.FirstName).ThenBy(u => u.LastName),
                "email" => request.SortDirection.ToLower() == "desc"
                    ? query.OrderByDescending(u => u.Email)
                    : query.OrderBy(u => u.Email),
                _ => request.SortDirection.ToLower() == "desc"
                    ? query.OrderByDescending(u => u.CreatedAt)
                    : query.OrderBy(u => u.CreatedAt)
            };

            // Apply pagination
            var users = await query
                .Skip((request.Page - 1) * request.PageSize)
                .Take(request.PageSize)
                .ToListAsync(cancellationToken);

            // Map to DTOs
            var userDtos = _mapper.Map<List<UserSummaryDto>>(users);

            // Calculate pagination info
            var totalPages = (int)Math.Ceiling(totalCount / (double)request.PageSize);

            var result = new PagedResult<UserSummaryDto>(
                userDtos,
                totalCount,
                request.Page,
                request.PageSize,
                totalPages);

            return Result<PagedResult<UserSummaryDto>>.Success(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving users");
            return Result<PagedResult<UserSummaryDto>>.Failure("An error occurred while retrieving users");
        }
    }
}

/// <summary>
/// LEARNING NOTES: Query Handler Optimization Techniques
/// 
/// 1. SELECTIVE LOADING
///    .Include(u => u.UserRoles).ThenInclude(ur => ur.Role)
///    Only load what you need
/// 
/// 2. FILTERING AT DATABASE LEVEL
///    .Where(u => u.IsActive)
///    Filter in SQL, not in memory
/// 
/// 3. PROJECTION FOR PERFORMANCE
///    .Select(u => new UserSummaryDto(...))
///    Only select needed columns
/// 
/// 4. PAGINATION
///    .Skip().Take() for large datasets
/// 
/// 5. ASYNC OPERATIONS
///    Always use async for database operations
/// 
/// 6. DIFFERENT DTOs
///    Use lightweight DTOs for list operations
///    Use detailed DTOs for single item operations
/// 
/// QUERY OPTIMIZATION TIPS:
/// - Use .AsNoTracking() for read-only queries
/// - Use raw SQL for complex queries
/// - Cache frequently accessed data
/// - Use indexes on filtered columns
/// - Consider using views for complex joins
/// </summary>