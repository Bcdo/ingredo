# 🏗️ Entity Design Guide

This guide helps you make informed decisions about entity design patterns in your REST API project.

---

## 🆔 ID Strategy: int vs Guid

### **Default Choice: int IDs ✅**

The template uses `int` IDs by default, which is the right choice for most applications.

**Why int IDs are better for most cases:**

- **🚀 Performance**: 4 bytes vs 16 bytes (smaller indexes, faster joins)
- **📊 Database friendly**: Auto-increment, sequential, optimized storage
- **👥 Human readable**: Easy to work with in URLs, logs, debugging
- **🔢 Predictable**: Sequential numbering, easier to reason about
- **💾 Storage efficient**: Smaller foreign keys, indexes, and memory usage

**When to use int IDs:**

- Single database applications (most cases)
- Performance is important
- Human-readable IDs are helpful
- Traditional web applications
- Internal business systems

### **Alternative: Guid IDs 🌐**

**When you might need Guid IDs:**

- **Distributed systems** with multiple databases generating IDs
- **Microservices** where services need to generate IDs independently
- **Offline-first applications** that sync data later
- **Client-side ID generation** requirements
- **Security through obscurity** (harder to guess/enumerate)
- **Data merging** from multiple external sources

**Example scenarios for Guid:**

```csharp
// If you need Guid IDs, change your entities like this:
public class DistributedEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    // ... rest of properties
}
```

**⚠️ Guid Drawbacks:**

- Larger storage footprint
- Worse database performance
- Not human-friendly
- Fragmented indexes (unless using sequential Guids)

---

## 🏛️ Entity Patterns: BaseEntity vs Simple Entities

### **Pattern 1: BaseEntity (Enterprise/Audit-Heavy) 🛡️**

Use the provided `BaseEntity` class when you need comprehensive audit trails and business controls.

```csharp
public class Product : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public string Category { get; set; } = string.Empty;

    // BaseEntity provides:
    // - int Id
    // - CreatedAt, UpdatedAt
    // - IsDeleted, DeletedAt (soft delete)
    // - IsActive (business state)
    // - CreatedByUserId, UpdatedByUserId
    // - RowVersion (concurrency)
    // - Business methods: MarkAsDeleted(), Restore(), etc.
}
```

**✅ Use BaseEntity when you need:**

- **Audit trails** for compliance (GDPR, SOX, HIPAA)
- **Soft delete** functionality (never actually delete data)
- **User tracking** (who created/modified what)
- **Regulatory compliance** requirements
- **Data recovery** scenarios
- **Multi-user business applications**
- **Complex approval workflows**

**🎯 Perfect for:**

- E-commerce (orders, products, customers)
- CRM systems (contacts, deals, notes)
- Financial applications (transactions, accounts)
- Healthcare systems (patient records)
- Document management systems
- Content management systems
- Inventory management
- User-generated content

### **Pattern 2: Simple Entities (Performance/Simplicity) ⚡**

Use simple entities for straightforward cases without audit requirements.

```csharp
public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

**✅ Use Simple Entities for:**

- **Lookup/reference tables** (categories, statuses, countries)
- **Configuration data** (settings, preferences)
- **Performance-critical entities** (high-volume reads)
- **Temporary data** (cache entries, sessions)
- **Analytics/reporting data** (metrics, logs)
- **Simple applications** without compliance needs

**🎯 Perfect for:**

- Categories, tags, statuses
- System settings
- Cache tables
- Log entries
- Analytics data
- Simple blogs/personal projects
- Lookup tables (countries, currencies)

---

## 🛠️ Implementation Examples

### **BaseEntity Usage Pattern**

```csharp
// 1. Entity inherits from BaseEntity
public class Order : BaseEntity
{
    public string OrderNumber { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public List<OrderItem> Items { get; set; } = new();
}

// 2. Handler uses BaseEntity features
public class CreateOrderHandler : IRequestHandler<CreateOrderCommand, Result<OrderResponseDto>>
{
    public async Task<Result<OrderResponseDto>> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        var order = new Order
        {
            OrderNumber = GenerateOrderNumber(),
            TotalAmount = request.TotalAmount,
            // BaseEntity automatically sets:
            // - CreatedAt = DateTime.UtcNow
            // - IsActive = true
            // - IsDeleted = false
            CreatedByUserId = GetCurrentUserId()
        };

        _context.Orders.Add(order);
        await _context.SaveChangesAsync(cancellationToken);

        return Result<OrderResponseDto>.Success(_mapper.Map<OrderResponseDto>(order));
    }
}

// 3. Soft delete usage
public class DeleteOrderHandler : IRequestHandler<DeleteOrderCommand, Result>
{
    public async Task<Result> Handle(DeleteOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await _context.Orders
            .Where(o => !o.IsDeleted) // BaseEntity query filter
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order == null) return Result.Failure("Order not found");

        // Soft delete using BaseEntity method
        order.MarkAsDeleted(GetCurrentUserId());
        await _context.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
```

### **Simple Entity Usage Pattern**

```csharp
// 1. Simple entity without BaseEntity
public class ProductCategory
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// 2. Handler for simple entity
public class CreateCategoryHandler : IRequestHandler<CreateCategoryCommand, Result<CategoryResponseDto>>
{
    public async Task<Result<CategoryResponseDto>> Handle(CreateCategoryCommand request, CancellationToken cancellationToken)
    {
        var category = new ProductCategory
        {
            Name = request.Name,
            Description = request.Description
            // CreatedAt and IsActive have default values
        };

        _context.ProductCategories.Add(category);
        await _context.SaveChangesAsync(cancellationToken);

        return Result<CategoryResponseDto>.Success(_mapper.Map<CategoryResponseDto>(category));
    }
}
```

---

## 📋 Decision Matrix

| **Scenario**               | **Entity Type** | **ID Type** | **Reasoning**                                  |
| -------------------------- | --------------- | ----------- | ---------------------------------------------- |
| **E-commerce Orders**      | BaseEntity      | int         | Needs audit trails, soft delete, user tracking |
| **Product Categories**     | Simple          | int         | Lookup table, performance important            |
| **User Accounts**          | BaseEntity      | int         | Audit trails for security, compliance          |
| **System Settings**        | Simple          | int         | Configuration data, no audit needed            |
| **Financial Transactions** | BaseEntity      | int         | Regulatory compliance, audit trails            |
| **Cache Entries**          | Simple          | int         | Temporary data, performance critical           |
| **Microservice Events**    | Simple          | Guid        | Distributed system, offline generation         |
| **Document Management**    | BaseEntity      | int         | Audit trails, version control                  |
| **Analytics Data**         | Simple          | int         | High volume, performance important             |
| **Customer Records**       | BaseEntity      | int         | GDPR compliance, audit trails                  |

---

## 🛠️ Database Configuration

### **BaseEntity DbContext Setup**

When using BaseEntity, add this configuration to your `ApplicationDbContext.cs`:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    base.OnModelCreating(modelBuilder);
    
    // Configure User entities (existing)
    ConfigureUserEntities(modelBuilder);
    
    // Configure entities that inherit from BaseEntity
    ConfigureBaseEntityTypes(modelBuilder);
    
    SeedData(modelBuilder);
}

private void ConfigureBaseEntityTypes(ModelBuilder modelBuilder)
{
    // Example: Product entity using BaseEntity
    modelBuilder.Entity<Product>(entity =>
    {
        // BaseEntity fields get default behavior, but you can customize:
        
        // Soft delete query filter (automatically exclude deleted items)
        entity.HasQueryFilter(e => !e.IsDeleted);
        
        // Indexes for common BaseEntity queries
        entity.HasIndex(e => e.CreatedAt);
        entity.HasIndex(e => e.IsDeleted);
        entity.HasIndex(e => e.IsActive);
        
        // Product-specific configuration
        entity.Property(p => p.Name).IsRequired().HasMaxLength(200);
        entity.Property(p => p.Price).HasPrecision(18, 2);
        
        // Optional: Configure user relationships for audit trail
        entity.HasOne<User>()
            .WithMany()
            .HasForeignKey(e => e.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
            
        entity.HasOne<User>()
            .WithMany() 
            .HasForeignKey(e => e.UpdatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    });
}
```

### **Key Configuration Points**

1. **Query Filters**: `HasQueryFilter(e => !e.IsDeleted)` automatically excludes soft-deleted items
2. **Indexes**: Add indexes on BaseEntity fields for better query performance
3. **User Relationships**: Optional foreign keys to track who created/modified records
4. **Default Values**: BaseEntity constructor sets sensible defaults, no EF configuration needed

### **Important Notes**

- **Query filters apply globally** - use `IgnoreQueryFilters()` when you need deleted items
- **Indexes improve performance** but use storage - add based on your query patterns
- **User relationships are optional** - only add if you track user context

---

## 🚀 Migration Strategies

### **Adding BaseEntity to Existing Simple Entity**

If you start with a simple entity and later need audit features:

```csharp
// Before: Simple entity
public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// After: Migrate to BaseEntity
public class Product : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    // Remove old fields that BaseEntity provides:
    // - Remove: public int Id { get; set; }
    // - Remove: public DateTime CreatedAt { get; set; }
    // BaseEntity provides these and more
}
```

**Migration steps:**

1. Add new BaseEntity fields via Entity Framework migration
2. Update entity class to inherit from BaseEntity
3. Remove duplicate properties
4. Test thoroughly

### **Changing ID Type (Advanced)**

Only do this if absolutely necessary:

```csharp
// This requires significant refactoring:
// 1. All foreign key relationships
// 2. All DTOs and commands
// 3. Database schema changes
// 4. URL routing updates

// Generally not recommended after development starts
```

---

## 💡 Best Practices

### **Entity Design Principles**

1. **Start simple, evolve to BaseEntity** if audit needs emerge
2. **Use BaseEntity by default** for user-facing business entities
3. **Keep simple entities** for lookup/reference data
4. **Stick with int IDs** unless you specifically need distributed generation
5. **Document your choices** in code comments

### **Security & Compliance**

```csharp
// BaseEntity provides audit trails for:
// - GDPR Article 30 (Records of processing activities)
// - SOX Section 404 (Internal controls)
// - HIPAA audit requirements
// - ISO 27001 access logging
// - PCI DSS change tracking

public class SensitiveData : BaseEntity
{
    // Automatic audit trail:
    // - Who accessed (CreatedByUserId/UpdatedByUserId)
    // - When accessed (CreatedAt/UpdatedAt)
    // - Soft delete for data retention (IsDeleted/DeletedAt)
}
```

### **Performance Considerations**

```csharp
// BaseEntity adds overhead:
// - Additional columns in every query
// - Larger indexes
// - More memory usage

// Measure performance impact:
// - Profile your queries
// - Monitor index sizes
// - Consider simple entities for high-volume scenarios
```

---

## 🎉 Conclusion

**Your template provides both patterns**, letting developers choose based on their specific needs:

- **🛡️ BaseEntity**: Enterprise applications with audit, compliance, and security requirements
- **⚡ Simple Entities**: Performance-focused, lookup tables, and simple applications
- **🆔 int IDs**: Default choice for most applications, proven performance
- **🌐 Guid IDs**: Available when distributed systems require them

**Start with the pattern that matches your immediate needs**, and evolve as requirements grow. The template architecture supports both approaches seamlessly! 🚀

