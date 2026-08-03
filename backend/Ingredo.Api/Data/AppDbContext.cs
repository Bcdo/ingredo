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

    public DbSet<MealPlanEntry> MealPlanEntries => Set<MealPlanEntry>();
    public DbSet<ShoppingItem> ShoppingItems => Set<ShoppingItem>();

    public DbSet<InviteCode> InviteCodes => Set<InviteCode>();
    public DbSet<PasswordResetCode> PasswordResetCodes => Set<PasswordResetCode>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Recipe>(recipe =>
        {
            recipe.Property(r => r.Title).IsRequired().HasMaxLength(500);
            recipe.HasQueryFilter(r => r.DeletedAt == null);
            recipe
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(r => r.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
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
            recipe.Property(r => r.SyncSeq)
                .HasDefaultValueSql("nextval('sync_seq')")
                .ValueGeneratedOnAddOrUpdate();
            recipe.HasIndex(r => new { r.HouseholdId, r.SyncSeq });
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
            household.Property(h => h.JoinCode).IsRequired().HasMaxLength(6);
            household.HasIndex(h => h.JoinCode).IsUnique();
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

        modelBuilder.Entity<MealPlanEntry>(entry =>
        {
            entry.HasQueryFilter(e => e.DeletedAt == null);
            entry.HasIndex(e => new { e.HouseholdId, e.Date });
            entry
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(e => e.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
            entry
                .HasOne<Recipe>()
                .WithMany()
                .HasForeignKey(e => e.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
            entry.Property(e => e.SyncSeq)
                .HasDefaultValueSql("nextval('sync_seq')")
                .ValueGeneratedOnAddOrUpdate();
            entry.HasIndex(e => new { e.HouseholdId, e.SyncSeq });
        });

        modelBuilder.Entity<ShoppingItem>(item =>
        {
            item.Property(i => i.Name).IsRequired().HasMaxLength(500);
            item.Property(i => i.NormalizedName).IsRequired().HasMaxLength(500);
            item.Property(i => i.Unit).HasMaxLength(50);
            item.Property(i => i.Sources).IsRequired().HasMaxLength(4000);
            item
                .Property(i => i.Status)
                .HasConversion(
                    status => status.ToString().ToLowerInvariant(),
                    value => Enum.Parse<ShoppingItemStatus>(value, true))
                .HasMaxLength(16);
            item.HasQueryFilter(i => i.DeletedAt == null);
            item.HasIndex(i => new { i.HouseholdId, i.Status });
            item
                .HasOne<Household>()
                .WithMany()
                .HasForeignKey(i => i.HouseholdId)
                .OnDelete(DeleteBehavior.Cascade);
            item.Property(i => i.SyncSeq)
                .HasDefaultValueSql("nextval('sync_seq')")
                .ValueGeneratedOnAddOrUpdate();
            item.HasIndex(i => new { i.HouseholdId, i.SyncSeq });
        });

        modelBuilder.Entity<InviteCode>(invite =>
        {
            invite.Property(i => i.Code).HasMaxLength(16);
            invite.HasIndex(i => i.Code).IsUnique();
            invite.Property(i => i.UsedAt).IsConcurrencyToken();
        });

        modelBuilder.Entity<PasswordResetCode>(reset =>
        {
            reset.Property(r => r.CodeHash).HasMaxLength(64);
            reset.HasIndex(r => r.CodeHash).IsUnique();
            reset.HasIndex(r => r.UserId);
            reset.Property(r => r.UsedAt).IsConcurrencyToken();
        });
    }
}
