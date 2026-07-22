namespace Ingredo.Api.Domain;

public class Recipe
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public int Servings { get; set; } = 4;
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long SyncSeq { get; set; }

    public List<RecipeIngredient> Ingredients { get; set; } = [];
    public List<RecipeInstruction> Instructions { get; set; } = [];
}
