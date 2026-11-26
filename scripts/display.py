#!/usr/bin/env python3
"""The block an agent is shown, from the saved reading: reach, shown, and what the cut hides.

R232 asked a question no earlier figure could ask, because no earlier reading carried the numbers: of the 654 required
writes the evaluator grades, how many had an open ask of their family **on the eight lines the product renders at the
moment of the call**? The reading answers it twice, for the contract's board and for R231's clause board, and the two
answers are the round:

    request   reaches 463, shows 463, hides 0        (2.41 items a call)
    clause    reaches 636, shows 622, hides 14       (8.10 items a call)

The figure draws them against the same denominator, because the round's claim is a rate and a reader who saw 622 and 14
as counts would not see that they are 95.1% and 2.2% of one set. The second panel draws the contract's three levels —
416 covered by the finished board, 463 reached at the moment, 463 shown through the cut — because the round was refused
on the difference between the first two and the third is the reason: a cut removes items, so the cap contributes zero
and the +47 belongs to the settlement rule.

No timestamps, no network, no sampling: both panels read `eval/manifests/r232-reading.json`, which carries the grid's
sha256. Output: `docs/benchmarks/display.svg` under this repository and a raster for the docs repository.

Not floored, and the reason is the same one `anchors.py` gives by being absent from the lane's coverage step: the
raster needs matplotlib, which the gate does not install, so a floor here would measure the self-test and report a
renderer. What is floored is the reading — `read_anchor.py --check eval/manifests/r232-reading.json` — and `--self-test`
re-reads that file through this script's own loader, so a doctored reading fails here as well as there.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

#: The two scopes the round compares, in the order it reports them.
SCOPES = ("request", "clause")

#: One colour per scope, reused by both renderers so the two charts agree on what blue means.
COLOURS = {"request": "#1a73e8", "clause": "#c5221f"}


def load(path: pathlib.Path) -> dict:
    """The saved reading, checked against the four counts it is made of."""
    saved = json.loads(path.read_text())
    reading = saved["reading"]
    display = reading["display"]
    for name in SCOPES:
        one = display[name]
        if one["hidden"] != one["reached"] - one["displayed"]:
            raise SystemExit(f"{name}: hidden is not reached less shown")
        if one["displayed"] > one["reached"]:
            raise SystemExit(f"{name}: more shown than reached")
    return reading


def svg(reading: dict) -> str:
    """The two panels as markup, drawn at the reading's own scale."""
    display = reading["display"]
    required = display["request"]["required"]
    width, height = 780, 360
    left, right, top, bottom = 96, 24, 64, 56
    bar_height, gap = 34, 26
    span = width - left - right
    scale = span / required

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" '
        f'height="{height}" role="img" aria-label="The displayed block, by scope">',
        '<style>text{font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif}'
        '.t{font-size:13px;fill:#202124}.s{font-size:11px;fill:#5f6368}'
        '.n{font-size:11px;fill:#202124}</style>',
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text class="t" x="{left}" y="26">The block an agent reads: {required} graded writes, '
        f'eight lines at a time</text>',
    ]
    for index, name in enumerate(SCOPES):
        one = display[name]
        y = top + index * (bar_height + gap)
        parts.append(f'<text class="t" x="{left - 12}" y="{y + bar_height / 2 + 4}" text-anchor="end">{name}</text>')
        # Reach, then shown inside it: the pale segment is what the cut hides, so the bar's own length is the reach and
        # its solid part is what a reader of the block would have seen.
        parts.append(f'<rect x="{left}" y="{y}" width="{one["reached"] * scale:.1f}" height="{bar_height}" '
                     f'fill="{COLOURS[name]}" opacity="0.28"/>')
        parts.append(f'<rect x="{left}" y="{y}" width="{one["displayed"] * scale:.1f}" height="{bar_height}" '
                     f'fill="{COLOURS[name]}" opacity="0.92"/>')
        parts.append(f'<text class="n" x="{left + one["displayed"] * scale - 8:.1f}" '
                     f'y="{y + bar_height / 2 + 4}" text-anchor="end" fill="#ffffff">'
                     f'{one["displayed"]} shown</text>')
        hidden = one["hidden"]
        note = f'{hidden} hidden' if hidden else "nothing hidden"
        parts.append(f'<text class="s" x="{left + one["reached"] * scale + 8:.1f}" '
                     f'y="{y + bar_height / 2 + 4}">{note} of {one["reached"]} reached'
                     f'{" " + format(one["hiddenShare"], ".1%") if hidden else ""}</text>')
        parts.append(f'<text class="s" x="{left}" y="{y - 6}">{one["itemsPerCall"]:.2f} items a call</text>')
    bar_x = left + required * reading["bar"]["B1_displayed"]["bar"] * scale
    parts.append(f'<line x1="{bar_x:.1f}" y1="{top - 16}" x2="{bar_x:.1f}" y2="{top + 2 * bar_height + gap}" '
                 f'stroke="#b3261e" stroke-dasharray="4 3"/>')
    parts.append(f'<text class="s" x="{bar_x + 6:.1f}" y="{top - 20}" fill="#b3261e">'
                 f'B1 bar {reading["bar"]["B1_displayed"]["bar"]:.1%}</text>')
    # The axis is the evaluator's denominator and nothing else: a bar is a count of writes, and the one scale the two
    # scopes share is the 654 they are both graded over.
    axis_y = top + 2 * (bar_height + gap) - gap + 12
    for tick in range(0, required + 1, 100):
        x = left + tick * scale
        parts.append(f'<line x1="{x:.1f}" y1="{axis_y}" x2="{x:.1f}" y2="{axis_y + 5}" stroke="#9aa0a6"/>')
        parts.append(f'<text class="s" x="{x:.1f}" y="{axis_y + 18}" text-anchor="middle">{tick}</text>')
    parts.append(f'<text class="s" x="{left + span / 2}" y="{axis_y + 34}" text-anchor="middle">'
                 f'required writes with an open ask of their family on the rendered block</text>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def _png(reading: dict, path: pathlib.Path) -> None:
    """The raster: the two scopes, and the contract's three levels side by side."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    display = reading["display"]
    required = display["request"]["required"]
    full = reading["boards"]["request"]["covered"]
    figure, (axes, chain) = plt.subplots(1, 2, figsize=(14.4, 5.0), dpi=165,
                                         gridspec_kw={"width_ratios": [1.35, 1]})
    for index, name in enumerate(SCOPES):
        one = display[name]
        axes.barh(index, one["displayed"], color=COLOURS[name], height=0.42, zorder=3)
        axes.barh(index, one["hidden"], left=one["displayed"], color="#f6c7c3", height=0.42, zorder=3)
        axes.text(one["displayed"] / 2, index, f'{one["displayed"]} shown', ha="center", va="center",
                  color="white", fontsize=10)
        axes.text(one["reached"] + 6, index, f'{one["hidden"]} hidden of {one["reached"]} reached'
                  f' ({one["hiddenShare"]:.1%})' if one["hidden"] else
                  f'nothing hidden of {one["reached"]} reached', va="center", fontsize=9.5, color="#3c4043")
    axes.axvline(required * reading["bar"]["B1_displayed"]["bar"], color="#b3261e", linestyle="--", linewidth=1.2)
    axes.set_yticks(range(len(SCOPES)))
    axes.set_yticklabels([f'{name}\n{display[name]["itemsPerCall"]:.2f} items a call' for name in SCOPES], fontsize=10)
    axes.set_xlim(0, required * 1.02)
    axes.set_xlabel(f"of {required} required writes the evaluator grades", fontsize=10)
    axes.set_title("R232: what survived the eight-line cut", fontsize=11)
    axes.grid(axis="x", alpha=0.18)
    for spine in ("top", "right", "left"):
        axes.spines[spine].set_visible(False)
    axes.text(required * reading["bar"]["B1_displayed"]["bar"] + 2, 1.42,
              f'bar {reading["bar"]["B1_displayed"]["bar"]:.1%}', color="#b3261e", fontsize=9)
    axes.set_ylim(-0.6, 1.6)

    # The contract, three levels. A cut removes items, so the third bar cannot be shorter than the second — and the
    # difference between the first and the second is a settlement rule, which is the whole of the +47 the round was
    # refused on.
    levels = (("covered by the\nfinished board", full, "#5f6368"),
              ("reached at the\nmoment, uncut", display["request"]["reached"], "#1a73e8"),
              ("shown through\nthe cut", display["request"]["displayed"], "#1a73e8"))
    for index, (label, value, colour) in enumerate(levels):
        chain.bar(index, value, color=colour, width=0.55, zorder=3,
                  alpha=1.0 if index != 2 else 0.55)
        chain.text(index, value + 6, str(value), ha="center", fontsize=11, color="#202124")
    chain.set_xticks(range(len(levels)))
    chain.set_xticklabels([label for label, _, _ in levels], fontsize=9.5)
    chain.set_ylabel("writes on the contract's board", fontsize=10)
    chain.set_title(f'R232: the +{reading["bar"]["B3_displayTax"]["tax"]} is the clock, not the cut', fontsize=11)
    top = max(value for _, value, _ in levels)
    chain.set_ylim(0, top * 1.42)
    chain.set_xlim(-0.5, 2.5)
    chain.grid(axis="y", alpha=0.18)
    for spine in ("top", "right"):
        chain.spines[spine].set_visible(False)
    # The two differences, drawn where they are and labelled above the bars: the first is the clock (the block at the
    # moment knows more than the ledger afterwards), the second is the cut (which costs nothing).
    chain.annotate("", xy=(1.0, top * 1.26), xytext=(0.0, top * 1.26),
                   arrowprops={"arrowstyle": "<->", "color": "#b3261e", "linewidth": 1.2})
    chain.text(0.5, top * 1.29, f'+{display["request"]["reached"] - full} visible at the moment',
               ha="center", fontsize=9, color="#b3261e")
    chain.annotate("", xy=(2.0, top * 1.13), xytext=(1.0, top * 1.13),
                   arrowprops={"arrowstyle": "<->", "color": "#137333", "linewidth": 1.2})
    chain.text(1.5, top * 1.16, "the cut costs 0", ha="center", fontsize=9, color="#137333")

    figure.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, facecolor="white")
    plt.close(figure)


def self_test() -> int:
    """The loader's refusals, and the markup's two panels, over the reading that is on disk.

    A figure is a transcript of numbers a document quotes, so the two things worth asserting are that the reading it
    reads is arithmetically sound and that the markup it writes carries both scopes. Neither is a rendering test: the
    chart's honesty is in its numbers, and a pixel that moved is not a defect a suite can name.
    """
    import tempfile

    failed: list = []

    def check(name: str, condition) -> None:
        if not condition:
            failed.append(name)

    here = pathlib.Path(__file__).resolve().parent.parent
    reading = load(here / "eval" / "manifests" / "r232-reading.json")
    check("the saved reading is the one the round was read over", reading["display"]["clause"]["required"] == 654)
    markup = svg(reading)
    check("the markup carries both scopes", all(f">{name}<" in markup for name in SCOPES))
    check("and the bar it was judged against", "73.6%" in markup)
    check("and closes", markup.rstrip().endswith("</svg>"))
    with tempfile.TemporaryDirectory() as temporary:
        doctored = json.loads((here / "eval" / "manifests" / "r232-reading.json").read_text())
        doctored["reading"]["display"]["clause"]["hidden"] = 1
        path = pathlib.Path(temporary) / "bad.json"
        path.write_text(json.dumps(doctored))
        try:
            load(path)
            check("a block whose hidden count is not the difference is refused", False)
        except SystemExit:
            check("a block whose hidden count is not the difference is refused", True)
        doctored = json.loads((here / "eval" / "manifests" / "r232-reading.json").read_text())
        doctored["reading"]["display"]["request"]["displayed"] = 900
        path.write_text(json.dumps(doctored))
        try:
            load(path)
            check("and a block that shows more than it reached is refused", False)
        except SystemExit:
            check("and a block that shows more than it reached is refused", True)
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("display: all assertions hold")
    return 0


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="The displayed block, from the saved reading.")
    parser.add_argument("--reading", default="eval/manifests/r232-reading.json")
    parser.add_argument("--out-svg", default="docs/benchmarks/display.svg")
    parser.add_argument("--out-png", default="")
    parser.add_argument("--print", action="store_true", dest="show")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    reading = load(pathlib.Path(arguments.reading))
    if arguments.out_svg:
        target = pathlib.Path(arguments.out_svg)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(svg(reading))
    if arguments.out_png:
        _png(reading, pathlib.Path(arguments.out_png))
    if arguments.show:
        for name in SCOPES:
            one = reading["display"][name]
            print(f"{name:8s} reached {one['reached']:3d}  shown {one['displayed']:3d}  hidden {one['hidden']:2d}  "
                  f"items/call {one['itemsPerCall']:5.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
