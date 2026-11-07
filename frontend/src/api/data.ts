// Where GNEZDO keeps its data (Settings -> Data), and the server's database setup page.
import { demoMode } from "./api";
import { diagHeaders } from "../job/diag";

export type DataInfo =
  | { kind: "demo" }
  | { kind: "file"; folder: string; file: string; sizeMb: number }
  | { kind: "sqlite"; file: string }
  | { kind: "sqlserver"; server: string; database: string; login: string; canChange: boolean };

export interface DbForm { server: string; database: string; windowsLogin: boolean; user: string; password: string; trustCertificate: boolean }
export interface DbCheck { ok: boolean; message: string; found?: string | null }
export interface DbSaved { ok: boolean; message: string; restart?: boolean }

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...diagHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = (await res.json()) as { message?: string }; if (j.message) msg = j.message; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const data = {
  info: (): Promise<DataInfo> => (demoMode ? Promise.resolve({ kind: "demo" }) : call<DataInfo>("/api/data")),
  openFolder: () => call<void>("/api/data/open-folder", "POST"),
  backupUrl: "/api/data/backup",
  test: (f: DbForm) => call<DbCheck>("/api/setup/test", "POST", f),
  save: (f: DbForm) => call<DbSaved>("/api/setup/save", "POST", f),
};
