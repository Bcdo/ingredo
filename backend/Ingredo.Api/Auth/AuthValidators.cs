using FluentValidation;

namespace Ingredo.Api.Auth;

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().EmailAddress().MaximumLength(320);
        RuleFor(r => r.InviteCode).NotEmpty();
        // Length only — no composition rules (NIST-style guidance).
        RuleFor(r => r.Password).NotEmpty().MinimumLength(8).MaximumLength(128);
        RuleFor(r => r.DisplayName)
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Display name must not be empty.")
            .MaximumLength(100);
        When(r => r.HouseholdName is not null, () =>
        {
            RuleFor(r => r.HouseholdName!)
                .Must(name => !string.IsNullOrWhiteSpace(name))
                .WithMessage("Household name must not be empty.")
                .MaximumLength(200);
        });
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty();
        RuleFor(r => r.Password).NotEmpty();
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator()
    {
        RuleFor(r => r.RefreshToken).NotEmpty();
    }
}
