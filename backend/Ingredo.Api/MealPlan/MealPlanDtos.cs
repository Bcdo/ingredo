namespace Ingredo.Api.MealPlan;

public sealed record MealPlanEntryRequest(
    Guid? Id,
    DateOnly Date,
    Guid RecipeId,
    int Servings,
    int SortOrder);

public sealed record MealPlanEntryResponse(
    Guid Id,
    DateOnly Date,
    Guid RecipeId,
    int Servings,
    int SortOrder,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
