using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ingredo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecipeOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "HouseholdId",
                table: "Recipes",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes",
                column: "HouseholdId");

            migrationBuilder.AddForeignKey(
                name: "FK_Recipes_Households_HouseholdId",
                table: "Recipes",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Recipes_Households_HouseholdId",
                table: "Recipes");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Recipes");
        }
    }
}
