using FluentValidation;
using Ingredo.Api.Domain;

namespace Ingredo.Api.Shopping;

public sealed class ShoppingItemRequestValidator : AbstractValidator<ShoppingItemRequest>
{
    public ShoppingItemRequestValidator()
    {
        RuleFor(r => r.Name)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Name must not be empty.")
            .MaximumLength(500);
        RuleFor(r => r.NormalizedName)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Normalized name must not be empty.")
            .MaximumLength(500);
        RuleFor(r => r.Quantity).GreaterThan(0).When(r => r.Quantity.HasValue);
        RuleFor(r => r.Unit).MaximumLength(50);
        RuleFor(r => r.Sources).NotEmpty().MaximumLength(4000);
        RuleFor(r => r.Status)
            .Must(status =>
                Enum.TryParse<ShoppingItemStatus>(status, true, out var parsed)
                && Enum.IsDefined(parsed))
            .WithMessage("Status must be 'active' or 'purchased'.");
    }
}
