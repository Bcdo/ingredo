using System.Security.Cryptography;

namespace Ingredo.Api.Households;

// Codes get read aloud across a kitchen — I/L/O/0/1 are excluded so a code
// survives handwriting and shouting. This format now backs three code
// kinds: household join codes, single-use invite codes, and single-use
// password-reset codes. The first two only gate joining/registration, but a
// live reset code is an account-takeover secret on an ANONYMOUS endpoint —
// it is authentication-equivalent. The 31^6 space alone would not be safe
// to expose anonymously at guessing speed; what actually defends it is the
// "auth" rate limit (10/min, keyed on CF-Connecting-IP — trustworthy only
// because the origin is tunnel-only, so that header can't be spoofed by an
// external caller), single-use consumption, and the 60-minute TTL.
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
