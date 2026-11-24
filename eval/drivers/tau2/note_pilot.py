#!/usr/bin/env python3
"""R206a's pilot artefact: two phases in, one document out.

The pilot exists because the mechanism is built and nothing has observed it. R206's arm is the one shape this
lane has never run — no store, no facade, no retrieval, one sentence carried from a failed attempt at a task
into the next attempt at *that* task — and the first dispatch that spends 320 simulations on it should not also
be the first time anyone learns whether the handoff happens, whether the summariser writes anything from a
retail failure, or what the material costs in tokens.

So this file reads what the two phases leave behind and writes the document a verifier can grade:

  the two logs        one JSON line per phase, which is where the census, the bill and the model live
  the two results     `results.json` per arm, which is where the rewards live — pass^k is per *task*, and the
                      simulation grid is the only place the trial index and the task id appear together
  the sidecar         the notes file the runner wrote between rounds, whose entries are the treatment

## One task per invocation, and why the reading has to merge

R206a measured the identity this arm was built on and it does not exist: τ² re-samples the opening on every
attempt (exact key reuse 0.006 over 168 same-task pairs) and two retail tasks can share one scenario, so no
threshold on the text can tell a task from its neighbour (`eval/verifiers/opening_stability.py`). R207 moves the
identity to the file — one task per `run_split.py` invocation, one sidecar per task — which means an arm no
longer leaves *one* log and *one* `results.json`: it leaves one of each per task. Every flag below therefore
accepts a comma-separated list (or the flag repeated), and the merge is where three questions are answered:

  * **the grid** — the union of the tasks and every `(task, trial)` exactly once, refused otherwise;
  * **the bill** — summed, with the band kept only when every phase ran in the same one;
  * **specificity** — recomputed over the merged corpus, because it is the one reading that is a property of the
    corpus rather than of a phase. A note whose entities appear in its own task's failure and in no other task's
    is specific; with one task in hand every note is trivially specific (share 1.0), which is why the runners
    report a null and this file computes the number.

Three refusals, each of them a state that would otherwise produce a number about nothing:

  `same-agent`        the two arms ran different agents, so their difference is the wrapper (R93's defect)
  `mixed-model`       the phases of one arm ran different models, so the arm is two experiments
  `control-has-notes` the control's own summary carries a notes block, so the treatment leaked into it
  `no-pair`           the arms share no scoreable task, so there is no paired reading to take

And one rule that is arithmetic rather than policy: a task with fewer than `k` scoreable trials leaves the
`pass^k` denominator. Averaging it as a zero is the biased estimate this lane exists to avoid — the same rule
`packages/eval/src/l4.ts` implements on the TypeScript side and for the same reason.

Usage:
  python3 eval/drivers/tau2/note_pilot.py --control c-5.log,c-9.log --treatment t-5.log,t-9.log \\
    --control-results c-5.json,c-9.json --treatment-results t-5.json,t-9.json \\
    --notes t-5.json.notes,t-9.json.notes --rounds 4 --tasks 5,9 --release v1.0.1 --out /tmp/note-pilot.json
  python3 eval/drivers/tau2/note_pilot.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

from notes import (
    SCHEMA as NOTES_SCHEMA,
    load as load_notes,
    load_trajectories,
    merge_documents,
    merge_sidecars,
    merge_trajectories,
    scope_of,
    specificity,
    trajectories_path,
)

SCHEMA = "microglia.note-pilot/1"

#: Characters per token, the convention every token estimate in this repository uses. The summariser's input is
#: the only quantity the phase's own bill cannot separate from the episodes', because both go through one
#: litellm callback: the census counts the characters and this converts them, so the material's share of the
#: bill is a measurement of the same kind as the arm's.
CHARS_PER_TOKEN = 4.0

#: A pass is a reward of one. τ²'s rewards are in [0, 1] and its evaluator returns one of exactly two values;
#: anything else is a partial score this lane has never seen, and counting it as a pass would inflate every
#: denominator downstream.
PASS_REWARD = 1.0


def number(value) -> float | None:
    """A finite float, or `None`. Booleans are not numbers here, and `True` is not a trial that passed."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def split_paths(values) -> list[str]:
    """Every path a flag named, whether it was repeated or comma-separated.

    R207 runs one task per invocation, so an arm's evidence is a *list* of files and every flag here takes one.
    Both spellings are accepted because the workflow builds a comma list in one line of shell while an operator
    debugging a single task types the flag once; a reader that accepted only one of them would be a reader that
    silently dropped half a fold.
    """
    out: list[str] = []
    for value in values or []:
        for entry in str(value).split(","):
            stripped = entry.strip()
            if stripped and stripped not in out:
                out.append(stripped)
    return out


def last_json_line(text: str) -> dict:
    """The phase's summary line, read from the end of its log.

    From the end because the driver prints its diagnostics before its summary and anything at all after it: a
    log that gained a line would otherwise make this reader take the wrong object, and the failure would be a
    `KeyError` three functions later rather than a sentence about a log.
    """
    for line in reversed(text.splitlines()):
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            document = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(document, dict) and "phase" in document:
            return document
    raise SystemExit("tau2-note-pilot-no-summary")


def _reward_of(entry: dict) -> float | None:
    """The trial's reward, from either shape τ² writes it in."""
    for key in ("reward_info", "reward"):
        block = entry.get(key)
        if isinstance(block, dict):
            value = number(block.get("reward"))
            if value is not None:
                return value
        else:
            value = number(block)
            if value is not None:
                return value
    return None


def trials_of(document: dict) -> list[dict]:
    """Every simulated trial, as `{task, trial, reward}` with `reward` possibly `None`.

    The trial index is explicit when the merger wrote it and inferred from the entry's position otherwise —
    which is not a guess about this repository's own files: `merge_rounds` writes it, and a run at
    `--trials k` lets τ² write `trial` itself. A document with neither is one entry per task per position, and
    inferring is what every reader of these files has always done.
    """
    entries = document.get("simulations")
    if entries is None:
        entries = document.get("simulation_index")
    if not isinstance(entries, list):
        raise SystemExit("tau2-note-pilot-no-simulations")
    seen: dict[str, int] = {}
    out: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise SystemExit("tau2-note-pilot-bad-entry")
        task = entry.get("task_id")
        if not isinstance(task, (str, int)) or str(task) == "":
            raise SystemExit("tau2-note-pilot-bad-entry")
        task = str(task)
        explicit = entry.get("trial")
        trial = int(explicit) if isinstance(explicit, int) and not isinstance(explicit, bool) else seen.get(task, 0)
        seen[task] = max(seen.get(task, 0), trial + 1)
        reward = _reward_of(entry)
        if reward is not None and not (0.0 <= reward <= 1.0):
            raise SystemExit(f"tau2-note-pilot-bad-reward:{task}")
        out.append({"task": task, "trial": trial, "reward": reward})
    return out


def half_width(passes: int, total: int) -> float | None:
    """1.96·sqrt(p(1−p)/n) in absolute units, the interval `arm-rate.ts` uses for the same quantity."""
    if total <= 0:
        return None
    p = passes / total
    return 1.96 * math.sqrt(p * (1.0 - p) / total)


def score_arm(document: dict, k: int) -> dict:
    """One arm's pass^k, its episode rate, and the two lists of tasks that leave either denominator.

    The order of the tasks is the order they first appear, so two arms' rows line up and a report that prints
    them is diffable between folds.
    """
    rows: dict[str, list[float | None]] = {}
    for trial in trials_of(document):
        rows.setdefault(trial["task"], []).append(trial["reward"])

    per_task: list[dict] = []
    unscored: list[str] = []
    short: list[str] = []
    long: list[str] = []
    for task, rewards in rows.items():
        if any(reward is None for reward in rewards):
            unscored.append(task)
            continue
        if len(rewards) < k:
            short.append(task)
            continue
        if len(rewards) > k:
            long.append(task)
            continue
        passed = all((reward or 0.0) >= PASS_REWARD for reward in rewards)
        per_task.append(
            {
                "id": task,
                "rewards": [round(float(reward or 0.0), 6) for reward in rewards],
                "successes": sum(1 for reward in rewards if (reward or 0.0) >= PASS_REWARD),
                "pass": passed,
            }
        )

    tasks = len(per_task)
    episodes = sum(len(row["rewards"]) for row in per_task)
    successes = sum(row["successes"] for row in per_task)
    held = sum(1 for row in per_task if row["pass"])
    return {
        "k": k,
        "tasks": tasks,
        "episodes": episodes,
        "successes": successes,
        "rate": (successes / episodes) if episodes else None,
        "rateHalfWidthPp": (round(half_width(successes, episodes) * 100, 2) if episodes else None),
        "passK": (held / tasks) if tasks else None,
        "passKHalfWidthPp": (round(half_width(held, tasks) * 100, 2) if tasks else None),
        "held": held,
        # Named rather than counted: a fold whose short list is non-empty is a fold whose `pass^k` is about
        # fewer tasks than its title says, and the reader has to be able to see which ones.
        "unscored": unscored,
        "short": short,
        "long": long,
        "perTask": per_task,
        "episodesAll": len(trials_of(document)),
    }


def is_peak(moment, card: dict) -> bool:
    """Whether the provider's peak band covers `moment`, read from the rate card rather than restated here.

    The card is the one place the windows are written (`eval/manifests/model-rates.json`), and this function exists
    because the workflow has to ask *before* it spends: the same tokens cost exactly twice inside a peak band, and
    a pilot that starts two minutes before one opens pays double for most of its model time.
    """
    windows = card.get("peakWindows") if isinstance(card, dict) else None
    if not isinstance(windows, list) or not windows:
        raise SystemExit("tau2-note-pilot-no-windows")
    if card.get("peakWeekdaysOnly", True) and moment.weekday() >= 5:
        return False
    return any(int(window["fromHourUtc"]) <= moment.hour < int(window["toHourUtc"]) for window in windows)


def fits_window(now, minutes: float, card: dict, step: float = 1.0) -> tuple[bool, str]:
    """Whether a run starting at `now` and lasting `minutes` stays out of every peak band.

    Minute-stepped rather than compared at the endpoints, because the answer is about *the whole run*: R58's
    evaluation crossed 06:00 UTC and priced ninety-three minutes at the closing band, and a guard that only checked
    the start would have called that run cheap. The step is a parameter so the self-test can drive a coarse clock;
    the workflow uses the default.
    """
    from datetime import timedelta

    def refusal(moment) -> tuple[bool, str]:
        return (
            False,
            f"tau2-pilot-peak-window: the run would be inside {moment.strftime('%a %H:%M')} UTC, where the "
            "same tokens cost exactly twice the off-peak rate",
        )

    # The start is checked on its own, because a run of zero minutes is still a run whose first call is billed at
    # the band its start falls in. The end is *exclusive*: a run that finishes exactly as a band opens made every
    # one of its calls before it, and refusing that would be refusing a run that is cheap.
    if is_peak(now, card):
        return refusal(now)
    end = now + timedelta(minutes=minutes)
    moment = now + timedelta(minutes=step)
    while moment < end:
        if is_peak(moment, card):
            return refusal(moment)
        moment += timedelta(minutes=step)
    return (True, "")


def _scope_tasks(notes: dict) -> list[str]:
    """The tasks a notes block's sidecars declared, from either a merged log or a single one.

    Two shapes, one answer. A merged log carries `tasks` because the merge is the only place that saw them all; a
    single invocation's log carries the `scope` block `run_split.py` wrote, and reading only the first shape would
    make an unmerged fold look unmeasured.
    """
    listed = notes.get("tasks")
    if isinstance(listed, list):
        return [str(task) for task in listed if str(task) != ""]
    scope = notes.get("scope") if isinstance(notes.get("scope"), dict) else {}
    task = scope.get("task")
    if scope.get("kind") == "task" and isinstance(task, str) and task.strip() != "":
        return [task.strip()]
    return []


def material_of(summary: dict) -> dict | None:
    """The treatment's material, or `None` when the phase has no notes block at all.

    `None` rather than an empty dict: a control arm has no material, and a control that reported
    `written: 0, hits: 0` would be indistinguishable from a treatment whose sidecar was never read — the
    distinction N1 exists to make.
    """
    notes = summary.get("notes")
    if not isinstance(notes, dict):
        return None
    rounds = notes.get("rounds")
    rounds = [entry for entry in rounds if isinstance(entry, dict)] if isinstance(rounds, list) else []
    # Coverage is over the rounds *after* the first, because a note written at the end of round one is read
    # starting in round two: a fold that averaged in the first round's failures would report a coverage no
    # reader could reproduce from the mechanism.
    later = [entry for entry in rounds if number(entry.get("round")) not in (None, 1.0)]
    failed = sum(int(number(entry.get("failed")) or 0) for entry in later)
    written = sum(int(number(entry.get("written")) or 0) for entry in later)
    memory = summary.get("diagnostics", {}).get("memory") if isinstance(summary.get("diagnostics"), dict) else None
    own = memory.get("notes") if isinstance(memory, dict) and isinstance(memory.get("notes"), dict) else {}
    return {
        "path": notes.get("path"),
        "rounds": rounds,
        "written": written,
        "failed": failed,
        "coverage": (written / failed) if failed else None,
        "refused": sum(int(number(entry.get("refused")) or 0) for entry in later),
        "providerFailures": sum(int(number(entry.get("providerFailures")) or 0) for entry in later),
        "unreadable": sum(int(number(entry.get("unreadable")) or 0) for entry in later),
        "unscored": sum(int(number(entry.get("unscored")) or 0) for entry in later),
        "collisions": int(number(notes.get("collisions")) or 0),
        # R207. Which task each invocation's sidecar declared. The gate is that there is exactly one per task and
        # that none of them is ambiguous: a sidecar naming zero tasks or several is a mis-scoped file, and a
        # treatment whose files are mis-scoped is R206's defect wearing this arm's clothes. A merged log lists
        # them; a single one carries its own `scope`, and both shapes answer the same question.
        "scopeTasks": _scope_tasks(notes),
        "scopeProblems": [str(problem) for problem in (notes.get("scopeProblems") or [])],
        "specificity": notes.get("specificity"),
        # The agent's own counters, which say whether the file was asked for and found rather than whether it
        # was written: a treatment whose `hits` is zero is a file nobody read. `keyHits` and `taskHits` say which
        # identity produced the note — the opening text or the file's scope — because only the second is R207's.
        "lookups": int(number(own.get("lookups")) or 0),
        "hits": int(number(own.get("hits")) or 0),
        "keyHits": int(number(own.get("keyHits")) or 0),
        "taskHits": int(number(own.get("taskHits")) or 0),
        "problem": own.get("problem"),
        "promptChars": sum(int(number(entry.get("promptChars")) or 0) for entry in rounds),
        "noteChars": sum(int(number(entry.get("noteChars")) or 0) for entry in rounds),
        "materialTokens": round(sum(int(number(entry.get("promptChars")) or 0) for entry in rounds) / CHARS_PER_TOKEN),
        # R208. Whether the sentences were written from the attempt alone or from the attempt and the evaluator's
        # verdict, and how much of the corpus the evaluator explained. A reading is only comparable to another
        # when it states this, and the characters are the part of the material's cost that is not a sentence.
        "verdict": bool(notes.get("verdict")),
        "verdicts": int(number(notes.get("verdicts")) or 0),
        "verdictChars": int(number(notes.get("verdictChars")) or 0),
    }


def bill_of(summary: dict) -> dict:
    """One arm's usage, with the band and the price the driver already computed rather than a second table."""
    usage = summary.get("usage") if isinstance(summary.get("usage"), dict) else {}
    cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
    return {
        "calls": int(number(usage.get("calls")) or 0),
        "promptTokens": int(number(usage.get("prompt_tokens")) or 0),
        "completionTokens": int(number(usage.get("completion_tokens")) or 0),
        "cachedTokens": int(number(usage.get("cached_tokens")) or 0),
        "usd": number(cost.get("usd")),
        "band": cost.get("band"),
    }


def merge_notes_blocks(blocks) -> dict | None:
    """One arm's material census out of one per-task block each, or `None` when none of them had one.

    Coverage adds because every term of it adds: `written` and `failed` are counts over rounds, and the rounds of
    six tasks are six independent schedules. `tasks` is the list of scopes rather than a count, because the gate
    that reads it has to name the file that was mis-scoped, and `specificity` is deliberately null — a share
    computed per invocation is a share over one task, and `note_pilot.build` computes the real one from the
    sidecars once the corpus is in hand.
    """
    blocks = [block for block in blocks or [] if isinstance(block, dict) and block]
    if not blocks:
        return None
    rounds: list = []
    tasks: list = []
    problems: list = []
    shown = 0
    for block in blocks:
        path = block.get("path")
        for entry in block.get("rounds") or []:
            if isinstance(entry, dict):
                rounds.append({**entry, "sidecar": path})
        # R208. A block with no `verdict` key is a phase that ran before the material existed, which is the same
        # fact as `false`: the summariser was shown the attempt and nothing else.
        shown += 1 if block.get("verdict") else 0
        scope = block.get("scope") if isinstance(block.get("scope"), dict) else {"kind": "none"}
        task = scope.get("task")
        if scope.get("kind") == "task" and isinstance(task, str) and task.strip() != "":
            if task.strip() not in tasks:
                tasks.append(task.strip())
        else:
            problems.append(f"{path}: scope is {scope.get('kind')!r}")
    # Refused rather than summed, for `merge_summaries`' reason one level down: the material is the arm, and a
    # corpus half of whose notes were written from a verdict is a corpus that measured two things. The counts are
    # in the code so the message says how badly the fold was mixed without a second read of the logs.
    if 0 < shown < len(blocks):
        raise SystemExit(f"tau2-note-pilot-mixed-verdict:{shown}:{len(blocks) - shown}")
    return {
        "path": [block.get("path") for block in blocks],
        "rounds": rounds,
        "tasks": tasks,
        "scopeProblems": problems,
        "collisions": sum(int(number(block.get("collisions")) or 0) for block in blocks),
        "attempts": sum(int(number(block.get("attempts")) or 0) for block in blocks),
        # The arm's own statement about its material, and the two sums that make the verdict block's cost visible
        # beside the sentences it produced.
        "verdict": shown == len(blocks),
        "verdicts": sum(int(number(block.get("verdicts")) or 0) for block in blocks),
        "verdictChars": sum(int(number(block.get("verdictChars")) or 0) for block in blocks),
        "specificity": None,
    }


def merge_summaries(summaries, *, side: str) -> dict:
    """One phase out of one log per task: the agent, the models, the bill and the census.

    Refuses a fold whose phases disagree about the agent or the model. Both are properties of the *arm* and not of
    the task, so a difference between two of them is a run that measured two things — the defect R93's control
    gate exists for, one level down, and the reason the band is reported as `mixed` rather than as the first
    phase's.
    """
    summaries = [summary for summary in summaries or [] if isinstance(summary, dict)]
    if not summaries:
        raise SystemExit(f"tau2-note-pilot-no-{side}")
    first = summaries[0]
    for other in summaries[1:]:
        for field in ("agent", "model", "judge", "thinking"):
            if other.get(field) != first.get(field):
                raise SystemExit(f"tau2-note-pilot-mixed-{field}:{first.get(field)}:{other.get(field)}")

    calls = prompt = completion = cached = 0
    usd = 0.0
    bands = set()
    for summary in summaries:
        usage = summary.get("usage") if isinstance(summary.get("usage"), dict) else {}
        calls += int(number(usage.get("calls")) or 0)
        prompt += int(number(usage.get("prompt_tokens")) or 0)
        completion += int(number(usage.get("completion_tokens")) or 0)
        cached += int(number(usage.get("cached_tokens")) or 0)
        cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
        usd += number(cost.get("usd")) or 0.0
        if cost.get("band") is not None:
            bands.add(cost.get("band"))

    own = None
    for summary in summaries:
        diagnostics = summary.get("diagnostics") if isinstance(summary.get("diagnostics"), dict) else {}
        notes = (diagnostics.get("memory") or {}).get("notes") if isinstance(diagnostics.get("memory"), dict) else None
        if not isinstance(notes, dict):
            continue
        own = own or {"lookups": 0, "hits": 0, "keyHits": 0, "taskHits": 0, "chars": 0, "problem": None}
        for field in ("lookups", "hits", "keyHits", "taskHits", "chars"):
            own[field] += int(number(notes.get(field)) or 0)
        if own["problem"] is None and notes.get("problem") is not None:
            own["problem"] = notes.get("problem")

    merged = {
        "phase": first.get("phase"),
        "agent": first.get("agent"),
        "model": first.get("model"),
        "judge": first.get("judge"),
        "thinking": first.get("thinking"),
        "usage": {
            "calls": calls,
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "cached_tokens": cached,
            "cost": {"usd": round(usd, 4), "band": bands.pop() if len(bands) == 1 else ("mixed" if bands else None)},
        },
        "diagnostics": {**({"memory": {"notes": own}} if own is not None else {})},
    }
    notes = merge_notes_blocks([summary.get("notes") for summary in summaries])
    if notes is not None:
        merged["notes"] = notes
    return merged


def _paired(control: dict, treatment: dict, key: str, passed_of) -> dict:
    """The paired difference on one level — tasks or episodes — with its own interval.

    Paired, because the two arms ran the same tasks at the same seeds: an unpaired interval over six tasks
    would be four times as wide as the data supports, and the whole reason the phase is scheduled in rounds is
    that the two arms can be handed the same seeds. The interval is Wald's on the difference of two paired
    proportions, whose variance is carried by the *discordant* pairs alone — the tasks both arms passed say
    nothing about which arm is better.
    """
    left = {row["id"]: passed_of(row) for row in control.get(key) or []}
    right = {row["id"]: passed_of(row) for row in treatment.get(key) or []}
    shared = [task for task in left if task in right]
    b = sum(1 for task in shared if right[task] and not left[task])
    c = sum(1 for task in shared if left[task] and not right[task])
    n = len(shared)
    if n == 0:
        return {"paired": 0, "deltaPp": None, "intervalPp": None, "treatmentOnly": 0, "controlOnly": 0}
    delta = (b - c) / n
    variance = max(0.0, (b + c) - (b - c) ** 2 / n) / (n * n)
    half = 1.96 * math.sqrt(variance)
    return {
        "paired": n,
        "deltaPp": round(delta * 100, 2),
        "intervalPp": [round((delta - half) * 100, 2), round((delta + half) * 100, 2)],
        "treatmentOnly": b,
        "controlOnly": c,
    }


def pair_of(control: dict, treatment: dict) -> dict:
    """The two paired readings: the headline's level (a task held all k) and the measurement's (an episode)."""
    by_task = _paired(control, treatment, "perTask", lambda row: bool(row.get("pass")))
    episodes: dict[str, list[bool]] = {}
    for arm, side in ((control, "control"), (treatment, "treatment")):
        for row in arm.get("perTask") or []:
            for index, reward in enumerate(row.get("rewards") or []):
                episodes.setdefault(f"{row['id']}/{index}", []).append((side, (number(reward) or 0.0) >= PASS_REWARD))
    joined = []
    for key, entries in episodes.items():
        sides = dict(entries)
        if "control" in sides and "treatment" in sides:
            joined.append({"id": key, "control": sides["control"], "treatment": sides["treatment"]})
    by_episode = _paired(
        {"perTask": [{"id": row["id"], "pass": row["control"]} for row in joined]},
        {"perTask": [{"id": row["id"], "pass": row["treatment"]} for row in joined]},
        "perTask",
        lambda row: bool(row.get("pass")),
    )
    return {"passK": by_task, "episode": by_episode}


def build(
    *,
    control_summary: dict,
    treatment_summary: dict,
    control_results: dict,
    treatment_results: dict,
    configuration: dict,
    claim: str = "none",
    claim_reason: str = "",
    specificity_measurement: dict | None = None,
) -> dict:
    """The pilot's document. Refuses the states that would make its comparison about something else."""
    control_agent = control_summary.get("agent")
    treatment_agent = treatment_summary.get("agent")
    if control_agent != treatment_agent:
        raise SystemExit(f"tau2-note-pilot-same-agent:{control_agent}:{treatment_agent}")
    if control_summary.get("notes") is not None:
        raise SystemExit("tau2-note-pilot-control-has-notes")
    material = material_of(treatment_summary)
    if material is None:
        raise SystemExit("tau2-note-pilot-no-material")
    k = int(number(configuration.get("rounds")) or 1)
    control = score_arm(control_results, k)
    treatment = score_arm(treatment_results, k)
    comparison = pair_of(control, treatment)
    if comparison["passK"]["paired"] == 0:
        raise SystemExit("tau2-note-pilot-no-pair")
    if specificity_measurement is not None:
        # Over the merged corpus, which is the only level at which the question has an answer. The per-invocation
        # number is a null by construction (`notes.specificity`), and substituting it here would be publishing
        # 1.0 for a corpus of one.
        material = {**material, "specificity": specificity_measurement}
    return {
        "schema": SCHEMA,
        "registered": "R206",
        "pilot": True,
        # A pilot makes no claim, and it says so in the artefact rather than in a paragraph beside it: every
        # reader downstream — this file's verifier, a later readback, a chart — asks this field first.
        "claim": claim,
        "claimReason": claim_reason,
        "configuration": configuration,
        "arms": {
            "control": {**control, **bill_of(control_summary)},
            "treatment": {**treatment, **bill_of(treatment_summary)},
        },
        "notes": material,
        "comparison": comparison,
        "bill": {
            "controlUsd": bill_of(control_summary)["usd"],
            "treatmentUsd": bill_of(treatment_summary)["usd"],
            "materialTokens": material["materialTokens"],
            "materialShareOfTreatmentPrompt": round(
                material["materialTokens"] / max(1, bill_of(treatment_summary)["promptTokens"]), 6
            ),
        },
        "models": {
            "model": treatment_summary.get("model"),
            "judge": treatment_summary.get("judge"),
            "thinking": treatment_summary.get("thinking"),
        },
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="assemble R206a's pilot artefact from two phases")
    # Each of these takes a comma list (or the flag repeated), because R207 runs one task per invocation and an
    # arm is therefore several phases. A single path is the same list of length one, so the pilot's own grid and
    # the fold's are read by one code path rather than two.
    parser.add_argument("--control", action="append", default=[], help="the control phase's log(s), or `-`")
    parser.add_argument("--treatment", action="append", default=[], help="the treatment phase's log(s)")
    parser.add_argument("--control-results", action="append", default=[], help="the control arm's results.json(s)")
    parser.add_argument("--treatment-results", action="append", default=[], help="the treatment arm's results.json(s)")
    parser.add_argument("--notes", action="append", default=[],
                        help="the treatment's sidecar(s), from which specificity is recomputed over the corpus")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--rounds", type=int, default=4)
    parser.add_argument("--seeds", default="")
    parser.add_argument("--release", default="v1.0.1")
    parser.add_argument("--claim-reason", default="a pilot resolves nothing: the fold's own sample is the claim")
    parser.add_argument("--out", default="")
    parser.add_argument("--fixtures", help="write a synthetic pair of phases into this directory and stop")
    parser.add_argument("--window-minutes", type=float, default=None,
                        help="refuse unless this many minutes of model time fit in the off-peak window")
    parser.add_argument("--rate-card", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if arguments.window_minutes is not None:
        # Before the first call, and in the same process that would have made it: a guard that runs after the
        # installation is a guard that reports on eight minutes already spent, which is still cheap but is the
        # wrong order.
        from datetime import datetime, timezone
        from pathlib import Path

        card_path = arguments.rate_card or str(
            Path(__file__).resolve().parents[2] / "manifests" / "model-rates.json"
        )
        with open(card_path, encoding="utf-8") as stream:
            card = json.load(stream)
        now = datetime.now(timezone.utc)
        fits, reason = fits_window(now, arguments.window_minutes, card)
        print(
            f"[note-pilot] {arguments.window_minutes:.0f} min from {now.strftime('%a %H:%M')} UTC: "
            f"{'fits' if fits else 'refused'}",
            file=sys.stderr,
        )
        if not fits:
            print(reason, file=sys.stderr)
            return 3
        return 0
    if arguments.fixtures:
        # Printed rather than assumed: the workflow's free half reads these four paths from here, so a rename
        # is a failure in one place instead of a shell script that silently ran the builder on nothing.
        print(json.dumps(write_fixtures(arguments.fixtures, rounds=arguments.rounds or 4)))
        return 0
    control_logs = split_paths(arguments.control)
    treatment_logs = split_paths(arguments.treatment)
    control_results = split_paths(arguments.control_results)
    treatment_results = split_paths(arguments.treatment_results)
    if not (control_logs and treatment_logs and control_results and treatment_results):
        parser.error("both logs and both results files are required")
    if not arguments.out:
        parser.error("--out is required: a pilot with nowhere to write is a run that produced no artefact")

    def read(path: str) -> str:
        if path == "-":
            return sys.stdin.read()
        with open(path, encoding="utf-8") as stream:
            return stream.read()

    def load(path: str) -> dict:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
        if not isinstance(document, dict):
            raise SystemExit(f"tau2-note-pilot-bad-document:{path}")
        return document

    control_summary = merge_summaries([last_json_line(read(path)) for path in control_logs], side="control")
    treatment_summary = merge_summaries([last_json_line(read(path)) for path in treatment_logs], side="treatment")
    # The sidecars and the failed attempts beside them. Both are lists because an arm's evidence is per task; a
    # fold with no sidecar is `no-material`, and one whose attempts are unreadable is a specificity that says so
    # rather than a share over nothing.
    sidecars, attempts, sidecar_problems = [], [], []
    for path in split_paths(arguments.notes):
        document, problem = load_notes(path)
        if problem is not None:
            sidecar_problems.append(f"{path}: {problem}")
        sidecars.append(document)
        loaded, attempt_problem = load_trajectories(trajectories_path(path))
        if attempt_problem is not None:
            sidecar_problems.append(f"{trajectories_path(path)}: {attempt_problem}")
        attempts.append(loaded)
    specificity_measurement = None
    if sidecars:
        corpus, shared_keys = merge_trajectories(attempts)
        measurement = specificity(merge_sidecars(sidecars), corpus)
        specificity_measurement = {**measurement, "sharedKeyPairs": shared_keys, "problems": sidecar_problems}
    configuration = {
        "domain": arguments.domain,
        "tasks": [entry for entry in arguments.tasks.split(",") if entry],
        "rounds": arguments.rounds,
        "seeds": [int(entry) for entry in arguments.seeds.split(",") if entry.strip()],
        "release": arguments.release,
        "agent": treatment_summary.get("agent"),
        # The treatment names its material and the control does not; both are recorded, because "the control
        # had no sidecar" is a fact about the comparison and not an absence in the file.
        "material": "notes",
        "controlMaterial": None,
        # R207: how many invocations the arm was split into. One per task, and the gate that reads the scopes
        # compares this against the number of sidecars that named a task.
        "invocations": len(treatment_logs),
    }
    document = build(
        control_summary=control_summary,
        treatment_summary=treatment_summary,
        control_results=merge_documents([load(path) for path in control_results]),
        treatment_results=merge_documents([load(path) for path in treatment_results]),
        configuration=configuration,
        claim_reason=arguments.claim_reason,
        specificity_measurement=specificity_measurement,
    )
    with open(arguments.out, "w", encoding="utf-8") as stream:
        json.dump(document, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(
        f"[note-pilot] control pass^{arguments.rounds} "
        f"{(document['arms']['control']['passK'] or 0) * 100:.1f}% / treatment "
        f"{(document['arms']['treatment']['passK'] or 0) * 100:.1f}% — "
        f"delta {document['comparison']['passK']['deltaPp']} pp, "
        f"coverage {(document['notes']['coverage'] or 0) * 100:.1f}%, "
        f"hits {document['notes']['hits']} (key {document['notes']['keyHits']}, "
        f"task {document['notes']['taskHits']}), "
        f"scopes {len(document['notes']['scopeTasks'])}",
        file=sys.stderr,
    )
    return 0


# ----------------------------------------------------------------------------- self-test


def _results(rows: list[tuple[str, bool]], k: int = 4, unscored: tuple[str, ...] = ()) -> dict:
    """A `results.json` of the shape τ² writes: one entry per (task, trial), reward in `reward_info`."""
    simulations = []
    for task, passes in rows:
        for trial in range(k):
            reward = None if task in unscored else (1.0 if passes else 0.0)
            simulations.append({"task_id": task, "trial": trial, "reward_info": {"reward": reward}})
    return {"tasks": [{"id": task} for task, _ in rows], "simulations": simulations}


def _summary(*, agent: str = "microglia_agent", notes: dict | None = None, calls: int = 100, prompt: int = 1_000_000,
             usd: float = 1.0, hits: int = 0, lookups: int = 0, problem: str | None = None,
             key_hits: int = 0, task_hits: int | None = None, band: str = "off_peak") -> dict:
    """One phase's summary line, with the agent's own note counters when it had any.

    `keyHits` and `taskHits` are set so that they add up to `hits`, because that is the invariant the real agent
    maintains (`note_for` increments exactly one of them per hit) and a fixture where they did not would test a
    reader against a document no run can produce.
    """
    diagnostics: dict = {"usage": {}}
    if hits or lookups or problem:
        diagnostics["memory"] = {
            "notes": {
                "lookups": lookups,
                "hits": hits,
                "keyHits": key_hits,
                "taskHits": (hits - key_hits) if task_hits is None else task_hits,
                "chars": 0,
                "problem": problem,
            }
        }
    return {
        "phase": "eval",
        "agent": agent,
        "model": "deepseek/deepseek-flash",
        "judge": "deepseek/deepseek-chat",
        "thinking": "disabled",
        "usage": {
            "calls": calls,
            "prompt_tokens": prompt,
            "completion_tokens": 2_000,
            "cached_tokens": 0,
            "cost": {"usd": usd, "band": band},
        },
        "diagnostics": diagnostics,
        **({} if notes is None else {"notes": notes}),
    }


def _notes(rounds: list[tuple[int, int, int]], *, collisions: int = 0, specificity: dict | None = None,
           task: str = "1", scope: dict | None = None, verdict: bool = False, verdicts: int = 0,
           verdict_chars: int = 0) -> dict:
    """A notes block of the shape `run_split.py` prints: `(round, failed, written)` per round.

    One task's block, because one invocation writes one. The scope is the block's own — `{kind: task, task: T}` —
    and the merged shape is built by `merge_notes_blocks`, which is what the fold's log looks like.
    """
    entries = [
        {
            "round": index,
            "episodes": 6,
            "failed": failed,
            "written": written,
            "refused": 0,
            "providerFailures": 0,
            "unscored": 0,
            "unreadable": 0,
            "promptChars": 4_000,
            "noteChars": 100,
        }
        for index, failed, written in rounds
    ]
    return {
        "path": f"/tmp/notes-{task}.json",
        "rounds": entries,
        "written": sum(entry["written"] for entry in entries),
        "refused": 0,
        "providerFailures": 0,
        "collisions": collisions,
        "scope": scope if scope is not None else {"kind": "task", "task": task},
        "attempts": 1,
        # R208. The material the sentences were written from, and how much of the corpus the evaluator explained.
        "verdict": verdict,
        "verdicts": verdicts,
        "verdictChars": verdict_chars,
        "specificity": specificity if specificity is not None else {"graded": 1, "specific": 1, "share": None},
    }


#: The token each fixture task's failure contains and no other task's does. Long enough to survive
#: `notes.entities`' four-character floor, which is the whole reason it is spelled out rather than counted.
FIXTURE_ENTITY = "ORDER{}000"


def write_fixtures(directory: str, *, rounds: int = 4, tasks: int = 6) -> dict:
    """A synthetic pair of phases, in the shape the two commands read: one file per task, per arm.

    It exists for the free half of `.github/workflows/note-pilot.yml`: the paid job runs two commands per task and
    then one builder over all of them, and a push that breaks the CSV of `--tasks`, the per-task path convention or
    the merge should fail on a fixture rather than on a dispatch that has already bought 48 simulations. The
    fixture is *not* a result — nothing here is written under `eval/results/`, and the artefact it produces is
    graded as a pilot the way a real one would be, which is the point: the grading path is what is under test.

    Every sidecar declares its own task and every attempt names an entity that appears in no other task's, so the
    artefact's specificity is a real share (1.0) rather than the null a corpus of one produces. A fixture whose
    notes were indistinguishable would let a broken recomputation pass.
    """
    os.makedirs(directory, exist_ok=True)
    total = max(1, tasks)
    ids = [str(index + 1) for index in range(total)]
    control_rows = {task: index < total // 2 for index, task in enumerate(ids)}
    treatment_rows = {task: index < total // 2 + 1 for index, task in enumerate(ids)}
    later = [(index + 1, 4, 4) for index in range(rounds - 1)]
    paths: dict = {"control": [], "treatment": [], "controlResults": [], "treatmentResults": [], "notes": []}
    for index, task in enumerate(ids):
        control_log = os.path.join(directory, f"control-{task}.log")
        treatment_log = os.path.join(directory, f"treatment-{task}.log")
        control_results = os.path.join(directory, f"control-{task}.json")
        treatment_results = os.path.join(directory, f"treatment-{task}.json")
        sidecar = os.path.join(directory, f"notes-{task}.json")
        entity = FIXTURE_ENTITY.format(index + 1)
        with open(control_log, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(_summary(calls=100, prompt=1_000_000, usd=1.0 / total)) + "\n")
        with open(treatment_log, "w", encoding="utf-8") as stream:
            stream.write(
                json.dumps(
                    _summary(
                        notes=_notes(later, task=task),
                        hits=rounds,
                        lookups=rounds + 1,
                        calls=120,
                        prompt=1_100_000,
                        usd=1.2 / total,
                    )
                )
                + "\n"
            )
        with open(control_results, "w", encoding="utf-8") as stream:
            json.dump(_results([(task, control_rows[task])], k=rounds), stream)
        with open(treatment_results, "w", encoding="utf-8") as stream:
            json.dump(_results([(task, treatment_rows[task])], k=rounds), stream)
        # The sidecar and the attempt it was distilled from: one entry, keyed by the attempt's opening text, and
        # the token that makes it specific to this task.
        with open(sidecar, "w", encoding="utf-8") as stream:
            json.dump(
                {
                    "schema": NOTES_SCHEMA,
                    "notes": {
                        f"USER: please fix order {entity} today": {
                            "note": f"Confirm {entity} is handled before promising anything.",
                            "attempt": 1,
                            "reward": 0.0,
                            "task": task,
                            "chars": 52,
                        }
                    },
                    "collisions": {},
                    "scope": {"kind": "task", "task": task},
                },
                stream,
            )
        with open(trajectories_path(sidecar), "w", encoding="utf-8") as stream:
            json.dump(
                {
                    "schema": "microglia.notes-trajectories/1",
                    "trajectories": {f"USER: please fix order {entity} today": f"USER: please fix order {entity} today"},
                },
                stream,
            )
        paths["control"].append(control_log)
        paths["treatment"].append(treatment_log)
        paths["controlResults"].append(control_results)
        paths["treatmentResults"].append(treatment_results)
        paths["notes"].append(sidecar)
    paths["out"] = os.path.join(directory, "note-pilot.json")
    # Comma strings rather than arrays: the workflow passes them straight back as one flag each, which is the
    # spelling an operator uses too.
    return {key: (",".join(value) if isinstance(value, list) else value) for key, value in paths.items()}


CASES: list[tuple[str, dict, str]] = []


def self_test() -> int:
    failures = 0
    checks = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failures, checks
        checks += 1
        if ok:
            print(f"PASS  {name}")
        else:
            failures += 1
            print(f"FAIL  {name}{'' if not detail else f'  ({detail})'}")

    # --- the log reader -------------------------------------------------------------------------------

    log = "noise\n{\"phase\": \"eval\"}\nmore noise\n"
    check("summary read from the end of a log", last_json_line(log) == {"phase": "eval"})
    check(
        "a json line that is not a summary is skipped",
        last_json_line('{"note": 1}\n{"phase": "eval", "tasks": 6}')["tasks"] == 6,
    )
    raised = False
    try:
        last_json_line("nothing here\n")
    except SystemExit as error:
        raised = str(error) == "tau2-note-pilot-no-summary"
    check("a log with no summary refuses", raised)
    raised = False
    try:
        last_json_line("{ not json")
    except SystemExit as error:
        raised = str(error) == "tau2-note-pilot-no-summary"
    check("an unparseable last line is not a summary", raised)

    # --- the trials -----------------------------------------------------------------------------------

    document = _results([("1", True), ("2", False)], k=2)
    trials = trials_of(document)
    check("every entry is a trial", len(trials) == 4, str(len(trials)))
    check("the task id survives as a string", {trial["task"] for trial in trials} == {"1", "2"})
    check("the explicit trial index is used", sorted(trial["trial"] for trial in trials) == [0, 0, 1, 1])
    inferred = {"simulations": [{"task_id": "1", "reward_info": {"reward": 1.0}}] * 3}
    check("a missing index is inferred", [trial["trial"] for trial in trials_of(inferred)] == [0, 1, 2])
    check("a reward is a number", trials[0]["reward"] == 1.0)
    check(
        "an unscored trial stays None rather than becoming zero",
        trials_of(_results([("1", True)], k=1, unscored=("1",)))[0]["reward"] is None,
    )
    check(
        "a bare `reward` key is read too",
        trials_of({"simulations": [{"task_id": "1", "reward": {"reward": 0.0}}]})[0]["reward"] == 0.0,
    )
    for name, broken, code in (
        ("a document with no grid refuses", {"tasks": []}, "tau2-note-pilot-no-simulations"),
        ("an entry without a task refuses", {"simulations": [{"trial": 0}]}, "tau2-note-pilot-bad-entry"),
        ("a reward outside [0, 1] refuses", {"simulations": [{"task_id": "1", "reward_info": {"reward": 2.0}}]},
         "tau2-note-pilot-bad-reward:1"),
    ):
        raised = False
        try:
            trials_of(broken)
        except SystemExit as error:
            raised = str(error) == code
        check(name, raised)

    # --- pass^k, and the two denominators it refuses ---------------------------------------------------

    arm = score_arm(_results([("1", True), ("2", False), ("3", True)]), 4)
    check("three tasks are scored", arm["tasks"] == 3, str(arm["tasks"]))
    check("twelve episodes are scored", arm["episodes"] == 12, str(arm["episodes"]))
    check("pass^4 counts the tasks that held all four", arm["held"] == 2, str(arm["held"]))
    check("pass^4 is a share of tasks", abs((arm["passK"] or 0) - 2 / 3) < 1e-9, str(arm["passK"]))
    check("the episode rate is a share of episodes", abs((arm["rate"] or 0) - 8 / 12) < 1e-9, str(arm["rate"]))
    check("the episode interval is the narrower of the two", (arm["rateHalfWidthPp"] or 99) < (arm["passKHalfWidthPp"] or 0))
    check("rows keep the run's task order", [row["id"] for row in arm["perTask"]] == ["1", "2", "3"])
    check("a row carries its rewards", arm["perTask"][1]["rewards"] == [0.0, 0.0, 0.0, 0.0])

    short = score_arm(_results([("1", True), ("2", False)], k=4), 4)
    short["perTask"][0]["rewards"].append(1.0)
    partial = {"simulations": [{"task_id": "1", "trial": 0, "reward_info": {"reward": 1.0}}]}
    graded = score_arm(partial, 4)
    check("a task with fewer than k trials leaves the denominator", graded["tasks"] == 0 and graded["short"] == ["1"])
    check("and it is not averaged in as a zero", graded["passK"] is None)
    check("the episode it did run is still counted", graded["episodesAll"] == 1)
    unscored = score_arm(_results([("1", True), ("2", True)], k=2, unscored=("2",)), 2)
    check("a task with an unscored trial leaves the denominator", unscored["unscored"] == ["2"], str(unscored["unscored"]))
    check("the remaining task is scored", unscored["tasks"] == 1)
    check("an interval over no episode is absent, not zero", score_arm({"simulations": []}, 4)["rateHalfWidthPp"] is None)
    check("zero trials is not a rate of zero", score_arm({"simulations": []}, 4)["rate"] is None)
    over = _results([("1", True)], k=4)
    over["simulations"].append({"task_id": "1", "trial": 4, "reward_info": {"reward": 1.0}})
    long_arm = score_arm(over, 4)
    check("a task with more than k trials is named rather than truncated", long_arm["long"] == ["1"] and long_arm["tasks"] == 0)

    # --- the material ---------------------------------------------------------------------------------

    summary = _summary(notes=_notes([(1, 6, 6), (2, 4, 4), (3, 5, 1)]), hits=6, lookups=12)
    material = material_of(summary)
    check("the material is read", material is not None)
    check("coverage is over the rounds after the first", material["failed"] == 9 and material["written"] == 5, str(material))
    check("coverage is written over failed", abs((material["coverage"] or 0) - 5 / 9) < 1e-9, str(material["coverage"]))
    check("the material's tokens are its prompt characters", material["materialTokens"] == 3_000, str(material["materialTokens"]))
    check("the agent's hits are read", material["hits"] == 6, str(material["hits"]))
    check("the agent's lookups are read", material["lookups"] == 12, str(material["lookups"]))
    check("no notes block is no material", material_of(_summary()) is None)
    check("a phase without the agent block still reports the runner's census",
          material_of(_summary(notes=_notes([(1, 6, 6), (2, 4, 4)])))["hits"] == 0)
    empty = material_of(_summary(notes=_notes([(1, 0, 0)])))
    check("a run that failed nothing has no coverage", empty["coverage"] is None and empty["failed"] == 0)
    refused = _summary(notes=_notes([(1, 6, 6), (2, 6, 0)]))
    refused["notes"]["rounds"][1]["refused"] = 6
    check("refusals are counted apart from failures", material_of(refused)["refused"] == 6)

    # --- the bill -------------------------------------------------------------------------------------

    bill = bill_of(_summary(calls=120, prompt=2_000_000, usd=1.25))
    check("calls are read", bill["calls"] == 120)
    check("prompt tokens are read", bill["promptTokens"] == 2_000_000)
    check("the price is the driver's own", bill["usd"] == 1.25)
    check("the band is carried", bill["band"] == "off_peak")
    check("a phase with no usage reports zero tokens rather than a guess", bill_of({})["promptTokens"] == 0)

    # --- the merge: one arm out of one phase per task -------------------------------------------------

    check("no paths is no list", split_paths([]) == [])
    check("a comma list splits", split_paths(["a.log,b.log"]) == ["a.log", "b.log"])
    check("a repeated flag concatenates", split_paths(["a.log", "b.log"]) == ["a.log", "b.log"])
    check("a path named twice is one path", split_paths(["a.log,a.log"]) == ["a.log"])
    check("blank entries are not paths", split_paths([" a.log , ,b.log "]) == ["a.log", "b.log"])

    two = merge_summaries(
        [_summary(calls=10, prompt=100, usd=0.5, hits=2, lookups=3), _summary(calls=20, prompt=200, usd=0.25, hits=1, lookups=4)],
        side="treatment",
    )
    check("the merge sums the calls", two["usage"]["calls"] == 30, str(two["usage"]))
    check("the merge sums the prompt", two["usage"]["prompt_tokens"] == 300, str(two["usage"]))
    check("the merge sums the bill", two["usage"]["cost"]["usd"] == 0.75, str(two["usage"]["cost"]))
    check("one band is kept", two["usage"]["cost"]["band"] == "off_peak", str(two["usage"]["cost"]))
    check("the merge sums the lookups", two["diagnostics"]["memory"]["notes"]["lookups"] == 7, str(two["diagnostics"]))
    check("the merge sums the hits", two["diagnostics"]["memory"]["notes"]["hits"] == 3)
    check("the merge keeps the agent", two["agent"] == "microglia_agent")
    mixed_band = merge_summaries([_summary(band="peak"), _summary(band="off_peak")], side="treatment")
    check("two bands are mixed rather than the first's", mixed_band["usage"]["cost"]["band"] == "mixed", str(mixed_band["usage"]["cost"]))
    check("a phase with no band reports none", merge_summaries([{"usage": {}}], side="control")["usage"]["cost"]["band"] is None)
    failing = merge_summaries(
        [_summary(lookups=1), {"phase": "eval", "agent": "microglia_agent", "model": "deepseek/deepseek-flash",
                               "judge": "deepseek/deepseek-chat", "thinking": "disabled",
                               "usage": {}, "diagnostics": {"memory": {"notes": {"lookups": 1, "problem": "boom"}}}}],
        side="treatment",
    )
    check("the first named problem travels", failing["diagnostics"]["memory"]["notes"]["problem"] == "boom", str(failing["diagnostics"]))
    for name, summaries, code in (
        ("two models are two experiments",
         [_summary(), _summary() | {"model": "zhipu/glm-4"}], "tau2-note-pilot-mixed-model:deepseek/deepseek-flash:zhipu/glm-4"),
        ("two agents are two experiments",
         [_summary(), _summary(agent="llm_agent")], "tau2-note-pilot-mixed-agent:microglia_agent:llm_agent"),
        ("no phase at all is refused", [], "tau2-note-pilot-no-control"),
    ):
        raised = False
        try:
            merge_summaries(summaries, side="control")
        except SystemExit as error:
            raised = str(error) == code
        check(name, raised)

    merged_notes = merge_notes_blocks([_notes([(1, 4, 4), (2, 2, 2)], task="5"), _notes([(1, 3, 3), (2, 3, 3)], task="9")])
    check("no notes block is no material", merge_notes_blocks([None, {}]) is None)
    check("the merge counts every round", len(merged_notes["rounds"]) == 4, str(len(merged_notes["rounds"])))
    check("each round names its sidecar", merged_notes["rounds"][0]["sidecar"].endswith("notes-5.json"))
    check("the merge lists both scopes", merged_notes["tasks"] == ["5", "9"], str(merged_notes["tasks"]))
    check("and names no problem", merged_notes["scopeProblems"] == [], str(merged_notes["scopeProblems"]))
    check("a merged specificity is not computed per phase", merged_notes["specificity"] is None)
    unscoped = merge_notes_blocks([_notes([(1, 1, 1)], task="5", scope={"kind": "none"})])
    check("a phase with no scope is a problem", len(unscoped["scopeProblems"]) == 1, str(unscoped["scopeProblems"]))
    check("and names the file", "notes-5.json" in unscoped["scopeProblems"][0], str(unscoped["scopeProblems"]))
    check("a many-scoped phase is a problem too",
          len(merge_notes_blocks([_notes([(1, 1, 1)], scope={"kind": "many", "tasks": ["5"]})])["scopeProblems"]) == 1)
    check("collisions add across phases",
          merge_notes_blocks([_notes([(1, 1, 1)], collisions=1), _notes([(1, 1, 1)], collisions=2)])["collisions"] == 3)
    # R208. The material is the arm: a fold whose phases disagree about it measured two things.
    graded_notes = merge_notes_blocks(
        [_notes([(1, 4, 4)], task="5", verdict=True, verdicts=3, verdict_chars=120),
         _notes([(1, 3, 3)], task="9", verdict=True, verdicts=2, verdict_chars=80)]
    )
    check("a verdict fold says it is one", graded_notes["verdict"] is True)
    check("the explained failures add", graded_notes["verdicts"] == 5, str(graded_notes["verdicts"]))
    check("the verdict's characters add", graded_notes["verdictChars"] == 200, str(graded_notes["verdictChars"]))
    check("a fold that showed no verdict says so",
          merge_notes_blocks([_notes([(1, 1, 1)], task="5"), _notes([(1, 1, 1)], task="9")])["verdict"] is False)
    mixed_material = False
    try:
        merge_notes_blocks([_notes([(1, 1, 1)], task="5", verdict=True), _notes([(1, 1, 1)], task="9")])
    except SystemExit as error:
        mixed_material = str(error) == "tau2-note-pilot-mixed-verdict:1:1"
    check("a fold of two materials is refused", mixed_material, "no refusal")
    # An artefact written before R208 has no key at all, and that is `false` rather than a third state.
    legacy = {key: value for key, value in _notes([(1, 1, 1)], task="5").items() if key != "verdict"}
    check("a phase that predates the verdict is a phase without one",
          merge_notes_blocks([legacy, _notes([(1, 1, 1)], task="9")])["verdict"] is False)
    whole = material_of(_summary(notes=merged_notes, hits=5, lookups=8))
    check("the merged census is readable as material", whole["failed"] == 5 and whole["written"] == 5, str(whole))
    check("and carries both scopes", whole["scopeTasks"] == ["5", "9"], str(whole["scopeTasks"]))
    check("the two identities are reported apart", (whole["keyHits"], whole["taskHits"]) == (0, 5), str(whole))
    check("a material of attempts alone says it showed no verdict", whole["verdict"] is False and whole["verdicts"] == 0, str(whole))
    graded_material = material_of(
        _summary(notes=merge_notes_blocks([_notes([(1, 4, 4), (2, 3, 2)], task="5", verdict=True, verdicts=4, verdict_chars=150)]))
    )
    check("a verdict material counts what the evaluator explained", graded_material["verdicts"] == 4, str(graded_material))
    check("and bills the verdict's characters", graded_material["verdictChars"] == 150, str(graded_material))
    single_block = material_of(_summary(notes=_notes([(1, 1, 1)], task="7")))
    check("a single phase's scope is read from its own block", single_block["scopeTasks"] == ["7"], str(single_block["scopeTasks"]))
    no_task = material_of(_summary(notes=_notes([(1, 1, 1)], scope={"kind": "none"})))
    check("a block that names no task lists none", no_task["scopeTasks"] == [], str(no_task["scopeTasks"]))

    # --- the pair -------------------------------------------------------------------------------------

    control_results = _results([("1", True), ("2", False), ("3", False), ("4", True)])
    treatment_results = _results([("1", True), ("2", True), ("3", False), ("4", True)])
    comparison = pair_of(score_arm(control_results, 4), score_arm(treatment_results, 4))
    check("the pair is over the shared tasks", comparison["passK"]["paired"] == 4, str(comparison["passK"]))
    check("the delta is the discordant difference", comparison["passK"]["deltaPp"] == 25.0, str(comparison["passK"]["deltaPp"]))
    check("one task moved towards the treatment", comparison["passK"]["treatmentOnly"] == 1)
    check("none moved away", comparison["passK"]["controlOnly"] == 0)
    check("the interval contains the delta", comparison["passK"]["intervalPp"][0] <= 25.0 <= comparison["passK"]["intervalPp"][1])
    check("the episode level is paired too", comparison["episode"]["paired"] == 16, str(comparison["episode"]["paired"]))
    same = pair_of(score_arm(control_results, 4), score_arm(control_results, 4))
    check("two identical arms differ by nothing", same["passK"]["deltaPp"] == 0.0 and same["passK"]["treatmentOnly"] == 0)
    check("and their interval is empty rather than wide", same["passK"]["intervalPp"] == [0.0, 0.0])

    # --- the artefact ---------------------------------------------------------------------------------

    def assembled(**overrides) -> dict:
        control = overrides.pop("control_summary", _summary(calls=100, prompt=1_000_000, usd=1.0))
        treatment = overrides.pop("treatment_summary", _summary(
            notes=_notes([(1, 4, 4), (2, 3, 3), (3, 2, 2), (4, 2, 2)]), hits=11, lookups=16, usd=1.2, prompt=1_100_000
        ))
        return build(
            control_summary=control,
            treatment_summary=treatment,
            control_results=control_results,
            treatment_results=treatment_results,
            configuration={"domain": "retail", "tasks": ["1", "2", "3", "4"], "rounds": 4,
                           "seeds": [300, 301, 302, 303], "release": "v1.0.1", "agent": "microglia_agent"},
            **overrides,
        )

    artefact = assembled()
    check("the artefact names its schema", artefact["schema"] == SCHEMA)
    check("a pilot claims nothing", artefact["claim"] == "none")
    check("both arms are in the artefact", set(artefact["arms"]) == {"control", "treatment"})
    check("the treatment's pass^4 is the artefact's own arithmetic",
          artefact["arms"]["treatment"]["passK"] == 0.75, str(artefact["arms"]["treatment"]["passK"]))
    check("the material is carried beside the arms", artefact["notes"]["hits"] == 11)
    check("the material's share of the treatment's prompt is computed",
          0 < artefact["bill"]["materialShareOfTreatmentPrompt"] < 1, str(artefact["bill"]))
    check("the models are recorded once", artefact["models"]["judge"] == "deepseek/deepseek-chat")

    for name, overrides, code in (
        ("two agents are not a comparison", {"control_summary": _summary(agent="llm_agent")},
         "tau2-note-pilot-same-agent:llm_agent:microglia_agent"),
        ("a control carrying notes is a leak",
         {"control_summary": _summary(notes=_notes([(1, 1, 1), (2, 1, 1)]))},
         "tau2-note-pilot-control-has-notes"),
        ("a treatment with no material is not this arm",
         {"treatment_summary": _summary()}, "tau2-note-pilot-no-material"),
    ):
        raised = False
        try:
            assembled(**overrides)
        except SystemExit as error:
            raised = str(error) == code
        check(name, raised)

    # --- the command line, end to end ---------------------------------------------------------------
    # Not covered by the cases above: `main` decides the paths, reads two logs, writes one document, and an
    # argparse mistake there is invisible to every function this file has. The workflow runs the same two
    # commands with real phases, so a case that never touched the CLI would find the defect for money.

    import os
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        def write(name: str, payload, *, log: bool = False) -> str:
            path = os.path.join(directory, name)
            with open(path, "w", encoding="utf-8") as stream:
                if log:
                    stream.write("[tau2] 6 task(s)\n")
                    stream.write(json.dumps(payload) + "\n")
                else:
                    json.dump(payload, stream)
            return path

        control_log = write("control.log", _summary(calls=90, prompt=900_000, usd=0.9), log=True)
        treatment_log = write(
            "treatment.log",
            _summary(notes=_notes([(1, 4, 4), (2, 3, 3), (3, 2, 2), (4, 2, 2)]), hits=11, lookups=16,
                     calls=110, prompt=1_050_000, usd=1.1),
            log=True,
        )
        control_results = write("control.json", control_results)
        treatment_results = write("treatment.json", treatment_results)
        out = os.path.join(directory, "note-pilot.json")
        code = main([
            "--control", control_log, "--treatment", treatment_log,
            "--control-results", control_results, "--treatment-results", treatment_results,
            "--domain", "retail", "--tasks", "1,2,3,4", "--rounds", "4",
            "--seeds", "300,301,302,303", "--release", "v1.0.1", "--out", out,
        ])
        check("the command line writes a document", code == 0 and os.path.isfile(out))
        with open(out, encoding="utf-8") as stream:
            written = json.load(stream)
        check("the written document carries both arms", set(written["arms"]) == {"control", "treatment"})
        check("the written document carries the seeds", written["configuration"]["seeds"] == [300, 301, 302, 303])
        check("the written document carries the release", written["configuration"]["release"] == "v1.0.1")
        check("the written document's delta is the paired one", written["comparison"]["passK"]["deltaPp"] == 25.0)

        # A dispatch with nowhere to write: refused before the reading rather than after the model calls,
        # which is the difference between a pilot that costs nothing and one that costs a run.
        refused = None
        try:
            main(["--control", control_log, "--treatment", treatment_log,
                  "--control-results", control_results, "--treatment-results", treatment_results,
                  "--rounds", "4"])
        except SystemExit as error:
            # `argparse` exits 2 for a missing required option, and its message goes to stderr rather than
            # into the exception: the code is the only thing a caller can assert on.
            refused = error.code
        check("a pilot with no output path is refused", refused == 2, str(refused))

        # --- the fixture, which is the fold's shape: one phase per task -----------------------------
        # Not a second copy of the case above. That one runs *one* phase per arm; this one runs six, which is what
        # R207 dispatches, and it is the only exercise of the merge, the per-task path convention and the
        # specificity recomputation over a real corpus. The contract job in `note-pilot.yml` runs exactly this.

        fixtures = os.path.join(directory, "fixtures")
        code = main(["--fixtures", fixtures, "--rounds", "4"])
        check("the fixture writer reports its paths", code == 0)
        written_fixtures = write_fixtures(os.path.join(directory, "fixtures-check"), rounds=4, tasks=3)
        check("the fixture names one phase per task", len(written_fixtures["treatment"].split(",")) == 3,
              str(written_fixtures["treatment"]))
        check("the fixture names one sidecar per task", len(written_fixtures["notes"].split(",")) == 3)

        fold = os.path.join(directory, "fold.json")
        code = main([
            "--control", written_fixtures["control"], "--treatment", written_fixtures["treatment"],
            "--control-results", written_fixtures["controlResults"],
            "--treatment-results", written_fixtures["treatmentResults"],
            "--notes", written_fixtures["notes"],
            "--domain", "retail", "--tasks", "1,2,3", "--rounds", "4",
            "--seeds", "300,301,302,303", "--release", "v1.0.1", "--out", fold,
        ])
        check("the fold assembles", code == 0 and os.path.isfile(fold))
        with open(fold, encoding="utf-8") as stream:
            document = json.load(stream)
        check("the fold's bill is the sum of its phases", abs(document["bill"]["controlUsd"] - 1.0) < 1e-6,
              str(document["bill"]))
        check("the fold's census closes over every phase",
              document["notes"]["written"] + document["notes"]["refused"] == document["notes"]["failed"],
              str({key: document["notes"][key] for key in ("written", "refused", "failed")}))
        check("the fold's coverage is complete", document["notes"]["coverage"] == 1.0, str(document["notes"]["coverage"]))
        check("every task's scope arrived", document["notes"]["scopeTasks"] == ["1", "2", "3"],
              str(document["notes"]["scopeTasks"]))
        check("and none was ambiguous", document["notes"]["scopeProblems"] == [], str(document["notes"]["scopeProblems"]))
        check("the notes were served by the file rather than by the text",
              document["notes"]["taskHits"] > 0 and document["notes"]["keyHits"] == 0, str(document["notes"]))
        check("specificity is recomputed over the corpus", document["notes"]["specificity"]["share"] == 1.0,
              str(document["notes"]["specificity"]))
        check("and graded every note", document["notes"]["specificity"]["graded"] == 3,
              str(document["notes"]["specificity"]))
        check("the fold's invocations are counted", document["configuration"]["invocations"] == 3,
              str(document["configuration"]))
        check("the fold's pass^4 is over three tasks", document["comparison"]["passK"]["paired"] == 3,
              str(document["comparison"]["passK"]))

        # A fold whose sidecars are absent still grades the mechanism: an unmeasured diagnostic is not a finding
        # about the material, and refusing to write the artefact would throw away the pass^k the run paid for.
        bare = os.path.join(directory, "bare.json")
        code = main([
            "--control", written_fixtures["control"], "--treatment", written_fixtures["treatment"],
            "--control-results", written_fixtures["controlResults"],
            "--treatment-results", written_fixtures["treatmentResults"],
            "--tasks", "1,2,3", "--rounds", "4", "--out", bare,
        ])
        with open(bare, encoding="utf-8") as stream:
            without = json.load(stream)
        check("no sidecar still writes the artefact", code == 0 and os.path.isfile(bare))
        check("and leaves specificity unmeasured", without["notes"]["specificity"] is None, str(without["notes"]["specificity"]))
        check("while the arm's own gates survive", without["notes"]["scopeTasks"] == ["1", "2", "3"])

        # A sidecar that cannot be read is named in the artefact rather than dropped: a specificity computed over
        # a corpus that lost one task's attempts is a share of a denominator nobody can reconstruct.
        broken_sidecar = os.path.join(directory, "broken-notes.json")
        with open(broken_sidecar, "w", encoding="utf-8") as stream:
            stream.write("{ not json")
        named = os.path.join(directory, "named.json")
        code = main([
            "--control", written_fixtures["control"], "--treatment", written_fixtures["treatment"],
            "--control-results", written_fixtures["controlResults"],
            "--treatment-results", written_fixtures["treatmentResults"],
            "--notes", f"{written_fixtures['notes']},{broken_sidecar}",
            "--tasks", "1,2,3", "--rounds", "4", "--out", named,
        ])
        with open(named, encoding="utf-8") as stream:
            unreadable = json.load(stream)
        check("an unreadable sidecar does not stop the artefact", code == 0)
        check("it is named as a problem", any("broken-notes.json" in problem for problem in
                                              unreadable["notes"]["specificity"]["problems"]),
              str(unreadable["notes"]["specificity"]["problems"]))
        check("and the readable ones are still graded", unreadable["notes"]["specificity"]["graded"] == 3,
              str(unreadable["notes"]["specificity"]))

    # --- the window -----------------------------------------------------------------------------------
    # The guard's clock is a parameter because a function that read the wall clock would make this suite pass or
    # fail depending on the hour it ran, which is a check that cannot say no on a Tuesday afternoon (the lesson
    # `_cost(now=…)` was given in the driver).
    from datetime import datetime, timezone

    card = {"peakWindows": [{"fromHourUtc": 1, "toHourUtc": 4}, {"fromHourUtc": 6, "toHourUtc": 10}],
            "peakWeekdaysOnly": True}
    monday = datetime(2026, 11, 23, tzinfo=timezone.utc)
    check("a run that ends before the band fits", fits_window(monday.replace(hour=0, minute=30), 20, card)[0])
    check("a run that would end inside the band does not fit",
          not fits_window(monday.replace(hour=0, minute=30), 40, card)[0])
    check("a run that starts inside the band does not fit", not fits_window(monday.replace(hour=2, minute=0), 10, card)[0])
    check("the refusal names the window", "twice" in fits_window(monday.replace(hour=2), 10, card)[1])
    check("a run ending exactly at the boundary fits", fits_window(monday.replace(hour=0, minute=40), 20, card)[0])
    saturday = datetime(2026, 11, 28, 2, 0, tzinfo=timezone.utc)
    check("the weekend has no band", fits_window(saturday, 30, card)[0])
    check("a zero-minute run at a boundary is judged on its start",
          not fits_window(monday.replace(hour=1, minute=0), 0, card)[0])

    # The guard as the workflow runs it: through `main`, against a card read from disk. Both cards are chosen so
    # the answer cannot depend on the hour or the day the suite runs — a band covering every hour of every day,
    # and a band covering none — because a check that passes on Tuesday morning and fails on Saturday night is a
    # check that cannot say no.
    import tempfile as _tempfile

    with _tempfile.TemporaryDirectory() as guard_directory:
        def card_at(name: str, windows: list, weekdays_only: bool) -> str:
            path = os.path.join(guard_directory, name)
            with open(path, "w", encoding="utf-8") as stream:
                json.dump({"peakWindows": windows, "peakWeekdaysOnly": weekdays_only}, stream)
            return path

        always = card_at("always.json", [{"fromHourUtc": 0, "toHourUtc": 24}], False)
        never = card_at("never.json", [{"fromHourUtc": 24, "toHourUtc": 25}], False)
        none_declared = card_at("none.json", [], False)
        check("a card with no off-peak hour refuses the run", main(["--window-minutes", "20", "--rate-card", always]) == 3)
        check("a card with no band at all lets it through", main(["--window-minutes", "20", "--rate-card", never]) == 0)
        raised = False
        try:
            main(["--window-minutes", "20", "--rate-card", none_declared])
        except SystemExit as error:
            raised = str(error) == "tau2-note-pilot-no-windows"
        check("a card that declares no windows is refused rather than guessed", raised)

    print(f"\n{checks} checks, {failures} failure(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
