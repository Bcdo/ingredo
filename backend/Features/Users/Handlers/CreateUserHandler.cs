using AutoMapper;
using MediatR;
using Microsoft.EntityFrameworkCore;
using RestApiProject.Common;
using RestApiProject.Data;
using RestApiProject.DTOs;
using RestApiProject.Features.Users.Commands;
using RestApiProject.Models;

namespace RestApiProject.Features.Users.Handlers;

/// <summary>
/// Handler for CreateUserCommand - This is where the REAL magic happens!
/// 
/// LEARNING NOTES:
/// - Handlers contain the business logic
/// - They are completely isolated and testable
/// - They use dependency injection for all dependencies
/// - They follow the Single Responsibility Principle
/// - They return Results instead of throwing exceptions
/// - They are automatically discovered by MediatR
/// </summary>
public class CreateUserHandler : IRequestHandler<CreateUserCommand, Result<UserResponseDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<CreateUserHandler> _logger;

    public CreateUserHandler(
        ApplicationDbContext context,
        IMapper mapper,
        ILogger<CreateUserHandler> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }

    public async Task<Result<UserResponseDto>> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Creating user with email: {Email}", request.UserData.Email);

            // 1. Check if email already exists (double-check after validation)
            var emailExists = await _context.Users
                .Where(u => u.IsActive)
                .AnyAsync(u => u.Email.ToLower() == request.UserData.Email.ToLower(), cancellationToken);

            if (emailExists)
            {
                _logger.LogWarning("Attempted to create user with existing email: {Email}", request.UserData.Email);
                return Result<UserResponseDto>.Failure("Email already exists");
            }

            // 2. Hash the password (NEVER store plain text passwords!)
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.UserData.Password);

            // 3. Create the user entity
            var user = new User
            {
                UserName = request.UserData.Email.Split('@')[0], // Use email prefix as username
                FirstName = request.UserData.FirstName,
                LastName = request.UserData.LastName,
                Email = request.UserData.Email.ToLower(), // Always store emails in lowercase
                PasswordHash = passwordHash,
                PhoneNumber = request.UserData.PhoneNumber,
                DateOfBirth = request.UserData.DateOfBirth,
                Bio = request.UserData.Bio,
                CreatedAt = DateTime.UtcNow,
                IsActive = true,
                IsEmailVerified = false, // Email verification required
                EmailVerificationToken = GenerateEmailVerificationToken()
            };

            // 4. Add to database
            _context.Users.Add(user);
            await _context.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("User created successfully with ID: {UserId}", user.Id);

            // 5. TODO: Send email verification email (we'll implement this later)
            // await _emailService.SendEmailVerificationAsync(user);

            // 6. Map to response DTO (never return the entity directly!)
            var response = _mapper.Map<UserResponseDto>(user);

            return Result<UserResponseDto>.Success(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating user with email: {Email}", request.UserData.Email);
            return Result<UserResponseDto>.Failure("An error occurred while creating the user");
        }
    }

    /// <summary>
    /// Generate a secure email verification token
    /// In production, you might use a more sophisticated approach
    /// </summary>
    private string GenerateEmailVerificationToken()
    {
        return Guid.NewGuid().ToString("N")[..16]; // First 16 characters of a GUID
    }
}

/// <summary>
/// LEARNING NOTES: Handler Benefits
/// 
/// ❌ OLD WAY (Controller with all logic):
/// - 50+ lines of mixed concerns in controller
/// - Hard to test (need to mock HTTP context)
/// - Hard to reuse (tied to web layer)
/// - Hard to maintain (everything in one place)
/// 
/// ✅ MODERN WAY (Dedicated handler):
/// - Single responsibility (only creates users)
/// - Easy to test (just test the handler)
/// - Easy to reuse (can be called from anywhere)
/// - Easy to maintain (clear separation of concerns)
/// - Easy to extend (add validation, logging, etc.)
/// 
/// HANDLER PRINCIPLES:
/// 1. ONE handler per command/query
/// 2. Handler contains ONLY the business logic for that operation
/// 3. Handler uses dependency injection for all dependencies
/// 4. Handler returns Results instead of throwing exceptions
/// 5. Handler logs important events
/// 6. Handler validates business rules (not just input validation)
/// </summary>