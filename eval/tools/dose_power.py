#!/usr/bin/env python3
"""How many pairs a two-round grid can actually decide, measured on an arm that already ran.

R218e's reading splits each task at its median dose and asks whether the higher-dose attempt passed more often. The
confound is that the attempt which ran longer also received more material, so the reading is only decisive on the pairs
whose turn counts are close — and nobody had counted how many of those a 114 x 2 grid produces. That count decides
whether the round can return a verdict or only a bound, and it is cheaper to measure than to discover: R218b's `front`
arm holds **four attempts at each of 114 tasks in one arm**, the only document in this lane where one task's attempts can
be compared without changing the arm.

Two quantities come out of it:

  * the within-task spread of episode length, which sets how often two attempts land within a turn or two of each other;
  * the within-task disagreement in outcome, which is what a sign test counts — a task whose attempts all pass
    contributes nothing to the test however different its doses are.

The length is the **assistant-message count** and it is a proxy for the recorded `turns`: R219b's phase counted 1,171
agent calls against 1,274 assistant messages over 114 episodes (AUDIT 34.263), so these shares carry about nine percent
of slack. It is used because it is the only per-episode length the paid artefacts hold, and because the quantity the
estimate needs is a within-task *difference*, which the proxy preserves better than it preserves a level.

The power numbers are **enumerated** rather than normal-approximated: the pair counts this grid produces are under
thirty, which is exactly where the approximation is worst.

Usage:
  python3 eval/tools/dose_power.py --document .push/r218b/front.json
  python3 eval/tools/dose_power.py --self-test
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import statistics
import sys
import tempfile
from pathlib import Path

GRID = 114


def _verdict(simulation) -> int:
    """One episode's pass flag, from either shape a reward arrives in: `1` only for a real reward of at least one.

    `reward_info` is a dict in the documents this lane writes and an object in the ones the harness hands back, and a
    string in neither — a string "1" is not a pass, because a document that carries one is a document whose reward was
    parsed by something else.
    """
    reward = simulation.get("reward_info") or {}
    value = reward.get("reward") if isinstance(reward, dict) else getattr(reward, "reward", None)
    return 1 if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 1.0 else 0


def _length(simulation) -> int:
    """The episode's length as the assistant-message count, which is the proxy this file is explicit about."""
    return sum(1 for message in simulation.get("messages") or []
               if isinstance(message, dict) and message.get("role") == "assistant")


def load(path) -> dict:
    """Every episode, keyed by task, as `{length, pass}`, where length is the assistant-message count."""
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    grouped: dict = {}
    for simulation in document.get("simulations") or []:
        if not isinstance(simulation, dict):
            continue
        grouped.setdefault(str(simulation.get("task_id")), []).append(
            {"length": _length(simulation), "pass": _verdict(simulation)}
        )
    return grouped


def _share(values, bound):
    return round(sum(1 for value in values if value <= bound) / len(values), 4) if values else None


def spread(grouped: dict) -> dict:
    """The per-task length spread, the pairwise gaps inside each task, and the disagreement a sign test would see."""
    gaps = []
    rates = []
    for task in sorted(grouped):
        attempts = grouped[task]
        lengths = [attempt["length"] for attempt in attempts]
        if len(lengths) < 2:
            continue
        rates.append(sum(attempt["pass"] for attempt in attempts) / len(attempts))
        gaps.extend(abs(left - right) for left, right in itertools.combinations(lengths, 2))
    pairs = len(gaps)
    return {
        "tasks": len(rates),
        "withinTaskPairs": pairs,
        "gapMedian": statistics.median(gaps) if gaps else None,
        "gapMean": round(statistics.mean(gaps), 2) if gaps else None,
        "gapTied": _share(gaps, 0),
        "gapWithin1": _share(gaps, 1),
        "gapWithin2": _share(gaps, 2),
        "gapWithin3": _share(gaps, 3),
        # What a two-draw grid is expected to disagree on, given each task's own four-attempt pass rate and the
        # exchangeability the sign test takes as its null. `2 p (1 - p)` is the probability that two draws differ.
        "discordantUnderNull": round(statistics.mean([2 * rate * (1 - rate) for rate in rates]), 4) if rates else None,
        "taskPassRateMean": round(statistics.mean(rates), 4) if rates else None,
        "tasksAlwaysPass": sum(1 for rate in rates if rate == 1.0),
        "tasksNeverPass": sum(1 for rate in rates if rate == 0.0),
        "tasksMixed": sum(1 for rate in rates if 0.0 < rate < 1.0),
    }


def sign_test_power(trials: int, shift: float) -> "tuple[float, int | None]":
    """The reject probability of the two-sided exact sign test at 0.05, on `trials` discordant pairs.

    `shift` is the probability that the higher-dose side wins a discordant pair, so `shift = 0.5` is the null. The
    critical value is the largest count whose two-sided tail still fits 0.05, and it is found rather than hard-coded
    because the grid's discordant count is not a number this file chooses.
    """
    if trials <= 0:
        return 0.0, None
    critical = None
    for bound in range(0, trials // 2 + 1):
        tail = sum(math.comb(trials, index) for index in range(0, bound + 1)) / (2**trials)
        if 2 * tail > 0.05:
            critical = bound - 1 if bound else None
            break
    if critical is None or critical < 0:
        return 0.0, critical
    reject = sum(math.comb(trials, index) * shift**index * (1 - shift) ** (trials - index)
                 for index in list(range(0, critical + 1)) + list(range(trials - critical, trials + 1)))
    return reject, critical


def read(grouped: dict, grid: int = GRID) -> dict:
    """The whole estimate: how close a grid's pairs land, and what that leaves the sign test able to see."""
    reading = spread(grouped)
    reading["grid"] = grid
    reading["expectedClosePairs"] = round((reading["gapWithin1"] or 0) * grid, 1)
    reading["expectedDiscordant"] = round(grid * (reading["discordantUnderNull"] or 0), 1)
    reading["expectedDiscordantClose"] = round(reading["expectedClosePairs"] * (reading["discordantUnderNull"] or 0), 1)
    reading["power"] = {
        str(trials): {f"{shift:.2f}": round(sign_test_power(trials, shift)[0], 3)
                      for shift in (0.65, 0.70, 0.75, 0.80, 0.90)}
        for trials in (6, 10, 14, 20, 30)
    }
    return reading


def render(reading: dict) -> str:
    """One sentence a registration can quote, with the proxy and its source named in the same breath."""
    return (
        f"{reading['withinTaskPairs']} within-task attempt pair(s) over {reading['tasks']} task(s): the length gap has "
        f"median {reading['gapMedian']} and mean {reading['gapMean']} turns, {reading['gapTied']:.1%} of pairs are tied "
        f"and {reading['gapWithin1']:.1%} sit within one — so a {reading['grid']}-task, two-round grid expects "
        f"{reading['expectedClosePairs']} close pair(s) and {reading['expectedDiscordant']} discordant one(s), "
        f"{reading['expectedDiscordantClose']} of them close; the length is an assistant-message count, not the "
        f"recorded turn count, so these shares carry about nine percent of slack (AUDIT 34.263)"
    )


def self_test() -> int:
    """The estimate on documents whose answer is known, including the two ends of the tolerance."""
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def episode(task, reward, turns):
        return {"task_id": task, "reward_info": {"reward": reward},
                "messages": [{"role": "assistant", "content": "x"} for _ in range(turns)]}

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)

        def document(payload):
            path = root / f"d{len(list(root.iterdir()))}.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return str(path)

        # --- the document, read as lengths and verdicts ------------------------------------------------------
        grouped = load(document({"simulations": [
            episode("a", 1.0, 3), episode("a", 0.0, 5), episode("b", 1.0, 2), episode("b", 1.0, 2),
        ]}))
        check("both tasks are read", sorted(grouped) == ["a", "b"], sorted(grouped))
        check("a task keeps every attempt", len(grouped["a"]) == 2, grouped["a"])
        check("the length is the assistant count", grouped["a"][1]["length"] == 5, grouped["a"][1])
        check("a pass is one", grouped["b"][0]["pass"] == 1)
        check("a fail is zero", grouped["a"][1]["pass"] == 0, grouped["a"][1])
        check("a junk simulation is skipped", load(document({"simulations": ["junk"]})) == {})
        check("a document with no simulations is empty", load(document({})) == {})
        check("a reward object is read", _verdict({"reward_info": type("I", (), {"reward": 1.0})()}) == 1)
        check("a missing reward is not a pass", _verdict({}) == 0)
        check("a bool reward is not a pass", _verdict({"reward_info": {"reward": True}}) == 0)
        check("a string reward is not a pass", _verdict({"reward_info": {"reward": "1"}}) == 0)
        check("the length counts assistant messages only",
              _length({"messages": [{"role": "assistant"}, {"role": "user"}, {"role": "assistant"},
                                    "junk"]}) == 2)

    # --- the spread -----------------------------------------------------------------------------------------
    flat = spread({"a": [{"length": 4, "pass": 1}, {"length": 4, "pass": 1}],
                   "b": [{"length": 4, "pass": 1}, {"length": 4, "pass": 1}]})
    check("two tasks with two attempts are two tasks", flat["tasks"] == 2)
    check("and two pairs", flat["withinTaskPairs"] == 2)
    check("a flat arm has no gap", flat["gapMedian"] == 0 and flat["gapMean"] == 0.0, flat)
    check("every flat pair is tied", flat["gapTied"] == 1.0)
    check("a task that always passes cannot be discordant", flat["discordantUnderNull"] == 0.0, flat)
    check("and is counted as always passing", flat["tasksAlwaysPass"] == 2)
    check("and none as mixed", flat["tasksMixed"] == 0)
    mixed = spread({
        "a": [{"length": 4, "pass": 1}, {"length": 6, "pass": 0}],
        "b": [{"length": 4, "pass": 0}, {"length": 7, "pass": 0}],
    })
    check("a task with one of two is half", mixed["taskPassRateMean"] == 0.25, mixed)
    check("its disagreement is one half", mixed["discordantUnderNull"] == 0.25, mixed)
    check("a two-turn gap is inside two", mixed["gapWithin2"] == 0.5, mixed)
    check("and nothing is inside one", mixed["gapWithin1"] == 0.0, mixed)
    check("both gaps are inside three", mixed["gapWithin3"] == 1.0, mixed)
    check("only one task moves", mixed["tasksMixed"] == 1 and mixed["tasksNeverPass"] == 1, mixed)
    single = spread({"a": [{"length": 4, "pass": 1}]})
    check("a task with one attempt makes no pair", single["withinTaskPairs"] == 0)
    check("and no rate", single["discordantUnderNull"] is None)
    check("and no median", single["gapMedian"] is None)
    check("and no share", single["gapWithin1"] is None)

    # --- the power, at the two counts the grid is expected to produce ----------------------------------------
    reject, critical = sign_test_power(20, 0.80)
    check("twenty pairs reject at five when the sign is eighty-twenty", critical == 5, critical)
    check("and the power is four fifths", abs(reject - 0.804) < 0.002, reject)
    reject, critical = sign_test_power(6, 0.80)
    check("six pairs need every one of them", critical == 0, critical)
    check("so the power is only the all-six tail", abs(reject - 0.262) < 0.002, reject)
    reject, _ = sign_test_power(30, 0.90)
    check("a large grid sees a large shift", reject > 0.99, reject)
    check("the null is the test's own size", abs(sign_test_power(20, 0.5)[0] - 0.0414) < 0.001,
          sign_test_power(20, 0.5)[0])
    check("no pairs rejects nothing", sign_test_power(0, 0.9) == (0.0, None))
    check("one pair cannot reject at five", sign_test_power(1, 0.9) == (0.0, None))

    # --- the whole reading, and the sentence that carries it -------------------------------------------------
    grouped = {f"t{index}": [{"length": 4, "pass": 1}, {"length": 4 + index % 3, "pass": 0}] for index in range(10)}
    reading = read(grouped, grid=10)
    check("the grid is the grid it was told", reading["grid"] == 10)
    check("ten tasks, ten pairs", reading["withinTaskPairs"] == 10)
    check("the close count is a share of the grid", reading["expectedClosePairs"] <= 10, reading)
    check("every discordant count is a count", reading["expectedDiscordant"] <= 10, reading)
    check("the close subset is never wider than the set",
          reading["expectedDiscordantClose"] <= reading["expectedDiscordant"], reading)
    check("five thresholds are enumerated", sorted(reading["power"]["20"]) == ["0.65", "0.70", "0.75", "0.80", "0.90"])
    check("power rises with the shift", reading["power"]["20"]["0.90"] > reading["power"]["20"]["0.65"])
    check("and with the pairs", reading["power"]["30"]["0.80"] > reading["power"]["14"]["0.80"])
    sentence = render(reading)
    check("the sentence names its source of slack", "about nine percent of slack" in sentence, sentence)
    check("the sentence counts the pairs", "within-task attempt pair(s)" in sentence, sentence)

    import io

    # The command line, on a document of its own: `main` writes to a path, so this needs a directory that outlives the
    # `with` block above rather than the fixture helper's.
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        path = root / "arm.json"
        path.write_text(json.dumps({"simulations": [episode("a", 1.0, 3), episode("a", 0.0, 5)]}), encoding="utf-8")
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            code = main(["--document", str(path)])
        finally:
            sys.stdout = saved
        check("the command answers zero", code == 0)
        check("and prints the reading", "within-task attempt pair(s)" in buffer.getvalue(), buffer.getvalue()[:80])
        out = root / "reading.json"
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            main(["--document", str(path), "--grid", "50", "--out", str(out)])
        finally:
            sys.stdout = saved
        written = json.loads(out.read_text(encoding="utf-8"))
        check("the reading is written where it was asked", written["grid"] == 50, written.get("grid"))
        check("and it names its source", written["source"] == str(path), written.get("source"))
        refused = None
        try:
            main([])
        except SystemExit as error:
            refused = str(error)
        check("a run with no document is refused by name", refused == "dose-power-no-document", refused)

    # The suite's own failure paths, diverted into a buffer: a check whose failing branch has never run is a check that
    # cannot fail visibly, and the report has two answers — this tool's, and the ones the other three modules print.
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
    """Print the failures and the count, and answer with the exit code CI reads.

    A function with a `stream` so the branch that reports a failure can run without failing the build — the same reason
    `board_dose._report` has one.
    """
    out = stream or sys.stderr
    if failures:
        for failure in failures:
            print(f"[power] FAIL {failure}", file=out)
        print(f"[power] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[power] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(description="how many pairs a two-round grid can decide")
    parser.add_argument("--document", default="", help="an arm's `results.json` with several attempts a task")
    parser.add_argument("--grid", type=int, default=GRID, help="the number of tasks the planned grid runs")
    parser.add_argument("--out", default="", help="write the reading here as JSON")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if not arguments.document:
        raise SystemExit("dose-power-no-document")
    reading = read(load(arguments.document), grid=arguments.grid)
    reading["source"] = arguments.document
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(reading, indent=2) + "\n", encoding="utf-8")
    print(render(reading))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
