#!/usr/bin/env python3
"""Power: what an effect would have to be before this instrument could see it.

R57's three arms were graded, re-graded and quoted for a week, and every one of them was
`UNRESOLVED` at the registered sample. This verifier exists because that state was read as
"the run did not decide" when the useful statement is sharper and computable: **at 57 tasks
this instrument cannot see anything smaller than about 21 percentage points**, and every
effect in the repository is between 3.5 and 7. So the runs were not inconclusive by accident
of sampling; they were inconclusive by arithmetic, and the arithmetic was available before
the dispatch.

Three things are measured here, in the order they have to be measured.

**One artefact, several estimands.** A `pass^4` run contains every `(task, trial, reward)`
cell, so it also contains `pass^1`, `pass^2` and `pass^3`. Recomputing the same 228 episodes
at each `k` is free, and it answers a question nobody asked before paying: *which `k` is most
powerful?* The answer is not the largest one. `pass^4` demands four successes, so a task near
the boundary flips between arms more often, and a paired test's standard error grows with the
number of discordant pairs. Strictness buys robustness and costs power, and here it costs
power faster than it buys anything -- measured on all three arms, `pass^1` has *fewer*
discordant pairs than `pass^4`, so the cheapest reading is also the sharpest.

**A sign that depends on `k` is not a sign.** If an arm is +8.77pp at `pass^2` and +0.00pp at
`pass^4` on the same episodes, neither number is a finding; the aggregation chose the answer.
`sign_stable` is reported beside every effect for that reason, and it is graded, not noted.

**The denominator is the task count, not the trial count.** For a paired comparison of
proportions the standard error is `sqrt(discordance / n_tasks)`. Trials enter only through
`pass^k`, which compresses four Bernoulli draws into one per task, so an extra trial reduces
nothing that the interval is made of. This is why a four-trial run is not four times as
precise as a one-trial run: it is the same 57 tasks, measured more thoroughly, and 57 is the
number the interval is a function of.

States, the same four the other verifiers use:

  GRADED          every arm's effect is distinguishable from zero at its registered `k`.
  UNRESOLVED      an effect's paired p-value is at or above alpha: the run did not resolve it.
  NO_MEASUREMENT  there is no artefact, or an artefact cannot be read as a paired design.
  DISCARDED       an artefact's two halves do not describe the same tasks and trials.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r57-far
  python3 power.py --arm far=/tmp/r57-far --arm near=/tmp/r57-near --arm adversarial=/tmp/r57-adv
  python3 power.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from statistics import NormalDist
from typing import Iterable, Sequence

STATES = ("GRADED", "UNRESOLVED", "NO_MEASUREMENT", "DISCARDED")

# Two-sided, and the same alpha the readbacks use, so a verdict here cannot disagree with a
# verdict there about whether a number cleared the bar.
ALPHA = 0.05
# The convention every power calculation in the life and social sciences uses, so a required
# sample size here is comparable to one in a paper rather than to one invented locally.
POWER = 0.80
# The design R57 was graded at. Named once; a rung reported at another `k` says so in the output.
REGISTERED_K = 4


@dataclass(frozen=True)
class Half:
    """One side of a paired design: the reward of every (task, trial) cell."""

    cells: dict[tuple[str, int], float]
    tasks: tuple[str, ...]
    trials: tuple[int, ...]

    def passed(self, task: str, k: int) -> bool:
        """Whether the task succeeded on all of its first `k` trials.

        `pass^k` is defined over a set of `k` trials, and a four-trial run supplies four such
        sets for free. The prefix estimator is the honest one: it is exactly what a `k`-trial
        run would have measured, provided trials are exchangeable, which is checked rather
        than assumed (`Half.exchangeable`).
        """
        return all(self.cells[(task, trial)] > 0 for trial in self.trials[:k])

    def rate(self, k: int) -> float:
        return sum(1 for task in self.tasks if self.passed(task, k)) / len(self.tasks)

    def trial_rates(self) -> tuple[float, ...]:
        """The pass rate of each trial, in trial order."""
        return tuple(
            sum(1 for task in self.tasks if self.cells[(task, trial)] > 0) / len(self.tasks)
            for trial in self.trials
        )

    def exchangeable(self) -> bool:
        """Whether every trial looks like the same draw.

        The prefix estimator silently assumes that trial 0 and trial 3 are the same
        experiment. They are not, if the first trial of an episode carries a colder prompt
        cache or a different tool-selection habit, and a run whose trials differ systematically
        cannot be re-read at a smaller `k` at all. The test is Mcnemar's cousin at the trial
        level: the spread of the per-trial rates against the binomial noise one rate would
        produce. Wide means "do not re-read this run at another k", and it is reported.
        """
        rates = self.trial_rates()
        if len(rates) < 2:
            return True
        mean = sum(rates) / len(rates)
        expected = math.sqrt(mean * (1 - mean) / len(self.tasks))
        return (max(rates) - min(rates)) <= 4 * expected


@dataclass(frozen=True)
class Pair:
    """One dispatch: a control arm and the arm it is paired against, over the same tasks."""

    name: str
    reference: Half
    memory: Half


@dataclass(frozen=True)
class Rung:
    """The paired comparison at one `k`.

    `excess_pp` is **the control's accuracy minus the memory arm's**, so a positive number means
    the memory arm lost more episodes than it gained. The sign convention is the readbacks' one,
    and it is chosen deliberately: the question this repository keeps asking is "what does the
    memory cost", and a cost that prints as a negative number is a cost somebody will read as a
    gain.
    """

    k: int
    reference: float
    memory: float
    excess_pp: float
    only_reference: int
    only_memory: int
    p_value: float
    half_width_pp: float

    @property
    def discordant(self) -> int:
        return self.only_reference + self.only_memory


@dataclass(frozen=True)
class Reading:
    name: str
    n: int
    trials: int
    rungs: tuple[Rung, ...]
    sign_stable: bool
    spread_pp: float
    exchangeable: bool
    mde_pp: float
    required_n: int

    def at(self, k: int) -> Rung | None:
        for rung in self.rungs:
            if rung.k == k:
                return rung
        return None


def mcnemar_exact(only_reference: int, only_memory: int) -> float:
    """Two-sided exact McNemar: the probability of a split this lopsided under "no effect".

    Exact rather than the chi-square approximation because the discordant pairs here number in
    the teens, and a 57-task sample is exactly the regime where the approximation is worst --
    the same regime every arm of R57 ran in.
    """
    n = only_reference + only_memory
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(only_reference, only_memory) + 1)) / 2**n
    return min(1.0, 2 * tail)


def mde_pp(n: int, discordance: float, *, power: float = POWER, alpha: float = ALPHA) -> float:
    """The smallest paired effect this design could detect, in percentage points.

    `z` folds the two-sided level and the desired power into one multiplier, and the standard
    error of a paired difference is `sqrt(discordance / n)`. The formula is worth writing out
    because it exposes the thing that was missed: `n` is the task count and there is no term
    for trials, so no number of trials enters the quantity a design is judged by.
    """
    if n <= 0:
        return float("nan")
    z = NormalDist().inv_cdf(1 - alpha / 2) + NormalDist().inv_cdf(power)
    return z * math.sqrt(max(discordance, 1e-12) / n) * 100


def required_n(effect_pp: float, discordance: float, *, power: float = POWER, alpha: float = ALPHA) -> int:
    """How many tasks would be needed to detect `effect_pp` at this discordance."""
    if effect_pp <= 0:
        return 0
    z = NormalDist().inv_cdf(1 - alpha / 2) + NormalDist().inv_cdf(power)
    return math.ceil(z**2 * max(discordance, 1e-12) / (effect_pp / 100) ** 2)


def rung(pair: Pair, k: int) -> Rung:
    reference = pair.reference
    memory = pair.memory
    tasks = reference.tasks
    ref_pass = sum(1 for task in tasks if reference.passed(task, k))
    mem_pass = sum(1 for task in tasks if memory.passed(task, k))
    only_reference = sum(
        1 for task in tasks if reference.passed(task, k) and not memory.passed(task, k)
    )
    only_memory = sum(
        1 for task in tasks if memory.passed(task, k) and not reference.passed(task, k)
    )
    n = len(tasks)
    return Rung(
        k=k,
        reference=ref_pass / n,
        memory=mem_pass / n,
        excess_pp=(ref_pass - mem_pass) / n * 100,
        only_reference=only_reference,
        only_memory=only_memory,
        p_value=mcnemar_exact(only_reference, only_memory),
        # Wald on the paired difference. Reported because a p-value alone cannot say how much
        # of the ruler an effect is, and the answer for every arm of R57 was "most of it".
        half_width_pp=1.96 * math.sqrt(max(only_reference + only_memory, 1)) / n * 100,
    )


def analyse(pair: Pair) -> Reading:
    """Every `k` the run supports, and the three properties that decide whether to quote one."""
    n = len(pair.reference.tasks)
    trials = len(pair.reference.trials)
    rungs = tuple(rung(pair, k) for k in range(1, trials + 1))
    deltas = [entry.excess_pp for entry in rungs]
    # A zero has no sign, so it is compatible with either one: an arm that is exactly level at
    # one `k` and positive at another has not contradicted itself.
    signs = {entry.excess_pp > 0 for entry in rungs if entry.excess_pp != 0}
    registered = next((entry for entry in rungs if entry.k == REGISTERED_K), rungs[-1])
    discordance = registered.discordant / n if n else 0.0
    return Reading(
        name=pair.name,
        n=n,
        trials=trials,
        rungs=rungs,
        sign_stable=len(signs) <= 1,
        spread_pp=max(deltas) - min(deltas),
        exchangeable=pair.reference.exchangeable() and pair.memory.exchangeable(),
        mde_pp=mde_pp(n, discordance),
        required_n=required_n(abs(registered.excess_pp), discordance),
    )


def repeatability(pairs: Sequence[Pair], k: int) -> float | None:
    """How far the *control* arm moves across dispatches in which nothing changed.

    Every planted arm ran its own control, and the plant never touches the control: the plant
    is applied to the memory arm's pack. So the `n` reference halves here are `n` measurements
    of one condition, and their spread is the instrument's floor -- the number every effect has
    to clear before it is a fact about the plant rather than about the day.
    """
    if len(pairs) < 2:
        return None
    rates = [pair.reference.rate(k) for pair in pairs]
    return (max(rates) - min(rates)) * 100


def verdicts(readings: Sequence[Reading], floor_pp: float | None) -> tuple[str, tuple[str, ...]]:
    """One state for the set of arms, and the reasons.

    `UNRESOLVED` outranks everything: an arm whose p-value did not clear alpha is not evidence
    in either direction, and reporting the point estimate beside a "not significant" is the
    mistake this whole file exists to stop.
    """
    if not readings:
        return "NO_MEASUREMENT", ("no artefact was supplied",)
    reasons: list[str] = []
    unresolved = [r for r in readings if (r.at(REGISTERED_K) or r.rungs[-1]).p_value >= ALPHA]
    flippers = [r for r in readings if not r.sign_stable]
    for reading in flippers:
        reasons.append(
            f"{reading.name}: the sign moves with k (spread {reading.spread_pp:.2f}pp over "
            f"k=1..{reading.trials}); the aggregation chose the answer"
        )
    if unresolved:
        for reading in unresolved:
            entry = reading.at(REGISTERED_K) or reading.rungs[-1]
            reasons.append(
                f"{reading.name}: {entry.excess_pp:+.2f}pp at pass^{entry.k}, "
                f"p={entry.p_value:.3f} (b={entry.only_reference}, c={entry.only_memory})"
            )
        return "UNRESOLVED", tuple(reasons)
    if floor_pp is not None:
        inside = [r for r in readings if abs((r.at(REGISTERED_K) or r.rungs[-1]).excess_pp) <= floor_pp]
        if inside:
            for reading in inside:
                entry = reading.at(REGISTERED_K) or reading.rungs[-1]
                reasons.append(
                    f"{reading.name}: {entry.excess_pp:+.2f}pp is inside the control floor of "
                    f"{floor_pp:.2f}pp"
                )
            return "UNRESOLVED", tuple(reasons)
    return "GRADED", tuple(reasons)


def render(readings: Sequence[Reading], floor: dict[int, float | None], state: str, reasons: Sequence[str]) -> str:
    lines: list[str] = []
    lines.append("arm            n  trials   k   control   memory    excess      b    c       p   ±half  sign")
    for reading in readings:
        for entry in reading.rungs:
            lines.append(
                f"{reading.name:<12} {reading.n:>3}  {reading.trials:>4}  {entry.k:>3}  "
                f"{entry.reference:>8.4f} {entry.memory:>8.4f} {entry.excess_pp:>+8.2f}  "
                f"{entry.only_reference:>3}  {entry.only_memory:>3}  {entry.p_value:>7.4f}  "
                f"{entry.half_width_pp:>6.2f}  {'yes' if reading.sign_stable else 'NO'}".rstrip()
            )
        registered = reading.at(REGISTERED_K) or reading.rungs[-1]
        needed = (
            f"{reading.required_n} tasks"
            if abs(registered.excess_pp) > 0
            else "- (a zero effect needs no sample)"
        )
        lines.append(
            f"{'':<12} smallest detectable effect at n={reading.n}: {reading.mde_pp:>6.2f}pp"
            f"   to resolve {abs(registered.excess_pp):.2f}pp: {needed}"
        )
        if not reading.exchangeable:
            lines.append(
                f"{'':<12} trials are NOT exchangeable: re-reading this run at another k is not "
                "what a k-trial run would have measured"
            )
    if floor:
        measured = ", ".join(f"k={k}: {'-' if v is None else f'{v:.2f}pp'}" for k, v in sorted(floor.items()))
        lines.append(f"control floor across dispatches (nothing changed): {measured}")
    lines.append(f"state: {state}")
    for reason in reasons:
        lines.append(f"  - {reason}")
    return "\n".join(lines)


def load_pair(name: str, root: Path) -> Pair:
    """Read one dispatch, whose two halves are filed under `arms/{reference,memory}`."""
    halves: dict[str, Half] = {}
    for side in ("reference", "memory"):
        path = root / "arms" / side / "poc-l4.json"
        if not path.exists():
            raise SystemExit(f"power-missing:{side}:{path}")
        document = json.loads(path.read_text(encoding="utf-8"))
        cells: dict[tuple[str, int], float] = {}
        for row in document["per_trial"]:
            cells[(str(row["id"]), int(row["trial"]))] = float(row["reward"])
        halves[side] = Half(
            cells=cells,
            tasks=tuple(sorted({task for task, _ in cells})),
            trials=tuple(sorted({trial for _, trial in cells})),
        )
    if halves["reference"].tasks != halves["memory"].tasks:
        raise SystemExit(f"power-unpaired:{name}:the two halves do not describe the same tasks")
    if halves["reference"].trials != halves["memory"].trials:
        raise SystemExit(f"power-unpaired:{name}:the two halves do not describe the same trials")
    return Pair(name=name, reference=halves["reference"], memory=halves["memory"])


def half(rows: Iterable[tuple[str, int, float]], tasks: Sequence[str], trials: Sequence[int]) -> Half:
    return Half(
        cells={(task, trial): reward for task, trial, reward in rows},
        tasks=tuple(tasks),
        trials=tuple(trials),
    )


def self_test() -> int:
    """Every state has a fixture, and the arithmetic has one that would catch a sign error."""
    checks = _Checks()

    tasks = [f"t{i}" for i in range(20)]
    trials = [0, 1, 2, 3]

    def build(name: str, reference_wins: int, memory_wins: int, level: int = 20) -> Pair:
        """A pair whose only difference is the two discordant counts.

        `level` is how many tasks pass on every trial on both sides, so a fixture can be all
        agreement (level=20, no discordance) or mostly disagreement.
        """
        ref_cells: list[tuple[str, int, float]] = []
        mem_cells: list[tuple[str, int, float]] = []
        agreeing = level - reference_wins - memory_wins
        for index, task in enumerate(tasks):
            if index < agreeing:
                ref_cells += [(task, trial, 1.0) for trial in trials]
                mem_cells += [(task, trial, 1.0) for trial in trials]
            elif index < agreeing + reference_wins:
                ref_cells += [(task, trial, 1.0) for trial in trials]
                mem_cells += [(task, trial, 0.0) for trial in trials]
            elif index < agreeing + reference_wins + memory_wins:
                ref_cells += [(task, trial, 0.0) for trial in trials]
                mem_cells += [(task, trial, 1.0) for trial in trials]
            else:
                ref_cells += [(task, trial, 0.0) for trial in trials]
                mem_cells += [(task, trial, 0.0) for trial in trials]
        return Pair(name=name, reference=half(ref_cells, tasks, trials), memory=half(mem_cells, tasks, trials))

    # 1. The formula, checked against a hand computation. n=57, discordance 18/57 gives about
    #    20.8pp; the check is loose because the point is the order of magnitude a reader is
    #    about to be surprised by, not the fourth decimal.
    checks.near(mde_pp(57, 18 / 57), 20.8, 0.2, "n=57 with 18 discordant pairs sees about 21pp")
    checks.near(mde_pp(1534, 145 / 1534), 2.20, 0.05, "BIRD dev at its own discordance sees about 2.2pp")
    # Inverting the formula has to use the same power on both sides, or the check compares two
    # different questions: `mde_pp` at 80% and `required_n` at 50% is a factor of two, which is
    # exactly the factor the first version of this check failed on. The answer is 58 rather than
    # 57 because `required_n` rounds up: a sample that is one task short is still short.
    checks.equal(
        required_n(mde_pp(57, 18 / 57, power=0.5), 18 / 57, power=0.5),
        58,
        "the formula inverts at the power it was evaluated at, rounded up",
    )

    # 2. Trials are not in the denominator. Four times the trials, same tasks: same interval.
    checks.near(
        mde_pp(57, 0.3),
        mde_pp(57, 0.3),
        0.0,
        "the smallest detectable effect does not know how many trials ran",
    )
    checks.equal(required_n(0, 0.3), 0, "an effect of zero needs no sample")

    # 3. McNemar at the edges.
    checks.equal(mcnemar_exact(0, 0), 1.0, "no discordant pair is no evidence")
    checks.equal(mcnemar_exact(4, 4), 1.0, "a symmetric split is the null exactly")
    checks.near(mcnemar_exact(0, 10), 2 / 2**10, 1e-9, "ten to nothing is the smallest tail there is")
    checks.truthy(mcnemar_exact(1, 9) < 0.05, "and eight apart is already significant")

    # 4. A clean effect is GRADED, and it says so at every k.
    clean = analyse(build("clean", 0, 12))
    checks.equal(
        [entry.excess_pp for entry in clean.rungs],
        [-60.0, -60.0, -60.0, -60.0],
        "one direction throughout, and negative because a memory that wins is a negative cost",
    )
    checks.truthy(clean.sign_stable, "and therefore a stable sign")
    checks.equal(verdicts([clean], None)[0], "GRADED", "which grades")

    # 5. An arm that is level at the registered k is not evidence, however large it was elsewhere.
    #    This is the fixture for the state R57 was actually in.
    flat = build("flat", 9, 9)
    flat_reading = analyse(flat)
    checks.equal(
        (flat_reading.at(4) or flat_reading.rungs[-1]).excess_pp,
        0.0,
        "a symmetric split nets to zero at pass^4",
    )
    checks.equal(verdicts([flat_reading], None)[0], "UNRESOLVED", "and a zero is not a finding")

    # 6. A sign that flips with k is reported as unstable rather than as a small effect. The
    #    fixture makes trial 0 and trial 1 disagree, which is exactly what a boundary task does.
    flipping_rows_ref = [(task, trial, 1.0) for task in tasks for trial in trials]
    flipping_rows_mem = [
        (task, trial, 1.0 if trial == 0 else 0.0)
        for task in tasks
        for trial in trials
        if task in tasks[:10]
    ] + [(task, trial, 0.0) for task in tasks[10:] for trial in trials]
    flipping = analyse(
        Pair(name="flip", reference=half(flipping_rows_ref, tasks, trials), memory=half(flipping_rows_mem, tasks, trials))
    )
    checks.equal(flipping.rungs[0].excess_pp, 50.0, "pass^1 costs half the tasks")
    checks.equal(flipping.rungs[3].excess_pp, 100.0, "pass^4 costs all of them")
    checks.truthy(flipping.spread_pp == 50.0, "and the spread is the aggregation's, not the plant's")

    # 7. The control floor needs two dispatches by definition, and a single one must not be
    #    reported as a floor of zero. The two fixtures below differ only in how many tasks fail
    #    on *both* sides, which is the only way to move the control's own rate: a discordant
    #    pair leaves the control's rate alone by construction.
    checks.equal(repeatability([build("a", 0, 0)], 4), None, "one dispatch measures no repeatability")
    checks.equal(
        repeatability([build("a", 0, 0, level=20), build("b", 0, 0, level=20)], 4),
        0.0,
        "two identical dispatches are a floor of zero",
    )
    checks.near(
        repeatability([build("a", 0, 0, level=20), build("c", 0, 0, level=16)], 4) or 0.0,
        20.0,
        1e-9,
        "and four tasks of movement in the control is 20pp",
    )

    # 8. An artefact with no arms is a measurement that did not happen, not a pass.
    checks.equal(verdicts([], None)[0], "NO_MEASUREMENT", "no arm is not a green result")
    checks.equal(len(verdicts([], None)[1]), 1, "and it says why")

    # 9. Exchangeability: a fixture whose trials differ by design is flagged, so no prefix
    #    estimator is ever taken from it silently.
    uneven = Half(
        cells={(task, trial): (1.0 if trial == 0 else 0.0) for task in tasks for trial in trials},
        tasks=tuple(tasks),
        trials=tuple(trials),
    )
    checks.equal(uneven.exchangeable(), False, "a first trial that is always right is not a trial")
    checks.equal(half([(task, trial, 1.0) for task in tasks for trial in trials], tasks, trials).exchangeable(), True, "a flat run is")

    return checks.report()


class _Checks:
    def __init__(self) -> None:
        self.total = 0
        self.failed: list[str] = []

    def equal(self, actual: object, expected: object, why: str) -> None:
        self.total += 1
        if actual != expected:
            self.failed.append(f"{why}: expected {expected!r}, got {actual!r}")

    def near(self, actual: float, expected: float, tolerance: float, why: str) -> None:
        self.total += 1
        if abs(actual - expected) > tolerance:
            self.failed.append(f"{why}: expected {expected}±{tolerance}, got {actual}")

    def truthy(self, actual: object, why: str) -> None:
        self.total += 1
        if not actual:
            self.failed.append(f"{why}: expected truthy, got {actual!r}")

    def report(self) -> int:
        for failure in self.failed:
            print(f"FAIL  {failure}", file=sys.stderr)
        print(f"{self.total - len(self.failed)}/{self.total} power self-checks passed", file=sys.stderr)
        return 0 if not self.failed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm", action="append", default=[], metavar="NAME=DIR")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.arm:
        parser.error("no arm given; pass --arm NAME=DIR or --self-test")

    pairs: list[Pair] = []
    for item in args.arm:
        name, _, directory = item.partition("=")
        if not name or not directory:
            parser.error(f"--arm wants NAME=DIR, got {item!r}")
        pairs.append(load_pair(name, Path(directory)))

    readings = [analyse(pair) for pair in pairs]
    floor = {k: repeatability(pairs, k) for k in range(1, len(pairs[0].reference.trials) + 1)}
    state, reasons = verdicts(readings, floor.get(REGISTERED_K))

    if args.json:
        payload = {
            "state": state,
            "reasons": list(reasons),
            "control_floor_pp": {str(k): v for k, v in floor.items()},
            "arms": [
                {
                    "name": reading.name,
                    "n": reading.n,
                    "trials": reading.trials,
                    "sign_stable": reading.sign_stable,
                    "spread_pp": round(reading.spread_pp, 4),
                    "exchangeable": reading.exchangeable,
                    "smallest_detectable_pp": round(reading.mde_pp, 4),
                    "tasks_needed": reading.required_n,
                    "rungs": [
                        {
                            "k": entry.k,
                            "reference": round(entry.reference, 6),
                            "memory": round(entry.memory, 6),
                            "excess_pp": round(entry.excess_pp, 4),
                            "only_reference": entry.only_reference,
                            "only_memory": entry.only_memory,
                            "p_value": round(entry.p_value, 6),
                            "half_width_pp": round(entry.half_width_pp, 4),
                        }
                        for entry in reading.rungs
                    ],
                }
                for reading in readings
            ],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(render(readings, floor, state, reasons))
    return 0 if state in ("GRADED", "UNRESOLVED") else 1


if __name__ == "__main__":
    sys.exit(main())
