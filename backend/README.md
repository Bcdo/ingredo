# 🚀 Modern C# REST API Template

**Production-ready .NET 9 REST API template** implementing modern patterns and best practices for rapid development. This template includes comprehensive user management, extensive documentation, and developer productivity tools.

## ✨ Template Features

### 🏗️ **Architecture & Patterns**

- ✅ **CQRS (Command Query Responsibility Segregation)** with MediatR
- ✅ **Clean Architecture** with organized feature folders
- ✅ **Result Pattern** for comprehensive error handling
- ✅ **Domain-Driven Design** principles
- ✅ **Repository Pattern** through Entity Framework Core

### 🛠️ **Built-in Features**

- ✅ **Complete User Management** with RBAC (Role-Based Access Control)
- ✅ **JWT Authentication** ready to implement
- ✅ **Soft Delete Pattern** for data integrity
- ✅ **Audit Fields** (CreatedAt, UpdatedAt) on all entities
- ✅ **Global Exception Handling** middleware
- ✅ **Health Checks** for monitoring
- ✅ **API Versioning** support
- ✅ **Modern OpenAPI** documentation with Scalar UI

### 📦 **Technologies & Libraries**

- ✅ **.NET 9** - Latest framework features
- ✅ **Entity Framework Core** - Modern ORM with SQLite/SQL Server
- ✅ **MediatR** - CQRS implementation
- ✅ **AutoMapper** - Object mapping
- ✅ **FluentValidation** - Advanced validation
- ✅ **Serilog** - Structured logging
- ✅ **Scalar** - Modern API documentation
- ✅ **Docker** support with nginx reverse proxy

### 🎯 **Developer Productivity**

- ✅ **20+ Custom Neovim Snippets** for rapid coding
- ✅ **Comprehensive Documentation** and learning guides
- ✅ **Git Workflow** templates and automation
- ✅ **Version Management** scripts
- ✅ **Docker Deployment** configuration

## 🚀 Quick Start

### Step 1: Install the Template

```bash
# Clone the template repository
git clone <your-repo-url> rest-api-template
cd rest-api-template

# Install as a dotnet template
dotnet new install .
```

**✅ Verify installation:**
```bash
dotnet new list | grep modern
# Should show: Modern .NET 9 Web API Template  modern-webapi  [C#]  Web/WebAPI/Modern
```

### Step 2: Create New Projects from Template

```bash
# Create a new project (run from any directory)
dotnet new modern-webapi -n YourProjectName
cd YourProjectName

# Build and run
dotnet restore
dotnet build
dotnet run
```

**🎯 Template Parameters:**
```bash
# Basic usage
dotnet new modern-webapi -n "MyCompany.ProductApi"

# With custom output directory
dotnet new modern-webapi -n "MyApi" -o "./projects/MyApi"

# View all available parameters
dotnet new modern-webapi --help
```

### Step 3: Access Your New API

- **🔗 API Documentation**: https://localhost:7046/scalar/v1
- **❤️ Health Check**: https://localhost:7046/health  
- **👥 Users Endpoint**: https://localhost:7046/api/v1.0/Users

### 🔄 Template Management

```bash
# List installed templates
dotnet new list

# Update template (pull latest changes)
cd rest-api-template
git pull
dotnet new install . --force

# Uninstall template
dotnet new uninstall /path/to/rest-api-template
```

---

### 🛠️ Alternative: Direct Clone (For Template Development)

```bash
# If you want to modify the template itself
git clone <your-repo-url> YourNewProject
cd YourNewProject
# See CONTRIBUTING.md for development setup
```

### Prerequisites

- .NET 9 SDK
- Docker (optional, for containerization)
- Git for version control

## 🏗️ Adding New Entities

This template provides **flexible entity design patterns** to match your needs:

### **🔍 Choose Your Entity Pattern**
- **🛬 Simple Entities**: For lookup tables, performance-critical data, simple apps
- **🛡️ BaseEntity**: For audit trails, compliance, enterprise apps (GDPR, SOX)

See `Docs/ENTITY_DESIGN_GUIDE.md` for complete guidance on when to use each pattern.

### **🚀 Development Workflow**
1. **Choose entity pattern** (Simple vs BaseEntity)
2. **Create Entity Model** (use `createentity` snippet)
3. **Create DTOs** (use `createdtos` snippet)
4. **Create Validators** (use `createvalidator` snippet)
5. **Create Commands & Queries** (use CQRS patterns)
6. **Create Handlers** (follow existing examples)
7. **Create Controller** (use `createcontroller` snippet)
8. **Update Database Context** and mappings

**📚 Detailed Instructions:**
- `Docs/TEMPLATE_USAGE_GUIDE.md` - Step-by-step implementation
- `Docs/ENTITY_DESIGN_GUIDE.md` - Entity pattern decisions
- `Docs/FEATURE_DEVELOPMENT_GUIDE.md` - Architecture patterns

## 📡 API Endpoints

### User Management (Complete CRUD + RBAC)

| Method | Endpoint                              | Description      | Response                      |
| ------ | ------------------------------------- | ---------------- | ----------------------------- |
| GET    | `/api/v1.0/Users`                     | Get all users    | `PagedResult<UserSummaryDto>` |
| GET    | `/api/v1.0/Users/{id}`                | Get user by ID   | `UserResponseDto`             |
| POST   | `/api/v1.0/Users`                     | Create user      | `UserResponseDto`             |
| PUT    | `/api/v1.0/Users/{id}`                | Update user      | `UserResponseDto`             |
| DELETE | `/api/v1.0/Users/{id}`                | Soft delete user | `204 No Content`              |
| POST   | `/api/v1.0/Users/{id}/roles/{roleId}` | Assign role      | `UserResponseDto`             |
| DELETE | `/api/v1.0/Users/{id}/roles/{roleId}` | Remove role      | `UserResponseDto`             |

### System Endpoints

| Method | Endpoint     | Description         | Response           |
| ------ | ------------ | ------------------- | ------------------ |
| GET    | `/health`    | Health check status | JSON health report |
| GET    | `/scalar/v1` | API documentation   | Interactive docs   |

## 💡 Usage Examples

### Create a User

```bash
curl -X POST "https://localhost:7046/api/v1.0/Users" \
     -H "Content-Type: application/json" \
     -d '{
       "userName": "john_doe",
       "email": "john@example.com",
       "firstName": "John",
       "lastName": "Doe",
       "password": "SecurePassword123!",
       "dateOfBirth": "1990-01-15"
     }'
```

### Get All Users (with pagination)

```bash
curl "https://localhost:7046/api/v1.0/Users?page=1&pageSize=10&sortBy=CreatedAt&sortDirection=desc"
```

### Check API Health

```bash
curl "https://localhost:7046/health"
```

**Response:**

```json
{
  "status": "Healthy",
  "checks": [
    {
      "name": "ApplicationDbContext",
      "status": "Healthy",
      "description": null,
      "duration": 45.2
    }
  ]
}
```

## 📁 Project Structure

```
RestApiProject/
├── Controllers/              # API Controllers
│   └── UsersController.cs    # User management endpoints
├── Data/                    # EF Core DbContext
│   └── ApplicationDbContext.cs
├── DTOs/                    # Data Transfer Objects
│   └── UserDtos.cs          # User-related DTOs
├── Features/                # CQRS Commands, Queries & Handlers
│   └── Users/              # User management feature
├── Mappings/                # AutoMapper profiles
├── Middleware/              # Custom middleware
├── Models/                  # Domain entities
│   ├── User.cs             # User entity
│   ├── Role.cs             # Role entity
│   └── UserRole.cs         # Many-to-many relationship
├── Validators/              # FluentValidation validators
├── 📚 Documentation/        # Extensive guides and docs
├── 🐳 docker-compose.yml   # Container orchestration
└── 🛠️ Custom scripts/      # Development automation
```

## 📚 Comprehensive Documentation

This template includes extensive learning resources in the `Docs/` folder:

### 🎯 **Getting Started**
- **`TEMPLATE_USAGE_GUIDE.md`** - Complete step-by-step usage guide  
- **`DATABASE_SETUP_GUIDE.md`** - SQLite vs PostgreSQL/SQL Server setup options
- **`ENTITY_DESIGN_GUIDE.md`** - Entity patterns: BaseEntity vs Simple, int vs Guid IDs
- **`FEATURE_DEVELOPMENT_GUIDE.md`** - How to add new entities and features
- **`FEATURE_EXAMPLE_WORKFLOW.md`** - Practical implementation examples

### 🛠️ **Development & Architecture**
- **`MODERN_FEATURES.md`** - Template architecture and design patterns
- **`API_WORKING_GUIDE.md`** - API development best practices
- **`TESTING_GUIDE.md`** - Testing strategies and examples

### 🚀 **Deployment & Operations**
- **`WEB_API_HOSTING_GUIDE.md`** - Production hosting and scaling
- **`QUICK_DEPLOYMENT_GUIDE.md`** - Simple deployment options

### 🎮 **Developer Productivity**
- **`NEOVIM_SNIPPETS_GUIDE.md`** - Custom development snippets for rapid coding
- **`FAQ_FEATURE_DEVELOPMENT.md`** - Common development questions
- **`ENTITY_EXAMPLE_WALKTHROUGH.md`** - Complete feature walkthrough

### 📋 **Project Management**
- **`CONTRIBUTING.md`** - How to contribute to the template (see root directory)

## 🚀 Deployment

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d
# API will be available at http://localhost:8080
```

### Development Database

- **SQLite** (default) - Automatically created
- **SQL Server** - Uncomment configuration in `Program.cs`

---
