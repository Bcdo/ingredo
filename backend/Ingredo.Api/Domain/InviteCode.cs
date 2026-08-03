namespace Ingredo.Api.Domain;

// Single-use beta gate: one code admits exactly one registration. UsedAt is
// the concurrency token, so two racing registrations cannot both stamp the
// same code. Deliberately NO foreign key on UsedByUserId (RefreshToken
// precedent): audit bookkeeping must never block or cascade user deletion.
public class InviteCode
{
    public Guid Id { get; set; }
    public required string Code { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public Guid? UsedByUserId { get; set; }
}
