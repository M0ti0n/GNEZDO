using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gnezdo.Api.Data.SqliteMigrations
{
    /// <inheritdoc />
    public partial class SqliteDatabase : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Jobs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false, collation: "NOCASE"),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    SheetCount = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ModifiedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ModifiedBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    Machine = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false, collation: "NOCASE"),
                    Stock = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    Nest = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    NestedAt = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Jobs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Materials",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false, collation: "NOCASE")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Materials", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Projects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false, collation: "NOCASE"),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false, collation: "NOCASE"),
                    Customer = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true, collation: "NOCASE"),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Projects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Settings",
                columns: table => new
                {
                    Key = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    Value = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    ModifiedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ModifiedBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Settings", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    PasswordHash = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true, collation: "NOCASE"),
                    IsAdmin = table.Column<bool>(type: "INTEGER", nullable: false),
                    Stamp = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false, collation: "NOCASE"),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    LastSignInAt = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ImportBatches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Source = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false, collation: "NOCASE"),
                    ProjectId = table.Column<int>(type: "INTEGER", nullable: true),
                    ImportedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ImportedBy = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    Warnings = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportBatches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportBatches_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Parts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false, collation: "NOCASE"),
                    Description = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false, collation: "NOCASE"),
                    ProjectId = table.Column<int>(type: "INTEGER", nullable: true),
                    MaterialId = table.Column<int>(type: "INTEGER", nullable: false),
                    ThicknessMm = table.Column<double>(type: "REAL", precision: 6, scale: 2, nullable: false),
                    Qty = table.Column<int>(type: "INTEGER", nullable: false),
                    WidthMm = table.Column<double>(type: "REAL", nullable: false),
                    HeightMm = table.Column<double>(type: "REAL", nullable: false),
                    AreaMm2 = table.Column<double>(type: "REAL", nullable: false),
                    OutlinePath = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    Engraved = table.Column<bool>(type: "INTEGER", nullable: false),
                    Geometry = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    Rotations = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false, collation: "NOCASE"),
                    Mirror = table.Column<bool>(type: "INTEGER", nullable: false),
                    Filler = table.Column<bool>(type: "INTEGER", nullable: false),
                    SourceFile = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false, collation: "NOCASE"),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    DeletedAt = table.Column<long>(type: "INTEGER", nullable: true),
                    ImportBatchId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ModifiedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Parts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Parts_ImportBatches_ImportBatchId",
                        column: x => x.ImportBatchId,
                        principalTable: "ImportBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Parts_Materials_MaterialId",
                        column: x => x.MaterialId,
                        principalTable: "Materials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Parts_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "JobParts",
                columns: table => new
                {
                    JobId = table.Column<int>(type: "INTEGER", nullable: false),
                    PartId = table.Column<int>(type: "INTEGER", nullable: false),
                    Qty = table.Column<int>(type: "INTEGER", nullable: false),
                    QtyMax = table.Column<int>(type: "INTEGER", nullable: false),
                    No = table.Column<int>(type: "INTEGER", nullable: false),
                    Material = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true, collation: "NOCASE"),
                    ThicknessMm = table.Column<double>(type: "REAL", precision: 8, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JobParts", x => new { x.JobId, x.PartId });
                    table.ForeignKey(
                        name: "FK_JobParts_Jobs_JobId",
                        column: x => x.JobId,
                        principalTable: "Jobs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_JobParts_Parts_PartId",
                        column: x => x.PartId,
                        principalTable: "Parts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PartRevisions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    PartId = table.Column<int>(type: "INTEGER", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false, collation: "NOCASE"),
                    Description = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false, collation: "NOCASE"),
                    ProjectCode = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false, collation: "NOCASE"),
                    MaterialName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                    ThicknessMm = table.Column<double>(type: "REAL", precision: 6, scale: 2, nullable: false),
                    Rotations = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false, collation: "NOCASE"),
                    Mirror = table.Column<bool>(type: "INTEGER", nullable: false),
                    Filler = table.Column<bool>(type: "INTEGER", nullable: false),
                    WidthMm = table.Column<double>(type: "REAL", nullable: false),
                    HeightMm = table.Column<double>(type: "REAL", nullable: false),
                    AreaMm2 = table.Column<double>(type: "REAL", nullable: false),
                    OutlinePath = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    Engraved = table.Column<bool>(type: "INTEGER", nullable: false),
                    Geometry = table.Column<string>(type: "TEXT", nullable: false, collation: "NOCASE"),
                    SourceFile = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false, collation: "NOCASE"),
                    SavedAt = table.Column<long>(type: "INTEGER", nullable: false),
                    ReplacedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartRevisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PartRevisions_Parts_PartId",
                        column: x => x.PartId,
                        principalTable: "Parts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportBatches_ImportedAt",
                table: "ImportBatches",
                column: "ImportedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ImportBatches_ProjectId",
                table: "ImportBatches",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_JobParts_PartId",
                table: "JobParts",
                column: "PartId");

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_CreatedAt",
                table: "Jobs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_ModifiedAt",
                table: "Jobs",
                column: "ModifiedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Materials_Name",
                table: "Materials",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PartRevisions_PartId_Revision",
                table: "PartRevisions",
                columns: new[] { "PartId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Parts_CreatedAt",
                table: "Parts",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_DeletedAt",
                table: "Parts",
                column: "DeletedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_ImportBatchId",
                table: "Parts",
                column: "ImportBatchId");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_MaterialId_ThicknessMm",
                table: "Parts",
                columns: new[] { "MaterialId", "ThicknessMm" });

            migrationBuilder.CreateIndex(
                name: "IX_Parts_ModifiedAt",
                table: "Parts",
                column: "ModifiedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_Name",
                table: "Parts",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_Parts_ProjectId_Name",
                table: "Parts",
                columns: new[] { "ProjectId", "Name" },
                unique: true,
                filter: "[DeletedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Projects_Code",
                table: "Projects",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Name",
                table: "Users",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "JobParts");

            migrationBuilder.DropTable(
                name: "PartRevisions");

            migrationBuilder.DropTable(
                name: "Settings");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Jobs");

            migrationBuilder.DropTable(
                name: "Parts");

            migrationBuilder.DropTable(
                name: "ImportBatches");

            migrationBuilder.DropTable(
                name: "Materials");

            migrationBuilder.DropTable(
                name: "Projects");
        }
    }
}
