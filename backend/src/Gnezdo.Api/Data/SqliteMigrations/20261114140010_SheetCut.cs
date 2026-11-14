using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.SqliteMigrations
{
    /// <inheritdoc />
    public partial class SheetCut : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CutAt",
                table: "NcSent",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CutBy",
                table: "NcSent",
                type: "TEXT",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                collation: "NOCASE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CutAt",
                table: "NcSent");

            migrationBuilder.DropColumn(
                name: "CutBy",
                table: "NcSent");
        }
    }
}
