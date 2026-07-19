using FluentValidation;
using Ingredo.Api.Common;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Recipes;

[ApiController]
[Route("api/v1/recipes")]
public sealed class RecipesController(
    IRecipeService service,
    IValidator<RecipeRequest> validator) : ControllerBase
{
    [HttpGet]
    public Task<List<RecipeSummaryResponse>> List(CancellationToken cancellationToken) =>
        service.ListAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> Create(RecipeRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.CreateAsync(request, cancellationToken);
        return result.Status switch
        {
            ServiceStatus.Conflict => Conflict(),
            _ => CreatedAtAction(nameof(Get), new { id = result.Value!.Id }, result.Value),
        };
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, RecipeRequest request, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }

        var result = await service.UpdateAsync(id, request, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(id, cancellationToken);
        return result.Status == ServiceStatus.NotFound ? NotFound() : NoContent();
    }
}
