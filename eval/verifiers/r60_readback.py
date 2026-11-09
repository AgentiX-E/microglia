#!/usr/bin/env python3
"""R60 readback: did the ceiling ever bind, and does a bigger store corroborate itself?

The registration is `prereg/R60-yield-ceiling.md`. R59 answered the measure and the population and
produced the project's first corroboration — one group, one item at `supportTasks: 2` — together with
the number this round is about: **2.21 claims per correction against a cap of three**.

That number is why the ceiling is the treatment. A cap one claim above the mean binds exactly where it
is met and hides in the average everywhere else, and no committed artefact carried the distribution
that would say which. So this readback asks three questions in order:

  the cap        did the yield move, and did the *median* move with it?
  the store      did the growth produce corroboration, and did anything reach three distinct tasks?
  the price      did the pass keep the store, and is every merged pair one claim?

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no ceiling, no unit, or no census.
  DISCARDED       the artefact is the control arm or another scenario pair.
  ABANDONED       a refutation fired, or a graded prediction failed.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r60
  python3 r60_readback.py --dir /tmp/r60
  python3 r60_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R60-yield-ceiling.md`, written before the measurement existed.
PREDICTED_CLAIMS_PER_CORRECTION = 3.0
PREDICTED_MEDIAN_CLAIMS = 3
PREDICTED_SUPPORT2_MIN = 2
PREDICTED_SUPPORT3_MIN = 1
PREDICTED_RETAINED_SHARE_MIN = 0.50
PREDICTED_TRACED_SHARE_MIN = 0.80
REQUIRED_CEILING = 6
CONTENT_FLOOR = 0.60
# R59's readings, quoted so every comparison in this file is against a number rather than a memory.
R59_CLAIMS_PER_CORRECTION = 2.21
R59_CLAIMS = 31
R59_SUPPORT2 = 1
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}

# The stop list `claimTokens` uses, quoted rather than approximated: a re-scoring under a different
# tokenizer would compare two measures and call the difference a finding.
STOPWORDS = frozenset(
    """
    a an the and or of to in for with is are be been that this these those it its you your
    they their when from
    """.split()
)


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


# --------------------------------------------------------------------------- #
# the measure, re-implemented so a merged pair can be priced
# --------------------------------------------------------------------------- #


def tokens(text: str) -> frozenset[str]:
    return frozenset(t for t in re.split(r"[^a-z0-9]+", text.lower()) if t and t not in STOPWORDS)


def containment(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    small, large = (left, right) if len(left) <= len(right) else (right, left)
    return len(small & large) / len(small)


def jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    union = left | right
    return 0.0 if not union else len(left & right) / len(union)


def merged_pairs(items: list[dict[str, Any]]) -> tuple[list[tuple[float, str, str]], bool]:
    """Every group the pass merged, with both measures of its pair.

    The join is the store's own `statusReason: consolidated:<id>`, which R60's projection carries.
    An artefact written before the field is linked by content — the live item whose statement
    contains the member most — and says so, because the inference can only over-state and therefore
    can only make the "not one claim" refutation harder to fire.
    """
    by_id = {entry.get("id"): entry for entry in items}
    live = [entry for entry in items if entry.get("status") != "retired"]
    out: list[tuple[float, str, str]] = []
    inferred = False
    for entry in items:
        if entry.get("status") != "retired":
            continue
        statement = str(entry.get("statement") or "")
        reason = str(entry.get("statusReason") or "")
        survivor = by_id.get(reason.split(":", 1)[1]) if reason.startswith("consolidated:") else None
        if survivor is None:
            if not live:
                out.append((0.0, statement, "(survivor not in the sample)"))
                continue
            survivor = sorted(
                live,
                key=lambda row: (
                    -containment(tokens(statement), tokens(str(row.get("statement") or ""))),
                    str(row.get("id")),
                ),
            )[0]
            inferred = True
        out.append((containment(tokens(statement), tokens(str(survivor.get("statement") or ""))), statement,
                    str(survivor.get("statement") or "")))
    return out, inferred


# --------------------------------------------------------------------------- #
# grading
# --------------------------------------------------------------------------- #


def distribution(values: list[int]) -> dict[int, int]:
    out: dict[int, int] = {}
    for value in values:
        out[value] = out.get(value, 0) + 1
    return dict(sorted(out.items()))


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    scenario = tau2.get("scenario")
    if isinstance(scenario, dict):
        mismatched = {key: scenario.get(key) for key, want in REQUIRED_SCENARIO.items() if scenario.get(key) != want}
        if mismatched:
            report.refute(
                "the dispatch ran the registered scenario pair",
                True,
                f"learn {scenario.get('learn')}, test {scenario.get('test')}, recall {scenario.get('recall')}",
            )
            return "DISCARDED", report
    else:
        report.note("no scenario block: read as the registered pair")

    unit = tau2.get("distillUnit")
    if not isinstance(unit, dict):
        report.predict("the artefact records the unit it distilled", None, "distillUnit absent")
        return "NO_MEASUREMENT", report
    if unit.get("unit") != "trace":
        report.refute("the dispatched unit is trace", True, f"unit {unit.get('unit')!r}")
        return "DISCARDED", report

    ceiling = tau2.get("traceClaims")
    if not isinstance(ceiling, dict):
        report.predict("the artefact records the ceiling its trace form ran under", None, "traceClaims absent")
        return "NO_MEASUREMENT", report
    report.predict(
        f"the ceiling is the registered {REQUIRED_CEILING} and the dispatch chose it",
        ceiling.get("ceiling") == REQUIRED_CEILING and ceiling.get("declared") is True,
        f"ceiling {ceiling.get('ceiling')!r}, declared {ceiling.get('declared')!r}",
    )

    census = unit.get("consolidation")
    yield_census = tau2.get("yieldCensus")
    if not isinstance(census, dict):
        report.predict("the recurrence pass ran and reported its census", None, "consolidation absent")
        return "NO_MEASUREMENT", report
    if not isinstance(yield_census, dict):
        report.predict("the run recorded what each correction yielded", None, "yieldCensus absent")
        return "NO_MEASUREMENT", report

    learning = tau2.get("learning") or {}
    edited = learning.get("edited")
    rows = learning.get("rows")
    traced = unit.get("traced")
    if not isinstance(traced, int) or not isinstance(edited, int) or edited <= 0:
        report.predict("the artefact records what it read", None, f"traced={traced!r}, edited={edited!r}")
        return "NO_MEASUREMENT", report
    traced_share = traced / edited
    report.predict(
        f"at least {PREDICTED_TRACED_SHARE_MIN:.0%} of the corrections carry a trace",
        traced_share >= PREDICTED_TRACED_SHARE_MIN,
        f"{traced} of {edited} ({traced_share:.3%})",
    )
    if traced_share < PREDICTED_TRACED_SHARE_MIN:
        report.note("traced share below the floor: the unit under test did not run on this population")
        return "NO_MEASUREMENT", report

    # ---- the cap -------------------------------------------------------------------------
    per = [row for row in (yield_census.get("perCorrection") or []) if isinstance(row, dict)]
    claims = yield_census.get("claims")
    if not isinstance(claims, int) or not per:
        report.predict("the yield census carries one row per correction", None, json.dumps(yield_census)[:120])
        return "NO_MEASUREMENT", report
    counts = [int(row.get("claims") or 0) for row in per]
    mean = claims / len(counts)
    report.predict(
        f"claims per correction reach {PREDICTED_CLAIMS_PER_CORRECTION:.1f} against R59's {R59_CLAIMS_PER_CORRECTION:.2f}",
        mean >= PREDICTED_CLAIMS_PER_CORRECTION,
        f"{claims} claim(s) from {len(counts)} correction(s) = {mean:.2f}",
    )
    median = yield_census.get("medianClaims")
    report.predict(
        f"the median correction yields {PREDICTED_MEDIAN_CLAIMS}, which is what says the cap was binding",
        isinstance(median, (int, float)) and median >= PREDICTED_MEDIAN_CLAIMS,
        f"median {median!r}, max {yield_census.get('maxClaims')!r}, distribution {distribution(counts)}",
    )

    # ---- the store -----------------------------------------------------------------------
    considered = census.get("considered")
    retained = census.get("retained")
    groups = census.get("groups")
    if not all(isinstance(value, int) for value in (considered, retained, groups)):
        report.predict("the census carries its counts", None, json.dumps(census)[:120])
        return "NO_MEASUREMENT", report
    after = census.get("supportAfter") or {}
    values: list[int] = []
    for key, count in after.items():
        values.extend([int(key)] * int(count))
    if not values:
        report.predict("the census carries an after-distribution", None, "supportAfter empty")
        return "NO_MEASUREMENT", report
    at_two = sum(1 for value in values if value >= 2)
    at_three = sum(1 for value in values if value >= 3)
    report.predict(
        f"at least {PREDICTED_SUPPORT2_MIN} item(s) reach support 2, from R59's {R59_SUPPORT2}",
        at_two >= PREDICTED_SUPPORT2_MIN,
        f"{at_two} of {len(values)} (after {distribution(values)}, before {census.get('supportBefore')})",
    )
    report.predict(
        f"at least {PREDICTED_SUPPORT3_MIN} item reaches support 3 — the bar sup3 admits on",
        at_three >= PREDICTED_SUPPORT3_MIN,
        f"{at_three} of {len(values)}, max {census.get('maxSupportAfter')!r}",
    )
    retained_share = None if considered <= 0 else retained / considered
    report.predict(
        f"the pass keeps at least {PREDICTED_RETAINED_SHARE_MIN:.0%} of the store it read",
        retained_share is not None and retained_share >= PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept ({retained_share:.3%})" if retained_share is not None else "nothing read",
    )
    report.predict(
        "the run is the registered trial count: four",
        (metrics.get("k") or 0) == 4,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )

    # ---- the price, and the pairs ----------------------------------------------------------
    refusals = [
        int(census.get("refusedCondition") or 0),
        int(census.get("refusedPayload") or 0),
        int(census.get("refusedDuplicateEvidence") or 0),
    ]
    # Registered as "do not more than double against R59's 0/0/0", which is unreadable arithmetic:
    # twice zero is zero, so any refusal would refute. The counts are printed and not graded, and the
    # defect in the registration is recorded rather than papered over with a bar chosen after the run.
    report.note(
        f"refusals condition/payload/evidence {refusals[0]}/{refusals[1]}/{refusals[2]} "
        f"(R59 read 0/0/0; the registration's \"not more than double\" cannot be graded against a zero base)"
    )

    items = (tau2.get("storeItems") or {}).get("items")
    if isinstance(items, list) and items:
        pairs, inferred = merged_pairs(items)
        if inferred:
            report.note("the retired members carry no statusReason: each was linked to the live item that contains it most")
        for score, member, survivor in pairs:
            report.note(
                f"  merged {score:.3f} containment / {jaccard(tokens(member), tokens(survivor)):.3f} Jaccard: "
                f"{member[:100]!r} -> {survivor[:100]!r}"
            )
        if pairs and pairs[0][2] != "(survivor not in the sample)":
            weakest = min(score for score, _, survivor in pairs if survivor != "(survivor not in the sample)")
            report.refute(
                "a merged group is not one claim: the floor fell below the register's resolution",
                weakest < CONTENT_FLOOR,
                f"weakest pair {weakest:.3f} against a floor of {CONTENT_FLOOR:.2f}",
            )
        if not pairs and groups > 0:
            report.note(f"the census reports {groups} group(s) and no retired member is in the sample")
    else:
        report.note("storeItems absent: the merged pairs are not named here")

    report.note(
        f"census: {considered}→{retained} item(s), {groups} group(s), max support "
        f"{census.get('maxSupportBefore')}→{census.get('maxSupportAfter')}, floors "
        f"{census.get('threshold')}/{census.get('conditionMinShared')} shared condition term(s)"
    )
    report.note(f"learning {rows!r} row(s), {edited!r} correction(s), {traced!r} traced")

    pair = artefact.get("_pair") or {}
    comparison = pair.get("comparison") or {}
    if isinstance(comparison, dict) and comparison.get("paired"):
        report.note(
            "paired delta is reported and not claimed: "
            f"{comparison.get('deltaPp'):.2f}pp (p={comparison.get('p'):.4f}, "
            f"n={comparison.get('paired')}, {comparison.get('gained')} gained, "
            f"{comparison.get('lost')} lost, verdict {(pair.get('verdict') or {}).get('state')})"
        )
    else:
        report.note("no pair file beside the arm: the delta is not read here")

    # ---- R60's refutations, in the order the registration states them -----------------------
    report.refute(
        "the yield does not move: the cap was never the constraint",
        mean < PREDICTED_CLAIMS_PER_CORRECTION,
        f"{mean:.2f} claim(s) per correction at a ceiling of {REQUIRED_CEILING}",
    )
    report.refute(
        "the yield moves and nothing corroborates: the corpus is the constraint rather than the population",
        claims >= 45 and groups <= 1 and at_two <= R59_SUPPORT2,
        f"{claims} claim(s), {groups} group(s), {at_two} at support 2",
    )
    report.refute(
        "the store dilutes rather than grows: support bought with reach",
        retained_share is not None and retained_share < PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept",
    )
    report.refute(
        "support 3 does not appear at ~45 claims, so the doubleton was a coincidence and not a class",
        claims >= 45 and at_three == 0,
        f"{claims} claim(s), {at_three} at support 3",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #

PAIR_A = (
    "When a request bundles several changes carry out every requested change in the order the requester "
    "stated them and do not stop after the first one succeeds"
)
PAIR_B = (
    "When a request bundles several changes carry out every requested change in the order the requester "
    "stated them and stop once all are applied rather than adding extra lookups"
)
OTHER = "When a request involves multiple orders apply the requested change to every affected order not just one"


def stored_item(identifier: str, statement: str, when: str, task: str, status: str = "active",
                reason: str | None = None, support: int = 1) -> dict[str, Any]:
    return {
        "id": identifier,
        "kind": "procedure",
        "scope": {"domain": "retail"},
        "statement": statement,
        "when": when,
        "status": status,
        "statusReason": reason or "confidence-cleared",
        "supportTasks": support,
        "evidence": [
            {"feedbackId": f"fb_{identifier}_{index}", "runId": f"run_{identifier}_{index}", "taskId": f"{task}_{index}"}
            for index in range(support)
        ],
    }


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: ceiling six, yield above the bar, one group, support 3 reached."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.63, "tasks": 57, "k": 4},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {"rows": 57, "edited": 14},
            "distillUnit": {
                "unit": "trace",
                "traces": 14,
                "traced": 14,
                "claims": 46,
                "consolidation": {
                    "considered": 46,
                    "groups": 2,
                    "merged": 3,
                    "retained": 43,
                    "threshold": 0.6,
                    "conditionMinShared": 3,
                    "refusedCondition": 0,
                    "refusedPayload": 0,
                    "refusedDuplicateEvidence": 0,
                    "supportBefore": {"1": 46},
                    "supportAfter": {"1": 40, "2": 2, "3": 1},
                    "maxSupportBefore": 1,
                    "maxSupportAfter": 3,
                },
            },
            "traceClaims": {"ceiling": 6, "declared": True},
            "yieldCensus": {
                "corrections": 14,
                "assertions": 21,
                "claims": 46,
                "maxClaims": 6,
                "medianClaims": 3,
                "perCorrection": [
                    {"taskId": f"retail/{index}", "assertions": 2, "claims": 3 + index % 4}
                    for index in range(14)
                ],
            },
            "storeItems": {
                "items": [
                    stored_item("k1", PAIR_A, "several changes at once", "retail/0", support=1),
                    stored_item("k2", PAIR_B, "several changes at once", "retail/1", status="retired",
                                reason="consolidated:k1"),
                ]
            },
        },
    }
    for path, value in over.items():
        node = artefact
        keys = path.split(".")
        for key in keys[:-1]:
            node = node[key]
        node[keys[-1]] = value
    return artefact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the arm artefacts")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        unreadable = base_artefact(**{"tau2.traceClaims": {"ceiling": 3, "declared": True}})
        no_census = base_artefact(**{"tau2.distillUnit.consolidation": None})
        no_yield = base_artefact(**{"tau2.yieldCensus": None})
        flat = base_artefact(**{
            "tau2.yieldCensus.claims": 30,
            "tau2.yieldCensus.medianClaims": 2,
            "tau2.yieldCensus.perCorrection": [
                {"taskId": f"retail/{index}", "assertions": 2, "claims": 2} for index in range(14)
            ],
        })
        no_three = base_artefact(**{
            "tau2.distillUnit.consolidation.supportAfter": {"1": 44, "2": 2},
            "tau2.distillUnit.consolidation.maxSupportAfter": 2,
            "tau2.yieldCensus.claims": 52,
            "tau2.yieldCensus.medianClaims": 3,
        })
        not_one_claim = base_artefact(**{
            "tau2.storeItems": {
                "items": [
                    stored_item("k1", OTHER, "several changes at once", "retail/0"),
                    stored_item("k2", "Quote the order total before applying a discount code to an order",
                                "several changes at once", "retail/1", status="retired", reason="consolidated:k1"),
                ]
            }
        })
        halved = base_artefact(**{
            "tau2.distillUnit.consolidation.retained": 12,
            "tau2.distillUnit.consolidation.supportAfter": {"2": 12},
            "tau2.distillUnit.consolidation.maxSupportAfter": 2,
        })
        control = base_artefact(**{"tau2.distillUnit.unit": "correction"})
        no_unit = base_artefact(**{"tau2.distillUnit": None})
        thin = base_artefact(**{"tau2.distillUnit.traced": 3})
        airline = base_artefact(**{"tau2.scenario.test": "airline"})
        one_trial = base_artefact(**{"metrics.k": 1})
        cases: list[tuple[str, dict[str, Any], str, str | None]] = [
            ("a run at six that recurs grades", base_artefact(), "GRADED", "support 3"),
            ("a ceiling of three is not this round's treatment", unreadable, "ABANDONED", "ceiling is the registered 6"),
            ("a trace arm with no census did not run its pass", no_census, "NO_MEASUREMENT", "consolidation absent"),
            ("a run with no yield census cannot say what it yielded", no_yield, "NO_MEASUREMENT", "yieldCensus absent"),
            ("a flat yield refutes the cap and says the episode is the constraint", flat, "ABANDONED", "never the constraint"),
            ("no support 3 at ~45 claims refutes the class reading", no_three, "ABANDONED", "coincidence and not a class"),
            ("a merged group that is not one claim aborts", not_one_claim, "ABANDONED", "not one claim"),
            ("a store that halves is the dilution refutation", halved, "ABANDONED", "support bought with reach"),
            ("the correction arm is discarded", control, "DISCARDED", "unit 'correction'"),
            ("an artefact that does not record its unit cannot be read", no_unit, "NO_MEASUREMENT", "distillUnit absent"),
            ("traces on too few corrections leaves the treatment unmeasured", thin, "NO_MEASUREMENT", "traced share"),
            ("another scenario pair is discarded", airline, "DISCARDED", "registered scenario pair"),
            ("a run that did not score four trials abandons", one_trial, "ABANDONED", "registered trial count"),
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
