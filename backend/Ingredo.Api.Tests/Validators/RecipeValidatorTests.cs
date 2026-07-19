using FluentValidation.TestHelper;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Validators;

public class RecipeValidatorTests
{
    private readonly RecipeRequestValidator _validator = new();

    private static RecipeRequest Valid() =>
        new(
            Id: null,
            Title: "Pannekaker",
            Description: "Klassiske",
            Servings: 4,
            Notes: null,
            Ingredients:
            [
                new IngredientRequest(null, "Hvetemel", 400, "g", "linear", 0),
                new IngredientRequest(null, "Salt", null, null, "fixed", 1),
            ],
            Instructions: [new InstructionRequest(null, "Visp sammen.", 0)]);

    [Fact]
    public void Accepts_a_valid_request()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_title(string title)
    {
        var result = _validator.TestValidate(Valid() with { Title = title });
        result.ShouldHaveValidationErrorFor(r => r.Title);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_non_positive_servings(int servings)
    {
        var result = _validator.TestValidate(Valid() with { Servings = servings });
        result.ShouldHaveValidationErrorFor(r => r.Servings);
    }

    [Fact]
    public void Rejects_blank_ingredient_name_and_non_positive_quantity()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, " ", 0, "g", "linear", 0)],
        };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor("Ingredients[0].Name");
        result.ShouldHaveValidationErrorFor("Ingredients[0].Quantity");
    }

    [Fact]
    public void Accepts_missing_quantity_and_unit()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Salt og pepper", null, null, "linear", 0)],
        };
        _validator.TestValidate(request).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("cubic")]
    [InlineData("")]
    [InlineData("LINEARISH")]
    [InlineData("2")]
    [InlineData("-1")]
    public void Rejects_unknown_scaling(string scaling)
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", scaling, 0)],
        };
        _validator.TestValidate(request).ShouldHaveValidationErrorFor("Ingredients[0].Scaling");
    }

    [Fact]
    public void Accepts_scaling_case_insensitively()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", "Fixed", 0)],
        };
        _validator.TestValidate(request).ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Rejects_blank_instruction_and_negative_sort_orders()
    {
        var request = Valid() with
        {
            Ingredients = [new IngredientRequest(null, "Mel", 1, "dl", "linear", -1)],
            Instructions = [new InstructionRequest(null, "", -2)],
        };
        var result = _validator.TestValidate(request);
        result.ShouldHaveValidationErrorFor("Ingredients[0].SortOrder");
        result.ShouldHaveValidationErrorFor("Instructions[0].Text");
        result.ShouldHaveValidationErrorFor("Instructions[0].SortOrder");
    }
}
