using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ingredo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddJoinCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "JoinCode",
                table: "Households",
                type: "character varying(6)",
                maxLength: 6,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Households_JoinCode",
                table: "Households",
                column: "JoinCode",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Households_JoinCode",
                table: "Households");

            migrationBuilder.DropColumn(
                name: "JoinCode",
                table: "Households");
        }
    }
}
