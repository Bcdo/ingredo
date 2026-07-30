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
    // Deliberately NO foreign key: a last-member leave deletes the
    // household and must not cascade into (or be blocked by) token rows.
    // Refresh treats the value as a hint — it resolves the household
    // through the user's MEMBERSHIP and falls back to the oldest
    // membership when this points at a household the user left or that
    // no longer exists.
    public Guid HouseholdId { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
