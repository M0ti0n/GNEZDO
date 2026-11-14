using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Data;

/// <summary>The database: SQL Server (server build). The desktop build uses <see cref="GnezdoSqliteDb"/>.</summary>
public class GnezdoDb : DbContext
{
    public GnezdoDb(DbContextOptions<GnezdoDb> options) : base(options) { }

    /// <summary>For the SQLite database (desktop build), with its own migrations.</summary>
    protected GnezdoDb(DbContextOptions options) : base(options) { }

    public DbSet<Material> Materials => Set<Material>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
    public DbSet<Part> Parts => Set<Part>();
    public DbSet<PartRevision> PartRevisions => Set<PartRevision>();
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<JobPart> JobParts => Set<JobPart>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Draft> Drafts => Set<Draft>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<NcSent> NcSent => Set<NcSent>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Material>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60);
            e.HasIndex(x => x.Name).IsUnique();
        });

        b.Entity<Project>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(60);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Customer).HasMaxLength(200);
            e.HasIndex(x => x.Code).IsUnique();
        });

        b.Entity<ImportBatch>(e =>
        {
            e.Property(x => x.Source).HasMaxLength(400);
            e.Property(x => x.ImportedBy).HasMaxLength(100);
            e.HasIndex(x => x.ImportedAt);
        });

        b.Entity<Part>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(400);
            e.Property(x => x.Rotations).HasMaxLength(40);
            e.Property(x => x.SourceFile).HasMaxLength(260);
            e.Property(x => x.ThicknessMm).HasPrecision(6, 2);
            e.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Project).WithMany(x => x.Parts).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.ImportBatch).WithMany(x => x.Parts).HasForeignKey(x => x.ImportBatchId).OnDelete(DeleteBehavior.Restrict);
            // Indexes for the part search filters.
            e.HasIndex(x => x.Name);
            // one live part per project and name (deleted parts do not count); also the "already in the database" check
            e.HasIndex(x => new { x.ProjectId, x.Name }).IsUnique().HasFilter("[DeletedAt] IS NULL");
            e.HasIndex(x => x.DeletedAt);
            e.HasIndex(x => new { x.MaterialId, x.ThicknessMm });
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.ModifiedAt);
        });

        b.Entity<PartRevision>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(400);
            e.Property(x => x.ProjectCode).HasMaxLength(60);
            e.Property(x => x.MaterialName).HasMaxLength(100);
            e.Property(x => x.ThicknessMm).HasPrecision(6, 2);
            e.Property(x => x.Rotations).HasMaxLength(40);
            e.Property(x => x.SourceFile).HasMaxLength(260);
            // history goes with its part; parts are never deleted for now
            e.HasOne(x => x.Part).WithMany(x => x.History).HasForeignKey(x => x.PartId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.PartId, x.Revision }).IsUnique();
        });

        b.Entity<Job>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.ModifiedBy).HasMaxLength(100);
            e.Property(x => x.Machine).HasMaxLength(50);
            e.Property(x => x.CutBy).HasMaxLength(100);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.ModifiedAt);
        });

        b.Entity<User>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Name).IsUnique();   // the database's collation ignores case: "fab" is "Fab"
            e.Property(x => x.PasswordHash).HasMaxLength(200);
            e.Property(x => x.Stamp).HasMaxLength(40);
        });

        b.Entity<Draft>(e =>
        {
            e.Property(x => x.Id).HasMaxLength(40);
            e.Property(x => x.User).HasMaxLength(100);
            e.Property(x => x.Browser).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasIndex(x => x.User);
        });

        b.Entity<ApiKey>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Hash).HasMaxLength(64);
            e.Property(x => x.Prefix).HasMaxLength(16);
            e.Property(x => x.CreatedBy).HasMaxLength(100);
            e.HasIndex(x => x.Hash).IsUnique();
        });

        b.Entity<NcSent>(e =>
        {
            e.ToTable("NcSent");
            e.Property(x => x.JobName).HasMaxLength(200);
            e.Property(x => x.Machine).HasMaxLength(50);
            e.Property(x => x.File).HasMaxLength(260);
            e.Property(x => x.SentBy).HasMaxLength(100);
            e.Property(x => x.CutBy).HasMaxLength(100);
            e.HasIndex(x => x.JobId);
        });

        b.Entity<AppSetting>(e =>
        {
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(100);
            e.Property(x => x.ModifiedBy).HasMaxLength(100);
        });

        b.Entity<JobPart>(e =>
        {
            e.HasKey(x => new { x.JobId, x.PartId });
            e.HasOne(x => x.Job).WithMany(x => x.Parts).HasForeignKey(x => x.JobId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Material).HasMaxLength(100);
            e.Property(x => x.ThicknessMm).HasPrecision(8, 2);
        });
    }
}
