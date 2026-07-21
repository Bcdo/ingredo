namespace Ingredo.Api.Shopping;

public sealed record ShoppingItemRequest(
    Guid? Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    DateTimeOffset? PurchasedAt);

public sealed record ShoppingItemResponse(
    Guid Id,
    string Name,
    string NormalizedName,
    decimal? Quantity,
    string? Unit,
    string Sources,
    string Status,
    DateTimeOffset? PurchasedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
