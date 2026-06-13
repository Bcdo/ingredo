-- Modern C# REST API Template - Neovim Snippets for mini.snippets
-- Usage: Copy this file to your Neovim config or load directly
-- Installation: require('mini.snippets').put('cs', require('path.to.this.file'))

local snippets = {}

-- Complete Feature Scaffolding Snippets

snippets.createentity = {
  'using System.ComponentModel.DataAnnotations;',
  '',
  'namespace $1.Models;',
  '',
  '/// <summary>',
  '/// $2 entity demonstrating modern EF Core patterns',
  '/// ',
  '/// LEARNING NOTES:',
  '/// - Uses modern C# nullable reference types',
  '/// - Includes audit fields (CreatedAt, UpdatedAt)',
  '/// - Implements soft delete pattern (optional)',
  '/// - Has navigation properties for relationships',
  '/// - Follows domain-driven design principles',
  '/// </summary>',
  'public class $2',
  '{',
  '    public int Id { get; set; }',
  '',
  '    [Required]',
  '    [StringLength($3)]',
  '    public string $4 { get; set; } = string.Empty;',
  '',
  '    $0',
  '',
  '    // Audit fields (important for production apps)',
  '    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;',
  '    public DateTime? UpdatedAt { get; set; }',
  '    public bool IsActive { get; set; } = true;',
  '',
  '    // Soft delete pattern (uncomment if needed)',
  '    // public bool IsDeleted { get; set; } = false;',
  '    // public DateTime? DeletedAt { get; set; }',
  '',
  '    // Navigation properties (relationships)',
  '    // Add navigation properties here',
  '',
  '    // Computed properties (not stored in DB)',
  '    // Add computed properties here',
  '}'
}

snippets.createdtos = {
  'namespace $1.DTOs;',
  '',
  '// INPUT DTOs (from client)',
  'public record Create$2Dto(',
  '    $3',
  ');',
  '',
  'public record Update$2Dto(',
  '    $4',
  ');',
  '',
  '// OUTPUT DTOs (to client)',
  'public record $2ResponseDto(',
  '    int Id,',
  '    $5,',
  '    DateTime CreatedAt,',
  '    DateTime? UpdatedAt,',
  '    bool IsActive',
  ');',
  '',
  'public record $2SummaryDto(',
  '    int Id,',
  '    $6,',
  '    DateTime CreatedAt,',
  '    bool IsActive',
  ');',
  '',
  '// QUERY DTOs (for filtering/searching)',
  'public record Get$2sQuery(',
  '    string? SearchTerm = null,',
  '    bool? IsActive = null,',
  '    int Page = 1,',
  '    int PageSize = 10,',
  '    string SortBy = "CreatedAt",',
  '    string SortDirection = "desc"',
  ') : IRequest<Result<PagedResult<$2SummaryDto>>>;',
  '$0'
}

snippets.createvalidator = {
  'using FluentValidation;',
  'using $1.DTOs;',
  '',
  'namespace $1.Validators;',
  '',
  'public class Create$2DtoValidator : AbstractValidator<Create$2Dto>',
  '{',
  '    public Create$2DtoValidator()',
  '    {',
  '        RuleFor(x => x.$3)',
  '            .NotEmpty().WithMessage("$3 is required")',
  '            .MaximumLength($4).WithMessage("$3 cannot exceed $4 characters");',
  '',
  '        $0',
  '    }',
  '}',
  '',
  'public class Update$2DtoValidator : AbstractValidator<Update$2Dto>',
  '{',
  '    public Update$2DtoValidator()',
  '    {',
  '        RuleFor(x => x.$3)',
  '            .MaximumLength($4).WithMessage("$3 cannot exceed $4 characters")',
  '            .When(x => !string.IsNullOrEmpty(x.$3));',
  '',
  '        // Add more validation rules here',
  '    }',
  '}'
}

snippets.createcommands = {
  'using MediatR;',
  'using $1.Common;',
  'using $1.DTOs;',
  '',
  'namespace $1.Features.$2.Commands;',
  '',
  'public record Create$3Command(Create$3Dto $4) : IRequest<Result<$3ResponseDto>>;',
  '',
  'public record Update$3Command(int Id, Update$3Dto $4) : IRequest<Result<$3ResponseDto>>;',
  '',
  'public record Delete$3Command(int Id) : IRequest<Result>;',
  '',
  'public record Toggle$3ActiveCommand(int Id) : IRequest<Result<$3ResponseDto>>;',
  '$0'
}

snippets.createqueries = {
  'using MediatR;',
  'using $1.Common;',
  'using $1.DTOs;',
  '',
  'namespace $1.Features.$2.Queries;',
  '',
  'public record Get$3ByIdQuery(int Id) : IRequest<Result<$3ResponseDto>>;',
  '',
  'public record Get$2Query(',
  '    string? SearchTerm = null,',
  '    bool? IsActive = null,',
  '    int Page = 1,',
  '    int PageSize = 10,',
  '    string SortBy = "CreatedAt",',
  '    string SortDirection = "desc"',
  ') : IRequest<Result<PagedResult<$3SummaryDto>>>;',
  '$0'
}

snippets.createhandler = {
  'using AutoMapper;',
  'using MediatR;',
  'using Microsoft.EntityFrameworkCore;',
  'using $1.Common;',
  'using $1.Data;',
  'using $1.DTOs;',
  'using $1.Features.$2.Commands;',
  'using $1.Models;',
  '',
  'namespace $1.Features.$2.Handlers;',
  '',
  'public class Create$3Handler : IRequestHandler<Create$3Command, Result<$3ResponseDto>>',
  '{',
  '    private readonly ApplicationDbContext _context;',
  '    private readonly IMapper _mapper;',
  '    private readonly ILogger<Create$3Handler> _logger;',
  '',
  '    public Create$3Handler(',
  '        ApplicationDbContext context,',
  '        IMapper mapper,',
  '        ILogger<Create$3Handler> logger)',
  '    {',
  '        _context = context;',
  '        _mapper = mapper;',
  '        _logger = logger;',
  '    }',
  '',
  '    public async Task<Result<$3ResponseDto>> Handle(Create$3Command request, CancellationToken cancellationToken)',
  '    {',
  '        try',
  '        {',
  '            _logger.LogInformation("Creating $3 with data: {@$3Data}", request.$4);',
  '',
  '            var entity = new $3',
  '            {',
  '                // Map properties from request.$4',
  '                $0',
  '                CreatedAt = DateTime.UtcNow,',
  '                IsActive = true',
  '            };',
  '',
  '            _context.$2.Add(entity);',
  '            await _context.SaveChangesAsync(cancellationToken);',
  '',
  '            var response = _mapper.Map<$3ResponseDto>(entity);',
  '',
  '            _logger.LogInformation("$3 created successfully with ID: {Id}", entity.Id);',
  '            return Result<$3ResponseDto>.Success(response);',
  '        }',
  '        catch (Exception ex)',
  '        {',
  '            _logger.LogError(ex, "Error creating $3 with data: {@$3Data}", request.$4);',
  '            return Result<$3ResponseDto>.Failure("An error occurred while creating the $3");',
  '        }',
  '    }',
  '}'
}

snippets.createcontroller = {
  'using Asp.Versioning;',
  'using MediatR;',
  'using Microsoft.AspNetCore.Mvc;',
  'using $1.DTOs;',
  'using $1.Features.$2.Commands;',
  'using $1.Features.$2.Queries;',
  '',
  'namespace $1.Controllers;',
  '',
  '[ApiController]',
  '[ApiVersion("1.0")]',
  '[Route("api/v{version:apiVersion}/[controller]")]',
  '[Produces("application/json")]',
  'public class $2Controller : ControllerBase',
  '{',
  '    private readonly IMediator _mediator;',
  '',
  '    public $2Controller(IMediator mediator)',
  '    {',
  '        _mediator = mediator;',
  '    }',
  '',
  '    [HttpGet]',
  '    [ProducesResponseType(typeof(PagedResult<$3SummaryDto>), StatusCodes.Status200OK)]',
  '    [ProducesResponseType(StatusCodes.Status400BadRequest)]',
  '    public async Task<ActionResult<PagedResult<$3SummaryDto>>> Get$2(',
  '        [FromQuery] string? searchTerm = null,',
  '        [FromQuery] bool? isActive = null,',
  '        [FromQuery] int page = 1,',
  '        [FromQuery] int pageSize = 10,',
  '        [FromQuery] string sortBy = "CreatedAt",',
  '        [FromQuery] string sortDirection = "desc")',
  '    {',
  '        var query = new Get$2Query(searchTerm, isActive, page, pageSize, sortBy, sortDirection);',
  '        var result = await _mediator.Send(query);',
  '',
  '        return result.IsSuccess',
  '            ? Ok(result.Value)',
  '            : BadRequest(result.Error);',
  '    }',
  '',
  '    [HttpGet("{id:int}")]',
  '    [ProducesResponseType(typeof($3ResponseDto), StatusCodes.Status200OK)]',
  '    [ProducesResponseType(StatusCodes.Status404NotFound)]',
  '    public async Task<ActionResult<$3ResponseDto>> Get$3(int id)',
  '    {',
  '        var result = await _mediator.Send(new Get$3ByIdQuery(id));',
  '',
  '        return result.IsSuccess',
  '            ? Ok(result.Value)',
  '            : NotFound(result.Error);',
  '    }',
  '',
  '    [HttpPost]',
  '    [ProducesResponseType(typeof($3ResponseDto), StatusCodes.Status201Created)]',
  '    [ProducesResponseType(StatusCodes.Status400BadRequest)]',
  '    public async Task<ActionResult<$3ResponseDto>> Create$3([FromBody] Create$3Dto create$3Dto)',
  '    {',
  '        var result = await _mediator.Send(new Create$3Command(create$3Dto));',
  '',
  '        if (result.IsSuccess)',
  '        {',
  '            return CreatedAtAction(',
  '                nameof(Get$3),',
  '                new { id = result.Value!.Id, version = "1.0" },',
  '                result.Value);',
  '        }',
  '',
  '        return BadRequest(result.Error);',
  '    }',
  '',
  '    $0',
  '}'
}

snippets.createmapper = {
  'using AutoMapper;',
  'using $1.DTOs;',
  'using $1.Models;',
  '',
  'namespace $1.Mappings;',
  '',
  'public class $2MappingProfile : Profile',
  '{',
  '    public $2MappingProfile()',
  '    {',
  '        CreateMap<$2, $2ResponseDto>();',
  '',
  '        CreateMap<$2, $2SummaryDto>();',
  '',
  '        CreateMap<Create$2Dto, $2>()',
  '            .ForMember(dest => dest.Id, opt => opt.Ignore())',
  '            .ForMember(dest => dest.CreatedAt, opt => opt.Ignore())',
  '            .ForMember(dest => dest.UpdatedAt, opt => opt.Ignore())',
  '            .ForMember(dest => dest.IsActive, opt => opt.Ignore());',
  '',
  '        $0',
  '    }',
  '}'
}

-- Utility Snippets

snippets.usings = {
  'using Microsoft.AspNetCore.Mvc;',
  'using Microsoft.EntityFrameworkCore;',
  'using MediatR;',
  'using AutoMapper;',
  'using FluentValidation;',
  'using $1.Common;',
  'using $1.Data;',
  'using $1.DTOs;',
  'using $1.Models;',
  '$0'
}

snippets.namespace = {
  'namespace $1.$2;',
  '',
  '$0'
}

snippets.controller = {
  '[ApiController]',
  '[ApiVersion("1.0")]',
  '[Route("api/v{version:apiVersion}/[controller]")]',
  '[Produces("application/json")]',
  'public class $1Controller : ControllerBase',
  '{',
  '    private readonly IMediator _mediator;',
  '',
  '    public $1Controller(IMediator mediator)',
  '    {',
  '        _mediator = mediator;',
  '    }',
  '',
  '    $0',
  '}'
}

snippets.record = {
  'public record $1($2);'
}

-- Result Pattern Snippets

snippets.resultok = {
  'return Result.Success();'
}

snippets.resultfail = {
  'return Result.Failure("$1");'
}

snippets.resultokvalue = {
  'return Result<$1>.Success($2);'
}

snippets.resultfailvalue = {
  'return Result<$1>.Failure("$2");'
}

-- Quick Entity Creation Snippets

snippets.entity = {
  'public class $1',
  '{',
  '    public int Id { get; set; }',
  '    $0',
  '    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;',
  '    public DateTime? UpdatedAt { get; set; }',
  '    public bool IsActive { get; set; } = true;',
  '}'
}

snippets.dto = {
  'public record $1Dto(',
  '    $0',
  ');'
}

snippets.command = {
  'public record $1Command($2) : IRequest<Result<$3>>;'
}

snippets.query = {
  'public record $1Query($2) : IRequest<Result<$3>>;'
}

snippets.handler = {
  'public class $1Handler : IRequestHandler<$2, $3>',
  '{',
  '    public async Task<$3> Handle($2 request, CancellationToken cancellationToken)',
  '    {',
  '        $0',
  '    }',
  '}'
}

-- CQRS Pattern Snippets

snippets.cqrshandler = {
  'public class $1Handler : IRequestHandler<$1Command, Result<$2>>',
  '{',
  '    private readonly ApplicationDbContext _context;',
  '    private readonly IMapper _mapper;',
  '    private readonly ILogger<$1Handler> _logger;',
  '',
  '    public $1Handler(',
  '        ApplicationDbContext context,',
  '        IMapper mapper,',
  '        ILogger<$1Handler> logger)',
  '    {',
  '        _context = context;',
  '        _mapper = mapper;',
  '        _logger = logger;',
  '    }',
  '',
  '    public async Task<Result<$2>> Handle($1Command request, CancellationToken cancellationToken)',
  '    {',
  '        try',
  '        {',
  '            $0',
  '            return Result<$2>.Success(result);',
  '        }',
  '        catch (Exception ex)',
  '        {',
  '            _logger.LogError(ex, "Error in $1Handler");',
  '            return Result<$2>.Failure("An error occurred");',
  '        }',
  '    }',
  '}'
}

return snippets