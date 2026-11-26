#!/usr/bin/env python3
"""Accuracy against price, per domain, on the rows of the 2.0 directory that state both.

The board changed under this project between its two versions: 1.0.1 carried an accuracy and nothing else, and 2.0
carries a `cost` per trajectory beside it on a minority of rows. That minority is the only place a row of this project
can be placed on the plane a practitioner actually chooses in, so it is worth a chart of its own — and the chart has to
say how many rows it drew, because a scatter of eight rows out of forty-eight is a subset and not a census.

Three panels, one per domain, because pass^1 on 114 retail tasks and pass^1 on 50 airline tasks are different
quantities and a single axis carrying both would be the category error this record spends its rounds refusing.

The resolution band is drawn where it has been measured and nowhere else. Retail's floor is 3.21 points at 114 tasks
(eval/tools/resolution.py); no floor has been measured for airline or telecom, and drawing an unmeasured band would be
the error the band exists to prevent.

Output: docs/benchmarks/frontier-2x.svg. Deterministic: no timestamps, no network, no sampling.
"""

from __future__ import annotations

import json
import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
BOARD = ROOT / "eval" / "manifests" / "tau2-board-2x-2026-11-25.json"
OUT = ROOT / "docs" / "benchmarks" / "frontier-2x.svg"

#: Open weights against closed hosted APIs. The board records an organization and not a licence, so the second is read
#: off the first — a classification this file owns, states, and is the only place that decides.
OPEN = frozenset({"Qwen", "DeepSeek", "Z.ai", "Zhipu AI", "Meta", "Alibaba Cloud", "NVIDIA", "Moonshot AI",
                  "Northeastern University HAI Lab", "Thinking Machines Lab", "Multiple providers"})
CLOSED = frozenset({"OpenAI", "Anthropic", "Google", "xAI", "Pine AI", "Distyl AI", "Pickle", "Salesforce",
                    "Example Organization"})

#: This project's own row, and the one column it publishes that the board does not: retail `pass_1` 84.20 on tau2
#: 1.0.1 at $0.00558 a trajectory (R218a). It is a single point and it is labelled as one.
PROJECT = {"retail": 84.20, "airline": None, "telecom": None, "cost": 0.00558}

#: The domain's floor, where one has been measured.
FLOORS = {"retail": 3.21}

DOMAINS = ("retail", "airline", "telecom")


def plotted(document, domain):
    """The rows with both coordinates, in board order, with the product class each one belongs to."""
    rows = []
    for entry in document["entries"]:
        cell = entry["results"].get(domain) or {}
        score, cost = cell.get("pass_1"), cell.get("cost")
        if score is None or not cost or cost <= 0:
            continue
        organization = entry.get("organization") or ""
        rows.append({
            "model": entry.get("model") or entry.get("name") or "",
            "score": float(score),
            "cost": float(cost),
            "open": organization in OPEN,
            "closed": organization in CLOSED,
        })
    return rows


def draw(rows, domain, axis):
    for row in rows:
        colour = "#1f77b4" if row["open"] else ("#d62728" if row["closed"] else "#7f7f7f")
        axis.scatter(row["cost"], row["score"], s=44, color=colour, edgecolor="white", linewidth=0.7, zorder=3)
        axis.annotate(row["model"][:22], (row["cost"], row["score"]), textcoords="offset points", xytext=(5, 4),
                      fontsize=5.6, color="#333333", zorder=4)
    if PROJECT[domain] is not None:
        axis.scatter(PROJECT["cost"], PROJECT[domain], marker="*", s=440, color="#111111", edgecolor="gold",
                     linewidth=1.1, zorder=6)
        axis.annotate("microglia", (PROJECT["cost"], PROJECT[domain]), textcoords="offset points", xytext=(9, -12),
                      fontsize=8.5, fontweight="bold")
    if domain in FLOORS:
        band = FLOORS[domain]
        axis.axhspan(PROJECT[domain] - band, PROJECT[domain] + band, color="gold", alpha=0.10, zorder=1)
        axis.axhline(PROJECT[domain], color="#bfa100", linestyle="--", linewidth=0.9, zorder=2)
        axis.annotate(f"one grid's resolution: \u00b1{band:.2f} pp", (0.03, 0.045), xycoords="axes fraction",
                      fontsize=7.2, color="#8a6d00")
    else:
        axis.annotate("no floor measured in this domain", (0.03, 0.045), xycoords="axes fraction", fontsize=7.2,
                      color="#8a8a8a")
    axis.set_xscale("log")
    axis.set_xlabel("cost per trajectory, USD (log)", fontsize=9)
    axis.set_title(f"\u03c4\u00b2-bench 2.0 \u00b7 {domain} \u00b7 pass^1", fontsize=10.5)
    axis.grid(alpha=0.25, linestyle=":")
    axis.text(0.97, 0.96, f"{len(rows)} row(s) state a cost", transform=axis.transAxes, ha="right", fontsize=7,
              color="#666666")


def main():
    document = json.loads(BOARD.read_text(encoding="utf-8"))
    figure, axes = plt.subplots(1, 3, figsize=(15.5, 5.4))
    for axis, domain in zip(axes, DOMAINS):
        draw(plotted(document, domain), domain, axis)
    axes[0].set_ylabel("pass^1 (%)", fontsize=9)
    handles = [
        Line2D([], [], marker="o", linestyle="", color="#1f77b4", label="open weights", markersize=7),
        Line2D([], [], marker="o", linestyle="", color="#d62728", label="closed API", markersize=7),
        Line2D([], [], marker="*", linestyle="", color="#111111", markeredgecolor="gold", label="this project",
               markersize=14),
        Line2D([], [], marker="s", linestyle="", color="gold", alpha=0.35, label="measured resolution", markersize=11),
    ]
    figure.legend(handles=handles, loc="lower center", ncol=4, frameon=False, fontsize=9, bbox_to_anchor=(0.5, -0.01))
    figure.suptitle("Accuracy against price, on the rows that publish both \u2014 and the band no row publishes",
                    fontsize=12.5, y=1.0)
    figure.tight_layout(rect=(0, 0.05, 1, 0.96))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(OUT, format="svg")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
