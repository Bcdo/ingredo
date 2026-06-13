# 🚀 Modern .NET Feature Development Guide

## 📋 File Creation Order & Purpose

When creating a **new feature** (like User Profiles, Notifications, User Roles, etc.), follow this order:

### **Phase 1: Domain Foundation** 🏗️

```
1. Entity/Model       → Domain objects (database tables)
2. DTOs               → Data contracts for API
3. Validators         → Business rules validation
```

### **Phase 2: Business Logic** 🧠

```
4. Commands           → Write operations (Create, Update, Delete)
5. Queries            → Read operations (Get, List, Search)
6. Handlers           → Business logic processors
```

### **Phase 3: API Layer** 🌐

```
7. Controller         → HTTP endpoints
8. AutoMapper Profile → Object mapping
9. DbContext Updates  → Database integration
```

### **Phase 4: Infrastructure** ⚙️

```
10. Migrations        → Database schema changes
11. Tests             → Unit/integration tests
```

---

## 📁 File Types Explained

### **1. Entity/Model** (`Models/UserProfile.cs`)

```csharp
// WHAT: Domain object representing business concept
// WHY: Encapsulates business rules and data structure
// WHEN: Start here - this defines your core business object

public class UserProfile
{
    public int Id { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string ProfileImageUrl { get; set; } = string.Empty;
    public DateTime DateOfBirth { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Navigation properties (relationships)
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    // Business logic methods
    public int GetAge() => DateTime.Now.Year - DateOfBirth.Year;
    public bool IsProfileComplete() => !string.IsNullOrEmpty(DisplayName) && !string.IsNullOrEmpty(Bio);
}
```

### **2. DTOs** (`DTOs/UserProfileDtos.cs`)

```csharp
// WHAT: Data Transfer Objects - API contracts
// WHY: Control what data flows in/out of API
// WHEN: After entity - defines API shape

// INPUT DTOs (from client)
public record CreateUserProfileDto(
    int UserId,
    string DisplayName,
    string Bio,
    DateTime DateOfBirth
);

// OUTPUT DTOs (to client)
public record UserProfileResponseDto(
    int Id,
    string DisplayName,
    string Bio,
    string ProfileImageUrl,
    DateTime DateOfBirth,
    int Age,
    DateTime CreatedAt,
    string UserName
);

// QUERY DTOs (for filtering/searching)
public record GetUserProfilesQuery(
    int? UserId = null,
    string? SearchTerm = null,
    int? MinAge = null,
    int? MaxAge = null,
    int Page = 1,
    int PageSize = 10
);
```

### **3. Validators** (`Validators/UserProfileValidators.cs`)

```csharp
// WHAT: Business rules and validation logic
// WHY: Ensure data integrity and business rules
// WHEN: After DTOs - validates incoming data

public class CreateUserProfileDtoValidator : AbstractValidator<CreateUserProfileDto>
{
    public CreateUserProfileDtoValidator(ApplicationDbContext context)
    {
        RuleFor(x => x.UserId)
            .NotEmpty()
            .MustAsync(UserExists).WithMessage("User does not exist");

        RuleFor(x => x.DisplayName)
            .NotEmpty().WithMessage("Display name is required")
            .Length(2, 50).WithMessage("Display name must be between 2 and 50 characters");

        RuleFor(x => x.Bio)
            .MaximumLength(500).WithMessage("Bio cannot exceed 500 characters");

        RuleFor(x => x.DateOfBirth)
            .LessThan(DateTime.Now.AddYears(-13)).WithMessage("User must be at least 13 years old");
    }

    private async Task<bool> UserExists(int userId, CancellationToken token) =>
        await _context.Users.AnyAsync(u => u.Id == userId, token);
}
```

### **4. Commands** (`Features/UserProfiles/Commands/CreateUserProfileCommand.cs`)

```csharp
// WHAT: Write operations (Create, Update, Delete)
// WHY: Encapsulates business operations that change state
// WHEN: After validation - defines what actions can be performed

public record CreateUserProfileCommand(CreateUserProfileDto ProfileDto) : IRequest<Result<UserProfileResponseDto>>;

public record UpdateUserProfileCommand(int Id, UpdateUserProfileDto ProfileDto) : IRequest<Result<UserProfileResponseDto>>;

public record DeleteUserProfileCommand(int Id) : IRequest<Result>;
```

### **5. Queries** (`Features/UserProfiles/Queries/GetUserProfilesQuery.cs`)

```csharp
// WHAT: Read operations (Get, List, Search)
// WHY: Encapsulates data retrieval logic
// WHEN: After commands - defines how to fetch data

public record GetUserProfileByIdQuery(int Id) : IRequest<Result<UserProfileResponseDto>>;

public record GetUserProfilesQuery(
    int? UserId = null,
    string? SearchTerm = null,
    int? MinAge = null,
    int? MaxAge = null,
    int Page = 1,
    int PageSize = 10
) : IRequest<Result<PagedResult<UserProfileSummaryDto>>>;
```

### **6. Handlers** (`Features/UserProfiles/Handlers/`)

```csharp
// WHAT: Business logic processors
// WHY: Contains the actual implementation of commands/queries
// WHEN: After commands/queries - implements the business logic

public class CreateUserProfileHandler : IRequestHandler<CreateUserProfileCommand, Result<UserProfileResponseDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly IMapper _mapper;

    public async Task<Result<UserProfileResponseDto>> Handle(CreateUserProfileCommand request, CancellationToken cancellationToken)
    {
        // 1. Validate business rules
        // 2. Create domain entity
        // 3. Save to database
        // 4. Return mapped response

        var profile = new UserProfile
        {
            UserId = request.ProfileDto.UserId,
            DisplayName = request.ProfileDto.DisplayName,
            Bio = request.ProfileDto.Bio,
            DateOfBirth = request.ProfileDto.DateOfBirth,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _context.UserProfiles.Add(profile);
        await _context.SaveChangesAsync(cancellationToken);

        return Result<UserProfileResponseDto>.Success(_mapper.Map<UserProfileResponseDto>(profile));
    }
}
```

### **7. Controller** (`Controllers/UserProfilesController.cs`)

```csharp
// WHAT: HTTP API endpoints
// WHY: Handles HTTP requests/responses
// WHEN: After handlers - exposes business logic via HTTP

[ApiController]
[Route("api/v{version:apiVersion}/[controller]")]
public class UserProfilesController : ControllerBase
{
    private readonly IMediator _mediator;

    [HttpGet]
    public async Task<ActionResult<PagedResult<UserProfileSummaryDto>>> GetUserProfiles([FromQuery] GetUserProfilesQuery query)
    {
        var result = await _mediator.Send(query);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    [HttpPost]
    public async Task<ActionResult<UserProfileResponseDto>> CreateUserProfile([FromBody] CreateUserProfileDto dto)
    {
        var result = await _mediator.Send(new CreateUserProfileCommand(dto));

        if (result.IsSuccess)
        {
            return CreatedAtAction(nameof(GetUserProfile), new { id = result.Value!.Id }, result.Value);
        }

        return BadRequest(result.Error);
    }
}
```

### **8. AutoMapper Profile** (`Mappings/UserProfileMappingProfile.cs`)

```csharp
// WHAT: Object-to-object mapping configuration
// WHY: Converts between entities and DTOs automatically
// WHEN: After DTOs and entities are defined

public class UserProfileMappingProfile : Profile
{
    public UserProfileMappingProfile()
    {
        CreateMap<UserProfile, UserProfileResponseDto>()
            .ForMember(dest => dest.Age, opt => opt.MapFrom(src => src.GetAge()))
            .ForMember(dest => dest.UserName, opt => opt.MapFrom(src => src.User.FullName));

        CreateMap<CreateUserProfileDto, UserProfile>()
            .ForMember(dest => dest.Id, opt => opt.Ignore())
            .ForMember(dest => dest.CreatedAt, opt => opt.Ignore())
            .ForMember(dest => dest.UpdatedAt, opt => opt.Ignore());
    }
}
```

### **9. DbContext Updates** (`Data/ApplicationDbContext.cs`)

```csharp
// WHAT: Entity Framework configuration
// WHY: Configures database mapping and relationships
// WHEN: After entity is created

public class ApplicationDbContext : DbContext
{
    public DbSet<UserProfile> UserProfiles { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Configure UserProfile entity
        modelBuilder.Entity<UserProfile>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DisplayName).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Bio).HasMaxLength(500);
            entity.Property(e => e.ProfileImageUrl).HasMaxLength(255);

            // Relationships
            entity.HasOne(e => e.User)
                  .WithOne(u => u.Profile)
                  .HasForeignKey<UserProfile>(e => e.UserId);
        });
    }
}
```

---

## 🎯 **Quick Start Checklist** for New Feature

### **Example: Creating "UserProfiles" Feature**

```bash
# 1. Create directory structure
mkdir -p Features/UserProfiles/{Commands,Queries,Handlers}
mkdir -p Models
mkdir -p DTOs
mkdir -p Validators

# 2. Create files in order:
touch Models/UserProfile.cs
touch DTOs/UserProfileDtos.cs
touch Validators/UserProfileValidators.cs
touch Features/UserProfiles/Commands/UserProfileCommands.cs
touch Features/UserProfiles/Queries/UserProfileQueries.cs
touch Features/UserProfiles/Handlers/CreateUserProfileHandler.cs
touch Features/UserProfiles/Handlers/GetUserProfilesHandler.cs
touch Controllers/UserProfilesController.cs
touch Mappings/UserProfileMappingProfile.cs
```

### **Development Flow:**

1. **Entity First** → Define your business object
2. **DTOs** → Define API contracts
3. **Validators** → Add business rules
4. **Commands/Queries** → Define operations
5. **Handlers** → Implement business logic
6. **Controller** → Expose via HTTP
7. **Mapping** → Configure object conversion
8. **DbContext** → Configure database
9. **Migration** → Update database schema
10. **Test** → Verify everything works

---

## 🧠 **Mental Model**

Think of it like this:

- **Entity** = Your business concept (UserProfile, User, Notification)
- **DTOs** = The shape of data going in/out of your API
- **Commands** = "Do something" (Create profile, Update user, Delete notification)
- **Queries** = "Get something" (Get user, List profiles, Search users)
- **Handlers** = "How to do it" (The actual business logic)
- **Controller** = "HTTP interface" (REST endpoints)
- **Validators** = "Business rules" (What's allowed/not allowed)

This creates a **clean, testable, maintainable** architecture where:

- Controllers are thin (just HTTP concerns)
- Business logic is in handlers (easy to test)
- Data contracts are explicit (DTOs)
- Rules are centralized (validators)
- Database is abstracted (entities)

---

## 🚀 **Why This Order Matters**

1. **Entity First** → Establishes your domain model
2. **DTOs** → Defines your API surface
3. **Validation** → Protects your business rules
4. **Commands/Queries** → Structures your operations
5. **Handlers** → Implements your business logic
6. **Controller** → Exposes everything via HTTP

This **outside-in** approach ensures you build exactly what your API needs, with proper separation of concerns and clean testable code! 🎯

