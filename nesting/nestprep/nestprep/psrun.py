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
