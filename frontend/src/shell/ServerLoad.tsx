import { useEffect, useState } from "react";

interface Load { cpu: number | null; threads: number; nestsRunning: number; nestsQueued: number }

// Top bar, next to the GNEZDO menu: how busy the server is (the CPU of the whole machine GNEZDO runs
// on, and the nests running there), so a user sees when it is better to wait a minute before nesting.
// Hidden when there is no server to ask (the demo page on its own).
export function ServerLoad() {
  const [load, setLoad] = useState<Load | null>(null);
  useEffect(() => {
    let stop = false, fails = 0;
    const tick = async () => {
      try {
        const r = await fetch("/api/server/load", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const v = (await r.json()) as Load;
        if (!stop) { setLoad(v); fails = 0; }
      } catch {
        if (!stop && ++fails >= 3) setLoad(null);
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 15000 : 3000);
    };
    let timer = window.setTimeout(tick, 300);
    return () => { stop = true; window.clearTimeout(timer); };
  }, []);
  if (!load || load.cpu == null) return null;
  const cpu = Math.max(0, Math.min(100, load.cpu));
  const level = cpu >= 80 ? "is-high" : cpu >= 50 ? "is-mid" : "is-low";
  const nests = load.nestsRunning + load.nestsQueued;
  const tip = `Server CPU ${cpu} % (${load.threads} threads)` +
    `\n${load.nestsRunning} ${load.nestsRunning === 1 ? "nest" : "nests"} running${load.nestsQueued ? `, ${load.nestsQueued} waiting` : ""}` +
    (cpu >= 80 ? "\nThe server is busy: a nest started now runs slower. Waiting a minute or two may be better." : "");
  return (
    <div className={`srv-load ${level}`} title={tip} aria-label={`Server CPU ${cpu} percent, ${nests} nests`} role="status">
      <span className="srv-label">CPU</span>
      <span className="srv-bar" aria-hidden="true"><i style={{ width: `${cpu}%` }} /></span>
      <span className="srv-pct">{cpu}%</span>
      {nests > 0 && <span className="srv-nests" aria-hidden="true">{nests}</span>}
    </div>
  );
}
