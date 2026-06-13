# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Build & Run
```bash
# Restore dependencies
dotnet restore

# Build the project
dotnet build

# Run in development mode (with hot reload)
dotnet run

# Run in production mode
dotnet run --configuration Release

# Build for release
dotnet build --configuration Release
```

### Database Operations
```bash
# Create/update database (SQLite - development default)
dotnet run  # Database is automatically created on first run

# Reset database (delete and recreate with seed data)
rm RestApi.db && dotnet run

# For other databases, update appsettings.json:
# - SQLite: "SqliteConnection" (default)
# - PostgreSQL: Set DatabaseProvider to "postgresql"
# - SQL Server: Set DatabaseProvider to "sqlserver"
```

### Docker Operations
```bash
# Development with hot reload
docker-compose -f docker-compose.dev.yml up

# Production build and run
docker-compose up -d

# Build only
docker build -t rest-api-template .
```

### API Testing
```bash
# Check health
curl http://localhost:5193/health

# Interactive API docs (recommended)
# Open: http://localhost:5193/scalar/v1

# Get all users
curl http://localhost:5193/api/v1.0/Users

# Create user
curl -X POST http://localhost:5193/api/v1.0/Users \
  -H "Content-Type: application/json" \
  -d '{
    "userName": "testuser",
    "firstName": "Test",
    "lastName": "User", 
    "email": "test@example.com",
    "password": "SecurePass123!",
    "dateOfBirth": "1990-01-15"
  }'
```

## Project Architecture

### CQRS + MediatR Pattern
This project implements Command Query Responsibility Segregation (CQRS) using MediatR:

- **Commands**: Write operations (Create, Update, Delete) in `Features/*/Commands/`
- **Queries**: Read operations in `Features/*/Queries/`  
- **Handlers**: Business logic implementation in `Features/*/Handlers/`
- **Controllers**: Thin HTTP adapters that delegate to MediatR

### Feature Organization
```
Features/
└── Users/
    ├── Commands/
    │   ├── CreateUserCommand.cs
    │   └── UserCommands.cs
    ├── Handlers/
    │   ├── CreateUserHandler.cs  # Business logic
    │   └── GetUserByIdHandler.cs
    └── Queries/
        └── UserQueries.cs
```

### Data Layer
- **Entity Framework Core** with Code First approach
- **Repository Pattern** abstracted through DbContext
- **Soft Delete** pattern with query filters
- **Audit Fields** (CreatedAt, UpdatedAt) on all entities
- **Optimized Indexes** for performance

### Result Pattern
All operations return `Result<T>` instead of throwing exceptions:
```csharp
public async Task<Result<UserResponseDto>> Handle(CreateUserCommand request, CancellationToken cancellationToken)
{
    if (emailExists)
        return Result<UserResponseDto>.Failure("Email already exists");
    
    return Result<UserResponseDto>.Success(response);
}
```

## Key Components

### Authentication & Security
- **BCrypt** password hashing (never store plain text)
- **JWT-ready** authentication structure  
- **Role-Based Access Control (RBAC)** with User/Role/UserRole entities
- **Email verification** token system
- **Password reset** functionality

### Validation
- **FluentValidation** for comprehensive input validation
- **DTOs** for all API contracts (never expose entities directly)
- **AutoMapper** for entity-DTO mapping

### Database Design
- **Multi-database support**: SQLite (dev), PostgreSQL, SQL Server
- **Many-to-many relationships** properly configured
- **Unique constraints** with soft delete considerations
- **Seed data** for development (admin user with Admin123!)

### Logging & Monitoring
- **Serilog** structured logging to console and files
- **Health Checks** with detailed database status
- **Global Exception Middleware** for consistent error handling

## Template Usage Patterns

### Adding New Entities
1. **Create Entity** in `Models/` (inherit from BaseEntity or simple entity)
2. **Create DTOs** in `DTOs/` for API contracts
3. **Add to DbContext** with proper configuration
4. **Create Validators** using FluentValidation
5. **Implement CQRS** commands/queries/handlers in `Features/`
6. **Create Controller** following the Users controller pattern
7. **Update AutoMapper** profiles

### Entity Design Choices
- **BaseEntity Pattern**: For audit trails, compliance (GDPR/SOX)
- **Simple Entities**: For lookup tables, performance-critical scenarios
- **int vs Guid IDs**: int for performance, Guid for distributed systems

### CQRS Implementation
- One handler per command/query for single responsibility
- Handlers contain business logic, controllers handle HTTP concerns only
- Use MediatR pipeline behaviors for cross-cutting concerns (logging, validation, caching)

## Configuration

### Environment Variables
- `DatabaseProvider`: "sqlite", "postgresql", or "sqlserver" 
- Connection strings in `appsettings.json` or environment variables
- Logging configuration in `appsettings.json`

### Default Admin User
- Username: `admin`
- Email: `admin@example.com`
- Password: `Admin123!`
- Role: Admin

## Development Workflow

### Template Development vs Usage
- This is a **dotnet template** - install with `dotnet new install .`
- For template development: modify source files directly
- For new projects: `dotnet new modern-webapi -n YourProject`

### Testing Strategy
- No unit test project included (this is a template)
- Test generated projects after template installation
- Focus on handler testing (business logic)
- Integration tests for API endpoints

### Documentation Structure
Extensive documentation in `Docs/` folder:
- `TEMPLATE_USAGE_GUIDE.md` - Step-by-step implementation
- `FEATURE_DEVELOPMENT_GUIDE.md` - Adding new features
- `ENTITY_DESIGN_GUIDE.md` - Entity patterns and decisions
- `MODERN_FEATURES.md` - Architecture explanations
- `API_WORKING_GUIDE.md` - API development best practices

## Production Considerations

### Performance
- **Indexes** on commonly queried fields (Email, CreatedAt, IsActive)
- **Query filters** for soft delete (automatic exclusion)
- **Pagination** support in all list endpoints
- **Connection pooling** configured

### Security
- **HTTPS** redirection enabled
- **CORS** configured for development (customize for production)
- **Password hashing** with BCrypt
- **Input validation** on all endpoints
- **Global exception handling** to prevent information leakage

### Deployment
- **Docker support** with nginx reverse proxy
- **Multi-stage builds** for optimized images
- **Health checks** for container orchestration
- **Structured logging** for observability

## Common Development Tasks

### Adding a New Feature (e.g., Products)
1. Create `Models/Product.cs` entity
2. Create `DTOs/ProductDtos.cs` for API contracts  
3. Add Product DbSet to ApplicationDbContext
4. Create `Features/Products/` with Commands/Queries/Handlers
5. Create `Controllers/ProductsController.cs`
6. Update AutoMapper with Product mappings
7. Create FluentValidation validators

### Database Migrations (when needed)
```bash
# Add migration
dotnet ef migrations add AddProductEntity

# Update database  
dotnet ef database update
```

### Extending Authentication
- JWT implementation ready in structure
- Add JWT middleware configuration
- Implement authentication handlers
- Add authorization policies

This template provides a solid foundation for building production-ready APIs with modern .NET patterns and practices.