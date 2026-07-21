namespace Ingredo.Api.Domain;

public class MealPlanEntry
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
    public DateOnly Date { get; set; }
    public Guid RecipeId { get; set; }
    public int Servings { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
