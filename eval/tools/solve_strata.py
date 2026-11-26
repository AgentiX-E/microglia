#!/usr/bin/env python3
"""Where a memory arm's deficit comes from: the tasks the control already solves, or the ones it never does.

Every arm-level reading in this lane is a mean, and a mean over 114 tasks cannot say whether a treatment *damaged* the
tasks the no-memory arm had already solved or merely failed to repair the ones it had not. R216b answered that across
dispatches — 15 rescues against 6 breaks — and cross-dispatch is where this lane's numbers go to die: the same
configuration has read 86.84%, 81.60% and 78.07% inside one afternoon.

This tool answers it **inside one grid**. R218b ran a `control` arm and a treated arm over the same 114 tasks and the
same seed world with **four attempts each**, which is the only artefact on disk where both sides of that decomposition
are in the same dispatch and carry repetition. It joins the two documents by task and stratifies on the control's own
pass rate — a quantity fixed before the treatment exists, which is what keeps the stratification from reading
difficulty as an effect.

Three numbers come out, and the third is the one that decides what to do next:

  * **damage** — the tasks the control solved every attempt and the treatment solved fewer of;
  * **rescue** — the tasks the control never solved and the treatment solved some of;
  * **the stratum profile** — the paired difference inside each control stratum, because a treatment that helps the
    hard tasks and damages the easy ones nets to zero across the grid while being two opposite findings.

The unit of evidence is the **task**, and the repeated attempts are what make a task's rate meaningful: a single
attempt a task cannot separate "the treatment hurt here" from "this task fails one time in four".

Usage:
  python3 eval/tools/solve_strata.py --control control.json --treatment front.json --label front
  python3 eval/tools/solve_strata.py --self-test
"""

from __future__ import annotations

import argparse
import io
import json
import math
import statistics
import sys
import tempfile
from pathlib import Path


def _verdict(simulation) -> int:
    """One episode's pass flag, from either shape a reward arrives in."""
    reward = simulation.get("reward_info") or {}
    value = reward.get("reward") if isinstance(reward, dict) else getattr(reward, "reward", None)
    return 1 if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 1.0 else 0


def rates(path) -> "tuple[dict, int]":
    """Every task's pass rate in one arm, and the number of attempts the arm made at it."""
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    counted: dict = {}
    for simulation in document.get("simulations") or []:
        if not isinstance(simulation, dict):
            continue
        task = str(simulation.get("task_id"))
        bucket = counted.setdefault(task, [0, 0])
        bucket[0] += _verdict(simulation)
        bucket[1] += 1
    attempts = statistics.mode([total for _, total in counted.values()]) if counted else 0
    return {task: (passed, total) for task, (passed, total) in counted.items()}, attempts


def _sign_test(positive: int, negative: int) -> "float | None":
    """The two-sided exact sign test, the same arithmetic the dose reader uses and for the same reason: pairs."""
    total = positive + negative
    if total == 0:
        return None
    tail = sum(math.comb(total, index) for index in range(0, min(positive, negative) + 1)) / (2**total)
    return min(1.0, 2 * tail)


def _stratum(control_rate: float) -> str:
    """Which control stratum a task is in: never solved, always solved, or the ones that move.

    The comparison is against **one**, not against the attempt count: the rate is already a rate, and the first
    version of this function compared it with `attempts`, which put every task in `mixed` and made the two strata the
    decomposition is about disappear while the table still printed.
    """
    if control_rate == 0.0:
        return "never"
    if control_rate == 1.0:
        return "always"
    return "mixed"


def read(control_path, treatment_path, label: str = "treatment", strata_from=None) -> dict:
    """The decomposition, the strata, and the paired test over the tasks that moved.

    `strata_from` runs the other reading: the strata come from a document **of another dispatch**, and then there is no
    delta and no sign test, because the arm in `control_path` is a covariate measured before this treatment rather than
    a run of the same grid. That distinction is the reason the two modes are separate functions of the input rather
    than a note on one table: 114 tasks are shared across R218b and R219b, and a baseline borrowed across two
    dispatches is exactly the comparison this lane has measured reading +7.9 and −6.1 for one configuration.
    """
    control, control_attempts = rates(control_path)
    treatment, treatment_attempts = rates(treatment_path)
    shared = sorted(set(control) & set(treatment))
    if not shared:
        return {"state": "NO_SHARED_TASKS", "control": len(control), "treatment": len(treatment)}

    if strata_from is not None:
        strata: dict = {}
        for task in shared:
            passed_control, total_control = control[task]
            passed_treatment, total_treatment = treatment[task]
            row = strata.setdefault(_stratum(passed_control / total_control),
                                    {"tasks": 0, "covariate": 0.0, "treatment": 0.0})
            row["tasks"] += 1
            row["covariate"] += passed_control / total_control
            row["treatment"] += passed_treatment / total_treatment
        for row in strata.values():
            row["covariateRate"] = round(row["covariate"] / row["tasks"], 3)
            row["treatmentRate"] = round(row["treatment"] / row["tasks"], 3)
        return {
            "state": "STRATA_ONLY",
            "label": label,
            "strataSource": strata_from,
            "tasks": len(shared),
            "attempts": {"covariate": control_attempts, "treatment": treatment_attempts},
            "treatmentRate": round(
                statistics.mean([p / n for p, n in (treatment[t] for t in shared)]), 4),
            "covariateRate": round(statistics.mean([p / n for p, n in (control[t] for t in shared)]), 4),
            "strata": strata,
            "resolution": round(1.0 / max(1, control_attempts), 3),
        }

    strata = {}
    moved_up = moved_down = 0
    damage = []
    rescue = []
    differences = []
    for task in shared:
        passed_control, total_control = control[task]
        passed_treatment, total_treatment = treatment[task]
        c = passed_control / total_control
        t = passed_treatment / total_treatment
        differences.append(t - c)
        row = strata.setdefault(_stratum(c), {"tasks": 0, "control": 0.0, "treatment": 0.0,
                                                             "up": 0, "down": 0})
        row["tasks"] += 1
        row["control"] += c
        row["treatment"] += t
        if t > c:
            row["up"] += 1
            moved_up += 1
        elif t < c:
            row["down"] += 1
            moved_down += 1
        if c == 1.0 and t < 1.0:
            damage.append(task)
        if c == 0.0 and t > 0.0:
            rescue.append(task)

    for name, row in strata.items():
        row["controlRate"] = round(row["control"] / row["tasks"], 3)
        row["treatmentRate"] = round(row["treatment"] / row["tasks"], 3)
        row["delta"] = round(row["treatmentRate"] - row["controlRate"], 3)
    return {
        "state": "STRATA_READ",
        "label": label,
        "tasks": len(shared),
        "attempts": {"control": control_attempts, "treatment": treatment_attempts},
        "controlRate": round(statistics.mean([p / n for p, n in (control[t] for t in shared)]), 4),
        "treatmentRate": round(statistics.mean([p / n for p, n in (treatment[t] for t in shared)]), 4),
        "delta": round(statistics.mean(differences), 4),
        "movedUp": moved_up,
        "movedDown": moved_down,
        "p": _sign_test(moved_up, moved_down),
        "damagedTasks": len(damage),
        "rescuedTasks": len(rescue),
        "damaged": damage[:12],
        "rescued": rescue[:12],
        "strata": strata,
        # Reported so the reading cannot be quoted without its resolution: 114 tasks with 4 attempts each resolves a
        # task-level rate to a quarter, which is the coarsest unit in the table.
        "resolution": round(1.0 / max(1, control_attempts), 3),
    }


def render(reading: dict) -> str:
    """One sentence a reader can quote, with the decomposition and the strata in the same breath."""
    if reading["state"] == "STRATA_ONLY":
        parts = [
            f"{name} {row['tasks']} task(s) {row['covariateRate']:.0%} → {row['treatmentRate']:.0%}"
            for name, row in sorted(reading["strata"].items())
        ]
        return (
            f"{reading['label']} read against the control **strata** of another dispatch, {reading['tasks']} task(s) "
            f"at {reading['attempts']['covariate']} attempt(s) in the covariate: {reading['treatmentRate']:.1%} "
            f"against a covariate rate of {reading['covariateRate']:.1%}; by stratum: {'; '.join(parts)} — no delta "
            "and no sign test are reported, because a baseline borrowed across two dispatches is a covariate and not "
            "a control"
        )
    if reading["state"] != "STRATA_READ":
        return f"{reading['state']}: the two documents share no task, so there is nothing to pair"
    strata = reading["strata"]
    parts = [
        f"{name} {row['tasks']} task(s) {row['controlRate']:.0%} → {row['treatmentRate']:.0%}"
        for name, row in sorted(strata.items(), key=lambda item: item[0])
    ]
    return (
        f"{reading['label']} against the control inside one grid, {reading['tasks']} task(s) at "
        f"{reading['attempts']['control']} attempt(s) each: {reading['controlRate']:.1%} → "
        f"{reading['treatmentRate']:.1%} ({reading['delta']:+.1%}), {reading['movedUp']} task(s) up and "
        f"{reading['movedDown']} down (sign test p = "
        f"{reading['p'] if reading['p'] is None else format(reading['p'], '.4f')}); "
        f"{reading['damagedTasks']} of the tasks the control solved every attempt came out worse, "
        f"{reading['rescuedTasks']} of the tasks it never solved came out better; by control stratum: "
        f"{'; '.join(parts)} — and one attempt a task would have resolved none of this, "
        f"because the unit is a rate of {reading['attempts']['control']} and the resolution is "
        f"{reading['resolution']:.2f}"
    )


def self_test() -> int:
    """The decomposition on documents whose answer is known, including both directions of movement."""
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def episode(task, reward):
        return {"task_id": task, "reward_info": {"reward": reward}}

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)

        def document(name, payload):
            path = root / name
            path.write_text(json.dumps({"simulations": payload}), encoding="utf-8")
            return str(path)

        # `a` is solved every attempt by the control and broken twice by the treatment (damage). `b` is never solved
        # by the control and solved once by the treatment (rescue). `c` moves inside the mixed stratum, `d` is
        # untouched by both.
        control = (document("control.json", [
            episode("a", 1.0), episode("a", 1.0), episode("a", 1.0), episode("a", 1.0),
            episode("b", 0.0), episode("b", 0.0), episode("b", 0.0), episode("b", 0.0),
            episode("c", 1.0), episode("c", 0.0), episode("c", 1.0), episode("c", 0.0),
            episode("d", 1.0), episode("d", 1.0), episode("d", 0.0), episode("d", 0.0),
        ]))
        treatment = (document("treatment.json", [
            episode("a", 1.0), episode("a", 0.0), episode("a", 1.0), episode("a", 0.0),
            episode("b", 0.0), episode("b", 0.0), episode("b", 0.0), episode("b", 1.0),
            episode("c", 0.0), episode("c", 0.0), episode("c", 1.0), episode("c", 0.0),
            episode("d", 1.0), episode("d", 1.0), episode("d", 0.0), episode("d", 1.0),
        ]))
        reading = read(control, treatment, label="front")
        check("a grid is read", reading["state"] == "STRATA_READ", reading["state"])
        check("four tasks are shared", reading["tasks"] == 4, reading["tasks"])
        check("four attempts a task are seen", reading["attempts"] == {"control": 4, "treatment": 4},
              reading["attempts"])
        check("the control reads half the attempts it made", reading["controlRate"] == 0.5, reading["controlRate"])
        check("the treatment reads seven of sixteen", reading["treatmentRate"] == 0.4375, reading["treatmentRate"])
        check("the delta is the difference", reading["delta"] == -0.0625, reading["delta"])
        check("two tasks moved up", reading["movedUp"] == 2, reading["movedUp"])
        check("two tasks moved down", reading["movedDown"] == 2, reading["movedDown"])
        check("two up and two down is p = 1", reading["p"] == 1.0, reading["p"])
        check("a solved task that got worse is damage", reading["damagedTasks"] == 1, reading["damaged"])
        check("and it is named", reading["damaged"] == ["a"], reading["damaged"])
        check("a never-solved task that got solved is a rescue", reading["rescuedTasks"] == 1, reading["rescued"])
        check("the always stratum holds one task", reading["strata"]["always"]["tasks"] == 1, reading["strata"])
        check("the never stratum holds one", reading["strata"]["never"]["tasks"] == 1)
        check("the mixed stratum holds two", reading["strata"]["mixed"]["tasks"] == 2)
        check("damage is inside the always stratum", reading["strata"]["always"]["down"] == 1)
        check("rescue is inside the never stratum", reading["strata"]["never"]["up"] == 1)
        check("the mixed stratum moved both ways",
              reading["strata"]["mixed"]["up"] == 1 and reading["strata"]["mixed"]["down"] == 1, reading["strata"])
        check("a stratum reports its own delta", reading["strata"]["always"]["delta"] == -0.5,
              reading["strata"]["always"])
        check("the resolution is one attempt", reading["resolution"] == 0.25, reading["resolution"])
        sentence = render(reading)
        check("the sentence names the label", sentence.startswith("front against the control"), sentence)
        check("the sentence counts the damage", "came out worse" in sentence)
        check("and says what one attempt would have resolved", "would have resolved none of this" in sentence)

        # The cross-dispatch mode: the strata are borrowed and the delta is not, because a borrowed baseline is a
        # covariate rather than a control.
        borrowed = read(control, treatment, label="front", strata_from=control)
        check("borrowed strata are their own state", borrowed["state"] == "STRATA_ONLY", borrowed["state"])
        check("and carry no delta", "delta" not in borrowed, sorted(borrowed))
        check("and no sign test", "p" not in borrowed, sorted(borrowed))
        check("and name where the strata came from", borrowed["strataSource"] == control)
        check("the covariate rate is reported", borrowed["covariateRate"] == 0.5, borrowed["covariateRate"])
        check("and the treatment rate beside it", borrowed["treatmentRate"] == 0.4375, borrowed["treatmentRate"])
        check("the always stratum is still one task", borrowed["strata"]["always"]["tasks"] == 1)
        check("with a covariate rate of one", borrowed["strata"]["always"]["covariateRate"] == 1.0)
        check("and a treatment rate of one half", borrowed["strata"]["always"]["treatmentRate"] == 0.5)
        check("the sentence refuses the delta", "no delta" in render(borrowed), render(borrowed))

        # A grid in which nothing moves: the sign test has nothing to test and says so rather than answering.
        still = read(control, control, label="itself")
        check("an arm against itself does not move", still["movedUp"] == 0 and still["movedDown"] == 0, still)
        check("and has no p", still["p"] is None)
        check("and no damage", still["damagedTasks"] == 0)
        # Nothing shared is a refusal rather than a zero: two documents about different populations cannot pair.
        other = document("other.json", [episode("z", 1.0), episode("z", 1.0)])
        empty = read(control, other)
        check("two disjoint grids refuse", empty["state"] == "NO_SHARED_TASKS", empty)
        check("and the refusal counts both sides", empty["control"] == 4 and empty["treatment"] == 1, empty)
        check("and the sentence says why", "share no task" in render(empty))
        # The reward shapes, and a document whose episodes are not all dictionaries.
        check("a reward object is read", _verdict({"reward_info": type("I", (), {"reward": 1.0})()}) == 1)
        check("a bool reward is not a pass", _verdict({"reward_info": {"reward": True}}) == 0)
        check("a junk simulation does not crash the reader",
              rates(document("junk.json", ["junk", episode("q", 1.0)]))[0] == {"q": (1, 1)})

        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            code = main(["--control", control, "--treatment", treatment])
        finally:
            sys.stdout = saved
        check("the command answers zero", code == 0)
        check("and prints the sentence", "against the control inside one grid" in buffer.getvalue(),
              buffer.getvalue()[:80])
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            code = main(["--control", control, "--treatment", treatment, "--strata-from", control,
                         "--label", "borrowed"])
        finally:
            sys.stdout = saved
        check("the borrowed mode answers zero", code == 0)
        check("and prints that it borrowed", "of another dispatch" in buffer.getvalue(), buffer.getvalue()[:80])
        out = root / "strata.json"
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            main(["--control", control, "--treatment", treatment, "--out", str(out)])
        finally:
            sys.stdout = saved
        written = json.loads(out.read_text(encoding="utf-8"))
        check("the reading is written where it was asked", written["state"] == "STRATA_READ", written.get("state"))
        check("and it carries the strata", "mixed" in written["strata"])
        refused = None
        try:
            main(["--control", control])
        except SystemExit as error:
            refused = str(error)
        check("a run with one document is refused by name", refused == "solve-strata-needs-two-documents", refused)

    # The suite's own failure paths, diverted into a buffer: a check whose failing branch has never run is a check that
    # cannot fail visibly, and the report has two answers.
    planted_at = len(failures)
    check("a check that must fail", False, "deliberate")
    check("a check that must fail without a detail", False)
    planted = failures[planted_at:]
    del failures[planted_at:]
    cases -= 2
    check("the suite can say no", len(planted) == 2, planted)
    check("a failure with a detail carries it", ": deliberate" in planted[0], planted[0])
    buffer = io.StringIO()
    check("the report answers one for a failure", _report(["planted"], 2, buffer) == 1 and "planted" in buffer.getvalue())
    buffer = io.StringIO()
    check("the report answers zero for none", _report([], 2, buffer) == 0 and "2 check(s) passed" in buffer.getvalue())

    return _report(failures, cases)


def _report(failures: "list[str]", cases: int, stream=None) -> int:
    out = stream or sys.stderr
    if failures:
        for failure in failures:
            print(f"[strata] FAIL {failure}", file=out)
        print(f"[strata] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[strata] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(description="where a memory arm's deficit comes from")
    parser.add_argument("--control", default="", help="the no-memory arm's results document")
    parser.add_argument("--treatment", default="", help="the treated arm's results document, same grid")
    parser.add_argument("--label", default="treatment", help="what the treated arm is called in the sentence")
    # The cross-dispatch mode: the strata come from a document of another dispatch and the reading loses its delta.
    parser.add_argument("--strata-from", default="", help="a control document whose strata only are borrowed")
    parser.add_argument("--out", default="", help="write the reading here as JSON")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if not arguments.control or not arguments.treatment:
        raise SystemExit("solve-strata-needs-two-documents")
    reading = read(arguments.control, arguments.treatment, label=arguments.label,
                   strata_from=arguments.strata_from or None)
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(reading, indent=2) + "\n", encoding="utf-8")
    print(render(reading))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
