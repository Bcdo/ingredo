using Microsoft.EntityFrameworkCore;
using RestApiProject.Models;

namespace RestApiProject.Data;

/// <summary>
/// Modern Entity Framework DbContext with advanced configurations
/// 
/// LEARNING NOTES:
/// - Centralized database configuration
/// - Fluent API for complex relationships
/// - Seed data for development
/// - Index optimization
/// - Relationship configuration
/// </summary>
public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    // User Management
    public DbSet<User> Users { get; set; }
    public DbSet<Role> Roles { get; set; }
    public DbSet<UserRole> UserRoles { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureUserEntities(modelBuilder);
        SeedData(modelBuilder);
    }

    /// <summary>
    /// Configure User, Role, and UserRole entities
    /// 
    /// LEARNING NOTES:
    /// - Many-to-many relationship configuration
    /// - Unique constraints for business rules
    /// - Index optimization for queries
    /// - Soft delete query filters
    /// - Email validation constraints
    /// </summary>
    private void ConfigureUserEntities(ModelBuilder modelBuilder)
    {
        // User Configuration
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);
            
            // Email constraints and index
            entity.Property(u => u.Email)
                .IsRequired()
                .HasMaxLength(256);
            entity.HasIndex(u => u.Email)
                .IsUnique()
                .HasFilter("IsDeleted = 0"); // Only active users need unique emails
            
            // Username constraints and index
            entity.Property(u => u.UserName)
                .IsRequired()
                .HasMaxLength(50);
            entity.HasIndex(u => u.UserName)
                .IsUnique()
                .HasFilter("IsDeleted = 0"); // Only active users need unique usernames
            
            // Name constraints
            entity.Property(u => u.FirstName)
                .IsRequired()
                .HasMaxLength(100);
            entity.Property(u => u.LastName)
                .IsRequired()
                .HasMaxLength(100);
            
            // Password hash
            entity.Property(u => u.PasswordHash)
                .IsRequired();
            
            // Audit fields - use database-agnostic approach
            entity.Property(u => u.CreatedAt)
                .HasDefaultValueSql("datetime('now')"); // SQLite compatible
            entity.Property(u => u.UpdatedAt)
                .HasDefaultValueSql("datetime('now')"); // SQLite compatible
            
            // Soft delete filter - exclude deleted users from queries by default
            entity.HasQueryFilter(u => !u.IsDeleted);
            
            // Index for common queries
            entity.HasIndex(u => u.CreatedAt);
            entity.HasIndex(u => u.IsActive);
        });

        // Role Configuration
        modelBuilder.Entity<Role>(entity =>
        {
            entity.HasKey(r => r.Id);
            
            entity.Property(r => r.Name)
                .IsRequired()
                .HasMaxLength(50);
            
            entity.HasIndex(r => r.Name)
                .IsUnique();
            
            entity.Property(r => r.Description)
                .HasMaxLength(500);
        });

        // UserRole Configuration (Many-to-Many)
        modelBuilder.Entity<UserRole>(entity =>
        {
            // Composite primary key
            entity.HasKey(ur => new { ur.UserId, ur.RoleId });
            
            // Relationships
            entity.HasOne(ur => ur.User)
                .WithMany(u => u.UserRoles)
                .HasForeignKey(ur => ur.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            
            entity.HasOne(ur => ur.Role)
                .WithMany(r => r.UserRoles)
                .HasForeignKey(ur => ur.RoleId)
                .OnDelete(DeleteBehavior.Cascade);
            
            // Audit fields
            entity.Property(ur => ur.AssignedAt)
                .HasDefaultValueSql("datetime('now')"); // SQLite compatible
            
            // Query filter to match User entity - only show roles for non-deleted users
            entity.HasQueryFilter(ur => !ur.User.IsDeleted);
        });
    }


    /// <summary>
    /// Seed initial data for development
    /// 
    /// LEARNING NOTES:
    /// - Development data seeding
    /// - Default roles for RBAC
    /// - Admin user for testing
    /// </summary>
    private void SeedData(ModelBuilder modelBuilder)
    {
        // Seed Roles
        var adminRoleId = 1;
        var userRoleId = 2;
        var moderatorRoleId = 3;

        modelBuilder.Entity<Role>().HasData(
            new Role
            {
                Id = adminRoleId,
                Name = "Admin",
                Description = "Full system access",
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            },
            new Role
            {
                Id = userRoleId,
                Name = "User",
                Description = "Standard user access",
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            },
            new Role
            {
                Id = moderatorRoleId,
                Name = "Moderator",
                Description = "Content moderation access",
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            }
        );

        // Seed Admin User (for development)
        var adminUserId = 1;
        var adminPasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin123!");

        modelBuilder.Entity<User>().HasData(
            new User
            {
                Id = adminUserId,
                UserName = "admin",
                Email = "admin@example.com",
                FirstName = "System",
                LastName = "Administrator",
                PasswordHash = adminPasswordHash,
                IsActive = true,
                IsDeleted = false,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                DateOfBirth = new DateTime(1990, 1, 1),
                IsEmailVerified = true
            }
        );

        // Assign Admin Role to Admin User
        modelBuilder.Entity<UserRole>().HasData(
            new UserRole
            {
                UserId = adminUserId,
                RoleId = adminRoleId,
                AssignedAt = DateTime.UtcNow
            }
        );
    }
}
