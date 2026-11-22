import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/api";
import type { OpenJob } from "../api/api";
import type { JobSummary } from "../api/types";
import { IconImport, IconNewJob } from "../components/Icons";
import { PartThumb } from "../components/PartThumb";
import { UserTag } from "../components/SendPartsDialogs";
import { fullDate, mm, when } from "../components/format";

export type HomeAction =
  | { kind: "parts" }
  | { kind: "jobSearch" }
  | { kind: "openJob"; job: Pick<JobSummary, "id" | "name"> & Partial<Pick<JobSummary, "modifiedBy" | "modifiedAt">> };

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

function useLoad<T>(fetch: () => Promise<T>, every = 0): [Load<T>, () => void] {
  const [v, setV] = useState<Load<T>>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = (quiet: boolean) => {
      if (!quiet) setV({ state: "loading" });
      fetch().then(
        (data) => alive && setV({ state: "ok", data }),
        (e: Error) => alive && !quiet && setV({ state: "error", message: e.message }),
      );
    };
    run(false);
    // kept up to date (who has which job open), without "Loading…" in between
    const t = every ? window.setInterval(() => { if (!document.hidden) run(true); }, every) : 0;
    return () => { alive = false; if (t) window.clearInterval(t); };
  }, [n]);   // eslint-disable-line react-hooks/exhaustive-deps
  return [v, () => setN((x) => x + 1)];
}

type Kind = { material: string; thicknessMm: number };
const kindsOf = (j: JobSummary): Kind[] => j.kinds ?? (j.material ? [{ material: j.material, thicknessMm: j.thicknessMm }] : []);

/** Home: the parts added last, and the jobs made or changed last (server: the jobs open now on top, with who has them). */
export function HomePage({ onAction, server = false }: { onAction: (a: HomeAction) => void; server?: boolean }) {
  const [parts, reloadParts] = useLoad(() => api.recentParts(10));
  const [jobs, reloadJobs] = useLoad(() => api.recentJobs(server ? 14 : 10), server ? 15_000 : 0);
  const [open] = useLoad(() => (server ? api.openJobs(true) : Promise.resolve([] as OpenJob[])), server ? 15_000 : 0);
  const openIds = new Set(open.state === "ok" ? open.data.map((o) => o.id) : []);
  const notOpen: Load<JobSummary[]> = jobs.state === "ok" ? { state: "ok", data: jobs.data.filter((j) => !openIds.has(j.id)).slice(0, 10) } : jobs;

  return (
    <div className="home">
      <div className="recent-row">
        <Panel tone="blue" icon={<IconImport size={18} />} title="Recently added parts" more="All parts" onMore={() => onAction({ kind: "parts" })}>
          <ul className="rows">
            <Body load={parts} retry={reloadParts} empty="No parts yet. Import drawings in Import 2D."
              render={(rows) => rows.map((p) => (
                <li key={p.id}>
                  <button className="row part-row" onClick={() => onAction({ kind: "parts" })} title={p.description || undefined}>
                    <span className="part-row-thumb"><PartThumb part={p} size={40} /></span>
                    <span className="part-row-text">
                      <span className="row-title">{p.name}</span>
                      <span className="row-meta">{p.project && <span>{p.project}</span>}<MatChip material={p.material} thicknessMm={p.thicknessMm} /></span>
                    </span>
                    <span className="part-row-when" title={fullDate(p.createdAt)}>{when(p.createdAt)}</span>
                  </button>
                </li>
              ))} />
          </ul>
        </Panel>

        <Panel tone="green" icon={<IconNewJob size={18} />} title="Recent jobs" more="All jobs" onMore={() => onAction({ kind: "jobSearch" })}>
          {server && open.state === "ok" && open.data.length > 0 && <>
            <h3 className="home-sub is-open"><span className="home-live" aria-hidden="true" />Open now</h3>
            <ul className="rows home-open">
              {open.data.map((o) => (
                <li key={o.id}>
                  <JobRow name={o.name} done={!!o.done} kinds={o.materials} user={o.user} here={o.here}
                    onOpen={() => onAction({ kind: "openJob", job: { id: o.id, name: o.name } })} />
                </li>
              ))}
            </ul>
            <h3 className="home-sub">Recent, not open</h3>
          </>}
          <ul className="rows">
            <Body load={notOpen} retry={reloadJobs} empty="No jobs yet. Start one with New job."
              render={(rows) => rows.map((j) => (
                <li key={j.id}>
                  <JobRow name={j.name} done={!!j.done} kinds={kindsOf(j)} onOpen={() => onAction({ kind: "openJob", job: j })} />
                </li>
              ))} />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/** A job: its name (and who has it open), its materials and thicknesses, Nested or In progress. */
function JobRow({ name, done, kinds, user, here, onOpen }: { name: string; done: boolean; kinds: Kind[]; user?: string; here?: boolean; onOpen: () => void }) {
  return (
    <button className="row job-row" onClick={onOpen}
      title={done ? "Nested: every part nested and every sheet post processed" : "In progress: not every part nested, or not every sheet post processed yet"}>
      <span className="job-row-name"><span className="row-title">{name}</span>{user && <UserTag name={here ? `${user} (here)` : user} />}</span>
      <span className="row-aside"><span className={`status ${done ? "status-done" : "status-progress"}`}>{done ? "Nested" : "In progress"}</span></span>
      <span className="row-meta job-row-mats">
        {kinds.length ? kinds.map((k) => <MatChip key={`${k.material}|${k.thicknessMm}`} {...k} />) : <span>no parts yet</span>}
      </span>
    </button>
  );
}

const MatChip = ({ material, thicknessMm }: Kind) => <span className="sp-mat">{material} · {mm(thicknessMm)}</span>;

function Panel({ tone, icon, title, more, onMore, children }: {
  tone: string; icon: ReactNode; title: string; more: string; onMore: () => void; children: ReactNode;
}) {
  const id = `h-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className={`recent tone-${tone}`} aria-labelledby={id}>
      <div className="recent-head">
        <span className="recent-icon">{icon}</span>
        <h2 id={id}>{title}</h2>
        <button className="link" onClick={onMore}>{more}</button>
      </div>
      {children}
    </section>
  );
}

function Body<T>({ load, retry, empty, render }: {
  load: Load<T[]>; retry: () => void; empty: string; render: (rows: T[]) => ReactNode;
}) {
  if (load.state === "loading") return <li className="state">Loading…</li>;
  if (load.state === "error")
    return (
      <li className="state state-error">
        Could not load this list: {load.message}.{" "}
        <button className="link" onClick={retry}>Try again</button>
      </li>
    );
  if (load.data.length === 0) return <li className="state">{empty}</li>;
  return <>{render(load.data)}</>;
}
