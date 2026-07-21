using FluentValidation;

namespace Ingredo.Api.Households;

public sealed class RenameRequestValidator : AbstractValidator<RenameRequest>
{
    public RenameRequestValidator()
    {
        RuleFor(r => r.Name)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Household name must not be empty.")
            .MaximumLength(200);
    }
}

public sealed class JoinRequestValidator : AbstractValidator<JoinRequest>
{
    public JoinRequestValidator()
    {
        RuleFor(r => r.Code).NotEmpty();
    }
}
