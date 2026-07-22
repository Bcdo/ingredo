using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ingredo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSyncSeq : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""CREATE SEQUENCE sync_seq;""");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes");

            migrationBuilder.AddColumn<long>(
                name: "SyncSeq",
                table: "ShoppingItems",
                type: "bigint",
                nullable: false,
                defaultValueSql: "nextval('sync_seq')");

            migrationBuilder.AddColumn<long>(
                name: "SyncSeq",
                table: "Recipes",
                type: "bigint",
                nullable: false,
                defaultValueSql: "nextval('sync_seq')");

            migrationBuilder.AddColumn<long>(
                name: "SyncSeq",
                table: "MealPlanEntries",
                type: "bigint",
                nullable: false,
                defaultValueSql: "nextval('sync_seq')");

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingItems_HouseholdId_SyncSeq",
                table: "ShoppingItems",
                columns: new[] { "HouseholdId", "SyncSeq" });

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_HouseholdId_SyncSeq",
                table: "Recipes",
                columns: new[] { "HouseholdId", "SyncSeq" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanEntries_HouseholdId_SyncSeq",
                table: "MealPlanEntries",
                columns: new[] { "HouseholdId", "SyncSeq" });

            // Trigger-assigned change sequencing: EVERY write path — CRUD,
            // sync-applied, and ExecuteUpdate bulk paths — gets a fresh
            // sequence value, structurally. The column default covers plain
            // SQL inserts; the trigger covers updates and overrides inserts.
            migrationBuilder.Sql("""
                CREATE FUNCTION set_sync_seq() RETURNS trigger AS $$
                BEGIN
                    NEW."SyncSeq" := nextval('sync_seq');
                    RETURN NEW;
                END $$ LANGUAGE plpgsql;

                CREATE TRIGGER recipes_sync_seq BEFORE INSERT OR UPDATE ON "Recipes"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                CREATE TRIGGER meal_plan_sync_seq BEFORE INSERT OR UPDATE ON "MealPlanEntries"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                CREATE TRIGGER shopping_sync_seq BEFORE INSERT OR UPDATE ON "ShoppingItems"
                    FOR EACH ROW EXECUTE FUNCTION set_sync_seq();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER recipes_sync_seq ON "Recipes";
                DROP TRIGGER meal_plan_sync_seq ON "MealPlanEntries";
                DROP TRIGGER shopping_sync_seq ON "ShoppingItems";
                DROP FUNCTION set_sync_seq();
                """);

            migrationBuilder.DropIndex(
                name: "IX_ShoppingItems_HouseholdId_SyncSeq",
                table: "ShoppingItems");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_HouseholdId_SyncSeq",
                table: "Recipes");

            migrationBuilder.DropIndex(
                name: "IX_MealPlanEntries_HouseholdId_SyncSeq",
                table: "MealPlanEntries");

            migrationBuilder.DropColumn(
                name: "SyncSeq",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "SyncSeq",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "SyncSeq",
                table: "MealPlanEntries");

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes",
                column: "HouseholdId");

            migrationBuilder.Sql("""DROP SEQUENCE sync_seq;""");
        }
    }
}
