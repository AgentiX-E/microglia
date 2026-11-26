"""What a dispatch can buy, in points, before it is dispatched.

The lane has been spending against a question nobody had priced: *how large an effect can this grid
resolve?* R218c answered it once for one grid (13.2 points at 114 tasks, one attempt each) and the
number was quoted as a footnote. It is not a footnote — it is a **ceiling**. A grid's resolution is a
property of the *domain*, not of the budget: at N independent tasks the paired difference between two
arms has a sampling error set by how much two arms disagree from task to task, and repeating the same
task lowers only the measurement half of that error. Past a point the error is all task heterogeneity
and no amount of money moves it.

So this file answers three questions with one pass over a paired grid:

  * **observed** — the resolution the grid in hand actually has, at the attempts it ran;
  * **ladder** — the resolution at more attempts, and what each rung costs;
  * **wall** — the resolution at *unlimited* attempts. The floor.

The wall is the number that decides whether a round should be funded. If the effect a round exists to
detect sits below the wall, the round cannot succeed at any price, and the honest action is to cancel
it rather than to run it with more episodes. A project that only ever asks "can we afford this?" will
buy resolution it cannot use; the wall is the question that comes first.

Everything here is computed from documents already on disk, so the answer is free and can be obtained
before the money is spent. That ordering — price, then decide — is the whole point.

Two estimates, and the difference between them is the design:

  1. **Resolution at attempts m.** For each task, average the pass flags over the first m attempts in
     each arm and take the difference. Its standard deviation across tasks decomposes as
     `a/m + b`: the first term is measurement noise (two arms of m attempts disagree by chance), the
     second is real task-to-task heterogeneity, which no attempt count can average away.
  2. **The decomposition.** `a` and `b` are fit from two rungs of the ladder, not assumed. Assuming
     independence instead would overstate what more attempts buy whenever the arms are positively
     correlated — and they are, because both arms see the same task and the same seed world.

The fit is reported with its own check: if the observed variance does not fall with attempts, `a` is
clipped to zero and the reading says so, because a negative `a` is not a small measurement error, it is
evidence that the decomposition does not apply to this grid.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

# 80% power at a two-sided 5% test. The convention the lane already uses (dose_power.py), repeated here
# rather than imported so this file has no dependency on a module it does not otherwise need.
POWER_Z = 2.802

# Rungs, in attempts a task. The top rung is not a plan; it is the limit the fit extrapolates to, and it
# is present in every table so the floor is visible beside the prices rather than buried in a sentence.
LADDER = (1, 2, 4, 8, 14, 25, 50, 10**6)

# What an episode has cost in this lane, averaged over the dispatches on disk. Used only when a caller
# does not supply a price, so a plan can be printed in money rather than in episodes.
DEFAULT_EPISODE_USD = 0.0055


def series(path: str, attempts: int | None = None) -> dict:
    """Load one arm as task -> list of pass flags, in the document's own attempt order.

    Order is the document's, not a sort: attempts within a task are not interchangeable in general (a
    later attempt follows a longer history), and the ladder's whole claim is that attempt 1..m is a
    prefix of the attempt 1..M grid. Sorting would silently mix them.

    A task whose attempt count differs from the modal count is dropped, and the count of drops is
    reported: a task with three attempts cannot contribute to a four-attempt pair, and quietly padding
    it would make this file's numbers disagree with the reader that joins the same grid.
    """
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    grouped: dict = {}
    for simulation in document.get("simulations") or []:
        if not isinstance(simulation, dict):
            continue
        reward = simulation.get("reward_info")
        reward = reward.get("reward") if isinstance(reward, dict) else None
        # `reward` is a pass flag rather than a score: tau2 writes 1.0 for a resolved task. A bool is
        # not a number here even though Python says it is, and a string is not either.
        passed = 1 if isinstance(reward, (int, float)) and not isinstance(reward, bool) and reward >= 1.0 else 0
        grouped.setdefault(str(simulation.get("task_id")), []).append(passed)
    if not grouped:
        return {"state": "NO_EPISODES", "tasks": 0}
    counts = [len(flags) for flags in grouped.values()]
    modal = statistics.mode(counts)
    keep = modal if attempts is None else min(modal, attempts)
    kept = {task: flags[:keep] for task, flags in grouped.items() if len(flags) == modal}
    return {
        "state": "READ",
        "tasks": len(kept),
        "attempts": keep,
        "dropped": len(grouped) - len(kept),
        "byTask": kept,
    }


def paired(control: dict, treatment: dict) -> dict:
    """Join two arms on task, refusing when their attempt counts or task sets do not line up."""
    if control.get("state") != "READ" or treatment.get("state") != "READ":
        return {"state": "NO_EPISODES", "why": "one of the two documents holds no usable episode"}
    shared = sorted(set(control["byTask"]) & set(treatment["byTask"]))
    if not shared:
        return {"state": "NO_PAIRS", "why": "the two arms share no task"}
    attempts = min(control["attempts"], treatment["attempts"])
    if attempts < 1:
        return {"state": "NO_PAIRS", "why": "an arm has no attempt to pair"}
    return {
        "state": "READ",
        "tasks": shared,
        "attempts": attempts,
        "control": {task: control["byTask"][task] for task in shared},
        "treatment": {task: treatment["byTask"][task] for task in shared},
    }


def _differences(grid: dict, attempts: int) -> list[float]:
    """Per-task difference of the first `attempts` attempts, treatment minus control."""
    return [
        sum(grid["treatment"][task][:attempts]) / attempts - sum(grid["control"][task][:attempts]) / attempts
        for task in grid["tasks"]
    ]


def rung(grid: dict, attempts: int) -> dict:
    """One line of the ladder: what this many attempts a task would resolve."""
    differences = _differences(grid, attempts)
    count = len(differences)
    mean = sum(differences) / count
    # Sample standard deviation with n-1: these tasks are a sample of the domain, not the domain. With a
    # single task there is no spread to estimate, and the rung says so rather than returning zero.
    sd = math.sqrt(sum((value - mean) ** 2 for value in differences) / (count - 1)) if count > 1 else None
    return {
        "attempts": attempts,
        "tasks": count,
        "episodes": count * attempts * 2,
        "meanDiff": round(mean, 6),
        "sd": None if sd is None else round(sd, 6),
        "mde": None if sd is None else round(POWER_Z * sd / math.sqrt(count), 6),
    }


def decompose(rows: list[dict]) -> dict:
    """Fit `var(m) = a/m + b` from the ladder's two extremes, and clip a non-physical fit.

    Two points, two unknowns, and the reason it is only two: the ladder's rungs are nested prefixes of
    the same grid, so their errors are correlated and a least-squares fit over all of them would report
    an uncertainty that is not there. `a` is the measurement term and `b` the heterogeneity term.

    A negative `a` means the grid's spread did not fall as attempts rose. That is not a small measurement
    error, it is a signal that the decomposition does not describe this grid — two arms can drift apart
    faster than averaging pulls them together — and the physical floor is then the observed `var(1)`.
    The reading carries `clipped` so a table can print the fit's status beside its numbers.
    """
    usable = [row for row in rows if row["sd"] is not None]
    if len(usable) < 2:
        return {"state": "TOO_FEW_RUNGS", "rungs": len(usable)}
    low, high = usable[0], usable[-1]
    var_low, var_high = low["sd"] ** 2, high["sd"] ** 2
    clipped = var_high >= var_low
    if clipped:
        return {"state": "CLIPPED", "a": 0.0, "b": round(var_low, 8),
                "why": "the grid's spread did not fall with attempts, so the floor is its spread at one"}
    slope = (var_low - var_high) / (1.0 - 1.0 / high["attempts"])
    intercept = var_low - slope
    # A fit can also come out with a tiny negative intercept when the top rung is close to the floor;
    # a variance floor below zero is not a variance, so it is clipped and named as such.
    if intercept < 0:
        return {"state": "CLIPPED", "a": round(var_low, 8), "b": 0.0,
                "why": "the fitted floor is negative, so all of the spread is measurement and the floor is zero"}
    return {"state": "FIT", "a": round(slope, 8), "b": round(intercept, 8)}


def wall(fit: dict, tasks: int) -> float | None:
    """The smallest effect this domain can resolve at unlimited attempts."""
    if fit.get("state") not in ("FIT", "CLIPPED") or not tasks:
        return None
    return POWER_Z * math.sqrt(fit["b"]) / math.sqrt(tasks)


def plan(fit: dict, tasks: int, delta: float) -> dict:
    """Attempts a task needed to resolve `delta`, or the statement that no count will.

    Solving `delta = POWER_Z * sqrt(a/m + b) / sqrt(N)` for m. When the right-hand side's floor already
    exceeds `delta`, the denominator is not positive and there is no m — which is the answer the caller
    most needs and the one an "add more episodes" reflex never produces.
    """
    floor = wall(fit, tasks)
    if floor is None:
        return {"state": "NO_FIT"}
    if fit.get("state") == "CLIPPED" and fit["a"] == 0.0:
        return {"state": "UNREACHABLE", "wall": round(floor, 6), "why": "the floor is the spread itself"}
    target = (delta * math.sqrt(tasks) / POWER_Z) ** 2
    remaining = target - fit["b"]
    if remaining <= 0:
        return {"state": "UNREACHABLE", "wall": round(floor, 6),
                "why": f"the domain's floor is {floor:.4f}, above the {delta:.4f} it would have to resolve"}
    attempts = fit["a"] / remaining
    return {"state": "REACHABLE", "attempts": round(attempts, 2), "wall": round(floor, 6),
            "episodes": round(attempts * tasks * 2)}


def reading(control_path: str, treatment_path: str, ladder=LADDER,
            episode_usd: float = DEFAULT_EPISODE_USD, domain_tasks: int | None = None,
            deltas=()) -> dict:
    """The whole reading: observed rung, ladder, floor, and a price for every delta asked about."""
    control = series(control_path)
    treatment = series(treatment_path)
    grid = paired(control, treatment)
    if grid.get("state") != "READ":
        return {"state": grid["state"], "why": grid.get("why")}
    attempts_available = grid["attempts"]
    # The ladder can only be walked up to the attempts the documents hold; the top rung is the fit's
    # extrapolation and is added after the fit, never by inventing a rung the grid did not run.
    walked = [m for m in ladder if m <= attempts_available]
    if attempts_available not in walked:
        walked.append(attempts_available)
    rows = [rung(grid, m) for m in sorted(set(walked))]
    fit = decompose(rows)
    tasks = len(grid["tasks"])
    held = domain_tasks if domain_tasks is not None else tasks
    floor = wall(fit, held)
    priced = {}
    if fit.get("state") in ("FIT", "CLIPPED"):
        for delta in deltas:
            priced[f"{delta:+.4f}"] = plan(fit, held, abs(delta))
    return {
        "state": "RESOLUTION_READ",
        "tasks": tasks,
        "domainTasks": held,
        "attempts": attempts_available,
        "dropped": control.get("dropped", 0) + treatment.get("dropped", 0),
        "episodeUsd": episode_usd,
        "ladder": rows,
        "fit": fit,
        "wall": None if floor is None else round(floor, 6),
        # The rung with the most attempts, which is the resolution the grid in hand actually delivered.
        "observed": min((row["mde"] for row in rows if row["mde"] is not None), default=None),
        "priced": priced,
    }


def render(read: dict) -> str:
    """The reading as the sentences a plan quotes, with the floor where it cannot be missed."""
    if read.get("state") != "RESOLUTION_READ":
        return f"{read.get('state')}: {read.get('why', 'no reading')}"
    lines = [
        f"{read['tasks']} task(s) of a {read['domainTasks']}-task domain, "
        f"{read['attempts']} attempt(s) a task, {read['ladder'][-1]['episodes']} episodes",
    ]
    if read["dropped"]:
        lines.append(f"  {read['dropped']} episode(s) dropped for an attempt count no other task shares")
    lines.append(f"  {'m':>4} {'sd':>7} {'MDE':>7} {'episodes':>9} {'USD':>8}  per point")
    for row in read["ladder"]:
        if row["sd"] is None:
            continue
        usd = row["episodes"] * read["episodeUsd"]
        lines.append(f"  {row['attempts']:>4} {row['sd'] * 100:6.1f}% {row['mde'] * 100:6.2f}pp "
                     f"{row['episodes']:>9} {usd:8.2f}  {usd / (row['mde'] * 100):.3f} USD/pp")
    fit = read["fit"]
    if fit.get("state") == "TOO_FEW_RUNGS":
        lines.append("  the floor cannot be fitted from fewer than two rungs; run one attempt a task more")
        return "\n".join(lines)
    lines.append(f"  fit var(m) = {fit['a']:.5f}/m + {fit['b']:.5f} ({fit['state'].lower()})"
                 + (f" — {fit['why']}" if fit.get("why") else ""))
    if read.get("wall") is None:
        lines.append("  the floor is undefined at zero tasks")
        return "\n".join(lines)
    lines.append(f"  the domain's floor: {read['wall'] * 100:.2f}pp at unlimited attempts — "
                 "repeating a task cannot cross it, only more tasks can")
    for label, priced in read["priced"].items():
        if priced.get("state") == "REACHABLE":
            usd = priced["episodes"] * read["episodeUsd"]
            lines.append(f"  {label}: {priced['attempts']:g} attempt(s) a task, {priced['episodes']} episodes, "
                         f"USD {usd:.2f}")
        else:
            lines.append(f"  {label}: UNREACHABLE — {priced['why']}")
    return "\n".join(lines)


def _fixture(tasks: int, attempts: int, effect: float, noise: float, seed: int = 7) -> tuple[list, list]:
    """A deterministic pair of arms: a coin whose bias varies by task, and that coin plus `effect`.

    Two arms and not one document holding both, because the reader groups by task and would see twice the
    attempts it was asked for. Written as a generator rather than a stubbed document so the self-test
    exercises the same parse path the real grid takes — reward shape, attempt ordering, task ids — and not
    a shortcut around it.

    `noise` is the half-width of the task-to-task spread in bias, so a smaller value is a domain where the
    arms agree from task to task and the floor is lower.
    """
    def draw(state: int) -> int:
        return (1103515245 * state + 12345) % 2**31

    state = seed
    control, treatment = [], []
    for index in range(tasks):
        state = draw(state)
        bias = 0.5 + noise * ((state / 2**31) - 0.5)
        for _ in range(attempts):
            state = draw(state)
            position = state / 2**31
            control.append({"task_id": str(index), "reward_info": {"reward": 1.0 if position < bias else 0.0},
                            "messages": []})
            treatment.append({"task_id": str(index),
                              "reward_info": {"reward": 1.0 if position < bias + effect else 0.0},
                              "messages": []})
    return control, treatment


def _write(path: Path, payload: list[dict]) -> str:
    path.write_text(json.dumps({"simulations": payload}), encoding="utf-8")
    return str(path)


def self_test(workdir: Path) -> list[str]:
    import contextlib
    import io

    failures: list[str] = []

    def check(label: str, condition, detail=None) -> None:
        if not condition:
            failures.append(f"{label} — {detail if detail is not None else 'no detail'}")

    # A check that cannot fail is decoration, so the assertion machinery is asked to fail once, on a label
    # and with no detail, and the record is then removed: the run must still report zero failures below.
    marker = "a deliberately failing check"
    check(marker, False)
    check("a failing check is recorded with its own words", failures[-1] == f"{marker} — no detail", failures[-1])
    failures.pop()
    check("and the record is empty again after the removal", not failures, failures)
    buffer = io.StringIO()
    check("the report names a failure and exits non-zero",
          report([marker], buffer) == 1 and buffer.getvalue().startswith(f"FAIL {marker}"),
          buffer.getvalue())
    check("an empty report exits zero", report([], io.StringIO()) == 0)

    # --- the series reader -------------------------------------------------
    control_payload, treated_payload = _fixture(24, 4, 0.0, 0.3)
    good = _write(workdir / "good.json", control_payload)
    one = series(good)
    check("the reader groups by task", one["tasks"] == 24, one)
    check("and keeps every attempt, in document order", one["attempts"] == 4, one)
    check("no task is dropped when all agree", one["dropped"] == 0, one)

    uneven_control, _ = _fixture(8, 4, 0.0, 0.3)
    uneven = uneven_control + [{"task_id": "x", "reward_info": {"reward": 1.0}, "messages": []}]
    ragged = series(_write(workdir / "ragged.json", uneven))
    check("a task with a unique attempt count is dropped and counted", ragged["dropped"] == 1, ragged)
    check("the modal attempt count survives", ragged["tasks"] == 8 and ragged["attempts"] == 4, ragged)

    # A reward that is not a pass flag: tau2's shape is an object, but a bare number, a bool and a string
    # all appear in documents this lane has read, and none of them is a resolved task except the number.
    shapes = series(_write(workdir / "shapes.json", [
        {"task_id": "a", "reward_info": {"reward": 1.0}},
        {"task_id": "b", "reward_info": {"reward": True}},
        {"task_id": "c", "reward_info": {"reward": "1.0"}},
        {"task_id": "d", "reward_info": {"reward": 0.0}},
        {"task_id": "e"},
    ]))
    check("a bool is not a pass", shapes["byTask"]["b"] == [0], shapes["byTask"])
    check("a string is not a pass", shapes["byTask"]["c"] == [0], shapes["byTask"])
    check("a missing reward is a fail", shapes["byTask"]["e"] == [0], shapes["byTask"])
    check("a float one is a pass", shapes["byTask"]["a"] == [1], shapes["byTask"])
    # A payload that is not a simulation at all is skipped rather than crashing a reader over a grid whose
    # header is a string; documents in this lane have carried non-object rows in their tails.
    noise_row = series(_write(workdir / "noise.json",
                              [{"task_id": "a", "reward_info": {"reward": 1.0}}, "junk", 17]))
    check("a non-object row is skipped", noise_row["tasks"] == 1, noise_row)
    check("an empty document says so", series(_write(workdir / "blank.json", []))["state"] == "NO_EPISODES")
    check("and an attempt cap truncates rather than pads", series(good, attempts=2)["attempts"] == 2)

    # --- the join ----------------------------------------------------------
    other_control, other_treated = _fixture(24, 4, 0.1, 0.3, seed=11)
    other = _write(workdir / "other.json", other_treated)
    grid = paired(one, series(other))
    check("the join lands on the shared tasks", grid["state"] == "READ" and len(grid["tasks"]) == 24, grid.get("state"))
    check("a document with no episode refuses by name", paired({"state": "NO_EPISODES"}, series(other))["state"]
          == "NO_EPISODES")
    disjoint_control, _ = _fixture(8, 4, 0.0, 0.3, seed=99)
    far_control, _ = _fixture(8, 4, 0.0, 0.3)
    disjoint = series(_write(workdir / "disjoint.json", disjoint_control))
    far = series(_write(workdir / "far.json",
                        [dict(row, task_id="z" + str(index)) for index, row in enumerate(far_control)]))
    check("two arms with no task in common refuse", paired(disjoint, far)["state"] == "NO_PAIRS")
    # An arm only one attempt deep pairs at one attempt rather than at the deeper arm's count.
    shallow_control, _ = _fixture(24, 1, 0.0, 0.3, seed=13)
    shallow = series(_write(workdir / "shallow.json", shallow_control))
    check("the join takes the shallower attempt count", paired(shallow, series(other))["attempts"] == 1)
    # A document read with no attempt allowed holds tasks with no observation, which is not a pair at any
    # count: the join says so instead of averaging over an empty list.
    zero = series(good, attempts=0)
    check("an arm with no attempt cannot pair", zero["attempts"] == 0, zero)
    check("and the join refuses it", paired(zero, series(other))["state"] == "NO_PAIRS", paired(zero, series(other)))

    # --- the decomposition -------------------------------------------------
    # A grid where every task differs by exactly the same amount has no spread at any rung: the floor is
    # zero and every effect is resolvable. Constancy is the one case where an infinite ladder is honest.
    flat_control, flat_treatment = [], []
    for index in range(20):
        for _ in range(4):
            flat_control.append({"task_id": str(index), "reward_info": {"reward": 0.0}, "messages": []})
            flat_treatment.append({"task_id": str(index), "reward_info": {"reward": 1.0}, "messages": []})
    flat = reading(_write(workdir / "fc.json", flat_control), _write(workdir / "ft.json", flat_treatment),
                   deltas=(0.01,))
    check("a constant grid resolves anything", flat["wall"] == 0.0, flat["wall"])
    check("and the fit is clipped rather than negative", flat["fit"]["state"] == "CLIPPED", flat["fit"])

    # A fit whose floor would come out below zero: the spread falls faster than 1/m can explain, so the
    # floor is not a variance and is clipped rather than reported as a negative one.
    steep = decompose([{"attempts": 1, "sd": 1.0, "tasks": 20}, {"attempts": 4, "sd": 0.4, "tasks": 20}])
    check("a floor below zero is clipped, not printed", steep["state"] == "CLIPPED" and steep["b"] == 0.0, steep)
    check("and all of it is called measurement", steep["a"] > 0.9, steep)
    check("planning against a missing fit has no answer", plan({"state": "TOO_FEW_RUNGS"}, 114, 0.05)["state"]
          == "NO_FIT")

    # A ladder narrower than the grid's attempts still reads the grid's deepest rung, because the rung the
    # documents actually ran is the only one whose spread is measured rather than extrapolated.
    narrow = reading(good, other, ladder=(1, 2))
    check("a ladder below the grid's depth keeps the deepest rung",
          narrow["ladder"][-1]["attempts"] == 4, [row["attempts"] for row in narrow["ladder"]])
    check("and reports the observed resolution at it", narrow["observed"] == narrow["ladder"][-1]["mde"], narrow)

    # No difference at all and no spread: the floor is zero and the observed MDE is zero.
    same = reading(good, good, deltas=(0.05,))
    check("an arm against itself has no floor", same["wall"] == 0.0, same["wall"])
    check("and its mean difference is zero", same["ladder"][0]["meanDiff"] == 0.0, same["ladder"][0])

    # --- the ladder and the wall ------------------------------------------
    spread = reading(good, other, deltas=(0.05, 0.5))
    check("the ladder is monotone in attempts", all(
        left["mde"] >= right["mde"] for left, right in zip(spread["ladder"], spread["ladder"][1:])),
        [(row["attempts"], row["mde"]) for row in spread["ladder"]])
    check("the wall is below the observed resolution",
          spread["wall"] <= spread["observed"], (spread["wall"], spread["observed"]))
    check("episodes count both arms", spread["ladder"][-1]["episodes"] == 24 * 4 * 2, spread["ladder"][-1])
    check("a small effect is priced", spread["priced"]["+0.0500"]["state"] in ("REACHABLE", "UNREACHABLE"),
          spread["priced"])
    check("a large effect is reachable", spread["priced"]["+0.5000"]["state"] == "REACHABLE", spread["priced"])

    # The pricing solves the ladder's own equation, so feeding the wall back in must be unreachable and
    # feeding twice the wall in must be reachable at a finite attempt count.
    floor = spread["wall"]
    check("the floor itself is unreachable", plan(spread["fit"], 24, floor * 0.999)["state"] == "UNREACHABLE",
          plan(spread["fit"], 24, floor * 0.999))
    near = plan(spread["fit"], 24, floor * 2)
    check("twice the floor is reachable", near["state"] == "REACHABLE", near)
    check("and needs more than one attempt", near["attempts"] > 1, near)

    # A domain with more tasks has a lower floor, and the floor scales as 1/sqrt(N) rather than 1/N.
    wide = reading(good, other, domain_tasks=96)
    check("a bigger domain lowers the floor", wide["wall"] < spread["wall"], (wide["wall"], spread["wall"]))
    check("by the root of the task ratio, not the ratio",
          abs(spread["wall"] / wide["wall"] - 2.0) < 1e-3, spread["wall"] / wide["wall"])

    # --- refusals ----------------------------------------------------------
    check("a grid with no episode refuses to be priced",
          reading(_write(workdir / "e1.json", []), _write(workdir / "e2.json", []))["state"] == "NO_EPISODES")
    thin_control, thin_treated = _fixture(1, 1, 0.3, 0.3)
    thin = reading(_write(workdir / "t1.json", thin_control), _write(workdir / "t2.json", thin_treated))
    check("one task cannot be decomposed", thin["state"] == "RESOLUTION_READ" and thin["observed"] is None, thin)
    check("and the sentence says so rather than printing a zero", "fewer than two rungs" in render(thin),
          render(thin))
    check("a grid with no task has no floor", reading(good, other, domain_tasks=0)["wall"] is None,
          reading(good, other, domain_tasks=0)["wall"])
    check("and the sentence says so", "undefined at zero tasks" in render(reading(good, other, domain_tasks=0)),
          render(reading(good, other, domain_tasks=0)))
    # A grid with one ragged task is still readable, and the sentence has to say what it set aside: a drop
    # that is not printed is a denominator nobody can reconcile against the document.
    ragged_eight, ragged_eight_treated = _fixture(8, 4, 0.1, 0.3, seed=17)
    ragged_reading = reading(_write(workdir / "r1.json", uneven),
                             _write(workdir / "r2.json", ragged_eight_treated), deltas=(0.2,))
    check("a ragged grid still reads", ragged_reading["state"] == "RESOLUTION_READ", ragged_reading.get("state"))
    check("and its drop is reported in the sentence",
          "1 episode(s) dropped" in render(ragged_reading), render(ragged_reading))
    check("a refusal renders as its own name", render({"state": "NO_PAIRS", "why": "nothing shared"}).startswith(
        "NO_PAIRS"), render({"state": "NO_PAIRS", "why": "nothing shared"}))

    # --- the sentence ------------------------------------------------------
    sentence = render(spread)
    check("the sentence carries the floor", "floor" in sentence, sentence)
    check("and the price per point", "USD/pp" in sentence, sentence)
    check("and the unreachable case is named", "UNREACHABLE" in render(reading(
        good, other, deltas=(0.0001,))), render(reading(good, other, deltas=(0.0001,))))

    # --- the command line --------------------------------------------------
    # The CLI path is exercised through the same reader, but its table is swallowed: the self-test's own
    # output is a count of failures, and a fixture's table printed above it reads like a real reading.
    out = workdir / "resolution.json"
    with contextlib.redirect_stdout(io.StringIO()):
        # Once with no output path: a run that only wants the sentence must not leave a file behind.
        main([f"--control={good}", f"--treatment={other}"])
        main([f"--control={good}", f"--treatment={other}", f"--out={out}", "--delta=0.05", "--usd=0.004"])
    written = json.loads(out.read_text())
    check("the run writes its reading", written["state"] == "RESOLUTION_READ", written.get("state"))
    check("with the price the caller gave", written["episodeUsd"] == 0.004, written.get("episodeUsd"))
    refused = None
    try:
        main([f"--control={good}"])
    except SystemExit as error:
        refused = str(error)
    check("a run with one document is refused by name", refused == "resolution-needs-two-documents", refused)
    return failures


def report(failures: list[str], stream=None) -> int:
    """Print the self-test's failures and return the exit code. Separated so the failing path is run."""
    out = stream or sys.stdout
    for failure in failures:
        out.write(f"FAIL {failure}\n")
    out.write(f"{len(failures)} failure(s)\n")
    return 1 if failures else 0


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--control", help="the untreated arm's document")
    parser.add_argument("--treatment", help="the treated arm's document")
    parser.add_argument("--out", help="where to write the JSON reading")
    parser.add_argument("--usd", type=float, default=DEFAULT_EPISODE_USD, help="price of an episode")
    parser.add_argument("--domain-tasks", type=int, default=None,
                        help="how many independent tasks the domain holds (default: the grid's own count)")
    parser.add_argument("--delta", type=float, action="append", default=[],
                        help="an effect to price, in points of pass rate (repeatable)")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--workdir", default=None, help="where the self-test writes its fixtures")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        import tempfile
        with tempfile.TemporaryDirectory() as scratch:
            failures = self_test(Path(arguments.workdir or scratch))
        raise SystemExit(report(failures))

    if not (arguments.control and arguments.treatment):
        raise SystemExit("resolution-needs-two-documents")
    measured = reading(arguments.control, arguments.treatment, episode_usd=arguments.usd,
                       domain_tasks=arguments.domain_tasks,
                       deltas=tuple(value / 100.0 for value in arguments.delta))
    print(render(measured))
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(measured, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
