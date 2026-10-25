import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/api";
import type { ImportSummary, JobStatus, JobSummary, ProjectSummary } from "../api/types";
import { IconImport, IconNewJob, IconProject, IconSearch } from "../components/Icons";
import { Tile } from "../components/Tile";
import { fullDate, mm, when } from "../components/format";

export type HomeAction =
  | { kind: "import" }
  | { kind: "newJob" }
  | { kind: "jobSearch" }
  | { kind: "projects" }
  | { kind: "openJob"; job: JobSummary }
  | { kind: "openImport"; imp: ImportSummary }
  | { kind: "openProject"; project: ProjectSummary };

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draft",
  nested: "Nested",
  released: "Released",
  cut: "Cut",
};

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

function useLoad<T>(fn: () => Promise<T>): [Load<T>, () => void] {
  const [v, setV] = useState<Load<T>>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setV({ state: "loading" });
    fn().then(
      (data) => alive && setV({ state: "ok", data }),
      (e: Error) => alive && setV({ state: "error", message: e.message }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return [v, () => setN((x) => x + 1)];
}

export function HomePage({ onAction }: { onAction: (a: HomeAction) => void }) {
  const [imports, reloadImports] = useLoad(() => api.recentImports(8));
  const [jobs, reloadJobs] = useLoad(() => api.recentJobs(8));
  const [projects, reloadProjects] = useLoad(() => api.recentProjects(8));

  return (
    <div className="home">
      <section className="tiles" aria-label="Shortcuts">
        <Tile tone="blue" icon={<IconImport size={30} />} title="Import" onClick={() => onAction({ kind: "import" })}
          description="Add DXF or DWG drawings to the parts library" />
        <Tile tone="green" icon={<IconNewJob size={30} />} title="New job" onClick={() => onAction({ kind: "newJob" })}
          description="Pick parts and stock sheets, then nest" />
        <Tile tone="yellow" icon={<IconSearch size={30} />} title="Job search" onClick={() => onAction({ kind: "jobSearch" })}
          description="Find a job by name, order, status or date" />
      </section>

      <div className="recent-row">
        <Panel tone="blue" icon={<IconImport size={18} />} title="Recent imports"
          more="Open import" onMore={() => onAction({ kind: "import" })}>
          <Body load={imports} retry={reloadImports}
            empty="Nothing imported yet. Use Import to add your first drawings."
            render={(rows) => rows.map((r) => (
              <Row key={r.id} onOpen={() => onAction({ kind: "openImport", imp: r })}
                title={r.source}
                aside={<span className="count">{r.partCount}<small>parts</small></span>}
                meta={<>
                  <span>{r.project}</span>
                  <span>{r.materials.join(", ")}</span>
                  {r.warnings > 0 && <span className="warn">{r.warnings} to check</span>}
                </>}
                when={r.importedAt} who={r.importedBy} />
            ))} />
        </Panel>

        <Panel tone="green" icon={<IconNewJob size={18} />} title="Recent jobs"
          more="All jobs" onMore={() => onAction({ kind: "jobSearch" })}>
          <Body load={jobs} retry={reloadJobs}
            empty="No jobs yet. Start one with New job."
            render={(rows) => rows.map((j) => (
              <Row key={j.id} onOpen={() => onAction({ kind: "openJob", job: j })}
                title={j.name}
                aside={<span className={`status status-${j.status}`}>{STATUS_LABEL[j.status]}</span>}
                meta={<>
                  <span>{j.material} {mm(j.thicknessMm)}</span>
                  <span>{j.partCount} {j.partCount === 1 ? "part" : "parts"}</span>
                  <span>{j.sheetCount ? `${j.sheetCount} ${j.sheetCount === 1 ? "sheet" : "sheets"}` : "not nested"}</span>
                </>}
                when={j.modifiedAt} who={j.modifiedBy} />
            ))} />
        </Panel>

        <Panel tone="yellow" icon={<IconProject size={18} />} title="Recent projects"
          more="All projects" onMore={() => onAction({ kind: "projects" })}>
          <Body load={projects} retry={reloadProjects}
            empty="No projects yet. Projects are created when you import drawings with an order number."
            render={(rows) => rows.map((p) => (
              <Row key={p.id} onOpen={() => onAction({ kind: "openProject", project: p })}
                title={<>{p.code} <span className="title-sub">{p.name}</span></>}
                aside={<Progress value={p.cutPercent} />}
                meta={<>
                  {p.customer && <span>{p.customer}</span>}
                  <span>{p.partCount} parts</span>
                  <span>{p.jobCount} {p.jobCount === 1 ? "job" : "jobs"}</span>
                </>}
                when={p.lastActivityAt} />
            ))} />
        </Panel>
      </div>
    </div>
  );
}

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
      <ul className="rows">{children}</ul>
    </section>
  );
}

function Row({ title, meta, aside, when: at, who, onOpen }: {
  title: ReactNode; meta: ReactNode; aside: ReactNode; when: string; who?: string; onOpen: () => void;
}) {
  return (
    <li>
      <button className="row" onClick={onOpen}>
        <span className="row-title">{title}</span>
        <span className="row-aside">{aside}</span>
        <span className="row-meta">{meta}</span>
        <span className="row-when" title={fullDate(at)}>{when(at)}{who ? `, ${who}` : ""}</span>
      </button>
    </li>
  );
}

function Progress({ value }: { value: number }) {
  const done = value >= 100;
  return (
    <span className={`progress${done ? " is-done" : ""}`} title={`${value}% of parts cut`}>
      <span className="progress-bar"><span style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="progress-label">{done ? "Cut" : `${value}% cut`}</span>
    </span>
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
