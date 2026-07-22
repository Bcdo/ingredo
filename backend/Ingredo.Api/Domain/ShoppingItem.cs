namespace Ingredo.Api.Domain;

// A dumb replicated row store: all shopping behavior (merge-on-add, shelf
// grouping, purchase flows) is client logic. Sources is an opaque JSON
// string the client owns; the server never parses it.
public class ShoppingItem
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public decimal? Quantity { get; set; }
    public string? Unit { get; set; }
    public string Sources { get; set; } = "[]";
    public ShoppingItemStatus Status { get; set; } = ShoppingItemStatus.Active;
    public DateTimeOffset? PurchasedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long SyncSeq { get; set; }
}
