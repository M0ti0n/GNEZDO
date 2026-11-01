using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class JobPartMaterialThickness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Material",
                table: "JobParts",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ThicknessMm",
                table: "JobParts",
                type: "decimal(8,2)",
                precision: 8,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Material",
                table: "JobParts");

            migrationBuilder.DropColumn(
                name: "ThicknessMm",
                table: "JobParts");
        }
    }
}
