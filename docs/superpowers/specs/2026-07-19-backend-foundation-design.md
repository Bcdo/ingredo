# Backend Foundation — Design Spec

**Date:** 2026-07-19
**Slice:** Phase 2 opener (roadmap: ASP.NET Core API, EF Core, PostgreSQL). First backend slice; the frontend does not consume this API until Phase 5 (sync) — the deliverable is a proven foundation, not a wired-up client.
**Scope:** Replace the template in `backend/` with a clean `Ingredo.Api` solution: PostgreSQL via docker-compose, real EF migrations, a test project with real-database integration tests, health + OpenAPI — and one domain done completely: the recipe aggregate with full CRUD.
**Builds on:** the frontend's recipe schema (`frontend/lib/db/schema.ts`) as the domain source of truth; selected patterns from the removed template (Dockerfile, global exception middleware, Serilog/health/Scalar setup).

## Goals

- A backend skeleton every later phase stacks on (auth in 3, households in 4, sync in 5) with the risky choices — database, migrations, test strategy, deployment shape — made and proven now.
- One vertical slice (recipes) exercised end-to-end: entity → migration → validation → controller → integration test, establishing the pattern the remaining domains copy.
- Sync-friendly by construction: client-minted Guid ids and soft deletes mirror the frontend's local schema so Phase 5 reconciliation compares like with like.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Authentication / users | Phase 3 (the template's BCrypt/User scaffolding is removed with it; auth gets designed properly, not inherited) |
| Meal-plan and shopping endpoints | Next backend slices; shopping/household semantics will be reshaped by Phase 4 anyway |
| Frontend consuming the API | Phase 5 (offline queue + sync) |
| nginx / reverse proxy / TLS | Deployment slice, when there is something to deploy |
| Redis / caching, pgAdmin | Removed with the template; reintroduced only against a measured need |
| CI pipeline | Separate concern; nothing in this slice presumes one |
| CQRS/MediatR/AutoMapper | Rejected in brainstorm — lean controllers + services; CQRS can arrive where sync genuinely needs command semantics |

## Key decisions

1. **Fresh solution; template removed in the opening commit.** `backend/` becomes `Ingredo.sln`, `Ingredo.Api/`, `Ingredo.Api.Tests/`, `docker-compose.yml`, `.env.example`, `README.md`. The template survives in git history (pushed); its Dockerfile (multi-stage, non-root, healthcheck), `GlobalExceptionMiddleware`, and Serilog/health/Scalar wiring are re-implemented in Ingredo namespaces rather than copied wholesale.
2. **.NET 10, controllers + services, PostgreSQL only.** Target `net10.0` (installed SDK, LTS). One EF provider — Npgsql — so migrations are honest; the template's three-provider switch is dropped. Layering: controller (HTTP shape) → service (domain logic, returns result types) → `AppDbContext`. FluentValidation on request DTOs; DTO↔entity mapping is hand-written.
3. **Real migrations from day one.** `dotnet ef migrations` artifacts are committed; startup applies `Database.Migrate()` in Development, never `EnsureCreated()`. Production applies migrations explicitly (documented in the backend README), keeping the door open for CI-driven migration later.
4. **Domain mirrors the frontend schema.** `Recipe` (Guid id; title required; description/notes nullable; servings int ≥ 1 default 4; `CreatedAt`/`UpdatedAt`/`DeletedAt` UTC timestamps, soft delete), `RecipeIngredient` (Guid id, FK cascade; name required; `Quantity` nullable `decimal`; `Unit` nullable free-text string — canonical codes are a frontend concern; `Scaling` enum `Linear|Fixed` stored as text; `SortOrder` int), `RecipeInstruction` (Guid id, FK cascade; text required; `SortOrder` int). A global query filter hides soft-deleted recipes; child rows ride along via the aggregate.
5. **Client-minted ids.** Create accepts the aggregate's Guids from the client (frontend already generates UUIDs locally); the server validates format and uniqueness (duplicate id → 409). Omitted ids are server-generated — both work, so the API is usable standalone *and* sync-ready.
6. **Endpoints (`/api/v1/recipes`, versioned path, JSON):**
   - `GET /` → list of recipe summaries (id, title, servings, updatedAt), soft-deleted excluded, ordered by `UpdatedAt` desc.
   - `GET /{id}` → full aggregate (ingredients by sortOrder, instructions by sortOrder); 404 when missing or soft-deleted.
   - `POST /` → create full aggregate; 201 + aggregate; 400 on validation failure; 409 on duplicate id.
   - `PUT /{id}` → full-aggregate replace (children reconciled by replacement — matching the frontend's edit semantics); bumps `UpdatedAt`; 404 when missing/soft-deleted.
   - `DELETE /{id}` → soft delete (sets `DeletedAt`); 204; idempotent (already-deleted → 204).
7. **Validation mirrors the frontend rules:** title non-empty; servings ≥ 1; ingredient name non-empty; quantity, when present, > 0; scaling must parse to the enum; sort orders non-negative. Validation failures return RFC 7807 `ValidationProblemDetails`; unhandled exceptions return a generic ProblemDetails via the global exception middleware (no stack traces outside Development).
8. **Infra: compose with two services.** `postgres:17` (named volume, healthcheck, credentials from `.env` — `.env.example` committed, `.env` git-ignored) and `api` (built from the Dockerfile, depends_on postgres-healthy). Local dev without Docker also works: `dotnet run` against the composed postgres.
9. **Tests run against real PostgreSQL.** `Ingredo.Api.Tests` (xUnit): integration tests via `WebApplicationFactory<Program>` + Testcontainers-PostgreSQL (one container per test run, migrations applied, db reset between test classes), covering CRUD round-trip, soft-delete semantics (list exclusion, 404 on get, idempotent delete), full-replace update, validation 400s, duplicate-id 409, and the health endpoint. Validator unit tests for the rule matrix. Docker is a test-time requirement (present on this machine).
10. **Observability floor:** Serilog console (+ rolling file in Development), `/health` including an EF/Npgsql check, OpenAPI document + Scalar UI in Development only.

## Components

### `backend/Ingredo.Api/`

- `Program.cs` — service wiring (DbContext, validators, controllers, Serilog, health checks, OpenAPI/Scalar dev-only), migration-on-startup in Development, middleware pipeline (exception middleware first). `public partial class Program` for the test factory.
- `Domain/` — `Recipe`, `RecipeIngredient`, `RecipeInstruction`, `ScalingMode` enum.
- `Data/AppDbContext.cs` — DbSets, fluent config (required fields, text enum conversion, cascade deletes, soft-delete query filter, `SortOrder` ordering left to queries), no seed data.
- `Data/Migrations/` — committed EF migrations.
- `Recipes/` — `RecipesController`, `RecipeService` (+ `IRecipeService`), request/response DTOs (`RecipeRequest`, `RecipeResponse`, `RecipeSummaryResponse`, child DTOs), `RecipeRequestValidator` (+ child validators), mapping extensions.
- `Common/` — `ServiceResult<T>` (NotFound/Conflict/Success discriminated result the controller translates to status codes), `GlobalExceptionMiddleware`.

### `backend/Ingredo.Api.Tests/`

- `Integration/` — `ApiFactory` (WebApplicationFactory + Testcontainers postgres, connection-string override), recipe CRUD/soft-delete/validation/conflict tests, health test.
- `Validators/` — rule-matrix unit tests.

### `backend/` root

- `Ingredo.sln`, `docker-compose.yml`, `.env.example`, `Dockerfile` (inside `Ingredo.Api/`), `README.md` (run, migrate, test instructions), `.gitignore` additions if needed.

## Error handling

`ServiceResult` outcomes map to 404/409/2xx in controllers; FluentValidation auto-400s with `ValidationProblemDetails`; everything else lands in `GlobalExceptionMiddleware` → 500 ProblemDetails, logged via Serilog. No throwing across the controller boundary for expected outcomes.

## Testing

Covered in decision 9. Definition of green for every commit: `dotnet build` warning-clean, `dotnet test` green (integration tests included), `docker compose up` yields a healthy `api` (`/health` 200) — the compose check runs at slice end and after infra-touching tasks.

## Rollout

Feature branch `feature/backend-foundation` off `develop`. Opening commit removes the template; subsequent tasks build the solution up. Frontend untouched; theme branches unaffected. Merged per the usual flow.
