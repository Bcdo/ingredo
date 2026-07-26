using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Households;

// The PLURAL surface: a user's memberships. The singular api/v1/household
// keeps acting on the token's active household.
[ApiController]
[Route("api/v1/households")]
[Authorize]
public sealed class HouseholdsController(
    IHouseholdService service,
    IValidator<CreateHouseholdRequest> createValidator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);
    private Guid UserId => Guid.Parse(User.FindFirstValue("sub")!);

    [HttpPost]
    public async Task<IActionResult> Create(
        CreateHouseholdRequest request, CancellationToken cancellationToken)
    {
        var validation = await createValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }
        return Ok(await service.CreateAsync(UserId, request.Name, cancellationToken));
    }

    [HttpGet]
    public async Task<List<HouseholdSummaryResponse>> List(CancellationToken cancellationToken) =>
        await service.ListAsync(UserId, HouseholdId, cancellationToken);

    [HttpPost("switch")]
    public async Task<IActionResult> Switch(
        SwitchHouseholdRequest request, CancellationToken cancellationToken)
    {
        var result = await service.SwitchAsync(UserId, request.HouseholdId, cancellationToken);
        return result.Status == Common.ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }
}
