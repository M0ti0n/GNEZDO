import {
  DEFAULT_SORT,
  type SortOrder,
} from "./types";
import type {
  ImportSummary, JobFilter, JobPart, JobStatus, JobSummary, PartFilter, PartSummary, PartVersion, ProjectSummary,
} from "./types";
import { otherParts, testJobParts } from "./sampleParts";

// Until the backend exists, the app runs on sample data.
// Set VITE_USE_API=true (e.g. in .env.local) to call the real server instead.
const useApi = import.meta.env.VITE_USE_API === "true";
/** Sample data only: nothing is saved (shown as DEMO in the green bar). */
export const demoMode = !useApi;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return (await res.json()) as T;
}

async function post<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    // validation problems come back as { errors: { field: [messages] } }
    let detail = "";
    try {
      const j = await res.json();
      detail = j.message ?? Object.values(j.errors ?? {}).flat().join(" ");
    } catch { /* not JSON */ }
    throw new Error(detail || `${res.status} ${res.statusText} (${url})`);
  }
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
  { id: "j-2785", name: "26-0409 Prirobnice", status: "cut", sheetCount: 2, createdHoursAgo: 25, modifiedHoursAgo: 20, modifiedBy: "Rok", parts: [["p-01", 4], ["p-02", 2]] },
  { id: "j-2784", name: "26-0410 Ohišje", status: "draft", sheetCount: 0, createdHoursAgo: 26.5, modifiedHoursAgo: 26, modifiedBy: "Miha", parts: [["o-01", 2], ["o-02", 1]] },
  { id: "j-2781", name: "Ostanki teden 43", status: "cut", sheetCount: 1, createdHoursAgo: 60, modifiedHoursAgo: 50, modifiedBy: "Rok", parts: [["n-02", 5], ["k-03", 2], ["o-02", 1]] },
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
    revision: 1,
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
    materials: [...new Set(lines.map((l) => l.part.material))].sort(),
    thicknesses: [...new Set(lines.map((l) => l.part.thicknessMm))].sort((a, b) => a - b),
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

/** Same part = same project (or both none) and same name, ignoring case. */
export interface PartKey { name: string; project: string }
export interface ExistingPart extends PartKey { id: string; modifiedAt: string }

/** A processed part from the import screen, as POST /api/parts takes it. */
export interface SavePart extends PartKey {
  description: string;
  material: string;
  thicknessMm: number;
  rotations: number[];
  mirror: boolean;
  /** Filler: nested only into gaps left among the other parts. */
  filler: boolean;
  widthMm: number;
  heightMm: number;
  areaMm2: number;
  outlinePath: string;   // y down, origin top-left
  engraved: boolean;
  geometry: string;      // entities as JSON
  sourceFile: string;
  /** Replace a part with the same project and name; otherwise it is reported as "exists". */
  replace: boolean;
}
export interface SavedPart extends PartKey { id: string | null; status: "created" | "replaced" | "exists" }

const sameKey = (a: PartKey, b: PartKey) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
  a.project.trim().toLowerCase() === b.project.trim().toLowerCase();

let mockSeq = 0;

/** Sample mode: kept versions of replaced parts, by part id, newest first. */
const mockHistory = new Map<string, PartVersion[]>();
const extra = new Map<string, { rotations: number[]; mirror: boolean; filler: boolean; sourceFile: string }>();

const versionOf = (p: PartSummary, current: boolean, replacedAt: string | null): PartVersion => ({
  revision: p.revision, current, name: p.name, project: p.project, description: p.description,
  material: p.material, thicknessMm: p.thicknessMm,
  rotations: extra.get(p.id)?.rotations ?? [90], mirror: extra.get(p.id)?.mirror ?? false,
  filler: extra.get(p.id)?.filler ?? false,
  w: p.w, h: p.h, areaMm2: p.areaMm2, path: p.path, engraved: p.engraved,
  sourceFile: extra.get(p.id)?.sourceFile ?? "", savedAt: p.modifiedAt, replacedAt,
});

function mockRestore(id: string, revision: number): PartSummary {
  const i = sampleParts.findIndex((p) => p.id === id);
  const old = mockHistory.get(id)?.find((v) => v.revision === revision);
  if (i < 0 || !old) throw new Error(`Part ${id} has no older version ${revision}.`);
  const now = new Date().toISOString();
  const cur = sampleParts[i];
  mockHistory.set(id, [versionOf(cur, false, now), ...(mockHistory.get(id) ?? [])]);
  sampleParts[i] = {
    ...cur, name: old.name, project: old.project, description: old.description, material: old.material, thicknessMm: old.thicknessMm,
    w: old.w, h: old.h, areaMm2: old.areaMm2, path: old.path, engraved: old.engraved,
    modifiedAt: now, revision: cur.revision + 1,
  };
  extra.set(id, { rotations: old.rotations, mirror: old.mirror, filler: old.filler, sourceFile: old.sourceFile });
  return sampleParts[i];
}

/** Sample mode: projects saved with "Save new project". */
const knownProject = (code: string) =>
  !code.trim() || sampleProjects.some((s) => s.code.toLowerCase() === code.trim().toLowerCase());

/** Sample mode: saved parts go into the sample library, so Parts search finds them. */
function mockSave(parts: SavePart[]): SavedPart[] {
  const unknown = parts.find((p) => !knownProject(p.project));
  if (unknown) throw new Error(`Project ${unknown.project.trim()} is not in the database. Save the project first.`);
  return parts.map((p) => {
    const i = sampleParts.findIndex((x) => sameKey(x, p));
    if (i >= 0 && !p.replace) return { name: p.name, project: p.project, id: sampleParts[i].id, status: "exists" };
    const now = new Date().toISOString();
    if (i >= 0) mockHistory.set(sampleParts[i].id, [versionOf(sampleParts[i], false, now), ...(mockHistory.get(sampleParts[i].id) ?? [])]);
    const row: PartSummary = {
      id: i >= 0 ? sampleParts[i].id : `new-${++mockSeq}`,
      name: p.name.trim(), project: p.project.trim(), material: p.material.trim(), thicknessMm: p.thicknessMm,
      qty: 1, w: p.widthMm, h: p.heightMm, areaMm2: p.areaMm2, path: p.outlinePath,
      description: p.description, engraved: p.engraved, importId: "i-new",
      importedAt: now, createdAt: i >= 0 ? sampleParts[i].createdAt : now, modifiedAt: now,
      revision: i >= 0 ? sampleParts[i].revision + 1 : 1,
    };
    extra.set(row.id, { rotations: p.rotations, mirror: p.mirror, filler: p.filler, sourceFile: p.sourceFile });
    if (i >= 0) sampleParts[i] = row; else sampleParts.unshift(row);
    return { name: row.name, project: row.project, id: row.id, status: i >= 0 ? "replaced" : "created" };
  });
}

/** A project in a pick list. */
export interface ProjectOption { code: string; name: string; customer?: string | null }

/** A saved part with everything its Properties window shows. */
export interface PartDetail { part: PartSummary; rotations: number[]; mirror: boolean; filler: boolean; sourceFile: string }
export interface PartUpdate {
  name: string; project: string; description: string; material: string; thicknessMm: number;
  rotations: number[]; mirror: boolean; filler: boolean;
}

function mockUpdate(id: string, u: PartUpdate): PartDetail {
  const i = sampleParts.findIndex((p) => p.id === id);
  if (i < 0) throw new Error("Part not found");
  if (!knownProject(u.project)) throw new Error(`Project ${u.project.trim()} is not in the database. Save the project first.`);
  if (sampleParts.some((p) => p.id !== id && p.name.toLowerCase() === u.name.trim().toLowerCase() && p.project.toLowerCase() === u.project.trim().toLowerCase()))
    throw new Error(`Another part is already called ${u.name.trim()} in ${u.project.trim() || "no project"}.`);
  const now = new Date().toISOString();
  const cur = sampleParts[i];
  mockHistory.set(id, [versionOf(cur, false, now), ...(mockHistory.get(id) ?? [])]);
  sampleParts[i] = { ...cur, name: u.name.trim(), project: u.project.trim(), description: u.description.trim(),
    material: u.material.trim(), thicknessMm: u.thicknessMm, modifiedAt: now, revision: cur.revision + 1 };
  extra.set(id, { rotations: u.rotations, mirror: u.mirror, filler: u.filler, sourceFile: extra.get(id)?.sourceFile ?? "" });
  return detailOf(sampleParts[i]);
}

const detailOf = (p: PartSummary): PartDetail =>
  ({ part: p, rotations: extra.get(p.id)?.rotations ?? [90], mirror: extra.get(p.id)?.mirror ?? false,
    filler: extra.get(p.id)?.filler ?? false, sourceFile: extra.get(p.id)?.sourceFile ?? "" });

export const api = {
  /** One saved part with rotations, mirror, filler and source file. */
  part: (id: string): Promise<PartDetail> => {
    if (useApi) return get<PartDetail>(`/api/parts/${id}`);
    const p = sampleParts.find((x) => x.id === id);
    return p ? delay(detailOf(p)) : Promise.reject(new Error("Part not found"));
  },
  /** Changes a saved part's properties; the version before is kept in its history. */
  updatePart: (id: string, u: PartUpdate): Promise<PartDetail> =>
    useApi ? post<PartDetail>(`/api/parts/${id}`, u, "PUT") : delay(0).then(() => mockUpdate(id, u)),
  /** Removes a part from searches and lists (kept in the database for jobs that use it). */
  deletePart: (id: string): Promise<void> =>
    useApi ? post<void>(`/api/parts/${id}`, undefined, "DELETE") : delay(0).then(() => {
      const i = sampleParts.findIndex((p) => p.id === id);
      if (i >= 0) sampleParts.splice(i, 1);
    }),
  /** Saves a new project; parts can only use saved projects. */
  createProject: (code: string, name = "", customer = ""): Promise<ProjectOption> =>
    useApi ? post<ProjectOption>("/api/projects", { code, name, customer }) : delay(0).then(() => {
      if (knownProject(code) && code.trim()) throw new Error(`Project ${code.trim()} is already in the database.`);
      const p: ProjectSummary = { id: `p-${code}`, code: code.trim(), name, customer: customer || undefined, partCount: 0, jobCount: 0, cutPercent: 0, lastActivityAt: new Date().toISOString() };
      sampleProjects.unshift(p);
      return { code: p.code, name: p.name, customer: p.customer };
    }),
  /** Current and earlier versions of a part, newest first. */
  partHistory: (id: string): Promise<PartVersion[]> => {
    if (useApi) return get<PartVersion[]>(`/api/parts/${id}/history`);
    const cur = sampleParts.find((p) => p.id === id);
    return cur ? delay([versionOf(cur, true, null), ...(mockHistory.get(id) ?? [])]) : Promise.reject(new Error("Part not found"));
  },
  /** Makes an older version current again; the current one goes into the history. */
  restorePart: (id: string, revision: number): Promise<PartSummary> =>
    useApi ? post<PartSummary>(`/api/parts/${id}/restore`, { revision }) : delay(mockRestore(id, revision)),
  /** Every project code, newest first (sample mode: sample projects plus saved ones). */
  projectOptions: (): Promise<ProjectOption[]> =>
    useApi ? get<ProjectOption[]>("/api/projects") : delay([
      ...sampleProjects.map((s) => ({ code: s.code, name: s.name, customer: s.customer })),
    ]),
  /** Which of these parts are already in the database. */
  existingParts: (keys: PartKey[]) =>
    useApi
      ? post<ExistingPart[]>("/api/parts/existing", keys)
      : delay(sampleParts.filter((p) => keys.some((k) => sameKey(p, k)))
          .map((p) => ({ name: p.name, project: p.project, id: p.id, modifiedAt: p.modifiedAt }))),
  /** Saves processed parts to the library. */
  saveParts: (parts: SavePart[], source: string) =>
    useApi
      ? post<SavedPart[]>("/api/parts", { parts, source, importedBy: "" })
      : delay(0).then(() => mockSave(parts)),
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
