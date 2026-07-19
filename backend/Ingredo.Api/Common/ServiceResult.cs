namespace Ingredo.Api.Common;

public enum ServiceStatus
{
    Ok,
    NotFound,
    Conflict,
}

// Expected outcomes travel as values, not exceptions; controllers translate
// Status to HTTP codes.
public sealed record ServiceResult<T>(ServiceStatus Status, T? Value)
{
    public static ServiceResult<T> Ok(T value) => new(ServiceStatus.Ok, value);
    public static ServiceResult<T> NotFound() => new(ServiceStatus.NotFound, default);
    public static ServiceResult<T> Conflict() => new(ServiceStatus.Conflict, default);
}
