using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Users.Commands;

/// <summary>
/// All User Commands (Write Operations)
/// 
/// LEARNING NOTES:
/// Each command is focused on ONE operation only.
/// This makes the code:
/// - Easy to understand
/// - Easy to test
/// - Easy to maintain
/// - Easy to extend
/// </summary>

// Update user profile
public record UpdateUserCommand(int UserId, UpdateUserDto UserData) : IRequest<Result<UserResponseDto>>;

// Delete user (soft delete)
public record DeleteUserCommand(int UserId) : IRequest<Result>;

// Change password
public record ChangePasswordCommand(int UserId, ChangePasswordDto PasswordData) : IRequest<Result>;

// Update profile picture
public record UpdateProfilePictureCommand(int UserId, UpdateProfilePictureDto ProfileData) : IRequest<Result<UserResponseDto>>;

// Email verification
public record VerifyEmailCommand(int UserId, string VerificationToken) : IRequest<Result>;

// Send password reset email
public record SendPasswordResetCommand(string Email) : IRequest<Result>;

// Reset password with token
public record ResetPasswordCommand(string Email, string ResetToken, string NewPassword) : IRequest<Result>;

// Assign role to user
public record AssignUserRoleCommand(int UserId, int RoleId) : IRequest<Result>;

// Remove role from user
public record RemoveUserRoleCommand(int UserId, int RoleId) : IRequest<Result>;

/// <summary>
/// LEARNING NOTES: Command Naming Conventions
/// 
/// Good command names:
/// ✅ CreateUserCommand - Clear action + entity
/// ✅ UpdateUserCommand - Clear action + entity
/// ✅ DeleteUserCommand - Clear action + entity
/// 
/// Bad command names:
/// ❌ UserCommand - What does it do?
/// ❌ HandleUser - Too vague
/// ❌ ProcessUserData - Unclear action
/// 
/// The name should IMMEDIATELY tell you what the command does!
/// </summary>