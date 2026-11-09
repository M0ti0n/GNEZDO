using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.SqliteMigrations
{
    /// <inheritdoc />
    public partial class PartCommonCut : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CommonCut",
                table: "Parts",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CommonCut",
                table: "PartRevisions",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CommonCut",
                table: "Parts");

            migrationBuilder.DropColumn(
                name: "CommonCut",
                table: "PartRevisions");
        }
    }
}
