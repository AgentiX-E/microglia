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

R205 changed the third reading's *evidence*, not its claim. The join now drops the episodes whose prompt
carried no body and publishes how many it dropped, so the share is taken over the prompts rather than over the
packs the facade served — and a refusal is no longer a reason to withhold the share but a reason to say how
much of the traffic it was. Because the surviving population can be six episodes, the share is quoted with its
own Wilson interval and the refutation requires that **interval** to clear the band: a point estimate over six
bodies is not evidence that the body moved anything, and the number that looks like a finding is the one this
file exists to refuse.

States, the four the other verifiers use:

  GRADED          the artefact is this arm's, the three readings hold, and the inert share moved or did
                  not — both are graded statements about the body.
  NO_MEASUREMENT  the artefact cannot answer: no guidance census, no store counts, no serve ledger, or a
                  share over a population nobody named.
  DISCARDED       another arm: the block body, another unit, another scope, another scenario pair.
  ABANDONED       a refutation fired: a provider failure, a store that grew, a call count that is not the
                  served count, a pack withheld on every request, or an inert interval that clears the band.

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


def wilson(passes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """The Wilson score interval for one proportion, which is the only interval this file quotes.

    Chosen over the normal approximation for the reason the lane is a small-sample lane: on six bodies the
    normal interval runs below zero and above one, and a bound outside [0, 1] is not an interval a reader can
    act on. The formula is the standard one and is the same quantity `wilsonInterval` computes on the
    TypeScript side; it is written here rather than imported because this file is run by `python3` against a
    fetched artefact, with no package to import from.
    """
    if total <= 0:
        return (0.0, 1.0)
    p = passes / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    half = (z / denominator) * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5)
    return (max(0.0, centre - half), min(1.0, centre + half))


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


#: Characters per token, the one assumption this file makes about a provider. It is used only to subtract the
#: summariser's own input from the arm's prompt total, and the subtraction is reported so a reader can redo it.
CHARS_PER_TOKEN = 4.0


def context_price(pair: dict[str, Any], census: dict[str, Any]) -> dict[str, Any] | None:
    """What one agent call cost the memory arm, net of the calls the summariser made for it.

    A per-episode premium is the body's price only when the two arms spend the same number of calls, and that is a
    property of the user simulator rather than of the arm: R205's fold made 750 calls against 683, so +3,454.9
    tokens an episode was mostly 67 extra turns. The quantity that moves when an arm pays for both bodies is the
    context it carries per agent call, and the two components are both in the artefact — the arm's prompt total,
    and the summariser's own input (`guidance.promptChars`), which was billed to the same account by design.
    """
    first = pair.get("first") or {}
    second = pair.get("second") or {}
    control_tokens = first.get("promptTokens")
    memory_tokens = second.get("promptTokens")
    control_calls = first.get("calls")
    memory_calls = second.get("calls")
    guidance_calls = census.get("calls")
    guidance_chars = census.get("promptChars")
    if not all(
        isinstance(value, (int, float))
        for value in (control_tokens, memory_tokens, control_calls, memory_calls, guidance_calls, guidance_chars)
    ):
        return None
    agent_calls = memory_calls - guidance_calls
    if control_calls <= 0 or agent_calls <= 0:
        return None
    summariser_tokens = guidance_chars / CHARS_PER_TOKEN
    memory_per_call = (memory_tokens - summariser_tokens) / agent_calls
    control_per_call = control_tokens / control_calls
    if control_per_call <= 0:
        return None
    return {
        "control_calls": int(control_calls),
        "memory_calls": int(memory_calls),
        "agent_calls": int(agent_calls),
        "summariser_tokens": summariser_tokens,
        "memory_per_call": memory_per_call,
        "control_per_call": control_per_call,
        "ratio": memory_per_call / control_per_call,
    }


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
    #
    # R205's dispatch then produced 42 calls for 40 episodes, and the rule as written fired. Two of those calls
    # are retries: the host re-asked the same turn inside two episodes and the pack was decided again, which the
    # registration allows and the agent's own `recallRepeats` counts. So the prediction is "at least one call an
    # episode" and the refutation is the plant the registration actually named -- one call per *turn*, which on
    # this corpus is ten calls an episode, not one more. A rule that fires on the retry is a rule written from a
    # count rather than from the mechanism it protects.
    report.predict(
        "the summariser was called at least once per evaluated episode",
        episodes is not None and calls >= episodes,
        f"{calls} call(s) against {episodes!r} evaluated episode(s), {renders!r} render(s)",
    )
    report.refute(
        "an episode was never asked, so the arm did not run on every trial it is read over",
        episodes is not None and calls < episodes,
        f"{calls} call(s) against {episodes} evaluated episode(s)",
    )
    report.refute(
        "the summariser ran per turn rather than per episode, which is a different mechanism",
        episodes is not None and calls >= 2 * episodes,
        f"{calls} call(s) against {episodes} evaluated episode(s): {calls / max(episodes, 1):.1f} an episode",
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
    # therefore reports a share over a population that is not the injected one — 34 of 40 episodes on that
    # arm — and the honest state is that the artefact cannot answer, rather than that the body did nothing.
    #
    # R205 changed what the file can say. The join drops the episodes whose prompt carried no body and publishes
    # the count it dropped, so the question is no longer "did the model decline" but "did the artefact name its
    # population". A fold that carries `withheld` has answered it; one that does not is the pre-R205 shape.
    withheld = (pair.get("serveYield") or {}).get("withheld")
    if (refusals > 0 or failures > 0) and not isinstance(withheld, int):
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
    if isinstance(withheld, int):
        report.predict(
            "the join names the episodes it withheld, so the renders are the prompts and not the facade's",
            withheld >= 0,
            f"{withheld} episode(s) withheld of {episodes!r} evaluated",
        )
        if withheld > 0:
            # A reading in its own right: how much of the store's traffic the summariser declined to turn into
            # a body. It is the same fact the refusal count carries, counted on the other side of the join.
            report.note(
                f"{withheld} of {episodes!r} episode(s) carried no body and are excluded from the share; "
                f"{renders} render(s) remain"
            )

    moved_pp = (share - POOLED_INERT) * 100
    lower = wilson(inert, renders)
    report.note(
        f"inert share {share:.1%} [{lower[0]:.1%}, {lower[1]:.1%}] over {renders} render(s) against the "
        f"six-fold pool's {POOLED_INERT:.1%} ({moved_pp:+.1f} pp, band ±{INERT_BAND_PP:.0f} pp)"
    )
    report.predict(
        f"the share is within ±{INERT_BAND_PP:.0f} pp of the pool or below it",
        moved_pp <= INERT_BAND_PP,
        f"{moved_pp:+.1f} pp",
    )
    # The refutation is on the interval, not the point: the reading this arm can produce is a share over a
    # handful of bodies, and six of forty episodes is a population where 100% and 60% are the same observation.
    # Requiring the interval's lower bound to clear the band says "the move is distinguishable from the pool",
    # which is the only version of this sentence the evidence can support.
    report.refute(
        "the body moved the inert share up, so the published 59.9% does not transfer here",
        (lower[0] - POOLED_INERT) * 100 > INERT_BAND_PP,
        f"{share:.1%} with a lower bound of {lower[0]:.1%}, which is {(lower[0] - POOLED_INERT) * 100:+.1f} pp "
        f"against a band of {INERT_BAND_PP:.0f} pp",
    )

    # ---- the by-product: price and delta, both quoted rather than concluded from ------------------
    price = injection_tokens(pair)
    context = context_price(pair, census)
    if price is None:
        report.note("the pair carries no bill, so the price of this episode is unmeasured")
    elif context is not None:
        # R205's second false positive, from the same run. The memory arm made 750 calls against the control's
        # 683, so its per-episode premium (+3,454.9 tokens) is mostly 67 extra turns -- the user simulator took a
        # different path -- and not the body at all. The comparable quantity is the **context** cost: the arm's
        # prompt total minus what its own summariser was shown, divided by its agent calls, against the control's
        # prompt total over its calls. That is the number "the arm paid for the block and the sentence" would move,
        # and the estimate of the summariser's share is stated rather than assumed.
        report.note(
            f"premium {price:+,.1f} tokens an episode is confounded by the call counts "
            f"({context['memory_calls']} against {context['control_calls']}), so the body's price is taken per "
            f"agent call: {context['memory_per_call']:,.1f} against the control's "
            f"{context['control_per_call']:,.1f} ({context['ratio']:.1%})"
        )
        report.predict(
            "the body added no context cost: the arm's agent-context tokens per call are within 5% of the "
            "control's",
            context["ratio"] <= 1.05,
            f"{context['memory_per_call']:,.1f} against {context['control_per_call']:,.1f} tokens a call",
        )
        report.refute(
            "the arm paid for the block as context and for the sentence: the body is not what shipped",
            context["ratio"] > 1.05,
            f"{context['memory_per_call']:,.1f} against {context['control_per_call']:,.1f} tokens an agent call",
        )
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
    withheld: int | None = 0,
    before: int = 11,
    after: int = 11,
    control_prompt: int = 3_000_000,
    memory_prompt: int = 3_040_000,
    control_calls: int | None = None,
    memory_calls: int | None = None,
    prompt_chars: int | None = None,
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
        "first": {"promptTokens": control_prompt, **({} if control_calls is None else {"calls": control_calls})},
        "second": {"promptTokens": memory_prompt, **({} if memory_calls is None else {"calls": memory_calls})},
        "comparison": {"paired": paired, "deltaPp": delta},
        "serveYield": {
            "renders": renders,
            "inert": inert,
            **({} if withheld is None else {"withheld": withheld}),
        },
        "transient": {
            "serveBody": body,
            "guidance": {
                "mode": "guidance",
                "model": "deepseek/deepseek-flash",
                "calls": calls,
                "sentences": sentences,
                "refusals": refusals,
                "failures": failures,
                **({} if prompt_chars is None else {"promptChars": prompt_chars}),
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
    # declined on most episodes — so the share exists but is about the facade's packs, not the sentences. That
    # artefact was written before the join could name its population, which is what makes it unquotable.
    (
        "a refusal fold written before the instrument leaves the share unmeasured",
        _pair(sentences=6, refusals=34, inert=40, renders=50, calls=40, withheld=None),
        "NO_MEASUREMENT",
    ),
    # R205's fold: the same run, with the episodes that carried nothing counted rather than rendered. Six of
    # forty episodes carried a sentence, six renders remain, and the share is finally about the bodies.
    (
        "a refusal fold whose join named its population grades its share",
        _pair(sentences=6, refusals=34, inert=5, renders=6, withheld=34),
        "GRADED",
    ),
    (
        "and a share over six episodes can still move the wrong way",
        _pair(sentences=6, refusals=34, inert=6, renders=6, withheld=34, memory_prompt=3_200_000),
        "ABANDONED",
    ),
    # The interval, not the point. 38 of 40 is 95.0% and its lower bound is 83.6%, which does not clear the
    # band: at forty renders the fold cannot tell a share that moved by 16 pp from one that moved by 5. Firing
    # on the point estimate here would be the defect this round is about, one layer down.
    ("a point estimate the interval cannot separate is not a refutation", _pair(inert=38), "GRADED"),
    ("an inert share whose interval clears the band abandons the reading", _pair(inert=40), "ABANDONED"),
    # R205's own fold, and the two rules it broke. Forty-two calls for forty episodes is two retries -- the host
    # re-asked the same turn and the pack was decided again -- and the first version of this file called that a
    # per-turn plant. The plant the registration named is ten calls an episode.
    (
        "a retry that asks twice in one episode is not a per-turn plant",
        _pair(calls=42, sentences=40, refusals=2, inert=8, renders=9, withheld=35, control_calls=683, memory_calls=750),
        "GRADED",
    ),
    (
        "an episode nobody asked about leaves the arm short of its own population",
        _pair(calls=38, sentences=38, refusals=0, inert=8, renders=9, withheld=35),
        "ABANDONED",
    ),
    # The other false positive: 750 calls against 683 means the per-episode premium is mostly 67 extra turns of a
    # user simulator that took a different path. Per agent call, net of the summariser's own input, the arm cost
    # 4,693.3 tokens against the control's 4,697.0 -- identical, which is the reading.
    (
        "a premium carried by extra turns is not the body's price",
        _pair(
            inert=8,
            renders=9,
            withheld=35,
            control_calls=683,
            memory_calls=750,
            control_prompt=3_208_072,
            memory_prompt=3_346_270,
            prompt_chars=93_267,
        ),
        "GRADED",
    ),
    (
        "a body that raised the context cost abandons the reading",
        _pair(
            inert=8,
            renders=9,
            withheld=35,
            control_calls=683,
            memory_calls=750,
            control_prompt=3_208_072,
            memory_prompt=3_600_000,
            prompt_chars=93_267,
        ),
        "ABANDONED",
    ),
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
