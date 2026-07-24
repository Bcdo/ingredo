using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Ingredo.Api.Realtime;

// Empty surface: clients only listen. The entire wire contract is the
// argument-less "changed" message sent to a household group.
[Authorize]
public sealed class SyncHub : Hub
{
    public static string GroupName(Guid householdId) => $"household:{householdId}";

    public override async Task OnConnectedAsync()
    {
        var claim = Context.User?.FindFirst(TokenService.HouseholdClaim)?.Value;
        if (Guid.TryParse(claim, out var householdId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(householdId));
        }
        await base.OnConnectedAsync();
    }
}
