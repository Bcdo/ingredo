using Microsoft.AspNetCore.SignalR;

namespace Ingredo.Api.Realtime;

public sealed class SignalRChangeNotifier(
    IHubContext<SyncHub> hub,
    ILogger<SignalRChangeNotifier> logger) : IChangeNotifier
{
    public async Task NotifyHouseholdChangedAsync(
        Guid householdId, CancellationToken cancellationToken = default)
    {
        try
        {
            await hub.Clients
                .Group(SyncHub.GroupName(householdId))
                .SendAsync("changed", cancellationToken);
        }
        catch (Exception exception)
        {
            // A notification must never fail the write that triggered it.
            logger.LogWarning(
                exception, "Change notification failed for household {HouseholdId}", householdId);
        }
    }
}
