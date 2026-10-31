// Shapes of the data the home page needs from the server.
// These mirror the planned ASP.NET Core endpoints:
//   GET /api/jobs/recent?take=8      -> JobSummary[]
//   GET /api/imports/recent?take=8   -> ImportSummary[]
//   GET /api/projects/recent?take=8  -> ProjectSummary[]

export type JobStatus = "draft" | "nested" | "released" | "cut";

export interface JobSummary {
  id: string;
  name: string;            // job / work name, e.g. "Miha2787"
  material: string;        // e.g. "HARDOX"
  thicknessMm: number;
  partCount: number;
  sheetCount: number;      // 0 while not nested yet
  status: JobStatus;
  modifiedAt: string;      // ISO 8601
  modifiedBy: string;
  createdAt: string;       // ISO 8601
  projects: string[];      // project codes of the parts in the job
  materials: string[];     // every material in the job, A–Z
  thicknesses: number[];   // every thickness in the job, thin to thick
}

export interface ImportSummary {
  id: string;
  source: string;          // folder or file name the parts came from
  project: string;         // order number / project assigned on import
  partCount: number;
  materials: string[];     // e.g. ["S235 3 mm", "HARDOX 1 mm"]
  importedAt: string;      // ISO 8601
  importedBy: string;
  warnings: number;        // parts that need attention (open contours, unknown layer ...)
}

export interface ProjectSummary {
  id: string;
  code: string;            // order / project number, e.g. "26-0412"
  name: string;            // e.g. "Konzole za transporter"
  customer?: string;
  partCount: number;       // parts in the library tagged with this project
  jobCount: number;        // jobs that contain parts of this project
  cutPercent: number;      // share of ordered parts already cut, 0..100
  lastActivityAt: string;  // ISO 8601
}

/** One part in the library (one imported drawing). */
export interface PartSummary {
  id: string;
  name: string;
  project: string;
  material: string;
  thicknessMm: number;
  qty: number;             // ordered quantity from import
  w: number;               // bounding box [mm]
  h: number;
  areaMm2: number;
  path: string;            // SVG path of the outline + holes, y down, origin top-left
  description: string;
  engraved: boolean;       // has engraving / marking contours
  importId: string;
  importedAt: string;
  createdAt: string;       // ISO 8601, when the part entered the library
  modifiedAt: string;      // ISO 8601, last change to geometry or properties
  revision: number;        // 1 when first saved, +1 on every replace or restore
}

/** One version of a part (GET /api/parts/{id}/history); older ones can be restored. */
export interface PartVersion {
  revision: number;
  current: boolean;
  name: string;
  project: string;
  description: string;
  material: string;
  thicknessMm: number;
  rotations: number[];
  mirror: boolean;
  /** Nested only into gaps among other parts; never fills a sheet on its own. */
  filler: boolean;
  w: number;
  h: number;
  areaMm2: number;
  path: string;
  engraved: boolean;
  sourceFile: string;
  savedAt: string;
  replacedAt: string | null;
}

/** "Up to" includes the whole day; "On" is that calendar day; "From" starts at 00:00. */
export type DateMode = "upTo" | "on" | "from";

export interface DateFilter {
  mode: DateMode;
  date: string;            // yyyy-mm-dd
}

/** Part search, fields in order of importance. Empty fields are ignored. */
export interface PartFilter {
  name?: string;           // contains, case-insensitive
  material?: string;       // e.g. "S235"
  thicknessMm?: number;
  project?: string;        // contains
  description?: string;    // contains
  created?: DateFilter;
  modified?: DateFilter;
  xMin?: number;           // bounding box X [mm]
  xMax?: number;
  yMin?: number;           // bounding box Y [mm]
  yMax?: number;
  engraved?: boolean;      // true = only parts with engraving
}

/** Job search, as in the Job search panel. Empty fields are ignored. */
export interface JobFilter {
  name?: string;           // job name contains
  material?: string;       // job contains parts of this material
  thicknessMm?: number;    // ... and thickness
  project?: string;        // job contains parts of a project whose code contains this
  created?: DateFilter;
  modified?: DateFilter;
  part?: string;           // job contains a part whose name contains this
  status?: JobStatus;
}

/** Sort order for part and job lists. Dates default to newest first, others to A–Z / thin–thick. */
export type SortKey = "name" | "created" | "modified" | "material" | "thickness" | "project";
export interface SortOrder { key: SortKey; dir: "asc" | "desc" }
export const DEFAULT_SORT: SortOrder = { key: "modified", dir: "desc" };
export const defaultDir = (key: SortKey): SortOrder["dir"] => (key === "created" || key === "modified" ? "desc" : "asc");

/** A part placed in a job, with the quantity to cut in this job. */
export interface JobPart {
  part: PartSummary;
  qty: number;             // requested (QTY REQ)
  /** QTY MAX: nesting may add copies up to this into space that would be scrap; set to qty when qty changes. */
  qtyMax?: number;
  /** ID number in the job: given when the part is added, stays with it when the list is sorted. */
  no?: number;
  /** QTY NESTED: copies on the current nest (0 until nesting exists). */
  nested?: number;
}
