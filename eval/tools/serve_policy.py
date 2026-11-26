#!/usr/bin/env python3
"""What a serving decision is worth, priced before it is run: the skip half and the serve half of one policy.

Every arm in this lane served the material to every episode, so the only question the dispatches have answered is
*what should the block say*. R218b's stratified reading says that question is the wrong one: the block is worth
+7.5 points on the 43 tasks the control solved some of and costs −9.5 on the 66 it solved every attempt
(PROGRESS 249.18), which makes "should anything be served" worth more than any rewrite of the text. But a serving
decision is made **before** the episode's outcome exists, so it needs an observable available at that moment, and the
two candidates that were cheapest to check have both died on artefacts that cost nothing:

  * the opening turn's ask count fires on **110 of 114** openings (mean 2.40 asks), so it separates 96.5% from 3.5%
    and decides nothing (PROGRESS 249.19);
  * the first tool call is an identity lookup — `find_user_id_by_name_zip` 344, `find_user_id_by_email` 108 — in
    **452 of 456** control episodes, so a gate on that family serves **99.1%** and "serve after the model has acted
    once" gates on the authentication step: the first two acts carry no task information at all (`--observables`).

Both refutations came from the same instrument, and the instrument is what this file is: a **policy replay** over a
grid that already holds both arms.

## What the screen found on R218b, and why it is a negative result rather than a weak one

Three hundred and eighty-five cuts over the grid's 228 screen pairs yielded **one** admissible policy: skip the pairs
whose opening turn states two or more asks. In sample it skipped 35% of the pairs and bought **+13.8 points** on 15
discordant pairs (13 up, 2 down, p = 0.0074). On the half it never saw it bought **+3.2 points** on 21 discordant
pairs (12 up, 9 down, p = 0.66) — the effect kept a quarter of its size and lost its sign test. `NOT_CONFIRMED`.

The number that makes this a refutation rather than an underpowered attempt is the multiplicity: 385 cuts at a
two-sided 5% test produce about **ten** positive-and-significant results from noise alone, and the screen produced
**one**. A family of proxies that yields less than chance is not a family with a faint signal; it is a family with
none, and the one survivor is the cut that happened to clear a bar the others did not even reach. That is why the
report prints `expectedByChance` beside the yield: a screen quoted without its multiplicity is a p-hack with a table.

Two structural facts fall out and they bound what any successor proxy can be. The opening turn is the user simulator's
fixed utterance, so it is **constant across a task's four attempts** (100% of tasks, reported per field): the cut was
an *admission* rule — memory on or off for a task class — and even that did not transfer across task halves. And no
field in the prefix varies enough within a task to gate one attempt and serve another, which is the shape the harm
stratification actually asks for. The next proxy has to read what the **episode reveals after the identity gate**
(the order, the item, the returned attribute row), not what the request declares and not the first act — and it has to
be validated by this screen before a dispatch is armed, because the screen costs nothing and the dispatch costs ¥9.

## The estimator, and what it assumes

`control` and `treated` ran the same 114 tasks with four attempts each, so the episodes pair by (task, attempt index).
For a policy π that maps an episode's **prefix** to {serve, skip}, the value of the policy is

    V(π) = mean over pairs of  π(x) · y_treated  +  (1 − π(x)) · y_control

and the two differences that decide whether π is worth running are both *conditional* means over a subset of the
pairs, which is why each gets its own sign test rather than sharing one:

  * **skipDelta** = mean over the pairs π skips of (y_control − y_treated) — what skipping bought, on the pairs that
    were skipped. This is the quantity a serving decision is *for*: if it is not positive, the material was worth
    serving to the very episodes the policy refuses.
  * **serveDelta** = mean over the pairs π serves of (y_treated − y_control) — what serving bought, on the pairs that
    were served. A policy that skips correctly but serves the rest at a loss has not improved on serving nothing.

`V(π)` against `V(serve all)` is `skipShare × skipDelta`; against `V(serve none)` it is `serveShare × serveDelta`. The
conditional columns are reported because the shares move with the cut, and a policy can look better only because it
skipped more.

The assumption is the one this lane has used since R218b: attempt *i* of the control is the counterfactual for
attempt *i* of the treated arm. It is not a randomised dose — no dispatch in this lane randomises — and the honest
statement is that it is the strongest pairing the artefacts support, not a causal effect. What it does buy is a
**screen**: a proxy that cannot show a positive skipDelta on the half it was chosen from was never going to survive a
paid run, and finding that out costs nothing.

## Selection, and why the grid is cut in half

A screen over many cuts will always find one that looks good, so the file refuses to report the screen alone. Tasks
are split deterministically (parity of the task's position in sorted order), the candidate is chosen **on the screen
half**, and the *same predicate* is then evaluated on the half it never saw. `CONFIRMED` requires the confirm half to
carry at least `MIN_CONFIRM_PAIRS` discordant pairs, a positive skipDelta, and p < 0.05 in the same direction. Six
discordant pairs is the smallest count at which a unanimous sign test clears 0.05 (2·2⁻⁶ = 0.031), which is why the
floor is six and not five. A policy that only reads well in-sample is `NOT_CONFIRMED`, and that is a result rather
than a failure: it says the observable is noise.

## What the proxies may read

Only the episode's **prefix** — the opening user turn and the first tool calls, never a later message and never the
reward. The reader enforces this by construction: `observables()` walks messages until the first non-auth tool call and
stops. A proxy that read further would be reading the outcome, and the test below pins the boundary by re-reading a
truncated transcript and asserting the observable set is identical.

Usage:
  python3 eval/tools/serve_policy.py --control control.json --treatment front.json
  python3 eval/tools/serve_policy.py --control control.json --treatment front.json --observables
  python3 eval/tools/serve_policy.py --self-test
"""

from __future__ import annotations

import argparse
import io
import json
import math
import statistics
import sys
from pathlib import Path

# The identity gate every tau-bench retail episode opens with. It is a fact about the domain, measured on 456 control
# episodes: `find_user_id_by_name_zip` 344, `find_user_id_by_email` 108, then `get_user_details` 355. The list is here
# because the second candidate proxy is defined as "after the model has acted once", and what the model's first act
# turns out to be decides whether that proxy can separate anything.
AUTH_FAMILY = ("find_user_id_by_name_zip", "find_user_id_by_email", "get_user_details")

# A policy that serves everything is not a decision. The gate is 90% because that is where the refutation of the
# ask-count proxy lives (96.5% served) while a 15% skip with real power stays expressible: the share gate's job is to
# refuse a restatement of "always", and a thin cut is refused by the pair floor instead, which is the accurate reason.
MAX_SERVE_SHARE = 0.90
# The floor the dose reader uses, and for the same reason: ten discordant pairs is where a unanimous sign test clears
# 0.05 (2·2⁻¹⁰ = 0.002) and where a 70/30 split starts to be visible at all.
MIN_PAIRS = 10
# Half the grid, so half the floor. 2·2⁻⁶ = 0.031 is the smallest count that clears 0.05 with a unanimous sign.
MIN_CONFIRM_PAIRS = 6


def _verdict(simulation) -> int:
    """One episode's pass flag, from either shape a reward arrives in."""
    reward = simulation.get("reward_info") or {}
    value = reward.get("reward") if isinstance(reward, dict) else getattr(reward, "reward", None)
    return 1 if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 1.0 else 0


def _sign_test(positive: int, negative: int) -> "float | None":
    """The two-sided exact sign test: the arithmetic every reader in this lane uses for a pair."""
    total = positive + negative
    if total == 0:
        return None
    tail = sum(math.comb(total, index) for index in range(0, min(positive, negative) + 1)) / (2**total)
    return min(1.0, 2 * tail)


def _opening(simulation) -> str:
    """The first user turn's text, which is the only thing observable before any model call."""
    for message in simulation.get("messages") or []:
        if isinstance(message, dict) and message.get("role") == "user":
            return str(message.get("content") or "")
    return ""


def _calls(simulation) -> "list[str]":
    """Every tool call's name in order, read defensively: the field is a list of dicts with a top-level `name`."""
    names = []
    for message in simulation.get("messages") or []:
        if not isinstance(message, dict):
            continue
        for call in message.get("tool_calls") or []:
            if isinstance(call, dict):
                names.append(str(call.get("name") or "unnamed"))
    return names


def observables(simulation) -> "dict | None":
    """The prefix observables, or None when the episode kept no transcript.

    `None` is a refusal and not a zero: an episode whose recording is missing cannot be told to serve or to skip, and
    defaulting either way would put an unmeasured decision into the policy's value. The caller counts these as
    `unreadable` and drops them from the base rather than from the numerator.

    The walk stops at the first tool call outside the auth family, which is what makes the set a *prefix*: everything
    after that point is the trajectory the policy is supposed to act before.
    """
    messages = simulation.get("messages") or []
    if not messages:
        return None
    names = _calls(simulation)
    auth_run = 0
    for name in names:
        if name in AUTH_FAMILY:
            auth_run += 1
        else:
            break
    reveal = names[auth_run] if auth_run < len(names) else None
    opening = _opening(simulation)
    return {
        "firstTool": names[0] if names else "none",
        "authCalls": auth_run,
        "revealTool": reveal if reveal is not None else "none",
        # Calls *up to and including* the reveal, never the whole episode's: the first version counted every call and
        # the prefix test below caught it, because a truncated transcript read a different number. An observable that
        # reads the trajectory is a proxy that has already seen the outcome.
        "callsToReveal": auth_run + (1 if reveal is not None else 0),
        "openingChars": len(opening),
        # The ask count is kept because it is the proxy that was refuted and the refutation has to stay reproducible:
        # a screen that can no longer compute the proxy it killed cannot say whether the kill still holds.
        "openingAsks": opening.count("?") + opening.count("I'd like") + opening.count("I want"),
    }


def pairs(control_path, treatment_path) -> dict:
    """Pair the two arms by (task, attempt index), refusing when a task's attempt counts differ.

    The index is the episode's position inside its task in the document's own order, which is the round it ran in. A
    task with four attempts on one side and three on the other has no pairing for its fourth episode; zipping the
    shorter list would silently match attempt 4 of one arm with nothing, so the count is asserted per task.
    """
    with open(control_path, encoding="utf-8") as handle:
        control_document = json.load(handle)
    with open(treatment_path, encoding="utf-8") as handle:
        treatment_document = json.load(handle)

    def grouped(document):
        buckets: dict = {}
        for simulation in document.get("simulations") or []:
            if not isinstance(simulation, dict):
                continue
            buckets.setdefault(str(simulation.get("task_id")), []).append(simulation)
        return buckets

    control = grouped(control_document)
    treatment = grouped(treatment_document)
    shared = sorted(set(control) & set(treatment))
    if not shared:
        return {"state": "NO_PAIRS", "reason": "no shared task", "control": len(control), "treatment": len(treatment)}

    uneven = [task for task in shared if len(control[task]) != len(treatment[task])]
    if uneven:
        return {"state": "NO_PAIRS", "reason": "uneven attempts", "tasks": uneven[:12], "count": len(uneven)}

    built = []
    unreadable = 0
    for task in shared:
        for index, (left, right) in enumerate(zip(control[task], treatment[task])):
            seen = observables(right)
            if seen is None:
                unreadable += 1
                continue
            built.append({
                "key": f"{task}#{index}",
                "task": task,
                "index": index,
                "control": _verdict(left),
                "treatment": _verdict(right),
                "obs": seen,
            })
    if not built:
        return {"state": "NO_PAIRS", "reason": "no readable episode", "unreadable": unreadable}
    return {
        "state": "PAIRS_BUILT",
        "pairs": built,
        "tasks": len(shared),
        "attempts": len(built) // len(shared),
        "unreadable": unreadable,
    }


def _rates(subset) -> dict:
    """The two conditional differences a policy is made of, each with its own sign test."""
    if not subset:
        return {"n": 0, "delta": None, "up": 0, "down": 0, "discordant": 0, "p": None, "rate": None}
    differences = []
    up = down = 0
    for pair in subset:
        difference = pair["control"] - pair["treatment"]
        differences.append(difference)
        if difference > 0:
            up += 1
        elif difference < 0:
            down += 1
    return {
        "n": len(subset),
        "delta": round(statistics.mean(differences), 4),
        "up": up,
        "down": down,
        "discordant": up + down,
        "p": _sign_test(up, down),
        "rate": round(statistics.mean([pair["treatment"] for pair in subset]), 4),
    }


def evaluate(subset, predicate) -> dict:
    """One candidate policy's value, its two halves, and a verdict that can refuse it.

    `predicate` returns True for **skip**. The verdict order matters: a policy that serves 96% of the grid is refused
    for not being a decision before its skip half is asked to carry a p-value, because a 4% subset with a perfect
    sign test is a statement about four episodes.
    """
    skipped = [pair for pair in subset if predicate(pair["obs"])]
    served = [pair for pair in subset if not predicate(pair["obs"])]
    share_served = len(served) / len(subset) if subset else 1.0
    share_skipped = len(skipped) / len(subset) if subset else 0.0
    skip = _rates(skipped)
    serve = _rates(served)
    # `_rates` differences are control − treatment, which is the sign a skip wants; the serve half wants the other
    # sign, so it is negated here rather than at three call sites.
    if serve["delta"] is not None:
        serve = {**serve, "delta": round(-serve["delta"], 4)}
    if not served:
        # Serving nothing is a decision with no serve half: its value is the control's, so it cannot be compared with
        # serving everything on the basis of a skip that was never chosen against an alternative.
        verdict = "DEGENERATE"
    elif share_served > MAX_SERVE_SHARE:
        verdict = "NO_SEPARATION"
    elif skip["discordant"] < MIN_PAIRS:
        verdict = "UNDERPOWERED"
    elif skip["delta"] is not None and skip["delta"] > 0 and skip["p"] is not None and skip["p"] < 0.05 \
            and serve["delta"] is not None and serve["delta"] >= 0:
        verdict = "ADMISSIBLE"
    else:
        verdict = "DOMINATED"
    all_treatment = statistics.mean([pair["treatment"] for pair in subset]) if subset else 0.0
    all_control = statistics.mean([pair["control"] for pair in subset]) if subset else 0.0
    value = (sum(pair["treatment"] for pair in served) + sum(pair["control"] for pair in skipped)) / len(subset) \
        if subset else 0.0
    return {
        "servedShare": round(share_served, 3),
        "skippedShare": round(share_skipped, 3),
        "skip": skip,
        "serve": serve,
        "value": round(value, 4),
        "gainVsServeAll": round(value - all_treatment, 4),
        "gainVsServeNone": round(value - all_control, 4),
        "verdict": verdict,
    }


def candidates(subset) -> "list[tuple]":
    """Every cut this grid can express, as (name, predicate) in a fixed order.

    Categorical observables yield one candidate per value — skip the episodes whose first tool call was this one —
    because the decision a serving gate can actually take is to refuse a family. Numeric observables yield both
    directions at every observed value, which is the smallest honest set: a threshold between two values is the same
    cut as the threshold at the higher one.
    """
    built = []
    for field in ("firstTool", "revealTool"):
        for value in sorted({pair["obs"][field] for pair in subset}):
            built.append((f"skip {field}={value}", (lambda observed, v=value, f=field: observed[f] == v)))
    for field in ("openingChars", "authCalls", "callsToReveal", "openingAsks"):
        values = sorted({pair["obs"][field] for pair in subset})
        for value in values:
            built.append((f"skip {field}>={value}",
                          (lambda observed, v=value, f=field: observed[f] >= v)))
            built.append((f"skip {field}<={value}",
                          (lambda observed, v=value, f=field: observed[f] <= v)))
    return built


def _row(row: dict) -> dict:
    """One screened candidate with its predicate dropped, so the reading is serialisable."""
    return {"candidate": row["candidate"], **{key: row[key] for key in
                                              ("servedShare", "skippedShare", "skip", "serve", "value",
                                               "gainVsServeAll", "gainVsServeNone", "verdict")}}


def screen(built, split: str = "task-parity") -> dict:
    """Screen on one half of the tasks, then judge the chosen cut on the half it never saw.

    The split is deterministic and derived from the grid rather than from a random seed, so two runs of the same
    document cannot return different policies: a policy chosen under a seed is not reproducible from the artefact that
    chose it, and this lane has been burned by exactly that shape of irreproducibility in the clock.
    """
    tasks = sorted({pair["task"] for pair in built})
    if len(tasks) < 2:
        return {"state": "TOO_FEW_TASKS", "tasks": len(tasks)}
    even = set(tasks[::2])
    first = [pair for pair in built if pair["task"] in even]
    second = [pair for pair in built if pair["task"] not in even]

    seen = []
    for name, predicate in candidates(first):
        reading = evaluate(first, predicate)
        seen.append({"candidate": name, "predicate": predicate, **reading})
    admissible = [row for row in seen if row["verdict"] == "ADMISSIBLE"]
    ranked = sorted(
        seen,
        key=lambda row: (
            row["verdict"] == "ADMISSIBLE",
            row["skip"]["delta"] if row["skip"]["delta"] is not None else -9.0,
            row["skip"]["discordant"],
        ),
        reverse=True,
    )
    summary = {
        "state": "SCREEN_READ",
        "split": split,
        "screenTasks": len(even),
        "confirmTasks": len(tasks) - len(even),
        "screenPairs": len(first),
        "confirmPairs": len(second),
        "candidates": len(seen),
        "admissible": len(admissible),
        "verdicts": {
            name: sum(1 for row in seen if row["verdict"] == name)
            for name in ("ADMISSIBLE", "DOMINATED", "UNDERPOWERED", "NO_SEPARATION", "DEGENERATE")
        },
        # The predicate is a closure and cannot be serialised, so the ranked rows keep only their reading: a JSON
        # document that fails to write is a screen whose result never reaches the artefact the docs quote.
        # The screen's own multiplicity, printed beside its yield: at 385 cuts and a two-sided 5% test, noise alone
        # produces about ten positive-and-significant cuts. A screen that yields fewer admissible cuts than chance is
        # not a weak signal, it is evidence that the family carries none.
        "expectedByChance": round(len(seen) * 0.025, 1),
        "best": _row(ranked[0]) if ranked else None,
        "screen": [_row(row) for row in ranked[:6]],
    }
    if not admissible:
        summary["state"] = "NOTHING_ADMISSIBLE"
        return summary

    chosen = sorted(
        admissible,
        key=lambda row: (row["skip"]["delta"], row["skip"]["discordant"]),
        reverse=True,
    )[0]
    confirmation = evaluate(second, chosen["predicate"])
    pooled = evaluate(built, chosen["predicate"])
    confirmed = (
        confirmation["skip"]["delta"] is not None
        and confirmation["skip"]["delta"] > 0
        and confirmation["skip"]["p"] is not None
        and confirmation["skip"]["p"] < 0.05
        and confirmation["skip"]["discordant"] >= MIN_CONFIRM_PAIRS
    )
    return {
        **summary,
        "state": "SCREEN_CONFIRMED" if confirmed else "SCREEN_NOT_CONFIRMED",
        "chosen": chosen["candidate"],
        "chosenVerdict": chosen["verdict"],
        "confirm": {key: confirmation[key] for key in
                    ("servedShare", "skip", "serve", "gainVsServeAll", "gainVsServeNone", "verdict")},
        "pooled": {key: pooled[key] for key in
                   ("servedShare", "skip", "serve", "gainVsServeAll", "gainVsServeNone", "verdict")},
    }


def render(reading: dict) -> str:
    """One sentence, and the refusals are sentences too: a screen that decided nothing has to say so in words."""
    state = reading["state"]
    if state == "NO_PAIRS":
        return (f"NO_PAIRS: {reading.get('reason')} — the two documents cannot be paired, so no policy can be priced "
                f"on them")
    if state == "TOO_FEW_TASKS":
        return (f"TOO_FEW_TASKS: {reading['tasks']} task(s) cannot be split into a screen and a confirmation half")
    verdicts = ", ".join(f"{name} {count}" for name, count in reading["verdicts"].items())
    head = (f"{reading['candidates']} cut(s) on {reading['screenPairs']} pair(s) "
            f"({reading['screenTasks']} task(s)): {verdicts}; at this many cuts noise alone yields about "
            f"{reading['expectedByChance']} of them")
    if state == "NOTHING_ADMISSIBLE":
        best = reading["best"]
        worst = (f"; the least dominated serves {best['servedShare']:.0%} and its skip half reads "
                 f"{best['skip']['delta']:+.1%} on {best['skip']['discordant']} discordant pair(s) "
                 f"(p = {best['skip']['p'] if best['skip']['p'] is None else format(best['skip']['p'], '.4f')})"
                 if best else "")
        return (f"{head}{worst} — no prefix observable this grid can express is a serving decision, so the "
                f"¥9 a two-arm dispatch would cost buys nothing until a proxy exists that separates")
    confirm = reading["confirm"]
    pooled = reading["pooled"]
    return (
        f"{head}; the chosen cut is `{reading['chosen']}`: on the {reading['confirmPairs']} pair(s) it never saw it "
        f"skips {confirm['servedShare']:.0%} of the pairs and buys {confirm['skip']['delta']:+.1%} on "
        f"{confirm['skip']['discordant']} discordant pair(s) (p = "
        f"{confirm['skip']['p'] if confirm['skip']['p'] is None else format(confirm['skip']['p'], '.4f')}), "
        f"serving the rest at {confirm['serve']['delta']:+.1%} — {state.replace('SCREEN_', '')}; pooled over the grid "
        f"the policy is {pooled['gainVsServeAll']:+.1%} against serving everything and "
        f"{pooled['gainVsServeNone']:+.1%} against serving nothing, and the reading is `{pooled['verdict']}`"
    )


def report(reading: dict) -> str:
    """The table a reader can check line by line, printed only in the modes that have one."""
    if reading["state"] in ("NO_PAIRS", "TOO_FEW_TASKS"):
        return render(reading)
    lines = [f"{'cut':34s} {'served':>7s} {'skipΔ':>8s} {'pairs':>6s} {'p':>7s} {'serveΔ':>8s} "
             f"{'vs all':>8s} {'vs none':>8s}  verdict"]
    for row in reading["screen"]:
        skip, serve = row["skip"], row["serve"]
        lines.append(
            f"{row['candidate'][:34]:34s} {row['servedShare']:7.0%} "
            f"{(skip['delta'] if skip['delta'] is not None else 0):+8.1%} {skip['discordant']:6d} "
            f"{(skip['p'] if skip['p'] is not None else 1.0):7.4f} "
            f"{(serve['delta'] if serve['delta'] is not None else 0):+8.1%} "
            f"{row['gainVsServeAll']:+8.1%} {row['gainVsServeNone']:+8.1%}  {row['verdict']}"
        )
    lines.append(render(reading))
    return "\n".join(lines)


def observables_report(path) -> str:
    """What the grid's prefixes actually contain, which is how the two free refutations were read.

    This is the cheapest output in the file and the most decisive: a proxy whose observable is constant on 99% of the
    grid cannot be a decision, and printing the distribution is how that is established before anything is spent.
    """
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    by_task: dict = {}
    for simulation in document.get("simulations") or []:
        if not isinstance(simulation, dict):
            continue
        row = observables(simulation)
        if row is None:
            continue
        by_task.setdefault(str(simulation.get("task_id")), []).append(row)
    seen = [row for rows in by_task.values() for row in rows]
    if not seen:
        return f"{path}: NO_EPISODES — nothing was recorded, so nothing is observable"
    total = len(seen)
    lines = [f"{total} episode(s) in {Path(path).name}"]
    for field in ("firstTool", "revealTool"):
        counts: dict = {}
        for row in seen:
            counts[row[field]] = counts.get(row[field], 0) + 1
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:6]
        lines.append(f"  {field:12s} " + "  ".join(f"{name} {count} ({count / total:.1%})" for name, count in ranked))
    # Whether a field is constant across a task's attempts decides what kind of decision it can express: a field that
    # never varies inside a task cannot serve one attempt and skip another, so it is an admission rule and not a
    # serving gate. The share is printed for every field rather than inferred, because the distinction is easy to get
    # backwards and impossible to see in a median.
    repeated = [rows for rows in by_task.values() if len(rows) > 1]
    for field in ("authCalls", "callsToReveal", "openingChars", "openingAsks"):
        values = sorted(row[field] for row in seen)
        constant = sum(1 for rows in repeated if len({row[field] for row in rows}) == 1)
        lines.append(f"  {field:12s} median {statistics.median(values):g}  min {values[0]}  max {values[-1]}"
                     + (f"  constant within {constant}/{len(repeated)} task(s) ({constant / len(repeated):.0%})"
                        if repeated else ""))
    # The share a first-tool-call gate would serve, stated as the number the refutation rests on.
    auth_first = sum(1 for row in seen if row["firstTool"] in AUTH_FAMILY) / total
    lines.append(f"  a gate on the first tool call's family would serve {auth_first:.1%} of the grid "
                 f"({total - sum(1 for row in seen if row['firstTool'] in AUTH_FAMILY)} episode(s) skipped), which is "
                 f"{'a decision' if auth_first <= MAX_SERVE_SHARE else 'not a decision'}")
    return "\n".join(lines)


def self_test() -> int:
    """Fixtures whose answer is arithmetic, including every verdict the evaluator can return and both confirmations."""
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def simulation(task, reward, calls, opening="hello there? I'd like a swap"):
        messages = [{"role": "user", "content": opening}]
        for name in calls:
            messages.append({"role": "assistant", "content": "", "tool_calls": [{"name": name}]})
        messages.append({"role": "assistant", "content": "done"})
        return {"task_id": task, "reward_info": {"reward": reward}, "messages": messages}

    with __import__("tempfile").TemporaryDirectory() as temporary:
        root = Path(temporary)

        def document(name, payload):
            path = root / name
            path.write_text(json.dumps({"simulations": payload}), encoding="utf-8")
            return str(path)

        # Sixteen tasks, four attempts each. On the eight "skip-able" tasks the treatment loses every attempt it
        # touches and the control wins every one; the observable that identifies them is the reveal tool, which is
        # `get_product_details` only there. On the eight "keep" tasks the treatment wins two attempts of four and the
        # control wins one, so serving them is worth +0.25 and the policy is admissible end to end.
        control_payload = []
        treatment_payload = []
        for index in range(16):
            task = f"t{index:02d}"
            skipping = index < 8
            calls = ["find_user_id_by_name_zip", "get_user_details",
                     "get_product_details" if skipping else "get_order_details"]
            for attempt in range(4):
                control_wins = True if skipping else (attempt == 0)
                treatment_wins = False if skipping else (attempt < 2)
                opening = "hello? I'd like a swap " + "z" * index
                control_payload.append(simulation(task, 1.0 if control_wins else 0.0, calls, opening))
                treatment_payload.append(simulation(task, 1.0 if treatment_wins else 0.0, calls, opening))
        control = document("control.json", control_payload)
        treatment = document("treatment.json", treatment_payload)

        built = pairs(control, treatment)
        check("the grid pairs", built["state"] == "PAIRS_BUILT", built.get("state"))
        check("every episode is readable", built["unreadable"] == 0, built.get("unreadable"))
        check("sixty-four pairs are built", len(built["pairs"]) == 64, len(built["pairs"]))
        check("sixteen tasks are seen", built["tasks"] == 16, built["tasks"])
        check("four attempts a task", built["attempts"] == 4, built["attempts"])

        seen = observables(built["pairs"][0]["obs"] and {"messages": [
            {"role": "user", "content": "hi? I want a refund"},
            {"role": "assistant", "tool_calls": [{"name": "find_user_id_by_email"}]},
            {"role": "assistant", "tool_calls": [{"name": "get_user_details"}]},
            {"role": "assistant", "tool_calls": [{"name": "get_order_details"}]},
            {"role": "assistant", "content": "later"},
        ]})
        check("the first tool call is named", seen["firstTool"] == "find_user_id_by_email", seen)
        check("the auth run stops at the first non-auth call", seen["authCalls"] == 2, seen)
        check("the reveal tool is the one after the gate", seen["revealTool"] == "get_order_details", seen)
        check("the calls up to the reveal are counted", seen["callsToReveal"] == 3, seen)
        check("the opening turn is measured", seen["openingChars"] == len("hi? I want a refund"), seen)
        check("the ask count counts the question mark", seen["openingAsks"] == 2, seen)
        check("an episode with no transcript refuses", observables({"task_id": "x", "messages": []}) is None)
        # A transcript that starts at the assistant has no opening turn, and the reader says zero rather than
        # reaching for the first message with a `content` field.
        check("a transcript with no user turn has no opening",
              observables({"messages": [{"role": "assistant", "content": "hello"}]})["openingChars"] == 0)
        # A malformed message or tool call is skipped, not fatal: the recording comes from an agent that writes JSONL
        # into a runner, and a reader that throws on one bad line loses the grid.
        ragged = observables({"messages": [
            {"role": "user", "content": "hi"},
            "not a message",
            {"role": "assistant", "tool_calls": [{"name": "find_user_id_by_email"}, "not a call"]},
        ]})
        check("a non-dict message is skipped", ragged["callsToReveal"] == 1, ragged)
        check("and a non-dict call is skipped with it", ragged["firstTool"] == "find_user_id_by_email", ragged)

        # The prefix boundary: everything after the reveal is invisible, so an observable computed on a truncated
        # transcript must be identical. This is the test that makes "observable when" a property rather than a claim.
        full = {"messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "tool_calls": [{"name": "find_user_id_by_email"}]},
            {"role": "assistant", "tool_calls": [{"name": "get_order_details"}]},
            {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order"}]},
        ]}
        truncated = {"messages": full["messages"][:3]}
        check("a truncated transcript reads the same", observables(full) == observables(truncated),
              (observables(full), observables(truncated)))

        good = evaluate(built["pairs"], lambda observed: observed["revealTool"] == "get_product_details")
        check("the separating cut is admissible", good["verdict"] == "ADMISSIBLE", good["verdict"])
        check("it serves half the grid", good["servedShare"] == 0.5, good["servedShare"])
        check("its skip half is worth a point a pair", good["skip"]["delta"] == 1.0, good["skip"])
        check("on thirty-two discordant pairs", good["skip"]["discordant"] == 32, good["skip"])
        check("with a p below any threshold", good["skip"]["p"] < 0.001, good["skip"]["p"])
        check("nothing is lost on the served half", good["serve"]["delta"] == 0.25, good["serve"])
        check("the value beats serving everything", good["gainVsServeAll"] == 0.5, good["gainVsServeAll"])
        check("and beats serving nothing", good["gainVsServeNone"] == 0.125, good["gainVsServeNone"])

        everything = evaluate(built["pairs"], lambda observed: False)
        check("serving everything is not a decision", everything["verdict"] == "NO_SEPARATION", everything["verdict"])
        check("and gains nothing against itself", everything["gainVsServeAll"] == 0.0, everything["gainVsServeAll"])
        nothing = evaluate(built["pairs"], lambda observed: True)
        check("skipping everything is degenerate rather than admissible", nothing["verdict"] == "DEGENERATE",
              nothing["verdict"])
        check("and its served half is empty", nothing["serve"]["n"] == 0, nothing["serve"])
        check("which is reported as no delta rather than zero", nothing["serve"]["delta"] is None, nothing["serve"])

        # A cut that names a value no episode carries skips nothing, and the refusal is the share gate rather than the
        # sign test: the verdict order exists so that a 0% skip is never reported as an unpowered p-value.
        meh = evaluate(built["pairs"], lambda observed: observed["revealTool"] == "nothing-here")
        check("a cut that skips nothing is refused by share", meh["verdict"] == "NO_SEPARATION", meh["verdict"])
        check("and its skip half is empty", meh["skip"]["n"] == 0, meh["skip"])

        def grid(prefix, tasks, calls_of, outcome):
            left, right = [], []
            for index in range(tasks):
                task = f"{prefix}{index:02d}"
                calls = calls_of(index)
                win_control, win_treatment = outcome(index)
                left.append(simulation(task, 1.0 if win_control else 0.0, calls))
                right.append(simulation(task, 1.0 if win_treatment else 0.0, calls))
            return document(f"{prefix}-c.json", left), document(f"{prefix}-t.json", right)

        # Underpowered: forty tasks, four of them skipped, and the skip is right on all four — four discordant pairs,
        # which is exactly the count at which a perfect sign test is still p = 0.125 and decides nothing.
        thin_control, thin_treatment = grid(
            "thin", 40,
            lambda index: ["find_user_id_by_name_zip", "rare_tool" if index < 4 else "get_order_details"],
            lambda index: (True, False) if index < 4 else (True, True))
        thin = evaluate(pairs(thin_control, thin_treatment)["pairs"],
                        lambda observed: observed["revealTool"] == "rare_tool")
        check("a right skip on four pairs is underpowered", thin["verdict"] == "UNDERPOWERED", thin["verdict"])
        check("it clears the share gate", thin["skippedShare"] == 0.1, thin["skippedShare"])
        check("and its p is one sixteenth", abs(thin["skip"]["p"] - 0.125) < 1e-9, thin["skip"]["p"])

        # Dominated: the same shape of cut, but the material is what wins on the skipped tasks, so skipping them loses
        # and the policy is worse than serving everything.
        bad_control, bad_treatment = grid(
            "bad", 40,
            lambda index: ["find_user_id_by_name_zip", "rare_tool" if index < 20 else "get_order_details"],
            lambda index: (False, True) if index < 20 else (True, True))
        bad = evaluate(pairs(bad_control, bad_treatment)["pairs"],
                       lambda observed: observed["revealTool"] == "rare_tool")
        check("a cut that skips the rescued tasks is dominated", bad["verdict"] == "DOMINATED", bad["verdict"])
        check("its skip half is negative", bad["skip"]["delta"] == -1.0, bad["skip"])
        check("and the policy is worse than serving everything", bad["gainVsServeAll"] < 0, bad["gainVsServeAll"])

        screened = screen(built["pairs"])
        check("the screen runs", screened["state"] in ("SCREEN_CONFIRMED", "SCREEN_NOT_CONFIRMED",
                                                       "NOTHING_ADMISSIBLE"), screened["state"])
        check("it splits the tasks in two", screened["screenTasks"] == 8 and screened["confirmTasks"] == 8,
              (screened["screenTasks"], screened["confirmTasks"]))
        check("it names a chosen cut", isinstance(screened.get("chosen"), str), screened.get("chosen"))
        check("the chosen cut is the separating one", screened.get("chosen", "").endswith("get_product_details"),
              screened.get("chosen"))
        check("and it confirms on the half it never saw", screened["state"] == "SCREEN_CONFIRMED",
              screened["state"])
        check("the confirmation reads the same effect", screened["confirm"]["skip"]["delta"] == 1.0,
              screened["confirm"])
        check("the pooled reading is admissible", screened["pooled"]["verdict"] == "ADMISSIBLE",
              screened["pooled"])
        check("the sentence names the cut", "get_product_details" in render(screened), render(screened)[:90])
        check("and the table has a header", "verdict" in report(screened), report(screened)[:60])

        # The confirmation half has to be able to disagree with the screen, so the shape is run once at a size where
        # both halves clear the pair floor: 48 tasks, half of them damaged, which leaves sixteen pairs a half.
        flipped_control, flipped_treatment = grid(
            "flip", 48,
            lambda index: ["find_user_id_by_name_zip", "get_product_details" if index < 24 else "get_order_details"],
            lambda index: (True, False) if index < 24 else (True, True))
        flipped = screen(pairs(flipped_control, flipped_treatment)["pairs"])
        check("a grid where the damage is everywhere confirms", flipped["state"] == "SCREEN_CONFIRMED",
              flipped["state"])
        check("and its pooled reading is admissible", flipped["pooled"]["verdict"] == "ADMISSIBLE",
              flipped["pooled"])

        # Nothing admissible: the treatment and the control are identical, so no cut can buy anything.
        same = screen(pairs(control, control)["pairs"])
        check("an arm against itself admits nothing", same["state"] == "NOTHING_ADMISSIBLE", same["state"])
        check("and the sentence says the dispatch would buy nothing", "buys nothing" in render(same),
              render(same)[-90:])

        # The refusals.
        disjoint = document("disjoint.json", [simulation("z", 1.0, [])])
        no_pair = pairs(control, disjoint)
        check("two disjoint grids refuse", no_pair["state"] == "NO_PAIRS", no_pair)
        check("and say why", no_pair["reason"] == "no shared task", no_pair)
        check("the refusal is a sentence", "cannot be paired" in render(no_pair), render(no_pair))
        check("and the table refuses too rather than printing a header over nothing",
              report(no_pair) == render(no_pair), report(no_pair))
        uneven = document("uneven.json", control_payload[:58])
        uneven_read = pairs(control, uneven)
        check("an uneven attempt count refuses", uneven_read["state"] == "NO_PAIRS", uneven_read)
        check("and names the reason", uneven_read["reason"] == "uneven attempts", uneven_read)
        empty = document("empty.json", [{"task_id": payload["task_id"], "reward_info": {"reward": 1.0},
                                         "messages": []} for payload in control_payload])
        unreadable = pairs(control, empty)
        check("an unreadable arm refuses rather than skipping", unreadable["state"] == "NO_PAIRS", unreadable)
        check("and counts what it could not read", unreadable["reason"] == "no readable episode", unreadable)
        one_task = pairs(document("one.json", [simulation("t00", 1.0, [])]),
                         document("one-b.json", [simulation("t00", 1.0, [])]))
        check("one task cannot be split", screen(one_task["pairs"])["state"] == "TOO_FEW_TASKS",
              screen(one_task["pairs"]))
        check("and the refusal is a sentence", "cannot be split" in render(screen(one_task["pairs"])))

        # The shapes a reward arrives in, and a document whose episodes are not all dictionaries.
        check("a reward object is read", _verdict({"reward_info": type("I", (), {"reward": 1.0})()}) == 1)
        check("a bool reward is not a pass", _verdict({"reward_info": {"reward": True}}) == 0)
        check("an episode with no reward is not a pass", _verdict({}) == 0)
        mixed_document = document("mixed.json", ["junk", simulation("t00", 1.0, ["find_user_id_by_email"])])
        check("a junk simulation is skipped", pairs(mixed_document, mixed_document)["state"] == "PAIRS_BUILT",
              pairs(mixed_document, mixed_document))

        # Every candidate the generator emits has to be evaluable, and the numeric direction has to point the way its
        # name says: this is the assertion that would have caught the stratum reader comparing a rate with a count.
        generated = candidates(built["pairs"])
        check("the generator emits cuts", len(generated) > 8, len(generated))
        check("every cut evaluates", all(evaluate(built["pairs"], predicate)["servedShare"] is not None
                                         for _, predicate in generated))
        widths = sorted({pair["obs"]["openingChars"] for pair in built["pairs"]})
        top, bottom = widths[-1], widths[0]
        check("the fixture varies the opening turn", top > bottom, widths)
        high = [predicate for name, predicate in generated if name == f"skip openingChars>={top}"][0]
        low = [predicate for name, predicate in generated if name == f"skip openingChars<={bottom}"][0]
        check("a >= cut includes the value it names", high({"openingChars": top}) is True)
        check("a <= cut includes the value it names", low({"openingChars": bottom}) is True)
        check("a >= cut at the top excludes the narrowest turn", high({"openingChars": bottom}) is False)
        check("a <= cut at the bottom excludes the widest", low({"openingChars": top}) is False)

        # The multiplicity column: a screen that yields fewer admissible cuts than noise would is a negative result,
        # and the sentence has to carry the number that makes it one.
        check("the screen reports what noise would yield", screened["expectedByChance"] > 0, screened)
        check("and the sentence says so", "noise alone yields about" in render(screened), render(screened)[:120])

        # The observable report, which is where both free refutations came from.
        lines = observables_report(control)
        check("the report counts the episodes", lines.startswith("64 episode(s)"), lines.splitlines()[0])
        check("it reports the first tool call's share", "find_user_id_by_name_zip" in lines, lines)
        check("and says whether a gate would be a decision", "not a decision" in lines, lines)
        check("an empty document says so", "NO_EPISODES" in observables_report(document("blank.json", [])))
        # Every episode carries the same opening turn inside a task, so the ask count is a task-level quantity and the
        # report has to say so: it is the difference between an admission rule and a serving gate.
        check("a task-constant field is named as one", "constant within 16/16 task(s) (100%)" in lines, lines)
        single = observables_report(document("single.json", [
            simulation("t00", 1.0, ["find_user_id_by_email"]),
            simulation("t01", 1.0, ["find_user_id_by_email"])]))
        check("a grid with no repetition claims nothing about constancy", "constant within" not in single, single)
        check("and still counts its episodes", single.startswith("2 episode(s)"), single.splitlines()[0])
        # The report on a document with junk episodes: a simulation that is not a dictionary and one whose transcript
        # never wrote a message both have to fall out, and the count has to be the readable one rather than the
        # document's length.
        ragged_report = observables_report(document("ragged.json", [
            "junk", {"task_id": "a", "messages": [{"role": "user", "content": "hi"}]},
            {"task_id": "b", "messages": []}]))
        check("the report counts only readable episodes", ragged_report.startswith("1 episode(s)"),
              ragged_report.splitlines()[0])

        # The command line, through `main`, including the modes a dispatch actually calls.
        for arguments, expected in (
            (["--control", control, "--treatment", treatment], "cut(s) on"),
            (["--control", control, "--treatment", treatment, "--observables"], "episode(s) in"),
            (["--control", control, "--treatment", disjoint], "cannot be paired"),
        ):
            buffer = io.StringIO()
            saved, sys.stdout = sys.stdout, buffer
            try:
                code = main(arguments)
            finally:
                sys.stdout = saved
            check(f"the command answers zero for {arguments[-1]}", code == 0, (arguments, code))
            check(f"and prints a sentence for {arguments[-1]}", expected in buffer.getvalue(),
                  buffer.getvalue()[:90])
        out = root / "policy.json"
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            main(["--control", control, "--treatment", treatment, "--out", str(out)])
        finally:
            sys.stdout = saved
        written = json.loads(out.read_text(encoding="utf-8"))
        check("the reading is written where it was asked", written["state"] == "SCREEN_CONFIRMED",
              written.get("state"))
        check("and it carries the pooled verdict", written["pooled"]["verdict"] == "ADMISSIBLE", written.get("pooled"))
        refused = None
        try:
            main(["--control", control])
        except SystemExit as error:
            refused = str(error)
        check("a run with one document is refused by name", refused == "serve-policy-needs-two-documents", refused)
        # The refusal path of the paired mode, through the command line, including the `--out` write: a dispatch that
        # asks for a JSON reading of an unusable grid has to get the refusal on disk rather than an empty file.
        refusal_path = root / "refusal.json"
        buffer = io.StringIO()
        saved, sys.stdout = sys.stdout, buffer
        try:
            code = main(["--control", control, "--treatment", disjoint, "--out", str(refusal_path)])
        finally:
            sys.stdout = saved
        check("an unpaired grid answers zero on the command line", code == 0, code)
        check("and writes its refusal where it was asked",
              json.loads(refusal_path.read_text(encoding="utf-8"))["state"] == "NO_PAIRS", refusal_path)
        refused = None
        try:
            main(["--observables"])
        except SystemExit as error:
            refused = str(error)
        check("the observables mode needs one document", refused == "serve-policy-needs-one-document", refused)

    # The suite's own failure paths, diverted into a buffer: a check whose failing branch has never run cannot fail
    # visibly, and the report has two answers.
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
            print(f"[serve-policy] FAIL {failure}", file=out)
        print(f"[serve-policy] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[serve-policy] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(description="what a serving decision would be worth, priced before it runs")
    parser.add_argument("--control", default="", help="the no-memory arm's results document")
    parser.add_argument("--treatment", default="", help="the treated arm's results document, same grid")
    parser.add_argument("--observables", action="store_true", help="print the prefix observables of --control")
    parser.add_argument("--out", default="", help="write the reading here as JSON")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if arguments.observables:
        if not arguments.control:
            raise SystemExit("serve-policy-needs-one-document")
        print(observables_report(arguments.control))
        return 0
    if not arguments.control or not arguments.treatment:
        raise SystemExit("serve-policy-needs-two-documents")
    built = pairs(arguments.control, arguments.treatment)
    if built["state"] != "PAIRS_BUILT":
        if arguments.out:
            Path(arguments.out).write_text(json.dumps(built, indent=2) + "\n", encoding="utf-8")
        print(render(built))
        return 0
    reading = screen(built["pairs"])
    reading["unreadable"] = built["unreadable"]
    reading["pairs"] = len(built["pairs"])
    reading["label"] = Path(arguments.treatment).stem
    if arguments.out:
        Path(arguments.out).write_text(
            json.dumps({key: value for key, value in reading.items()}, indent=2) + "\n", encoding="utf-8")
    print(report(reading))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
