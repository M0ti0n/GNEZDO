// Job naming preference (Settings -> Personal): a name such as "JOHN" makes New job suggest the next
// number, JOHN234 after JOHN233. The next number follows the latest job that has its two numbers before
// it too (JOHN231, JOHN232, JOHN233): a lone old number, or a gap far back, is not where it goes on.
// A job name can be for one machine: New job then suggests it for that machine, and also counts the
// files in that machine's NC and job folders (JOHN233_1.NCP: JOHN233 is taken), so the numbers go on
// from programs written before GNEZDO too. A job name for all machines is used for the machines that
// have none of their own.

import { api } from "../api/api";

/** One job name; `machine` "" = all machines (the ones without a name of their own). */
export interface JobNameRule { prefix: string; machine: string }

const KEY = "gnezdo.jobNamePrefix";       // before job names per machine: one name
const RULES = "gnezdo.jobNames";

export function loadJobNames(): JobNameRule[] {
  try {
    const raw = localStorage.getItem(RULES);
    if (raw) {
      const l = JSON.parse(raw) as JobNameRule[];
      if (Array.isArray(l)) return l.map((r) => ({ prefix: String(r.prefix ?? ""), machine: String(r.machine ?? "") }));
    }
    const old = localStorage.getItem(KEY) ?? "";
    return [{ prefix: old, machine: "" }];
  } catch { return [{ prefix: "", machine: "" }]; }
}
export const saveJobNames = (l: JobNameRule[]) => {
  try { localStorage.setItem(RULES, JSON.stringify(l.map((r) => ({ prefix: r.prefix.trim(), machine: r.machine })))); } catch { /* not kept */ }
};

/** The job name New job uses for this machine ("" when none is set). */
export function jobPrefixFor(machineId: string, rules = loadJobNames()): string {
  const own = rules.find((r) => r.machine === machineId && r.prefix.trim());
  return (own ?? rules.find((r) => !r.machine && r.prefix.trim()))?.prefix.trim() ?? "";
}
/** Is any job name set at all? */
export const hasJobNames = () => loadJobNames().some((r) => r.prefix.trim());

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The next name from the saved jobs (and names already taken, e.g. open unsaved jobs). */
export function nextJobName(prefix: string, jobs: { name: string; createdAt: string }[], taken: string[] = []): string {
  const p = prefix.trim();
  const re = new RegExp(`^${esc(p)}\\s*(\\d+)$`, "i");
  const nums = new Map<number, { at: number; digits: number }>();
  for (const j of jobs) {
    const m = re.exec(j.name.trim());
    if (!m) continue;
    const n = Number(m[1]), at = Date.parse(j.createdAt) || 0;
    const was = nums.get(n);
    if (!was || at > was.at) nums.set(n, { at, digits: m[1].length });
  }
  const used = new Set([...nums.keys()]);
  for (const t of taken) { const m = re.exec(t.trim()); if (m) used.add(Number(m[1])); }
  const width = Math.max(1, ...[...nums.values()].map((v) => v.digits));
  const name = (n: number) => `${p}${String(n).padStart(width, "0")}`;
  if (!nums.size) { let n = 1; while (used.has(n)) n++; return name(n); }
  // newest first: the first with the two numbers before it saved too
  const byNew = [...nums.entries()].sort((a, b) => b[1].at - a[1].at || b[0] - a[0]);
  const run = byNew.find(([n]) => nums.has(n - 1) && nums.has(n - 2));
  let n = (run ? run[0] : Math.max(...nums.keys())) + 1;
  while (used.has(n)) n++;
  return name(n);
}

/** A file name's job name: the job name and its number, without what follows (JOHN233_1 -> JOHN233). */
export function jobOfFile(prefix: string, file: string): string | null {
  const m = new RegExp(`^${esc(prefix.trim())}\\s*\\d+(?!\\d)`, "i").exec(file.trim());
  return m ? m[0] : null;
}

/** The suggested name for a new job on this machine ("" when no job name is set for it). */
export async function suggestJobName(machineId: string, taken: string[] = []): Promise<string> {
  const p = jobPrefixFor(machineId);
  if (!p) return "";
  // the jobs saved (the newest made first; the list stops at 500) and the files in the machine's folders
  const [jobs, files] = await Promise.all([
    api.searchJobs({ name: p }, { key: "created", dir: "desc" }).catch(() => []),
    machineId ? api.machineFiles(machineId, p).catch(() => []) : Promise.resolve([]),
  ]);
  const fromFiles = files.flatMap((f) => { const n = jobOfFile(p, f.name); return n ? [{ name: n, createdAt: f.at }] : []; });
  return nextJobName(p, [...jobs, ...fromFiles], taken);
}
