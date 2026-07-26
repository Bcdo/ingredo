namespace Ingredo.Api.Households;

public sealed record MemberResponse(
    Guid UserId,
    string DisplayName,
    string Role,
    DateTimeOffset JoinedAt);

public sealed record HouseholdResponse(
    Guid Id,
    string Name,
    string JoinCode,
    List<MemberResponse> Members);

public sealed record RenameRequest(string Name);

public sealed record JoinRequest(string Code);

public sealed record HouseholdSummaryResponse(
    Guid Id,
    string Name,
    string JoinCode,
    int MemberCount,
    string Role,
    bool IsActive);

public sealed record CreateHouseholdRequest(string Name);

public sealed record SwitchHouseholdRequest(Guid HouseholdId);
