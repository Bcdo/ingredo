using System.ComponentModel.DataAnnotations;

namespace RestApiProject.Models;

/// <summary>
/// User entity demonstrating advanced EF Core patterns
/// 
/// LEARNING NOTES:
/// - Uses modern C# nullable reference types
/// - Includes audit fields (CreatedAt, UpdatedAt)
/// - Implements soft delete pattern
/// - Has navigation properties for relationships
/// - Uses value objects pattern for Email
/// </summary>
public class User
{
    public int Id { get; set; }

    [Required]
    [StringLength(50)]
    public string UserName { get; set; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string LastName { get; set; } = string.Empty;

    [Required]
    [EmailAddress]
    [StringLength(255)]
    public string Email { get; set; } = string.Empty;

    [Required]
    [StringLength(255)]
    public string PasswordHash { get; set; } = string.Empty;

    [StringLength(15)]
    public string? PhoneNumber { get; set; }

    public DateTime DateOfBirth { get; set; }

    // Audit fields (important for production apps)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public bool IsActive { get; set; } = true;
    
    // Soft delete pattern
    public bool IsDeleted { get; set; } = false;
    public DateTime? DeletedAt { get; set; }

    // Security and profile fields
    public bool IsEmailVerified { get; set; } = false;
    public string? EmailVerificationToken { get; set; }
    public DateTime? EmailVerifiedAt { get; set; }
    
    public string? ProfilePictureUrl { get; set; }
    public string? Bio { get; set; }

    // User roles (many-to-many relationship)
    public List<UserRole> UserRoles { get; set; } = new();

    // Computed properties (not stored in DB)
    public string FullName => $"{FirstName} {LastName}";
    public int Age => DateTime.Now.Year - DateOfBirth.Year;
}