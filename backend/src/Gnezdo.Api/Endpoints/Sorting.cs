using Gnezdo.Api.Data;

namespace Gnezdo.Api.Endpoints;

public enum SortKey { Name, Created, Modified, Material, Thickness, Project }

/// <summary>Sort order from the query string: sort=name|created|modified|material|thickness|project, dir=asc|desc.</summary>
public readonly record struct Sort(SortKey Key, bool Descending)
{
    /// <summary>Default: newest change first.</summary>
    public static readonly Sort Default = new(SortKey.Modified, true);

    public static bool TryParse(string? key, string? dir, out Sort sort, out string? error)
    {
        sort = Default;
        error = null;
        var k = Default.Key;
        if (!string.IsNullOrWhiteSpace(key) && !Enum.TryParse(key.Trim(), ignoreCase: true, out k))
        {
            error = "sort: use name, created, modified, material, thickness or project.";
            return false;
        }
        bool desc;
        switch (dir?.Trim().ToLowerInvariant())
        {
            case null or "":
                // dates default to newest first, text and numbers to A–Z / small–large
                desc = k is SortKey.Created or SortKey.Modified;
                break;
            case "asc": desc = false; break;
            case "desc": desc = true; break;
            default:
                error = "dir: use asc or desc.";
                return false;
        }
        sort = new Sort(k, desc);
        return true;
    }

    /// <summary>Parts. Ties are broken by name, then id, so paging is stable.</summary>
    public IOrderedQueryable<Part> Apply(IQueryable<Part> q)
    {
        IOrderedQueryable<Part> o = Key switch
        {
            SortKey.Name => Descending ? q.OrderByDescending(p => p.Name) : q.OrderBy(p => p.Name),
            SortKey.Created => Descending ? q.OrderByDescending(p => p.CreatedAt) : q.OrderBy(p => p.CreatedAt),
            SortKey.Material => Descending
                ? q.OrderByDescending(p => p.Material.Name).ThenByDescending(p => p.ThicknessMm)
                : q.OrderBy(p => p.Material.Name).ThenBy(p => p.ThicknessMm),
            SortKey.Thickness => Descending
                ? q.OrderByDescending(p => p.ThicknessMm).ThenBy(p => p.Material.Name)
                : q.OrderBy(p => p.ThicknessMm).ThenBy(p => p.Material.Name),
            // parts without a project go last either way
            SortKey.Project => Descending
                ? q.OrderBy(p => p.Project == null).ThenByDescending(p => p.Project!.Code)
                : q.OrderBy(p => p.Project == null).ThenBy(p => p.Project!.Code),
            _ => Descending ? q.OrderByDescending(p => p.ModifiedAt) : q.OrderBy(p => p.ModifiedAt),
        };
        return Key == SortKey.Name ? o.ThenBy(p => p.Id) : o.ThenBy(p => p.Name).ThenBy(p => p.Id);
    }

    /// <summary>
    /// Jobs. A job can hold several materials and projects; material, thickness and project
    /// sort by the smallest value among the job's parts (jobs are normally one material).
    /// Jobs without parts go last for those keys.
    /// </summary>
    public IOrderedQueryable<Job> Apply(IQueryable<Job> q)
    {
        IOrderedQueryable<Job> o = Key switch
        {
            SortKey.Name => Descending ? q.OrderByDescending(j => j.Name) : q.OrderBy(j => j.Name),
            SortKey.Created => Descending ? q.OrderByDescending(j => j.CreatedAt) : q.OrderBy(j => j.CreatedAt),
            SortKey.Material => Descending
                ? q.OrderBy(j => !j.Parts.Any()).ThenByDescending(j => j.Parts.Min(jp => jp.Part.Material.Name))
                : q.OrderBy(j => !j.Parts.Any()).ThenBy(j => j.Parts.Min(jp => jp.Part.Material.Name)),
            SortKey.Thickness => Descending
                ? q.OrderBy(j => !j.Parts.Any()).ThenByDescending(j => j.Parts.Min(jp => jp.Part.ThicknessMm))
                : q.OrderBy(j => !j.Parts.Any()).ThenBy(j => j.Parts.Min(jp => jp.Part.ThicknessMm)),
            SortKey.Project => Descending
                ? q.OrderBy(j => !j.Parts.Any(jp => jp.Part.Project != null))
                    .ThenByDescending(j => j.Parts.Where(jp => jp.Part.Project != null).Min(jp => jp.Part.Project!.Code))
                : q.OrderBy(j => !j.Parts.Any(jp => jp.Part.Project != null))
                    .ThenBy(j => j.Parts.Where(jp => jp.Part.Project != null).Min(jp => jp.Part.Project!.Code)),
            _ => Descending ? q.OrderByDescending(j => j.ModifiedAt) : q.OrderBy(j => j.ModifiedAt),
        };
        return Key == SortKey.Name ? o.ThenBy(j => j.Id) : o.ThenBy(j => j.Name).ThenBy(j => j.Id);
    }
}
