# API Notes

This file will evolve when the backend is created.

## API Principles

- The mobile app should never talk directly to the database.
- All backend data access goes through the ASP.NET Core API.
- All household data must be scoped by authenticated user permissions.
- The backend must verify that the user belongs to the household before returning or modifying data.

## Initial API Areas

```text
/auth
/households
/recipes
/meal-plan
/shopping-list
/sync
```

## Example Endpoints

### Auth

```http
POST /auth/register
POST /auth/login
POST /auth/refresh
```

### Households

```http
GET /households
POST /households
POST /households/{householdId}/invite
POST /households/join
```

### Recipes

```http
GET /recipes
GET /recipes/{id}
POST /recipes
PUT /recipes/{id}
DELETE /recipes/{id}
```

### Meal Plan

```http
GET /meal-plan?from=2026-06-01&to=2026-06-07
POST /meal-plan
PUT /meal-plan/{id}
DELETE /meal-plan/{id}
```

### Shopping List

```http
GET /shopping-list
POST /shopping-list/items
PUT /shopping-list/items/{id}
DELETE /shopping-list/items/{id}
```

### Sync

```http
POST /sync/push
GET /sync/pull?since=...
```

## Authentication

The mobile app authenticates as a user.

The app stores tokens using Expo Secure Store.

Example request:

```http
GET /shopping-list
Authorization: Bearer <access_token>
```

## Security Rule

The mobile app should not contain sensitive secrets.

Safe in mobile app:

- Public API URL
- Public analytics DSN
- Feature flags

Not safe in mobile app:

- Database password
- JWT signing secret
- Private API keys
- Email provider secret
- Payment provider secret
