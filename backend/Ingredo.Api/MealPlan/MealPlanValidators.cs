using FluentValidation;

namespace Ingredo.Api.MealPlan;

public sealed class MealPlanEntryRequestValidator : AbstractValidator<MealPlanEntryRequest>
{
    public MealPlanEntryRequestValidator()
    {
        RuleFor(r => r.Servings).GreaterThanOrEqualTo(1);
        RuleFor(r => r.SortOrder).GreaterThanOrEqualTo(0);
    }
}
