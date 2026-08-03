using System.Threading.RateLimiting;
using FluentValidation;
using Ingredo.Api.Auth;
using Ingredo.Api.Common;
using Ingredo.Api.Data;
using Ingredo.Api.Domain;
using Ingredo.Api.Households;
using Ingredo.Api.MealPlan;
using Ingredo.Api.Realtime;
using Ingredo.Api.Recipes;
using Ingredo.Api.Shopping;
using Ingredo.Api.Sync;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, configuration) =>
{
    configuration.ReadFrom.Configuration(context.Configuration).WriteTo.Console();
    if (context.HostingEnvironment.IsDevelopment())
    {
        configuration.WriteTo.File("logs/app.log", rollingInterval: RollingInterval.Day);
    }
});

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddScoped<IRecipeService, RecipeService>();
builder.Services.AddScoped<IMealPlanService, MealPlanService>();
builder.Services.AddScoped<IShoppingService, ShoppingService>();
builder.Services.AddScoped<ISyncService, SyncService>();
builder.Services.AddScoped<IJoinCodeService, JoinCodeService>();
builder.Services.AddScoped<IHouseholdService, HouseholdService>();
builder.Services.AddScoped<IChangeNotifier, SignalRChangeNotifier>();
builder.Services.AddValidatorsFromAssemblyContaining<RecipeRequestValidator>();
builder.Services.AddIngredoAuth(builder.Configuration);
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();

builder.Services.AddRateLimiter(options =>
{
    var authLimit = builder.Configuration.GetValue("RateLimiting:Auth:PermitLimit", 10);
    var globalLimit = builder.Configuration.GetValue("RateLimiting:Global:PermitLimit", 300);

    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = (context, _) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        return ValueTask.CompletedTask;
    };

    // Behind the tunnel every socket peer is cloudflared; the real client
    // is CF-Connecting-IP, and the origin is reachable ONLY through the
    // tunnel, so the header cannot be spoofed from outside.
    static string ClientKey(HttpContext context) =>
        context.Request.Headers["CF-Connecting-IP"].FirstOrDefault()
        ?? context.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/health") || path.StartsWithSegments("/hubs"))
        {
            return RateLimitPartition.GetNoLimiter("exempt");
        }
        return RateLimitPartition.GetFixedWindowLimiter(ClientKey(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = globalLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });

    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(ClientKey(context),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

var app = builder.Build();

// Single-instance deployment: the API migrates its own schema on startup
// in every environment — this IS the production migration mechanism.
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseSerilogRequestLogging();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<HouseholdGuardMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}

app.MapHealthChecks("/health").AllowAnonymous();
app.MapControllers();
app.MapHub<SyncHub>("/hubs/sync");

app.Run();

public partial class Program;
