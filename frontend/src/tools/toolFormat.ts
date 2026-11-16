// SPECIAL TOOLS as plug-ins: a tool is a small folder (or a .gnezdo-tool.zip of it) that GNEZDO loads
// without a new build. The box (Special tools) shows its form, runs its math in a sandbox, shows the
// parts and sends them to Import 2D; the tool only says what it asks for and how its parts are made.
//
//   tool.json    what it is and what it asks for (this file's ToolManifest)
//   tool.js      its math: function parts(v, gz) { ... }   (optional: problems(v), title(v))
//   icon.svg     optional, its button in the Special tools strip (48 × 48)
//   diagram.svg  optional, the picture its value boxes sit on (300 × 220)
//
// The guide with an example: SPECIAL TOOLS/README.md in the repository.

import { unzip, zip } from "../job/machineFile";

export const TOOL_FORMAT = "gnezdo-tool";
/** The tool format this GNEZDO reads; a tool asking for a newer one is refused with a clear message. */
export const TOOL_FORMAT_VERSION = 1;
/** The whole tool (all its files) at most: tools are math, not data. */
export const TOOL_MAX_BYTES = 512 * 1024;

export type ToolFieldType = "number" | "int" | "check" | "choice" | "text";
export type ToolColor = "blue" | "green" | "purple" | "brown" | "red" | "dark" | "orange";
export const TOOL_COLORS: ToolColor[] = ["blue", "green", "purple", "brown", "red", "dark", "orange"];

export interface ToolField {
  /** The name the script reads it by: v.key */
  key: string;
  type: ToolFieldType;
  /** Short label: on its value box ("D") or before its input ("Holes") */
  label: string;
  /** The longer explanation (tooltip; "D: diameter") */
  title?: string;
  unit?: string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  /** On the diagram: where the value box sits (its center), in % of the diagram's width and height */
  at?: [number, number];
  color?: ToolColor;
  /** Fields not on the diagram: grouped under this heading (in the order they first appear) */
  group?: string;
  /** choice: the values to pick from (shown as buttons) */
  options?: { value: string | number; label: string }[];
  /** A line of help under the field */
  note?: string;
}

export interface ToolManifest {
  format: typeof TOOL_FORMAT;
  version: number;
  /** Lowercase letters, digits and dashes: the tool's identity (the same id again replaces it) */
  id: string;
  name: string;
  /** The tool's own version ("1.2"), shown in Settings */
  toolVersion?: string;
  author?: string;
  description?: string;
  /** What one set of its parts is called in the count field ("Plates"); default "Pieces" */
  countLabel?: string;
  /** The script file (default tool.js) */
  script?: string;
  icon?: string;
  diagram?: string;
  fields: ToolField[];
  /** A note under the form */
  note?: string;
}

/** A tool ready to use: its manifest and the contents of its files. */
export interface ToolPackage {
  manifest: ToolManifest;
  script: string;
  icon?: string;
  diagram?: string;
}

export type ToolValues = Record<string, number | boolean | string>;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const TYPES: ToolFieldType[] = ["number", "int", "check", "choice", "text"];

/** Checks a tool.json; the problems, in words (empty: fine). */
export function manifestProblems(m: unknown): string[] {
  const e: string[] = [];
  const o = m as Partial<ToolManifest> | null;
  if (!o || typeof o !== "object") return ["tool.json is not a JSON object"];
  if (o.format !== TOOL_FORMAT) e.push(`tool.json: "format" must be "${TOOL_FORMAT}"`);
  if (typeof o.version !== "number") e.push(`tool.json: "version" must be a number (${TOOL_FORMAT_VERSION})`);
  else if (o.version > TOOL_FORMAT_VERSION) e.push(`The tool needs a newer GNEZDO (tool format ${o.version}; this GNEZDO reads ${TOOL_FORMAT_VERSION})`);
  if (typeof o.id !== "string" || !ID.test(o.id)) e.push(`tool.json: "id" must be lowercase letters, digits and dashes ("plate-with-holes")`);
  if (typeof o.name !== "string" || !o.name.trim()) e.push(`tool.json: "name" is missing`);
  if (!Array.isArray(o.fields)) { e.push(`tool.json: "fields" must be a list`); return e; }
  const seen = new Set<string>();
  o.fields.forEach((f, i) => {
    const at = `field ${i + 1}${f && typeof f.key === "string" ? ` (${f.key})` : ""}`;
    if (!f || typeof f !== "object") { e.push(`tool.json: ${at} is not an object`); return; }
    if (typeof f.key !== "string" || !KEY.test(f.key)) e.push(`tool.json: ${at}: "key" must be a name like d, width or hole_d`);
    else if (seen.has(f.key)) e.push(`tool.json: ${at}: the key is used twice`);
    else seen.add(f.key);
    if (!TYPES.includes(f.type)) e.push(`tool.json: ${at}: "type" must be one of ${TYPES.join(", ")}`);
    if (typeof f.label !== "string") e.push(`tool.json: ${at}: "label" is missing`);
    const d = f.default;
    if (f.type === "number" || f.type === "int") {
      if (typeof d !== "number" || !Number.isFinite(d)) e.push(`tool.json: ${at}: "default" must be a number`);
      else if (f.type === "int" && !Number.isInteger(d)) e.push(`tool.json: ${at}: "default" must be a whole number`);
    }
    if (f.type === "check" && typeof d !== "boolean") e.push(`tool.json: ${at}: "default" must be true or false`);
    if (f.type === "text" && typeof d !== "string") e.push(`tool.json: ${at}: "default" must be text`);
    if (f.type === "choice") {
      if (!Array.isArray(f.options) || !f.options.length) e.push(`tool.json: ${at}: "options" must list the choices`);
      else if (!f.options.some((x) => x && x.value === d)) e.push(`tool.json: ${at}: "default" must be one of its options' values`);
    }
    if (f.at !== undefined && !(Array.isArray(f.at) && f.at.length === 2 && f.at.every((x) => typeof x === "number"))) e.push(`tool.json: ${at}: "at" must be [left %, top %]`);
    if (f.color !== undefined && !TOOL_COLORS.includes(f.color)) e.push(`tool.json: ${at}: "color" must be one of ${TOOL_COLORS.join(", ")}`);
  });
  return e;
}

/** The tool's values: its defaults, with what was entered for fields that still exist (and still fit). */
export function toolValues(m: ToolManifest, given?: ToolValues): ToolValues {
  const v: ToolValues = {};
  for (const f of m.fields) {
    const g = given?.[f.key];
    const ok = f.type === "check" ? typeof g === "boolean"
      : f.type === "text" ? typeof g === "string"
      : f.type === "choice" ? !!f.options?.some((o) => o.value === g)
      : typeof g === "number" && Number.isFinite(g);
    v[f.key] = ok ? g! : f.default;
  }
  return v;
}

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b).replace(/^﻿/, "") : undefined);

/** A tool from its files (a zip's, or a folder's as the desktop reads it), by name; a zip may hold one folder. */
export function toolFromFiles(files: Map<string, Uint8Array | string>): ToolPackage {
  const total = [...files.values()].reduce((s, f) => s + (typeof f === "string" ? f.length : f.length), 0);
  if (total > TOOL_MAX_BYTES) throw new Error(`The tool is too big (${Math.round(total / 1024)} KB; at most ${TOOL_MAX_BYTES / 1024} KB)`);
  const names = [...files.keys()].filter((n) => !n.endsWith("/"));
  const jsonName = names.filter((n) => /(^|\/)tool\.json$/i.test(n)).sort((a, b) => a.length - b.length)[0];
  if (!jsonName) throw new Error("There is no tool.json in it");
  const dir = jsonName.slice(0, jsonName.length - "tool.json".length);
  const get = (name: string) => {
    const f = files.get(dir + name) ?? files.get([...files.keys()].find((k) => k.toLowerCase() === (dir + name).toLowerCase()) ?? "");
    return typeof f === "string" ? f : text(f);
  };
  let manifest: ToolManifest;
  try { manifest = JSON.parse(get("tool.json")!); } catch (e) { throw new Error(`tool.json is not valid JSON: ${(e as Error).message}`); }
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(problems.join("; "));
  const scriptName = manifest.script || "tool.js";
  const script = get(scriptName);
  if (script === undefined) throw new Error(`There is no ${scriptName} (the tool's script) next to tool.json`);
  const icon = manifest.icon ? get(manifest.icon) : undefined;
  if (manifest.icon && icon === undefined) throw new Error(`There is no ${manifest.icon} (the tool's icon) next to tool.json`);
  const diagram = manifest.diagram ? get(manifest.diagram) : undefined;
  if (manifest.diagram && diagram === undefined) throw new Error(`There is no ${manifest.diagram} (the tool's diagram) next to tool.json`);
  return { manifest, script, ...(icon ? { icon } : {}), ...(diagram ? { diagram } : {}) };
}

/** A tool from a .gnezdo-tool.zip (or a zip of the tool's folder). */
export async function readToolZip(buf: ArrayBuffer): Promise<ToolPackage> {
  const u8 = new Uint8Array(buf);
  if (!(u8[0] === 0x50 && u8[1] === 0x4b)) throw new Error("Not a zip file (a tool comes as .gnezdo-tool.zip)");
  if (u8.length > TOOL_MAX_BYTES * 2) throw new Error(`The file is too big for a tool (at most ${TOOL_MAX_BYTES / 1024} KB unpacked)`);
  return toolFromFiles(await unzip(buf));
}

export const toolFileName = (t: ToolPackage) => `${t.manifest.id}.gnezdo-tool.zip`;

/** The tool as a .gnezdo-tool.zip again (to pass on or change). */
export function toolZip(t: ToolPackage): Uint8Array {
  const enc = new TextEncoder();
  const files = [
    { name: "tool.json", data: enc.encode(JSON.stringify(t.manifest, null, 2)) },
    { name: t.manifest.script || "tool.js", data: enc.encode(t.script) },
  ];
  if (t.icon && t.manifest.icon) files.push({ name: t.manifest.icon, data: enc.encode(t.icon) });
  if (t.diagram && t.manifest.diagram) files.push({ name: t.manifest.diagram, data: enc.encode(t.diagram) });
  return zip(files);
}

/** An SVG for an <img> (an image cannot run scripts or reach the page). */
export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
