namespace Ingredo.Api.Domain;

public class HouseholdMember
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid HouseholdId { get; set; }
    public HouseholdRole Role { get; set; } = HouseholdRole.Member;
    public DateTimeOffset CreatedAt { get; set; }
}
