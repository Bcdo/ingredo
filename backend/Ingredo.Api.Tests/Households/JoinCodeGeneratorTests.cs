using Ingredo.Api.Households;

namespace Ingredo.Api.Tests.Households;

public class JoinCodeGeneratorTests
{
    [Fact]
    public void Generated_codes_are_six_alphabet_characters_and_vary()
    {
        var seen = new HashSet<string>();
        for (var i = 0; i < 500; i++)
        {
            var code = JoinCodeGenerator.NewCode();
            Assert.Equal(6, code.Length);
            Assert.All(code, c => Assert.Contains(c, JoinCodeGenerator.Alphabet));
            seen.Add(code);
        }
        Assert.True(seen.Count > 490); // collisions in 500 draws from 31^6 are ~impossible
    }

    [Theory]
    [InlineData("KJN4MM", "KJN4MM")]
    [InlineData("kjn-4mm", "KJN4MM")]
    [InlineData("  kjn 4mm ", "KJN4MM")]
    [InlineData("KJN-4MM", "KJN4MM")]
    public void Canonicalize_is_forgiving(string input, string expected)
    {
        Assert.Equal(expected, JoinCodeGenerator.Canonicalize(input));
    }

    [Theory]
    [InlineData("")]
    [InlineData("AB")]
    [InlineData("KJN4MMX")]
    [InlineData("KJN-4M!")]
    [InlineData("KJN-4LM")] // L is not in the alphabet
    [InlineData("KJN-40M")] // 0 is not in the alphabet
    public void Canonicalize_rejects_invalid_input(string input)
    {
        Assert.Null(JoinCodeGenerator.Canonicalize(input));
    }

    [Fact]
    public void Display_format_inserts_the_hyphen()
    {
        Assert.Equal("KJN-4MM", JoinCodeGenerator.FormatForDisplay("KJN4MM"));
    }

    [Fact]
    public void Alphabet_excludes_confusable_characters()
    {
        Assert.DoesNotContain('I', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('L', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('O', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('0', JoinCodeGenerator.Alphabet);
        Assert.DoesNotContain('1', JoinCodeGenerator.Alphabet);
    }
}
