namespace Ingredo.Api.Sync;

// Sync rows speak the frontend's native dialect: epoch-millisecond
// timestamps (Date.now()) and yyyy-MM-dd date strings. This is the ONLY
// surface where client-authored timestamps enter the server.
public sealed record SyncIngredientRow(Guid Id, string Name, decimal? Quantity, string? Unit, string Scaling, int SortOrder);

public sealed record SyncInstructionRow(Guid Id, string Text, int SortOrder);

public sealed record SyncRecipeRow(
    Guid Id,
    string Title,
    string? Description,
    int Servings,
    string? Notes,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt,
    List<SyncIngredientRow> Ingredients,
    List<SyncInstructionRow> Instructions);

public sealed record SyncMealPlanRow(
    Guid Id,
    string Date,
    Guid RecipeId,
    int Servings,
    int SortOrder,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt);

public sealed record SyncShoppingRow(
    Guid Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    long? PurchasedAt,
    long CreatedAt,
    long UpdatedAt,
    long? DeletedAt);

public sealed record SyncPullResponse(
    List<SyncRecipeRow> Recipes,
    List<SyncMealPlanRow> MealPlanEntries,
    List<SyncShoppingRow> ShoppingItems,
    long Cursor);

public sealed record SyncPushRequest(
    List<SyncRecipeRow>? Recipes,
    List<SyncMealPlanRow>? MealPlanEntries,
    List<SyncShoppingRow>? ShoppingItems);

public sealed record SyncPushResponse(Dictionary<Guid, string> Results, long Cursor);
