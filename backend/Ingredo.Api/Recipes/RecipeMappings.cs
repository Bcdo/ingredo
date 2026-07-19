using Ingredo.Api.Domain;

namespace Ingredo.Api.Recipes;

public static class RecipeMappings
{
    public static Recipe ToEntity(this RecipeRequest request, DateTimeOffset now) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description,
            Servings = request.Servings,
            Notes = request.Notes,
            CreatedAt = now,
            UpdatedAt = now,
            Ingredients = request.Ingredients.Select(i => i.ToEntity()).ToList(),
            Instructions = request.Instructions.Select(i => i.ToEntity()).ToList(),
        };

    public static RecipeIngredient ToEntity(this IngredientRequest request) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Name = request.Name.Trim(),
            Quantity = request.Quantity,
            Unit = request.Unit,
            Scaling = Enum.Parse<ScalingMode>(request.Scaling, true),
            SortOrder = request.SortOrder,
        };

    public static RecipeInstruction ToEntity(this InstructionRequest request) =>
        new()
        {
            Id = request.Id ?? Guid.NewGuid(),
            Text = request.Text.Trim(),
            SortOrder = request.SortOrder,
        };

    public static RecipeResponse ToResponse(this Recipe recipe) =>
        new(
            recipe.Id,
            recipe.Title,
            recipe.Description,
            recipe.Servings,
            recipe.Notes,
            recipe.CreatedAt,
            recipe.UpdatedAt,
            recipe.Ingredients
                .OrderBy(i => i.SortOrder)
                .Select(i => new IngredientResponse(
                    i.Id, i.Name, i.Quantity, i.Unit,
                    i.Scaling.ToString().ToLowerInvariant(), i.SortOrder))
                .ToList(),
            recipe.Instructions
                .OrderBy(i => i.SortOrder)
                .Select(i => new InstructionResponse(i.Id, i.Text, i.SortOrder))
                .ToList());

    public static RecipeSummaryResponse ToSummary(this Recipe recipe) =>
        new(recipe.Id, recipe.Title, recipe.Servings, recipe.UpdatedAt);
}
