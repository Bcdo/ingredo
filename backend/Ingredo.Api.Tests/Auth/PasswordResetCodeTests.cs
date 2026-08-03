using Ingredo.Api.Domain;

namespace Ingredo.Api.Tests.Auth;

public class PasswordResetCodeTests
{
    [Fact]
    public void HashCode_MatchesTheOperatorScriptEncoding() =>
        Assert.Equal(
            "8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4",
            PasswordResetCode.HashCode("ABC234"));
}
