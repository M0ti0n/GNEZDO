using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.SqliteMigrations
{
    /// <inheritdoc />
    public partial class StatusApi : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CutAt",
                table: "Jobs",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CutBy",
                table: "Jobs",
                type: "TEXT",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                collation: "NOCASE");

            migrationBuilder.CreateTable(
                name: "ApiKeys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    Hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false, collation: "NOCASE"),
                    Prefix = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false, collation: "NOCASE"),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    CreatedBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    LastUsedAt = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApiKeys", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NcSent",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    JobId = table.Column<int>(type: "INTEGER", nullable: false),
                    JobName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false, collation: "NOCASE"),
                    Sheet = table.Column<int>(type: "INTEGER", nullable: false),
                    Machine = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false, collation: "NOCASE"),
                    File = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false, collation: "NOCASE"),
                    Parts = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    SentAt = table.Column<long>(type: "INTEGER", nullable: false),
                    SentBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NcSent", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ApiKeys_Hash",
                table: "ApiKeys",
                column: "Hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NcSent_JobId",
                table: "NcSent",
                column: "JobId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ApiKeys");

            migrationBuilder.DropTable(
                name: "NcSent");

            migrationBuilder.DropColumn(
                name: "CutAt",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "CutBy",
                table: "Jobs");
        }
    }
}
