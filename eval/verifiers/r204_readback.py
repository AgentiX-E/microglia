#!/usr/bin/env python3
"""R204 readback: did a sentence written per request do what a stored block could not?

The registration is `prereg/R204-transient-guidance.md`, and it was written before the dispatch for the
reason every one of these files exists: the round's readings are a shape, and a shape graded after the
number is a shape chosen by the number. The arm changes one field — `serveBody: guidance` — and its claim
is not a delta. Three readings, in the order the registration ordered them:

  the call        one guidance call per served episode, and the arm's usage exceeds its control's by one
                  call an episode with a positive prompt premium
  the store       `storeGrowth.grew` is false and `before == after`: the sentence was used and discarded
  the body        every served episode carried a sentence or a refusal, never a provider failure — a
                  failure injects nothing, so a fold with failures cannot quote its served share

The delta is the by-product and is quoted last, against the ±11 pp a 40-task half can resolve.

States, the four the other verifiers use:

  GRADED          the artefact is this arm's, the three readings hold, and the inert share moved or did
                  not — both are graded statements about the body.
  NO_MEASUREMENT  the artefact cannot answer: no guidance census, no store counts, no serve ledger.
  DISCARDED       another arm: the block body, another unit, another scope, another scenario pair.
  ABANDONED       a refutation fired: a provider failure, a store that grew, a call count that is not the
                  served count, or a pack withheld on every request.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r204
  python3 r204_readback.py --dir /tmp/r204
  python3 r204_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from r88_readback import Report, number

# Quoted from `prereg/R204-transient-guidance.md`, written before the measurement existed.
PREDICTED_RELEASE = "v1.0.1"
PREDICTED_TRAIN = 74
PREDICTED_TASKS = 40
REQUIRED_UNIT = "raw"
REQUIRED_SCOPE = "all"
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}
#: R200's pooled inert share, six folds and 291 served packs. The arm's primary reading is whether the
#: body moved it, and the band is the fold's own noise rather than a target.
POOLED_INERT = 0.787
INERT_BAND_PP = 10.0
#: R198's measured injection price on the block arm, the number a sentence arm should undercut.
BLOCK_INJECTED_TOKENS = 3_299.6
#: The resolution 40 held-out tasks support. Quoted beside the delta so the delta is not read as a result.
RESOLUTION_PP = 11.0


def guidance_of(pair: dict[str, Any]) -> dict[str, Any] | None:
    """The transient census the pair publishes, or `None` when the file does not carry one."""
    block = pair.get("transient")
    if not isinstance(block, dict):
        return None
    census = block.get("guidance")
    return census if isinstance(census, dict) else None


def store_of(pair: dict[str, Any]) -> dict[str, Any] | None:
    """The memory arm's two store counts, or `None`."""
    block = pair.get("transient")
    if not isinstance(block, dict):
        return None
    store = block.get("store")
    return store.get("memory") if isinstance(store, dict) else None


def injection_tokens(pair: dict[str, Any]) -> float | None:
    """The pair's own price: memory prompt tokens minus the control's, over the episodes measured."""
    first = pair.get("first") or {}
    second = pair.get("second") or {}
    control = first.get("promptTokens")
    memory = second.get("promptTokens")
    measured = (pair.get("comparison") or {}).get("paired")
    if not isinstance(control, (int, float)) or not isinstance(memory, (int, float)):
        return None
    if not isinstance(measured, int) or measured <= 0:
        return None
    return (memory - control) / measured


def grade(pair: dict[str, Any]) -> tuple[str, Report]:
    report = Report()

    treatment = pair.get("treatment")
    if not isinstance(treatment, dict):
        report.predict("the pair states the treatment it pooled", None, "treatment block absent")
        return "NO_MEASUREMENT", report

    # ---- the arm: is this R204's treatment at all? -----------------------------------------------
    body = treatment.get("serveBody")
    if body is None:
        report.predict(
            "the pair states the body the pack was made of", None, "serveBody absent: written before R204"
        )
        return "NO_MEASUREMENT", report
    if body != "guidance":
        report.refute(
            "the dispatch ran the sentence arm rather than the block arm",
            True,
            f"serveBody {body!r}",
        )
        return "DISCARDED", report

    unit = treatment.get("unit")
    scope = treatment.get("scope")
    # Absence is not disagreement. A pair whose arms state no store cannot be told apart from another store's
    # pair, which is `NO_MEASUREMENT`; a pair that states a *different* store is another arm, which is
    # `DISCARDED`. Collapsing the two would grade a missing field as a mis-dispatched run.
    if unit is None or scope is None:
        report.predict("the pair states the store it pooled", None, f"unit {unit!r}, scope {scope!r}")
        return "NO_MEASUREMENT", report
    if unit != REQUIRED_UNIT or scope != REQUIRED_SCOPE:
        report.refute(
            "the dispatch ran the registered store rather than another one",
            True,
            f"unit {unit!r}, scope {scope!r} against {REQUIRED_UNIT!r} and {REQUIRED_SCOPE!r}",
        )
        return "DISCARDED", report
    report.note(f"the arm is the raw store at scope {REQUIRED_SCOPE}, which is R99's store")

    scenario = pair.get("scenario")
    if isinstance(scenario, dict):
        mismatched = {
            key: scenario.get(key) for key, want in REQUIRED_SCENARIO.items() if scenario.get(key) != want
        }
        if mismatched:
            report.refute("the dispatch ran the registered scenario pair", True, json.dumps(mismatched))
            return "DISCARDED", report

    split = pair.get("foldSplit")
    episodes: int | None = None
    if isinstance(split, dict):
        learned = len(split.get("learned") or [])
        evaluated = len(split.get("evaluated") or [])
        episodes = evaluated
        report.predict(
            "the halves are the benchmark's: 74 learned, 40 held out",
            learned == PREDICTED_TRAIN and evaluated == PREDICTED_TASKS,
            f"{learned} / {evaluated} (registered {PREDICTED_TRAIN} / {PREDICTED_TASKS})",
        )
        report.refute(
            "the pair is no longer comparable to the folds before it",
            learned != PREDICTED_TRAIN or evaluated != PREDICTED_TASKS,
            f"{learned} / {evaluated}",
        )
    else:
        report.note("no foldSplit block: the halves cannot be graded from this file")

    # ---- reading 1: the call ------------------------------------------------------------------
    census = guidance_of(pair)
    renders = (pair.get("serveYield") or {}).get("renders")
    if census is None:
        report.predict(
            "the pair publishes the summariser's own census", None, "transient.guidance absent"
        )
        return "NO_MEASUREMENT", report
    calls = census.get("calls")
    sentences = census.get("sentences")
    refusals = census.get("refusals")
    failures = census.get("failures")
    for name, value in (("calls", calls), ("sentences", sentences), ("refusals", refusals), ("failures", failures)):
        if not isinstance(value, int):
            report.predict(f"the census counts {name}", None, f"guidance.{name} {value!r}")
            return "NO_MEASUREMENT", report

    report.refute(
        "a provider failure injects nothing, so a fold with failures cannot quote its served share",
        failures > 0,
        f"{failures} of {calls} guidance call(s) failed",
    )
    report.predict(
        "every call ended in a sentence or a refusal, never in silence of unknown origin",
        calls == sentences + refusals + failures,
        f"{sentences} sentence(s) + {refusals} refusal(s) + {failures} failure(s) against {calls} call(s)",
    )
    # The denominator is the episode, not the render: `serveYield.renders` counts the packs the facade served,
    # and an episode that recalls twice is two renders and one guidance call. The first draft of this check
    # compared the call count to `renders` and would have called the first healthy fold a per-turn plant — 40
    # calls against 50 renders on a run where every call was in the right place.
    report.predict(
        "the summariser was called once per evaluated episode, not once per turn",
        episodes is not None and calls == episodes,
        f"{calls} call(s) against {episodes!r} evaluated episode(s), {renders!r} render(s)",
    )
    # A call count that is not the episode count is one of the refutations: the registration bought one
    # sentence an episode, and a plant that runs the summariser per turn has changed the mechanism it was
    # registered to test. Guarded on the split being readable, so a file that omits it is unmeasured rather
    # than abandoned.
    report.refute(
        "the summariser ran a different number of times than there were episodes",
        episodes is not None and calls != episodes,
        f"{calls} call(s) against {episodes} evaluated episode(s)",
    )
    report.refute(
        "the pack was withheld on every request: the reading is about the prompt, not the mechanism",
        isinstance(renders, int) and renders > 0 and sentences == 0,
        f"{sentences} sentence(s) over {renders!r} served episode(s)",
    )
    # The refusal share is a reading, not a verdict: a model that declines on most requests is telling us
    # something about the store the records came from, and the registration predicts 60–100% sentences.
    sentence_share = sentences / calls if calls else 0.0
    report.predict(
        "between 60% and 100% of served episodes got a sentence",
        0.60 <= sentence_share <= 1.0,
        f"{sentence_share:.1%} of {calls} call(s)",
    )

    # ---- reading 2: the store -----------------------------------------------------------------
    store = store_of(pair)
    if store is None:
        report.predict("the pair publishes the memory arm's store counts", None, "transient.store.memory absent")
        return "NO_MEASUREMENT", report
    before = store.get("before")
    after = store.get("after")
    grew = store.get("grew")
    report.predict(
        "the store is the same size at the end of the phase as at the start",
        isinstance(before, int) and isinstance(after, int) and before == after and grew is False,
        f"{before!r} → {after!r}, grew {grew!r}",
    )
    report.refute(
        "the evaluation phase wrote to the store, which makes this a lesson arm with a step in front of it",
        grew is True or (isinstance(before, int) and isinstance(after, int) and after > before),
        f"{before!r} → {after!r}",
    )

    # ---- reading 3: the body's effect on the share this line of work is about --------------------
    inert = (pair.get("serveYield") or {}).get("inert")
    share = inert / renders if isinstance(inert, int) and isinstance(renders, int) and renders > 0 else None
    if share is None:
        report.predict("the fold prices the inert share", None, "serveYield.inert or renders absent")
        return "NO_MEASUREMENT", report
    # R204's own instrument finding, from the first dispatch: a request whose guidance call answered `NONE`
    # carried no pack at all, while `serveYield.renders` counts what the facade served. A fold with refusals
    # therefore reports a share over a population that is not the injected one — 34 of 40 episodes on this
    # arm — and the honest state is that the artefact cannot answer, rather than that the body did nothing.
    if refusals > 0 or failures > 0:
        report.predict(
            "the served population is the injected population, so the share is a statement about the body",
            None,
            f"{refusals} of {calls} call(s) answered NONE, {failures} failed, against {renders} render(s)",
        )
        report.note(
            "the inert share is not quotable on this fold: an episode with no sentence carried no pack, and "
            "`serveYield` counts the facade's packs rather than the bodies the agent read"
        )
        return ("ABANDONED" if report.refutation_fired else "NO_MEASUREMENT"), report

    moved_pp = (share - POOLED_INERT) * 100
    report.note(
        f"inert share {share:.1%} against the six-fold pool's {POOLED_INERT:.1%} "
        f"({moved_pp:+.1f} pp, band ±{INERT_BAND_PP:.0f} pp)"
    )
    report.predict(
        f"the share is within ±{INERT_BAND_PP:.0f} pp of the pool or below it",
        moved_pp <= INERT_BAND_PP,
        f"{moved_pp:+.1f} pp",
    )
    report.refute(
        "the body moved the inert share up, so the published 59.9% does not transfer here",
        moved_pp > INERT_BAND_PP,
        f"{moved_pp:+.1f} pp above the pool",
    )

    # ---- the by-product: price and delta, both quoted rather than concluded from ------------------
    price = injection_tokens(pair)
    if price is None:
        report.note("the pair carries no bill, so the price of this episode is unmeasured")
    elif price < 0:
        # No pack-serving arm can spend less than its control: a negative premium is the refusals showing up in
        # the bill, and reading it as an efficiency is the mistake this branch exists to prevent.
        report.predict(
            "the arm's prompt total exceeds its control's, which is what serving a pack looks like",
            False,
            f"{price:,.1f} tokens an episode — the arm injected less than nothing",
        )
    else:
        report.predict(
            f"a sentence arm costs less than the block arm's {BLOCK_INJECTED_TOKENS:,.1f} tokens an episode",
            price < BLOCK_INJECTED_TOKENS,
            f"{price:,.1f} tokens an episode",
        )
        report.refute(
            "the arm paid for the block as context and for the sentence: the body is not what shipped",
            price >= BLOCK_INJECTED_TOKENS,
            f"{price:,.1f} against {BLOCK_INJECTED_TOKENS:,.1f}",
        )
    comparison = pair.get("comparison") or {}
    delta = number(comparison.get("deltaPp"))
    if delta is not None:
        report.note(
            f"delta {delta:+.2f} pp on {comparison.get('paired')!r} pairs, against the "
            f"±{RESOLUTION_PP:.0f} pp this half resolves — a by-product, not a finding"
        )

    return ("ABANDONED" if report.refutation_fired else "GRADED"), report


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="grade R204's three readings from a fetched artefact")
    parser.add_argument("--dir", help="directory holding poc-l4-pair.json and the two arm artefacts")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if not arguments.dir:
        parser.error("--dir or --self-test")

    path = Path(arguments.dir) / "poc-l4-pair.json"
    if not path.is_file():
        print(f"no pair artefact at {path}", file=sys.stderr)
        return 2
    state, report = grade(json.loads(path.read_text()))
    print(report.render())
    print(state)
    return 0 if state in ("GRADED", "ABANDONED") else 1


# ----------------------------------------------------------------------------- self-test


def _pair(
    *,
    body: str = "guidance",
    scope: str = "all",
    calls: int = 40,
    sentences: int = 40,
    refusals: int = 0,
    failures: int = 0,
    renders: int = 40,
    inert: int = 30,
    before: int = 11,
    after: int = 11,
    control_prompt: int = 3_000_000,
    memory_prompt: int = 3_040_000,
    paired: int = 40,
    delta: float = -2.5,
) -> dict[str, Any]:
    """A pair artefact of the shape the driver writes, with only the fields this file reads."""
    return {
        "treatment": {"unit": "raw", "form": "lesson", "scope": scope, "rotation": "none", "serveBody": body},
        "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
        "foldSplit": {
            "learned": [f"retail/{index}" for index in range(74)],
            "evaluated": [f"retail/{index}" for index in range(40)],
        },
        "first": {"promptTokens": control_prompt},
        "second": {"promptTokens": memory_prompt},
        "comparison": {"paired": paired, "deltaPp": delta},
        "serveYield": {"renders": renders, "inert": inert},
        "transient": {
            "serveBody": body,
            "guidance": {
                "mode": "guidance",
                "model": "deepseek/deepseek-flash",
                "calls": calls,
                "sentences": sentences,
                "refusals": refusals,
                "failures": failures,
            },
            "store": {"reference": None, "memory": {"before": before, "after": after, "grew": after > before}},
        },
    }


CASES = [
    ("a fold that met all three readings is graded", _pair(), "GRADED"),
    ("the block arm is another arm", _pair(body="rendered"), "DISCARDED"),
    ("another store is another arm", _pair(scope="edited"), "DISCARDED"),
    ("a provider failure abandons the reading", _pair(sentences=38, refusals=0, failures=2), "ABANDONED"),
    ("a store that grew abandons the reading", _pair(before=11, after=12), "ABANDONED"),
    ("a call per turn abandons the reading", _pair(calls=160), "ABANDONED"),
    ("a pack withheld everywhere abandons the reading", _pair(sentences=0, refusals=40, inert=40), "ABANDONED"),
    # The reading the first dispatch produced: the mechanism ran, the store did not move, and the summariser
    # declined on most episodes — so the share exists but is about the facade's packs, not the sentences.
    (
        "a fold whose summariser refused leaves the share unmeasured",
        _pair(sentences=6, refusals=34, inert=40, renders=50, calls=40),
        "NO_MEASUREMENT",
    ),
    ("an inert share above the band abandons the reading", _pair(inert=38), "ABANDONED"),
    ("a bill above the block arm's abandons the reading", _pair(memory_prompt=3_200_000), "ABANDONED"),
]


ABSENCES: list[tuple[str, tuple[str, ...]]] = [
    ("a fold without a census is unmeasured", ("transient", "guidance")),
    ("a fold without store counts is unmeasured", ("transient", "store", "memory")),
    ("a pair written before the field is unmeasured", ("treatment", "serveBody")),
    # The one absence that could be mistaken for a verdict: a pair that states no store at all is not a pair
    # that states another one, and grading it `DISCARDED` would report a mis-dispatched run that never happened.
    ("a pair that states no store is unmeasured rather than another arm", ("treatment", "unit")),
]


def _without(pair: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    """The same pair with one nested key removed, which is how a file from before a field looks."""
    holder: Any = pair
    for key in path[:-1]:
        holder = holder[key]
    del holder[path[-1]]
    return pair


def self_test() -> int:
    failures = 0
    for name, pair, expected in CASES:
        state, report = grade(pair)
        if state != expected:
            failures += 1
            print(f"FAIL  {name}: expected {expected}, got {state}\n{report.render()}")
        else:
            print(f"PASS  {name}")

    # Absences the state machine has to keep apart from a failure: a file that cannot answer is not a file whose
    # arm was refuted, and treating them as one is how a green job reads as a finding.
    for name, path in ABSENCES:
        state, _report = grade(_without(_pair(), path))
        if state != "NO_MEASUREMENT":
            failures += 1
            print(f"FAIL  {name}: got {state}")
        else:
            print(f"PASS  {name}")

    print(f"\n{len(CASES) + len(ABSENCES)} cases, {failures} failure(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
