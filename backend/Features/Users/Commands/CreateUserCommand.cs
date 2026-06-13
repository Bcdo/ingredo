using MediatR;
using RestApiProject.Common;
using RestApiProject.DTOs;

namespace RestApiProject.Features.Users.Commands;

/// <summary>
/// CQRS Command for creating a new user
/// 
/// LEARNING NOTES:
/// - Commands represent WRITE operations (Create, Update, Delete)
/// - They are IMMUTABLE records (can't be changed after creation)
/// - They carry all the data needed for the operation
/// - They return a Result<T> for bulletproof error handling
/// - MediatR will automatically find and execute the handler
/// </summary>
public record CreateUserCommand(CreateUserDto UserData) : IRequest<Result<UserResponseDto>>;

/// <summary>
/// LEARNING NOTES: Command Design Principles
/// 
/// 1. SINGLE RESPONSIBILITY
///    Each command does ONE thing only
/// 
/// 2. IMMUTABLE
///    Records prevent accidental modification
/// 
/// 3. DESCRIPTIVE NAMES
///    Command name clearly states the intention
/// 
/// 4. RESULT PATTERN
///    Returns Result<T> instead of throwing exceptions
/// 
/// 5. MEDIATOR PATTERN
///    Decouples controller from business logic
/// 
/// Benefits:
/// - Easy to test (just test the handler)
/// - Easy to extend (add new commands without changing existing code)
/// - Easy to trace (each operation has its own class)
/// - Easy to validate (FluentValidation integrates perfectly)
/// - Easy to cache/log/audit (MediatR pipeline behaviors)
/// </summary>