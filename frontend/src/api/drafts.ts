// Recovery copies of job tabs with unsaved changes ("Restore unsaved work"): written every few
// seconds while a job has changes, offered back when GNEZDO starts, deleted once the job is saved
// or its changes are discarded. Each user's own. Not in the demo (nothing is kept there).
import { demoMode } from "./api";
import { diagHeaders } from "../job/diag";
import type { JobPart } from "./types";
import type { StockSheet } from "../job/stock";
import type { JobNests } from "../job/nest";

export interface DraftRow { id: string; name: string; jobId: number | null; parts: number; solutions: number; browser: string; savedAt: string }

/** A job tab as it is kept: enough to open it again as it was. */
export interface DraftContent {
  title: string;
  /** The saved job it changes (database id); null for a job never saved. */
  jobId: string | null;
  machine: string;
  parts: JobPart[];
  stock: StockSheet[];
  /** Finished solutions (a nest still running is not kept). */
  nest: JobNests | null;
  screen?: "parts" | "nest" | "nestReport" | "costReport";
}

const headers = (json = false): Record<string, string> => ({ Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}), ...diagHeaders() });

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

/** A new id: crypto.randomUUID only exists on https and this PC; a server on the network is plain http. */
export function newDraftId(): string {
  const r = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  return `${r()}-${r().slice(0, 4)}-${r().slice(0, 4)}-${r().slice(0, 4)}-${r()}${r().slice(0, 4)}`;
}

export const drafts = {
  list: async (): Promise<DraftRow[]> => (demoMode ? [] : (await ok(await fetch("/api/drafts", { headers: headers() }))).json()),
  get: async (id: string): Promise<DraftRow & { content: DraftContent }> =>
    (await ok(await fetch(`/api/drafts/${encodeURIComponent(id)}`, { headers: headers() }))).json(),
  put: async (id: string, c: DraftContent): Promise<void> => {
    if (demoMode) return;
    const body = {
      name: c.title, jobId: c.jobId && /^\d+$/.test(c.jobId) ? Number(c.jobId) : null,
      parts: c.parts.length, solutions: c.nest?.solutions.length ?? 0, content: c,
    };
    await ok(await fetch(`/api/drafts/${encodeURIComponent(id)}`, { method: "PUT", headers: headers(true), body: JSON.stringify(body) }));
  },
  remove: async (id: string): Promise<void> => {
    if (demoMode) return;
    await ok(await fetch(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }));
  },
};
