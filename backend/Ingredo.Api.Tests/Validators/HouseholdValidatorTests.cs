using FluentValidation.TestHelper;
using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Validators;

public class HouseholdValidatorTests
{
    private readonly RenameRequestValidator _rename = new();
    private readonly JoinRequestValidator _join = new();

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rename_rejects_blank_names(string name)
    {
        _rename.TestValidate(new RenameRequest(name)).ShouldHaveValidationErrorFor(r => r.Name);
    }

    [Fact]
    public void Rename_accepts_boundary_and_rejects_overlong()
    {
        _rename.TestValidate(new RenameRequest(new string('a', 200)))
            .ShouldNotHaveAnyValidationErrors();
        _rename.TestValidate(new RenameRequest(new string('a', 201)))
            .ShouldHaveValidationErrorFor(r => r.Name);
    }

    [Fact]
    public void Join_requires_a_code()
    {
        _join.TestValidate(new JoinRequest("")).ShouldHaveValidationErrorFor(r => r.Code);
        _join.TestValidate(new JoinRequest("KJN-4MM")).ShouldNotHaveAnyValidationErrors();
    }
}
