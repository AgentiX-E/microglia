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

# The currency the plan is quoted in, as a constant rather than a flag: a plan whose total depends on
# who ran it is not a plan. It lives here because this file is where every other money figure in the
# lane's plan is derived, and two rates in two files is how a total stops reconciling.
CNY_PER_USD = 7.2


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


def tier(fit: dict, tasks: int, arms: int = 2, attempts: int = 1,
         episode_usd: float = DEFAULT_EPISODE_USD, rate: float = 0.5) -> dict:
    """One row of a cost ladder: what `tasks` tasks, `arms` arms and `attempts` attempts buy, and its price.

    A ladder exists because a plan quoted as one number is a plan whose factors cannot be argued with.
    The number this lane carried — ¥93.5 — is `278 × 2 × 4` episodes at the measured price, and each of
    the three factors buys something different: the task count buys a denominator, the second arm buys a
    control, the attempts buy a variance reduction. A reader who is shown the product cannot say which
    factor they would rather not pay for. A reader shown the ladder can.

    Two arm counts are priced, and they are **not** the same measurement:

      * `arms=2` is a paired delta, and its resolution is the fitted `a/m + b` over the root of the task
        count. This is the ruler every earlier round used.
      * `arms=1` cannot produce a paired delta at all — there is nothing to pair it with. What it buys is
        an **absolute score's half-width**, `POWER_Z × sqrt(p(1-p)/(N·m))`, and `rate` is `p`. The
        default is a half, which maximises `p(1-p)` and is therefore the conservative bound: a domain at
        80% is easier to measure than one at 50%, and assuming the hardest case cannot flatter a plan.

    The two are printed side by side with their `kind` because a ladder that priced a one-armed dispatch
    with the paired formula would quote a resolution the dispatch cannot deliver — the fourth correction
    of reference in this plan section, repeated as arithmetic.

    `floor` is the same wall `wall()` returns, evaluated at this tier's task count. It is carried on
    every row because **shrinking the sample raises the floor**: forty tasks have a floor 2.64 times the
    two hundred and seventy-eight's, so a cheap rung is a blunt ruler, and a table that printed only the
    price would recommend the bluntest one.
    """
    if tasks < 1:
        return {"state": "NO_TASKS", "why": "a tier with no task resolves nothing at any price"}
    if arms not in (1, 2):
        return {"state": "NO_SUCH_ARM_COUNT", "why": f"{arms} arms is neither a score nor a delta"}
    if attempts < 1:
        return {"state": "NO_ATTEMPTS", "why": "a tier with no attempt buys no episode"}
    if arms == 2 and fit.get("state") not in ("FIT", "CLIPPED"):
        return {"state": "NO_FIT", "why": "a paired tier needs the grid's own variance decomposition"}

    episodes = tasks * arms * attempts
    usd = episodes * episode_usd
    if arms == 2:
        spread = math.sqrt(fit["a"] / attempts + fit["b"])
        mde = POWER_Z * spread / math.sqrt(tasks)
        kind, floor = "paired-delta", wall(fit, tasks)
    else:
        # A rate is only meaningful for the score a single arm reports; a paired delta has no `p` in it,
        # so refusing a two-armed rung over its rate would be refusing it for a quantity it never reads.
        if not 0.0 < rate < 1.0:
            return {"state": "NO_SUCH_RATE", "why": f"a pass rate of {rate} is not a proportion"}
        mde = POWER_Z * math.sqrt(rate * (1.0 - rate) / (tasks * attempts))
        kind, floor = "absolute-score", None
    return {
        "state": "TIER",
        "tasks": tasks,
        "arms": arms,
        "attempts": attempts,
        "episodes": episodes,
        "usd": round(usd, 6),
        "cny": round(usd * CNY_PER_USD, 2),
        "mde": round(mde, 6),
        "kind": kind,
        "floor": None if floor is None else round(floor, 6),
        # The only cross-tier comparison that survives a change of task count, and the one that punishes
        # a blunt ruler: dollars bought per point of resolution. It is not a ranking on its own — a tier
        # can be cheap per point and still unable to see the effect it was bought for.
        "usdPerPoint": round(usd / (mde * 100.0), 6) if mde else None,
    }


def tiers(fit: dict, specs, episode_usd: float = DEFAULT_EPISODE_USD, rate: float = 0.5) -> list:
    """A ladder from `(tasks, arms, attempts)` triples, in the order given, refusals included.

    Refusals are kept rather than filtered: a tier that cannot be priced is a fact about the plan, and a
    caller who dropped it would print a ladder that silently omits the rung they asked about.
    """
    return [tier(fit, tasks, arms, attempts, episode_usd=episode_usd, rate=rate)
            for tasks, arms, attempts in specs]


def render_tiers(rows: list, episode_usd: float = DEFAULT_EPISODE_USD) -> str:
    """The ladder as a table a plan can paste, with the floor and the per-point price beside every rung."""
    if not rows:
        return "no tier was asked about"
    lines = [f"  {'tasks':>5} {'arms':>4} {'m':>3} {'episodes':>9} {'CNY':>7} {'MDE':>8} "
             f"{'floor':>8} {'USD/pp':>7}  kind"]
    for row in rows:
        if row.get("state") != "TIER":
            lines.append(f"  {row.get('state')}: {row.get('why', 'no reading')}")
            continue
        floor = "—" if row["floor"] is None else f"{row['floor'] * 100:6.2f}pp"
        lines.append(f"  {row['tasks']:>5} {row['arms']:>4} {row['attempts']:>3} {row['episodes']:>9} "
                     f"{row['cny']:>7.2f} {row['mde'] * 100:6.2f}pp {floor:>8} "
                     f"{row['usdPerPoint']:>7.3f}  {row['kind']}")
    return "\n".join(lines)


def check_tiers(document: dict, episode_usd: float | None = None, rate: float = 0.5) -> list:
    """Re-derive every tier a manifest carries, and report each figure that does not come back.

    A manifest is verified against a re-derivation, never against its own history — the rule R240 learned
    when a `diff` against a backup of itself certified two lost writes. So this function does not compare
    the document with an earlier version of the document; it recomputes from the stored specification and
    the stored fit, and names every field that the recomputation does not reproduce.

    The price is anchored, not read off the row being checked: a caller's figure wins, and otherwise the
    plan's own top-level `episodeUsd` does, and an item that disagrees with it is reported rather than
    believed. A ladder priced by the row it is checking would certify any number a row carried.
    """
    problems: list = []
    top = document.get("episodeUsd")
    for item in document.get("items") or []:
        rows = item.get("tiers")
        if not rows:
            continue
        stated = item.get("episodeUsd")
        if episode_usd is not None:
            if stated is not None and abs(stated - episode_usd) > 1e-9:
                problems.append(f"{item['id']}: priced at {stated} USD an episode against the caller's {episode_usd}")
            price = episode_usd
        elif stated is not None:
            if top is not None and abs(stated - top) > 1e-9:
                problems.append(f"{item['id']}: priced at {stated} USD an episode against the plan's {top}")
            price = stated
        elif top is not None:
            price = top
        else:
            problems.append(f"{item['id']}: a ladder with no price to re-derive against")
            continue
        fit = item.get("fit") or {}
        fitted = {"state": fit.get("state", "FIT"), "a": fit.get("a", 0.0), "b": fit.get("b", 0.0)}
        for row in rows:
            spec = (row.get("tasks"), row.get("arms"), row.get("attempts"))
            if None in spec:
                problems.append(f"{item['id']}: a tier without a complete specification — {row}")
                continue
            again = tier(fitted, spec[0], spec[1], spec[2], episode_usd=price, rate=rate)
            if again.get("state") != "TIER":
                problems.append(f"{item['id']}: {spec} does not price — {again.get('why')}")
                continue
            for field, tolerance in (("episodes", 0), ("cny", 0.02), ("mde", 1e-5)):
                if field not in row:
                    problems.append(f"{item['id']}: {spec} states no {field}")
                elif abs(row[field] - again[field]) > tolerance:
                    problems.append(f"{item['id']}: {spec} states {field}={row[field]} against "
                                    f"{again[field]} on re-derivation")
    return problems


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

    # --- the cost ladder ---------------------------------------------------
    # A ladder exists so the three factors of a quoted product can be argued with one at a time, so the
    # checks are about what each factor buys — not only about the multiplication.
    fit = spread["fit"]
    full = tier(fit, 278, 2, 4)
    check("a two-armed rung is a paired delta", full["state"] == "TIER" and full["kind"] == "paired-delta", full)
    check("and pays for both arms", full["episodes"] == 278 * 2 * 4, full)
    check("its price is the plan's own currency", abs(full["cny"] - full["usd"] * 7.2) < 0.02, full)
    check("a rung's floor is the wall at its own task count",
          abs(full["floor"] - spread["wall"] * math.sqrt(24 / 278)) < 1e-5, (full["floor"], spread["wall"]))
    check("more attempts buy resolution", full["mde"] < tier(fit, 278, 2, 2)["mde"] < tier(fit, 278, 2, 1)["mde"],
          [tier(fit, 278, 2, m)["mde"] for m in (1, 2, 4)])
    narrow = tier(fit, 40, 2, 4)
    check("a smaller sample is a blunter ruler", narrow["mde"] > full["mde"], (narrow["mde"], full["mde"]))
    check("and its floor rises by the root of the task ratio, not the ratio",
          abs(narrow["floor"] / full["floor"] - math.sqrt(278 / 40)) < 1e-4,
          narrow["floor"] / full["floor"])

    # A one-armed dispatch cannot produce a paired delta. Pricing it with the paired formula would quote a
    # resolution nothing in it can deliver, which is this plan's recurring defect in arithmetic form.
    alone = tier(fit, 40, 1, 1)
    check("a one-armed rung is an absolute score", alone["kind"] == "absolute-score", alone)
    check("and its half-width is the binomial bound at a half",
          abs(alone["mde"] - POWER_Z * math.sqrt(0.25 / 40)) < 1e-6, alone)
    check("it has no floor, because there is nothing to pair", alone["floor"] is None, alone)
    check("a domain at ninety per cent is easier to measure than one at fifty",
          tier(fit, 40, 1, 1, rate=0.9)["mde"] < alone["mde"])
    check("and its half-width narrows by the root of the attempts",
          abs(alone["mde"] / tier(fit, 40, 1, 4)["mde"] - 2.0) < 1e-4)
    check("a rate outside the unit interval is refused", tier(fit, 40, 1, 1, rate=1.0)["state"] == "NO_SUCH_RATE")
    check("and a two-armed rung is not refused for a rate it never reads",
          tier(fit, 40, 2, 1, rate=1.0)["state"] == "TIER")

    check("a rung with no task is refused", tier(fit, 0, 2, 1)["state"] == "NO_TASKS")
    check("three arms is neither a score nor a delta", tier(fit, 40, 3, 1)["state"] == "NO_SUCH_ARM_COUNT")
    check("a rung with no attempt is refused", tier(fit, 40, 2, 0)["state"] == "NO_ATTEMPTS")
    check("a paired rung without a fit is refused", tier({"state": "TOO_FEW_RUNGS"}, 40, 2, 1)["state"] == "NO_FIT")
    check("and a one-armed rung needs no fit at all",
          tier({"state": "TOO_FEW_RUNGS"}, 40, 1, 1)["state"] == "TIER")

    # The per-point price is the only comparison that survives a change of task count, so it is checked
    # against its own definition rather than against a remembered number.
    check("the per-point price is what the rung paid for a point",
          abs(full["usdPerPoint"] - full["usd"] / (full["mde"] * 100)) < 1e-5, full["usdPerPoint"])
    check("a ladder keeps its order and its refusals",
          [row.get("state") for row in tiers(fit, [(24, 2, 1), (0, 2, 1), (12, 1, 2)])]
          == ["TIER", "NO_TASKS", "TIER"],
          [row.get("state") for row in tiers(fit, [(24, 2, 1), (0, 2, 1), (12, 1, 2)])])
    check("an empty ladder says so rather than printing a header",
          render_tiers([]) == "no tier was asked about", render_tiers([]))
    check("and a rung that cannot be priced is printed rather than dropped",
          "NO_TASKS" in render_tiers([tier(fit, 0, 2, 1)]), render_tiers([tier(fit, 0, 2, 1)]))
    check("a priced rung's row carries its kind and its charge",
          "paired-delta" in render_tiers([full]) and f"{full['cny']:.2f}" in render_tiers([full]),
          render_tiers([full]))

    # --- the manifest of a ladder ------------------------------------------
    # A ladder in a document is a second source for four numbers unless the build re-derives it, which is
    # the rule R240 established for manifests: verified against a re-derivation, never against its history.
    package = {"items": [{"id": "R242", "fit": {"state": "FIT", "a": fit["a"], "b": fit["b"]},
                          "episodeUsd": DEFAULT_EPISODE_USD, "tiers": [full, alone]}]}
    check("a manifest's own ladder re-derives", check_tiers(package, episode_usd=DEFAULT_EPISODE_USD) == [],
          check_tiers(package, episode_usd=DEFAULT_EPISODE_USD))

    def mutated(mutate) -> dict:
        changed = json.loads(json.dumps(package))
        mutate(changed["items"][0])
        return changed

    def doctored(mutate) -> list:
        return check_tiers(mutated(mutate), episode_usd=DEFAULT_EPISODE_USD)

    check("a doctored price is caught",
          any("cny" in problem for problem in doctored(lambda item: item["tiers"][0].update({"cny": 12.0}))))
    check("a doctored resolution is caught",
          any("mde" in problem for problem in doctored(lambda item: item["tiers"][0].update({"mde": 0.01}))))
    check("a doctored episode count is caught",
          any("episodes" in problem for problem in doctored(lambda item: item["tiers"][0].update({"episodes": 1}))))
    check("a field left out is caught rather than assumed",
          any("states no episodes" in problem for problem in doctored(
              lambda item: item["tiers"][0].pop("episodes"))))
    check("an incomplete specification is caught",
          any("complete specification" in problem for problem in doctored(
              lambda item: item["tiers"].append({"arms": 2}))))
    check("a rung that does not price is caught",
          any("does not price" in problem for problem in doctored(
              lambda item: item["tiers"].append({"tasks": 0, "arms": 2, "attempts": 1}))))
    check("a manifest priced at another rate than the caller's is caught",
          any("an episode" in problem for problem in doctored(lambda item: item.update({"episodeUsd": 0.004}))))
    check("an item that carries no ladder is skipped rather than failed",
          check_tiers({"items": [{"id": "R236", "nowCny": 2.52}]}) == [])

    # The price is anchored, not read off the row being checked: a ladder that certified itself against its
    # own row would certify any number, which is the defect a manifest exists to prevent.
    anchored = json.loads(json.dumps(package))
    anchored["episodeUsd"] = DEFAULT_EPISODE_USD
    del anchored["items"][0]["episodeUsd"]
    check("a ladder without its own price takes the plan's", check_tiers(anchored) == [], check_tiers(anchored))
    unpriced = json.loads(json.dumps(anchored))
    del unpriced["episodeUsd"]
    check("and a ladder with no price anywhere is refused rather than assumed",
          any("no price" in problem for problem in check_tiers(unpriced)),
          check_tiers(unpriced))
    mismatched = json.loads(json.dumps(anchored))
    mismatched["items"][0]["episodeUsd"] = 0.004
    check("a ladder priced away from the plan is named, not believed",
          any("the plan's" in problem for problem in check_tiers(mismatched)), check_tiers(mismatched))

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

    # The ladder is reachable from the command line because that is where a plan quotes it: a table only a
    # test can print is a table no document will carry.
    table = io.StringIO()
    with contextlib.redirect_stdout(table):
        main([f"--control={good}", f"--treatment={other}", "--tier=24:2:2", "--tier=0:2:1", "--tier=12:1:1"])
    ladder_text = table.getvalue()
    check("the command line prices a ladder", "paired-delta" in ladder_text, ladder_text)
    check("and a one-armed rung is priced as a score", "absolute-score" in ladder_text, ladder_text)
    check("and a refusal is printed rather than dropped", "NO_TASKS" in ladder_text, ladder_text)

    malformed = None
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            main([f"--control={good}", f"--treatment={other}", "--tier=40:2"])
    except SystemExit as error:
        malformed = str(error)
    check("a malformed rung is refused by name", malformed == "tier-not-three-integers: 40:2", malformed)

    manifest = workdir / "plan.json"
    manifest.write_text(json.dumps(package), encoding="utf-8")
    checked_code = None
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            main([f"--check-tiers={manifest}"])
        except SystemExit as error:
            checked_code = error.code
    check("the manifest check exits zero on a ladder that re-derives", checked_code == 0, checked_code)

    broken = workdir / "broken.json"
    broken.write_text(json.dumps(mutated(lambda item: item["tiers"][0].update({"cny": 12.0}))),
                      encoding="utf-8")
    broken_code = None
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            main([f"--check-tiers={broken}"])
        except SystemExit as error:
            broken_code = error.code
    check("and exits non-zero on one that does not", broken_code == 1, broken_code)

    refused = None
    try:
        main([f"--control={good}"])
    except SystemExit as error:
        refused = str(error)
    check("a run with one document is refused by name", refused == "resolution-needs-two-documents", refused)

    # Loaded as a module so the file is measured on the path an importer takes as well as the one a script
    # does: the `__main__` guard is a branch, and a branch no run takes is a branch no gate measures.
    import importlib.util
    spec = importlib.util.spec_from_file_location("resolution_as_module", Path(__file__).resolve())
    as_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(as_module)
    check("the file is importable without running its own suite", as_module.POWER_Z == POWER_Z)
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
    parser.add_argument("--tier", action="append", default=[],
                        help="a cost rung as tasks:arms:attempts, priced from this grid's fit (repeatable)")
    parser.add_argument("--rate", type=float, default=0.5,
                        help="the pass rate a one-armed rung's half-width is taken at (default 0.5, the bound)")
    parser.add_argument("--check-tiers",
                        help="a manifest carrying `tiers`, re-derived rather than trusted")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--workdir", default=None, help="where the self-test writes its fixtures")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        import tempfile
        with tempfile.TemporaryDirectory() as scratch:
            failures = self_test(Path(arguments.workdir or scratch))
        raise SystemExit(report(failures))

    if arguments.check_tiers:
        document = json.loads(Path(arguments.check_tiers).read_text(encoding="utf-8"))
        problems = check_tiers(document, rate=arguments.rate)
        print(f"{len(problems)} tier problem(s)")
        raise SystemExit(report(problems))

    if not (arguments.control and arguments.treatment):
        raise SystemExit("resolution-needs-two-documents")
    measured = reading(arguments.control, arguments.treatment, episode_usd=arguments.usd,
                       domain_tasks=arguments.domain_tasks,
                       deltas=tuple(value / 100.0 for value in arguments.delta))
    print(render(measured))
    if arguments.tier:
        specs = []
        for spec in arguments.tier:
            try:
                tasks, arms, attempts = (int(part) for part in spec.split(":"))
            except ValueError:
                raise SystemExit(f"tier-not-three-integers: {spec}") from None
            specs.append((tasks, arms, attempts))
        print(render_tiers(tiers(measured.get("fit", {"state": "NO_FIT"}), specs,
                                 episode_usd=arguments.usd, rate=arguments.rate)))
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(measured, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
