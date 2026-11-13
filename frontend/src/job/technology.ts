// Technology tables (Settings -> Machines -> Technology): per machine, the cutting values for each
// thickness. A technology (e.g. "ST37 80 A O2/Air") is used for the materials tagged on it and the
// thicknesses in its range; its rows hold kerf, speeds, pierce time, lead lengths and gaps.

import type { Technology } from "./machine";

export interface TechRow {
  thicknessMm: number;
  kerfMm: number;
  /** Cutting speed [mm/min] */
  speed: number;
  /** Speed for small holes [mm/min] */
  smallHoleSpeed: number;
  /** Holes up to this size are small holes [mm] */
  smallHoleMm: number;
  /** Pierce time [s] */
  pierceS: number;
  holeLeadInMm: number;
  holeLeadOutMm: number;
  /** Gap between the lead-in and lead-out points along the contour [mm]: + cuts past the start, − leaves a tab */
  holeGapMm?: number;
  /** Arc leads: radius [mm] */
  holeLeadRadiusMm?: number;
  outLeadInMm: number;
  outLeadOutMm: number;
  outGapMm?: number;
  /** Arc leads on the outline: radius [mm] */
  outLeadRadiusMm: number;
  /** Angled leads: lead-in / lead-out angle to the edge [°]; 0 = the type's default (corner 90°, angled 45°) */
  leadInAngle?: number;
  leadOutAngle?: number;
  partGapMm: number;
  borderMm: number;
  /** Remnant cuts: where the cut starts / ends from a sheet edge it runs to [mm]: + inside the sheet (an
   *  uncut bridge), − beyond the edge (off the plate) */
  remGapInMm?: number;
  remGapOutMm?: number;
  /** Remnant cuts: distance kept from the parts [mm]; 0 = Settings → Stock → Remnants */
  remMinDistMm?: number;
  /** Remnant cuts: lead-in / lead-out [mm] (the type: Leads & cutting) */
  remLeadInMm?: number;
  remLeadOutMm?: number;
  /** Laser: a contour up to this size (its longer side) is cut as a middle / little one (LVD E002 / E003);
   *  0 = not used */
  midSizeMm?: number;
  littleSizeMm?: number;
  /** Laser: pierce every contour first, then cut them (LVD #516): 1 = on, 0 = off */
  prePierce?: number;
  /** Laser: the machine's technology program for this row (LVD M98P..., e.g. 6050 = mild steel 5 mm); 0 = not set */
  techProgram?: number;
  /** Laser: AUTO CUT traces first, over the whole sheet, in the order of the shortest rapids: 1 = on,
   *  0 = off; not set = on from 4 mm up */
  traceShortest?: number;
  /** Micro joints (Process -> Micro joint): their length [mm] (0 = 1 mm) */
  mjGapMm?: number;
  /** after a micro joint the cut starts again with: 1 = a normal pierce, 2 = a quick pierce, 0 = no pierce */
  mjPierce?: number;
  /** Material tags of the technology this thickness is not for (not stocked or not cut in it): the
   *  thickness is left out of that material's thickness lists (import, part and sheet properties). The
   *  row's values still cut a sheet of it. Missing: for every tag. */
  skip?: string[];
  /** Other values of an imported table, kept as they came (by their name there) */
  extra?: Record<string, number>;
}

export interface TechSet {
  id: string;
  name: string;
  /** Material tags it is used for (S235, Mn12, ...) */
  materials: string[];
  /** Thicknesses it is used for [mm] */
  minMm: number;
  maxMm: number;
  rows: TechRow[];
}

export type RowKey = Exclude<keyof TechRow, "extra" | "skip">;

const low = (s: string) => s.trim().toLowerCase();
/** Is this thickness row for the material (one of its technology's tags, not skipped)? */
export const rowForMaterial = (r: TechRow, material: string) => !r.skip?.some((x) => low(x) === low(material));

export interface TechColumn {
  key: RowKey; label: string; unit: string; min?: number; max?: number;
  /** the value of a row that has none set (else 0) */
  def?: (r: TechRow) => number;
}

/** From this thickness up AUTO CUT traces in the order of the shortest rapids, unless the row says otherwise [mm] */
export const TRACE_SHORTEST_FROM_MM = 4;
const traceDefault = (r: TechRow) => (r.thicknessMm >= TRACE_SHORTEST_FROM_MM - 1e-6 ? 1 : 0);

/** A row's value in a column: what is set, else the column's default. */
export const cellValue = (r: TechRow, c: TechColumn): number => r[c.key] ?? c.def?.(r) ?? 0;

/** Does AUTO CUT trace over the whole sheet in the order of the shortest rapids with this row? */
export const traceShortestOf = (r: TechRow) => (r.traceShortest ?? traceDefault(r)) === 1;

/** The table's columns, in groups, as shown and exported. */
export const TECH_COLUMNS: { group: string; only?: Technology[]; cols: TechColumn[] }[] = [
  { group: "Cutting", cols: [
    { key: "kerfMm", label: "Kerf", unit: "mm" },
    { key: "speed", label: "Speed", unit: "mm/min" },
    { key: "smallHoleSpeed", label: "Small holes", unit: "mm/min" },
    { key: "smallHoleMm", label: "Small hole up to", unit: "mm" },
    { key: "pierceS", label: "Pierce", unit: "s" },
  ] },
  { group: "Holes · leads", cols: [
    { key: "holeLeadInMm", label: "Lead-in", unit: "mm" },
    { key: "holeLeadOutMm", label: "Lead-out", unit: "mm" },
    { key: "holeGapMm", label: "Gap", unit: "mm", min: -1000 },
    { key: "holeLeadRadiusMm", label: "Arc radius", unit: "mm" },
  ] },
  { group: "Outline · leads", cols: [
    { key: "outLeadInMm", label: "Lead-in", unit: "mm" },
    { key: "outLeadOutMm", label: "Lead-out", unit: "mm" },
    { key: "outGapMm", label: "Gap", unit: "mm", min: -1000 },
    { key: "outLeadRadiusMm", label: "Arc radius", unit: "mm" },
  ] },
  { group: "Angled leads", cols: [
    { key: "leadInAngle", label: "In angle", unit: "°", max: 180 },
    { key: "leadOutAngle", label: "Out angle", unit: "°", max: 180 },
  ] },
  { group: "Gaps", cols: [
    { key: "partGapMm", label: "Parts", unit: "mm" },
    { key: "borderMm", label: "Sheet trim", unit: "mm" },
  ] },
  { group: "Remnant cut", cols: [
    { key: "remGapInMm", label: "Gap in", unit: "mm", min: -1000 },
    { key: "remGapOutMm", label: "Gap out", unit: "mm", min: -1000 },
    { key: "remMinDistMm", label: "To parts", unit: "mm" },
    { key: "remLeadInMm", label: "Lead-in", unit: "mm" },
    { key: "remLeadOutMm", label: "Lead-out", unit: "mm" },
  ] },
  { group: "Micro joint", cols: [
    { key: "mjGapMm", label: "Length", unit: "mm", def: () => 1 },
    { key: "mjPierce", label: "Restart", unit: "0 none, 1 pierce, 2 quick", max: 2, def: () => 1 },
  ] },
  { group: "Laser", only: ["laser"], cols: [
    { key: "midSizeMm", label: "Middle up to", unit: "mm" },
    { key: "littleSizeMm", label: "Little up to", unit: "mm" },
    { key: "prePierce", label: "Pre-pierce", unit: "1 = on", max: 1 },
    { key: "techProgram", label: "Tech program", unit: "no.", max: 99999 },
    { key: "traceShortest", label: "Trace shortest", unit: "1 = on", max: 1, def: traceDefault },
  ] },
];

/** The column groups shown for a machine's technology (all when not known). */
export const techColumnsFor = (technology?: Technology) => TECH_COLUMNS.filter((g) => !g.only || !technology || g.only.includes(technology));

export const emptyRow = (thicknessMm: number): TechRow => ({
  thicknessMm, kerfMm: 0, speed: 0, smallHoleSpeed: 0, smallHoleMm: 0, pierceS: 0,
  holeLeadInMm: 0, holeLeadOutMm: 0, holeGapMm: 0, holeLeadRadiusMm: 0, outLeadInMm: 0, outLeadOutMm: 0, outGapMm: 0, outLeadRadiusMm: 0,
  leadInAngle: 0, leadOutAngle: 0, partGapMm: 0, borderMm: 0,
  remGapInMm: 0, remGapOutMm: 0, remMinDistMm: 0, remLeadInMm: 0, remLeadOutMm: 0,
  midSizeMm: 0, littleSizeMm: 0, prePierce: 0, techProgram: 0, mjGapMm: 1, mjPierce: 1,
});

export const newTechnology = (name = "New technology"): TechSet => ({
  id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name, materials: [], minMm: 0, maxMm: 0, rows: [],
});

const byThickness = (a: TechRow, b: TechRow) => a.thicknessMm - b.thicknessMm;

/** A new thickness: a copy of the next thicker row (else the next thinner one), with the new thickness. */
export function addThickness(t: TechSet, thicknessMm: number): TechSet {
  if (!(thicknessMm > 0) || t.rows.some((r) => Math.abs(r.thicknessMm - thicknessMm) < 1e-6)) return t;
  const rows = [...t.rows].sort(byThickness);
  const from = rows.find((r) => r.thicknessMm > thicknessMm) ?? rows[rows.length - 1];
  const row: TechRow = from ? { ...from, extra: from.extra && { ...from.extra }, skip: from.skip && [...from.skip], thicknessMm } : emptyRow(thicknessMm);
  return { ...t, rows: [...rows, row].sort(byThickness) };
}

/** Is this row used (its thickness in the technology's range)? A range of 0-0 means all. */
export const inRange = (t: TechSet, mm: number) => (!t.minMm && !t.maxMm) || (mm >= t.minMm - 1e-6 && mm <= (t.maxMm || Infinity) + 1e-6);

/** The materials the machines have a technology for: every material tag of their Technology tables
 *  (a table without tags takes any material, so it names none). One spelling each, A to Z. */
export function techMaterials(techSets: (TechSet[] | undefined)[]): string[] {
  const by = new Map<string, string>();
  for (const techs of techSets) for (const t of techs ?? []) for (const m of t.materials) {
    const k = m.trim().toLowerCase();
    if (k && !by.has(k)) by.set(k, m.trim());
  }
  return [...by.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** The thicknesses the machines have a Technology row for with this material (any material: all). */
export function techThicknesses(techSets: (TechSet[] | undefined)[], material: string): number[] {
  const m = material.trim().toLowerCase();
  const out = new Set<number>();
  for (const techs of techSets) for (const t of techs ?? []) {
    if (m && t.materials.length && !t.materials.some((x) => x.trim().toLowerCase() === m)) continue;
    // a row not for this material (its tag unticked on the row) is left out
    for (const r of t.rows) if (r.thicknessMm > 0 && inRange(t, r.thicknessMm) && (!m || !t.materials.length || rowForMaterial(r, m))) out.add(r.thicknessMm);
  }
  return [...out].sort((a, b) => a - b);
}

/** The row for a material and thickness: from the first technology tagged with that material whose range has it. */
export function techRowFor(techs: TechSet[] | undefined, material: string, thicknessMm: number): { tech: TechSet; row: TechRow } | null {
  const m = material.trim().toLowerCase();
  for (const tech of techs ?? []) {
    // no material tags: any material (on plasma only the thickness matters)
    if (tech.materials.length && !tech.materials.some((x) => x.toLowerCase() === m)) continue;
    if (!inRange(tech, thicknessMm)) continue;
    const row = tech.rows.find((r) => Math.abs(r.thicknessMm - thicknessMm) < 1e-6);
    if (row) return { tech, row };
  }
  return null;
}

// ---------------------------------------------------------------- import: dBASE (.DBF) table

/** The fields of a HACO material table (S_MAT.DBF), as named in its GEO / TIME / geolim files. */
const DBF_FIELDS: Partial<Record<RowKey, string>> = {
  kerfMm: "S13", speed: "S101", smallHoleSpeed: "S102", smallHoleMm: "S65", pierceS: "S107",
  holeLeadInMm: "S10", holeLeadOutMm: "S11", holeLeadRadiusMm: "S12", outLeadInMm: "S40", outLeadOutMm: "S41", outLeadRadiusMm: "S42",
  partGapMm: "S17", borderMm: "S18",
};

/** Reads a dBASE III table: field names and the rows (deleted ones left out), values as text. */
export function readDbf(buf: ArrayBuffer): { fields: string[]; rows: Record<string, string>[] } {
  const b = new DataView(buf), u8 = new Uint8Array(buf);
  if (buf.byteLength < 33) throw new Error("Not a dBASE table (too short)");
  const n = b.getUint32(4, true), headLen = b.getUint16(8, true), recLen = b.getUint16(10, true);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; o + 32 <= headLen && u8[o] !== 0x0d; o += 32) {
    let name = "";
    for (let i = 0; i < 11 && u8[o + i]; i++) name += String.fromCharCode(u8[o + i]);
    fields.push({ name: name.trim(), len: u8[o + 16] });
  }
  if (!fields.length || headLen + n * recLen > buf.byteLength + 1) throw new Error("Not a dBASE table");
  const dec = new TextDecoder("windows-1250");
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const at = headLen + i * recLen;
    if (u8[at] === 0x2a) continue;                       // deleted
    let p = at + 1;
    const row: Record<string, string> = {};
    for (const f of fields) { row[f.name] = dec.decode(u8.subarray(p, p + f.len)).trim(); p += f.len; }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

/** "ST37-80A-O2-AIR" -> "ST37 80 A O2/Air" */
function techName(code: string) {
  const parts = code.split("-").filter(Boolean);
  const gas = (g: string) => (g.length > 2 ? g[0] + g.slice(1).toLowerCase() : g);
  if (parts.length >= 2 && /^\d+A$/i.test(parts[1])) return `${parts[0]} ${parts[1].slice(0, -1)} A${parts.length > 2 ? " " + parts.slice(2).map(gas).join("/") : ""}`;
  return code;
}

/** Technologies from a material table (.DBF): one per technology name, a row per thickness. */
export function technologiesFromDbf(buf: ArrayBuffer): TechSet[] {
  const { fields, rows } = readDbf(buf);
  const has = (f: string) => fields.includes(f);
  if (!has("TECH") || !has("DIKTE")) throw new Error("This table has no TECH and DIKTE (thickness) columns");
  const num = (v: string | undefined) => { const x = parseFloat((v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
  const mapped = new Set(Object.values(DBF_FIELDS));
  const groups = new Map<string, TechSet>();
  for (const r of rows) {
    const code = r.TECH?.trim();
    const t = num(r.DIKTE);
    if (!code || !(t > 0)) continue;
    let tech = groups.get(code);
    if (!tech) { tech = { ...newTechnology(techName(code)), materials: [] }; groups.set(code, tech); }
    const row = emptyRow(t);
    for (const [k, f] of Object.entries(DBF_FIELDS)) (row as unknown as Record<string, number>)[k] = num(r[f!]);
    const extra: Record<string, number> = {};
    for (const f of fields) if (/^S\d+$/.test(f) && !mapped.has(f) && num(r[f])) extra[f] = num(r[f]);
    row.extra = extra;
    tech.rows.push(row);
  }
  return [...groups.values()].map((t) => {
    const rows = t.rows.sort(byThickness);
    return { ...t, rows, minMm: rows[0].thicknessMm, maxMm: rows[rows.length - 1].thicknessMm };
  });
}

// ---------------------------------------------------------------- export: CSV

export function technologiesCsv(techs: TechSet[], technology?: Technology): string {
  const groups = techColumnsFor(technology);
  const cols = groups.flatMap((g) => g.cols);
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["Technology", "Materials", "Used from mm", "Used to mm", "Thickness mm", "Thickness for materials", ...cols.map((c) => `${g(c.key)} ${c.label} ${c.unit}`)];
  function g(k: RowKey) { return groups.find((x) => x.cols.some((c) => c.key === k))!.group.replace(" · leads", ""); }
  const lines = [head.map(q).join(";")];
  for (const t of techs) for (const r of t.rows)
    lines.push([t.name, t.materials.join(", "), String(t.minMm), String(t.maxMm), String(r.thicknessMm), t.materials.filter((m) => rowForMaterial(r, m)).join(", "), ...cols.map((c) => String(cellValue(r, c)))].map(q).join(";"));
  return lines.join("\r\n") + "\r\n";
}
