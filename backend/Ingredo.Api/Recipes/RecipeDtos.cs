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
