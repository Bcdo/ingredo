using Asp.Versioning;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using RestApiProject.DTOs;
using RestApiProject.Features.Users.Commands;
using RestApiProject.Features.Users.Queries;

namespace RestApiProject.Controllers;

/// <summary>
/// Modern Users Controller demonstrating CQRS + MediatR patterns
/// 
/// LEARNING NOTES:
/// - Controller is THIN - no business logic!
/// - Uses MediatR to send commands/queries to handlers
/// - Consistent error handling with Result pattern
/// - Clean, readable, maintainable code
/// - Easy to test (just test the handlers)
/// - Follows RESTful conventions
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
[Produces("application/json")]
public class UsersController : ControllerBase
{
    private readonly IMediator _mediator;

    public UsersController(IMediator mediator)
    {
        _mediator = mediator;
    }

    /// <summary>
    /// Get all users with pagination and filtering
    /// </summary>
    /// <param name="searchTerm">Search in name or email</param>
    /// <param name="isEmailVerified">Filter by email verification status</param>
    /// <param name="page">Page number (default: 1)</param>
    /// <param name="pageSize">Items per page (default: 10)</param>
    /// <param name="sortBy">Sort by field (name, email, createdAt)</param>
    /// <param name="sortDirection">Sort direction (asc, desc)</param>
    /// <returns>Paginated list of users</returns>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<UserSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PagedResult<UserSummaryDto>>> GetUsers(
        [FromQuery] string? searchTerm = null,
        [FromQuery] bool? isEmailVerified = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string sortBy = "CreatedAt",
        [FromQuery] string sortDirection = "desc")
    {
        var query = new Features.Users.Queries.GetUsersQuery(searchTerm, isEmailVerified, page, pageSize, sortBy, sortDirection);
        var result = await _mediator.Send(query);

        return result.IsSuccess 
            ? Ok(result.Value)
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Get user by ID
    /// </summary>
    /// <param name="id">User ID</param>
    /// <returns>User details</returns>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserResponseDto>> GetUser(int id)
    {
        var result = await _mediator.Send(new GetUserByIdQuery(id));

        return result.IsSuccess 
            ? Ok(result.Value)
            : NotFound(result.Error);
    }

    /// <summary>
    /// Create a new user
    /// </summary>
    /// <param name="createUserDto">User creation data</param>
    /// <returns>Created user</returns>
    [HttpPost]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UserResponseDto>> CreateUser([FromBody] CreateUserDto createUserDto)
    {
        var result = await _mediator.Send(new CreateUserCommand(createUserDto));

        if (result.IsSuccess)
        {
            return CreatedAtAction(
                nameof(GetUser), 
                new { id = result.Value!.Id, version = "1.0" }, 
                result.Value);
        }

        return BadRequest(result.Error);
    }

    /// <summary>
    /// Update user profile
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="updateUserDto">User update data</param>
    /// <returns>Updated user</returns>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserResponseDto>> UpdateUser(int id, [FromBody] UpdateUserDto updateUserDto)
    {
        var result = await _mediator.Send(new UpdateUserCommand(id, updateUserDto));

        return result.IsSuccess 
            ? Ok(result.Value)
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Delete user (soft delete)
    /// </summary>
    /// <param name="id">User ID</param>
    /// <returns>No content on success</returns>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteUser(int id)
    {
        var result = await _mediator.Send(new DeleteUserCommand(id));

        return result.IsSuccess 
            ? NoContent()
            : NotFound(result.Error);
    }

    /// <summary>
    /// Change user password
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="changePasswordDto">Password change data</param>
    /// <returns>No content on success</returns>
    [HttpPatch("{id:int}/password")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ChangePassword(int id, [FromBody] ChangePasswordDto changePasswordDto)
    {
        var result = await _mediator.Send(new ChangePasswordCommand(id, changePasswordDto));

        return result.IsSuccess 
            ? NoContent()
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Update user profile picture
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="profilePictureDto">Profile picture data</param>
    /// <returns>Updated user</returns>
    [HttpPatch("{id:int}/profile-picture")]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserResponseDto>> UpdateProfilePicture(int id, [FromBody] UpdateProfilePictureDto profilePictureDto)
    {
        var result = await _mediator.Send(new UpdateProfilePictureCommand(id, profilePictureDto));

        return result.IsSuccess 
            ? Ok(result.Value)
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Verify user email
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="token">Verification token</param>
    /// <returns>No content on success</returns>
    [HttpPost("{id:int}/verify-email")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> VerifyEmail(int id, [FromBody] string token)
    {
        var result = await _mediator.Send(new VerifyEmailCommand(id, token));

        return result.IsSuccess 
            ? NoContent()
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Send password reset email
    /// </summary>
    /// <param name="email">User email</param>
    /// <returns>No content (always, for security)</returns>
    [HttpPost("password-reset")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SendPasswordReset([FromBody] string email)
    {
        // Always return success for security (don't reveal if email exists)
        await _mediator.Send(new SendPasswordResetCommand(email));
        return NoContent();
    }

    /// <summary>
    /// Get user's roles
    /// </summary>
    /// <param name="id">User ID</param>
    /// <returns>List of user roles</returns>
    [HttpGet("{id:int}/roles")]
    [ProducesResponseType(typeof(List<UserRoleDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<List<UserRoleDto>>> GetUserRoles(int id)
    {
        var result = await _mediator.Send(new GetUserRolesQuery(id));

        return result.IsSuccess 
            ? Ok(result.Value)
            : NotFound(result.Error);
    }

    /// <summary>
    /// Assign role to user
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="roleId">Role ID</param>
    /// <returns>No content on success</returns>
    [HttpPost("{id:int}/roles/{roleId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AssignRole(int id, int roleId)
    {
        var result = await _mediator.Send(new AssignUserRoleCommand(id, roleId));

        return result.IsSuccess 
            ? NoContent()
            : BadRequest(result.Error);
    }

    /// <summary>
    /// Remove role from user
    /// </summary>
    /// <param name="id">User ID</param>
    /// <param name="roleId">Role ID</param>
    /// <returns>No content on success</returns>
    [HttpDelete("{id:int}/roles/{roleId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RemoveRole(int id, int roleId)
    {
        var result = await _mediator.Send(new RemoveUserRoleCommand(id, roleId));

        return result.IsSuccess 
            ? NoContent()
            : BadRequest(result.Error);
    }
}

/// <summary>
/// LEARNING NOTES: Modern Controller Benefits
/// 
/// ❌ OLD WAY (Fat Controller):
/// - 300+ lines of business logic
/// - Hard to test (need HTTP context mocking)
/// - Mixed concerns (validation, business logic, data access)
/// - Difficult to maintain
/// - Tight coupling
/// 
/// ✅ NEW WAY (Thin Controller):
/// - ~200 lines total (mostly documentation!)
/// - Easy to test (just test handlers separately)
/// - Single responsibility (HTTP concerns only)
/// - Easy to maintain (clear separation)
/// - Loose coupling via MediatR
/// 
/// CONTROLLER RESPONSIBILITIES (ONLY):
/// 1. Route HTTP requests
/// 2. Parse/validate HTTP input
/// 3. Send commands/queries via MediatR
/// 4. Return appropriate HTTP responses
/// 5. Handle HTTP-specific concerns (status codes, headers)
/// 
/// BUSINESS LOGIC STAYS IN HANDLERS!
/// 
/// TESTING STRATEGY:
/// - Unit test handlers (where business logic lives)
/// - Integration test controllers (HTTP behavior)
/// - Mock MediatR in controller tests
/// 
/// BENEFITS:
/// - Controllers become thin HTTP adapters
/// - Business logic is reusable (not tied to HTTP)
/// - Easy to add other interfaces (gRPC, SignalR, etc.)
/// - Clear separation of concerns
/// - Easier maintenance and debugging
/// </summary>