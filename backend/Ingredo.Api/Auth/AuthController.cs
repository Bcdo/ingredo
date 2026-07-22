using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Auth;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(
    IAuthService service,
    IValidator<RegisterRequest> registerValidator,
    IValidator<LoginRequest> loginValidator,
    IValidator<RefreshRequest> refreshValidator) : ControllerBase
{
    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<IActionResult> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var validation = await registerValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.RegisterAsync(request, cancellationToken);
        return result.Status == ServiceStatus.Conflict
            ? Conflict()
            : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var validation = await loginValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.LoginAsync(request, cancellationToken);
        return result.Status == ServiceStatus.Unauthorized ? Unauthorized() : Ok(result.Value);
    }

    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<IActionResult> Refresh(RefreshRequest request, CancellationToken cancellationToken)
    {
        var validation = await refreshValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.RefreshAsync(request.RefreshToken, cancellationToken);
        return result.Status == ServiceStatus.Unauthorized ? Unauthorized() : Ok(result.Value);
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout(LogoutRequest request, CancellationToken cancellationToken)
    {
        // Idempotent by design: unknown or already-revoked tokens still 204.
        await service.LogoutAsync(request.RefreshToken ?? string.Empty, cancellationToken);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var sub = User.FindFirstValue("sub");
        if (!Guid.TryParse(sub, out var userId)) return Unauthorized();

        var result = await service.MeAsync(userId, cancellationToken);
        return result.Status == ServiceStatus.Ok ? Ok(result.Value) : Unauthorized();
    }
}
