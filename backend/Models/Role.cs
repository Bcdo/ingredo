using System.ComponentModel.DataAnnotations;

namespace RestApiProject.Models;

/// <summary>
/// Role entity for user role management
/// 
/// LEARNING NOTES:
/// - Simple entity with basic properties
/// - Used in many-to-many relationship with User
/// - Follows same patterns as other entities (audit fields, soft delete)
/// </summary>
public class Role
{
    public int Id { get; set; }

    [Required]
    [StringLength(50)]
    public string Name { get; set; } = string.Empty;

    [StringLength(200)]
    public string? Description { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;

    // Navigation properties
    public List<UserRole> UserRoles { get; set; } = new();
}

/// <summary>
/// Junction entity for User-Role many-to-many relationship
/// 
/// LEARNING NOTES:
/// - This is how you create many-to-many relationships in EF Core
/// - Contains foreign keys to both User and Role
/// - Can contain additional properties (like AssignedAt)
/// - Allows for more complex relationship data
/// </summary>
public class UserRole
{
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public int RoleId { get; set; }
    public Role Role { get; set; } = null!;

    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public int? AssignedByUserId { get; set; } // Who assigned this role
}