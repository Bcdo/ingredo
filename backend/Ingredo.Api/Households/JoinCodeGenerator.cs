using System.Security.Cryptography;

namespace Ingredo.Api.Households;

// Join codes get read aloud across a kitchen — I/L/O/0/1 are excluded so a
// code survives handwriting and shouting. Codes gate joining only, never
// authentication; the 31^6 space behind an authenticated endpoint is not
// practically enumerable.
public static class JoinCodeGenerator
{
    public const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    public const int Length = 6;

    public static string NewCode()
    {
        var chars = new char[Length];
        for (var i = 0; i < Length; i++)
        {
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }
        return new string(chars);
    }

    public static string? Canonicalize(string input)
    {
        var cleaned = new string(
            input.Trim().ToUpperInvariant().Where(c => c is not ('-' or ' ')).ToArray());
        if (cleaned.Length != Length) return null;
        return cleaned.All(Alphabet.Contains) ? cleaned : null;
    }

    public static string FormatForDisplay(string canonical) =>
        $"{canonical[..3]}-{canonical[3..]}";
}
