// Job naming preference (Settings -> Personal): a name such as "JOHN" makes New job suggest the next
// number, JOHN234 after JOHN233. The next number follows the latest job that has its two numbers before
// it too (JOHN231, JOHN232, JOHN233): a lone old number, or a gap far back, is not where it goes on.

import { api } from "../api/api";

const KEY = "gnezdo.jobNamePrefix";
export const loadJobPrefix = (): string => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
export const saveJobPrefix = (v: string) => { try { localStorage.setItem(KEY, v.trim()); } catch { /* not kept */ } };

/** The next name from the saved jobs (and names already taken, e.g. open unsaved jobs). */
export function nextJobName(prefix: string, jobs: { name: string; createdAt: string }[], taken: string[] = []): string {
  const p = prefix.trim();
  const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d+)$`, "i");
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

/** The suggested name for a new job ("" when no preference is set). */
export async function suggestJobName(taken: string[] = []): Promise<string> {
  const p = loadJobPrefix();
  if (!p) return "";
  try {
    // the newest made first (the list stops at 500)
    const jobs = await api.searchJobs({ name: p }, { key: "created", dir: "desc" });
    return nextJobName(p, jobs, taken);
  } catch {
    return nextJobName(p, [], taken);
  }
}
