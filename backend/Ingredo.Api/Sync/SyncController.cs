using System.Security.Claims;
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Sync;

[ApiController]
[Route("api/v1/sync")]
[Authorize]
public sealed class SyncController(ISyncService service) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);

    [HttpGet("changes")]
    public Task<SyncPullResponse> Changes(
        [FromQuery] long since, CancellationToken cancellationToken) =>
        service.PullAsync(HouseholdId, since, cancellationToken);
}
