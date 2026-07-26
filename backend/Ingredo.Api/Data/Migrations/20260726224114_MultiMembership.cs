using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ingredo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MultiMembership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "HouseholdId",
                table: "RefreshTokens",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "RefreshTokens" rt
                SET "HouseholdId" = m."HouseholdId"
                FROM "HouseholdMembers" m
                WHERE m."UserId" = rt."UserId";
                DELETE FROM "RefreshTokens" WHERE "HouseholdId" IS NULL;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "HouseholdId",
                table: "RefreshTokens",
                type: "uuid",
                nullable: false);

            migrationBuilder.Sql("""
                ALTER TABLE "HouseholdMembers" DROP CONSTRAINT "AK_HouseholdMembers_OneHouseholdPerUser";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "HouseholdMembers"
                ADD CONSTRAINT "AK_HouseholdMembers_OneHouseholdPerUser"
                UNIQUE ("UserId") DEFERRABLE INITIALLY DEFERRED;
                """);

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "RefreshTokens");
        }
    }
}
