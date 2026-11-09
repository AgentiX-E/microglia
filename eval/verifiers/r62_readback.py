#!/usr/bin/env python3
"""R62 readback: was the population the constraint on corroboration?

The registration is `prereg/R62-population.md`. R61 closed the merge route as far as this corpus can
take it: over thirty-six floor points the largest group is two, and the same store's two merged pairs
are the two obvious families. The floor was never the constraint, the linkage was never the
constraint, and R60 had already made the ceiling stop being one.

What was left is that there was no third member to find. Fourteen of the fifty-seven learning tasks
fail and produce the whole store; the other forty-three pass on the first attempt and teach nothing.
R62 changes that population and nothing else: `TAU_DISTILL_SCOPE=all` also asks each passing task for
the rule its successful trajectory follows.

So this readback grades the instrument before the result, because the round's central predicate is
"the store grew", and a store cannot say whether it grew:

  the switch    did the dispatch that claims `all` actually distil both populations?
  the join      can every stored claim be attributed to the record that taught it?
  the closure   do the provenance counts account for every learning row?
  the sweep     does the instrument describe the same pass the census does?
  the result    did the store grow, does a triple exist, and did the pack survive?

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no provenance, no sweep, or no store.
  DISCARDED       the artefact is a repair-only arm or another unit, so it is R61's experiment.
  ABANDONED       a refutation fired, or a graded prediction failed.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --artifact l4-evidence --out /tmp/r62
  python3 eval/verifiers/r62_readback.py --dir /tmp/r62
  python3 eval/verifiers/r62_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R62-population.md`, written before the arm ran.
PREDICTED_CLAIMS = 112
PREDICTED_PASSED_CLAIMS = 60
PREDICTED_GROUP_OF_THREE = 1
PREDICTED_MAX_SUPPORT = 3
PREDICTED_RETAINED_SHARE_MIN = 0.50
# The measured drift of a control arm dispatched twice, from R59. A delta inside it is not a reading.
CONTROL_DRIFT_PP = 3.51
# R61's readings, quoted so every comparison is against a number rather than a memory.
R61_CLAIMS = 45
R61_LARGEST_GROUP = 2
R61_SUPPORT3 = 0
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


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


def _dig(document: dict[str, Any], path: str, default: Any = None) -> Any:
    node: Any = document
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def _scenario_ok(document: dict[str, Any]) -> bool:
    scenario = _dig(document, "tau2.scenario") or {}
    return all(scenario.get(key) == value for key, value in REQUIRED_SCENARIO.items())


def grade(document: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    unit = _dig(document, "tau2.distillUnit.unit")
    if unit != "trace":
        report.note(f"unit '{unit}' is not the trace arm this round treats")
        return "DISCARDED", report
    scope = _dig(document, "tau2.distillScope")
    if scope != "all":
        report.note(
            f"scope '{scope}' is the population every published arm measured: this is R61's "
            "experiment, not R62's"
        )
        return "DISCARDED", report
    if not _scenario_ok(document):
        report.note(f"scenario {_dig(document, 'tau2.scenario')} is not the registered pair")
        return "DISCARDED", report

    provenance = _dig(document, "tau2.provenance")
    if provenance is None:
        report.note("provenance absent: the artefact cannot say which population taught")
        return "NO_MEASUREMENT", report
    census = _dig(document, "tau2.distillUnit.consolidation")
    sweep = _dig(document, "tau2.consolidationSweep")
    if census is None:
        report.note("consolidation absent: this arm did not run the pass")
        return "NO_MEASUREMENT", report
    if sweep is None:
        report.note("consolidationSweep absent: this artefact predates the instrument")
        return "NO_MEASUREMENT", report
    store = _dig(document, "tau2.storeItems") or {}
    items = store.get("items") or []
    if not items:
        report.note("no sampled store: the readback cannot check the census against it")
        return "NO_MEASUREMENT", report

    operating = sweep.get("operating") or {}
    points = sweep.get("points") or []
    groups = list(sweep.get("groups") or [])
    learning = _dig(document, "tau2.learning") or {}
    rows = int(learning.get("rows") or 0)
    unanswered = int(learning.get("unanswered") or 0)
    edited = int(provenance.get("edited") or 0)
    passed = int(provenance.get("passed") or 0)

    # 1. The switch reached the store. A dispatch can ask for `all` and still produce only repairs if
    #    the pass side never runs, and the artefact would then look like a round that found nothing to
    #    teach rather than one that never asked.
    report.predict(
        "the dispatch that says `all` teaches from both populations",
        passed > 0 and edited > 0,
        f"{edited} repair record(s), {passed} pass record(s)",
    )

    # 2. The population account closes. Every learning row is a repair, a pass, or a question the
    #    record lost -- the identity `V32` is built on, asserted here over the store rather than over
    #    the driver's own counters.
    report.predict(
        "the provenance counts and the unanswered ledger account for every learning row",
        edited + passed + unanswered == rows,
        f"{edited} + {passed} + {unanswered} against {rows} row(s)",
    )

    # 3. Every stored claim is attributable. An item citing a run this round never opened means the
    #    join between a claim and the record that taught it does not hold, and every reading below is
    #    a comparison between those two populations.
    unattributed = int(provenance.get("itemsUnattributed") or 0)
    stray = int(provenance.get("evidenceUnattributed") or 0)
    report.predict(
        "every stored claim is attributed to a record this round opened",
        unattributed == 0 and stray == 0,
        f"{unattributed} claim(s) and {stray} reference(s) unattributed",
    )

    # 4. The instrument describes the store the census describes -- the same check R61 grades, kept
    #    because a sweep that recomputed its operating point could disagree with the pass.
    same = (
        operating.get("threshold") == census.get("threshold")
        and operating.get("conditionMinShared") == census.get("conditionMinShared")
        and operating.get("groups") == census.get("groups")
        and operating.get("merged") == census.get("merged")
        and operating.get("maxSupport") == census.get("maxSupportAfter")
    )
    report.predict(
        "the sweep's operating point is the pass's own census",
        same,
        f"operating {operating.get('groups')}/{operating.get('merged')}/{operating.get('maxSupport')} "
        f"against census {census.get('groups')}/{census.get('merged')}/{census.get('maxSupportAfter')}",
    )

    # 5. Complete linkage's invariant, over every group rather than the largest.
    below = [
        group
        for group in groups
        if group.get("weakestPair", 0) < float(operating.get("threshold") or 0) - 1e-9
    ]
    report.predict(
        "every group's weakest pair clears the floor it was produced at",
        not below,
        f"{len(below)} group(s) below {operating.get('threshold')}" if below else f"{len(groups)} group(s) checked",
    )

    # 6. The store grew by at least 2.5x. R61 produced 45 claims from 14 teaching tasks; the
    #    prediction was >= 112 from 57, of which >= 60 from passes.
    yield_block = _dig(document, "tau2.yieldCensus") or {}
    claims = int(yield_block.get("claims") or _dig(document, "tau2.distillUnit.claims") or 0)
    passed_only = int(provenance.get("itemsPassedOnly") or 0)
    mixed = int(provenance.get("itemsMixed") or 0)
    passed_claims = passed_only + mixed
    report.predict(
        "the store grows by at least 2.5x",
        claims >= PREDICTED_CLAIMS,
        f"{claims} claim(s) against R61's {R61_CLAIMS}, {passed_claims} of them from a pass",
    )
    report.predict(
        "at least sixty claims come from a passing trajectory",
        passed_claims >= PREDICTED_PASSED_CLAIMS,
        f"{passed_claims} pass-attributed claim(s), {mixed} of them also citing a repair",
    )

    # 7. The round's question: a triple, and a support of three.
    threes = [group for group in groups if len(group.get("ids") or []) >= 3]
    store_support = [int(item.get("supportTasks") or 0) for item in items]
    support3 = [count for count in store_support if count >= 3]
    report.predict(
        "a group of three exists at the 0.60 statement floor",
        len(threes) >= PREDICTED_GROUP_OF_THREE,
        f"{len(threes)} group(s) of three or more, largest {operating.get('largestGroup')}",
    )
    report.predict(
        "max support reaches three",
        int(census.get("maxSupportAfter") or 0) >= PREDICTED_MAX_SUPPORT
        and len(support3) >= 1,
        f"census {census.get('maxSupportAfter')}, store {len(support3)} item(s) at three or more",
    )

    # 8. The store survived, and the ledger stayed clean.
    considered = int(census.get("considered") or 0)
    retained = int(census.get("retained") or 0)
    share = retained / considered if considered else 0.0
    report.predict(
        "the pass keeps at least half the store it read",
        share >= PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept ({share * 100:.1f}%)",
    )
    report.predict(
        "no learning question went unanswered",
        unanswered == 0,
        f"{unanswered} unanswered of {rows}",
    )

    # The refutations, in the order the registration states them.
    report.refute(
        "'the success distiller has nothing to say': the population did not widen",
        claims < PREDICTED_CLAIMS or passed_claims < PREDICTED_PASSED_CLAIMS,
        f"{claims} claim(s), {passed_claims} from a pass",
    )
    widest = max((len(group.get("ids") or []) for group in groups), default=0)
    report.refute(
        "'corroboration is not a population question either': 112+ claims and still no triple",
        claims >= PREDICTED_CLAIMS and widest < 3,
        f"{claims} claim(s), largest group {widest}",
    )
    report.refute(
        "'the wider store dilutes the pack': the delta fell below the control drift",
        _dig(document, "_pair.comparison.deltaPp") is not None
        and float(_dig(document, "_pair.comparison.deltaPp")) < -CONTROL_DRIFT_PP,
        "paired delta "
        + (
            "absent"
            if _dig(document, "_pair.comparison.deltaPp") is None
            else f"{float(_dig(document, '_pair.comparison.deltaPp')):+.2f}pp"
        )
        + f" against a drift of {CONTROL_DRIFT_PP:.2f}pp",
    )
    separated = (
        int(provenance.get("itemsEditedOnly") or 0)
        + passed_only
        + mixed
    )
    report.refute(
        "'the provenance split is a fiction': no claim could be filed by population",
        claims > 0 and separated == 0,
        f"{separated} of {claims} claim(s) filed, {unattributed} unattributed",
    )

    pair = document.get("_pair") or {}
    delta = _dig(pair, "comparison.deltaPp")
    if delta is not None and float(delta) < CONTROL_DRIFT_PP:
        # A floor, not an improvement: the registration asks only that dilution not cost the effect
        # R61 measured. Reported rather than graded when it is above the drift.
        report.note(
            f"paired delta is above the drift and not claimed: {float(delta):+.2f}pp "
            f"(p={_dig(pair, 'comparison.pValue')}, n={_dig(pair, 'comparison.paired')})"
        )
    if delta is None:
        report.note("no comparison block: the paired delta is ungraded, not zero")
    else:
        report.note(
            f"paired delta {float(delta):+.2f}pp (p={_dig(pair, 'comparison.pValue')}, "
            f"n={_dig(pair, 'comparison.paired')}) against R61's +14.04pp"
        )

    report.note(
        f"provenance: {edited} repair(s) / {passed} pass(es); claims {int(provenance.get('itemsEditedOnly') or 0)} "
        f"repair-only, {passed_only} pass-only, {mixed} mixed"
    )
    report.note(
        "R61 for comparison: "
        f"{R61_CLAIMS} claims, largest group {R61_LARGEST_GROUP}, support 3 at {R61_SUPPORT3}"
    )
    for group in groups[:6]:
        report.note(
            f"group {group.get('ids')}: {group.get('supportTasks')} task(s), "
            f"weakest {group.get('weakestPair')}, conditions share {group.get('conditionShared')}"
        )

    if report.refutation_fired:
        return "ABANDONED", report
    if not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_artefact(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "tau2": {
            "scenario": dict(REQUIRED_SCENARIO),
            "distillScope": "all",
            "learning": {"rows": 57, "unanswered": 0, "edited": 14, "distilled": 118},
            "provenance": {
                "edited": 14,
                "passed": 43,
                "tasksEdited": 14,
                "tasksPassed": 43,
                "itemsEditedOnly": 52,
                "itemsPassedOnly": 64,
                "itemsMixed": 2,
                "itemsUnattributed": 0,
                "evidenceUnattributed": 0,
            },
            "distillUnit": {
                "unit": "trace",
                "traces": 57,
                "traced": 57,
                "claims": 118,
                "consolidation": {
                    "considered": 118,
                    "groups": 2,
                    "merged": 5,
                    "retained": 113,
                    "threshold": 0.6,
                    "conditionMinShared": 0,
                    "supportBefore": {"1": 118},
                    "supportAfter": {"1": 113, "3": 1, "2": 1},
                    "maxSupportBefore": 1,
                    "maxSupportAfter": 3,
                    "crossTaskGroups": 2,
                    "weakestPair": 0.62,
                    "largestGroup": 3,
                },
            },
            "yieldCensus": {"claims": 118},
            "consolidationSweep": {
                "operating": {
                    "threshold": 0.6,
                    "conditionMinShared": 0,
                    "groups": 2,
                    "merged": 5,
                    "maxSupport": 3,
                    "largestGroup": 3,
                },
                "points": [
                    {"threshold": 0.6, "conditionMinShared": 0, "groups": 2, "merged": 5},
                    {"threshold": 0.6, "conditionMinShared": 3, "groups": 1, "merged": 2},
                ],
                "groups": [
                    {"ids": ["k1", "k2", "k3"], "supportTasks": 3, "weakestPair": 0.62, "conditionShared": 0, "crossTask": True},
                    {"ids": ["k4", "k5"], "supportTasks": 2, "weakestPair": 0.71, "conditionShared": 1, "crossTask": True},
                ],
            },
            "storeItems": {
                "items": [
                    {"id": "k1", "supportTasks": 3, "statement": "a", "status": "active"},
                    {"id": "k2", "supportTasks": 2, "statement": "b", "status": "active"},
                ],
                "omitted": 116,
            },
        },
        "metrics": {"k": 4},
        "_pair": {"comparison": {"paired": 57, "deltaPp": 6.2, "pValue": 0.4}},
    }
    for path, value in overrides.items():
        node = document
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        if value is None:
            node.pop(parts[-1], None)
        else:
            node[parts[-1]] = value
    return document


def self_test() -> int:
    repair_only = base_artefact(**{"tau2.distillScope": "edited"})
    no_scope = base_artefact(**{"tau2.distillScope": None})
    control = base_artefact(**{"tau2.distillUnit.unit": "correction"})
    other_scenario = base_artefact(**{"tau2.scenario": {"learn": "airline", "test": "airline", "recall": "airline"}})
    no_provenance = base_artefact(**{"tau2.provenance": None})
    no_sweep = base_artefact(**{"tau2.consolidationSweep": None})
    no_census = base_artefact(**{"tau2.distillUnit.consolidation": None})
    no_store = base_artefact(**{"tau2.storeItems": None})
    pass_side_dead = base_artefact(**{
        "tau2.provenance.passed": 0,
        "tau2.provenance.tasksPassed": 0,
        "tau2.provenance.itemsPassedOnly": 0,
        "tau2.learning.rows": 14,
    })
    rows_do_not_close = base_artefact(**{"tau2.learning.unanswered": 7})
    unattributed = base_artefact(**{"tau2.provenance.itemsUnattributed": 3})
    stray_ref = base_artefact(**{"tau2.provenance.evidenceUnattributed": 2})
    inconsistent = base_artefact(**{"tau2.consolidationSweep.operating.groups": 0})
    chain = base_artefact(**{"tau2.consolidationSweep.groups": [
        {"ids": ["k1", "k2", "k3"], "supportTasks": 3, "weakestPair": 0.4, "conditionShared": 0, "crossTask": True},
        {"ids": ["k4", "k5"], "supportTasks": 2, "weakestPair": 0.71, "conditionShared": 1, "crossTask": True},
    ]})
    small_store = base_artefact(**{
        "tau2.yieldCensus.claims": 46,
        "tau2.distillUnit.claims": 46,
        "tau2.provenance.itemsPassedOnly": 4,
    })
    no_triple = base_artefact(**{
        "tau2.distillUnit.consolidation.groups": 1,
        "tau2.distillUnit.consolidation.merged": 2,
        "tau2.distillUnit.consolidation.retained": 116,
        "tau2.distillUnit.consolidation.maxSupportAfter": 2,
        "tau2.distillUnit.consolidation.supportAfter": {"1": 116, "2": 1},
        "tau2.consolidationSweep.operating.maxSupport": 2,
        "tau2.consolidationSweep.operating.largestGroup": 2,
        "tau2.consolidationSweep.groups": [
            {"ids": ["k4", "k5"], "supportTasks": 2, "weakestPair": 0.71, "conditionShared": 1, "crossTask": True}
        ],
    })
    collapsed = base_artefact(**{"tau2.distillUnit.consolidation.retained": 4})
    unanswered_left = base_artefact(**{"tau2.learning.unanswered": 0, "tau2.learning.rows": 60})
    diluted = base_artefact(**{"_pair": {"comparison": {"paired": 57, "deltaPp": -9.0, "pValue": 0.01}}})
    no_pair = base_artefact(**{"_pair": None})

    cases: list[tuple[str, dict[str, Any], str, str | None]] = [
        ("a widened store with a triple grades", base_artefact(), "GRADED", "group of three"),
        ("a repair-only arm is R61's experiment", repair_only, "DISCARDED", "R61's experiment"),
        ("an artefact from before the switch is discarded", no_scope, "DISCARDED", "population every published arm"),
        ("the correction arm is discarded", control, "DISCARDED", "unit 'correction'"),
        ("another scenario pair is discarded", other_scenario, "DISCARDED", "not the registered pair"),
        ("an arm with no provenance cannot say who taught", no_provenance, "NO_MEASUREMENT", "provenance absent"),
        ("an artefact from before the instrument cannot be read", no_sweep, "NO_MEASUREMENT", "consolidationSweep absent"),
        ("a trace arm with no census did not run its pass", no_census, "NO_MEASUREMENT", "consolidation absent"),
        ("an arm with no sampled store cannot be checked", no_store, "NO_MEASUREMENT", "no sampled store"),
        ("a switch that reached nothing abandons", pass_side_dead, "ABANDONED", "teaches from both populations"),
        ("a population that does not add up abandons", rows_do_not_close, "ABANDONED", "account for every learning row"),
        ("a claim from nowhere abandons the join", unattributed, "ABANDONED", "attributed to a record"),
        ("one unattributed reference is enough to abandon the join", stray_ref, "ABANDONED", "attributed to a record"),
        ("a sweep that disagrees with its own census abandons", inconsistent, "ABANDONED", "operating point is the pass"),
        ("a group below its floor voids the linkage", chain, "ABANDONED", "weakest pair clears the floor"),
        ("a store that did not grow is the first refutation", small_store, "ABANDONED", "population did not widen"),
        ("112 claims and no triple closes the merge route", no_triple, "ABANDONED", "not a population question either"),
        ("a store that collapses is the dilution reading", collapsed, "ABANDONED", "at least half the store"),
        ("a row that cannot be filed abandons the account", unanswered_left, "ABANDONED", "account for every learning row"),
        ("a paired delta beyond the drift refutes the served pack", diluted, "ABANDONED", "dilutes the pack"),
        ("an artefact with no pair file still grades the store", no_pair, "GRADED", "no comparison block"),
    ]
    failures = 0
    for label, artefact, expected, fragment in cases:
        state, report = grade(artefact)
        rendered = report.render()
        honoured = fragment is None or fragment in rendered
        mark = "ok  " if state == expected and honoured else "FAIL"
        if state != expected or not honoured:
            failures += 1
        print(f"  {mark} {label} -> {state}")
        if state != expected or not honoured:
            print(rendered)
    print()
    print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", help="evidence directory from fetch_evidence.py")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.dir:
        parser.error("--dir is required unless --self-test is given")
    root = Path(args.dir)
    artefacts = sorted(path for path in root.rglob("poc-l4.json"))
    if not artefacts:
        print(f"no poc-l4.json under {root}", file=sys.stderr)
        return 2
    pairs = sorted(root.rglob("poc-l4-pair.json"))
    pair_document = json.loads(pairs[0].read_text()) if pairs else {}
    worst = 0
    for path in artefacts:
        document = json.loads(path.read_text())
        document["_pair"] = pair_document
        state, report = grade(document)
        print(f"{path}\n  {state}\n{report.render()}\n")
        if state in ("ABANDONED", "DISCARDED"):
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
