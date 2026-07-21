using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Households;

[ApiController]
[Route("api/v1/household")]
[Authorize]
public sealed class HouseholdController(
    IHouseholdService service,
    IValidator<RenameRequest> renameValidator,
    IValidator<JoinRequest> joinValidator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);
    private Guid UserId => Guid.Parse(User.FindFirstValue("sub")!);

    [HttpGet]
    public async Task<HouseholdResponse> Get(CancellationToken cancellationToken) =>
        await service.GetAsync(HouseholdId, cancellationToken);

    [HttpPut]
    public async Task<IActionResult> Rename(RenameRequest request, CancellationToken cancellationToken)
    {
        var validation = await renameValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        return Ok(await service.RenameAsync(HouseholdId, request.Name, cancellationToken));
    }

    [HttpPost("regenerate-code")]
    public async Task<HouseholdResponse> RegenerateCode(CancellationToken cancellationToken) =>
        await service.RegenerateCodeAsync(HouseholdId, cancellationToken);

    [HttpPost("join")]
    public async Task<IActionResult> Join(JoinRequest request, CancellationToken cancellationToken)
    {
        var validation = await joinValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.JoinAsync(UserId, HouseholdId, request.Code, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.NotFound => NotFound(),
            ServiceStatus.Conflict => Conflict(),
            _ => Ok(result.Value),
        };
    }

    [HttpPost("leave")]
    public async Task<IActionResult> Leave(CancellationToken cancellationToken)
    {
        var result = await service.LeaveAsync(UserId, HouseholdId, cancellationToken);
        return result.Status == ServiceStatus.Conflict ? Conflict() : Ok(result.Value);
    }
}
