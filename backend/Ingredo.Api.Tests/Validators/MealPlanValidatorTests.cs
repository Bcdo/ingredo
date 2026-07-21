using FluentValidation.TestHelper;
using Ingredo.Api.MealPlan;

namespace Ingredo.Api.Tests.Validators;

public class MealPlanValidatorTests
{
    private readonly MealPlanEntryRequestValidator _validator = new();

    private static MealPlanEntryRequest Valid() =>
        new(null, new DateOnly(2026, 7, 21), Guid.NewGuid(), 4, 0);

    [Fact]
    public void Accepts_a_valid_entry()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    public void Rejects_non_positive_servings(int servings)
    {
        _validator.TestValidate(Valid() with { Servings = servings })
            .ShouldHaveValidationErrorFor(r => r.Servings);
    }

    [Fact]
    public void Rejects_negative_sort_order_and_accepts_zero()
    {
        _validator.TestValidate(Valid() with { SortOrder = -1 })
            .ShouldHaveValidationErrorFor(r => r.SortOrder);
        _validator.TestValidate(Valid() with { SortOrder = 0 }).ShouldNotHaveAnyValidationErrors();
    }
}
