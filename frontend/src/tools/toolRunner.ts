// SPECIAL TOOLS plug-ins: runs a tool in its sandbox worker (toolWorker.ts) from the page. One worker per
// tool (and per version of its script), started when first needed. A run that takes too long ends the
// worker (a loop that never ends cannot hang GNEZDO); the next run starts a fresh one.

import type { Entity } from "../import/geometry";
import type { ToolPart, ToolResult } from "./toolCore";
import { MAX_ENTITIES, MAX_PARTS } from "./toolCore";
import type { ToolPackage, ToolValues } from "./toolFormat";

/** How long one run (or loading) may take. */
export const TOOL_TIME_LIMIT_MS = 4000;

interface Sandbox { worker: Worker; loaded: Promise<string | null>; next: number; waiting: Map<number, (r: ToolResult) => void> }

const sandboxes = new Map<string, Sandbox>();

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const keyOf = (t: ToolPackage) => `${t.manifest.id}:${hash(t.script)}`;

function start(t: ToolPackage): Sandbox {
  const worker = new Worker(new URL("./toolWorker.ts", import.meta.url), { type: "module" });
  const sb: Sandbox = { worker, next: 1, waiting: new Map(), loaded: Promise.resolve(null) };
  sb.loaded = new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => { stop(t, sb); resolve("The tool took too long to load"); }, TOOL_TIME_LIMIT_MS);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; error?: string; id?: number; result?: unknown };
      if (m?.type === "loaded") { clearTimeout(timer); resolve(typeof m.error === "string" ? m.error : null); return; }
      if (m?.type === "result" && typeof m.id === "number") {
        const done = sb.waiting.get(m.id);
        if (done) { sb.waiting.delete(m.id); done(checked(m.result, t.manifest.id)); }
      }
    };
    worker.onerror = (e) => { e.preventDefault(); clearTimeout(timer); stop(t, sb); resolve(`The tool stopped: ${e.message || "an error in its worker"}`); };
  });
  worker.postMessage({ type: "load", script: t.script });
  return sb;
}

function stop(t: ToolPackage, sb: Sandbox) {
  sb.worker.terminate();
  for (const done of sb.waiting.values()) done({ error: `The tool took too long (more than ${TOOL_TIME_LIMIT_MS / 1000} s) and was stopped` });
  sb.waiting.clear();
  if (sandboxes.get(keyOf(t)) === sb) sandboxes.delete(keyOf(t));
}

/** The tool's parts for these values (or its problems with them, or why it failed). */
export async function runToolPackage(t: ToolPackage, values: ToolValues): Promise<ToolResult> {
  const key = keyOf(t);
  let sb = sandboxes.get(key);
  if (!sb) { sb = start(t); sandboxes.set(key, sb); }
  const loadError = await sb.loaded;
  if (loadError) return { error: loadError };
  const s = sb;
  return new Promise<ToolResult>((resolve) => {
    const id = s.next++;
    const timer = setTimeout(() => stop(t, s), TOOL_TIME_LIMIT_MS);
    s.waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
    s.worker.postMessage({ type: "run", id, values });
  });
}

/** Ends a tool's sandbox (removed, or changed). */
export function dropSandboxes(id?: string) {
  for (const [k, sb] of [...sandboxes]) {
    if (id && !k.startsWith(`${id}:`)) continue;
    sb.worker.terminate();
    sandboxes.delete(k);
    for (const done of sb.waiting.values()) done({ error: "The tool was loaded again" });
    sb.waiting.clear();
  }
}

// ---------------------------------------------------------------- what comes back from the worker is checked

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const P = (p: unknown) => !!p && fin((p as { x: unknown }).x) && fin((p as { y: unknown }).y);
const ROLES = new Set(["cut", "trace", "openCut"]);

function entityOk(e: unknown): e is Entity {
  const o = e as Record<string, unknown>;
  if (!o || typeof o !== "object" || (o.role !== undefined && !ROLES.has(o.role as string))) return false;
  if (o.kind === "line") return P(o.a) && P(o.b);
  if (o.kind === "arc") return P(o.c) && fin(o.r) && (o.r as number) > 0 && fin(o.start) && fin(o.end);
  if (o.kind === "circle") return P(o.c) && fin(o.r) && (o.r as number) > 0;
  return false;
}

function checked(r: unknown, toolId: string): ToolResult {
  const o = r as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return { error: "The tool gave nothing back" };
  if (typeof o.error === "string") return { error: o.error };
  if (!Array.isArray(o.parts) || !Array.isArray(o.problems)) return { error: "The tool gave back something unexpected" };
  const problems = o.problems.map((x) => String(x)).slice(0, 30);
  if (o.parts.length > MAX_PARTS) return { error: "Too many parts" };
  let total = 0;
  const parts: ToolPart[] = [];
  for (const p of o.parts as Record<string, unknown>[]) {
    if (!p || !Array.isArray(p.entities) || !fin(p.qty) || !fin(p.w) || !fin(p.h)) return { error: "The tool gave back a damaged part" };
    total += p.entities.length;
    if (total > MAX_ENTITIES) return { error: "Too many lines" };
    if (!p.entities.every(entityOk)) return { error: "The tool gave back a damaged line" };
    const key = String(p.key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 14) || "P";
    // the lines exactly as GNEZDO's own (ids of its own, no extra fields)
    const entities = (p.entities as Entity[]).map((e, i): Entity => {
      const id = `tool-${toolId}-${key}-${i + 1}`, role = e.role ?? "cut";
      if (e.kind === "line") return { id, kind: "line", a: { x: e.a.x, y: e.a.y }, b: { x: e.b.x, y: e.b.y }, role };
      if (e.kind === "arc") return { id, kind: "arc", c: { x: e.c.x, y: e.c.y }, r: e.r, start: e.start, end: e.end, role };
      const c = e as Extract<Entity, { kind: "circle" }>;
      return { id, kind: "circle", c: { x: c.c.x, y: c.c.y }, r: c.r, role };
    });
    parts.push({
      key, label: String(p.label ?? "part").slice(0, 60), qty: Math.max(0, Math.round(p.qty as number)),
      ...(typeof p.suffix === "string" ? { suffix: p.suffix.replace(/[\\/:*?"<>|]/g, "").slice(0, 20) } : {}),
      entities, w: p.w as number, h: p.h as number,
    });
  }
  const title = typeof o.title === "string" ? o.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) : undefined;
  return { parts, problems, ...(title ? { title } : {}) };
}
