#!/usr/bin/env python3
"""What a second attempt does after a first one failed — the counterfactual a note has to beat.

R211 exists because the fold R210 planned would have been blind. `pass^k` is "every one of the k attempts
passed", a note is written only after a failed attempt, and the driver writes notes only *between* rounds
(`run_split.py:1290`). So a task that ever receives a note has already failed attempt 0 and its `pass^k` is zero
whatever the note says, while a task that passes attempt 0 never has a note to read. The headline that forty
hundred episodes were bought to move is identically zero in expectation, and the mechanism lives one level down:
in the transition from a failed attempt to the one after it.

This reader measures that transition, and it measures the only honest baseline for it — the same transition with
no note at all. R208's bank already paid for that baseline: on the fifty tasks that failed somewhere, an attempt
that follows a failed attempt passes **15 of 23 times (65.2%)** with nothing carried. A note that "rescued seven
tasks" has rescued nothing if the arm would have won five of them anyway.

Usage:
  python3 eval/tools/rescue_rate.py --dir eval/results/note-rescue/treatment \
      --baseline eval/manifests/note-bank-baseline.json
  python3 eval/tools/rescue_rate.py --bank one-results.json --json /tmp/rescue.json
  python3 eval/tools/rescue_rate.py --self-test

Exit codes: 0 a reading was made (`RESCUED` or `NO_LIFT`), 2 nothing to measure, 3 the arms did not agree on the
grid they ran (drift), 4 the input is unreadable. A `NO_LIFT` is an answer and a green job; a `DRIFT` is a void
comparison and is not.
"""

from __future__ import annotations

import argparse
import json
import sys
from math import comb
from pathlib import Path

# The registered scale of the effect. R211 buys one question — is the note worth at least this much — and a
# smaller effect is declared out of scope before the run rather than after it.
REGISTERED_PP = 25.0
ALPHA = 0.05
# How far the treatment's own first attempt may drift from the bank's before the comparison is void. Four tasks
# in fifty is 8 points on a rate whose standard error at fifty is about 7, so this is one standard error rounded.
DRIFT_TASKS = 4


def trials_of(document) -> dict[str, dict[int, float]]:
    """`{task: {trial: reward}}`, unscored trials dropped, ordered by the trial the episode declares.

    Ordered by the declared trial and not by position: the rate this file exists for is conditional on *which*
    attempt came first, and a document whose arrival order disagreed with its trial numbers would otherwise
    measure the transition 1→0. `note_bank.rows_of` deliberately does not care — a census is order-blind — which
    is why this is a second reader rather than a call to the first.
    """
    by_task: dict[str, dict[int, float]] = {}
    simulations = document.get("simulations") if isinstance(document, dict) else None
    for index, simulation in enumerate(simulations if isinstance(simulations, list) else []):
        if not isinstance(simulation, dict):
            continue
        task = simulation.get("task_id")
        if not isinstance(task, str) or task.strip() == "":
            continue
        info = simulation.get("reward_info")
        reward = info.get("reward") if isinstance(info, dict) else None
        if not isinstance(reward, (int, float)) or isinstance(reward, bool):
            continue
        declared = simulation.get("trial")
        trial = declared if isinstance(declared, int) and not isinstance(declared, bool) else index
        by_task.setdefault(task.strip(), {})[trial] = float(reward)
    return by_task


def rescue_of(document, transition: tuple[int, int] = (0, 1), tasks=None, pooled: bool = False) -> dict:
    """How often the attempt after a failed one passed, with the denominator that makes it a rate.

    `fail` is the number of opportunities (a scored attempt at `from` that failed and has a scored `to`), and it
    is also the size of the population: a rate over eight opportunities and a rate over three are both numbers
    and only one of them is evidence.

    `pooled` sums every consecutive pair instead of one transition. On a four-round arm that is the difference
    between eleven opportunities and forty-four, and the transitions are the same event — an attempt that
    follows a failure — with a note that by round two is longer than the one round one carried. Pooling is
    therefore a statement about the material *as it accumulates*, and `render` prints the transition so a reader
    knows which claim is being made.
    """
    wanted = set(tasks) if tasks else None
    by_task = trials_of(document)
    if wanted is not None:
        by_task = {task: trials for task, trials in by_task.items() if task in wanted}
    first, second = transition
    failed = 0
    rescued = 0
    for trials in by_task.values():
        pairs = []
        if pooled:
            trial_numbers = sorted(trials)
            pairs = list(zip(trial_numbers, trial_numbers[1:]))
        elif first in trials and second in trials:
            pairs = [(first, second)]
        for left, right in pairs:
            if trials[left] >= 1.0:
                continue
            failed += 1
            rescued += 1 if trials[right] >= 1.0 else 0
    return {
        "transition": "pooled" if pooled else f"{first}->{second}",
        "tasks": len(by_task),
        "fail": failed,
        "rescue": rescued,
        "rate": (rescued / failed) if failed else None,
    }


def upper_bound(k: int, n: int, level: float = 1 - ALPHA / 2) -> float | None:
    """Clopper-Pearson's upper limit, by bisection on the exact binomial tail.

    Standard library only, because this file runs wherever `python3` does — the argument for the exact tail over
    a normal approximation is that n is twenty-three, and the whole point of buying twenty-three opportunities is
    to be able to say something at that size rather than to assume the asymptotics arrived.
    """
    if n <= 0 or k < 0 or k > n:
        return None
    if k == n:
        return (1 - level) ** (1 / n)

    def cdf(p: float) -> float:
        return sum(comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k + 1))

    low, high = 0.0, 1.0
    for _ in range(60):
        middle = (low + high) / 2
        if cdf(middle) > 1 - level:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def fisher_two_sided(a: int, b: int, c: int, d: int) -> float | None:
    """The exact two-sided p for `[[a, b], [c, d]]`, by summing outcomes no likelier than the observed one.

    Exact rather than asymptotic for the same reason as `upper_bound`: both margins are about twenty, and the
    question "did the note add anything" is decided on a table this small.
    """
    if min(a, b, c, d) < 0:
        return None
    total = a + b + c + d
    if total == 0:
        return None
    row, column = a + b, a + c
    if row == 0 or column == 0 or row == total or column == total:
        return 1.0

    def mass(x: int) -> float:
        return comb(column, x) * comb(total - column, row - x) / comb(total, row)

    observed = mass(a)
    low, high = max(0, row + column - total), min(row, column)
    return min(1.0, sum(mass(x) for x in range(low, high + 1) if mass(x) <= observed + 1e-12))


def drift_of(document, baseline, tasks=None, tolerance: int = DRIFT_TASKS) -> dict:
    """Whether the treatment's own first attempt agrees with the bank's on the same tasks.

    The treatment arm's first attempt is a free control: no note exists before it, because a note is written at
    the end of a round. So its pass count at attempt 0 is a sample from the same process the bank was sampled
    from, and a disagreement is the one thing that invalidates reusing the bank's baseline — provider drift,
    a release change, or a task list that is not the list it claims. This is the gate that makes buying one arm
    rather than two defensible, and it is checked rather than assumed.
    """
    wanted = set(tasks) if tasks else None
    by_task = trials_of(document)
    if wanted is not None:
        by_task = {task: trials for task, trials in by_task.items() if task in wanted}
    shared = sorted(task for task in by_task if task in trials_of(baseline))
    arm = sum(1 for task in shared if by_task[task].get(0, 0.0) >= 1.0)
    base_trials = trials_of(baseline)
    bank = sum(1 for task in shared if base_trials[task].get(0, 0.0) >= 1.0)
    delta = arm - bank
    return {
        "tasks": len(shared),
        "armPassed": arm,
        "baselinePassed": bank,
        "delta": delta,
        "tolerance": tolerance,
        "matched": len(shared) > 0 and abs(delta) <= tolerance,
    }


def verdict_of(arm: dict, baseline: dict) -> tuple[str, str, float | None]:
    """`(state, sentence, p)` for one arm against one baseline.

    The order is the argument: no measurement, then a rescue that clears the registered scale *and* the exact
    test, then a null that the interval makes conclusive, then everything else. `NO_LIFT` is only awarded when
    the arm's own upper limit sits below the registered scale — otherwise the run would be calling an
    underpowered reading a refutation, which is the mistake R210's P3 paid for once.
    """
    if arm["fail"] < 2 or baseline["fail"] < 2:
        return (
            "NO_MEASUREMENT",
            f"{arm['fail']} opportunity(ies) against a baseline of {baseline['fail']}; "
            "two attempts after a failure is not a rate",
            None,
        )
    rate, base = arm["rate"], baseline["rate"]
    delta = (rate - base) * 100
    p = fisher_two_sided(
        arm["rescue"], arm["fail"] - arm["rescue"], baseline["rescue"], baseline["fail"] - baseline["rescue"]
    )
    if delta >= REGISTERED_PP and p is not None and p < ALPHA:
        return (
            "RESCUED",
            f"+{delta:.1f} pp over the same transition unwritten, exact p = {p:.4f}",
            p,
        )
    limit = upper_bound(arm["rescue"], arm["fail"])
    if limit is not None and limit * 100 < base * 100 + REGISTERED_PP:
        return (
            "NO_LIFT",
            f"the arm's upper limit is {limit * 100:.1f}%, below the registered "
            f"{(base * 100 + REGISTERED_PP):.1f}% — a lift of {REGISTERED_PP:.0f} pp is excluded at n = {arm['fail']}",
            p,
        )
    return (
        "INCONCLUSIVE",
        f"{delta:+.1f} pp does not clear the registered {REGISTERED_PP:.0f} pp and the interval does not exclude it",
        p,
    )


def render(arm: dict, baseline: dict | None, drift: dict | None, state: str, sentence: str, p) -> str:
    def rate(block):
        return "absent" if block["rate"] is None else f"{block['rate'] * 100:.1f}%"

    lines = [
        "| reading | value |",
        "|---|---|",
        f"| transition | {arm['transition']} |",
        f"| opportunities | {arm['fail']} |",
        f"| rescued | {arm['rescue']} ({rate(arm)}) |",
    ]
    if baseline is not None:
        lines.append(f"| baseline, same transition, no note | {baseline['rescue']}/{baseline['fail']} ({rate(baseline)}) |")
        if arm["rate"] is not None and baseline["rate"] is not None:
            lines.append(f"| delta | {(arm['rate'] - baseline['rate']) * 100:+.1f} pp |")
        if p is not None:
            lines.append(f"| exact p | {p:.4f} |")
    if drift is not None:
        lines.append(
            f"| drift check: attempt 0 | {drift['armPassed']}/{drift['tasks']} vs bank "
            f"{drift['baselinePassed']}/{drift['tasks']} (tolerance {drift['tolerance']}) |"
        )
    lines.append(f"| verdict | **{state}** — {sentence} |")
    return "\n".join(lines)


def documents_of(directory: Path) -> list[dict]:
    """Every `*.json` under a results directory, read as a τ² document.

    A treatment-only grid is fifty files — one phase per task, because the sidecar's identity is the task — and a
    reader that took one file would report a rate over one task while its name said otherwise.
    """
    documents = []
    for path in sorted(directory.glob("*.json")):
        try:
            document = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(document, dict) and isinstance(document.get("simulations"), list):
            documents.append(document)
    return documents


def merge(documents: list[dict]) -> dict:
    """One document from many, with the trial numbers kept as the phases declared them."""
    simulations = [simulation for document in documents for simulation in document["simulations"]]
    return {"simulations": simulations, "phases": len(documents)}


def failing_tasks_of(document) -> list[str]:
    """Every task the document failed at least one attempt of, in a stable order.

    The population an arm and its baseline can be compared on: a task the baseline never failed is a task whose
    transition the treatment cannot observe either, and including it in the denominator would compute a rate over
    attempts that were never opportunities.
    """
    by_task = trials_of(document)
    return sorted((task for task, trials in by_task.items() if any(reward < 1.0 for reward in trials.values())),
                  key=lambda task: (len(task), task))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="the rate a note has to beat")
    parser.add_argument("--dir", default="")
    parser.add_argument("--bank", default="")
    parser.add_argument("--baseline", default="")
    parser.add_argument("--baseline-dir", default="")
    parser.add_argument("--pooled", action="store_true")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--first", type=int, default=0)
    parser.add_argument("--second", type=int, default=1)
    parser.add_argument("--json", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if not arguments.dir and not arguments.bank:
        parser.error("--dir, --bank or --self-test")

    if arguments.dir:
        directory = Path(arguments.dir)
        if not directory.is_dir():
            print(f"no directory at {directory}", file=sys.stderr)
            return 4
        documents = documents_of(directory)
        if not documents:
            print(f"no document under {directory}", file=sys.stderr)
            return 4
        arm_document = merge(documents)
    else:
        path = Path(arguments.bank)
        if not path.is_file():
            print(f"no bank at {path}", file=sys.stderr)
            return 4
        arm_document = json.loads(path.read_text())

    tasks = [entry for entry in arguments.tasks.split(",") if entry] or None
    transition = (arguments.first, arguments.second)
    baseline = None
    drift = None
    base_document = None
    if arguments.baseline and arguments.baseline_dir:
        print("--baseline and --baseline-dir name the same side twice", file=sys.stderr)
        return 4
    if arguments.baseline or arguments.baseline_dir:
        if arguments.baseline_dir:
            # Both sides from one run. The comparison this enables is the only one that controls the world: one
            # seed is shared by every task of an attempt, so two arms run at different seeds are two draws of a
            # process whose per-attempt rate moves by more than a binomial standard error (R211 measured 38/50
            # against the bank's 27/50 on the same fifty tasks).
            base_directory = Path(arguments.baseline_dir)
            if not base_directory.is_dir():
                print(f"no directory at {base_directory}", file=sys.stderr)
                return 4
            base_documents = documents_of(base_directory)
            if not base_documents:
                print(f"no document under {base_directory}", file=sys.stderr)
                return 4
            base_document = merge(base_documents)
            if tasks is None:
                tasks = failing_tasks_of(base_document)
            arm = rescue_of(arm_document, transition, tasks, arguments.pooled)
            baseline = rescue_of(base_document, transition, tasks, arguments.pooled)
            drift = drift_of(arm_document, base_document, tasks)
            state, sentence, p = verdict_of(arm, baseline) if drift["matched"] else (
                "DRIFT",
                f"the arm's first attempt passed {drift['armPassed']}/{drift['tasks']} against the baseline's "
                f"{drift['baselinePassed']}; the two arms did not run the same world",
                None,
            )
            print(render(arm, baseline, drift, state, sentence, p))
            if arguments.json:
                Path(arguments.json).write_text(
                    json.dumps({"arm": arm, "baseline": baseline, "drift": drift, "state": state, "p": p}, indent=1)
                    + "\n"
                )
            return {"RESCUED": 0, "NO_LIFT": 0, "UNPAIRED": 0, "INCONCLUSIVE": 0}.get(
                state, 2 if state == "NO_MEASUREMENT" else 3
            )
        base_path = Path(arguments.baseline)
        if not base_path.is_file():
            print(f"no baseline at {base_path}", file=sys.stderr)
            return 4
        base_document = json.loads(base_path.read_text())
        if tasks is None:
            # The population defaults to the tasks the baseline has a failure on. Naming it on the command line
            # instead would put the same fifty ids in two places, and the day they disagree the reading is a
            # comparison of two populations wearing one label.
            tasks = failing_tasks_of(base_document)
        baseline = rescue_of(base_document, transition, tasks, arguments.pooled)
        drift = drift_of(arm_document, base_document, tasks)
    arm = rescue_of(arm_document, transition, tasks, arguments.pooled)

    if drift is not None and not drift["matched"]:
        state, sentence, p = (
            "DRIFT",
            f"the arm's first attempt passed {drift['armPassed']}/{drift['tasks']} against the bank's "
            f"{drift['baselinePassed']}; the baseline does not describe this run",
            None,
        )
    else:
        state, sentence, p = verdict_of(arm, baseline) if baseline is not None else ("UNPAIRED", "no baseline named", None)

    print(render(arm, baseline, drift, state, sentence, p))
    if arguments.json:
        Path(arguments.json).write_text(
            json.dumps({"arm": arm, "baseline": baseline, "drift": drift, "state": state, "p": p}, indent=1) + "\n"
        )
    return {"RESCUED": 0, "NO_LIFT": 0, "UNPAIRED": 0, "INCONCLUSIVE": 0}.get(state, 2 if state == "NO_MEASUREMENT" else 3)


def _document(rewards: dict[str, list]) -> dict:
    """A τ² document whose simulations declare their trial, which is what the ordering rule reads."""
    simulations = []
    for task, values in rewards.items():
        for trial, reward in enumerate(values):
            simulations.append({"task_id": task, "trial": trial, "reward_info": {"reward": reward}})
    return {"simulations": simulations}


def _record(results: list[dict], name: str, condition: bool, detail: str = "") -> None:
    """One case, recorded rather than reported: a harness that prints as it goes cannot be tested itself."""
    results.append({"name": name, "ok": bool(condition), "detail": detail})


def tally(results: list[dict]) -> int:
    """The harness's only branch, so the exit code and the list of failures have one implementation."""
    failed = [f"{case['name']}{': ' + case['detail'] if case['detail'] else ''}" for case in results if not case["ok"]]
    if failed:
        print(f"{len(failed)} of {len(results)} case(s) failed: {'; '.join(failed)}", file=sys.stderr)
        return 1
    print(f"{len(results)} case(s) pass")
    return 0


def self_test() -> int:
    results: list[dict] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        _record(results, name, condition, detail)

    # The transition, and the denominator that decides whether it is one.
    arm = _document({"1": [0.0, 1.0], "2": [0.0, 0.0], "3": [1.0, 1.0]})
    reading = rescue_of(arm)
    check("only a failed first attempt is an opportunity", reading["fail"] == 2, str(reading))
    check("and one of the two was rescued", reading["rescue"] == 1, str(reading))
    check("the rate is over opportunities", abs(reading["rate"] - 0.5) < 1e-9, str(reading["rate"]))
    check("the transition is named", reading["transition"] == "0->1", reading["transition"])

    # Order by the declared trial, not by arrival: a document written rounds-first would otherwise measure 1->0.
    shuffled = {"simulations": [
        {"task_id": "1", "trial": 1, "reward_info": {"reward": 1.0}},
        {"task_id": "1", "trial": 0, "reward_info": {"reward": 0.0}},
    ]}
    check("the declared trial orders the pair", rescue_of(shuffled)["rescue"] == 1, str(rescue_of(shuffled)))

    # An unscored attempt is not a failure and not an opportunity: the same rule `notes.reward_of` applies.
    unscored = {"simulations": [
        {"task_id": "1", "trial": 0, "reward_info": {"reward": None}},
        {"task_id": "1", "trial": 1, "reward_info": {"reward": 1.0}},
    ]}
    check("an unscored attempt is not an opportunity", rescue_of(unscored)["fail"] == 0, str(rescue_of(unscored)))

    # A task whose second attempt is missing has no opportunity either — the rate is over pairs.
    lonely = _document({"1": [0.0]})
    check("a task with no successor is not an opportunity", rescue_of(lonely)["fail"] == 0, str(rescue_of(lonely)))
    check("and its rate is absent rather than zero", rescue_of(lonely)["rate"] is None, str(rescue_of(lonely)))
    check("an undeclared trial falls back to arrival order", rescue_of({"simulations": [
        {"task_id": "1", "reward_info": {"reward": 0.0}},
        {"task_id": "1", "reward_info": {"reward": 1.0}},
    ]})["rescue"] == 1)
    check("a document of nothing is a rate of nothing", rescue_of({})["fail"] == 0)
    check("a simulation that is not a dict is skipped", rescue_of({"simulations": [None, "x"]})["tasks"] == 0)
    check("a task with no id is skipped", rescue_of({"simulations": [{"trial": 0}]})["tasks"] == 0)
    check("a task list narrows the population", rescue_of(arm, tasks=["2"])["fail"] == 1,
          str(rescue_of(arm, tasks=["2"])))

    # Pooling: a four-round arm has three transitions per task, and they are the same event.
    four = _document({"1": [0.0, 1.0, 0.0, 1.0], "2": [0.0, 0.0, 0.0, 0.0]})
    pooled = rescue_of(four, pooled=True)
    check("pooling counts every consecutive pair", pooled["fail"] == 5, str(pooled))
    check("and sums their rescues", pooled["rescue"] == 2, str(pooled))
    check("the pooled reading says so", pooled["transition"] == "pooled", str(pooled))
    check("one transition is still available", rescue_of(four)["fail"] == 2, str(rescue_of(four)))
    check("a pooled rate is over pairs, not tasks", abs(pooled["rate"] - 0.4) < 1e-9, str(pooled["rate"]))

    # The baseline's own scale, from the bank's numbers: 15 of 23 is 65.2%, and that is the number to beat.
    baseline = {"fail": 23, "rescue": 15, "rate": 15 / 23, "transition": "0->1", "tasks": 50}

    state, _, p = verdict_of({"fail": 23, "rescue": 23, "rate": 1.0, "transition": "0->1", "tasks": 50}, baseline)
    check("a note that rescues everything clears the scale", state == "RESCUED", state)
    check("and the exact test agrees", p is not None and p < ALPHA, str(p))

    state, _, _ = verdict_of({"fail": 23, "rescue": 15, "rate": 15 / 23, "transition": "0->1", "tasks": 50}, baseline)
    check("a note that adds nothing is a null an interval can carry", state == "NO_LIFT", state)

    state, _, _ = verdict_of({"fail": 4, "rescue": 3, "rate": 0.75, "transition": "0->1", "tasks": 4}, baseline)
    check("four opportunities cannot exclude anything", state == "INCONCLUSIVE", state)

    state, _, _ = verdict_of({"fail": 1, "rescue": 1, "rate": 1.0, "transition": "0->1", "tasks": 1}, baseline)
    check("one opportunity is no measurement", state == "NO_MEASUREMENT", state)
    state, _, _ = verdict_of({"fail": 23, "rescue": 15, "rate": 0.65, "transition": "0->1", "tasks": 50},
                             {"fail": 1, "rescue": 0, "rate": 0.0, "transition": "0->1", "tasks": 1})
    check("and so is a baseline of one", state == "NO_MEASUREMENT", state)

    # The limits, at the sizes this lane actually runs.
    check("an upper limit for every success is below one", abs((upper_bound(23, 23) or 0) - 0.025 ** (1 / 23)) < 1e-9)
    check("the limits are monotone in the count", (upper_bound(15, 23) or 0) < (upper_bound(18, 23) or 0))
    check("an impossible pair has no limit", upper_bound(5, 3) is None)
    check("a denominator of nothing has no limit", upper_bound(0, 0) is None)

    # Fisher's exact, on the two tables that matter and the degenerate ones a caller will eventually pass.
    check("the same table twice is not significant", abs((fisher_two_sided(15, 8, 15, 8) or 0) - 1.0) < 1e-9)
    check("a complete separation is significant", (fisher_two_sided(23, 0, 15, 8) or 1.0) < 0.01)
    check("an empty table has no p", fisher_two_sided(0, 0, 0, 0) is None)
    check("a negative count has no p", fisher_two_sided(-1, 0, 0, 0) is None)
    check("a table with one non-empty row is not significant", fisher_two_sided(3, 0, 0, 0) == 1.0)

    # Drift: the free control inside the treatment arm.
    treatment = _document({"1": [1.0, 1.0], "2": [0.0, 1.0], "3": [1.0, 0.0]})
    bank = _document({"1": [1.0, 1.0], "2": [1.0, 1.0], "3": [1.0, 1.0]})
    drift = drift_of(treatment, bank)
    check("drift compares the first attempts", (drift["armPassed"], drift["baselinePassed"]) == (2, 3), str(drift))
    check("two against three is inside the tolerance", drift["matched"] is True, str(drift))
    check("and a shared task list is required", drift_of(treatment, _document({"9": [1.0, 1.0]}))["matched"] is False)
    check("drift can be narrowed to a task list", drift_of(treatment, bank, ["1"])["tasks"] == 1)

    # The table, and the states that are not a rescue.
    table = render({"fail": 23, "rescue": 23, "rate": 1.0, "transition": "0->1", "tasks": 50}, baseline,
                   {"tasks": 50, "armPassed": 27, "baselinePassed": 27, "delta": 0, "tolerance": 4, "matched": True},
                   "RESCUED", "x", 0.001)
    check("the table names the baseline", "no note" in table, table)
    check("and the drift check", "drift check" in table, table)
    empty = render({"fail": 0, "rescue": 0, "rate": None, "transition": "0->1", "tasks": 0}, None, None,
                   "NO_MEASUREMENT", "x", None)
    check("an absent rate prints as absent", "absent" in empty, empty)

    # The document reader and the merge: fifty phases are one grid.
    check("a directory of documents is one grid", merge([_document({"1": [0.0, 1.0]}),
                                                         _document({"2": [1.0, 1.0]})])["phases"] == 2)
    check("and the merge keeps every simulation",
          len(merge([_document({"1": [0.0, 1.0]}), _document({"2": [1.0]})])["simulations"]) == 3)

    # The CLI's own branches, because a tool whose argument handling is untested is a tool that fails on the
    # dispatch that needed it.
    import contextlib
    import io
    import tempfile

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        quiet = io.StringIO()
        with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            check("no input is a usage error", _raises(lambda: main([])))
            check("a missing directory is unreadable", main(["--dir", str(root / "nope")]) == 4)
            check("an empty directory is unreadable", main(["--dir", str(root)]) == 4)
            (root / "a.json").write_text(json.dumps(_document({"1": [0.0, 1.0], "2": [0.0, 1.0]})))
            (root / "b.json").write_text("not json")
            (root / "c.json").write_text(json.dumps({"simulations": "x"}))
            base = root / "baseline.json"
            base.write_text(json.dumps(_document({"1": [1.0, 1.0], "2": [1.0, 1.0]})))
            out = root / "reading.json"
            code = main(["--dir", str(root), "--baseline", str(base), "--json", str(out)])
            check("a reading over a directory succeeds", code in (0, 2), str(code))
            check("and writes its json", out.is_file())
            check("a missing baseline is unreadable",
                  main(["--dir", str(root), "--baseline", str(root / "nope.json")]) == 4)
            check("a named population narrows both sides",
                  main(["--dir", str(root), "--baseline", str(base), "--tasks", "1,2"]) in (0, 2))
            check("a bank path that is not a file is unreadable", main(["--bank", str(root / "nope.json")]) == 4)
            one = root / "one.json"
            one.write_text(json.dumps(_document({"1": [0.0, 1.0], "2": [0.0, 0.0]})))
            check("an unpaired reading is made and named",
                  main(["--bank", str(one), "--tasks", "1,2", "--first", "0", "--second", "1"]) == 0)
            drifted = root / "drifted.json"
            drifted.write_text(json.dumps(_document({str(i): [0.0, 1.0] for i in range(20)})))
            wide = root / "wide.json"
            wide.write_text(json.dumps(_document({str(i): [1.0, 1.0] for i in range(20)})))
            check("drift refuses the comparison", main(["--bank", str(drifted), "--baseline", str(wide)]) == 3)
            # Both sides from one run: the only comparison that controls the world, since one seed is shared by
            # every task of an attempt.
            arm_dir = root / "arm"
            base_dir = root / "base"
            arm_dir.mkdir()
            base_dir.mkdir()
            (arm_dir / "a.json").write_text(json.dumps(_document({"1": [0.0, 1.0], "2": [0.0, 0.0]})))
            (base_dir / "a.json").write_text(json.dumps(_document({"1": [0.0, 0.0], "2": [0.0, 0.0]})))
            both = root / "both.json"
            check("two directories are one comparison",
                  main(["--dir", str(arm_dir), "--baseline-dir", str(base_dir), "--json", str(both)]) == 0)
            check("and the reading is written", both.is_file())
            check("two names for one side is refused",
                  main(["--dir", str(arm_dir), "--baseline", str(wide), "--baseline-dir", str(base_dir)]) == 4)
            check("a missing baseline directory is unreadable",
                  main(["--dir", str(arm_dir), "--baseline-dir", str(root / "nope")]) == 4)
            empty_dir = root / "empty"
            empty_dir.mkdir()
            check("an empty baseline directory is unreadable",
                  main(["--dir", str(arm_dir), "--baseline-dir", str(empty_dir)]) == 4)
            check("a pooled reading is available from the command line",
                  main(["--dir", str(arm_dir), "--baseline-dir", str(base_dir), "--pooled"]) == 0)

    # The harness's own failure path: a case that records `False` must reach the exit code, or a suite that lost a
    # case would report success with a smaller denominator. Tallying the deliberately broken list is the only way
    # to reach that branch, so it runs quietly rather than writing a FAIL line into a green dispatch's log.
    import contextlib as _contextlib
    import io as _io

    check("the harness records a passing case", True)
    quiet_tally = _io.StringIO()
    with _contextlib.redirect_stderr(quiet_tally):
        broken = tally([{"name": "deliberate", "ok": False, "detail": ""}])
    check("a failing case fails the suite", broken == 1, str(broken))
    check("and says why on stderr", "deliberate" in quiet_tally.getvalue(), quiet_tally.getvalue())
    empty = _io.StringIO()
    with _contextlib.redirect_stdout(empty):
        accepted = tally([{"name": "fine", "ok": True, "detail": ""}])
    check("a passing list passes the suite", accepted == 0 and "1 case(s) pass" in empty.getvalue())
    check("a call that does not raise is not an exit", _raises(lambda: None) is False)
    return tally(results)


def _raises(call) -> bool:
    try:
        call()
    except SystemExit:
        return True
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
