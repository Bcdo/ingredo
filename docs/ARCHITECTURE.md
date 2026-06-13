# Architecture

## Current Direction

Ingredo uses a monorepo with two main applications:

```text
frontend/  Expo mobile app
backend/   ASP.NET Core API
```

The frontend should work locally first using SQLite. The backend will be added after the local user experience is validated.

## Phase 1 Architecture

```text
Expo App
↓
SQLite
```

No backend.

## Production Architecture

```text
Expo App
↓
ASP.NET Core API
↓
Entity Framework Core
↓
PostgreSQL
```

## Offline-First Model

The app should treat local storage as the immediate source of truth.

Expected flow:

```text
User action
↓
Write to local SQLite
↓
Update UI immediately
↓
Queue sync action
↓
Sync with backend when online
```

## Suggested Entities

### User

- Id
- Email
- DisplayName
- CreatedAt

### Household

- Id
- Name
- CreatedAt

### HouseholdMember

- Id
- UserId
- HouseholdId
- Role
- CreatedAt

### Recipe

- Id
- HouseholdId
- Title
- Description
- Servings
- Notes
- CreatedAt
- UpdatedAt
- DeletedAt

### RecipeIngredient

- Id
- RecipeId
- Name
- Quantity
- Unit
- Category
- SortOrder

### RecipeInstruction

- Id
- RecipeId
- Text
- SortOrder

### MealPlanEntry

- Id
- HouseholdId
- RecipeId
- Date
- MealType
- Servings

### ShoppingListItem

- Id
- HouseholdId
- Name
- Quantity
- Unit
- Category
- SourceType
- SourceRecipeId
- Checked
- CreatedAt
- UpdatedAt
- DeletedAt

## Sync Fields

Entities that sync should include:

- Id
- HouseholdId
- CreatedAt
- UpdatedAt
- DeletedAt
- Version

Client-side records may also include:

- SyncStatus
- LastSyncedAt
- ClientId

## Conflict Resolution

Initial strategy:

- Last write wins
