namespace Ingredo.Api.Domain;

public class RecipeIngredient
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }
    public required string Name { get; set; }
    public decimal? Quantity { get; set; }
    public string? Unit { get; set; }
    public ScalingMode Scaling { get; set; } = ScalingMode.Linear;
    public int SortOrder { get; set; }
}
