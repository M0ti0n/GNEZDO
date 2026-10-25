using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UniqueLivePartName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Parts_ProjectId_Name",
                table: "Parts");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_ProjectId_Name",
                table: "Parts",
                columns: new[] { "ProjectId", "Name" },
                unique: true,
                filter: "[DeletedAt] IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Parts_ProjectId_Name",
                table: "Parts");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_ProjectId_Name",
                table: "Parts",
                columns: new[] { "ProjectId", "Name" });
        }
    }
}
