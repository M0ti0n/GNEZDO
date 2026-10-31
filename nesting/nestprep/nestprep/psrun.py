"""Thin wrapper around the PackingSolver irregular command-line tool."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time

DEFAULT_BIN = os.environ.get("PACKINGSOLVER_IRREGULAR", "packingsolver_irregular")
# PackingSolver's own default is CLP; our build has HiGHS only (see nesting/README.md)
LP_SOLVER = os.environ.get("PACKINGSOLVER_LP_SOLVER", "highs")


def find_binary(path: str | None = None) -> str:
    cand = path or DEFAULT_BIN
    found = shutil.which(cand) or (cand if os.path.isfile(cand) else None)
    if not found:
        raise FileNotFoundError(
            f"PackingSolver irregular binary not found ({cand}). "
            "Pass --solver or set PACKINGSOLVER_IRREGULAR.")
    return found


def solve(instance: dict, binary: str, time_limit: float = 2.0,
          mode: str = "not-anytime-deterministic", workdir: str | None = None,
          keep: bool = False, extra_args: list[str] | None = None) -> dict:
    """Run the solver and return {'solution', 'output', 'time'}."""
    tmp = workdir or tempfile.mkdtemp(prefix="ps_")
    os.makedirs(tmp, exist_ok=True)
    inst_p = os.path.join(tmp, "instance.json")
    out_p = os.path.join(tmp, "output.json")
    sol_p = os.path.join(tmp, "solution.json")
    with open(inst_p, "w") as f:
        json.dump(instance, f)
    cmd = [binary, "-i", inst_p, "-o", out_p, "-c", sol_p,
           "-t", str(time_limit), "-v", "0", "--optimization-mode", mode,
           "--linear-programming-solver", LP_SOLVER]
    if extra_args:
        cmd += extra_args
    t0 = time.perf_counter()
    r = subprocess.run(cmd, capture_output=True, text=True)
    dt = time.perf_counter() - t0
    if r.returncode != 0 or not os.path.exists(sol_p):
        raise RuntimeError(f"solver failed ({r.returncode}): {r.stderr[-2000:]}")
    with open(sol_p) as f:
        sol = json.load(f)
    out = {}
    if os.path.exists(out_p):
        with open(out_p) as f:
            out = json.load(f)
    if not keep and workdir is None:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"solution": sol, "output": out, "time": dt}


def solve_grace(instance: dict, binary: str, time_limit: float, grace: float,
                workdir: str | None = None, *, stop_after: float | None = None,
                should_stop=None, on_progress=None) -> dict:
    """Anytime solve for `time_limit` seconds; when there is no layout yet by then, up to `grace`
    seconds more, stopping at the first layout. PackingSolver writes each better layout to the
    solution file as it finds it, so the run is never started again.

    stop_after: end once a layout exists and no better one has turned up for this many seconds.
    should_stop(): polled; True ends the run, keeping the best layout so far ("stopped").
    on_progress({"sheets", "waste", "seconds", "solution"}): called for every better layout.
    """
    tmp = workdir or tempfile.mkdtemp(prefix="ps_")
    os.makedirs(tmp, exist_ok=True)
    inst_p, out_p, sol_p = (os.path.join(tmp, n) for n in ("instance.json", "output.json", "solution.json"))
    for q in (out_p, sol_p):
        if os.path.exists(q):
            os.remove(q)
    with open(inst_p, "w") as f:
        json.dump(instance, f)
    cmd = [binary, "-i", inst_p, "-o", out_p, "-c", sol_p, "-t", str(time_limit + grace), "-v", "0",
           "--optimization-mode", "anytime", "--linear-programming-solver", LP_SOLVER]
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    def read():
        try:
            with open(sol_p) as f:
                sol = json.load(f)
            return sol if sol and sol.get("bins") else None
        except (OSError, ValueError):
            return None  # not there yet, or being written

    def waste():
        try:
            with open(out_p) as f:
                o = json.load(f)
            last = (o.get("IntermediaryOutputs") or [{}])[-1].get("Solution", {})
            w = last.get("FullWastePercentage")
            return None if w is None else round(100 * float(w), 1)
        except (OSError, ValueError, AttributeError):
            return None

    sol, stopped = None, False
    seen, improved_at = None, None
    while proc.poll() is None:
        time.sleep(0.25)
        now = time.perf_counter() - t0
        try:
            m = os.stat(sol_p).st_mtime_ns
        except OSError:
            m = None
        if m is not None and m != seen:
            cur = read()
            if cur:
                seen, sol, improved_at = m, cur, now
                if on_progress:
                    on_progress({"sheets": sum(int(b.get("copies", 1)) for b in cur["bins"]),
                                 "waste": waste(), "seconds": round(now, 1), "solution": cur})
        if should_stop and should_stop():
            stopped = True
        elif now >= time_limit and sol:
            pass  # time is up and a layout exists
        elif stop_after and sol and now - improved_at >= stop_after:
            pass  # nothing better for a while
        else:
            continue
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        break
    if proc.returncode not in (0, None) and sol is None and proc.returncode > 0 and not stopped:
        raise RuntimeError(f"solver failed ({proc.returncode}): {proc.stderr.read()[-2000:]}")
    if sol is None or (not stopped and proc.returncode == 0):
        sol = read() or sol
    out = {}
    try:
        with open(out_p) as f:
            out = json.load(f)
    except (OSError, ValueError):
        pass
    if workdir is None:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"solution": sol, "output": out, "time": time.perf_counter() - t0, "stopped": stopped}
