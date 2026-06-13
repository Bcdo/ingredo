using FluentValidation;
using RestApiProject.DTOs;
using RestApiProject.Data;
using Microsoft.EntityFrameworkCore;

namespace RestApiProject.Validators;

/// <summary>
/// Advanced FluentValidation demonstrating modern validation patterns
/// 
/// LEARNING NOTES:
/// - FluentValidation is MUCH more powerful than Data Annotations
/// - Can inject dependencies (like DbContext) for database validation
/// - Supports complex business rules
/// - Better error messages and localization
/// - Async validation support
/// - Conditional validation rules
/// </summary>

public class CreateUserDtoValidator : AbstractValidator<CreateUserDto>
{
    private readonly ApplicationDbContext _context;

    public CreateUserDtoValidator(ApplicationDbContext context)
    {
        _context = context;

        // Basic field validation
        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("First name is required")
            .MaximumLength(100).WithMessage("First name cannot exceed 100 characters")
            .Matches("^[a-zA-Z ]+$").WithMessage("First name can only contain letters and spaces");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Last name is required")
            .MaximumLength(100).WithMessage("Last name cannot exceed 100 characters")
            .Matches("^[a-zA-Z ]+$").WithMessage("Last name can only contain letters and spaces");

        // Advanced email validation with database check
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required")
            .EmailAddress().WithMessage("Invalid email format")
            .MaximumLength(255).WithMessage("Email cannot exceed 255 characters")
            .MustAsync(BeUniqueEmail).WithMessage("Email already exists");

        // Complex password validation
        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Password is required")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters")
            .Matches(@"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]")
            .WithMessage("Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character");

        // Phone number validation (optional but if provided, must be valid)
        When(x => !string.IsNullOrEmpty(x.PhoneNumber), () =>
        {
            RuleFor(x => x.PhoneNumber)
                .Matches(@"^\+?[1-9]\d{1,14}$").WithMessage("Invalid phone number format");
        });

        // Age validation (business rule)
        RuleFor(x => x.DateOfBirth)
            .NotEmpty().WithMessage("Date of birth is required")
            .Must(BeValidAge).WithMessage("User must be between 13 and 120 years old");

        // Bio validation (optional)
        When(x => !string.IsNullOrEmpty(x.Bio), () =>
        {
            RuleFor(x => x.Bio)
                .MaximumLength(500).WithMessage("Bio cannot exceed 500 characters");
        });
    }

    /// <summary>
    /// LEARNING NOTES: Async Database Validation
    /// 
    /// This is ADVANCED! We're checking the database to ensure email uniqueness.
    /// This is impossible with simple Data Annotations.
    /// </summary>
    private async Task<bool> BeUniqueEmail(string email, CancellationToken cancellationToken)
    {
        return !await _context.Users
            .Where(u => u.IsActive)
            .AnyAsync(u => u.Email.ToLower() == email.ToLower(), cancellationToken);
    }

    /// <summary>
    /// LEARNING NOTES: Custom Business Rule Validation
    /// 
    /// This demonstrates how to implement complex business rules
    /// that go beyond simple field validation.
    /// </summary>
    private bool BeValidAge(DateTime dateOfBirth)
    {
        var age = DateTime.Now.Year - dateOfBirth.Year;
        if (dateOfBirth.Date > DateTime.Now.AddYears(-age)) age--;
        
        return age >= 13 && age <= 120;
    }
}

public class UpdateUserDtoValidator : AbstractValidator<UpdateUserDto>
{
    public UpdateUserDtoValidator()
    {
        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("First name is required")
            .MaximumLength(100).WithMessage("First name cannot exceed 100 characters")
            .Matches("^[a-zA-Z ]+$").WithMessage("First name can only contain letters and spaces");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Last name is required")
            .MaximumLength(100).WithMessage("Last name cannot exceed 100 characters")
            .Matches("^[a-zA-Z ]+$").WithMessage("Last name can only contain letters and spaces");

        When(x => !string.IsNullOrEmpty(x.PhoneNumber), () =>
        {
            RuleFor(x => x.PhoneNumber)
                .Matches(@"^\+?[1-9]\d{1,14}$").WithMessage("Invalid phone number format");
        });

        RuleFor(x => x.DateOfBirth)
            .NotEmpty().WithMessage("Date of birth is required")
            .Must(BeValidAge).WithMessage("User must be between 13 and 120 years old");

        When(x => !string.IsNullOrEmpty(x.Bio), () =>
        {
            RuleFor(x => x.Bio)
                .MaximumLength(500).WithMessage("Bio cannot exceed 500 characters");
        });
    }

    private bool BeValidAge(DateTime dateOfBirth)
    {
        var age = DateTime.Now.Year - dateOfBirth.Year;
        if (dateOfBirth.Date > DateTime.Now.AddYears(-age)) age--;
        
        return age >= 13 && age <= 120;
    }
}

public class ChangePasswordDtoValidator : AbstractValidator<ChangePasswordDto>
{
    public ChangePasswordDtoValidator()
    {
        RuleFor(x => x.CurrentPassword)
            .NotEmpty().WithMessage("Current password is required");

        RuleFor(x => x.NewPassword)
            .NotEmpty().WithMessage("New password is required")
            .MinimumLength(8).WithMessage("New password must be at least 8 characters")
            .Matches(@"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]")
            .WithMessage("New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character")
            .NotEqual(x => x.CurrentPassword).WithMessage("New password must be different from current password");
    }
}

/// <summary>
/// LEARNING NOTES: FluentValidation vs Data Annotations
/// 
/// ❌ OLD WAY (Data Annotations):
/// [Required(ErrorMessage = "Email is required")]
/// [EmailAddress(ErrorMessage = "Invalid email")]
/// public string Email { get; set; }
/// 
/// Problems:
/// - Can't check database for uniqueness
/// - Limited conditional logic
/// - Hard to test
/// - Poor separation of concerns
/// 
/// ✅ NEW WAY (FluentValidation):
/// RuleFor(x => x.Email)
///     .NotEmpty().WithMessage("Email is required")
///     .EmailAddress().WithMessage("Invalid email")
///     .MustAsync(BeUniqueEmail).WithMessage("Email already exists");
/// 
/// Benefits:
/// - Database validation with dependency injection
/// - Complex conditional logic
/// - Easy to unit test
/// - Better error messages
/// - Async support
/// - Separation of concerns
/// </summary>