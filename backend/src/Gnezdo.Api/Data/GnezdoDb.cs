using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Data;

public class GnezdoDb(DbContextOptions<GnezdoDb> options) : DbContext(options)
{
    public DbSet<Material> Materials => Set<Material>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
    public DbSet<Part> Parts => Set<Part>();
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<JobPart> JobParts => Set<JobPart>();

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
            e.Property(x => x.ThicknessMm).HasPrecision(6, 2);
            e.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Project).WithMany(x => x.Parts).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.ImportBatch).WithMany(x => x.Parts).HasForeignKey(x => x.ImportBatchId).OnDelete(DeleteBehavior.Restrict);
            // Indexes for the part search filters.
            e.HasIndex(x => x.Name);
            e.HasIndex(x => new { x.MaterialId, x.ThicknessMm });
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.ModifiedAt);
        });

        b.Entity<Job>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.ModifiedBy).HasMaxLength(100);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.ModifiedAt);
        });

        b.Entity<JobPart>(e =>
        {
            e.HasKey(x => new { x.JobId, x.PartId });
            e.HasOne(x => x.Job).WithMany(x => x.Parts).HasForeignKey(x => x.JobId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
