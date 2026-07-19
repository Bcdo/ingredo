using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeInstruction> RecipeInstructions => Set<RecipeInstruction>();

    public DbSet<User> Users => Set<User>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<HouseholdMember> HouseholdMembers => Set<HouseholdMember>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Recipe>(recipe =>
        {
            recipe.Property(r => r.Title).IsRequired().HasMaxLength(500);
            recipe.HasQueryFilter(r => r.DeletedAt == null);
            recipe
                .HasMany(r => r.Ingredients)
                .WithOne()
                .HasForeignKey(i => i.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
            recipe
                .HasMany(r => r.Instructions)
                .WithOne()
                .HasForeignKey(i => i.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RecipeIngredient>(ingredient =>
        {
            ingredient.Property(i => i.Name).IsRequired().HasMaxLength(500);
            // Stored as the frontend's lowercase strings so Phase 5 sync
            // compares like with like.
            ingredient
                .Property(i => i.Scaling)
                .HasConversion(
                    scaling => scaling.ToString().ToLowerInvariant(),
                    value => Enum.Parse<ScalingMode>(value, true))
                .HasMaxLength(16);
        });

        modelBuilder.Entity<RecipeInstruction>(instruction =>
        {
            instruction.Property(i => i.Text).IsRequired();
        });

        modelBuilder.Entity<User>(user =>
        {
            user.Property(u => u.Email).IsRequired().HasMaxLength(320);
            user.Property(u => u.NormalizedEmail).IsRequired().HasMaxLength(320);
            user.HasIndex(u => u.NormalizedEmail).IsUnique();
            user.Property(u => u.DisplayName).IsRequired().HasMaxLength(100);
            user.Property(u => u.PasswordHash).IsRequired();
        });

        modelBuilder.Entity<Household>(household =>
        {
            household.Property(h => h.Name).IsRequired().HasMaxLength(200);
        });

        modelBuilder.Entity<HouseholdMember>(member =>
        {
            member.HasIndex(m => new { m.UserId, m.HouseholdId }).IsUnique();
            member
                .HasOne<User>()
                .WithMany()
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            member
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(m => m.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
            member
                .Property(m => m.Role)
                .HasConversion(
                    role => role.ToString().ToLowerInvariant(),
                    value => Enum.Parse<HouseholdRole>(value, true))
                .HasMaxLength(16);
        });

        modelBuilder.Entity<RefreshToken>(token =>
        {
            token.Property(t => t.TokenHash).IsRequired().HasMaxLength(88);
            token.HasIndex(t => t.TokenHash).IsUnique();
            token.HasIndex(t => t.FamilyId);
            token
                .HasOne<User>()
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
