# 🗄️ Database Setup Guide

This template supports multiple database approaches to fit different development workflows and team preferences.

---

## 🎯 **Quick Start (Default)**

**Zero setup required!** Just run:

```bash
dotnet run
```

Your template uses **SQLite by default** - perfect for immediate development without any database setup.

---

## 🔍 **Database Approach Comparison**

### **Approach 1: SQLite Dev + Production DB (Default) ⚡**

**✅ Best for:**

- Individual developers
- Rapid prototyping
- Learning projects
- Simple applications
- Teams that prefer minimal setup

**How it works:**

- Development: SQLite (file-based, zero setup)
- Production: PostgreSQL/SQL Server (configured separately)

**Advantages:**

- 🚀 **Instant startup** - no containers, no setup
- 💾 **Zero dependencies** - everything included
- 🧪 **Easy testing** - fresh database per test
- 👥 **Simple onboarding** - new devs just clone and run

**Trade-offs:**

- Different DB behavior between dev/production
- Limited advanced database features in development

### **Approach 2: Production DB for Dev (Docker) 🐳**

**✅ Best for:**

- Production-like development environment
- Teams working with complex database features
- Applications using advanced PostgreSQL features
- Integration testing requirements

**How it works:**

- Development: PostgreSQL in Docker container
- Production: Same PostgreSQL in cloud/server

**Advantages:**

- 🔄 **Production parity** - identical database everywhere
- 🎛️ **Full features** - all advanced database capabilities
- 🔗 **Real connections** - connection pooling, timeouts, etc.
- 📊 **Advanced tools** - pgAdmin, query analysis

**Trade-offs:**

- Setup complexity (Docker required)
- Slower startup time
- More resource usage

---

## 📋 **Setup Instructions**

### **Option 1: SQLite (Default) - Zero Setup**

Already configured! Just run:

```bash
dotnet run
# Database automatically created as RestApi.db
```

**Benefits:**

- No setup required
- Instant development start
- Perfect for most API development

### **Option 2: PostgreSQL with Docker - Production-Like**

**Step 1: Run with Docker Compose**

```bash
# Use the production-like setup
docker-compose -f docker-compose.dev.yml up --build

# Your API with PostgreSQL will be available at:
# - API: http://localhost:8080
# - pgAdmin: http://localhost:5050
```

**Step 2: Manual PostgreSQL Setup (Alternative)**

```bash
# Start just PostgreSQL
docker run -d \
  --name postgres-dev \
  -e POSTGRES_DB=restapi_dev \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=dev_password_123 \
  -p 5432:5432 \
  postgres:15-alpine

# Update appsettings.Development.json
{
  "DatabaseProvider": "PostgreSQL",
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=restapi_dev;Username=postgres;Password=dev_password_123"
  }
}

# Run your API
dotnet run
```

**Step 3: SQL Server Setup (Alternative)**

```bash
# Start SQL Server in Docker
docker run -d \
  --name sqlserver-dev \
  -e 'ACCEPT_EULA=Y' \
  -e 'SA_PASSWORD=YourStrong123Password!' \
  -p 1433:1433 \
  mcr.microsoft.com/mssql/server:2022-latest

# Update appsettings.Development.json
{
  "DatabaseProvider": "SqlServer",
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost,1433;Database=RestApiDev;User Id=sa;Password=YourStrong123Password!;TrustServerCertificate=true;"
  }
}

# Run your API
dotnet run
```

---

## ⚙️ **Configuration Details**

### **Database Provider Configuration**

Your template automatically selects the database provider based on configuration:

**appsettings.json (Default):**

```json
{
  "DatabaseProvider": "SQLite",
  "ConnectionStrings": {
    "SqliteConnection": "Data Source=RestApi.db",
    "DefaultConnection": "Server=(localdb)\\mssqllocaldb;Database=RestApiDb;Trusted_Connection=true"
  }
}
```

**Switching databases:**

```json
// For PostgreSQL
{
  "DatabaseProvider": "PostgreSQL",
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=restapi_dev;Username=postgres;Password=dev_password_123"
  }
}

// For SQL Server
{
  "DatabaseProvider": "SqlServer",
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;Database=RestApiDev;User Id=sa;Password=YourPassword123!;TrustServerCertificate=true;"
  }
}

// For SQLite (default)
{
  "DatabaseProvider": "SQLite",
  "ConnectionStrings": {
    "SqliteConnection": "Data Source=RestApi.db"
  }
}
```

### **Environment-Specific Configuration**

Create environment-specific settings:

**appsettings.Development.json:**

```json
{
  "DatabaseProvider": "PostgreSQL",
  "ConnectionStrings": {
    "DefaultConnection": "Host=postgres;Database=restapi_dev;Username=postgres;Password=dev_password_123"
  }
}
```

**appsettings.Production.json:**

```json
{
  "DatabaseProvider": "PostgreSQL",
  "ConnectionStrings": {
    "DefaultConnection": "${DATABASE_URL}"
  }
}
```

---

## 🚀 **Migration & Deployment**

### **Database Migrations**

**For SQLite (Development):**

```bash
# SQLite uses EnsureCreated() - automatic setup
# No migrations needed for simple development
```

**For PostgreSQL/SQL Server:**

```bash
# Create migration
dotnet ef migrations add InitialCreate

# Apply migrations
dotnet ef database update

# Production deployment
dotnet ef database update --configuration Release
```

### **Production Deployment**

Your `Program.cs` automatically handles different environments:

```csharp
// Development: EnsureCreated() for SQLite
// Production: Should use Migrate() for production databases
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

    if (app.Environment.IsDevelopment())
    {
        context.Database.EnsureCreated(); // SQLite auto-creation
    }
    else
    {
        context.Database.Migrate(); // Production migrations
    }
}
```

---

## 📊 **Team Workflow Recommendations**

### **Small Team / Individual Developer**

```bash
✅ Use SQLite (default setup)
✅ Simple and fast
✅ Focus on business logic, not database setup
```

### **Team with Complex Database Needs**

```bash
✅ Use docker-compose.dev.yml
✅ Everyone runs identical environment
✅ Test production-like scenarios
✅ pgAdmin for database exploration
```

### **Enterprise / Production-First Team**

```bash
✅ Use PostgreSQL from day one
✅ Identical dev/staging/production
✅ Advanced features available immediately
✅ Connection pooling and performance testing
```

---

## 🛠️ **Database Management Tools**

### **SQLite Tools**

- **Built-in**: Use any SQLite browser/editor
- **VS Code**: SQLite Viewer extension
- **Command line**: `sqlite3 RestApi.db`

### **PostgreSQL Tools (with Docker setup)**

- **pgAdmin**: <http://localhost:5050> (included in docker-compose.dev.yml)
- **psql**: `docker exec -it restapi-postgres psql -U postgres -d restapi_dev`
- **VS Code**: PostgreSQL extension

### **SQL Server Tools**

- **SQL Server Management Studio** (Windows)
- **Azure Data Studio** (Cross-platform)
- **VS Code**: SQL Server extension

---

## 🎯 **Recommendations by Use Case**

| **Use Case**          | **Recommended Setup**  | **Reasoning**                       |
| --------------------- | ---------------------- | ----------------------------------- |
| **Learning .NET**     | SQLite (default)       | Focus on code, not database setup   |
| **Personal Projects** | SQLite (default)       | Simple, fast, no overhead           |
| **Team Development**  | Docker PostgreSQL      | Consistent environment for everyone |
| **Production App**    | PostgreSQL from start  | No dev/prod differences             |
| **Enterprise**        | PostgreSQL + pgAdmin   | Advanced features, monitoring       |
| **Microservices**     | PostgreSQL per service | Service isolation, scaling          |

---

## 🔧 **Troubleshooting**

### **Common Issues**

**"Database provider not supported"**

```bash
✅ Check appsettings.json DatabaseProvider value
✅ Ensure correct NuGet packages installed
✅ Verify connection string format
```

**"Cannot connect to PostgreSQL"**

```bash
✅ Ensure Docker container is running
✅ Check port 5432 is available
✅ Verify connection string credentials
✅ Test connection: docker exec -it restapi-postgres pg_isready
```

**"SQLite database locked"**

```bash
✅ Close any database browsers/tools
✅ Restart the application
✅ Delete RestApi.db file to recreate
```

**"Migration failed"**

```bash
✅ Drop database and recreate: dotnet ef database drop
✅ Remove migration files and recreate: dotnet ef migrations add InitialCreate
✅ Ensure target database is accessible
```

### **Docker Issues**

**Container won't start:**

```bash
# Check logs
docker-compose -f docker-compose.dev.yml logs postgres

# Reset containers
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up --build
```

**Port conflicts:**

```bash
# Check what's using port 5432
sudo lsof -i :5432

# Change port in docker-compose.dev.yml if needed
ports:
  - "5433:5432"  # Use different host port
```

---

## 🎉 **Conclusion**

- **🚀 Start simple** with SQLite (default)
- **🔄 Scale up** to PostgreSQL when you need production parity
- **⚙️ Switch easily** via configuration without code changes

