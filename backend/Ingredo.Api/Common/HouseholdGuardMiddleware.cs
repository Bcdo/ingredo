using Ingredo.Api.Auth;
using Ingredo.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Common;

// An access token can outlive its household MEMBERSHIP: leaving a household
// removes the membership row while issued tokens still carry its claim for
// up to the token lifetime — whether or not the household itself survives.
// If you were the last member, the household is deleted with you; if others
// remain, the household lives on without you. Either way the token must die
// all the same. Fail those requests
// clean — 401 — so clients refresh and get tokens for their current
// membership. Also catches malformed claims, so downstream Guid.Parse
// accessors are safe by construction. Anonymous endpoints (health, login,
// register, refresh, logout) pass through untouched; refresh being
// anonymous is the deliberate escape hatch.
public sealed class HouseholdGuardMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        // Fail closed: only endpoints that explicitly allow anonymous access
        // are exempt. A future endpoint that forgets [Authorize] is still
        // guarded; the anonymous refresh escape hatch is explicit.
        var endpoint = context.GetEndpoint();
        var allowsAnonymous =
            endpoint?.Metadata.GetMetadata<IAllowAnonymous>() is not null;

        if (!allowsAnonymous && context.User.Identity?.IsAuthenticated == true)
        {
            var claim = context.User.FindFirst(TokenService.HouseholdClaim)?.Value;
            var sub = context.User.FindFirst("sub")?.Value;
            if (!Guid.TryParse(claim, out var householdId)
                || !Guid.TryParse(sub, out var userId)
                || !await db.HouseholdMembers.AnyAsync(
                    m => m.HouseholdId == householdId && m.UserId == userId,
                    context.RequestAborted))
            {
                context.Response.Headers.WWWAuthenticate = "Bearer";
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }

        await next(context);
    }
}
