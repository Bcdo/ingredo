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
