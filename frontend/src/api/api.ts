import {
  DEFAULT_SORT,
  type SortOrder,
} from "./types";
import type {
  ImportSummary, JobFilter, JobPart, JobStatus, JobSummary, PartFilter, PartSummary, ProjectSummary,
} from "./types";
import { otherParts, testJobParts } from "./sampleParts";

// Until the backend exists, the app runs on sample data.
// Set VITE_USE_API=true (e.g. in .env.local) to call the real server instead.
const useApi = import.meta.env.VITE_USE_API === "true";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return (await res.json()) as T;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const materialKey = (m: string, t: number) => `${m} ${t} mm`;

// Jobs and their parts: same contents as the server's sample data.
interface SampleJob {
  id: string; name: string; status: JobStatus; sheetCount: number;
  createdHoursAgo: number; modifiedHoursAgo: number; modifiedBy: string;
  parts: [partId: string, qty: number][] | "test30";
}
const sampleJobRows: SampleJob[] = [
  { id: "j-2787", name: "Miha2787", status: "nested", sheetCount: 8, createdHoursAgo: 0.5, modifiedHoursAgo: 0.4, modifiedBy: "Miha", parts: "test30" },
  { id: "j-2786", name: "26-0412 Konzole", status: "released", sheetCount: 3, createdHoursAgo: 3.5, modifiedHoursAgo: 3, modifiedBy: "Miha", parts: [["k-01", 24], ["k-02", 12], ["k-03", 48]] },
  { id: "j-2785", name: "26-0409 Prirobnice", status: "cut", sheetCount: 2, createdHoursAgo: 25, modifiedHoursAgo: 20, modifiedBy: "Rok", parts: [["p-01", 4]] },
  { id: "j-2784", name: "26-0410 Ohišje", status: "draft", sheetCount: 0, createdHoursAgo: 26.5, modifiedHoursAgo: 26, modifiedBy: "Miha", parts: [["o-01", 2], ["o-02", 1]] },
  { id: "j-2781", name: "Ostanki teden 43", status: "cut", sheetCount: 1, createdHoursAgo: 60, modifiedHoursAgo: 50, modifiedBy: "Rok", parts: [["n-02", 5]] },
  { id: "j-2779", name: "26-0398 Nosilci", status: "cut", sheetCount: 4, createdHoursAgo: 78, modifiedHoursAgo: 75, modifiedBy: "Miha", parts: [["n-01", 16], ["n-02", 15]] },
];

const sampleImports: ImportSummary[] = [
  { id: "i-912", source: "TEST_30_industrial", project: "Miha2787", partCount: 30, materials: ["HARDOX 1 mm"], importedAt: hoursAgo(0.6), importedBy: "Miha", warnings: 0 },
  { id: "i-911", source: "26-0412_konzole.dwg", project: "26-0412", partCount: 12, materials: ["S235 3 mm"], importedAt: hoursAgo(4), importedBy: "Miha", warnings: 2 },
  { id: "i-910", source: "26-0410 Ohišje", project: "26-0410", partCount: 9, materials: ["INOX 1.4301 2 mm"], importedAt: hoursAgo(27), importedBy: "Miha", warnings: 0 },
  { id: "i-909", source: "26-0409_prirobnice", project: "26-0409", partCount: 6, materials: ["S355 10 mm", "S355 15 mm"], importedAt: hoursAgo(30), importedBy: "Rok", warnings: 1 },
  { id: "i-905", source: "26-0398 Nosilci", project: "26-0398", partCount: 18, materials: ["S235 8 mm"], importedAt: hoursAgo(80), importedBy: "Miha", warnings: 0 },
];

const sampleProjects: ProjectSummary[] = [
  { id: "p-2787", code: "Miha2787", name: "Test job – 30 industrial parts", partCount: 30, jobCount: 1, cutPercent: 0, lastActivityAt: hoursAgo(0.4) },
  { id: "p-0412", code: "26-0412", name: "Konzole za transporter", customer: "Kovinar d.o.o.", partCount: 12, jobCount: 1, cutPercent: 40, lastActivityAt: hoursAgo(3) },
  { id: "p-0410", code: "26-0410", name: "Ohišje krmilne omare", customer: "Elektro Vrhnika", partCount: 9, jobCount: 1, cutPercent: 0, lastActivityAt: hoursAgo(26) },
  { id: "p-0409", code: "26-0409", name: "Prirobnice DN200", customer: "Hidro Celje", partCount: 6, jobCount: 1, cutPercent: 100, lastActivityAt: hoursAgo(20) },
  { id: "p-0398", code: "26-0398", name: "Nosilci podesta", customer: "Gradnje Bovec", partCount: 18, jobCount: 2, cutPercent: 100, lastActivityAt: hoursAgo(75) },
];

const importTime = Object.fromEntries(sampleImports.map((i) => [i.id, i.importedAt]));

// "17_TRIANGLE_GUSSET_350X300" -> "Triangle gusset 350x300"
const describe = (name: string) => {
  const s = name.replace(/^\d+_/, "").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const ENGRAVED = new Set(["pt-03", "pt-08", "pt-11", "pt-22", "pt-24", "k-02", "o-01", "p-01"]);
const MODIFIED_LATER: Record<string, number> = { "pt-12": 0.2, "k-01": 1, "o-02": 5, "n-01": 30 };

const sampleParts: PartSummary[] = [
  ...testJobParts.map((p) => ({
    ...p, project: "Miha2787", material: "HARDOX", thicknessMm: 1, importId: "i-912",
  })),
  ...otherParts,
].map((p) => {
  const created = importTime[p.importId];
  const later = MODIFIED_LATER[p.id];
  return {
    ...p,
    description: describe(p.name),
    engraved: ENGRAVED.has(p.id),
    importedAt: created,
    createdAt: created,
    modifiedAt: later !== undefined ? hoursAgo(later) : created,
  };
});

const jobPartsOf = (j: SampleJob): JobPart[] =>
  j.parts === "test30"
    ? sampleParts.filter((p) => p.importId === "i-912").map((p) => ({ part: p, qty: p.qty }))
    : j.parts.map(([id, qty]) => ({ part: sampleParts.find((p) => p.id === id)!, qty }));

const sampleJobs: (JobSummary & { lines: JobPart[] })[] = sampleJobRows.map((j) => {
  const lines = jobPartsOf(j);
  const byMat = new Map<string, { material: string; thicknessMm: number; qty: number }>();
  for (const l of lines) {
    const k = materialKey(l.part.material, l.part.thicknessMm);
    const e = byMat.get(k) ?? { material: l.part.material, thicknessMm: l.part.thicknessMm, qty: 0 };
    e.qty += l.qty;
    byMat.set(k, e);
  }
  const main = [...byMat.values()].sort((a, b) => b.qty - a.qty)[0];
  return {
    id: j.id, name: j.name, status: j.status, sheetCount: j.sheetCount, modifiedBy: j.modifiedBy,
    material: main?.material ?? "", thicknessMm: main?.thicknessMm ?? 0,
    partCount: lines.reduce((n, l) => n + l.qty, 0),
    createdAt: hoursAgo(j.createdHoursAgo), modifiedAt: hoursAgo(j.modifiedHoursAgo),
    projects: [...new Set(lines.map((l) => l.part.project))].sort(),
    lines,
  };
});
const summary = ({ lines: _lines, ...j }: JobSummary & { lines: JobPart[] }): JobSummary => j;

const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00`).getTime();
const inDate = (iso: string, f?: { mode: string; date: string }) => {
  if (!f?.date) return true;
  const t = new Date(iso).getTime();
  const start = dayStart(f.date);
  const end = start + 86_400_000;
  return f.mode === "on" ? t >= start && t < end : f.mode === "upTo" ? t < end : t >= start;
};
const inRange = (v: number, min?: number, max?: number) =>
  (min === undefined || v >= min) && (max === undefined || v <= max);

/** Query string for the server: dates as created=on:2026-10-24, empty fields left out. */
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: false });

interface Sortable { name: string; createdAt: string; modifiedAt: string; material: string; thicknessMm: number; project: string }

/** Same order as the server: chosen key, then name. */
function sortRows<T>(rows: T[], s: SortOrder, view: (r: T) => Sortable): T[] {
  const sign = s.dir === "desc" ? -1 : 1;
  const cmp = (x: T, y: T) => {
    const a = view(x), b = view(y);
    let c = 0;
    switch (s.key) {
      case "name": c = text(a.name, b.name); break;
      case "created": c = a.createdAt.localeCompare(b.createdAt); break;
      case "modified": c = a.modifiedAt.localeCompare(b.modifiedAt); break;
      case "material": c = text(a.material, b.material) || a.thicknessMm - b.thicknessMm; break;
      case "thickness": c = (a.thicknessMm - b.thicknessMm) || sign * text(a.material, b.material); break;
      case "project":
        if (!a.project !== !b.project) return a.project ? -1 : 1; // no project last
        c = text(a.project, b.project); break;
    }
    return sign * c || text(a.name, b.name);
  };
  return [...rows].sort(cmp);
}

const partQuery = (f: object, s?: SortOrder) => {
  const q = new URLSearchParams();
  if (s) { q.set("sort", s.key); q.set("dir", s.dir); }
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === "" || v === false) continue;
    q.set(k, typeof v === "object" ? `${v.mode}:${v.date}` : String(v));
  }
  return q.toString();
};

export interface PartFacets {
  materials: string[];
  thicknesses: { material: string; thicknessMm: number }[];
}


const matches = (hay: string, needle?: string) =>
  !needle || hay.toLowerCase().includes(needle.trim().toLowerCase());

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export const api = {
  searchParts: (f: PartFilter, sort: SortOrder = DEFAULT_SORT) =>
    useApi
      ? get<PartSummary[]>(`/api/parts?${partQuery(f, sort)}`)
      : delay(sortRows(sampleParts.filter((p) =>
          matches(p.name, f.name) &&
          (!f.material || p.material === f.material) &&
          (f.thicknessMm === undefined || p.thicknessMm === f.thicknessMm) &&
          matches(p.project, f.project) &&
          matches(p.description, f.description) &&
          inDate(p.createdAt, f.created) &&
          inDate(p.modifiedAt, f.modified) &&
          inRange(p.w, f.xMin, f.xMax) &&
          inRange(p.h, f.yMin, f.yMax) &&
          (!f.engraved || p.engraved)), sort, (p) => p)),
  /** Distinct materials and thicknesses for the filter lists. */
  partFacets: (): Promise<PartFacets> =>
    useApi ? get<PartFacets>("/api/parts/facets") : delay({
      materials: [...new Set(sampleParts.map((p) => p.material))].sort(),
      thicknesses: [...new Set(sampleParts.map((p) => `${p.material}|${p.thicknessMm}`))]
        .map((s) => { const [m, t] = s.split("|"); return { material: m, thicknessMm: Number(t) }; })
        .sort((a, b) => a.thicknessMm - b.thicknessMm),
    }),
  searchJobs: (f: JobFilter, sort: SortOrder = DEFAULT_SORT) =>
    useApi
      ? get<JobSummary[]>(`/api/jobs?${partQuery(f, sort)}`)
      : delay(sortRows(sampleJobs.filter((j) =>
          matches(j.name, f.name) &&
          (!f.material && f.thicknessMm === undefined ||
            j.lines.some((l) => (!f.material || l.part.material === f.material) &&
              (f.thicknessMm === undefined || l.part.thicknessMm === f.thicknessMm))) &&
          (!f.project || j.lines.some((l) => matches(l.part.project, f.project))) &&
          (!f.part || j.lines.some((l) => matches(l.part.name, f.part))) &&
          inDate(j.createdAt, f.created) &&
          inDate(j.modifiedAt, f.modified) &&
          (!f.status || j.status === f.status)), sort, (j) => ({
            ...j,
            // jobs sort by the smallest material / thickness / project among their parts
            material: [...new Set(j.lines.map((l) => l.part.material))].sort(text)[0] ?? "",
            thicknessMm: Math.min(...j.lines.map((l) => l.part.thicknessMm)),
            project: j.projects[0] ?? "",
          })).map(summary)),
  /** Parts already in a job (sample: Miha2787 holds the 30-part test job). */
  jobParts: (jobId: string) =>
    useApi
      ? get<JobPart[]>(`/api/jobs/${jobId}/parts`)
      : delay<JobPart[]>(sampleJobs.find((j) => j.id === jobId)?.lines ?? []),
  imports: () => (useApi ? get<ImportSummary[]>("/api/imports") : delay(sampleImports)),
  recentJobs: (take = 8) =>
    useApi ? get<JobSummary[]>(`/api/jobs/recent?take=${take}`) : delay(sampleJobs.slice(0, take).map(summary)),
  recentProjects: (take = 8) =>
    useApi ? get<ProjectSummary[]>(`/api/projects/recent?take=${take}`) : delay(sampleProjects.slice(0, take)),
  recentImports: (take = 8) =>
    useApi ? get<ImportSummary[]>(`/api/imports/recent?take=${take}`) : delay(sampleImports.slice(0, take)),
};
