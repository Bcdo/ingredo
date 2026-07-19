using FluentValidation;
using Ingredo.Api.Domain;

namespace Ingredo.Api.Recipes;

// Mirrors the frontend's form rules (frontend/lib/form.ts): title required,
// servings ≥ 1, quantity positive when present, closed scaling set.
public sealed class RecipeRequestValidator : AbstractValidator<RecipeRequest>
{
    public RecipeRequestValidator()
    {
        RuleFor(r => r.Title).Must(title => !string.IsNullOrWhiteSpace(title))
            .WithMessage("Title must not be empty.")
            .MaximumLength(500);
        RuleFor(r => r.Servings).GreaterThanOrEqualTo(1);
        RuleForEach(r => r.Ingredients).SetValidator(new IngredientRequestValidator());
        RuleForEach(r => r.Instructions).SetValidator(new InstructionRequestValidator());
    }
}

public sealed class IngredientRequestValidator : AbstractValidator<IngredientRequest>
{
    public IngredientRequestValidator()
    {
        RuleFor(i => i.Name).Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Ingredient name must not be empty.")
            .MaximumLength(500);
        RuleFor(i => i.Quantity).GreaterThan(0).When(i => i.Quantity.HasValue);
        RuleFor(i => i.Scaling)
            .Must(scaling =>
                Enum.TryParse<ScalingMode>(scaling, true, out var parsed) && Enum.IsDefined(parsed))
            .WithMessage("Scaling must be 'linear' or 'fixed'.");
        RuleFor(i => i.SortOrder).GreaterThanOrEqualTo(0);
    }
}

public sealed class InstructionRequestValidator : AbstractValidator<InstructionRequest>
{
    public InstructionRequestValidator()
    {
        RuleFor(i => i.Text).Must(text => !string.IsNullOrWhiteSpace(text))
            .WithMessage("Instruction text must not be empty.");
        RuleFor(i => i.SortOrder).GreaterThanOrEqualTo(0);
    }
}
