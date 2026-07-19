using Ingredo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeInstruction> RecipeInstructions => Set<RecipeInstruction>();

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
    }
}
