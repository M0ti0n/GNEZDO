// The browser's part of the diagnostic log (Settings -> Diagnostic log): what was done here and what
// went wrong, sent to the server's log - at once after an error, else every two minutes and when the
// page is closed. Nothing is kept or sent while the log is switched off on the server. Only what is
// needed to follow what happened: names, counts, modes; no drawings or outlines.

export interface DiagEvent { t: string; kind: string; msg: string; data?: unknown }

const MAX = 400;           // kept in memory at most (the oldest go first)
const EVERY_MS = 120_000;  // sent this often when nothing went wrong

let buffer: DiagEvent[] = [];
let enabled = false;       // until the server says the log is on
let user = "";
let started = false;

/** This browser's id: random, kept, so one person's events can be followed in the log. */
export const browserId: string = (() => {
  try {
    const k = "gnezdo.browserId";
    const v = localStorage.getItem(k);
    if (v) return v;
    const n = `b-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, n);
    return n;
  } catch { return `b-${Math.random().toString(36).slice(2, 10)}`; }
})();

export const diagUser = () => user;

/** Headers with every call, so the server's log says who it was. */
export const diagHeaders = (): Record<string, string> => (user ? { "X-Gnezdo-User": user, "X-Gnezdo-Browser": browserId } : { "X-Gnezdo-Browser": browserId });

/** Something happened here. kind: a short word (tool, nest, save, error...); msg: what, readable. */
export function diag(kind: string, msg: string, data?: unknown) {
  if (!enabled) return;
  buffer.push({ t: new Date().toISOString(), kind, msg: msg.slice(0, 2000), data });
  if (buffer.length > MAX) buffer = buffer.slice(-MAX);
  if (kind === "error") void flush();
}

/** Sends what was collected (keepalive: it still goes out when the page closes). */
export async function flush(): Promise<void> {
  if (!enabled || !buffer.length) return;
  const events = buffer;
  buffer = [];
  try {
    const res = await fetch("/api/logs/client", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", ...diagHeaders() },
      body: JSON.stringify({ user, browser: browserId, events }),
    });
    if (!res.ok && res.status !== 204) throw new Error(String(res.status));
  } catch {
    // the server is not there (demo pages) or busy: keep them for the next try, still within MAX
    buffer = [...events, ...buffer].slice(-MAX);
  }
}

export interface LogSettings { enabled: boolean; dir: string; files: number; sizeMb: number; oldest: string | null; keepDays: number }

/** The server's log settings; null where there is no server log (the demo pages). */
export async function logSettings(): Promise<LogSettings | null> {
  try {
    const res = await fetch("/api/logs/settings", { headers: { Accept: "application/json", ...diagHeaders() } });
    if (!res.ok) return null;
    const s = (await res.json()) as LogSettings;
    enabled = s.enabled;
    if (!enabled) buffer = [];
    return s;
  } catch { return null; }
}

export async function setLogEnabled(on: boolean): Promise<boolean> {
  const res = await fetch("/api/logs/settings", {
    method: "PUT", headers: { "Content-Type": "application/json", ...diagHeaders() },
    body: JSON.stringify({ enabled: on, by: user || browserId }),
  });
  if (!res.ok) throw new Error(`The log setting was not saved (${res.status})`);
  if (!on) { await flush(); buffer = []; }   // what was collected until now still goes in
  enabled = on;
  if (on) diag("log", "Diagnostic log switched on here");
  return on;
}

/** Settings -> Report a problem: a marked entry, with what this browser did just before. */
export async function reportProblem(text: string, context?: unknown): Promise<void> {
  await flush();
  const res = await fetch("/api/logs/report", {
    method: "POST", headers: { "Content-Type": "application/json", ...diagHeaders() },
    body: JSON.stringify({ user, browser: browserId, text, context }),
  });
  if (!res.ok) {
    let m = "";
    try { const j = await res.json(); m = j.message ?? Object.values(j.errors ?? {}).flat().join(" "); } catch { /* not JSON */ }
    throw new Error(m || `The report was not saved (${res.status})`);
  }
}

export const logDownloadUrl = (days: number) => `/api/logs/download?days=${days}`;

/** Once, when the app starts: the user, errors of the page itself, the timer, the page closing. */
export function startDiag(userName: string) {
  user = userName;
  if (started) return;
  started = true;
  window.addEventListener("error", (e) => diag("error", `Page error: ${e.message}`, { at: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error?.stack?.slice(0, 3000) }));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    diag("error", `Unhandled: ${r?.message ?? String(e.reason)}`, { stack: r?.stack?.slice(0, 3000) });
  });
  window.setInterval(() => { void flush(); }, EVERY_MS);
  window.addEventListener("pagehide", () => { void flush(); });
  void logSettings().then((s) => { if (s?.enabled) diag("open", `GNEZDO opened (${navigator.userAgent})`, { screen: `${window.innerWidth}x${window.innerHeight}` }); });
}
