using AutoMapper;
using RestApiProject.DTOs;
using RestApiProject.Models;

namespace RestApiProject.Mappings;

/// <summary>
/// Modern AutoMapper configuration with comprehensive mappings
/// 
/// LEARNING NOTES:
/// - AutoMapper eliminates boilerplate mapping code
/// - Configurations are centralized and testable
/// - Complex mappings can be customized
/// - Reverse mappings can be created automatically
/// - Performance is optimized through compiled expressions
/// </summary>
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        ConfigureUserMappings();
    }

    private void ConfigureUserMappings()
    {
        // User entity to response DTO - using constructor mapping for records
        CreateMap<User, UserResponseDto>()
            .ConstructUsing(src => new UserResponseDto(
                src.Id,
                src.UserName,
                src.FirstName,
                src.LastName,
                src.Email,
                src.PhoneNumber,
                src.DateOfBirth,
                src.CreatedAt,
                src.UpdatedAt,
                src.IsEmailVerified,
                src.ProfilePictureUrl,
                src.Bio,
                src.FullName,
                src.Age,
                src.UserRoles.Select(ur => new UserRoleDto(
                    ur.Role.Id,
                    ur.Role.Name,
                    ur.AssignedAt
                )).ToList()
            ));

        // UserRole to UserRoleDto - using constructor mapping
        CreateMap<UserRole, UserRoleDto>()
            .ConstructUsing(src => new UserRoleDto(
                src.Role.Id,
                src.Role.Name,
                src.AssignedAt
            ));

        // User entity to summary DTO (for lists) - using constructor mapping
        CreateMap<User, UserSummaryDto>()
            .ConstructUsing(src => new UserSummaryDto(
                src.Id,
                src.FullName,
                src.Email,
                src.IsEmailVerified
            ));

        // Create DTO to User entity
        CreateMap<CreateUserDto, User>()
            .ForMember(dest => dest.Id, opt => opt.Ignore())
            .ForMember(dest => dest.PasswordHash, opt => opt.Ignore()) // Handled in handler
            .ForMember(dest => dest.CreatedAt, opt => opt.MapFrom(src => DateTime.UtcNow))
            .ForMember(dest => dest.UpdatedAt, opt => opt.Ignore())
            .ForMember(dest => dest.IsActive, opt => opt.MapFrom(src => true))
            .ForMember(dest => dest.IsEmailVerified, opt => opt.MapFrom(src => false))
            .ForMember(dest => dest.EmailVerificationToken, opt => opt.Ignore())
            .ForMember(dest => dest.EmailVerifiedAt, opt => opt.Ignore())
            .ForMember(dest => dest.ProfilePictureUrl, opt => opt.Ignore())
            .ForMember(dest => dest.UserRoles, opt => opt.Ignore());

        // Update DTO to User entity
        CreateMap<UpdateUserDto, User>()
            .ForMember(dest => dest.Id, opt => opt.Ignore())
            .ForMember(dest => dest.Email, opt => opt.Ignore()) // Email shouldn't be updated via profile update
            .ForMember(dest => dest.PasswordHash, opt => opt.Ignore())
            .ForMember(dest => dest.CreatedAt, opt => opt.Ignore())
            .ForMember(dest => dest.UpdatedAt, opt => opt.MapFrom(src => DateTime.UtcNow))
            .ForMember(dest => dest.IsActive, opt => opt.Ignore())
            .ForMember(dest => dest.IsEmailVerified, opt => opt.Ignore())
            .ForMember(dest => dest.EmailVerificationToken, opt => opt.Ignore())
            .ForMember(dest => dest.EmailVerifiedAt, opt => opt.Ignore())
            .ForMember(dest => dest.ProfilePictureUrl, opt => opt.Ignore())
            .ForMember(dest => dest.UserRoles, opt => opt.Ignore());
    }

}

/// <summary>
/// LEARNING NOTES: AutoMapper Benefits
/// 
/// ❌ WITHOUT AutoMapper (Manual mapping):
/// var dto = new UserResponseDto
/// {
///     Id = user.Id,
///     FirstName = user.FirstName,
///     LastName = user.LastName,
///     Email = user.Email,
///     // ... 20+ more properties
///     FullName = $"{user.FirstName} {user.LastName}",
///     Age = DateTime.Now.Year - user.DateOfBirth.Year
/// };
/// 
/// ✅ WITH AutoMapper:
/// var dto = _mapper.Map<UserResponseDto>(user);
/// 
/// BENEFITS:
/// 1. LESS CODE - Eliminates boilerplate mapping
/// 2. CENTRALIZED - All mappings in one place
/// 3. TESTABLE - Easy to test mapping configurations
/// 4. PERFORMANCE - Compiled expressions are fast
/// 5. MAINTAINABLE - Changes in one place
/// 6. FLEXIBLE - Custom mappings for complex scenarios
/// </summary>
