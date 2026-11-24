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

Three refusals, each of them a state that would otherwise produce a number about nothing:

  `same-agent`        the two arms ran different agents, so their difference is the wrapper (R93's defect)
  `control-has-notes` the control's own summary carries a notes block, so the treatment leaked into it
  `no-pair`           the arms share no scoreable task, so there is no paired reading to take

And one rule that is arithmetic rather than policy: a task with fewer than `k` scoreable trials leaves the
`pass^k` denominator. Averaging it as a zero is the biased estimate this lane exists to avoid — the same rule
`packages/eval/src/l4.ts` implements on the TypeScript side and for the same reason.

Usage:
  python3 eval/drivers/tau2/note_pilot.py --control /tmp/control.json --treatment /tmp/treatment.json \\
    --control-results /tmp/control/results.json --treatment-results /tmp/treatment/results.json \\
    --rounds 4 --tasks 1,2,3,4,5,6 --release v1.0.1 --out /tmp/note-pilot.json
  python3 eval/drivers/tau2/note_pilot.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys

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
        "specificity": notes.get("specificity"),
        # The agent's own counters, which say whether the file was asked for and found rather than whether it
        # was written: a treatment whose `hits` is zero is a file nobody read.
        "lookups": int(number(own.get("hits")) is not None and number(own.get("lookups")) or 0),
        "hits": int(number(own.get("hits")) or 0),
        "problem": own.get("problem"),
        "promptChars": sum(int(number(entry.get("promptChars")) or 0) for entry in rounds),
        "noteChars": sum(int(number(entry.get("noteChars")) or 0) for entry in rounds),
        "materialTokens": round(sum(int(number(entry.get("promptChars")) or 0) for entry in rounds) / CHARS_PER_TOKEN),
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
) -> dict:
    """The pilot's document. Refuses the two states that would make its comparison about something else."""
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
    parser.add_argument("--control", help="the control phase's log, or `-` for stdin")
    parser.add_argument("--treatment", help="the treatment phase's log")
    parser.add_argument("--control-results", help="the control arm's results.json")
    parser.add_argument("--treatment-results", help="the treatment arm's results.json")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--rounds", type=int, default=4)
    parser.add_argument("--seeds", default="")
    parser.add_argument("--release", default="v1.0.1")
    parser.add_argument("--claim-reason", default="a pilot resolves nothing: the fold's own sample is the claim")
    parser.add_argument("--out", default="")
    parser.add_argument("--fixtures", help="write a synthetic pair of phases into this directory and stop")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if arguments.fixtures:
        # Printed rather than assumed: the workflow's free half reads these four paths from here, so a rename
        # is a failure in one place instead of a shell script that silently ran the builder on nothing.
        print(json.dumps(write_fixtures(arguments.fixtures, rounds=arguments.rounds or 4)))
        return 0
    if not (arguments.control and arguments.treatment and arguments.control_results and arguments.treatment_results):
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

    control_summary = last_json_line(read(arguments.control))
    treatment_summary = last_json_line(read(arguments.treatment))
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
    }
    document = build(
        control_summary=control_summary,
        treatment_summary=treatment_summary,
        control_results=load(arguments.control_results),
        treatment_results=load(arguments.treatment_results),
        configuration=configuration,
        claim_reason=arguments.claim_reason,
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
        f"hits {document['notes']['hits']}",
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
             usd: float = 1.0, hits: int = 0, lookups: int = 0, problem: str | None = None) -> dict:
    diagnostics: dict = {"usage": {}}
    if hits or lookups or problem:
        diagnostics["memory"] = {"notes": {"lookups": lookups, "hits": hits, "problem": problem}}
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
            "cost": {"usd": usd, "band": "off_peak"},
        },
        "diagnostics": diagnostics,
        **({} if notes is None else {"notes": notes}),
    }


def _notes(rounds: list[tuple[int, int, int]], *, collisions: int = 0, specificity: dict | None = None) -> dict:
    """A notes block of the shape `run_split.py` prints: `(round, failed, written)` per round."""
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
        "path": "/tmp/notes.json",
        "rounds": entries,
        "written": sum(entry["written"] for entry in entries),
        "refused": 0,
        "providerFailures": 0,
        "collisions": collisions,
        "specificity": specificity if specificity is not None else {"graded": 18, "specific": 15, "share": 0.8333},
    }


def write_fixtures(directory: str, *, rounds: int = 4, tasks: int = 6) -> dict:
    """A synthetic pair of phases, in the shape the two commands read.

    It exists for the free half of `.github/workflows/note-pilot.yml`: the paid job runs four commands in
    sequence, and a push that breaks the CSV of `--tasks` or the path convention between them should fail on a
    fixture rather than on a dispatch that has already bought 48 simulations. The fixture is *not* a result —
    nothing here is written under `eval/results/`, and the artefact it produces is graded as a pilot the way a
    real one would be, which is the point: the grading path is what is under test.
    """
    import os

    os.makedirs(directory, exist_ok=True)
    total = max(1, tasks)
    control_rows = [(str(index + 1), index < total // 2) for index in range(total)]
    treatment_rows = [(str(index + 1), index < total // 2 + 1) for index in range(total)]
    paths = {
        "control": os.path.join(directory, "control.log"),
        "treatment": os.path.join(directory, "treatment.log"),
        "controlResults": os.path.join(directory, "control-results.json"),
        "treatmentResults": os.path.join(directory, "treatment-results.json"),
        "out": os.path.join(directory, "note-pilot.json"),
    }
    later = [(index + 1, 4, 4) for index in range(rounds - 1)]
    with open(paths["control"], "w", encoding="utf-8") as stream:
        stream.write(json.dumps(_summary(calls=100, prompt=1_000_000, usd=1.0)) + "\n")
    with open(paths["treatment"], "w", encoding="utf-8") as stream:
        stream.write(json.dumps(_summary(notes=_notes(later), hits=tasks * 3, lookups=tasks * rounds,
                                         calls=120, prompt=1_100_000, usd=1.2)) + "\n")
    with open(paths["controlResults"], "w", encoding="utf-8") as stream:
        json.dump(_results(control_rows, k=rounds), stream)
    with open(paths["treatmentResults"], "w", encoding="utf-8") as stream:
        json.dump(_results(treatment_rows, k=rounds), stream)
    return paths


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

    print(f"\n{checks} checks, {failures} failure(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
