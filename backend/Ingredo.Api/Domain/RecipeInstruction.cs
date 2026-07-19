namespace Ingredo.Api.Domain;

public class RecipeInstruction
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }
    public required string Text { get; set; }
    public int SortOrder { get; set; }
}
