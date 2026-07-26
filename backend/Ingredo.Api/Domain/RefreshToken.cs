namespace Ingredo.Api.Domain;

// The opaque token value is returned to the client exactly once and never
// stored — only its SHA-256 hash. FamilyId groups every rotation descended
// from one login/registration so reuse detection can revoke the whole line.
public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid FamilyId { get; set; }

    // The device's active household: refresh mints the access-token claim
    // from this, so two devices (families) on one account can sit in
    // different households. Rotation copies it; switch rotates the family.
    public Guid HouseholdId { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
