"""Render expanded sheets to PNG (matplotlib, Agg backend)."""
from __future__ import annotations

import colorsys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402
from matplotlib.path import Path  # noqa: E402

from .solution import Geometry  # noqa: E402


def _color(t: int):
    h = (t * 0.6180339887) % 1.0
    return colorsys.hls_to_rgb(h, 0.80, 0.45)


def _path(ps):
    verts, codes = [], []
    for c in ps.contours():
        pts = list(map(tuple, c)) + [tuple(c[0])]
        verts += pts
        codes += [Path.MOVETO] + [Path.LINETO] * (len(pts) - 2) + [Path.CLOSEPOLY]
    return Path(verts, codes)


def render_sheets(instance: dict, sheets: list[dict], out_png: str, title: str = "",
                  cols: int = 2):
    g = Geometry(instance)
    n = len(sheets)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 9, rows * 4.9), squeeze=False)
    for k, ax in enumerate(axes.flat):
        ax.set_axis_off()
        if k >= n:
            continue
        sh = sheets[k]
        x0, y0, x1, y1 = g.bin_rect(sh["bin_type"])
        ax.add_patch(plt.Rectangle((x0, y0), x1 - x0, y1 - y0, fill=True,
                                   fc="#f4f4f2", ec="#333", lw=1.0))
        for p in sh["parts"]:
            for ps in g.placed(p["orig_type"], p["xf"]):
                ec = "#c0392b" if p["depth"] > 0 else "#333"
                ax.add_patch(PathPatch(_path(ps), fc=_color(p["orig_type"]), ec=ec,
                                       lw=0.5 if p["depth"] == 0 else 0.8))
                bx = ps.bbox
                ax.text((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, str(p["orig_type"] + 1),
                        ha="center", va="center", fontsize=5 if p["depth"] else 6)
        ax.set_xlim(x0 - 10, x1 + 10)
        ax.set_ylim(y0 - 10, y1 + 10)
        ax.set_aspect("equal")
        ax.set_title(f"Sheet {k + 1}  ({len(sh['parts'])} parts)", fontsize=10)
    if title:
        fig.suptitle(title, fontsize=13)
    fig.tight_layout()
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
