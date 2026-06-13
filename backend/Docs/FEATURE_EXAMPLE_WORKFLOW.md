# 🎯 Practical Example: Adding JWT Authentication Feature

## 📋 **Step-by-Step Feature Implementation**

Let's implement **JWT Authentication** following our professional workflow:

### **Step 1: Planning & Branch Creation**

```bash
# Switch to develop and ensure it's up to date
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/jwt-authentication
git push -u origin feature/jwt-authentication
```

### **Step 2: Feature Development (Following Our Pattern)**

#### **2.1 Create Entity (Models/RefreshToken.cs)**

```csharp
namespace RestApiProject.Models;

public class RefreshToken
{
    public int Id { get; set; }
    public string Token { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public bool IsRevoked { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Foreign Key
    public int UserId { get; set; }
    public User User { get; set; } = null!;
}
```

**Commit:**

```bash
git add .
git commit -m "feat(auth): add RefreshToken entity for JWT token management"
```

#### **2.2 Create DTOs (DTOs/AuthDtos.cs)**

```csharp
namespace RestApiProject.DTOs;

// Login Request
public record LoginRequestDto(
    string Email,
    string Password
);

// Login Response
public record LoginResponseDto(
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAt,
    UserSummaryDto User
);

// Token Refresh Request
public record RefreshTokenRequestDto(
    string RefreshToken
);

// Token Response
public record TokenResponseDto(
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAt
);
```

**Commit:**

```bash
git add .
git commit -m "feat(auth): add authentication DTOs for login and token management"
```

#### **2.3 Add Validators (Validators/AuthValidators.cs)**

```csharp
using FluentValidation;

namespace RestApiProject.Validators;

public class LoginRequestDtoValidator : AbstractValidator<LoginRequestDto>
{
    public LoginRequestDtoValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required")
            .EmailAddress().WithMessage("Valid email address is required");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Password is required")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters");
    }
}

public class RefreshTokenRequestDtoValidator : AbstractValidator<RefreshTokenRequestDto>
{
    public RefreshTokenRequestDtoValidator()
    {
        RuleFor(x => x.RefreshToken)
            .NotEmpty().WithMessage("Refresh token is required");
    }
}
```

**Commit:**

```bash
git add .
git commit -m "feat(auth): add validation rules for authentication requests"
```

#### **2.4 Create Commands (Features/Auth/Commands/AuthCommands.cs)**

```csharp
using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Auth.Commands;

public record LoginCommand(LoginRequestDto LoginRequest) : IRequest<Result<LoginResponseDto>>;

public record RefreshTokenCommand(RefreshTokenRequestDto RefreshRequest) : IRequest<Result<TokenResponseDto>>;

public record LogoutCommand(string RefreshToken) : IRequest<Result>;

public record RevokeAllTokensCommand(int UserId) : IRequest<Result>;
```

**Commit:**

```bash
git add .
git commit -m "feat(auth): add authentication commands for login, refresh, and logout"
```

### **Step 3: Version Update**

Since this is a **new feature** (backward compatible), increment the **minor version**:

```xml
<!-- Update in RestApiProject.csproj -->
<Version>1.1.0</Version>
<AssemblyVersion>1.1.0</AssemblyVersion>
<FileVersion>1.1.0</FileVersion>
<InformationalVersion>1.1.0</InformationalVersion>
```

**Commit:**

```bash
git add .
git commit -m "chore: bump version to 1.1.0 for JWT authentication feature"
```

### **Step 4: Complete Implementation**

Now implement the remaining components following the established patterns:

#### **4.1 Create Handlers**
Implement handlers in `Features/Auth/Handlers/` following the patterns from `Features/Users/Handlers/`:
- `LoginHandler.cs` - Process login requests and generate JWT tokens
- `RefreshTokenHandler.cs` - Handle token refresh logic
- `LogoutHandler.cs` - Revoke refresh tokens

```bash
git add .
git commit -m "feat(auth): implement JWT token generation and validation handlers"
```

#### **4.2 Create Controller**
Create `Controllers/AuthController.cs` following the pattern from `UsersController.cs`:

```bash
git add .
git commit -m "feat(auth): add authentication controller with login/logout endpoints"
```

#### **4.3 Update Database Context**
Add `RefreshToken` DbSet and configuration to `ApplicationDbContext.cs`:

```bash
git add .
git commit -m "feat(auth): configure RefreshToken entity in DbContext"
```

#### **4.4 Create Migration**
Generate and apply database migration:

```bash
dotnet ef migrations add AddRefreshTokens
git add .
git commit -m "feat(auth): add database migration for refresh tokens"
```

#### **4.5 Add Tests**
Create comprehensive tests following patterns in existing test structure:

```bash
git add .
git commit -m "test(auth): add unit tests for authentication handlers"
```

#### **4.6 Update Documentation**
Update API documentation and README with new endpoints:

```bash
git add .
git commit -m "docs(auth): update API documentation for authentication endpoints"
```

*Note: For detailed implementation examples, see `FEATURE_DEVELOPMENT_GUIDE.md`*

### **Step 5: Quality Assurance**

```bash
# Run all tests
dotnet test --configuration Release --logger trx

# Check code coverage
dotnet test --collect:"XPlat Code Coverage"

# Format code
dotnet format

# Security scan
dotnet list package --vulnerable

# Build release version
dotnet build --configuration Release
```

### **Step 6: Create Pull Request**

```bash
# Push all changes
git push origin feature/jwt-authentication

# Create PR in GitHub/GitLab:
# Title: "feat: Add JWT Authentication with Refresh Tokens"
# Description:
# - Implements JWT token-based authentication
# - Adds refresh token mechanism for security
# - Includes comprehensive validation
# - Follows CQRS patterns with MediatR
# - Full test coverage
# - API documentation updated
```

### **Step 7: Code Review & Merge**

- **Automated tests** run and pass
- **Peer review** conducted
- **Security scan** passes
- **Performance impact** assessed
- **Documentation** reviewed
- **Merge to develop** branch

### **Step 8: Cleanup**

```bash
git checkout develop
git pull origin develop
git branch -d feature/jwt-authentication
git push origin --delete feature/jwt-authentication
```

---

## 🚀 **Release Process Example**

### **Preparing Release 1.1.0**

```bash
# Create release branch
git checkout develop
git pull origin develop
git checkout -b release/v1.1.0

# Final version update
# Update CHANGELOG.md
# Update README.md if needed
git add .
git commit -m "chore: prepare release v1.1.0"

# Final testing
dotnet test --configuration Release
# Load testing
# Security testing
# Integration testing
```

### **Deploy to Staging**

```bash
# Using your existing workflow
git checkout staging
git merge develop
git push
git checkout develop
```

### **Production Release**

```bash
# Merge to main
git checkout main
git merge release/v1.1.0
git push origin main

# Tag the release
git tag -a v1.1.0 -m "Release v1.1.0 - JWT Authentication

Features:
- JWT token-based authentication
- Refresh token security mechanism
- Login/logout endpoints
- Token revocation functionality
- Comprehensive validation

Breaking Changes: None
Migration Required: Yes (RefreshToken table)"

git push origin v1.1.0

# Merge back to develop
git checkout develop
git merge release/v1.1.0
git push origin develop

# Cleanup
git branch -d release/v1.1.0
git push origin --delete release/v1.1.0
```

---

## 📊 **Version History Example**

```
v2.0.0 - (planned) Breaking changes
├── BREAKING: New API response format
├── BREAKING: Updated authentication flow
└── feat: OAuth2 integration

v1.2.0 - (planned) Email verification
├── feat: Email verification tokens
├── feat: Email templates
└── feat: SMTP integration

v1.1.0 - JWT Authentication (current)
├── feat: JWT token generation
├── feat: Refresh token mechanism
├── feat: Login/logout endpoints
└── feat: Token revocation

v1.0.0 - Initial release with user management
├── feat: User CRUD operations
├── feat: Role-based access control
├── feat: Password hashing with BCrypt
└── feat: Pagination and filtering



```

---

## 🎯 **Key Takeaways**

### **Professional Workflow Benefits:**

1. **Clear feature boundaries** - Each feature is isolated
2. **Version history** - Easy to track changes
3. **Rollback capability** - Can easily revert problematic releases
4. **Quality assurance** - Multiple checkpoints prevent bugs
5. **Team collaboration** - Clear process for code reviews
6. **Documentation** - Features are well documented
7. **Testing** - Comprehensive testing at each stage

### **Version Management Strategy:**

- **Patch** (1.0.1) - Bug fixes, security patches
- **Minor** (1.1.0) - New features, backward compatible
- **Major** (2.0.0) - Breaking changes, API redesigns

### **When to Update Versions:**

- **Development** - During feature branch creation
- **Release** - Before merging to main
- **Hotfix** - Immediate patch increment
- **Breaking Change** - Major version increment

This workflow ensures **professional code quality**, **reliable deployments**, and **maintainable software** - exactly what you'll use in enterprise development! 🎯

