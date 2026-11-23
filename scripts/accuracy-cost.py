#!/usr/bin/env python3
"""Accuracy against cost, from the numbers this record can source, and the axis nobody else publishes.

Every point on the left panel is a pair artefact committed to this repository or fetched from a run whose
id is written beside it: the two coordinates are the fold's own pass rate and its own prompt bill, divided by
the number of evaluated tasks. Nothing is estimated and nothing is read off another system's paper.

The right panel is the τ²-bench leaderboard as this record last read it (2026-11-02), with one column added:
whether the submission publishes what it spent. None of them does, which is why they cannot be placed on the
left panel at all -- and why the two panels are separate charts rather than one scatter. pass^4 over four
trials on 114 tasks and pass@1 over one trial on 40 tasks are different quantities, and a single axis with
both on it would be the category error this record spends its rounds refusing.

Output: docs/benchmarks/accuracy-cost.svg, deterministic (no timestamps, no network).
"""

from __future__ import annotations

import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

# ---------------------------------------------------------------------------- the measured points
# Left panel: same corpus (τ²-bench retail), same split (74 learned / 40 held out), one trial, so the two
# coordinates are the same two numbers for every point.
#
# `tokens_per_task` is the arm's own prompt total divided by the 40 evaluated tasks -- the bill the provider
# charged for the phase, not a premium. The premium is the difference between a memory arm and its own fold's
# control, which is the number R198 published as 3,299.6 tokens an episode.
FOLDS = [
    {
        "name": "R198 fold",
        "note": "block arm: the store's records injected as context",
        "control": {"pass": 82.5, "tokens": 3_030_263 / 40},
        "arm": {"pass": 85.0, "tokens": 3_162_246 / 40},
    },
    {
        "name": "R204 fold",
        "note": "guidance arm: one sentence per episode, 6 of 40 episodes carried one",
        "control": {"pass": 82.5, "tokens": 3_246_017 / 40},
        "arm": {"pass": 87.5, "tokens": 3_099_936 / 40},
    },
]

# Middle and right panels: the τ²-bench leaderboard's two scenario columns, read 2026-11-02 (docs repo,
# COMPETITIVE.md §L). No submission in the table reports tokens or dollars, which is the hatched column.
RETAIL_PASS4 = [
    ("ALTK-Evolve", 57.5),
    ("RAFT-30B-A3B", 61.4),
    ("IBM Research, learned guidelines", 67.5),
    ("SapientAI-Agent-Opus-5", 72.8),
]
# The airline column, where this lane actually has a pass^4 of its own: R41 ran 50 tasks x 4 trials, and its
# memory arm's store was empty for all 200 recall requests -- which is why its 36.0 is labelled void rather
# than reported as a memory result.
AIRLINE_PASS4 = [
    ("microglia R41, memory arm (store empty)", 36.0, "ours, void"),
    ("stock llm_agent, gpt-oss-120b", 34.0, "field"),
    ("microglia R41, reference arm", 46.0, "ours"),
    ("SapientAI-Agent-Opus-5", 72.0, "field"),
    ("IBM Research, learned guidelines", 82.0, "field"),
]

INK = "#1b1b1f"
MUTED = "#6b6b76"
CONTROL = "#8a8a94"
BLOCK = "#2f6f8f"
GUIDANCE = "#a8452e"


def left_panel(ax: plt.Axes) -> None:
    control_points: list[tuple[float, float]] = []
    for fold in FOLDS:
        control, arm = fold["control"], fold["arm"]
        ax.annotate(
            "",
            xy=(arm["tokens"], arm["pass"]),
            xytext=(control["tokens"], control["pass"]),
            arrowprops={"arrowstyle": "-|>", "color": MUTED, "lw": 1.0, "shrinkA": 6, "shrinkB": 6},
        )
        colour = BLOCK if fold["name"].startswith("R198") else GUIDANCE
        ax.scatter(arm["tokens"], arm["pass"], s=64, color=colour, zorder=4, edgecolor="white", linewidth=0.8)
        ax.annotate(
            f"{fold['name']}\n{fold['note']}",
            xy=(arm["tokens"], arm["pass"]),
            xytext=(8, -30 if colour == BLOCK else 10),
            textcoords="offset points",
            fontsize=7.4,
            color=INK,
            linespacing=1.35,
        )
        control_points.append((control["tokens"], control["pass"]))

    # One legend entry for the two controls, because "no memory" is the same arm in both folds and labelling it
    # twice reads as two different things.
    ax.scatter(
        [point[0] for point in control_points],
        [point[1] for point in control_points],
        s=46,
        color=CONTROL,
        zorder=3,
        edgecolor="white",
        linewidth=0.8,
        label="no memory (each fold's own control)",
    )
    ax.legend(loc="upper left", fontsize=7, frameon=False, labelcolor=MUTED, handletextpad=0.4)
    ax.set_xlim(73_000, 84_000)
    ax.set_ylim(79.5, 90.5)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _pos: f"{value / 1000:.0f}k"))
    ax.set_xlabel("prompt tokens per evaluated task", fontsize=8.4, color=MUTED)
    ax.set_ylabel("pass@1 on 40 held-out retail tasks (%)", fontsize=8.4, color=MUTED)
    ax.set_title("what a fold measured: accuracy against the bill it paid", fontsize=9.6, color=INK, loc="left")
    ax.tick_params(labelsize=7.6, colors=MUTED)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#d8d8dc")
    # The reading the arrow length is: the premium. R198's is the number every earlier round quoted.
    ax.text(
        0.02,
        0.04,
        "arrow = one fold's own treatment effect. R198's premium is 3,299.6 tokens an episode;\n"
        "R204's is negative because 34 of 40 episodes carried nothing — the refusals in the bill.",
        transform=ax.transAxes,
        fontsize=6.9,
        color=MUTED,
        linespacing=1.4,
    )


def leaderboard_panel(ax: plt.Axes, rows: list[tuple], title: str, tick: str) -> None:
    """One scenario column of the board: the bars, the missing cost column, and nothing inferred.

    The hatched block is the point of the panel. Every submission in this table publishes an accuracy and no
    bill, so a chart that placed them on an accuracy-against-cost axis would be inventing their cost -- which
    is the difference between this record's left panel (two measured coordinates) and the field's one.
    """
    names = [f"{row[0]}  {row[1]:.1f}" for row in rows][::-1]
    values = [row[1] for row in rows][::-1]
    kinds = [(row[2] if len(row) > 2 else "field") for row in rows][::-1]
    colours = ["#a8452e" if kind.startswith("ours") else "#c9ccd4" for kind in kinds]
    # The value lives in the tick label rather than at the bar's end: a number printed after a bar of 82 is a
    # number printed in the column that does not exist, which is the one thing this panel must not do.
    ax.barh(names, values, color=colours, height=0.5, zorder=2)
    ax.add_patch(
        Rectangle(
            (88, -0.6),
            12,
            len(names) + 0.1,
            facecolor="none",
            edgecolor="#b8b8c0",
            hatch="///",
            linewidth=0.6,
            zorder=1,
            clip_on=False,
        )
    )
    ax.text(
        94,
        len(names) / 2 - 0.5,
        "cost not\npublished",
        ha="center",
        va="center",
        fontsize=6.4,
        color=MUTED,
        linespacing=1.2,
    )
    ax.set_xlim(0, 100)
    ax.set_ylim(-0.6, len(names) - 0.4)
    ax.set_xlabel(tick, fontsize=8, color=MUTED)
    ax.set_title(title, fontsize=9.4, color=INK, loc="left")
    ax.tick_params(axis="x", labelsize=7.4, colors=MUTED)
    ax.tick_params(axis="y", labelsize=7.0, colors=INK)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#d8d8dc")


def main() -> int:
    figure, (left, middle, right) = plt.subplots(
        1, 3, figsize=(16.2, 4.7), gridspec_kw={"width_ratios": [1.05, 0.95, 0.95]}
    )
    figure.patch.set_facecolor("white")
    left_panel(left)
    leaderboard_panel(
        middle, RETAIL_PASS4, "retail: accuracy published, cost not", "published pass^4, retail, 114 tasks (%)"
    )
    leaderboard_panel(
        right,
        AIRLINE_PASS4,
        "airline: this lane's own pass^4",
        "published pass^4, airline, 50 tasks (%)",
    )
    figure.text(
        0.008,
        0.012,
        "left: microglia's own folds, both coordinates measured in the same run (pass@1, 40 tasks, one trial). "
        "middle and right: τ²-bench leaderboard pass^4 — a different quantity on a different sample, which is why the "
        "three panels are not one scatter. Red bars are this lane's; R41's memory arm is labelled void because its "
        "store was empty for all 200 recall requests.",
        fontsize=6.4,
        color=MUTED,
    )
    figure.tight_layout(rect=(0, 0.035, 1, 1))
    out = pathlib.Path(__file__).resolve().parent.parent / "docs" / "benchmarks" / "accuracy-cost.svg"
    out.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(out, format="svg", metadata={"Date": None})
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
