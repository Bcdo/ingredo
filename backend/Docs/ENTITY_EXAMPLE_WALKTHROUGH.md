# 🏗️ Complete Example: Building Complex Entity Features

This walkthrough demonstrates how to extend the template by building an **Orders feature** step-by-step following modern patterns. This example shows advanced relationships, business logic, and complex validation.

## 📋 Step-by-Step Implementation

### **Step 1: Entity First** (`Models/Order.cs`)

```csharp
using System.ComponentModel.DataAnnotations;

namespace RestApiProject.Models;

/// <summary>
/// Order entity demonstrating complex business domain
/// </summary>
public class Order
{
    public int Id { get; set; }
    
    [Required]
    [StringLength(20)]
    public string OrderNumber { get; set; } = string.Empty;
    
    [Required]
    public decimal TotalAmount { get; set; }
    
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
    
    // Foreign Keys
    public int UserId { get; set; }
    
    // Navigation Properties
    public User User { get; set; } = null!;
    public List<OrderItem> Items { get; set; } = new();
    
    // Audit Fields
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    
    // Business Logic Methods
    public void CalculateTotal()
    {
        TotalAmount = Items.Sum(item => item.Price * item.Quantity);
    }
    
    public void MarkAsCompleted()
    {
        Status = OrderStatus.Completed;
        UpdatedAt = DateTime.UtcNow;
    }
}

public class OrderItem  
{
    public int Id { get; set; }
    
    [Required]
    [StringLength(200)]
    public string ProductName { get; set; } = string.Empty;
    
    [Required]
    public decimal Price { get; set; }
    
    [Required] 
    public int Quantity { get; set; }
    
    // Foreign Keys
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    
    // Navigation Properties
    public Order Order { get; set; } = null!;
    public Product Product { get; set; } = null!;
}

public enum OrderStatus
{
    Pending = 1,
    Processing = 2,
    Shipped = 3,
    Completed = 4,
    Cancelled = 5
}
```

### **Step 2: DTOs** (`DTOs/OrderDtos.cs`)

```csharp
namespace RestApiProject.DTOs;

// INPUT DTOs (from client)
public record CreateOrderDto(
    int UserId,
    List<CreateOrderItemDto> Items,
    string? Notes = null
);

public record CreateOrderItemDto(
    int ProductId,
    int Quantity
);

public record UpdateOrderStatusDto(
    OrderStatus Status
);

// OUTPUT DTOs (to client)
public record OrderResponseDto(
    int Id,
    string OrderNumber,
    decimal TotalAmount,
    OrderStatus Status,
    string StatusText,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    UserSummaryDto User,
    List<OrderItemResponseDto> Items
);

public record OrderSummaryDto(
    int Id,
    string OrderNumber, 
    decimal TotalAmount,
    OrderStatus Status,
    string StatusText,
    DateTime CreatedAt,
    string UserName
);

public record OrderItemResponseDto(
    int Id,
    string ProductName,
    decimal Price,
    int Quantity,
    decimal Subtotal
);

// QUERY DTOs
public record GetOrdersQuery(
    int? UserId = null,
    OrderStatus? Status = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    decimal? MinAmount = null,
    decimal? MaxAmount = null,
    int Page = 1,
    int PageSize = 10,
    string SortBy = "CreatedAt",
    string SortDirection = "desc"
) : IRequest<Result<PagedResult<OrderSummaryDto>>>;
```

### **Step 3: Validators** (`Validators/OrderValidators.cs`)

```csharp
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using RestApiProject.Data;
using RestApiProject.DTOs;

namespace RestApiProject.Validators;

public class CreateOrderDtoValidator : AbstractValidator<CreateOrderDto>
{
    private readonly ApplicationDbContext _context;
    
    public CreateOrderDtoValidator(ApplicationDbContext context)
    {
        _context = context;
        
        RuleFor(x => x.UserId)
            .NotEmpty().WithMessage("User ID is required")
            .MustAsync(UserExists).WithMessage("User does not exist");
            
        RuleFor(x => x.Items)
            .NotEmpty().WithMessage("Order must have at least one item")
            .Must(x => x.Count <= 50).WithMessage("Order cannot have more than 50 items");
            
        RuleForEach(x => x.Items)
            .SetValidator(new CreateOrderItemDtoValidator(_context));
    }
    
    private async Task<bool> UserExists(int userId, CancellationToken token)
    {
        return await _context.Users.AnyAsync(u => u.Id == userId && u.IsActive, token);
    }
}

public class CreateOrderItemDtoValidator : AbstractValidator<CreateOrderItemDto>
{
    private readonly ApplicationDbContext _context;
    
    public CreateOrderItemDtoValidator(ApplicationDbContext context)
    {
        _context = context;
        
        RuleFor(x => x.ProductId)
            .NotEmpty().WithMessage("Product ID is required")
            .MustAsync(ProductExists).WithMessage("Product does not exist");
            
        RuleFor(x => x.Quantity)
            .GreaterThan(0).WithMessage("Quantity must be greater than 0")
            .LessThanOrEqualTo(999).WithMessage("Quantity cannot exceed 999");
    }
    
    private async Task<bool> ProductExists(int productId, CancellationToken token)
    {
        return await _context.Products.AnyAsync(p => p.Id == productId, token);
    }
}
```

### **Step 4: Commands** (`Features/Orders/Commands/OrderCommands.cs`)

```csharp
using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Orders.Commands;

public record CreateOrderCommand(CreateOrderDto OrderDto) : IRequest<Result<OrderResponseDto>>;

public record UpdateOrderStatusCommand(int OrderId, UpdateOrderStatusDto StatusDto) : IRequest<Result<OrderResponseDto>>;

public record CancelOrderCommand(int OrderId) : IRequest<Result>;
```

### **Step 5: Queries** (`Features/Orders/Queries/OrderQueries.cs`)

```csharp
using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Orders.Queries;

public record GetOrderByIdQuery(int Id) : IRequest<Result<OrderResponseDto>>;

public record GetOrdersQuery(
    int? UserId = null,
    OrderStatus? Status = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    decimal? MinAmount = null,
    decimal? MaxAmount = null,
    int Page = 1,
    int PageSize = 10,
    string SortBy = "CreatedAt",
    string SortDirection = "desc"
) : IRequest<Result<PagedResult<OrderSummaryDto>>>;
```

### **Step 6: Handlers** (`Features/Orders/Handlers/CreateOrderHandler.cs`)

```csharp
using AutoMapper;
using MediatR;
using Microsoft.EntityFrameworkCore;
using RestApiProject.Common;
using RestApiProject.Data;
using RestApiProject.DTOs;
using RestApiProject.Features.Orders.Commands;
using RestApiProject.Models;

namespace RestApiProject.Features.Orders.Handlers;

public class CreateOrderHandler : IRequestHandler<CreateOrderCommand, Result<OrderResponseDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<CreateOrderHandler> _logger;
    
    public CreateOrderHandler(
        ApplicationDbContext context,
        IMapper mapper, 
        ILogger<CreateOrderHandler> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }
    
    public async Task<Result<OrderResponseDto>> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Creating order for user {UserId}", request.OrderDto.UserId);
            
            // 1. Load products for validation and pricing
            var productIds = request.OrderDto.Items.Select(i => i.ProductId).ToList();
            var products = await _context.Products
                .Where(p => productIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, cancellationToken);
                
            // 2. Validate all products exist
            foreach (var item in request.OrderDto.Items)
            {
                if (!products.ContainsKey(item.ProductId))
                {
                    return Result<OrderResponseDto>.Failure($"Product {item.ProductId} not found");
                }
            }
            
            // 3. Create order entity
            var order = new Order
            {
                UserId = request.OrderDto.UserId,
                OrderNumber = await GenerateOrderNumber(),
                Status = OrderStatus.Pending,
                CreatedAt = DateTime.UtcNow
            };
            
            // 4. Add order items with current pricing
            foreach (var itemDto in request.OrderDto.Items)
            {
                var product = products[itemDto.ProductId];
                
                var orderItem = new OrderItem
                {
                    ProductId = itemDto.ProductId,
                    ProductName = product.Name, // Snapshot current name
                    Price = product.Price,      // Snapshot current price
                    Quantity = itemDto.Quantity,
                    Order = order
                };
                
                order.Items.Add(orderItem);
            }
            
            // 5. Calculate total
            order.CalculateTotal();
            
            // 6. Save to database
            _context.Orders.Add(order);
            await _context.SaveChangesAsync(cancellationToken);
            
            // 7. Load full order with relationships for response
            var createdOrder = await _context.Orders
                .Include(o => o.User)
                .Include(o => o.Items)
                .FirstAsync(o => o.Id == order.Id, cancellationToken);
                
            var response = _mapper.Map<OrderResponseDto>(createdOrder);
            
            _logger.LogInformation("Successfully created order {OrderId} with number {OrderNumber}", 
                order.Id, order.OrderNumber);
                
            return Result<OrderResponseDto>.Success(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating order for user {UserId}", request.OrderDto.UserId);
            return Result<OrderResponseDto>.Failure("An error occurred while creating the order");
        }
    }
    
    private async Task<string> GenerateOrderNumber()
    {
        var date = DateTime.UtcNow;
        var datePrefix = date.ToString("yyyyMMdd");
        
        var todayCount = await _context.Orders
            .CountAsync(o => o.CreatedAt.Date == date.Date);
            
        return $"ORD-{datePrefix}-{(todayCount + 1):D4}";
    }
}
```

### **Step 7: Controller** (`Controllers/OrdersController.cs`)

```csharp
using Asp.Versioning;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using RestApiProject.DTOs;
using RestApiProject.Features.Orders.Commands;
using RestApiProject.Features.Orders.Queries;

namespace RestApiProject.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
[Produces("application/json")]
public class OrdersController : ControllerBase
{
    private readonly IMediator _mediator;
    
    public OrdersController(IMediator mediator)
    {
        _mediator = mediator;
    }
    
    /// <summary>
    /// Get all orders with filtering and pagination
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<OrderSummaryDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<OrderSummaryDto>>> GetOrders([FromQuery] GetOrdersQuery query)
    {
        var result = await _mediator.Send(query);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }
    
    /// <summary>
    /// Get order by ID
    /// </summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(OrderResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponseDto>> GetOrder(int id)
    {
        var result = await _mediator.Send(new GetOrderByIdQuery(id));
        return result.IsSuccess ? Ok(result.Value) : NotFound(result.Error);
    }
    
    /// <summary>
    /// Create a new order
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(OrderResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<OrderResponseDto>> CreateOrder([FromBody] CreateOrderDto createOrderDto)
    {
        var result = await _mediator.Send(new CreateOrderCommand(createOrderDto));
        
        if (result.IsSuccess)
        {
            return CreatedAtAction(
                nameof(GetOrder),
                new { id = result.Value!.Id, version = "1.0" },
                result.Value);
        }
        
        return BadRequest(result.Error);
    }
    
    /// <summary>
    /// Update order status
    /// </summary>
    [HttpPatch("{id:int}/status")]
    [ProducesResponseType(typeof(OrderResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponseDto>> UpdateOrderStatus(int id, [FromBody] UpdateOrderStatusDto statusDto)
    {
        var result = await _mediator.Send(new UpdateOrderStatusCommand(id, statusDto));
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }
    
    /// <summary>
    /// Cancel an order
    /// </summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CancelOrder(int id)
    {
        var result = await _mediator.Send(new CancelOrderCommand(id));
        return result.IsSuccess ? NoContent() : NotFound(result.Error);
    }
}
```

### **Step 8: AutoMapper Profile** (`Mappings/OrderMappingProfile.cs`)

```csharp
using AutoMapper;
using RestApiProject.DTOs;
using RestApiProject.Models;

namespace RestApiProject.Mappings;

public class OrderMappingProfile : Profile
{
    public OrderMappingProfile()
    {
        CreateMap<Order, OrderResponseDto>()
            .ForMember(dest => dest.StatusText, opt => opt.MapFrom(src => src.Status.ToString()))
            .ForMember(dest => dest.User, opt => opt.MapFrom(src => src.User));
            
        CreateMap<Order, OrderSummaryDto>()
            .ForMember(dest => dest.StatusText, opt => opt.MapFrom(src => src.Status.ToString()))
            .ForMember(dest => dest.UserName, opt => opt.MapFrom(src => src.User.FullName));
            
        CreateMap<OrderItem, OrderItemResponseDto>()
            .ForMember(dest => dest.Subtotal, opt => opt.MapFrom(src => src.Price * src.Quantity));
    }
}
```

### **Step 9: DbContext Updates** (`Data/ApplicationDbContext.cs`)

```csharp
// Add to ApplicationDbContext.cs

public DbSet<Order> Orders { get; set; }
public DbSet<OrderItem> OrderItems { get; set; }

// Add to OnModelCreating method:
private void ConfigureOrderEntities(ModelBuilder modelBuilder)
{
    // Order Configuration
    modelBuilder.Entity<Order>(entity =>
    {
        entity.HasKey(e => e.Id);
        
        entity.Property(e => e.OrderNumber)
            .IsRequired()
            .HasMaxLength(20);
            
        entity.HasIndex(e => e.OrderNumber)
            .IsUnique();
            
        entity.Property(e => e.TotalAmount)
            .HasPrecision(18, 2);
            
        entity.Property(e => e.Status)
            .HasConversion<int>();
            
        // Relationships
        entity.HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Restrict);
            
        entity.HasMany(e => e.Items)
            .WithOne(i => i.Order)
            .HasForeignKey(i => i.OrderId)
            .OnDelete(DeleteBehavior.Cascade);
    });
    
    // OrderItem Configuration  
    modelBuilder.Entity<OrderItem>(entity =>
    {
        entity.HasKey(e => e.Id);
        
        entity.Property(e => e.ProductName)
            .IsRequired()
            .HasMaxLength(200);
            
        entity.Property(e => e.Price)
            .HasPrecision(18, 2);
            
        entity.HasOne(e => e.Product)
            .WithMany()
            .HasForeignKey(e => e.ProductId)
            .OnDelete(DeleteBehavior.Restrict);
    });
}
```

## 🎯 **Key Takeaways**

1. **Start with Entity** - Defines your business domain
2. **DTOs control API shape** - What clients see/send
3. **Validators protect business rules** - What's allowed
4. **Commands/Queries structure operations** - Clear intent
5. **Handlers contain business logic** - Testable and focused
6. **Controllers are thin** - Just HTTP plumbing
7. **AutoMapper handles conversion** - No manual mapping

This pattern creates **clean, maintainable, testable code** that scales well and follows modern .NET practices! 🚀