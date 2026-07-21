using FluentValidation.TestHelper;
using Ingredo.Api.Shopping;

namespace Ingredo.Api.Tests.Validators;

public class ShoppingValidatorTests
{
    private readonly ShoppingItemRequestValidator _validator = new();

    private static ShoppingItemRequest Valid() =>
        new(null, "Melk", "melk", 1000, "ml", "[]", "active", null);

    [Fact]
    public void Accepts_a_valid_item_and_a_purchased_variant()
    {
        _validator.TestValidate(Valid()).ShouldNotHaveAnyValidationErrors();
        _validator.TestValidate(Valid() with
        {
            Status = "Purchased",
            PurchasedAt = DateTimeOffset.UtcNow,
        }).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_names(string value)
    {
        var result = _validator.TestValidate(Valid() with { Name = value, NormalizedName = value });
        result.ShouldHaveValidationErrorFor(r => r.Name);
        result.ShouldHaveValidationErrorFor(r => r.NormalizedName);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_non_positive_quantity_but_accepts_null(decimal quantity)
    {
        _validator.TestValidate(Valid() with { Quantity = quantity })
            .ShouldHaveValidationErrorFor(r => r.Quantity);
        _validator.TestValidate(Valid() with { Quantity = null }).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("bought")]
    [InlineData("")]
    [InlineData("2")]
    [InlineData("1")]
    [InlineData("0")]
    public void Rejects_unknown_status(string status)
    {
        _validator.TestValidate(Valid() with { Status = status })
            .ShouldHaveValidationErrorFor(r => r.Status);
    }

    [Fact]
    public void Rejects_missing_sources()
    {
        _validator.TestValidate(Valid() with { Sources = "" })
            .ShouldHaveValidationErrorFor(r => r.Sources);
    }
}
