#!/usr/bin/env python3
"""The boards on the two axes a working memory is actually chosen on, from the saved readings.

R228, R229, R230 and R231 priced seven rules for turning a transcript into items and ticks. Reported one at a time, each is a score:
the read anchor "accounts for 98.5% of the required work", the request rule "misses a third". Reported together they are
a trade, and the trade is the finding — a rule that cannot miss also cannot tell work from looking.

The axes are the two columns the reading publishes for every board:

    x   the share of the writes the evaluator requires **and** the episode performed that the rule accounts for
    y   items the rule leaves open at the end of an episode that **no required write needs**, per episode

so the upper left is the region a working memory wants and nothing in this corpus reaches it. The plot draws the point
for the request rule, both read scopes, the conjunction and the follow-the-conversation arm, and it draws the
`required writes per episode` line, because an open tax above that line is a block that is more than half noise.

No timestamps, no network, no sampling: the numbers are read from the four saved readings — `r228`, `r229`, `r230` and
`r231` — which carry the grid's sha256. The raster carries two panels the plane cannot: R230's, because that round's
point is not its finding (the finding is the composition of the transcript that produced it), and R231's, because its
point on the plane says "high coverage, high tax" and the finding is the **price** — items spent per write accounted
for, which is the column its efficiency bar was written over.

Output: `figures/r231-anchors.png` under the docs repository, and `docs/benchmarks/anchors.svg` under this one. The
R230 figure already published there is the two-panel rendering of the same script before R231 added the third.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib

#: The top of the y axis. Above the worst rule's tax by half an item, because a chart that clips its worst point is a
#: chart that hides the finding.
CEILING = 4.5

#: One colour per rule, keyed by the label the chart draws. Kept beside `RULES` rather than inside it because the SVG
#: and the raster both read it, and two palettes are two charts.
COLOURS = {"request": "#1a73e8", "read-strict": "#188038", "read-loose": "#7cb342", "ask-bound": "#8430ce",
           "every-turn": "#e8710a", "turn-admission": "#5f6368", "clause-admission": "#c5221f"}

#: The seven rules, in the order they are labelled, and where each one's numbers live in the saved readings.
RULES = (
    # label, board, which reading, and where its label sits relative to the dot. The offsets are hand-placed because
    # two pairs of rules land on the same coordinates — the conjunction and the request rule agree to one write, and the
    # two read scopes differ only in what they list — and a chart whose labels overlap is a chart of four rules.
    ("request", "request", "r228", (14, -6)),
    ("read-strict", "strict", "r228", (-16, 12)),
    ("read-loose", "loose", "r228", (-16, -14)),
    ("ask-bound", "ask", "r229", (-14, -6)),
    ("every-turn", "askAll", "r229", (-16, 10)),
    ("turn-admission", "admitted", "r230", (16, 12)),
    ("clause-admission", "clause", "r231", (16, -14)),
)


def load(manifest_dir: pathlib.Path) -> dict:
    """Both saved readings, and the two denominators they must agree on."""
    r228 = json.loads((manifest_dir / "r228-reading.json").read_text())
    r229 = json.loads((manifest_dir / "r229-reading.json").read_text())
    r230 = json.loads((manifest_dir / "r230-reading.json").read_text())
    r231 = json.loads((manifest_dir / "r231-reading.json").read_text())
    readings = {"r228": r228["reading"], "r229": r229["reading"], "r230": r230["reading"], "r231": r231["reading"]}
    if len({one["discharged"] for one in readings.values()}) != 1:
        raise SystemExit("the readings were taken over different denominators")
    third = readings["r230"]
    fourth = readings["r231"]
    return {"readings": readings,
            "price": {
                "asked": fourth["clauseOffered"],
                "kept": fourth["clauseKept"],
                "required": readings["r228"]["discharged"],
                "turns": fourth["turns"],
                "perWrite": fourth["bar"]["B2_efficiency"]["perWrite"],
                "budget": fourth["bar"]["B2_efficiency"]["bar"],
            }, "discharged": readings["r228"]["discharged"],
            "graded": readings["r228"]["graded"],
            "requiredPerEpisode": readings["r228"]["required"] / readings["r228"]["graded"],
            "mechanism": {
                "turns": third["turns"],
                "refused": third["skippedTurns"],
                "admitted": third["admittedTurns"],
                "late": third["lateWrites"],
                "recovered": third["recovered"],
                "bar": third["bar"]["B1_recovery"]["against"] and
                       round(third["bar"]["B1_recovery"]["bar"] * third["bar"]["B1_recovery"]["against"]),
            }}


def points(data: dict) -> list:
    """One row per rule: label, coverage as a share, and the open tax in items per episode."""
    rows = []
    for label, board, which, place in RULES:
        one = data["readings"][which]["boards"][board]
        rows.append({
            "label": label,
            "coverage": one["covered"] / data["discharged"],
            "openTax": one["openUnneeded"] / data["graded"],
            "items": one["items"],
            "covered": one["covered"],
            "perWrite": one["items"] / one["covered"] if one["covered"] else None,
            "precision": one["precision"],
            "place": place,
        })
    return rows


def svg(rows: list, required: float) -> str:
    """A self-contained two-axis chart, because the docs repository renders SVG and cannot run a notebook."""
    width, height = 720, 460
    left, right, top, bottom = 92, 24, 40, 66
    span_x = right - left + width - 720
    plot_w = width - left - right
    plot_h = height - top - bottom

    def px(value: float) -> float:
        return left + value * plot_w

    def py(value: float) -> float:
        return top + plot_h - (value / CEILING) * plot_h

    pieces = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="Coverage against open tax for seven working-memory rules">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        f'<text x="{left}" y="24" font-family="Helvetica,Arial" font-size="15" font-weight="600">'
        f'Coverage against open tax, seven rules on one grid (403 graded episodes, 654 discharged writes)</text>',
    ]
    for step in range(0, int(CEILING) + 1):
        y = py(step)
        pieces.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width - right}" y2="{y:.1f}" stroke="#e6e6e6"/>')
        pieces.append(f'<text x="{left - 10}" y="{y + 4:.1f}" text-anchor="end" font-family="Helvetica,Arial" '
                      f'font-size="11" fill="#666">{step}</text>')
    for share in (0.0, 0.25, 0.5, 0.75, 1.0):
        x = px(share)
        pieces.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{top + plot_h}" stroke="#f2f2f2"/>')
        pieces.append(f'<text x="{x:.1f}" y="{top + plot_h + 18}" text-anchor="middle" font-family="Helvetica,Arial" '
                      f'font-size="11" fill="#666">{share:.0%}</text>')
    # The line an open tax has to stay under: one unneeded item per required write is a block that is half signal.
    y = py(required)
    pieces.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width - right}" y2="{y:.1f}" stroke="#b3261e" '
                  f'stroke-dasharray="5 4"/>')
    pieces.append(f'<text x="{width - right - 4}" y="{y - 8:.1f}" text-anchor="end" font-family="Helvetica,Arial" '
                  f'font-size="11" fill="#b3261e">{required:.2f} required write(s) per episode</text>')
    for row in rows:
        x, y = px(row["coverage"]), py(row["openTax"])
        pieces.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="{COLOURS[row["label"]]}" '
                      f'stroke="#ffffff" stroke-width="1.5"/>')
        dx, dy = row["place"]
        anchor = "end" if dx < 0 else "start"
        pieces.append(f'<text x="{x + dx:.1f}" y="{y - dy:.1f}" text-anchor="{anchor}" '
                      f'font-family="Helvetica,Arial" font-size="12" fill="#222">{row["label"]}</text>')
    pieces += [
        f'<text x="{left + plot_w / 2:.1f}" y="{height - 22}" text-anchor="middle" font-family="Helvetica,Arial" '
        f'font-size="12" fill="#333">share of the writes the evaluator requires and the episode performed, accounted for</text>',
        f'<text x="18" y="{top + plot_h / 2:.1f}" text-anchor="middle" font-family="Helvetica,Arial" font-size="12" '
        f'fill="#333" transform="rotate(-90 18 {top + plot_h / 2:.1f})">open items per episode that nobody needs</text>',
        '</svg>',
    ]
    return "\n".join(pieces) + "\n"


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Coverage against open tax, from the saved readings.")
    parser.add_argument("--manifests", default="eval/manifests")
    parser.add_argument("--out-svg", default="docs/benchmarks/anchors.svg")
    parser.add_argument("--out-png", default="")
    parser.add_argument("--print", action="store_true", dest="show")
    arguments = parser.parse_args(argv)
    data = load(pathlib.Path(arguments.manifests))
    rows = points(data)
    markup = svg(rows, data["requiredPerEpisode"])
    if arguments.out_svg:
        pathlib.Path(arguments.out_svg).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(arguments.out_svg).write_text(markup)
    if arguments.out_png:
        _png(rows, data["requiredPerEpisode"], data["mechanism"], data["price"],
             pathlib.Path(arguments.out_png))
    if arguments.show:
        for row in rows:
            print(f"{row['label']:16s} coverage {row['coverage']:6.1%}  open tax {row['openTax']:5.2f}/ep  "
                  f"items {row['items']:5d}  items/write {row['perWrite']:5.2f}  precision {row['precision']:.1%}")
    return 0


def _png(rows: list, required: float, mechanism: dict, price: dict, path: pathlib.Path) -> None:
    """The same chart as a raster, plus the panel R230's point cannot show.

    A scatter says where a rule landed. R230 landed where a rule that does almost nothing lands, and the reason is not
    visible on the plane: the transcript it filtered was already 77% answers, and the writes it was meant to rescue
    were mostly *inside* the turns it refused. So the raster carries the composition beside the plane, in the same
    units the round was registered in — turns on one bar, later-turn writes on the other, and the 60% bar drawn where
    the registration put it.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, (axes, side, ladder) = plt.subplots(
        1, 3, figsize=(18.2, 5.2), dpi=165, gridspec_kw={"width_ratios": [1.5, 1, 1]})
    for row in rows:
        axes.scatter(row["coverage"], row["openTax"], s=90, color=COLOURS[row["label"]], zorder=3,
                     edgecolor="white", linewidth=1.6)
        dx, dy = row["place"]
        axes.annotate(row["label"], (row["coverage"], row["openTax"]), textcoords="offset points",
                      xytext=(dx, dy), fontsize=9.5, color="#222", ha="right" if dx < 0 else "left")
    axes.axhline(required, color="#b3261e", linestyle="--", linewidth=1.2)
    axes.text(0.012, required + 0.06, f"{required:.2f} required write(s) per episode", color="#b3261e", fontsize=9)
    axes.set_xlim(0, 1.02)
    axes.set_ylim(0, CEILING)
    axes.set_xlabel("share of required, performed writes the rule accounts for", fontsize=10)
    axes.set_ylabel("open items per episode that nobody needs", fontsize=10)
    axes.set_title("Seven rules, one grid: 403 graded episodes, 654 discharged writes", fontsize=11)
    axes.grid(alpha=0.18)
    for spine in ("top", "right"):
        axes.spines[spine].set_visible(False)

    # The mechanism. Both bars are drawn as **shares of their own denominator**, because the two denominators differ by
    # an order of magnitude (2,453 turns, 155 writes) and a shared count axis would render the second bar invisible —
    # which is the chart that would have hidden the round's finding. The counts stay in the labels.
    kept, refused = mechanism["admitted"], mechanism["refused"]
    recovered, late = mechanism["recovered"], mechanism["late"]
    total = kept + refused
    side.barh([1, 0], [kept / total, recovered / late], color=["#1a73e8", "#188038"], height=0.34, zorder=3)
    side.barh([1, 0], [refused / total, (late - recovered) / late], left=[kept / total, recovered / late],
              color=["#dadce0", "#f6c7c3"], height=0.34, zorder=3)
    side.set_yticks([1, 0])
    side.set_yticklabels(["user turns", "later-turn writes"], fontsize=10)
    side.set_xlim(0, 1.0)
    side.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    side.set_xticklabels(["0%", "25%", "50%", "75%", "100%"], fontsize=9)
    side.set_xlabel("share of its own denominator", fontsize=10)
    side.set_title("R230: what the turn filter was looking at", fontsize=11)
    side.text(kept / total / 2, 1, f"{kept:,} read", fontsize=9, ha="center", va="center", color="#ffffff")
    side.text(kept / total + refused / total / 2, 1 + 0.26,
              f"{refused:,} refused as answers ({refused / total:.1%})", fontsize=9.5, ha="center", va="bottom",
              color="#3c4043")
    side.text(recovered / late / 2, 0 - 0.28, f"{recovered} recovered ({recovered / late:.1%})", fontsize=9.5,
              ha="center", va="top", color="#137333")
    side.text(recovered / late + (late - recovered) / late / 2, 0, f"{late - recovered} lost", fontsize=9,
              ha="center", va="center", color="#5f1b16")
    side.axvline(mechanism["bar"] / late, color="#b3261e", linestyle="--", linewidth=1.2, zorder=4)
    side.text(mechanism["bar"] / late, -0.72, f"bar: {mechanism['bar']} of {late}", color="#b3261e", fontsize=9,
              ha="center", va="top")
    side.set_ylim(-0.95, 1.62)
    side.grid(axis="x", alpha=0.18)
    for spine in ("top", "right", "left"):
        side.spines[spine].set_visible(False)

    # The price. Coverage saturates and items do not: the three rules above 95% are 3,699, 4,761 and 1,633 items for
    # 624, 625 and 644 writes, which is the shape R231's efficiency bar was written to catch — and the reason the bar
    # is a ratio. Drawn in raw units rather than in items-per-write, because the bar's denominator (writes *rescued*)
    # and this axis's (writes *covered*) are two different counts and putting them on one axis would be the category
    # error this repository audits documents for.
    # The ladder holds the admission rules only. The read scopes are a different family — they have no asks, so they
    # are not rules this axis can price — and `ask-bound` lands within a thousandth of the contract on both axes, so
    # drawing it here would put two labels on one point and make the panel about them.
    wanted = ("request", "clause-admission", "every-turn")
    places = {"request": (0, -22, "center"), "clause-admission": (-12, -16, "right"),
              "every-turn": (0, 16, "center")}
    ordered = sorted((row for row in rows if row["label"] in wanted), key=lambda row: row["items"])
    ladder.plot([row["items"] for row in ordered], [row["coverage"] for row in ordered],
                color="#9aa0a6", linewidth=1.4, zorder=2)
    for row in ordered:
        dx, dy, anchor = places[row["label"]]
        ladder.scatter(row["items"], row["coverage"], s=90, color=COLOURS[row["label"]], zorder=3,
                       edgecolor="white", linewidth=1.6)
        ladder.annotate(f"{row['label']}\n{row['items']:,} items, {row['coverage']:.1%}",
                        (row["items"], row["coverage"]), textcoords="offset points", xytext=(dx, dy),
                        fontsize=8.5, color="#222", ha=anchor, va="top" if dy < 0 else "bottom")
    # The elbow, stated as the arithmetic a reader would otherwise do: the last 1,062 items buy one write.
    cheapest = next(row for row in ordered if row["label"] == "clause-admission")
    widest = next(row for row in ordered if row["label"] == "every-turn")
    ladder.annotate("", xy=(widest["items"], 0.885), xytext=(cheapest["items"], 0.885),
                    arrowprops={"arrowstyle": "<->", "color": "#b3261e", "linewidth": 1.1})
    ladder.text((cheapest["items"] + widest["items"]) / 2, 0.865,
                f"+{widest['items'] - cheapest['items']:,} items for +1 covered write",
                fontsize=8.5, color="#b3261e", ha="center", va="top")
    ladder.set_xlim(0, max(row["items"] for row in ordered) * 1.16)
    ladder.set_ylim(min(row["coverage"] for row in ordered) - 0.20, 1.04)
    ladder.set_xlabel("items the rule lists", fontsize=10)
    ladder.set_ylabel("share of required writes accounted for", fontsize=10)
    ladder.set_title("R231: what the extra items bought", fontsize=11)
    ladder.grid(alpha=0.18)
    for spine in ("top", "right"):
        ladder.spines[spine].set_visible(False)

    path.parent.mkdir(parents=True, exist_ok=True)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


if __name__ == "__main__":
    raise SystemExit(main(os.sys.argv[1:]))
