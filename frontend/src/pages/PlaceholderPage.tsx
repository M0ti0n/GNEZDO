import type { PageKind } from "../state/tabs";

const TEXT: Record<string, string> = {
  import: "Bulk import of DXF and DWG drawings: order number per part, cut and marking layers, material and thickness.",
  jobSearch: "Search jobs by name, order number, part, material or date.",
  projects: "All projects (order numbers) with their parts, jobs and how much is already cut.",
  project: "Parts, jobs and cutting progress for this project.",
  settings: "Machines, technology table, users and import rules.",
  library: "All imported parts, with search by name, import date and use in jobs.",
  stock: "Stock sheets and registered remnants.",
  technology: "Technology profiles per machine: kerf, spacing, edge margin and lead-ins.",
  job: "Job table, nesting, processing and report for this job.",
};

// Stand-in for pages that are not built yet.
export function PlaceholderPage({ tab }: { tab: { kind: PageKind; title: string } }) {
  return (
    <div className="placeholder">
      <h1>{tab.title}</h1>
      <p>{TEXT[tab.kind] ?? ""}</p>
      <p className="placeholder-note">This page is not built yet.</p>
    </div>
  );
}
