namespace RestApiProject.Common;

public class Result<T>
{
    public bool IsSuccess { get; private set; }
    public T? Value { get; private set; }
    public string? Error { get; private set; }
    public List<string> Errors { get; private set; } = new();

    private Result(T value)
    {
        IsSuccess = true;
        Value = value;
    }

    private Result(string error)
    {
        IsSuccess = false;
        Error = error;
        Errors.Add(error);
    }

    private Result(List<string> errors)
    {
        IsSuccess = false;
        Errors = errors;
        Error = string.Join(", ", errors);
    }

    public static Result<T> Success(T value) => new(value);
    public static Result<T> Failure(string error) => new(error);
    public static Result<T> Failure(List<string> errors) => new(errors);

    // Implicit conversion from T to Result<T>
    public static implicit operator Result<T>(T value) => Success(value);
}

public class Result
{
    public bool IsSuccess { get; private set; }
    public string? Error { get; private set; }
    public List<string> Errors { get; private set; } = new();

    private Result() { IsSuccess = true; }
    
    private Result(string error)
    {
        IsSuccess = false;
        Error = error;
        Errors.Add(error);
    }

    public static Result Success() => new();
    public static Result Failure(string error) => new(error);
}