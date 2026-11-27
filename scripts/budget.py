"""Draw the plan's price, before and after three corrections of reference.

A waterfall is the right shape for this and a bar chart is not: the claim is not that the plan is cheap, it is that
**four lines were each wrong in a nameable way** and that the corrections are attributable one at a time. The fifth
line was not wrong — it was the wrong *shape*: a product quoted as one number, replaced by a ladder. A reader
who sees a total fall from ¥92 to ¥5.3 learns nothing; a reader who sees which line moved, by how much, and what the
wrong quantity was, can disagree with a specific correction.

So this file reads `eval/manifests/plan-costs.json` — the one place the five lines live — checks it against the
manifests that own their numbers, and draws. It does not compute a cost of its own: a drawing that re-derives a
number is a second source for it, and this project has already audited what a second source costs. The fifth line
is the one that is not a price at all: it is a ladder, and each of its rungs is re-multiplied from its own factors
because the cheapest rungs are exactly the ones nobody re-checks.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parents[1]
PLAN = HERE / "eval" / "manifests" / "plan-costs.json"
BUDGET = HERE / "eval" / "manifests" / "bench-budget.json"

#: The lane's red, reused from `display.py` so two figures in one report do not disagree about what red means.
RED = "#c5221f"
GREY = "#9aa0a6"
GREEN = "#1e8e3e"


def load(path: pathlib.Path | None = None) -> dict:
    # The default is resolved at call time rather than bound at definition time: a test that points `PLAN` at a
    # doctored file and gets back the real one is testing the binding rather than the check, which is how the first
    # version of this file's command-line test passed a plan that was not the one it had written.
    return json.loads((path or PLAN).read_text(encoding="utf-8"))


def checked(plan: dict, budget: dict) -> list:
    """Every derived line, re-derived, and every stated total, re-added.

    The three checks are the three ways this file could lie: a line whose `nowCny` is not the arithmetic its own
    source gives, a total that is not the sum of its lines, and — the one that matters — a plan whose external
    benchmarks are priced differently here than in the manifest the build re-derives on every push.
    """
    problems: list = []
    by = {item["id"]: item for item in plan["items"]}

    episodes = plan["episodeUsd"] * plan["cnyPerUsd"]
    if abs(by["R236"]["nowCny"] - 60 * episodes) > 0.02:
        problems.append(f"R236: {by['R236']['nowCny']} against {60 * episodes:.2f} from sixty episodes")
    if abs(by["R237"]["nowCny"] - budget["totalCny"]) > 0.02:
        problems.append(f"R237: {by['R237']['nowCny']} against the budget manifest's {budget['totalCny']}")
    if abs(by["R236"].get("floorCny", by["R236"]["nowCny"]) - 15 * episodes) > 0.02:
        # The floor is not a percentage: it is the stopping rule's first checkpoint, fifteen episodes at the measured
        # price. A floor derived any other way is a number that looks like a bracket and is a guess.
        problems.append(f"R236's floor is not fifteen episodes at the measured price "
                        f"({15 * episodes:.2f})")
    for identifier in ("R235", "R221"):
        if by[identifier]["nowCny"] != 0.0:
            problems.append(f"{identifier}: cancelled or already bought, and priced at {by[identifier]['nowCny']}")

    # A line carried as a ladder is checked rung by rung, because that is the form in which a reader can
    # refuse one factor at a time. The product that preceded it — 278x2x4 as one number — could not be
    # argued with, and the cheapest rungs are exactly the ones nobody re-multiplies.
    for item in plan["items"]:
        rows = item.get("tiers") or []
        if not rows:
            continue
        price = item.get("episodeUsd", plan["episodeUsd"])
        for row in rows:
            expect = row["tasks"] * row["arms"] * row["attempts"] * price * plan["cnyPerUsd"]
            if abs(row["cny"] - expect) > 0.02:
                problems.append(f"{item['id']}: {row['tasks']}x{row['arms']}x{row['attempts']} costs "
                                f"{row['cny']} against {expect:.2f} from its own factors")
        gates = item.get("gates") or []
        for gate in gates:
            rung = gate.get("rung")
            if rung is None:
                continue
            try:
                spec = tuple(int(part) for part in rung.split(":"))
            except ValueError:
                problems.append(f"{item['id']}: {gate['id']} names a rung that is not three integers — {rung}")
                continue
            match = [row for row in rows
                     if (row["tasks"], row["arms"], row["attempts"]) == spec]
            if not match:
                problems.append(f"{item['id']}: {gate['id']} names {rung}, which the ladder does not carry")
            elif abs(gate["cny"] - match[0]["cny"]) > 0.02:
                problems.append(f"{item['id']}: {gate['id']} is priced at {gate['cny']} against the "
                                f"ladder's {match[0]['cny']} for {rung}")
        # What is registered is the first gate that costs anything, and it is checked against that rung:
        # a registration that named a gate and a different price would be two claims wearing one line.
        paid = next((gate for gate in gates if gate.get("cny", 0.0) > 0.0), None)
        if paid is not None and abs(item["nowCny"] - paid["cny"]) > 0.02:
            problems.append(f"{item['id']}: registered at {item['nowCny']} against {paid['id']}'s "
                            f"{paid['cny']}")

    total = sum(item["nowCny"] for item in plan["items"])
    if abs(plan["totalNowCny"] - total) > 0.02:
        problems.append(f"totalNowCny is {plan['totalNowCny']} against {total:.2f}")
    was = sum(item["wasCny"] for item in plan["items"])
    if abs(plan["totalWasCny"] - was) > 0.05:
        problems.append(f"totalWasCny is {plan['totalWasCny']} against {was:.2f}")

    # The claim the figure exists to support, asserted rather than drawn: the corrections are what did the work, and
    # a plan that fell for some other reason would be a plan whose figure says the opposite of its paragraph.
    # The floor, which is the only honest way to quote a bill for a round that can stop early. It is checked against
    # its own lines for the same reason the ceiling is: an interval whose ends come from different arithmetic is two
    # numbers wearing one bracket.
    if "totalFloorCny" in plan:
        floor = sum(item.get("floorCny", item["nowCny"]) for item in plan["items"])
        if abs(plan["totalFloorCny"] - floor) > 0.02:
            problems.append(f"totalFloorCny is {plan['totalFloorCny']} against {floor:.2f}")
        if plan["totalFloorCny"] > plan["totalNowCny"] + 0.02:
            problems.append("the floor is above the ceiling, which is a bracket drawn upside down")
        for item in plan["items"]:
            if item.get("floorCny", item["nowCny"]) > item["nowCny"] + 1e-9:
                problems.append(f"{item['id']}: the floor exceeds the ceiling")

    if not order_of_magnitude(plan):
        problems.append("the corrections did not remove an order of magnitude, so the figure's caption is false")
    return problems


def order_of_magnitude(plan: dict) -> bool:
    """Whether the corrections still leave the plan at a tenth of what it was, as the caption claims."""
    return plan["totalNowCny"] * 10 <= plan["totalWasCny"]


def waterfall(plan: dict, out: pathlib.Path) -> None:
    """The five lines as one descending cascade, starting from what the plan used to cost.

    The direction is the whole figure: a waterfall that started at zero would draw the savings stacked from the
    floor and leave a reader unable to see that R236 and R240b *add* while the other three subtract. So the cascade
    starts at the old total and steps through every line in order, which is the only arrangement in which the last
    step lands on the new total and the intermediate heights mean something.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, axes = plt.subplots(figsize=(11.6, 5.2), dpi=165)
    height = plan["totalWasCny"]
    for index, item in enumerate(plan["items"]):
        step = item["nowCny"] - item["wasCny"]
        axes.bar(index, step, bottom=height, color=RED if step < 0 else GREEN, width=0.54, zorder=3)
        middle = height + step / 2
        label = f"−¥{-step:.2f}" if step < 0 else f"+¥{step:.2f}"
        # The threshold is a share of the axis rather than a number of yuan: a step is legible if the bar has room for
        # the label, and "room" is decided by the drawing's own height, not by the size of the number.
        if abs(step) > plan["totalWasCny"] * 0.07:
            axes.text(index, middle, label, ha="center", va="center", color="white", fontsize=10.5)
        else:
            # A step too short to hold its own label gets it outside the bar, because a label that does not fit is a
            # label nobody reads — and this is the one positive step, so its label is the one a reader needs.
            axes.text(index, middle + 0.6, label, ha="center", va="bottom", color=GREEN, fontsize=10)
        axes.text(index, plan["totalWasCny"] + 2.4, item["id"], ha="center", va="bottom", fontsize=10.5,
                  color="#202124", fontweight="bold")
        axes.text(index, -3.4, f"¥{item['wasCny']:.2f} → ¥{item['nowCny']:.2f}", ha="center", va="top", fontsize=8.8,
                  color=GREY)
        height += step

    # Both reference lines are labelled in the empty left margin rather than beside themselves: at ¥5.34 the closing
    # line sits under the last bar and at ¥92 the opening line sits under the first column's header, and a label
    # placed "beside" either of them lands on a bar.
    axes.axhline(plan["totalNowCny"], color=GREEN, linestyle="--", linewidth=1.1, zorder=2)
    label = f"ceiling ¥{plan['totalNowCny']:.2f}"
    if plan.get("totalFloorCny"):
        # A round that can stop early has a bracket rather than a price, and drawing only the ceiling is drawing the
        # number that makes the plan look most expensive. The floor is R236's own registered stopping rule.
        axes.axhline(plan["totalFloorCny"], color=GREEN, linestyle=":", linewidth=1.1, zorder=2)
        label = (f"ceiling ¥{plan['totalNowCny']:.2f} / floor ¥{plan['totalFloorCny']:.2f} "
                 f"(R236's stopping rule)")
    axes.text(-0.66, plan["totalNowCny"] + 1.6, label, ha="left", fontsize=9.5, color=GREEN)
    axes.axhline(plan["totalWasCny"], color=GREY, linestyle=":", linewidth=1.0, zorder=2)

    axes.set_xticks([])
    axes.set_ylabel("CNY", fontsize=10)
    axes.set_ylim(-2, plan["totalWasCny"] * 1.12)
    axes.set_xlim(-0.75, len(plan["items"]) - 0.25)
    axes.set_title(f"The plan was ¥{plan['totalWasCny']:.2f} and is ¥{plan['totalNowCny']:.2f}: "
                   "every correction is a rate applied to the wrong quantity", fontsize=11.5)
    axes.grid(axis="y", alpha=0.16)
    for spine in ("top", "right", "bottom"):
        axes.spines[spine].set_visible(False)

    notes = [
        "R235 cancelled: its 3.21-point margin IS this domain's floor, so the gate could not pass at any price.",
        "R221 is ¥0 because its 456-episode grids were bought in R218b — \"submit\" was priced as \"produce\".",
        "R237 is ¥2.82 because 99.5% of a long-context set is one shared prefix, billed at 1/50 the miss rate.",
        "What survives buys an external ladder position and a mechanism probe — not a retail accuracy gain.",
        "The floor is registered, not hoped for: R236 stops at fifteen episodes if B1 is already decided either way.",
        "R240b is ¥1.68 because what is registered is the first gate of a ladder, not the 278x2x4 product it replaced.",
        "Each of its rungs is re-multiplied from its own factors on every push, and its floor rises as its task "
        "count falls.",
    ]
    figure.text(0.012, -0.03, "\n".join(notes), fontsize=8.6, color="#3c4043", va="top", family="DejaVu Sans")

    figure.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(out, facecolor="white", bbox_inches="tight")
    plt.close(figure)


def report(failures: list, tail: str = "") -> int:
    """The suite's result, as an exit code and a sentence.

    A function because the failure path is the only part of a suite that runs when the suite is failing, and it is
    the part nobody exercises: the first version of this file had those four lines inline and the coverage run
    reported them as unmeasured on every green build.
    """
    if failures:
        print("FAILED:")
        for name in failures:
            print(f"  {name}")
        return 1
    print(f"budget: all assertions hold{tail}")
    return 0


def self_test() -> int:
    """The checks, driven, and the drawing, produced."""
    failures: list = []

    def judge(into: list):
        def check(name: str, condition: bool) -> None:
            if not condition:
                into.append(name)
        return check

    check = judge(failures)
    scratch: list = []
    judge(scratch)("a deliberate failure", False)
    check("a failing assertion is recorded rather than dropped", scratch == ["a deliberate failure"])

    plan, budget = load(), json.loads(BUDGET.read_text(encoding="utf-8"))
    check("the plan's own numbers agree with the manifests that own them", checked(plan, budget) == [])
    check("five lines, two of them cancelled or already bought",
          len(plan["items"]) == 5 and sum(1 for item in plan["items"] if item["nowCny"] == 0) == 2)
    ladder_item = next(item for item in plan["items"] if item["id"] == "R240b")
    check("and one of them is carried as a ladder rather than as a product",
          len(ladder_item["tiers"]) == 10 and ladder_item["tiers"][0]["tasks"] == 278)
    # The ladder's reason for existing, asserted: its rungs must answer different questions at different
    # prices, or the table is decoration around one number.
    prices = sorted(row["cny"] for row in ladder_item["tiers"])
    resolutions = sorted(row["mde"] for row in ladder_item["tiers"])
    check("its cheapest rung is not its sharpest, and its sharpest is not its cheapest",
          prices[0] < prices[-1] / 50 and resolutions[0] < resolutions[-1] / 3)
    check("shrinking the sample raises the floor, which is why a cheap rung is not a free one",
          ladder_item["tiers"][-1]["floor"] is None
          or all(row["floor"] is None or row["floor"] > 0 for row in ladder_item["tiers"]))

    doctored = json.loads(json.dumps(plan))
    doctored["items"][2]["nowCny"] = 20.0
    check("a line repriced away from the budget manifest is caught", checked(doctored, budget) != [])
    doctored = json.loads(json.dumps(plan))
    doctored["items"][1]["nowCny"] = 9.0
    check("an episode line that is not sixty episodes at the measured price is caught",
          checked(doctored, budget) != [])
    doctored = json.loads(json.dumps(plan))
    doctored["items"][0]["nowCny"] = 1.0
    check("a cancelled line that has been given a price is caught", checked(doctored, budget) != [])
    doctored = json.loads(json.dumps(plan))
    doctored["totalNowCny"] = 92.2
    check("a total that is not the sum of its lines is caught", checked(doctored, budget) != [])
    doctored = json.loads(json.dumps(plan))
    doctored["totalFloorCny"] = 20.0
    check("a floor that is not the sum of its own lines is caught",
          any("totalFloorCny" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    doctored["totalFloorCny"] = 99.0
    doctored["items"][1]["floorCny"] = 50.0
    check("a floor above its ceiling is caught as a bracket drawn upside down",
          any("floor" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    doctored["totalWasCny"] = 100.0
    check("an opening total that is not the sum of what the plan used to cost is caught",
          any("totalWasCny" in problem for problem in checked(doctored, budget)))

    # The ladder's four ways to lie, each doctored into the same plan the build checks.
    doctored = json.loads(json.dumps(plan))
    ladder = next(item for item in doctored["items"] if item["id"] == "R240b")
    ladder["tiers"][5]["cny"] = 0.5
    check("a rung that is not its own factors times the price is caught",
          any("costs" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    ladder = next(item for item in doctored["items"] if item["id"] == "R240b")
    ladder["gates"][1]["cny"] = 12.0
    check("a gate priced away from its own rung is caught",
          any("against the" in problem and "ladder's" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    ladder = next(item for item in doctored["items"] if item["id"] == "R240b")
    ladder["gates"][1]["rung"] = "41:1:1"
    check("a gate that names a rung the ladder does not carry is caught",
          any("does not carry" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    ladder = next(item for item in doctored["items"] if item["id"] == "R240b")
    ladder["gates"][1]["rung"] = "forty"
    check("and a rung that is not three integers is named rather than crashed into",
          any("not three integers" in problem for problem in checked(doctored, budget)))
    doctored = json.loads(json.dumps(plan))
    ladder = next(item for item in doctored["items"] if item["id"] == "R240b")
    ladder["nowCny"] = 50.0
    check("a registration that does not match the gate it claims is caught",
          any("registered at" in problem for problem in checked(doctored, budget)))
    check("the caption's arithmetic holds on the plan as it stands", order_of_magnitude(plan) is True)
    check("and a plan that only halved is not described as an order of magnitude",
          order_of_magnitude({"totalNowCny": 40.0, "totalWasCny": 92.2}) is False)

    # The command line, driven in this process so the coverage run measures it rather than a child.
    import contextlib
    import io

    saved_argv = sys.argv

    def command(*arguments) -> tuple:
        printed = io.StringIO()
        try:
            sys.argv = [str(pathlib.Path(__file__).resolve()), *arguments]
            with contextlib.redirect_stdout(printed):
                return main(), printed.getvalue()
        finally:
            sys.argv = saved_argv

    import tempfile
    with tempfile.TemporaryDirectory() as temporary:
        out = pathlib.Path(temporary) / "budget.png"
        code, printed = command("--out", str(out))
        check("the figure is drawn from the command line and is not empty",
              code == 0 and out.exists() and out.stat().st_size > 8000 and "wrote" in printed)
        code, printed = command()
        check("and a plain run prints every line and the two totals",
              code == 0 and "R236" in printed and "total" in printed)

        # The bracket is an option rather than a shape every plan has: a plan with one line that cannot stop
        # early has a price, not an interval, and both paths have to be drawn rather than only the one the
        # repository happens to be in.
        bare = json.loads(json.dumps(plan))
        del bare["totalFloorCny"]
        check("a plan with no floor is still checked against its ceiling", checked(bare, budget) == [])
        bare_out = pathlib.Path(temporary) / "bare.png"
        waterfall(bare, bare_out)
        check("and draws its ceiling without inventing a floor", bare_out.exists() and bare_out.stat().st_size > 8000)

        # A plan that does not add up is refused by the command line, not only by the checker: this is the path a
        # build takes, and a check that only the test can reach is a check that runs nowhere.
        broken = pathlib.Path(temporary) / "plan.json"
        doctored = json.loads(json.dumps(plan))
        doctored["totalNowCny"] = 92.2
        broken.write_text(json.dumps(doctored), encoding="utf-8")
        original = PLAN
        try:
            globals()["PLAN"] = broken
            code, printed = command()
        finally:
            globals()["PLAN"] = original
        check("a plan whose total is wrong exits non-zero and names the line",
              code == 1 and "totalNowCny" in printed)

    # The reporter, driven both ways, and the module loaded as a module so the file is measured on the path an
    # importer takes as well as on the path a script does.
    quiet = io.StringIO()
    with contextlib.redirect_stdout(quiet):
        failing = report(["a named failure"])
    check("the reporter exits one and names what failed",
          failing == 1 and "FAILED:" in quiet.getvalue() and "a named failure" in quiet.getvalue())
    quiet = io.StringIO()
    with contextlib.redirect_stdout(quiet):
        passing = report([])
    check("and exits zero when nothing failed", passing == 0)

    import importlib.util
    spec = importlib.util.spec_from_file_location("budget_as_module", pathlib.Path(__file__).resolve())
    as_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(as_module)
    check("the file is importable without drawing anything", as_module.RED == RED)

    return report(failures, f" — ¥{plan['totalWasCny']:.1f} to ¥{plan['totalNowCny']:.2f}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Draw the plan's price, before and after its corrections.")
    parser.add_argument("--out", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()
    plan = load()
    problems = checked(plan, json.loads(BUDGET.read_text(encoding="utf-8")))
    if problems:
        print("the plan does not add up:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    if arguments.out:
        waterfall(plan, pathlib.Path(arguments.out))
        print(f"budget: wrote {arguments.out}")
    for item in plan["items"]:
        print(f"{item['id']:5s} was ¥{item['wasCny']:6.2f}  now ¥{item['nowCny']:5.2f}  {item['status']:9s} "
              f"{item['why']}")
    print(f"total  was ¥{plan['totalWasCny']:6.2f}  now ¥{plan['totalNowCny']:5.2f}"
          f"  floor ¥{plan.get('totalFloorCny', plan['totalNowCny']):5.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
