#!/usr/bin/env python3
"""R206 readback: did a note written after one attempt change the next attempt at the same task?

The registration is `prereg/R206-same-task-transient.md`, with two amendments written after the engineering and
before any dispatch. This file grades the arm by the gates that amendment registered (`N0`–`N4`), not by the pack
lane's six: `V1` asks whether a served block was non-empty and this arm has no block, `V2`/`V3`/`V5` are censuses
of a pack this arm does not have. A gate written from a *cause* rather than from the *effect* is the defect this
record has repaired more than once, and the first version of the pack gate rated every clean run of this arm as
broken.

Five gates, in the order the registration ordered them:

  N0  the control is the same scaffold   both arms `microglia_agent`, same rounds, same seeds, no facade; the
                                         only difference is the sidecar. R93's defect was comparing across a
                                         wrapper and quoting the difference as the memory's.
  N0b the grid failed something          at least one failure arrived in a round a note is written from. R207's
                                         pilot had none — 48 episodes, one failure, in the last round — and the
                                         gates below read that absence as the mechanism's, which is why the
                                         population is graded first and reported as `NO_MEASUREMENT`.
  N1  the handoff happened               the treatment found a note and the control found none, over the same
                                         number of episodes. A treatment with `hits: 0` is a file nobody read.
  N2  coverage is quotable               `written / failed ≥ 0.6` over the rounds after the first. R204 measured
                                         15% with records retrieved from *other* tasks; this arm shows the
                                         summariser the task's own failure.
  N3  the note is specific               `specificity.share ≥ 0.5`: at least half the notes name a token that
                                         appears in their own task's failure and in no other task's.
  N4  the reading is paired              pass^k per arm over the same tasks, and the difference quoted only if
                                         the interval clears the sample's resolution. A pilot's interval cannot,
                                         so the pilot's claim is withheld *as a registered fact* rather than
                                         discovered after the number.

States, the four the other verifiers use:

  GRADED          a pilot whose mechanism was observed and whose material is quotable. No pass^k claim is made
                  and the artefact says so (`claim: none`).
  NO_MEASUREMENT  the document cannot answer: no per-task rows, no material census, no comparison, or a
                  pass^k that disagrees with its own rows.
  DISCARDED       another arm: a stock agent, a facade, a control that carries the material.
  ABANDONED       a refutation fired. The pilot's own purpose is a decision, so abandoning it is a result:
                  do not buy the 320-simulation fold on this material.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r206
  python3 r206_readback.py --dir /tmp/r206
  python3 r206_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from r88_readback import Report, number

SCHEMA = "microglia.note-pilot/1"
#: The arm this file grades. Anything else is another arm, which is a discard rather than a failure.
REQUIRED_AGENT = "microglia_agent"
REQUIRED_MATERIAL = "notes"
#: `N2`'s bar, from the amendment: of the failed attempts, how many produced a sentence. R204's cross-task
#: summariser wrote 6 of 40 (15%); the prediction is that the same model, shown the task's own failure, clears
#: 60%. Below 40% is the registration's first refutation; between the two is "worth one more look, not a fold".
COVERAGE_BAR = 0.6
#: `N3`'s bar: below half, the summariser copied the request rather than naming the failure.
SPECIFICITY_BAR = 0.5


def intervals_of(artefact: dict[str, Any]) -> dict[str, Any] | None:
    """The blocks the gates read, or `None` when the document is not this arm's artefact.

    The type is checked rather than assumed: this file is handed whatever `fetch_evidence` downloaded, and a
    `--dir` pointing at another round's artefact is the ordinary case. A `list` at the top level would raise
    `AttributeError` here, which reads as a broken verifier rather than as a file that is not this arm's.
    """
    if not isinstance(artefact, dict) or artefact.get("schema") != SCHEMA:
        return None
    arms = artefact.get("arms")
    notes = artefact.get("notes")
    comparison = artefact.get("comparison")
    configuration = artefact.get("configuration")
    if not all(isinstance(block, dict) for block in (arms, notes, comparison, configuration)):
        return None
    control = arms.get("control")
    treatment = arms.get("treatment")
    if not isinstance(control, dict) or not isinstance(treatment, dict):
        return None
    return {"control": control, "treatment": treatment, "notes": notes, "comparison": comparison,
            "configuration": configuration}


def rows_of(arm: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The per-task rows, or `None` when the arm has none. A row is `{id, rewards, pass}`."""
    rows = arm.get("perTask")
    if not isinstance(rows, list) or not rows:
        return None
    for row in rows:
        if not isinstance(row, dict):
            return None
        rewards = row.get("rewards")
        if not isinstance(rewards, list) or not rewards or not isinstance(row.get("id"), str):
            return None
        if any(number(reward) is None for reward in rewards):
            return None
    return rows


def recomputed_of(rows: list[dict[str, Any]], k: int) -> tuple[float, float]:
    """`pass^k` and the episode rate, from the rows rather than from the headline.

    The artefact publishes both numbers and this file recomputes them, because a document that states a score
    and cannot reproduce it from its own rows is a document whose score is a transcription. That has happened in
    this record — R119's `pass^1` grid was labelled `k: 4` — and a gate that trusted the label would have
    certified it.
    """
    tasks = len(rows)
    held = sum(1 for row in rows if all((number(reward) or 0.0) >= 1.0 for reward in row["rewards"][:k]))
    episodes = sum(len(row["rewards"]) for row in rows)
    successes = sum(1 for row in rows for reward in row["rewards"] if (number(reward) or 0.0) >= 1.0)
    return (held / tasks if tasks else 0.0, successes / episodes if episodes else 0.0)


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    blocks = intervals_of(artefact)
    if blocks is None:
        report.note("not a note-pilot artefact")
        return ("NO_MEASUREMENT", report)

    control = blocks["control"]
    treatment = blocks["treatment"]
    notes = blocks["notes"]
    comparison = blocks["comparison"]
    configuration = blocks["configuration"]
    rounds = number(configuration.get("rounds"))

    # N0, before any other reading: an arm compared to a different scaffold has a difference that belongs to
    # the wrapper, and every gate below would be measured on the wrong object.
    same_agent = configuration.get("agent") == REQUIRED_AGENT and treatment.get("agent", REQUIRED_AGENT) == REQUIRED_AGENT
    no_facade = not configuration.get("memoryUrl") and not control.get("memoryUrl") and not treatment.get("memoryUrl")
    report.predict("N0 both arms are the same scaffold", same_agent and bool(no_facade),
                   f"agent={configuration.get('agent')!r}, facade={'absent' if no_facade else 'present'}")
    report.predict("N0 the treatment's material is the note", configuration.get("material") == REQUIRED_MATERIAL,
                   f"material={configuration.get('material')!r}")
    if same_agent is False or not no_facade or configuration.get("material") != REQUIRED_MATERIAL:
        report.note("another arm: the numbers in this file are about a different treatment")
        return ("DISCARDED", report)

    # N5, before any reading: the identity this arm moves to the file is only an identity if every sidecar names
    # exactly one task. A file that names none or several is R206's defect wearing this arm's clothes — the agent
    # would be serving a sentence it cannot attribute — and the registration says such a fold is discarded rather
    # than graded, because every number below would be about a file nobody can address.
    expected = configuration.get("tasks") if isinstance(configuration.get("tasks"), list) else []
    listed = notes.get("scopeTasks")
    scope_tasks = [str(task) for task in listed] if isinstance(listed, list) else []
    named = notes.get("scopeProblems")
    scope_problems = (
        [str(problem) for problem in named]
        if isinstance(named, list) and named
        else ([] if isinstance(named, list) else ["the artefact carries no scope census"])
    )
    report.predict("N5 every sidecar declares exactly one task", not scope_problems, "; ".join(scope_problems)[:240])
    one_each = len(scope_tasks) == len(expected) and set(scope_tasks) == {str(task) for task in expected}
    report.predict("N5 and there is one per task", one_each,
                   f"{len(scope_tasks)} scope(s) for {len(expected)} task(s)")
    if scope_problems:
        report.note("a mis-scoped sidecar cannot be graded: the material has no file to belong to")
        return ("DISCARDED", report)
    if not one_each:
        # Not a discard: this is the arm, with a task missing — an instrument fault rather than another treatment.
        report.note("the grid and the scopes disagree, so the fold covers fewer tasks than its title says")
        return ("NO_MEASUREMENT", report)

    control_rows = rows_of(control)
    treatment_rows = rows_of(treatment)
    if control_rows is None or treatment_rows is None or rounds is None or rounds < 2:
        report.note("no per-task rows, or fewer than two rounds")
        return ("NO_MEASUREMENT", report)

    k = int(rounds)
    control_passk, control_rate = recomputed_of(control_rows, k)
    treatment_passk, treatment_rate = recomputed_of(treatment_rows, k)
    claimed = number(treatment.get("passK"))
    claimed_control = number(control.get("passK"))
    honest = (
        claimed is not None
        and claimed_control is not None
        and abs(claimed - treatment_passk) < 5e-3
        and abs(claimed_control - control_passk) < 5e-3
    )
    report.predict("the two headlines reproduce from their own rows", honest,
                   f"treatment {claimed} vs {treatment_passk:.4f}, control {claimed_control} vs {control_passk:.4f}")
    if not honest:
        return ("NO_MEASUREMENT", report)

    def quote_pair() -> None:
        """The paired reading, printed as `withheld` with the interval that explains why.

        Defined here rather than written twice: the population gate below returns before N4, and a reading that
        dropped the pair on a saturated grid would hide the one number a reader wants from it — that the two arms
        differed by 16.7 pp on six tasks, which at six tasks is noise.
        """
        passk = comparison.get("passK") if isinstance(comparison.get("passK"), dict) else {}
        paired = number(passk.get("paired"))
        delta = number(passk.get("deltaPp"))
        interval = passk.get("intervalPp")
        if not (isinstance(interval, list) and len(interval) == 2):
            return
        width = (number(interval[1]) or 0.0) - (number(interval[0]) or 0.0)
        report.note(
            f"pass^{k}: control {control_passk * 100:.1f}% vs treatment {treatment_passk * 100:.1f}%, "
            f"delta {delta} pp, interval ±{width / 2:.1f} pp over {int(paired or 0)} task(s) — withheld"
        )
        report.note(
            f"episode rate: control {control_rate * 100:.1f}% vs treatment {treatment_rate * 100:.1f}% "
            f"(the level at which this n has resolution)"
        )

    # N0b: the population. Every gate below is conditioned on there being something to serve, and R207's pilot is
    # the case that proved the gates could not tell "the mechanism failed" from "the mechanism was never given
    # anything": 48 episodes, one failure, and that failure arrived in the last round, so `failed` over the rounds
    # a note is written from was **0** — and N1's "and found one" fired as a refutation of a file that had never
    # held a sentence. A gate that fires on a cause it cannot distinguish from the arm's own failure is the defect
    # this file's header warns about, so the population is graded first.
    #
    # Two populations, and they are different findings. No distilled failure is a **saturated grid**: the task set
    # cannot say anything about the material and the next dispatch is a harder one. No written note is a
    # **summariser that declined every attempt**, which N2's coverage refutation already names correctly.
    distilled = number(notes.get("failed")) or 0
    written = number(notes.get("written")) or 0
    no_failure = distilled <= 0
    serviceable = written > 0
    report.predict("N0b the grid failed something a note could be written from", not no_failure,
                   f"{int(distilled)} failure(s) after round 1")

    control_has_notes = control.get("notes") is not None or number(control.get("lookups")) not in (None, 0)
    hits = number(notes.get("hits"))
    lookups = number(notes.get("lookups"))
    same_episodes = number(control.get("episodes")) == number(treatment.get("episodes"))
    report.predict("N1 the control found no note", not control_has_notes)
    report.predict("N1 the treatment asked for one", (lookups or 0) > 0, f"lookups={lookups}")
    # `n/a` rather than `FAIL` when no note was ever written: the file cannot have served what nobody put in it,
    # and a red line here would name the reader for the writer's refusal.
    report.predict("N1 and found one", None if not serviceable else (hits or 0) > 0, f"hits={hits}")
    report.predict("N1 both arms ran the same episodes", same_episodes,
                   f"{number(control.get('episodes'))} vs {number(treatment.get('episodes'))}")
    # A hit of zero is an abandonment whether or not the agent asked: "asked and found nothing" and "never
    # asked" are two ways for the treatment to not have run, and both make every reading below about a control.
    # The two are named apart in the detail because the repair differs — the first is a sidecar the runner wrote
    # where the agent was not looking, the second is an environment variable that never reached the process.
    # Conditioned on a note existing for the same reason the prediction is: an empty sidecar serves nothing, and
    # calling that "the treatment never read its sidecar" is a false statement about the agent.
    report.refute("the treatment never read its sidecar", serviceable and (hits or 0) == 0,
                  f"lookups={lookups}, hits={hits}")
    report.refute("the material leaked into the control", bool(control_has_notes))
    report.refute("the arms attempted different amounts", not same_episodes)

    # A provider failure inside the summariser is the run being broken, not the material being inert: the
    # census counts it apart from a refusal so this gate can fire on it alone.
    failures = number(notes.get("providerFailures")) or 0
    problem = notes.get("problem")
    report.refute("the summariser's provider failed", failures > 0, f"{int(failures)} call(s) failed")
    report.refute("the sidecar could not be read", problem is not None, str(problem))
    report.predict("the sidecar was readable throughout", problem is None, str(problem or ""))

    # N2: coverage, over the rounds after the first, because a note written at the end of round one is read
    # starting in round two.
    coverage = number(notes.get("coverage"))
    report.predict("N2 coverage clears the bar", None if no_failure else (coverage or 0.0) >= COVERAGE_BAR,
                   f"{coverage if coverage is None else round(coverage * 100, 1)}% of {int(number(notes.get('failed')) or 0)} failure(s)")
    report.refute("the summariser wrote notes for too few failures",
                  not no_failure and (coverage or 0.0) < COVERAGE_BAR, f"coverage {coverage}")
    # The census has to close: every failed attempt ended in exactly one of four states, because a round that
    # lost one of them would report a coverage that is a share of a number nobody can reconstruct. It is the
    # same identity the pack gate needed, one round later.
    closed = (
        (number(notes.get("written")) or 0)
        + (number(notes.get("refused")) or 0)
        + (number(notes.get("providerFailures")) or 0)
        + (number(notes.get("unreadable")) or 0)
        == (number(notes.get("failed")) or 0)
    )
    report.predict("N2 the note census closes", closed,
                   f"{int(number(notes.get('written')) or 0)} written + {int(number(notes.get('refused')) or 0)} "
                   f"refused + {int(number(notes.get('providerFailures')) or 0)} failed + "
                   f"{int(number(notes.get('unreadable')) or 0)} unreadable vs {int(number(notes.get('failed')) or 0)} "
                   "failure(s)")
    if not closed:
        # A census that does not close is an instrument fault rather than a material one: the reading below is
        # about a denominator that is missing a term, so the document leaves the measurement states here.
        return ("NO_MEASUREMENT", report)

    # N3: specificity, the check that the note is about this task rather than a restatement of the request.
    specificity = notes.get("specificity") if isinstance(notes.get("specificity"), dict) else {}
    share = number(specificity.get("share"))
    report.predict("N3 the notes name their own failure", None if not serviceable else (share or 0.0) >= SPECIFICITY_BAR,
                   f"share={share} over {int(number(specificity.get('graded')) or 0)} graded")
    report.refute("the notes restate the request", serviceable and (share or 0.0) < SPECIFICITY_BAR, f"share {share}")
    # A collision is two task ids reduced to one key, which is the material crossing tasks — the one thing this
    # arm exists to not be.
    report.refute("two tasks shared a key", (number(notes.get("collisions")) or 0) > 0,
                  f"{int(number(notes.get('collisions')) or 0)} collision(s)")

    if no_failure:
        # The one place this document leaves the measurement states for a reason that is not an instrument fault.
        # Nothing below can be tested: with no failure to distil there is no note, with no note there is no hit,
        # no coverage and no specificity — and every one of those absences would have read as the mechanism's.
        # The state is `NO_MEASUREMENT` and not `ABANDONED` because the material has not been refuted, it has not
        # been tried; the line below is the one an operator greps to tell the two apart.
        report.note("reason: no-distilled-failure — the grid failed nothing after round 1, so N1-N3 were not "
                    "testable. This is a saturated grid, not a refuted mechanism: dispatch a harder one.")
        quote_pair()
        return ("NO_MEASUREMENT", report)

    # N4: the comparison, quoted last and quoted as withheld. The pilot's own interval is printed so the reader
    # can see *why* it cannot be a claim rather than being told that it cannot.
    passk = comparison.get("passK") if isinstance(comparison.get("passK"), dict) else {}
    paired = number(passk.get("paired"))
    delta = number(passk.get("deltaPp"))
    interval = passk.get("intervalPp")
    claim = artefact.get("claim")
    report.predict("N4 the two arms are paired over the same tasks", (paired or 0) > 0, f"paired={int(paired or 0)}")
    report.predict("N4 the pilot claims nothing", claim == "none", f"claim={claim!r}")
    if claim != "none":
        # Said in words rather than left to the failed prediction: a claim over six tasks is 30 pp of noise, and
        # the next reader of this log is the one deciding whether to quote it.
        report.note(f"the artefact states claim {claim!r} over {int(paired or 0)} task(s), which is not quotable")
    if isinstance(interval, list) and len(interval) == 2:
        quote_pair()
    else:
        return ("NO_MEASUREMENT", report)

    if report.refutation_fired:
        return ("ABANDONED", report)
    return ("GRADED", report)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="grade R206's pilot from its artefact")
    parser.add_argument("--dir", help="directory holding note-pilot.json")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if not arguments.dir:
        parser.error("--dir or --self-test")

    path = Path(arguments.dir) / "note-pilot.json"
    if not path.is_file():
        print(f"no pilot artefact at {path}", file=sys.stderr)
        return 2
    state, report = grade(json.loads(path.read_text()))
    print(report.render())
    print(state)
    return 0 if state in ("GRADED", "ABANDONED") else 1


# ----------------------------------------------------------------------------- self-test


def notes_block(
    *,
    coverage: float | None = 0.8,
    provider_failures: int = 0,
    hits: int = 11,
    lookups: int = 16,
    key_hits: int = 0,
    task_hits: int = 11,
    collisions: int = 0,
    specificity: float | None = 0.75,
    problem: str | None = None,
    gap: int = 0,
    failed: int = 20,
    tasks: int = 6,
    scope_tasks: list[str] | None = None,
    scope_problems: list[str] | None = None,
) -> dict[str, Any]:
    """The material census, with its four states summing to the failure count by construction.

    The closure is not decoration: the gate refuses a census that does not close, so a fixture that produced an
    unclosed one whenever it set a provider failure would have tested the closure instead of the gate it was
    aimed at. `gap` subtracts from the failure count it does not account for, which is the one way to build a
    document whose census is short.

    `scopeTasks` and `scopeProblems` default to the arm's healthy state — one sidecar per task, none ambiguous —
    because every other gate in this file is about the material and a fixture that was mis-scoped by default
    would test N5 instead of whatever the case was written for.
    """
    failed = int(failed)
    written = min(int((coverage or 0.0) * failed), failed - provider_failures)
    written = max(0, written)
    refused = max(0, failed - written - provider_failures)
    return {
        "lookups": lookups,
        "hits": hits,
        # R207: the two identities. The fixture's default is that every hit came from the file, which is the
        # mechanism this arm claims; a case that wants the older reading sets `key_hits`.
        "keyHits": key_hits,
        "taskHits": task_hits,
        "coverage": coverage,
        "failed": failed - gap,
        "written": written,
        "refused": refused,
        "providerFailures": provider_failures,
        "collisions": collisions,
        "specificity": {"graded": 20, "specific": int((specificity or 0.0) * 20), "share": specificity},
        "problem": problem,
        "materialTokens": 3_000,
        "scopeTasks": [str(index + 1) for index in range(tasks)] if scope_tasks is None else scope_tasks,
        "scopeProblems": [] if scope_problems is None else scope_problems,
    }


def _artefact(
    *,
    agent: str = "microglia_agent",
    material: str = "notes",
    rounds: int = 4,
    tasks: int = 6,
    control_passes: int = 3,
    treatment_passes: int = 4,
    hits: int = 11,
    lookups: int = 16,
    task_hits: int = 11,
    coverage: float | None = 0.8,
    specificity: float | None = 0.75,
    collisions: int = 0,
    provider_failures: int = 0,
    failed: int = 20,
    problem: str | None = None,
    control_notes: dict | None = None,
    claim: str = "none",
    facade: bool = False,
    dishonest: bool = False,
    episodes: int | None = None,
    interval: list[float] | None = None,
    census_gap: int = 0,
    scope_tasks: list[str] | None = None,
    scope_problems: list[str] | None = None,
) -> dict[str, Any]:
    """A pilot artefact of the shape `note_pilot.py` writes, with only the fields this file reads.

    The rewards are built from the pass counts so the headline is reproducible: a fixture that stated a score
    its rows could not produce would test the gate as if it were a formality, and the gate's whole first job is
    to refuse exactly that.
    """

    def rows(passes: int) -> list[dict[str, Any]]:
        out = []
        for index in range(tasks):
            held = index < passes
            # A task that did not hold all k passed a share of them: the episode rate is what tells a redraw
            # from a mechanism, so a fixture where both levels move together would not exercise it.
            rewards = [1.0] * rounds if held else ([1.0] * (rounds - 1) + [0.0] if index % 2 else [0.0] * rounds)
            out.append({"id": str(index + 1), "rewards": rewards, "pass": held})
        return out

    held_control, held_treatment = rows(control_passes), rows(treatment_passes)
    delta = (treatment_passes - control_passes) / tasks * 100
    return {
        "schema": SCHEMA,
        "registered": "R206",
        "pilot": True,
        "claim": claim,
        "claimReason": "a pilot resolves nothing",
        "configuration": {
            "domain": "retail",
            "tasks": [str(index + 1) for index in range(tasks)],
            "rounds": rounds,
            "seeds": [300, 301, 302, 303][:rounds],
            "release": "v1.0.1",
            "agent": agent,
            "material": material,
            "controlMaterial": None,
            **({"memoryUrl": "http://127.0.0.1:9"} if facade else {}),
        },
        "arms": {
            "control": {
                "agent": agent,
                "tasks": tasks,
                "episodes": episodes if episodes is not None else tasks * rounds,
                "passK": (1.0 if dishonest else control_passes / tasks),
                "perTask": held_control,
                **({} if control_notes is None else control_notes),
            },
            "treatment": {
                "agent": agent,
                "tasks": tasks,
                "episodes": tasks * rounds,
                "passK": (0.0 if dishonest else treatment_passes / tasks),
                "perTask": held_treatment,
            },
        },
        "notes": notes_block(coverage=coverage, provider_failures=provider_failures, hits=hits, lookups=lookups,
                             task_hits=task_hits, collisions=collisions, specificity=specificity, problem=problem,
                             gap=census_gap, failed=failed, tasks=tasks, scope_tasks=scope_tasks,
                             scope_problems=scope_problems),
        "comparison": {
            "passK": {
                "paired": tasks,
                "deltaPp": delta,
                "intervalPp": interval if interval is not None else [delta - 30.0, delta + 30.0],
                "treatmentOnly": max(0, treatment_passes - control_passes),
                "controlOnly": 0,
            }
        },
    }


CASES: list[tuple[str, dict[str, Any], str]] = [
    ("a pilot whose mechanism was observed is graded", _artefact(), "GRADED"),
    ("a stock agent is another arm", _artefact(agent="llm_agent"), "DISCARDED"),
    ("a facade is another arm", _artefact(facade=True), "DISCARDED"),
    ("a block body is another arm", _artefact(material="rendered"), "DISCARDED"),
    # N5, the arm's own gate. A sidecar that names no task is R206's defect wearing R207's fix, so it is not this
    # arm at all; a fold with fewer scopes than tasks is this arm with a hole in it.
    ("a sidecar that names no task is discarded",
     _artefact(scope_problems=["/tmp/notes-5.json: scope is 'none'"]), "DISCARDED"),
    ("a sidecar that lists several tasks is discarded",
     _artefact(scope_problems=["/tmp/notes-5.json: scope is 'many'"]), "DISCARDED"),
    ("a fold with fewer scopes than tasks is unmeasured",
     _artefact(scope_tasks=["1", "2", "3", "4", "5"]), "NO_MEASUREMENT"),
    ("a fold whose scopes name another task is unmeasured",
     _artefact(scope_tasks=["1", "2", "3", "4", "5", "7"]), "NO_MEASUREMENT"),
    ("a treatment that read nothing abandons the pilot", _artefact(hits=0, lookups=16), "ABANDONED"),
    # N0b. R207's own pilot, to the number: six tasks, four rounds, one failure, and that failure in the last
    # round — so the failure count over the rounds a note is written from is zero and the sidecar was never given
    # a sentence. The reading must be `NO_MEASUREMENT` and not `ABANDONED`: nothing about the material was tried.
    ("a grid that failed nothing after round one is unmeasured",
     _artefact(failed=0, coverage=None, hits=0, lookups=24, task_hits=0, specificity=None), "NO_MEASUREMENT"),
    # The two populations are different findings, and the second is a real refutation of the material's premise:
    # failures existed and the summariser declined all of them. It must fail on coverage, not on the reader.
    ("a summariser that declined every failure fails on coverage", _artefact(coverage=0.0, hits=0), "ABANDONED"),
    ("a sidecar the agent never asked for abandons the pilot", _artefact(hits=0, lookups=0), "ABANDONED"),
    ("a control that found a note is a leak", _artefact(control_notes={"lookups": 4, "hits": 2}), "ABANDONED"),
    ("a control that only asked is a leak too", _artefact(control_notes={"lookups": 4, "hits": 0}), "ABANDONED"),
    ("arms that attempted different amounts abandon the pilot", _artefact(episodes=18), "ABANDONED"),
    ("a provider failure inside the summariser abandons the pilot", _artefact(provider_failures=2), "ABANDONED"),
    ("an unreadable sidecar abandons the pilot", _artefact(problem="JSONDecodeError: line 1"), "ABANDONED"),
    ("coverage below the bar abandons the pilot", _artefact(coverage=0.35), "ABANDONED"),
    ("coverage at the bar is quotable", _artefact(coverage=COVERAGE_BAR), "GRADED"),
    ("notes that restate the request abandon the pilot", _artefact(specificity=0.4), "ABANDONED"),
    ("two tasks sharing a key abandon the pilot", _artefact(collisions=1), "ABANDONED"),
    # The pilot's claim is withheld, so a flat reading is the expected shape rather than a defect: this is the
    # arm's whole purpose — decide whether to buy the fold, not to declare a win.
    ("a flat reading is still a graded pilot", _artefact(control_passes=3, treatment_passes=3), "GRADED"),
    ("a claim on a pilot fails its prediction without discarding the measurement", _artefact(claim="pass^4"), "GRADED"),
    ("a headline its rows cannot produce is unmeasured", _artefact(dishonest=True), "NO_MEASUREMENT"),
    ("an interval that is not a pair is unmeasured", _artefact(interval=[1.0]), "NO_MEASUREMENT"),
    # The instrument, not the material: one failed attempt is in none of the four states, so every share below
    # is a share of a denominator nobody can reconstruct.
    ("a census that does not close is unmeasured", _artefact(census_gap=1), "NO_MEASUREMENT"),
]

ABSENCES: list[tuple[str, tuple[str, ...]]] = [
    ("a document with no arms is unmeasured", ("arms",)),
    ("a document with no material census is unmeasured", ("notes",)),
    ("a document with no comparison is unmeasured", ("comparison",)),
    ("a document with no configuration is unmeasured", ("configuration",)),
    ("a document with no rows is unmeasured", ("arms", "control", "perTask")),
]


def _without(artefact: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    holder: Any = artefact
    for key in path[:-1]:
        holder = holder[key]
    del holder[path[-1]]
    return artefact


BROKEN_ROWS: list[tuple[str, Any, str]] = [
    ("a row that is not an object is unmeasured", ["x"], "NO_MEASUREMENT"),
    ("a row with no rewards is unmeasured", [{"id": "1"}], "NO_MEASUREMENT"),
    ("a row with no id is unmeasured", [{"rewards": [1.0]}], "NO_MEASUREMENT"),
    ("a row with an unscored trial is unmeasured", [{"id": "1", "rewards": [None]}], "NO_MEASUREMENT"),
]


def _rows_artefact(rows: Any) -> dict[str, Any]:
    """An artefact whose treatment carries these rows instead of the fixture's.

    The rows are the level `rows_of` guards, and a gate that read a malformed row as a score would publish a
    `pass^k` over a task nobody attempted. Each case here is one branch of that guard.
    """
    artefact = _artefact()
    artefact["arms"]["treatment"]["perTask"] = rows
    return artefact


def _cases() -> list[tuple[str, Any, str]]:
    """Every case this file grades itself on, in one list so one runner reports them all.

    Assembled rather than declared as a literal because three of the five groups are derived — an absence is the
    fixture with one key deleted, a broken row is the fixture with its rows replaced — and a list built by hand
    twice is the list that drifts from the cases it is supposed to run.
    """
    cases: list[tuple[str, Any, str]] = list(CASES)
    for name, path in ABSENCES:
        cases.append((name, _without(_artefact(), path), "NO_MEASUREMENT"))
    for name, rows, expected in BROKEN_ROWS:
        cases.append((name, _rows_artefact(rows), expected))
    cases.extend([
        ("an artefact from another round is not measured", {"schema": "microglia.pack-ledgers/2"}, "NO_MEASUREMENT"),
        ("a document that is not an object is not measured", [], "NO_MEASUREMENT"),
    ])
    # An R206 artefact — one with a material census and no scopes at all — is another arm and not a broken one.
    # The distinction is why N5 reports `DISCARDED` and not `NO_MEASUREMENT`: a document that predates the field
    # is a document from before this arm existed, and grading it as unmeasured would blame the instrument for the
    # record's own history.
    unscoped = _artefact()
    del unscoped["notes"]["scopeTasks"]
    del unscoped["notes"]["scopeProblems"]
    cases.append(("an artefact with no scope census is another arm", unscoped, "DISCARDED"))
    cases.append(("an artefact whose scopes are all its tasks is this arm", _artefact(), "GRADED"))
    return cases


def run_cases(cases: list[tuple[str, Any, str]]) -> "tuple[list[str], list[str]]":
    """`(passed, failed)` with each failure carrying the state and the report that produced it.

    The reporter is a function rather than a loop inside `self_test` for one reason: its *failure* path is the
    half that matters — a suite that cannot fail is a suite whose green means nothing — and the only way to
    exercise it is to hand it a case that must not pass. `self_test` does exactly that below, which is why these
    lines are measured rather than assumed.
    """
    passed: list[str] = []
    failed: list[str] = []
    for name, artefact, expected in cases:
        state, report = grade(artefact)
        if state == expected:
            passed.append(name)
        else:
            failed.append(f"{name}: expected {expected}, got {state}\n{report.render()}")
    return passed, failed


def self_test() -> int:
    cases = _cases()
    passed, failed = run_cases(cases)
    for name in passed:
        print(f"PASS  {name}")
    for line in failed:
        print(f"FAIL  {line}")

    checks = len(cases)
    # The reporter's own failure path, driven deliberately and required to fire: a case whose expectation is
    # wrong must be reported as a failure, naming the state it produced instead.
    probe_passed, probe_failed = run_cases([("a case that must not pass", _artefact(), "NO_MEASUREMENT")])
    checks += 1
    if probe_passed or len(probe_failed) != 1 or "expected NO_MEASUREMENT, got GRADED" not in probe_failed[0]:
        failed.append(f"the reporter did not report a wrong expectation: {probe_passed}, {probe_failed}")
        print("FAIL  a wrong expectation is reported")
    else:
        print("PASS  a wrong expectation is reported")

    # The command line, which is what the workflow runs: `--dir` finds the artefact or says it is not there, and
    # the state is printed last so `tail -n 1` — the spelling both callers use — is the answer.
    import contextlib
    import io
    import json as _json
    import tempfile

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal checks
        checks += 1
        if condition:
            print(f"PASS  {name}")
        else:
            failed.append(f"{name}{': ' + detail if detail else ''}")
            print(f"FAIL  {name}{'' if not detail else f'  ({detail})'}")

    # N0b, read from the report rather than from the state. A saturated grid must produce **no** refutation: the
    # whole defect was that three of them fired, in words that blamed the agent for reading an empty file and the
    # summariser for a corpus it was never given. The state alone cannot show that, so these two cases read the
    # rendered lines and are the reason the fix is a fix rather than a relabelling.
    saturated_state, saturated = grade(
        _artefact(failed=0, coverage=None, hits=0, lookups=24, task_hits=0, specificity=None)
    )
    saturated_text = saturated.render()
    check("a saturated grid refutes nothing", "FIRED" not in saturated_text, saturated_text)
    check("a saturated grid still reports that the file was asked for", "N1 the treatment asked for one" in saturated_text)
    check("a saturated grid names the population as the reason",
          "reason: no-distilled-failure" in saturated_text, saturated_text)
    coverage_line = next(
        (line for line in saturated_text.splitlines() if "N2 coverage clears the bar" in line), ""
    )
    check("a saturated grid marks coverage not-applicable rather than failed",
          coverage_line.strip().startswith("n/a"), coverage_line)
    refused_state, refused = grade(_artefact(coverage=0.0, hits=0))
    refused_text = refused.render()
    check("a summariser that declined everything abandons on the coverage gate",
          refused_state == "ABANDONED" and "the summariser wrote notes for too few failures" in refused_text,
          refused_text)
    check("and is not blamed on a file nobody wrote to",
          "clear the treatment never read its sidecar" in refused_text, refused_text)

    with tempfile.TemporaryDirectory() as directory:
        check("a directory with no artefact exits 2", main(["--dir", directory]) == 2)
        path = Path(directory) / "note-pilot.json"
        path.write_text(_json.dumps(_artefact()), encoding="utf-8")
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            code = main(["--dir", directory])
        lines = [line for line in printed.getvalue().splitlines() if line.strip()]
        check("a directory holding a graded pilot exits 0", code == 0, str(code))
        check("the state is the last line", bool(lines) and lines[-1] == "GRADED", str(lines[-1:]))
        # An artefact that cannot answer is a non-zero exit, which is the difference between a job that reads and
        # a job that re-dispatches: `DISCARDED` and `NO_MEASUREMENT` are both "fix the fold", not "try again".
        path.write_text(_json.dumps(_artefact(hits=0, lookups=0)), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            check("an abandoned pilot exits 0", main(["--dir", directory]) == 0)
        path.write_text(_json.dumps({"schema": "microglia.pack-ledgers/2"}), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            check("an unmeasured document exits 1", main(["--dir", directory]) == 1)
        refused = None
        try:
            main([])
        except SystemExit as error:
            refused = error.code
        check("no directory and no self-test is refused", refused == 2, str(refused))

    print(f"\n{checks} cases, {len(failed)} failure(s)")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
