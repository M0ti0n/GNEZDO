// SPECIAL TOOLS plug-ins: which tools there are. Two places:
//   added   Settings -> Special tools -> Add tool (.gnezdo-tool.zip): kept in GNEZDO's database (the
//           "specialTools" setting), so on the server everyone has them and backups carry them; only an
//           admin adds or removes them there. The demo keeps them in this browser.
//   folder  the desktop's tools folder (%LOCALAPPDATA%\GNEZDO\tools): read again with Reload, for writing
//           a tool. A folder tool wins over an added one with the same id.
// A tool can be switched off (kept, not in the Special tools strip).

import { useEffect, useSyncExternalStore } from "react";
import { api, demoMode } from "../api/api";
import { diagHeaders } from "../job/diag";
import { toolFromFiles, type ToolPackage } from "./toolFormat";
import { dropSandboxes } from "./toolRunner";

export interface AddedTool extends ToolPackage { addedAt: string }
interface Saved { tools: AddedTool[]; off?: string[] }

export interface ToolEntry {
  pkg: ToolPackage;
  source: "added" | "folder";
  /** folder: its folder or zip name in the tools folder */
  where?: string;
  addedAt?: string;
  on: boolean;
  /** an added tool with the same id as a folder tool (the folder's is used) */
  hidden?: boolean;
}

interface State {
  added: AddedTool[];
  off: string[];
  folder: { dir: string; tools: { name: string; pkg: ToolPackage }[]; problems: { name: string; message: string }[] } | null;
  loaded: boolean;
  error: string | null;
}

let state: State = { added: [], off: [], folder: null, loaded: false, error: null };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };

const LOCAL = "gnezdo.specialTools";
const KEY = "specialTools";

function clean(v: unknown): Saved {
  const o = v as Partial<Saved> | null;
  const tools = Array.isArray(o?.tools) ? o!.tools.filter((t) => t && t.manifest && typeof t.script === "string") : [];
  return { tools, off: Array.isArray(o?.off) ? o!.off.filter((x) => typeof x === "string") : [] };
}

async function readFolder(): Promise<State["folder"]> {
  if (demoMode) return null;
  const res = await fetch("/api/tools/folder", { credentials: "same-origin", headers: { Accept: "application/json", ...diagHeaders() } });
  if (res.status === 404) return null;   // the server version: no tools folder
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const j = (await res.json()) as { folder: string; tools: { name: string; files: Record<string, string> }[]; problems: { name: string; message: string }[] };
  const tools: { name: string; pkg: ToolPackage }[] = [];
  const problems = [...j.problems];
  for (const t of j.tools) {
    try { tools.push({ name: t.name, pkg: toolFromFiles(new Map(Object.entries(t.files))) }); }
    catch (e) { problems.push({ name: t.name, message: (e as Error).message }); }
  }
  return { dir: j.folder, tools, problems };
}

/** Loads (or loads again) the added tools and the tools folder. */
export async function loadTools(): Promise<void> {
  try {
    let saved: Saved;
    if (demoMode) { try { saved = clean(JSON.parse(localStorage.getItem(LOCAL) ?? "null")); } catch { saved = clean(null); } }
    else saved = clean(await api.setting<Saved>(KEY));
    let folder: State["folder"] = null, error: string | null = null;
    try { folder = await readFolder(); } catch (e) { error = `The tools folder could not be read: ${(e as Error).message}`; }
    dropSandboxes();   // a changed script gets a fresh sandbox
    set({ added: saved.tools, off: saved.off ?? [], folder, loaded: true, error });
  } catch (e) {
    set({ loaded: true, error: `The special tools could not be loaded: ${(e as Error).message}` });
  }
}

async function save(added: AddedTool[], off: string[]) {
  const value: Saved = { tools: added, off };
  if (demoMode) { try { localStorage.setItem(LOCAL, JSON.stringify(value)); } catch { /* kept for this session */ } }
  else await api.saveSetting(KEY, value);
  set({ added, off });
}

/** Adds a tool (a tool with the same id is replaced: a newer version). */
export async function addTool(pkg: ToolPackage): Promise<"added" | "replaced"> {
  const had = state.added.some((t) => t.manifest.id === pkg.manifest.id);
  const t: AddedTool = { ...pkg, addedAt: new Date().toISOString() };
  await save([...state.added.filter((x) => x.manifest.id !== pkg.manifest.id), t].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)), state.off);
  dropSandboxes(pkg.manifest.id);
  return had ? "replaced" : "added";
}

export async function removeTool(id: string): Promise<void> {
  await save(state.added.filter((x) => x.manifest.id !== id), state.off.filter((x) => x !== id || state.folder?.tools.some((t) => t.pkg.manifest.id === id)));
  dropSandboxes(id);
}

export async function setToolOn(id: string, on: boolean): Promise<void> {
  await save(state.added, on ? state.off.filter((x) => x !== id) : [...new Set([...state.off, id])]);
}

/** All tools, the folder's first; on or off. */
export function toolEntries(s: State = state): ToolEntry[] {
  const folderIds = new Set(s.folder?.tools.map((t) => t.pkg.manifest.id) ?? []);
  const out: ToolEntry[] = [];
  const seen = new Set<string>();
  for (const t of s.folder?.tools ?? []) {
    if (seen.has(t.pkg.manifest.id)) continue;   // two folders with the same id: the first
    seen.add(t.pkg.manifest.id);
    out.push({ pkg: t.pkg, source: "folder", where: t.name, on: !s.off.includes(t.pkg.manifest.id) });
  }
  for (const t of s.added) {
    const { addedAt, ...pkg } = t;
    out.push({ pkg, source: "added", addedAt, on: !s.off.includes(t.manifest.id), ...(folderIds.has(t.manifest.id) ? { hidden: true } : {}) });
  }
  return out;
}

/** The tools in the Special tools strip (on, not hidden). */
export const activeTools = (s: State = state) => toolEntries(s).filter((e) => e.on && !e.hidden).map((e) => e.pkg);

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

/** The tools' state, kept up to date (loaded the first time it is used). */
export function useToolStore(): State {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!state.loaded && !loading) { loading = true; void loadTools().finally(() => { loading = false; }); }
  }, []);
  return s;
}
let loading = false;

/** The added tools and which are off, as saved (Settings → Data → Export settings). */
export async function toolsSetting(): Promise<{ tools: AddedTool[]; off: string[] }> {
  if (!state.loaded) await loadTools();
  return { tools: state.added, off: state.off };
}

/** Replaces the added tools and which are off (Settings → Data → Import settings). */
export async function replaceToolsSetting(v: unknown): Promise<void> {
  const s = clean(v);
  await save(s.tools, s.off ?? []);
  dropSandboxes();
}
