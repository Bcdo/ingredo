using System.Security.Cryptography;
using System.Text;

namespace Ingredo.Api.Domain;

// Operator-delivered password reset: single-use, 60-minute TTL. Only the
// SHA-256 of the code is stored — a live reset code is an account-takeover
// secret, unlike invite codes. UsedAt is the concurrency token (InviteCode
// precedent); UserId has deliberately NO foreign key (RefreshToken
// precedent: bookkeeping must never block or cascade user deletion).
public class PasswordResetCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string CodeHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }

    // Lowercase hex so the operator script's `sha256sum` output matches
    // byte-for-byte. Test vector: HashCode("ABC234") =
    // "8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4".
    public static string HashCode(string canonicalCode) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalCode)));
}
