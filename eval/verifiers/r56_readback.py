#!/usr/bin/env python3
"""R56 readback: grade a τ² dispatch against the registration that asked for it.

The registration is `prereg/R56-register.md`. R54 measured a store that was
conditioned (20 of 20 servable items), delivered (1,951 of 1,951 requests) and
still shared only 8.33% of the request's own terms, and its readback fired the
refutation it was written with: *the conditions exist and do not name the
situation*. Reading the items said why -- every condition was written in the
procedure's register, naming the tools the agent had called, because the
`lesson` form's guidance asks `when` to name "which tables or columns it
involves". In a lane whose input is a customer asking to cancel an order there is
no column to name.

R56's single variable is the form: `procedure` instead of `lesson`, plus a
host-side ban that refuses a candidate whose statement or condition names one of
the action names the split learned from. Four predictions, one bar, and one
refutation that closes the axis if it fires.

States. GRADED, NO_MEASUREMENT and ABANDONED are the three R49 and R51 use;
DISCARDED is R54's, kept for the same reason -- a dispatch that ran a different
experiment measured a different experiment, and reinterpreting it would be
choosing the subject of the claim at read time.

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot say which form ran, or carries no
                  inventory, so the treatment is not recoverable. R56's fourth
                  refutation spells this state out.
  DISCARDED       the scenario pair is not retail/retail/retail, or the form the
                  artefact records is not the one registered.
  ABANDONED       a refutation fired, or a prediction failed. Either way the
                  account of why the register decides the trigger is wrong.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r56
  python3 r56_readback.py --dir /tmp/r56 [--baseline /tmp/r54/poc-l4.json] [--pair /tmp/r56/poc-l4-pair.json]
  python3 r56_readback.py --self-test

`--pair` defaults to the first `poc-l4-pair.json` under `--dir`, because the
verdict and the paired delta are written by `eval:l4-pair` and not by either arm.
Reading them from the arm -- which is what this file did first -- made the revert
rule unfireable on real evidence.

Two defects this readback found in itself, both of which it now tests for:

  * it returned `NO_MEASUREMENT` at the missing form before writing down a single
    reading that had survived, so R56's HARM, its coverage and its funnel were
    dropped from the record of a run whose whole problem was a dropped field;
  * its revert refutation read `artefact["verdict"]`, a field no arm writes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import STOPPED_PREFIX, funnel_notes
from _pair import delta_of, verdict_of

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R56-register.md`, written before the dispatch, so the
# verifier cannot drift from the file it grades against.
PREDICTED_P50_MIN = 0.12
PREDICTED_TOOL_SHARE_DROP = 0.20
PREDICTED_ITEMS_MIN = 12
REQUIRED_FORM = "procedure"
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}
# 57 held-out retail tasks at pass^4 resolve 20.27pp (R54's readback). A drop
# larger than that is the one size this lane can actually see.
RESOLUTION_PP = 20.27


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool | None, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []
        self.context: list[str] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

    def note(self, text: str) -> None:
        self.context.append(text)

    @property
    def predictions_ok(self) -> bool:
        return all(ok is not False for _, ok, _ in self.predictions)

    @property
    def refutation_fired(self) -> bool:
        return any(fired for _, fired, _ in self.refutations)

    def render(self) -> str:
        lines = ["predictions:"]
        for name, ok, detail in self.predictions:
            mark = "n/a " if ok is None else ("PASS" if ok else "FAIL")
            lines.append(f"  {mark}  {name}{'' if not detail else f'  ({detail})'}")
        lines.append("refutations:")
        for name, fired, detail in self.refutations:
            lines.append(f"  {'FIRED' if fired else 'clear'} {name}{'' if not detail else f'  ({detail})'}")
        if self.context:
            lines.append("context (not graded):")
            for text in self.context:
                lines.append(f"  {text}")
        return "\n".join(lines)


def share(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def scenario_of(tau2: dict[str, Any]) -> dict[str, Any] | None:
    block = tau2.get("scenario")
    return block if isinstance(block, dict) else None


def form_of(tau2: dict[str, Any]) -> dict[str, Any] | None:
    block = tau2.get("distillForm")
    return block if isinstance(block, dict) else None


def sampled_items(tau2: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The items the artefact carries, or None when it carries none.

    `storeItems` is drawn from the whole store; `conditioned` and `servable` are
    counted over active items in the recall scope. The status is what lets a
    reading intersect the sample with the population the counts were taken over,
    and it is used here for exactly that.
    """
    block = tau2.get("storeItems")
    if not isinstance(block, dict):
        return None
    items = block.get("items")
    return items if isinstance(items, list) and items else None


def active_population(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    carries_status = any("status" in entry for entry in items)
    return [entry for entry in items if entry.get("status") == "active"] if carries_status else items


def tool_named(text: str, inventory: list[str]) -> list[str]:
    lowered = text.lower()
    return [name for name in inventory if name and name.lower() in lowered]


def tool_share(items: list[dict[str, Any]], inventory: list[str]) -> tuple[int, float | None]:
    """How many items name a tool, and the share. Mechanical: a substring match."""
    named = 0
    for entry in items:
        text = f"{entry.get('when') or ''}\n{entry.get('statement') or ''}"
        if tool_named(text, inventory):
            named += 1
    return named, share(named, len(items))


def pack_mentions(tau2: dict[str, Any], inventory: list[str]) -> tuple[int, list[str]]:
    """Packs whose injected text names a tool, and one example per name.

    The ban is on what becomes an item, so a tool name here means either that
    `accept` did not run or that an item predates it. Both are the same finding:
    the run measured a store the ban did not touch.
    """
    hits = 0
    examples: list[str] = []
    for observation in tau2.get("useObservations") or []:
        texts = observation.get("documents") or observation.get("statements") or []
        found: list[str] = []
        for text in texts:
            found.extend(tool_named(str(text), inventory))
        if found:
            hits += 1
            if len(examples) < 3:
                examples.append(f"{found[0]} in: {str(texts[0])[:120]}")
    return hits, examples


def baseline_share(baseline: dict[str, Any] | None) -> tuple[float | None, float | None, str]:
    """The R54 store's tool-name share, when the baseline artefact is supplied."""
    if baseline is None:
        return None, None, "no baseline artefact supplied: the drop is not graded"
    tau2 = baseline.get("tau2") or {}
    block = form_of(tau2)
    items = sampled_items(tau2)
    if items is None:
        return None, None, "the baseline carries no storeItems: the drop is not graded"
    inventory = [str(name) for name in (block or {}).get("toolInventory") or []]
    if not inventory:
        # R54 ran before the inventory existed. Its action names are the ones a
        # procedure-register store named, and they are recoverable from the
        # statements themselves -- but recovering them by reading the sentences
        # would let the baseline's share depend on the reading. Named instead.
        return None, None, "the baseline carries no tool inventory: the drop is not graded"
    named, value = tool_share(active_population(items), inventory)
    return value, named, f"baseline names {named} of {len(active_population(items))}"


def yield_of(tau2: dict[str, Any]) -> tuple[int | None, int | None, float | None]:
    """Candidates per correction, from the funnel or from the learning block.

    R54 distilled two candidates from each of ten corrections and R56 distilled
    one from each of eight, and that ratio -- not only the count of corrections,
    which the model decides at runtime -- is the proximate cause of the store
    shrinking from twenty items to eight. The funnel is the newer record and the
    one R56 carries; the learning block is what R54 carries and is read as the
    fallback so the two dispatches can be compared at all.
    """
    funnel = tau2.get("funnel") or {}
    learning = tau2.get("learning") or {}
    corrections = funnel.get("corrections", learning.get("edited"))
    candidates = funnel.get("candidates", learning.get("distilled"))
    if not isinstance(corrections, int) or not isinstance(candidates, int) or corrections <= 0:
        return None, None, None
    return corrections, candidates, candidates / corrections


def readings(
    report: Report,
    artefact: dict[str, Any],
    baseline: dict[str, Any] | None,
    pair: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Take every reading the artefact still supports, before deciding the state.

    R56's artefact lost `distillForm` and `storeItems` to a projection defect in
    the driver, and the first version of this verifier returned `NO_MEASUREMENT`
    at the missing form without writing down anything that had survived -- so the
    record of the run held no numbers at all, and the cost of the loss could not
    be stated in the same breath as the loss. A verifier that stops reading when
    it cannot grade throws away the evidence it was built to keep.

    Nothing here is graded. These are the readings a reader needs to understand a
    state, and they are taken first so that every terminal state carries them.
    """
    tau2 = artefact.get("tau2") or {}
    verdict = verdict_of(artefact, pair)
    coverage = tau2.get("coverage") or {}
    quantiles = coverage.get("nonzeroQuantiles") or {}
    medians = coverage.get("medians") or {}
    store = tau2.get("store") or {}
    recall = tau2.get("recall") or {}
    funnel = tau2.get("funnel") or {}
    learning = tau2.get("learning") or {}

    stored = store.get("stored")
    servable = store.get("servable")
    requests = recall.get("requests")
    mean_pack = tau2.get("meanPackIds")
    p50 = quantiles.get("p50")

    report.note(
        f"census: {stored if stored is not None else 'absent'} stored, "
        f"{servable if servable is not None else 'absent'} servable, "
        f"{requests if requests is not None else 'absent'} request(s); "
        f"mean {mean_pack if mean_pack is not None else 'n/a'} item(s) per pack"
    )
    if isinstance(p50, (int, float)):
        tail = ""
        if isinstance(quantiles.get("p90"), (int, float)) and isinstance(quantiles.get("max"), (int, float)):
            tail = f", p90 {quantiles['p90']:.4f}, max {quantiles['max']:.4f}"
        report.note(f"coverage p50 {p50:.4f}{tail}")
    else:
        report.note("coverage p50 absent")
    # The chain and, when the run stopped inside it, the driver's own sentence for why. Both come from
    # `_funnel`, which `r58_readback` reads too: one implementation of one claim.
    funnel_notes(report, artefact)
    corrections, candidates, per = yield_of(tau2)
    base_per = yield_of((baseline or {}).get("tau2") or {})[2]
    if per is None:
        report.note("yield: the artefact carries no correction/candidate pair, so the yield is not stated")
    elif base_per is None:
        report.note(
            f"yield: {candidates} candidate(s) from {corrections} correction(s) = {per:.2f} per "
            "correction, baseline yield not stated"
        )
    else:
        report.note(
            f"yield: {candidates} candidate(s) from {corrections} correction(s) = {per:.2f} per "
            f"correction, baseline {base_per:.2f}"
        )
    if isinstance(medians.get("medianAllPairs"), (int, float)):
        report.note(
            f"median over every delivered pair {medians['medianAllPairs']:.4f} "
            f"({medians.get('zeroPairs')} of {medians.get('pairs')} at zero) -- not graded"
        )

    report.note(
        f"paired pass^4: state {verdict.get('state')}, delta {delta_of(pair, verdict)}pp "
        f"(the pair resolves {RESOLUTION_PP}pp at this sample; not claimed)"
    )
    if verdict.get("state") == "HARM":
        # The number and the record fail separately. A `NO_MEASUREMENT` says the
        # artefact cannot identify the treatment; it does not say the arm cost
        # nothing. R45 reverts on the reading, and the reading is the pair file's.
        report.note(
            "the revert rule fires on that reading: R45 reverts the treatment, "
            "independently of whether this artefact can name it"
        )

    return {
        "p50": p50,
        "meanPackIds": mean_pack,
        "stored": stored,
        "servable": servable,
        "requests": requests,
        "learning": learning,
    }


def grade(
    artefact: dict[str, Any],
    baseline: dict[str, Any] | None = None,
    pair: dict[str, Any] | None = None,
) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}
    verdict = verdict_of(artefact, pair)

    # A dispatch that ran a different scenario pair measured a different
    # experiment. Read before anything else, as R54 does.
    scenario = scenario_of(tau2)
    if scenario is not None:
        mismatched = {
            key: scenario.get(key) for key, want in REQUIRED_SCENARIO.items() if scenario.get(key) != want
        }
        if mismatched:
            report.refute(
                "the dispatch ran the registered scenario pair",
                True,
                f"learn {scenario.get('learn')}, test {scenario.get('test')}, recall {scenario.get('recall')}",
            )
            return "DISCARDED", report
    else:
        report.note("no scenario block: written before R54 pinned the pair, read as the registered one")

    # Every reading the artefact still supports, taken before any state is
    # decided, so that a `NO_MEASUREMENT` is a statement about one field and not
    # a statement that the run produced nothing.
    observed = readings(report, artefact, baseline, pair)

    # The treatment, before its result. R56's fourth refutation: an artefact that
    # cannot say which form ran cannot be read as an experiment of two forms.
    form = form_of(tau2)
    if form is None:
        report.predict(
            "the artefact states the form the distiller was asked for",
            None,
            "no distillForm block: the treatment is not recoverable",
        )
        return "NO_MEASUREMENT", report
    if form.get("form") != REQUIRED_FORM:
        report.refute(
            "the run used the registered form",
            True,
            f"form {form.get('form')}",
        )
        return "DISCARDED", report
    inventory = [str(name) for name in form.get("toolInventory") or []]
    if not inventory:
        # The ban is vacuous without an inventory. A run that learned from no
        # tool call cannot test the register, and reading its coverage as the
        # form's effect would be measuring a prompt change with no enforcement.
        report.predict(
            "the ban had an inventory to refuse names from",
            None,
            "the run recorded no action names: the ban could not fire",
        )
        return "NO_MEASUREMENT", report
    report.predict(
        "the artefact states the form and the inventory the ban read",
        True,
        f"form {form.get('form')}, inventory {len(inventory)}, refused {form.get('refused')}",
    )

    stored = observed["stored"]
    servable = observed["servable"]
    requests = observed["requests"]
    if stored is None or servable is None or requests is None:
        report.predict("the census is present", None, "stored/servable/requests absent")
        return "NO_MEASUREMENT", report

    recall = tau2.get("recall") or {}
    coverage = tau2.get("coverage") or {}
    empty = recall.get("empty")
    if empty is None:
        empty = requests - (recall.get("served") or 0)
    empty_share = share(empty, requests)
    mean_pack = observed["meanPackIds"]
    p50 = observed["p50"]

    report.predict(
        f"median rule/query coverage reaches {PREDICTED_P50_MIN:.0%} or more",
        p50 is not None and p50 >= PREDICTED_P50_MIN,
        f"p50 {p50:.4f}" if p50 is not None else "p50 absent",
    )
    report.predict(
        f"at least {PREDICTED_ITEMS_MIN} items are admitted",
        stored >= PREDICTED_ITEMS_MIN,
        f"{stored} stored, {servable} servable",
    )

    items = sampled_items(tau2)
    current: float | None = None
    if items is None:
        # The share is the prediction that decides whether the register moved, and
        # it cannot be computed over a store the artefact did not carry. Reading
        # that as "no tool names" would pass the prediction by not measuring it.
        report.predict(
            "the artefact carries the store's own text",
            None,
            "storeItems absent: the register reading is not recoverable",
        )
        return "NO_MEASUREMENT", report
    if not active_population(items):
        report.predict(
            "the artefact carries at least one active item",
            None,
            f"{len(items)} sampled, none active",
        )
        return "NO_MEASUREMENT", report
    population = active_population(items)
    named, current = tool_share(population, inventory)
    base, base_named, base_note = baseline_share(baseline)
    if current is None or base is None:
        report.predict(
            f"the tool-name share falls by {PREDICTED_TOOL_SHARE_DROP:.0%}",
            None,
            f"current {current if current is None else round(current, 4)}; {base_note}",
        )
    else:
        report.predict(
            f"the tool-name share falls by {PREDICTED_TOOL_SHARE_DROP:.0%}",
            base - current >= PREDICTED_TOOL_SHARE_DROP,
            f"{base:.4f} -> {current:.4f} (drop {base - current:+.4f}); {base_note}, now {named} of {len(population)}",
        )
    report.note(
        f"storeItems: {len(population)} active of {len(items)} sampled, "
        f"{named} naming a tool, {sum(1 for e in items if e.get('when'))} with a condition"
    )

    hits, examples = pack_mentions(tau2, inventory)
    report.predict(
        "no tool name reaches the pack",
        hits == 0,
        f"{hits} pack(s) name a tool",
    )
    for example in examples:
        report.note(example)

    # The pipeline, funnel, yield and delivered-pair median are `readings`' notes,
    # taken before the state was decided so that an ungraded run still carries them.
    learning = tau2.get("learning") or {}
    measured = coverage.get("measuredPairs")
    unmeasurable = coverage.get("unmeasurablePairs")
    injected = (tau2.get("use") or {}).get("injectedPairs")
    population_ok = (
        measured is not None
        and unmeasurable is not None
        and injected is not None
        and measured + unmeasurable == injected
    )
    census_ok = 0 <= servable <= stored
    report.predict(
        "the instrument holds: non-empty packs, no distiller failure, one coverage population",
        (mean_pack or 0) > 0 and (learning.get("distillFailed") or 0) == 0 and population_ok and census_ok,
        f"mean {mean_pack}, distillFailed {learning.get('distillFailed')}, "
        f"pairs {measured}+{unmeasurable} vs injected {injected}, servable {servable} of {stored}",
    )
    report.predict(
        "the run is the registered trial count: four",
        (metrics.get("k") or 0) == 4,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )
    episodes = (metrics.get("tasks") or 0) * (metrics.get("k") or 0)
    report.note(
        f"episodes {episodes} ({metrics.get('tasks')} tasks at k={metrics.get('k')}); "
        "the registration declares sample 228 and reads the count as context"
    )

    # The paired delta is reported and not claimed, as the registration states
    # before it looks. A HARM verdict still reverts under R45 -- and the sentence
    # itself is `readings`' note, so a run that stops earlier still carries it.
    state = verdict.get("state")
    delta = delta_of(pair, verdict)

    # Refutations, each naming one way the account can be wrong.
    report.refute(
        "the accepted store is empty: the ban is too strict for a lane whose every sentence names an action",
        stored == 0,
        f"{stored} stored",
    )
    report.refute(
        "the register moved and the coverage did not: the trigger is not a vocabulary problem",
        p50 is not None
        and p50 < PREDICTED_P50_MIN
        and current is not None
        and current <= 0.0,
        f"p50 {p50}, tool-name share {current}",
    )
    report.refute(
        "the ban did not run: a tool name reached a pack",
        hits > 0,
        f"{hits} pack(s)",
    )
    report.refute(
        "the memory costs accuracy by more than this sample can resolve, and R45 reverts",
        state == "HARM" or (isinstance(delta, (int, float)) and delta < -RESOLUTION_PP),
        f"state {state}, delta {delta}",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def base_artefact(**over: Any) -> dict[str, Any]:
    """A clean GRADED artefact: the treatment ran and the register moved."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.44, "k": 4, "tasks": 57},
        "tau2": {
            "meanPackIds": 1.6,
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillForm": {
                "form": "procedure",
                "toolInventory": ["cancel_pending_order", "find_user"],
                "refused": 9,
            },
            "store": {"stored": 16, "active": 16, "servable": 16, "conditioned": 16, "unconditioned": 0},
            "recall": {"requests": 1951, "served": 1951, "empty": 0},
            "use": {"injectedPairs": 2950, "zeroCoveragePairs": 400},
            "coverage": {
                "measuredPairs": 2940,
                "unmeasurablePairs": 10,
                "nonzeroQuantiles": {"p50": 0.19, "p90": 0.55, "max": 1.0},
                "medians": {"pairs": 2940, "zeroPairs": 400, "medianAllPairs": 0.11, "medianNonzero": 0.19},
            },
            "storeItems": {
                "items": [
                    {
                        "id": "a",
                        "kind": "procedure",
                        "status": "active",
                        "when": "when the customer asks to cancel an order that has not shipped",
                        "statement": "confirm which order the customer means before acting",
                        "supportTasks": 1,
                        "evidence": 1,
                    },
                    {
                        "id": "b",
                        "kind": "procedure",
                        "status": "retired",
                        "when": "a retired trigger",
                        "statement": "call nothing",
                        "supportTasks": 1,
                        "evidence": 1,
                    },
                ],
                "limit": 64,
                "maxChars": 240,
                "omitted": 14,
                "truncated": 0,
            },
            "learning": {"rows": 32, "edited": 32, "distillFailed": 0},
            "domainOrigin": {"storedWithDomain": 16, "storedWithoutDomain": 0, "unscopedIn": 0},
            "funnel": {
                "corrections": 32,
                "candidates": 30,
                "admitted": 16,
                "stored": 16,
                "servable": 16,
                "refused": 12,
                "failed": 0,
            },
            "useObservations": [{"query": "cancel my order", "statements": ["confirm the order first"]}],
        },
        "verdict": {"state": "UNRESOLVED", "reason": "does not clear the resolution", "deltaPp": 5.26},
        "gates": [{"id": "l4-paired", "pass": True, "blocking": True}],
    }
    for path, value in over.items():
        node = artefact
        keys = path.split(".")
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = value
    return artefact


def baseline_artefact(**over: Any) -> dict[str, Any]:
    """R54's store: every condition names a tool, which is what the drop is measured against."""
    artefact: dict[str, Any] = {
        "tau2": {
            "distillForm": {
                "form": "lesson",
                "toolInventory": ["cancel_pending_order", "find_user"],
                "refused": 0,
            },
            "storeItems": {
                "items": [
                    {
                        "id": "a",
                        "status": "active",
                        "when": "when find_user returns a single row",
                        "statement": "call cancel_pending_order",
                    },
                    {
                        "id": "b",
                        "status": "active",
                        "when": "when the request names a user",
                        "statement": "call cancel_pending_order after find_user",
                    },
                ],
                "limit": 64,
                "maxChars": 240,
                "omitted": 0,
                "truncated": 0,
            },
        }
    }
    for path, value in over.items():
        node = artefact
        keys = path.split(".")
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = value
    return artefact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the arm artefacts")
    parser.add_argument("--baseline", help="an R54 artefact, for the tool-name share it measured")
    parser.add_argument(
        "--pair",
        help="the pairing artefact (poc-l4-pair.json): the only record of the verdict and the delta",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        base = baseline_artefact()
        cases: list[tuple[str, dict[str, Any], dict[str, Any] | None, str]] = [
            ("a procedure store whose coverage clears the bar grades", base_artefact(), base, "GRADED"),
            (
                "a lesson store is the arm R54 ran, not this one",
                base_artefact(**{"tau2.distillForm.form": "lesson"}),
                base,
                "DISCARDED",
            ),
            (
                "an artefact with no form cannot say what ran",
                base_artefact(**{"tau2.distillForm": None}),
                base,
                "NO_MEASUREMENT",
            ),
            (
                "an empty inventory means the ban could not fire",
                base_artefact(**{"tau2.distillForm.toolInventory": []}),
                base,
                "NO_MEASUREMENT",
            ),
            (
                "a store emptied by the ban abandons on its first refutation",
                base_artefact(**{"tau2.store.stored": 0, "tau2.store.servable": 0}),
                base,
                "ABANDONED",
            ),
            (
                "relevance that stays under the bar with no tool names left abandons the axis",
                base_artefact(**{"tau2.coverage.nonzeroQuantiles.p50": 0.05}),
                base,
                "ABANDONED",
            ),
            (
                "a tool name in the pack means the ban did not run",
                base_artefact(**{"tau2.useObservations": [
                    {"query": "q", "statements": ["call cancel_pending_order first"]},
                ]}),
                base,
                "ABANDONED",
            ),
            (
                "a harm verdict reverts under R45",
                base_artefact(**{"verdict.state": "HARM"}),
                base,
                "ABANDONED",
            ),
            (
                "a drop larger than the resolution needs no verdict to revert",
                base_artefact(**{"verdict.deltaPp": -21.0}),
                base,
                "ABANDONED",
            ),
            (
                "a register that did not move fails the drop prediction rather than the axis",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "status": "active", "when": "when find_user returns a row",
                     "statement": "call cancel_pending_order"},
                    {"id": "b", "status": "active", "when": "when the request names a user",
                     "statement": "call cancel_pending_order after find_user"},
                ]}),
                base,
                "ABANDONED",
            ),
            (
                "the drop is not graded without a baseline, and the run still grades",
                base_artefact(),
                None,
                "GRADED",
            ),
            (
                "a baseline with no inventory cannot support the drop",
                base_artefact(),
                baseline_artefact(**{"tau2.distillForm": None}),
                "GRADED",
            ),
            (
                "an absent census is a non-measurement, never a zero",
                {"id": "poc-l4", "metrics": {"k": 4}, "tau2": {"distillForm": {
                    "form": "procedure", "toolInventory": ["find_user"], "refused": 0}}},
                base,
                "NO_MEASUREMENT",
            ),
            (
                "the registered scenario pair is graded, a different one is discarded",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                base,
                "DISCARDED",
            ),
            (
                "a failed distiller certifies nothing",
                base_artefact(**{"tau2.learning.distillFailed": 1}),
                base,
                "ABANDONED",
            ),
            (
                "a coverage block whose populations disagree abandons",
                base_artefact(**{"tau2.coverage.measuredPairs": 2950}),
                base,
                "ABANDONED",
            ),
            (
                "a census that cannot describe a store abandons",
                base_artefact(**{"tau2.store.servable": 99}),
                base,
                "ABANDONED",
            ),
            (
                "too few admitted items abandons the store-quality guard",
                base_artefact(**{"tau2.store.stored": 8, "tau2.store.servable": 8}),
                base,
                "ABANDONED",
            ),
            (
                "a pair that did not run four trials abandons",
                base_artefact(**{"metrics.k": 1}),
                base,
                "ABANDONED",
            ),
            (
                "an artefact with no store text cannot be read as a register change",
                base_artefact(**{"tau2.storeItems": None}),
                base,
                "NO_MEASUREMENT",
            ),
            (
                "a sample with no active item cannot carry the register reading",
                base_artefact(**{"tau2.storeItems": {"items": [
                    {"id": "b", "status": "retired", "when": "a retired trigger", "statement": "x"},
                ], "limit": 64, "maxChars": 240, "omitted": 0, "truncated": 0}}),
                base,
                "NO_MEASUREMENT",
            ),
        ]
        # A run that cannot be graded is not a run that measured nothing. R56
        # lost `distillForm` and `storeItems` to a projection defect and this
        # verifier returned `NO_MEASUREMENT` before writing down the readings
        # that survived, so the record held no numbers and the cost of the loss
        # could not even be stated. Each case below names a reading that must
        # survive an ungraded state.
        context_cases: list[tuple[str, dict[str, Any], dict[str, Any] | None, list[str]]] = [
            (
                "a run with no form block still reports what it measured",
                base_artefact(**{"tau2.distillForm": None, "tau2.storeItems": None}),
                base,
                ["coverage p50 0.1900", "census: 16 stored, 16 servable", "funnel: 32 correction(s) -> 30 candidate(s)", "yield:"],
            ),
            (
                "a run with an empty inventory still reports its coverage",
                base_artefact(**{"tau2.distillForm.toolInventory": []}),
                base,
                ["p50 0.1900", "yield: 30 candidate(s) from 32 correction(s)"],
            ),
            (
                "a run with no store text still reports the census and the funnel",
                base_artefact(**{"tau2.storeItems": None}),
                base,
                ["census: 16 stored, 16 servable", "refused 12, failed 0"],
            ),
            (
                "the yield is read against the baseline it is compared to",
                base_artefact(),
                baseline_artefact(**{"tau2.learning": {"rows": 32, "edited": 10, "distilled": 20}}),
                ["yield: 30 candidate(s) from 32 correction(s) = 0.94 per correction, baseline 2.00"],
            ),
            (
                "a baseline with no learning block states the comparison instead of inventing it",
                base_artefact(),
                base,
                ["baseline yield not stated"],
            ),
            # R56's re-dispatch stopped at zero candidates and the funnel could not say which of
            # three facts that zero was: an event that never reached the distiller, a reply the
            # parser emptied, or a reply that arrived empty. The driver now records `asked` and
            # `dropped` beside the counts, and this reader has to relay them -- the numbers were in
            # the artefact the whole time and a reader that prints `12 -> 0` leaves the question it
            # was written to answer back with the person reading it.
            (
                "the funnel relays how many events the distiller was asked about",
                base_artefact(**{"tau2.funnel": {
                    "corrections": 12, "asked": 12, "dropped": {},
                    "candidates": 0, "admitted": 0, "stored": 0, "servable": 0,
                    "refused": 0, "failed": 0,
                }}),
                base,
                ["funnel: 12 correction(s) -> 12 asked -> 0 candidate(s) -> 0 admitted -> 0 stored -> 0 servable"],
            ),
            (
                "the funnel names what the parser dropped, largest reason first",
                base_artefact(**{"tau2.funnel": {
                    "corrections": 32, "asked": 30, "dropped": {"unknown-kind": 1, "no-statement": 4},
                    "candidates": 25, "admitted": 16, "stored": 16, "servable": 16,
                    "refused": 9, "failed": 0,
                }}),
                base,
                ["5 dropped: no-statement 4, unknown-kind 1"],
            ),
            # A run stopped before measurement is the case this reader exists for, and the sentence
            # that says why is written by the driver's `funnelReading` and stored in the artefact's
            # notes. Re-deriving it here would be a second implementation of one claim; relaying it
            # is the reader's job.
            (
                "a run the driver stopped relays the sentence that stopped it",
                {
                    "id": "poc-l4",
                    "metrics": {"status_no_measurement": 1, "k": 4},
                    "notes": {
                        "0": STOPPED_PREFIX + " "
                             "12 correction(s) -> 12 asked -> 0 candidate(s) -> 0 admitted -> "
                             "0 stored -> 0 servable (0 refused, 0 failed): the interpreter answered "
                             "all 12 event(s) with no claim of its own: nothing was thrown away after "
                             "the reply, so the model is what carried nothing",
                        "1": "Claim: none. No pass^4, no paired delta and no revert is produced by this run.",
                    },
                },
                base,
                ["stopped before measurement: 12 correction(s) -> 12 asked"],
            ),
            (
                "a stopped run written before the field existed is relayed as it was written",
                {
                    "id": "poc-l4",
                    "metrics": {"status_no_measurement": 1, "k": 4},
                    "notes": [STOPPED_PREFIX + " 12 correction(s) -> "
                              "0 candidate(s) -> 0 admitted -> 0 stored -> 0 servable "
                              "(0 refused, 0 failed): the interpreter proposed no candidate"],
                },
                base,
                ["stopped before measurement: 12 correction(s) -> 0 candidate(s)"],
            ),
            (
                "a run that scored tasks is not described as stopped",
                base_artefact(),
                base,
                ["stopped before measurement: absent"],
            ),
        ]

        failures = 0
        for label, artefact, baseline, expected in cases:
            state, report = grade(artefact, baseline)
            mark = "ok  " if state == expected else "FAIL"
            if state != expected:
                failures += 1
            print(f"  {mark} {label} -> {state}")
            if state != expected:
                print(report.render())
        # The verdict lives in the pair file, not in either arm's artefact. Both
        # of this directory's verifiers read it from the arm, so the revert rule
        # could only ever fire on a synthetic field.
        pair_harm = {
            "comparison": {"paired": 57, "deltaPp": -8.77},
            "verdict": {"state": "HARM", "reason": "l4-paired -8.77pp is below the -5pp bar"},
        }
        pair_unresolved = {
            "comparison": {"paired": 57, "deltaPp": 5.26},
            "verdict": {"state": "UNRESOLVED", "reason": "does not clear the resolution"},
        }
        no_verdict = base_artefact()
        del no_verdict["verdict"]
        pair_cases: list[tuple[str, dict[str, Any], dict[str, Any], str, list[str]]] = [
            (
                "a pair file supplies the harm the arm artefact cannot carry",
                no_verdict,
                pair_harm,
                "ABANDONED",
                ["state HARM", "revert rule fires"],
            ),
            (
                "a pair file states the delta when the arm has none",
                no_verdict,
                pair_unresolved,
                "GRADED",
                ["state UNRESOLVED, delta 5.26pp"],
            ),
            (
                "an arm with no verdict and no pair says so instead of reading clear",
                no_verdict,
                None,
                "GRADED",
                ["state None, delta Nonep"],
            ),
        ]
        for label, artefact, pair, expected, required in pair_cases:
            state, report = grade(artefact, baseline, pair)
            rendered = report.render()
            missing = [text for text in required if text not in rendered]
            mark = "ok  " if state == expected and not missing else "FAIL"
            if state != expected or missing:
                failures += 1
            print(f"  {mark} {label} -> {state}")
            if state != expected or missing:
                print(f"      missing from the report: {missing}")
                print(rendered)
        for label, artefact, baseline, required in context_cases:
            state, report = grade(artefact, baseline)
            rendered = report.render()
            missing = [text for text in required if text not in rendered]
            mark = "ok  " if not missing else "FAIL"
            if missing:
                failures += 1
            print(f"  {mark} {label} -> {state}")
            if missing:
                print(f"      missing from the report: {missing}")
                print(rendered)
        print()
        print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
        return 0 if failures == 0 else 1

    if not args.dir:
        parser.error("--dir is required unless --self-test is given")
    root = Path(args.dir)
    baseline = json.loads(Path(args.baseline).read_text()) if args.baseline else None
    pair = json.loads(Path(args.pair).read_text()) if args.pair else None
    if pair is None:
        found = sorted(root.rglob("poc-l4-pair.json"))
        pair = json.loads(found[0].read_text()) if found else None
    artefacts = sorted(root.rglob("poc-l4.json"))
    if not artefacts:
        print(f"no poc-l4.json under {root}", file=sys.stderr)
        return 2
    worst = 0
    for path in artefacts:
        state, report = grade(json.loads(path.read_text()), baseline, pair)
        print(f"{path}\n  {state}\n{report.render()}\n")
        if state in ("ABANDONED", "DISCARDED"):
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
