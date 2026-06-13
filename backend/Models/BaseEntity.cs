using System.ComponentModel.DataAnnotations;

namespace RestApiProject.Models;

/// <summary>
/// Optional base entity with comprehensive audit fields for enterprise applications
/// 
/// 🎯 USE WHEN:
/// - Audit trails are required (GDPR, SOX compliance)
/// - Need to track who created/modified records
/// - Soft delete functionality is needed
/// - Multi-user business applications
/// - Regulatory compliance requirements
/// 
/// 🚫 DON'T USE FOR:
/// - Simple lookup tables (categories, statuses)
/// - Performance-critical entities (fewer fields = faster queries)
/// - Temporary or cache data
/// - Analytics/reporting tables
/// 
/// 💡 EXAMPLE USAGE:
/// public class Product : BaseEntity { /* your properties */ }
/// 
/// This provides automatic:
/// - CreatedAt, UpdatedAt timestamps
/// - Soft delete (IsDeleted, DeletedAt)
/// - Active/Inactive states
/// - User tracking (CreatedByUserId, UpdatedByUserId)
/// - Optimistic concurrency (RowVersion)
/// </summary>
public abstract class BaseEntity
{
    [Key]
    public int Id { get; set; }
    
    // Standard audit fields
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Soft delete support
    public bool IsDeleted { get; set; } = false;
    public DateTime? DeletedAt { get; set; }
    
    // Active/Inactive state
    public bool IsActive { get; set; } = true;
    
    // Optional: Track who created/modified (if you have user context)
    public int? CreatedByUserId { get; set; }
    public int? UpdatedByUserId { get; set; }
    
    // Optional: Optimistic concurrency
    [Timestamp]
    public byte[]? RowVersion { get; set; }
    
    // Business methods
    public virtual void MarkAsDeleted(int? deletedByUserId = null)
    {
        IsDeleted = true;
        DeletedAt = DateTime.UtcNow;
        UpdatedByUserId = deletedByUserId;
        UpdatedAt = DateTime.UtcNow;
    }
    
    public virtual void Restore(int? restoredByUserId = null)
    {
        IsDeleted = false;
        DeletedAt = null;
        UpdatedByUserId = restoredByUserId;
        UpdatedAt = DateTime.UtcNow;
    }
    
    public virtual void Deactivate(int? deactivatedByUserId = null)
    {
        IsActive = false;
        UpdatedByUserId = deactivatedByUserId;
        UpdatedAt = DateTime.UtcNow;
    }
    
    public virtual void Activate(int? activatedByUserId = null)
    {
        IsActive = true;
        UpdatedByUserId = activatedByUserId;
        UpdatedAt = DateTime.UtcNow;
    }
}