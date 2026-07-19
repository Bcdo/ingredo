# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the template in `backend/` with a clean `Ingredo` solution — ASP.NET Core (.NET 10) + EF Core/PostgreSQL with committed migrations, docker-compose, Testcontainers-backed integration tests — and the recipe aggregate implemented end-to-end (CRUD, validation, soft delete).

**Architecture:** Lean layering: `RecipesController` (HTTP shape) → `RecipeService` (domain logic, returns `ServiceResult<T>`) → `AppDbContext` (Npgsql). FluentValidation validated explicitly in the controller → `ValidationProblemDetails`. Global exception middleware → ProblemDetails. Client-mintable Guid ids, soft delete via global query filter, full-aggregate replace on update.

**Tech Stack:** .NET 10 SDK (installed: 10.0.104), EF Core 10 + Npgsql provider, FluentValidation 12, Serilog, Scalar (dev-only OpenAPI UI), xUnit + `WebApplicationFactory` + Testcontainers-PostgreSQL, Docker Compose (postgres:17-alpine).

**Spec:** `docs/superpowers/specs/2026-07-19-backend-foundation-design.md`

## Global Constraints

- Target `net10.0`. Single EF provider: Npgsql. Migrations committed; `Database.Migrate()` on startup in Development only; `EnsureCreated()` is banned.
- Soft delete: `DeletedAt` timestamp + global query filter on `Recipe`; DELETE is idempotent (already-deleted → 204; never-existed → 404).
- Client-minted ids: request Guids are honored when present, server-generated when omitted; duplicate recipe id on create → 409.
- Validation rules: title non-empty; servings ≥ 1; ingredient name non-empty; quantity, when present, > 0; scaling ∈ {`linear`, `fixed`} (stored lowercase in the DB); instruction text non-empty; sort orders ≥ 0.
- API surface: `/api/v1/recipes` exactly as specced (list summaries ordered by `UpdatedAt` desc, get, create 201, full-replace put, soft delete 204); `/health` includes a DbContext check; OpenAPI + Scalar in Development only.
- Secrets: no credentials in committed files except `.env.example` placeholders; `backend/.env` is git-ignored.
- Package versions below are pins; if a pinned version does not restore, use the latest stable of the same major and record the substitution in the task report.
- Run all commands from `/home/mrb/Work/Programming/ingredo/backend` unless stated otherwise. Definition of green before every commit: `dotnet build` with zero warnings, `dotnet test` green (Docker running — Testcontainers needs it from Task 4 on).

## File Structure

```
backend/
  Ingredo.sln
  docker-compose.yml
  .env.example
  README.md
  Ingredo.Api/
    Ingredo.Api.csproj, Program.cs, Dockerfile, appsettings.json, appsettings.Development.json
    Common/GlobalExceptionMiddleware.cs, Common/ServiceResult.cs
    Domain/Recipe.cs, Domain/RecipeIngredient.cs, Domain/RecipeInstruction.cs, Domain/ScalingMode.cs
    Data/AppDbContext.cs, Data/Migrations/ (generated)
    Recipes/RecipesController.cs, Recipes/IRecipeService.cs, Recipes/RecipeService.cs,
    Recipes/RecipeDtos.cs, Recipes/RecipeValidators.cs, Recipes/RecipeMappings.cs
  Ingredo.Api.Tests/
    Ingredo.Api.Tests.csproj
    Integration/ApiFactory.cs, Integration/HealthTests.cs, Integration/RecipesApiTests.cs
    Validators/RecipeValidatorTests.cs
```

---

### Task 1: Template teardown and solution skeleton

**Files:**
- Delete: entire current contents of `backend/` (template — preserved in pushed git history)
- Create: `Ingredo.sln`, `Ingredo.Api/` (webapi template, trimmed), `Ingredo.Api.Tests/` (xunit template), root `README.md` stub

**Interfaces:**
- Produces (used by all later tasks): a building solution where `Ingredo.Api.Tests` references `Ingredo.Api`.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/backend-foundation
```

- [ ] **Step 1: Remove the template**

```bash
cd /home/mrb/Work/Programming/ingredo
git rm -r backend/
mkdir backend
```

- [ ] **Step 2: Scaffold the solution**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet new sln -n Ingredo
dotnet new webapi --use-controllers -n Ingredo.Api
dotnet new xunit -n Ingredo.Api.Tests
dotnet sln add Ingredo.Api Ingredo.Api.Tests
dotnet add Ingredo.Api.Tests reference Ingredo.Api
```

- [ ] **Step 3: Trim the webapi sample**

Delete the weather sample: `Ingredo.Api/Controllers/WeatherForecastController.cs` and `Ingredo.Api/WeatherForecast.cs` (names may vary slightly by template version — remove whatever sample controller/model the template generated; keep the `Controllers/` directory). Delete `Ingredo.Api/Ingredo.Api.http` if generated.

Replace `Ingredo.Api/Program.cs` with the minimal controller host (built out in later tasks):

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

var app = builder.Build();

app.MapControllers();

app.Run();

public partial class Program;
```

(The `public partial class Program;` line is required by the Task 4 test factory — keep it in every future edit of this file.)

Replace the default test file `Ingredo.Api.Tests/UnitTest1.cs` with `Ingredo.Api.Tests/SmokeTests.cs`:

```csharp
namespace Ingredo.Api.Tests;

public class SmokeTests
{
    [Fact]
    public void SolutionBuildsAndTestsRun()
    {
        Assert.True(true);
    }
}
```

- [ ] **Step 4: Verify build and tests**

```bash
dotnet build
dotnet test
```

Expected: build succeeds with zero warnings; 1 test passes.

- [ ] **Step 5: Add a README stub**

Create `backend/README.md`:

```markdown
# Ingredo backend

ASP.NET Core (.NET 10) API for Ingredo. Work in progress — see
`docs/superpowers/specs/2026-07-19-backend-foundation-design.md`.

Full run/test instructions land with the infrastructure tasks.
```

- [ ] **Step 6: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "chore: replace backend template with Ingredo solution skeleton"
```

---

### Task 2: Cross-cutting infrastructure (logging, errors, health, docs, Docker)

**Files:**
- Create: `Ingredo.Api/Common/GlobalExceptionMiddleware.cs`, `Ingredo.Api/Dockerfile`, `backend/docker-compose.yml`, `backend/.env.example`
- Modify: `Ingredo.Api/Ingredo.Api.csproj` (packages), `Ingredo.Api/Program.cs`, `Ingredo.Api/appsettings.json`, `backend/README.md`, repo-root `.gitignore` (ensure `backend/.env` ignored)

**Interfaces:**
- Produces: `/health` endpoint (no DB check yet — Task 3 adds it); exception middleware; Serilog; Scalar UI in Development; a buildable Docker image; compose file whose `api` service Task 3's connection string slots into.

- [ ] **Step 1: Add packages**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet add Ingredo.Api package Serilog.AspNetCore --version 9.0.0
dotnet add Ingredo.Api package Scalar.AspNetCore --version 2.8.11
```

- [ ] **Step 2: Global exception middleware**

Create `Ingredo.Api/Common/GlobalExceptionMiddleware.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Common;

// Last-resort handler: expected outcomes never throw across the controller
// boundary (ServiceResult carries them); anything reaching here is a bug or
// infrastructure failure and returns an opaque 500 ProblemDetails.
public sealed class GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception for {Method} {Path}",
                context.Request.Method, context.Request.Path);

            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An unexpected error occurred.",
            });
        }
    }
}
```

- [ ] **Step 3: Wire Program.cs**

Replace `Ingredo.Api/Program.cs`:

```csharp
using Ingredo.Api.Common;
using Scalar.AspNetCore;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, configuration) =>
{
    configuration.ReadFrom.Configuration(context.Configuration).WriteTo.Console();
    if (context.HostingEnvironment.IsDevelopment())
    {
        configuration.WriteTo.File("logs/app.log", rollingInterval: RollingInterval.Day);
    }
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapHealthChecks("/health");
app.MapControllers();

app.Run();

public partial class Program;
```

Replace `Ingredo.Api/appsettings.json`:

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft.AspNetCore": "Warning"
      }
    }
  },
  "AllowedHosts": "*"
}
```

(Leave `appsettings.Development.json` as generated unless it contains a `Logging` section — if it does, remove that section; Serilog owns logging.)

- [ ] **Step 4: Dockerfile and compose**

Create `Ingredo.Api/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Ingredo.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Ingredo.Api.dll"]
```

Create `backend/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-ingredo}
      POSTGRES_USER: ${POSTGRES_USER:-ingredo}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in backend/.env}
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: ./Ingredo.Api
    environment:
      ASPNETCORE_ENVIRONMENT: Development
      ConnectionStrings__Default: Host=postgres;Port=5432;Database=${POSTGRES_DB:-ingredo};Username=${POSTGRES_USER:-ingredo};Password=${POSTGRES_PASSWORD}
    ports:
      - '8080:8080'
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

Create `backend/.env.example`:

```
POSTGRES_DB=ingredo
POSTGRES_USER=ingredo
POSTGRES_PASSWORD=change_me_locally
```

Append to the repo-root `.gitignore` (check first — add only if absent):

```
backend/.env
backend/Ingredo.Api/logs/
```

- [ ] **Step 5: Verify — build, run, health**

```bash
dotnet build
dotnet test
ASPNETCORE_ENVIRONMENT=Development dotnet run --project Ingredo.Api --urls http://localhost:5180 &
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5180/health   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5180/scalar   # expect 200 (dev only)
kill %1
```

Expected: zero build warnings, tests green, both curls 200.

- [ ] **Step 6: Update README and commit**

Replace `backend/README.md`:

```markdown
# Ingredo backend

ASP.NET Core (.NET 10) API for Ingredo.

## Run locally

```bash
cp .env.example .env          # set a real local password
docker compose up -d postgres # database only; or `docker compose up` for both
dotnet run --project Ingredo.Api
```

- API docs (Development): http://localhost:5180/scalar
- Health: /health

## Test

```bash
dotnet test   # integration tests need Docker (Testcontainers)
```
```

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/ .gitignore
git commit -m "feat: add backend logging, error handling, health, docker infrastructure"
```

---

### Task 3: Domain, DbContext, migrations

**Files:**
- Create: `Ingredo.Api/Domain/ScalingMode.cs`, `Domain/Recipe.cs`, `Domain/RecipeIngredient.cs`, `Domain/RecipeInstruction.cs`, `Data/AppDbContext.cs`, `Data/Migrations/` (generated)
- Modify: `Ingredo.Api/Ingredo.Api.csproj` (packages), `Program.cs` (DbContext, dev migrate, DB health check), `appsettings.json` + `appsettings.Development.json` (connection string)

**Interfaces:**
- Produces (used by Tasks 4–6): `AppDbContext` with `Recipes`, `RecipeIngredients`, `RecipeInstructions` DbSets; entities as below; connection string key `ConnectionStrings:Default`.

- [ ] **Step 1: Add packages**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet add Ingredo.Api package Npgsql.EntityFrameworkCore.PostgreSQL --version 10.0.0
dotnet add Ingredo.Api package Microsoft.EntityFrameworkCore.Design --version 10.0.0
dotnet add Ingredo.Api package Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore --version 10.0.0
dotnet tool install --global dotnet-ef 2>/dev/null || dotnet tool update --global dotnet-ef
```

- [ ] **Step 2: Domain entities**

Create `Ingredo.Api/Domain/ScalingMode.cs`:

```csharp
namespace Ingredo.Api.Domain;

public enum ScalingMode
{
    Linear,
    Fixed,
}
```

Create `Ingredo.Api/Domain/Recipe.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class Recipe
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public int Servings { get; set; } = 4;
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }

    public List<RecipeIngredient> Ingredients { get; set; } = [];
    public List<RecipeInstruction> Instructions { get; set; } = [];
}
```

Create `Ingredo.Api/Domain/RecipeIngredient.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class RecipeIngredient
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }
    public required string Name { get; set; }
    public decimal? Quantity { get; set; }
    public string? Unit { get; set; }
    public ScalingMode Scaling { get; set; } = ScalingMode.Linear;
    public int SortOrder { get; set; }
}
```

Create `Ingredo.Api/Domain/RecipeInstruction.cs`:

```csharp
namespace Ingredo.Api.Domain;

public class RecipeInstruction
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }
    public required string Text { get; set; }
    public int SortOrder { get; set; }
}
```

- [ ] **Step 3: DbContext**

Create `Ingredo.Api/Data/AppDbContext.cs`:

```csharp
using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeInstruction> RecipeInstructions => Set<RecipeInstruction>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Recipe>(recipe =>
        {
            recipe.Property(r => r.Title).IsRequired().HasMaxLength(500);
            recipe.HasQueryFilter(r => r.DeletedAt == null);
            recipe
                .HasMany(r => r.Ingredients)
                .WithOne()
                .HasForeignKey(i => i.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
            recipe
                .HasMany(r => r.Instructions)
                .WithOne()
                .HasForeignKey(i => i.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RecipeIngredient>(ingredient =>
        {
            ingredient.Property(i => i.Name).IsRequired().HasMaxLength(500);
            // Stored as the frontend's lowercase strings so Phase 5 sync
            // compares like with like.
            ingredient
                .Property(i => i.Scaling)
                .HasConversion(
                    scaling => scaling.ToString().ToLowerInvariant(),
                    value => Enum.Parse<ScalingMode>(value, true))
                .HasMaxLength(16);
        });

        modelBuilder.Entity<RecipeInstruction>(instruction =>
        {
            instruction.Property(i => i.Text).IsRequired();
        });
    }
}
```

- [ ] **Step 4: Wire DbContext, dev migrate, DB health check**

In `Ingredo.Api/Program.cs`, add imports:

```csharp
using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;
```

After `builder.Services.AddControllers();` add:

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

Change the health-check registration to:

```csharp
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();
```

After `var app = builder.Build();` add (spec decision 3 — Development only, never `EnsureCreated`):

```csharp
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}
```

In `Ingredo.Api/appsettings.Development.json`, add:

```json
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=ingredo;Username=ingredo;Password=change_me_locally"
  }
}
```

(Committed dev connection string matches `.env.example` placeholders only — real local passwords live in `backend/.env`, which compose injects; `dotnet run` users override via user-secrets or environment if they changed the password.)

- [ ] **Step 5: Generate the migration**

```bash
dotnet ef migrations add InitialCreate --project Ingredo.Api --output-dir Data/Migrations
dotnet build
```

Expected: `Data/Migrations/` gains three files; build stays warning-clean.

- [ ] **Step 6: Verify against real postgres**

```bash
cp -n .env.example .env
docker compose up -d postgres
sleep 8
ASPNETCORE_ENVIRONMENT=Development dotnet run --project Ingredo.Api --urls http://localhost:5180 &
sleep 8
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5180/health   # expect 200 (includes DB check)
kill %1
docker compose stop postgres
```

Expected: health 200 with the database check passing (migrations applied on startup).

- [ ] **Step 7: Commit**

```bash
dotnet test
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add recipe domain, DbContext, and initial migration"
```

---

### Task 4: Integration test rig (Testcontainers)

**Files:**
- Create: `Ingredo.Api.Tests/Integration/ApiFactory.cs`, `Integration/HealthTests.cs`
- Modify: `Ingredo.Api.Tests/Ingredo.Api.Tests.csproj` (packages)
- Delete: `Ingredo.Api.Tests/SmokeTests.cs` (superseded by real tests)

**Interfaces:**
- Consumes: `public partial class Program` (Task 2), `ConnectionStrings:Default` key (Task 3).
- Produces (used by Task 6): `ApiFactory` — a `WebApplicationFactory<Program>` + owned PostgreSQL Testcontainer, used via `IClassFixture<ApiFactory>`.

- [ ] **Step 1: Add packages**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet add Ingredo.Api.Tests package Microsoft.AspNetCore.Mvc.Testing --version 10.0.0
dotnet add Ingredo.Api.Tests package Testcontainers.PostgreSql --version 4.1.0
```

- [ ] **Step 2: Write the factory and the failing health test**

Create `Ingredo.Api.Tests/Integration/ApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Testcontainers.PostgreSql;

namespace Ingredo.Api.Tests.Integration;

// One real PostgreSQL container per test class (IClassFixture). The app
// starts in Development, so startup migrations build the schema in the
// container automatically.
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:17-alpine")
        .Build();

    public Task InitializeAsync() => _postgres.StartAsync();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Default", _postgres.GetConnectionString());
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}
```

Create `Ingredo.Api.Tests/Integration/HealthTests.cs`:

```csharp
namespace Ingredo.Api.Tests.Integration;

public class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Health_reports_healthy_including_database()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }
}
```

Delete `Ingredo.Api.Tests/SmokeTests.cs`.

- [ ] **Step 3: Run to verify the rig works end-to-end**

Run: `dotnet test`
Expected: PASS — 1 test; a postgres container visibly starts and stops (Docker required). If this is the first Testcontainers run, image pull may take a minute.

(No RED step here: the rig itself is the deliverable; its failure modes are infrastructural, not behavioral.)

- [ ] **Step 4: Commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "test: add Testcontainers integration rig with health check test"
```

---

### Task 5: Recipe DTOs and validators

**Files:**
- Create: `Ingredo.Api/Recipes/RecipeDtos.cs`, `Recipes/RecipeValidators.cs`, `Ingredo.Api.Tests/Validators/RecipeValidatorTests.cs`
- Modify: `Ingredo.Api/Ingredo.Api.csproj` (FluentValidation)

**Interfaces:**
- Produces (used by Task 6): request records `RecipeRequest`, `IngredientRequest`, `InstructionRequest`; response records `RecipeResponse`, `RecipeSummaryResponse`, `IngredientResponse`, `InstructionResponse`; `RecipeRequestValidator`.

- [ ] **Step 1: Add package**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet add Ingredo.Api package FluentValidation --version 12.0.0
dotnet add Ingredo.Api package FluentValidation.DependencyInjectionExtensions --version 12.0.0
```

- [ ] **Step 2: Write the failing validator tests**

Create `Ingredo.Api.Tests/Validators/RecipeValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Validators;

public class RecipeValidatorTests
{
    private readonly RecipeRequestValidator _validator = new();

    private static RecipeRequest Valid() =>
        new(
            Id: null,
            Title: "Pannekaker",
            Description: "Klassiske",
            Servings: 4,
            Notes: null,
            Ingredients:
            [
                new IngredientRequest(null, "Hvetemel", 400, "g", "linear", 0),
                new IngredientRequest(null, "Salt", null, null, "fixed", 1),
            ],
            Instructions: [new InstructionRequest(null, "Visp sammen.", 0)]);

    [Fact]
    public void Accepts_a_valid_request()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_title(string title)
    {
        var result = _validator.TestValidate(Valid() with { Title = title });
        result.ShouldHaveValidationErrorFor(r => r.Title);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_non_positive_servings(int servings)
    {
        var result = _validator.TestValidate(Valid() with { Servings = servings });
        result.ShouldHaveValidationErrorFor(r => r.Servings);
    }

    [Fact]
    public void Rejects_blank_ingredient_name_and_non_positive_quantity()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, " ", 0, "g", "linear", 0)],
        };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor("Ingredients[0].Name");
        result.ShouldHaveValidationErrorFor("Ingredients[0].Quantity");
    }

    [Fact]
    public void Accepts_missing_quantity_and_unit()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Salt og pepper", null, null, "linear", 0)],
        };
        _validator.TestValidate(request).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("cubic")]
    [InlineData("")]
    [InlineData("LINEARISH")]
    public void Rejects_unknown_scaling(string scaling)
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", scaling, 0)],
        };
        _validator.TestValidate(request).ShouldHaveValidationErrorFor("Ingredients[0].Scaling");
    }

    [Fact]
    public void Accepts_scaling_case_insensitively()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", "Fixed", 0)],
        };
        _validator.TestValidate(request).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Rejects_blank_instruction_and_negative_sort_orders()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", "linear", -1)],
            Instructions = [new InstructionRequest(null, "", -2)],
        };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor("Ingredients[0].SortOrder");
        result.ShouldHaveValidationErrorFor("Instructions[0].Text");
        result.ShouldHaveValidationErrorFor("Instructions[0].SortOrder");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet test --filter RecipeValidatorTests`
Expected: FAIL to compile — `RecipeRequest` etc. don't exist yet. (Compile failure is the RED state for new types.)

- [ ] **Step 4: Implement DTOs and validators**

Create `Ingredo.Api/Recipes/RecipeDtos.cs`:

```csharp
namespace Ingredo.Api.Recipes;

public sealed record RecipeRequest(
    Guid? Id,
    string Title,
    string? Description,
    int Servings,
    string? Notes,
    List<IngredientRequest> Ingredients,
    List<InstructionRequest> Instructions);

public sealed record IngredientRequest(
    Guid? Id,
    string Name,
    decimal? Quantity,
    string? Unit,
    string Scaling,
    int SortOrder);

public sealed record InstructionRequest(Guid? Id, string Text, int SortOrder);

public sealed record RecipeResponse(
    Guid Id,
    string Title,
    string? Description,
    int Servings,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    List<IngredientResponse> Ingredients,
    List<InstructionResponse> Instructions);

public sealed record IngredientResponse(
    Guid Id,
    string Name,
    decimal? Quantity,
    string? Unit,
    string Scaling,
    int SortOrder);

public sealed record InstructionResponse(Guid Id, string Text, int SortOrder);

public sealed record RecipeSummaryResponse(Guid Id, string Title, int Servings, DateTimeOffset UpdatedAt);
```

Create `Ingredo.Api/Recipes/RecipeValidators.cs`:

```csharp
using FluentValidation;
using Ingredo.Api.Domain;

namespace Ingredo.Api.Recipes;

// Mirrors the frontend's form rules (frontend/lib/form.ts): title required,
// servings ≥ 1, quantity positive when present, closed scaling set.
public sealed class RecipeRequestValidator : AbstractValidator<RecipeRequest>
{
    public RecipeRequestValidator()
    {
        RuleFor(r => r.Title).Must(title => !string.IsNullOrWhiteSpace(title))
            .WithMessage("Title must not be empty.");
        RuleFor(r => r.Servings).GreaterThanOrEqualTo(1);
        RuleForEach(r => r.Ingredients).SetValidator(new IngredientRequestValidator());
        RuleForEach(r => r.Instructions).SetValidator(new InstructionRequestValidator());
    }
}

public sealed class IngredientRequestValidator : AbstractValidator<IngredientRequest>
{
    public IngredientRequestValidator()
    {
        RuleFor(i => i.Name).Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Ingredient name must not be empty.");
        RuleFor(i => i.Quantity).GreaterThan(0).When(i => i.Quantity.HasValue);
        RuleFor(i => i.Scaling)
            .Must(scaling => Enum.TryParse<ScalingMode>(scaling, true, out _))
            .WithMessage("Scaling must be 'linear' or 'fixed'.");
        RuleFor(i => i.SortOrder).GreaterThanOrEqualTo(0);
    }
}

public sealed class InstructionRequestValidator : AbstractValidator<InstructionRequest>
{
    public InstructionRequestValidator()
    {
        RuleFor(i => i.Text).Must(text => !string.IsNullOrWhiteSpace(text))
            .WithMessage("Instruction text must not be empty.");
        RuleFor(i => i.SortOrder).GreaterThanOrEqualTo(0);
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test --filter RecipeValidatorTests`
Expected: PASS — 12 tests (theories expanded).

- [ ] **Step 6: Full green and commit**

```bash
dotnet build
dotnet test
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add recipe DTOs and validators"
```

---

### Task 6: Recipe service, controller, and integration tests

**Files:**
- Create: `Ingredo.Api/Common/ServiceResult.cs`, `Recipes/IRecipeService.cs`, `Recipes/RecipeService.cs`, `Recipes/RecipeMappings.cs`, `Recipes/RecipesController.cs`, `Ingredo.Api.Tests/Integration/RecipesApiTests.cs`
- Modify: `Ingredo.Api/Program.cs` (register service + validators)

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces: the `/api/v1/recipes` surface per spec decision 6.

- [ ] **Step 1: Write the failing integration tests**

Create `Ingredo.Api.Tests/Integration/RecipesApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

public class RecipesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static RecipeRequest NewRecipe(string title = "Pannekaker", Guid? id = null) =>
        new(
            Id: id,
            Title: title,
            Description: "Klassiske",
            Servings: 4,
            Notes: null,
            Ingredients:
            [
                new IngredientRequest(null, "Hvetemel", 400, "g", "linear", 0),
                new IngredientRequest(null, "Salt", null, null, "fixed", 1),
            ],
            Instructions:
            [
                new InstructionRequest(null, "Visp sammen.", 0),
                new InstructionRequest(null, "Stek.", 1),
            ]);

    [Fact]
    public async Task Create_then_get_round_trips_the_aggregate()
    {
        var created = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var recipe = await created.Content.ReadFromJsonAsync<RecipeResponse>();
        Assert.NotNull(recipe);

        var fetched = await _client.GetFromJsonAsync<RecipeResponse>($"/api/v1/recipes/{recipe.Id}");
        Assert.NotNull(fetched);
        Assert.Equal("Pannekaker", fetched.Title);
        Assert.Equal(["Hvetemel", "Salt"], fetched.Ingredients.Select(i => i.Name));
        Assert.Equal("linear", fetched.Ingredients[0].Scaling);
        Assert.Equal(400, fetched.Ingredients[0].Quantity);
        Assert.Equal(["Visp sammen.", "Stek."], fetched.Instructions.Select(i => i.Text));
    }

    [Fact]
    public async Task Create_honors_a_client_minted_id_and_conflicts_on_reuse()
    {
        var id = Guid.NewGuid();

        var first = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe(id: id));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var recipe = await first.Content.ReadFromJsonAsync<RecipeResponse>();
        Assert.Equal(id, recipe!.Id);

        var second = await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Vafler", id));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_invalid_payload_with_validation_problem()
    {
        var invalid = NewRecipe() with
        {
            Title = " ",
            Ingredients = [new IngredientRequest(null, "Mel", 0, "g", "cubic", 0)],
        };

        var response = await _client.PostAsJsonAsync("/api/v1/recipes", invalid);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Title", body);
        Assert.Contains("Quantity", body);
        Assert.Contains("Scaling", body);
    }

    [Fact]
    public async Task Update_replaces_the_aggregate_and_bumps_updated_at()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Tacos")))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var replacement = NewRecipe("Tacos deluxe") with
        {
            Servings = 6,
            Ingredients = [new IngredientRequest(null, "Kjøttdeig", 400, "g", "linear", 0)],
            Instructions = [new InstructionRequest(null, "Stek kjøttdeigen.", 0)],
        };
        var updated = await _client.PutAsJsonAsync($"/api/v1/recipes/{created!.Id}", replacement);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);

        var fetched = await _client.GetFromJsonAsync<RecipeResponse>($"/api/v1/recipes/{created.Id}");
        Assert.Equal("Tacos deluxe", fetched!.Title);
        Assert.Equal(6, fetched.Servings);
        Assert.Single(fetched.Ingredients);
        Assert.Single(fetched.Instructions);
        Assert.True(fetched.UpdatedAt > created.UpdatedAt);
    }

    [Fact]
    public async Task Update_of_unknown_recipe_is_404()
    {
        var response = await _client.PutAsJsonAsync($"/api/v1/recipes/{Guid.NewGuid()}", NewRecipe());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_is_soft_and_idempotent()
    {
        var created = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("Suppe")))
            .Content.ReadFromJsonAsync<RecipeResponse>();

        var first = await _client.DeleteAsync($"/api/v1/recipes/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);

        var gone = await _client.GetAsync($"/api/v1/recipes/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);

        var again = await _client.DeleteAsync($"/api/v1/recipes/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        var never = await _client.DeleteAsync($"/api/v1/recipes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, never.StatusCode);
    }

    [Fact]
    public async Task List_returns_summaries_newest_first_excluding_deleted()
    {
        var a = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("List-A")))
            .Content.ReadFromJsonAsync<RecipeResponse>();
        var b = await (await _client.PostAsJsonAsync("/api/v1/recipes", NewRecipe("List-B")))
            .Content.ReadFromJsonAsync<RecipeResponse>();
        await _client.DeleteAsync($"/api/v1/recipes/{a!.Id}");

        var list = await _client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");

        Assert.NotNull(list);
        Assert.DoesNotContain(list, r => r.Id == a.Id);
        var bSummary = Assert.Single(list, r => r.Id == b!.Id);
        Assert.Equal("List-B", bSummary.Title);
        var ourTitles = list.Where(r => r.Title.StartsWith("List-")).Select(r => r.Title).ToList();
        Assert.Equal(["List-B"], ourTitles);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter RecipesApiTests`
Expected: FAIL — all requests 404 (no controller exists); compile succeeds because DTOs exist.

- [ ] **Step 3: Implement ServiceResult, mapping, service, controller, wiring**

Create `Ingredo.Api/Common/ServiceResult.cs`:

```csharp
namespace Ingredo.Api.Common;

public enum ServiceStatus
{
    Ok,
    NotFound,
    Conflict,
}

// Expected outcomes travel as values, not exceptions; controllers translate
// Status to HTTP codes.
public sealed record ServiceResult<T>(ServiceStatus Status, T? Value)
{
    public static ServiceResult<T> Ok(T value) => new(ServiceStatus.Ok, value);
    public static ServiceResult<T> NotFound() => new(ServiceStatus.NotFound, default);
    public static ServiceResult<T> Conflict() => new(ServiceStatus.Conflict, default);
}
```

Create `Ingredo.Api/Recipes/RecipeMappings.cs`:

```csharp
using Ingredo.Api.Domain;

namespace Ingredo.Api.Recipes;

public static class RecipeMappings
{
    public static Recipe ToEntity(this RecipeRequest request, DateTimeOffset now) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description,
            Servings = request.Servings,
            Notes = request.Notes,
            CreatedAt = now,
            UpdatedAt = now,
            Ingredients = request.Ingredients.Select(i => i.ToEntity()).ToList(),
            Instructions = request.Instructions.Select(i => i.ToEntity()).ToList(),
        };

    public static RecipeIngredient ToEntity(this IngredientRequest request) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Name = request.Name.Trim(),
            Quantity = request.Quantity,
            Unit = request.Unit,
            Scaling = Enum.Parse<ScalingMode>(request.Scaling, true),
            SortOrder = request.SortOrder,
        };

    public static RecipeInstruction ToEntity(this InstructionRequest request) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Text = request.Text.Trim(),
            SortOrder = request.SortOrder,
        };

    public static RecipeResponse ToResponse(this Recipe recipe) =>
        new(
            recipe.Id,
            recipe.Title,
            recipe.Description,
            recipe.Servings,
            recipe.Notes,
            recipe.CreatedAt,
            recipe.UpdatedAt,
            recipe.Ingredients
                .OrderBy(i => i.SortOrder)
                .Select(i => new IngredientResponse(
                    i.Id, i.Name, i.Quantity, i.Unit,
                    i.Scaling.ToString().ToLowerInvariant(), i.SortOrder))
                .ToList(),
            recipe.Instructions
                .OrderBy(i => i.SortOrder)
                .Select(i => new InstructionResponse(i.Id, i.Text, i.SortOrder))
                .ToList());

    public static RecipeSummaryResponse ToSummary(this Recipe recipe) =>
        new(recipe.Id, recipe.Title, recipe.Servings, recipe.UpdatedAt);
}
```

Create `Ingredo.Api/Recipes/IRecipeService.cs`:

```csharp
using Ingredo.Api.Common;

namespace Ingredo.Api.Recipes;

public interface IRecipeService
{
    Task<List<RecipeSummaryResponse>> ListAsync(CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> GetAsync(Guid id, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> CreateAsync(RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> UpdateAsync(Guid id, RecipeRequest request, CancellationToken cancellationToken);
    Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid id, CancellationToken cancellationToken);
}
```

Create `Ingredo.Api/Recipes/RecipeService.cs`:

```csharp
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Recipes;

public sealed class RecipeService(AppDbContext db) : IRecipeService
{
    public async Task<List<RecipeSummaryResponse>> ListAsync(CancellationToken cancellationToken)
    {
        return await db.Recipes
            .OrderByDescending(r => r.UpdatedAt)
            .Select(r => new RecipeSummaryResponse(r.Id, r.Title, r.Servings, r.UpdatedAt))
            .ToListAsync(cancellationToken);
    }

    public async Task<ServiceResult<RecipeResponse>> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        var recipe = await LoadAggregate(id, cancellationToken);
        return recipe is null
            ? ServiceResult<RecipeResponse>.NotFound()
            : ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> CreateAsync(
        RecipeRequest request, CancellationToken cancellationToken)
    {
        if (request.Id is { } requestedId)
        {
            var exists = await db.Recipes
                .IgnoreQueryFilters()
                .AnyAsync(r => r.Id == requestedId, cancellationToken);
            if (exists) return ServiceResult<RecipeResponse>.Conflict();
        }

        var recipe = request.ToEntity(DateTimeOffset.UtcNow);
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> UpdateAsync(
        Guid id, RecipeRequest request, CancellationToken cancellationToken)
    {
        var recipe = await LoadAggregate(id, cancellationToken);
        if (recipe is null) return ServiceResult<RecipeResponse>.NotFound();

        recipe.Title = request.Title.Trim();
        recipe.Description = request.Description;
        recipe.Servings = request.Servings;
        recipe.Notes = request.Notes;
        recipe.UpdatedAt = DateTimeOffset.UtcNow;

        // Full-aggregate replace, matching the frontend's edit semantics.
        recipe.Ingredients.Clear();
        recipe.Ingredients.AddRange(request.Ingredients.Select(i => i.ToEntity()));
        recipe.Instructions.Clear();
        recipe.Instructions.AddRange(request.Instructions.Select(i => i.ToEntity()));

        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    public async Task<ServiceResult<RecipeResponse>> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var recipe = await db.Recipes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (recipe is null) return ServiceResult<RecipeResponse>.NotFound();
        if (recipe.DeletedAt is not null) return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());

        recipe.DeletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return ServiceResult<RecipeResponse>.Ok(recipe.ToResponse());
    }

    private Task<Domain.Recipe?> LoadAggregate(Guid id, CancellationToken cancellationToken) =>
        db.Recipes
            .Include(r => r.Ingredients)
            .Include(r => r.Instructions)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
}
```

Create `Ingredo.Api/Recipes/RecipesController.cs`:

```csharp
using FluentValidation;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Recipes;

[ApiController]
[Route("api/v1/recipes")]
public sealed class RecipesController(
    IRecipeService service,
    IValidator<RecipeRequest> validator) : ControllerBase
{
    [HttpGet]
    public Task<List<RecipeSummaryResponse>> List(CancellationToken cancellationToken) =>
        service.ListAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> Create(RecipeRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.CreateAsync(request, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.Conflict => Conflict(),
            _ => CreatedAtAction(nameof(Get), new { id = result.Value!.Id }, result.Value),
        };
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, RecipeRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.UpdateAsync(id, request, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : NoContent();
    }
}
```

In `Ingredo.Api/Program.cs`, add imports:

```csharp
using FluentValidation;
using Ingredo.Api.Recipes;
```

and after the `AddDbContext` registration add:

```csharp
builder.Services.AddScoped<IRecipeService, RecipeService>();
builder.Services.AddValidatorsFromAssemblyContaining<RecipeRequestValidator>();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test`
Expected: PASS — 20 tests total (12 validator + 7 recipes API + 1 health).

- [ ] **Step 5: Lint-equivalent and commit**

```bash
dotnet build
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add recipe CRUD endpoints with service and integration tests"
```

---

### Task 7: End-to-end compose verification and docs

**Files:**
- Modify: `backend/README.md` (final instructions), root `docs/TESTING.md` (append manual checklist)

**Interfaces:**
- Consumes: everything.
- Produces: a verified slice, runnable by compose alone.

- [ ] **Step 1: Full automated pass**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build
dotnet test
```

Expected: zero warnings, 20/20 tests green.

- [ ] **Step 2: Compose end-to-end smoke**

```bash
cp -n .env.example .env
docker compose up -d --build
sleep 15
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/health          # expect 200
curl -s -X POST http://localhost:8080/api/v1/recipes \
  -H 'Content-Type: application/json' \
  -d '{"title":"Composed","servings":2,"ingredients":[{"name":"Egg","quantity":2,"scaling":"linear","sortOrder":0}],"instructions":[{"text":"Kok.","sortOrder":0}]}' \
  | grep -o '"title":"Composed"'                                               # expect match
curl -s http://localhost:8080/api/v1/recipes | grep -o '"title":"Composed"'    # expect match
docker compose down
```

Expected: health 200, both greps match. (This exercises the Dockerfile build, compose networking, env-driven credentials, and startup migrations against the composed postgres.)

- [ ] **Step 3: Finalize README**

Ensure `backend/README.md` matches reality (ports, commands, Scalar URL, the Docker-required note for tests, and a "migrations" section stating: dev applies on startup; production applies via `dotnet ef database update` explicitly). Adjust wording as needed — no new claims beyond what Steps 1–2 verified.

- [ ] **Step 4: Append the manual checklist to docs/TESTING.md**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Backend foundation (manual pass)

- `cd backend && cp -n .env.example .env && docker compose up --build` → api healthy at http://localhost:8080/health.
- Scalar UI at http://localhost:8080/scalar lists the five recipe endpoints.
- Create → list → get → update → delete a recipe through Scalar; deleted recipe vanishes from the list but re-creating its id returns 409 (soft-deleted rows keep their id).
- `docker compose down && docker compose up` → data survives (named volume).
- `dotnet test` from backend/ passes with Docker running (Testcontainers pulls postgres:17-alpine on first run).
```

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/README.md docs/TESTING.md
git commit -m "docs: finalize backend README and manual test checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (teardown + fresh solution → T1), 2 (.NET 10, lean layering, Npgsql-only → T1–T3), 3 (committed migrations, dev-only `Migrate()` → T3), 4 (domain mirror incl. lowercase scaling storage and query filter → T3), 5 (client ids + 409 → T6), 6 (endpoint surface → T6), 7 (validation rules + ProblemDetails shapes → T5–T6, middleware in T2), 8 (two-service compose, `.env` → T2), 9 (Testcontainers rig + test list → T4/T6), 10 (Serilog/health/Scalar → T2–T3). Rollout matches.
- **Known judgment calls:** the 409-on-recreate of a soft-deleted id is intentional (`IgnoreQueryFilters` in the create check — ids are permanent, which is the sync-friendly semantics; surfaced in the manual checklist). Delete returns `ServiceResult<RecipeResponse>` rather than a bare bool so the already-deleted no-op can still express Ok. The update flow relies on EF child-collection replacement (delete-orphans via required FK) — covered by the count assertions in the update test. `HealthTests`/`RecipesApiTests` each own an `ApiFactory` (one container per class, xUnit `IClassFixture`) — no cross-class data bleed; the list test therefore filters on its own `List-` prefix rather than asserting global list contents. Package pins carry the fallback rule from Global Constraints because .NET-10-era minor versions may have moved.
- **Type consistency check:** DTO record shapes match between validator tests (T5), integration tests (T6, `with` expressions require the record types), mappings, and controller signatures; `ServiceResult<T>` statuses used by controller switches are exactly the enum's three members; `ApiFactory` requires `public partial class Program` which T1 introduces and later Program edits preserve; JSON round-trips use System.Text.Json web defaults (camelCase) symmetrically on both sides so no naming-policy mismatch exists.
