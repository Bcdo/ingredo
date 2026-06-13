# 📋 Template Usage Guide

Complete step-by-step guide for using this Modern C# REST API Template with `dotnet new` to create production-ready projects.

---

## 🎯 Before You Start

### Prerequisites

- .NET 9 SDK installed
- Docker (optional, for containerization)
- Git for version control
- Code editor (VS Code, Visual Studio, or Neovim recommended)

### What You'll Learn

- How to install and use the .NET template
- How to customize the generated project for your needs
- Best practices for extending the established architecture
- How to maintain code quality and patterns

---

## 🚀 Installing the Template

### Local Installation (Primary Method)

```bash
# 1. Clone the template repository
git clone <template-repo-url> rest-api-template
cd rest-api-template

# 2. Install as a dotnet template
dotnet new install .

# 3. Verify installation
dotnet new list | grep modern
# Expected output: Modern .NET 9 Web API Template  modern-webapi  [C#]  Web/WebAPI/Modern
```

**👍 Why Local Installation?**

- ✅ **Full Control**: You control the template version and updates
- ✅ **Private/Internal**: Perfect for company or personal templates
- ✅ **Easy Updates**: Simple `git pull` + `dotnet new install . --force`
- ✅ **No Dependencies**: No need for package registries

## 🏗️ Creating a New Project

### Basic Usage

```bash
# Create a new project (can be run from any directory)
dotnet new modern-webapi -n YourProjectName

# Navigate to the project
cd YourProjectName

# Restore dependencies and build
dotnet restore
dotnet build

# Run the project
dotnet run
```

### Template Parameters (Advanced)

```bash
# Create project with custom parameters
dotnet new modern-webapi \
  -n "MyCompany.ProductApi" \
  -o "./projects/ProductApi" \
  --force  # Overwrite if directory exists

# View all available parameters
dotnet new modern-webapi --help
```

### Verify Your Installation

```bash
# Build the generated project
dotnet build

# Run the project
dotnet run

# Test the API (in another terminal)
curl https://localhost:7046/health
curl https://localhost:7046/api/v1.0/Users

# View API documentation
# Open browser to: https://localhost:7046/scalar/v1
```

## ⚙️ Post-Generation Customization

### 1. Update Project Metadata

Edit your generated project file (`YourProjectName.csproj`):

```xml
<PropertyGroup>
    <!-- Update these fields for your project -->
    <PackageId>YourCompany.YourProject</PackageId>
    <Title>Your API Project Title</Title>
    <Description>Your project description</Description>
    <Authors>Your Name</Authors>
    <Company>Your Company</Company>
    <Product>YourProject</Product>
    <Version>1.0.0</Version>
</PropertyGroup>
```

### 2. Configure Database Connection

**For SQLite (Development - Default):**
No changes needed, SQLite database will be created automatically.

**For SQL Server (Production):**

Edit `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "SqliteConnection": "Data Source=YourProject.db",
    "DefaultConnection": "Server=localhost;Database=YourProjectDb;User Id=sa;Password=YourPassword123!;TrustServerCertificate=true;"
  }
}
```

Update `Program.cs` to use SQL Server:

```csharp
// Comment out SQLite and uncomment SQL Server
// builder.Services.AddDbContext<ApplicationDbContext>(options =>
//     options.UseSqlite(connectionString));

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));
```

#### C. Update Docker Configuration

**docker-compose.yml**:

```yaml
services:
  yourproject-api: # Rename service
    container_name: yourproject-api
    # ... rest of configuration
```

---

## 🏗️ Adding Your First Entity

Let's walk through adding a "Product" entity as an example.

### Step 1: Create the Entity Model

Create `Models/Product.cs`:

```csharp
// Use the 'createentity' snippet to generate this quickly
using System.ComponentModel.DataAnnotations;

namespace RestApiProject.Models;

/// <summary>
/// Product entity demonstrating modern EF Core patterns
/// </summary>
public class Product
{
    public int Id { get; set; }

    [Required]
    [StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [StringLength(1000)]
    public string? Description { get; set; }

    [Required]
    public decimal Price { get; set; }

    [Required]
    [StringLength(100)]
    public string Category { get; set; } = string.Empty;

    // Audit fields (consistent with template)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public bool IsActive { get; set; } = true;

    // Soft delete (consistent with template)
    public bool IsDeleted { get; set; } = false;
    public DateTime? DeletedAt { get; set; }

    // Navigation properties
    public int CreatedByUserId { get; set; }
    public User CreatedBy { get; set; } = null!;
}
```

### Step 2: Create DTOs

Create `DTOs/ProductDtos.cs`:

```csharp
// Use the 'createdtos' snippet to generate this quickly
namespace RestApiProject.DTOs;

// INPUT DTOs
public record CreateProductDto(
    string Name,
    string? Description,
    decimal Price,
    string Category
);

public record UpdateProductDto(
    string? Name = null,
    string? Description = null,
    decimal? Price = null,
    string? Category = null
);

// OUTPUT DTOs
public record ProductResponseDto(
    int Id,
    string Name,
    string? Description,
    decimal Price,
    string Category,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    bool IsActive,
    UserSummaryDto CreatedBy
);

public record ProductSummaryDto(
    int Id,
    string Name,
    decimal Price,
    string Category,
    DateTime CreatedAt,
    bool IsActive
);
```

### Step 3: Create Validators

Create `Validators/ProductValidators.cs`:

```csharp
// Use the 'createvalidator' snippet to generate this quickly
using FluentValidation;
using RestApiProject.DTOs;

namespace RestApiProject.Validators;

public class CreateProductDtoValidator : AbstractValidator<CreateProductDto>
{
    public CreateProductDtoValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Product name is required")
            .MaximumLength(200).WithMessage("Name cannot exceed 200 characters");

        RuleFor(x => x.Price)
            .GreaterThan(0).WithMessage("Price must be greater than 0");

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("Category is required")
            .MaximumLength(100).WithMessage("Category cannot exceed 100 characters");

        RuleFor(x => x.Description)
            .MaximumLength(1000).WithMessage("Description cannot exceed 1000 characters");
    }
}

public class UpdateProductDtoValidator : AbstractValidator<UpdateProductDto>
{
    public UpdateProductDtoValidator()
    {
        RuleFor(x => x.Name)
            .MaximumLength(200).WithMessage("Name cannot exceed 200 characters")
            .When(x => !string.IsNullOrEmpty(x.Name));

        RuleFor(x => x.Price)
            .GreaterThan(0).WithMessage("Price must be greater than 0")
            .When(x => x.Price.HasValue);

        RuleFor(x => x.Category)
            .MaximumLength(100).WithMessage("Category cannot exceed 100 characters")
            .When(x => !string.IsNullOrEmpty(x.Category));

        RuleFor(x => x.Description)
            .MaximumLength(1000).WithMessage("Description cannot exceed 1000 characters")
            .When(x => !string.IsNullOrEmpty(x.Description));
    }
}
```

### Step 4: Create CQRS Commands and Queries

Create `Features/Products/Commands/ProductCommands.cs`:

```csharp
// Use the 'createcommands' snippet to generate this quickly
using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Products.Commands;

public record CreateProductCommand(CreateProductDto ProductData, int UserId) : IRequest<Result<ProductResponseDto>>;

public record UpdateProductCommand(int Id, UpdateProductDto ProductData) : IRequest<Result<ProductResponseDto>>;

public record DeleteProductCommand(int Id) : IRequest<Result>;

public record ToggleProductActiveCommand(int Id) : IRequest<Result<ProductResponseDto>>;
```

Create `Features/Products/Queries/ProductQueries.cs`:

```csharp
using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Products.Queries;

public record GetProductByIdQuery(int Id) : IRequest<Result<ProductResponseDto>>;

public record GetProductsQuery(
    string? SearchTerm = null,
    string? Category = null,
    bool? IsActive = null,
    int Page = 1,
    int PageSize = 10,
    string SortBy = "CreatedAt",
    string SortDirection = "desc"
) : IRequest<Result<PagedResult<ProductSummaryDto>>>;
```

### Step 5: Create Handlers

Create handlers following the patterns in `Features/Users/Handlers/`. I'll show one example:

Create `Features/Products/Handlers/CreateProductHandler.cs`:

```csharp
using AutoMapper;
using MediatR;
using Microsoft.EntityFrameworkCore;
using RestApiProject.Common;
using RestApiProject.Data;
using RestApiProject.DTOs;
using RestApiProject.Features.Products.Commands;
using RestApiProject.Models;

namespace RestApiProject.Features.Products.Handlers;

public class CreateProductHandler : IRequestHandler<CreateProductCommand, Result<ProductResponseDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;
    private readonly ILogger<CreateProductHandler> _logger;

    public CreateProductHandler(
        ApplicationDbContext context,
        IMapper mapper,
        ILogger<CreateProductHandler> logger)
    {
        _context = context;
        _mapper = mapper;
        _logger = logger;
    }

    public async Task<Result<ProductResponseDto>> Handle(CreateProductCommand request, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Creating product with data: {@ProductData}", request.ProductData);

            // Create the entity
            var product = new Product
            {
                Name = request.ProductData.Name,
                Description = request.ProductData.Description,
                Price = request.ProductData.Price,
                Category = request.ProductData.Category,
                CreatedByUserId = request.UserId,
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            };

            _context.Products.Add(product);
            await _context.SaveChangesAsync(cancellationToken);

            // Load with navigation properties for response
            var createdProduct = await _context.Products
                .Include(p => p.CreatedBy)
                .FirstAsync(p => p.Id == product.Id, cancellationToken);

            var response = _mapper.Map<ProductResponseDto>(createdProduct);

            _logger.LogInformation("Product created successfully with ID: {Id}", createdProduct.Id);
            return Result<ProductResponseDto>.Success(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating product with data: {@ProductData}", request.ProductData);
            return Result<ProductResponseDto>.Failure("An error occurred while creating the product");
        }
    }
}
```

### Step 6: Create Controller

Create `Controllers/ProductsController.cs`:

```csharp
// Use the 'createcontroller' snippet to generate this quickly
using Asp.Versioning;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using RestApiProject.DTOs;
using RestApiProject.Features.Products.Commands;
using RestApiProject.Features.Products.Queries;

namespace RestApiProject.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
[Produces("application/json")]
public class ProductsController : ControllerBase
{
    private readonly IMediator _mediator;

    public ProductsController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<ProductSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PagedResult<ProductSummaryDto>>> GetProducts(
        [FromQuery] string? searchTerm = null,
        [FromQuery] string? category = null,
        [FromQuery] bool? isActive = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string sortBy = "CreatedAt",
        [FromQuery] string sortDirection = "desc")
    {
        var query = new GetProductsQuery(searchTerm, category, isActive, page, pageSize, sortBy, sortDirection);
        var result = await _mediator.Send(query);

        return result.IsSuccess
            ? Ok(result.Value)
            : BadRequest(result.Error);
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ProductResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductResponseDto>> GetProduct(int id)
    {
        var result = await _mediator.Send(new GetProductByIdQuery(id));

        return result.IsSuccess
            ? Ok(result.Value)
            : NotFound(result.Error);
    }

    [HttpPost]
    [ProducesResponseType(typeof(ProductResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProductResponseDto>> CreateProduct([FromBody] CreateProductDto createProductDto)
    {
        // TODO: Get user ID from authentication context
        var userId = 1; // Placeholder

        var result = await _mediator.Send(new CreateProductCommand(createProductDto, userId));

        if (result.IsSuccess)
        {
            return CreatedAtAction(
                nameof(GetProduct),
                new { id = result.Value!.Id, version = "1.0" },
                result.Value);
        }

        return BadRequest(result.Error);
    }

    // Add more endpoints as needed...
}
```

### Step 7: Update Database Context

Add to `Data/ApplicationDbContext.cs`:

```csharp
// Add DbSet
public DbSet<Product> Products { get; set; }

// Add to ConfigureUserEntities or create new method
private void ConfigureProductEntities(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Product>(entity =>
    {
        entity.HasKey(p => p.Id);

        entity.Property(p => p.Name)
            .IsRequired()
            .HasMaxLength(200);

        entity.Property(p => p.Price)
            .HasPrecision(18, 2); // Decimal precision

        entity.HasIndex(p => p.Name);
        entity.HasIndex(p => p.Category);
        entity.HasIndex(p => p.CreatedAt);

        // Relationship with User
        entity.HasOne(p => p.CreatedBy)
            .WithMany() // No navigation back from User
            .HasForeignKey(p => p.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Soft delete filter
        entity.HasQueryFilter(p => !p.IsDeleted);
    });
}

// Add to OnModelCreating
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    base.OnModelCreating(modelBuilder);

    ConfigureUserEntities(modelBuilder);
    ConfigureProductEntities(modelBuilder); // Add this line
    SeedData(modelBuilder);
}
```

### Step 8: Add AutoMapper Mappings

Add to `Mappings/MappingProfile.cs`:

```csharp
private void ConfigureProductMappings()
{
    CreateMap<Product, ProductResponseDto>()
        .ForMember(dest => dest.CreatedBy, opt => opt.MapFrom(src => src.CreatedBy));

    CreateMap<Product, ProductSummaryDto>();

    CreateMap<CreateProductDto, Product>()
        .ForMember(dest => dest.Id, opt => opt.Ignore())
        .ForMember(dest => dest.CreatedAt, opt => opt.Ignore())
        .ForMember(dest => dest.UpdatedAt, opt => opt.Ignore())
        .ForMember(dest => dest.IsActive, opt => opt.Ignore())
        .ForMember(dest => dest.IsDeleted, opt => opt.Ignore())
        .ForMember(dest => dest.DeletedAt, opt => opt.Ignore())
        .ForMember(dest => dest.CreatedByUserId, opt => opt.Ignore())
        .ForMember(dest => dest.CreatedBy, opt => opt.Ignore());
}

// Add to constructor
public MappingProfile()
{
    ConfigureUserMappings();
    ConfigureProductMappings(); // Add this line
}
```

---

## 🧪 Testing Your Changes

### 1. Build and Run

```bash
# Ensure everything compiles
dotnet build

# Run the application
dotnet run

# Test the API at: https://localhost:7046/scalar/v1
```

### 2. Test Your New Endpoints

- GET /api/v1.0/Products
- GET /api/v1.0/Products/{id}
- POST /api/v1.0/Products

### 3. Database Migration (if using SQL Server)

```bash
# Add migration
dotnet ef migrations add AddProductEntity

# Update database
dotnet ef database update
```

---

## 🎯 Next Steps

### Authentication & Authorization

1. Implement JWT authentication
2. Add role-based authorization
3. Secure your endpoints

### Advanced Features

1. Add caching (Redis)
2. Implement event sourcing
3. Add integration tests
4. Set up CI/CD pipelines

### Production Considerations

1. Configure production database
2. Set up monitoring and logging
3. Configure HTTPS certificates
4. Set up load balancing

---

## 🔧 Template Management & Troubleshooting

### Updating the Template

```bash
# Navigate to your template directory
cd /path/to/rest-api-template

# Pull latest changes
git pull origin main

# Reinstall template with latest changes
dotnet new install . --force

# Verify update
dotnet new list | grep modern
```

### Uninstalling the Template

```bash
# List installed templates to find the path
dotnet new list

# Uninstall using the template path
dotnet new uninstall /path/to/rest-api-template

# Verify removal
dotnet new list | grep modern  # Should return nothing
```

### Common Issues

**Issue: Template not found after installation**

```bash
# Solution: Check if installation succeeded
dotnet new list | grep -i template

# Reinstall if needed
dotnet new install . --force
```

**Issue: "Template already exists" error**

```bash
# Solution: Use --force to overwrite
dotnet new install . --force
```

**Issue: Project generation fails**

```bash
# Solution: Check .NET SDK version
dotnet --version  # Should be 9.0 or later

# Clear NuGet cache if needed
dotnet nuget locals all --clear
```

**Issue: Generated project won't build**

```bash
# Solution: Restore packages explicitly
dotnet restore
dotnet clean
dotnet build
```

---

## 💡 Pro Tips

### Use the Snippets

The template includes 20+ Neovim snippets. Use them to maintain consistency:

- `createentity<Tab>` for entities
- `createdtos<Tab>` for DTOs
- `createvalidator<Tab>` for validators
- `createcommands<Tab>` for CQRS commands

### Follow the Patterns

- Always implement soft delete
- Always add audit fields (CreatedAt, UpdatedAt)
- Use the Result pattern for all operations
- Keep controllers thin (just route to MediatR)
- Validate all inputs with FluentValidation

### Maintain Documentation

- Update API documentation as you add endpoints
- Add XML comments for all public methods
- Keep the README updated

---

## 🎉 You're Ready

Happy coding! 🚀
