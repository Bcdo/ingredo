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
builder.Services.AddValidatorsFromAssemblyContaining<RecipeRequestValidator>();
builder.Services.AddIngredoAuth(builder.Configuration);
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseSerilogRequestLogging();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<HouseholdGuardMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapHealthChecks("/health");
app.MapControllers();
app.MapHub<SyncHub>("/hubs/sync");

app.Run();

public partial class Program;
