using FluentValidation.TestHelper;
using Ingredo.Api.Auth;

namespace Ingredo.Api.Tests.Validators;

public class AuthValidatorTests
{
    private readonly RegisterRequestValidator _register = new();
    private readonly LoginRequestValidator _login = new();
    private readonly RefreshRequestValidator _refresh = new();

    private static RegisterRequest ValidRegister() => new("kari@example.no", "passord123", "Kari");

    [Fact]
    public void Accepts_a_valid_registration()
    {
        _register.TestValidate(ValidRegister()).ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-email")]
    [InlineData("kari@")]
    public void Rejects_bad_emails(string email)
    {
        _register.TestValidate(ValidRegister() with { Email = email })
            .ShouldHaveValidationErrorFor(r => r.Email);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1234567")]
    public void Rejects_short_passwords(string password)
    {
        _register.TestValidate(ValidRegister() with { Password = password })
            .ShouldHaveValidationErrorFor(r => r.Password);
    }

    [Fact]
    public void Accepts_an_eight_character_password_without_composition_rules()
    {
        _register.TestValidate(ValidRegister() with { Password = "aaaaaaaa" })
            .ShouldNotHaveAnyValidationErrors();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_display_names(string name)
    {
        _register.TestValidate(ValidRegister() with { DisplayName = name })
            .ShouldHaveValidationErrorFor(r => r.DisplayName);
    }

    [Fact]
    public void Rejects_overlong_display_name_and_accepts_boundary()
    {
        _register.TestValidate(ValidRegister() with { DisplayName = new string('a', 101) })
            .ShouldHaveValidationErrorFor(r => r.DisplayName);
        _register.TestValidate(ValidRegister() with { DisplayName = new string('a', 100) })
            .ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Login_and_refresh_require_their_fields()
    {
        _login.TestValidate(new LoginRequest("", "")).ShouldHaveValidationErrorFor(r => r.Email);
        _login.TestValidate(new LoginRequest("", "")).ShouldHaveValidationErrorFor(r => r.Password);
        _refresh.TestValidate(new RefreshRequest("")).ShouldHaveValidationErrorFor(r => r.RefreshToken);
    }
}
