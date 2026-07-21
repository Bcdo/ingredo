namespace Ingredo.Api.Domain;

public class Household
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string JoinCode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
