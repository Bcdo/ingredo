using Ingredo.Api.Auth;
using Ingredo.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Common;

// An access token can outlive its household: a sole-member join-away deletes
// the old household while issued tokens still carry its claim for up to the
// token lifetime. Fail those requests clean — 401 — so clients refresh and
// get tokens for their current membership. Also catches malformed claims,
// so downstream Guid.Parse accessors are safe by construction. Anonymous
// endpoints (health, login, register, refresh, logout) pass through
// untouched; refresh being anonymous is the deliberate escape hatch.
public sealed class HouseholdGuardMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        // Skip guard for endpoints that don't require authorization
        var endpoint = context.GetEndpoint();
        var requiresAuth = endpoint?.Metadata.GetOrderedMetadata<IAuthorizeData>().Any() ?? false;

        if (context.User.Identity?.IsAuthenticated == true && requiresAuth)
        {
            var claim = context.User.FindFirst(TokenService.HouseholdClaim)?.Value;
            if (!Guid.TryParse(claim, out var householdId)
                || !await db.Households.AnyAsync(h => h.Id == householdId, context.RequestAborted))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }

        await next(context);
    }
}
