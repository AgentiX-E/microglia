#!/usr/bin/env python3
"""R59 readback: did a floor the store set make one claim out of two, and does the store recur?

The registration is `prereg/R59-containment.md`. R58 answered the *object* question — one task
trace carries more than one claim — and left recurrence at zero, with two refutations fired. This
round repairs two measured defects and is read as three questions:

  the pass    did it merge anything at all, and are the groups it merged one claim?
  the measure was the containment floor the reason, or would Jaccard have merged the same groups?
  the arm     is the store's recurrence reading taken over the population the treatment ran on?

The second question is what separates this readback from its predecessor: the artefact carries the
stored items, so the same store can be re-scored under the floor R58 used. That turns "the measure
changed and the numbers moved" into "the measure changed and here is what it did to this store",
without buying a second dispatch.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no unit, no traces, or no census.
  DISCARDED       the artefact is the control arm or another scenario pair.
  ABANDONED       a refutation fired: nothing merged, a group is not one claim, the store halved,
                  or the two measures agree on this store.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r59
  python3 r59_readback.py --dir /tmp/r59
  python3 r59_readback.py --self-test
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R59-containment.md`, written before the measurement existed.
PREDICTED_GROUPS_MIN = 1
PREDICTED_SUPPORT2_MIN = 1
PREDICTED_RETAINED_SHARE_MIN = 0.50
PREDICTED_TRACED_SHARE_MIN = 0.80
CONTENT_FLOOR = 0.60
CONDITION_MIN_SHARED = 3
PREVIOUS_CONTENT_FLOOR = 0.70
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}

# The stop list `claimTokens` uses, quoted rather than approximated: a re-scoring under a different
# tokenizer would compare two measures and call the difference a finding.
STOPWORDS = frozenset(
    """
    a an the and or of to in on for with is are be been that this these those it its you your
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
# the measure, re-implemented so the artefact can be re-scored
# --------------------------------------------------------------------------- #


def tokens(text: str) -> frozenset[str]:
    return frozenset(
        piece for piece in re.split(r"[^a-z0-9]+", text.lower()) if piece and piece not in STOPWORDS
    )


def containment(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / min(len(left), len(right))


def jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def shared(left: frozenset[str], right: frozenset[str]) -> int:
    return len(left & right)


def _evidence_key(entry: dict[str, Any]) -> str:
    return f"{entry.get('feedbackId')}\u0000{entry.get('runId')}"


def _evidence_rows(entry: dict[str, Any]) -> list[dict[str, Any]] | None:
    rows = entry.get("evidence")
    if not isinstance(rows, list) or not rows:
        return None
    return [row for row in rows if isinstance(row, dict)]


def _same_evidence(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Whether two items rest on the same event.

    Undecidable from most artefacts — the projection stores an evidence *count* — and reported as
    "not the same" rather than guessed: a re-scoring that refused pairs on a field it cannot read
    would report a smaller floor than the run had.
    """
    left_rows, right_rows = _evidence_rows(left), _evidence_rows(right)
    if not left_rows or not right_rows:
        return False
    keys = {_evidence_key(entry) for entry in left_rows}
    return all(_evidence_key(entry) in keys for entry in right_rows)


def _pre_pass(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The store as it stood before the pass: the survivors plus the items it retired.

    This is the population a re-scoring has to run over. Restricting it to the live items would
    re-score a store that has already been merged, find no pair, and report the floor as inert on
    a store where it merged one.
    """
    out = []
    for entry in items:
        if entry.get("status") != "retired":
            out.append(entry)
        elif str(entry.get("statusReason") or "").startswith("consolidated:"):
            out.append(entry)
    return out


def _groups_under(items: list[dict[str, Any]], measure: str) -> tuple[int, list[list[int]]]:
    """How many groups a pass with this measure would merge over these items.

    A re-scoring of what the artefact stored, not a re-run of the pass: the population is the
    items the run held before its pass, so the reading says what the *floor* does to this store
    rather than what a second dispatch would have produced.
    """
    live = _pre_pass(items)
    text = [tokens(str(entry.get("statement") or "")) for entry in live]
    conditions = [tokens(str(entry.get("when") or "")) for entry in live]
    parent = list(range(len(live)))

    def find(index: int) -> int:
        while parent[index] != index:
            index = parent[index]
        return index

    for left, right in itertools.combinations(range(len(live)), 2):
        one, other = live[left], live[right]
        if one.get("kind") != other.get("kind"):
            continue
        if json.dumps(one.get("scope"), sort_keys=True) != json.dumps(other.get("scope"), sort_keys=True):
            continue
        if measure == "containment":
            if containment(text[left], text[right]) < CONTENT_FLOOR:
                continue
            if conditions[left] and conditions[right]:
                if shared(conditions[left], conditions[right]) < CONDITION_MIN_SHARED:
                    continue
        else:
            if jaccard(text[left], text[right]) < PREVIOUS_CONTENT_FLOOR:
                continue
            if conditions[left] and conditions[right]:
                if jaccard(conditions[left], conditions[right]) < PREVIOUS_CONTENT_FLOOR:
                    continue
        if one.get("payload") is not None and other.get("payload") is not None:
            if one.get("payload") != other.get("payload"):
                continue
        if _same_evidence(one, other):
            continue
        one_root, other_root = find(left), find(right)
        if one_root != other_root:
            parent[other_root] = one_root

    buckets: dict[int, list[int]] = {}
    for index in range(len(live)):
        buckets.setdefault(find(index), []).append(index)
    groups = [bucket for bucket in buckets.values() if len(bucket) >= 2]
    return len(groups), groups


def group_readings(items: list[dict[str, Any]]) -> tuple[list[tuple[float, str, str]], bool]:
    """Every group the run merged, with the containment of its closest pair.

    The count of groups is not evidence that the groups are claims. This is the reading that says
    whether the floor fell below the register's resolution: a merged pair whose statements are not
    contained in one another is a distinction the store was built to keep.

    Two ways to link a retired member to the survivor that absorbed it. The store writes
    `statusReason: consolidated:<id>`, and the projection began carrying it after R59 — an artefact
    written before that has the retired item and the corroborated survivor but no pointer between
    them. In that case the link is **inferred** from content: the live item whose statement contains
    this one most. That is exact when the store merged one group and can only be an over-estimate
    when it merged more, because the closest survivor is chosen for each member — so the inference
    makes the "not one claim" refutation harder to fire and never easier. The second return value
    says whether any link was inferred, so a reading built on one can say so.
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
        score = containment(tokens(statement), tokens(str(survivor.get("statement") or "")))
        out.append((score, statement, str(survivor.get("statement") or "")))
    return out, inferred


# --------------------------------------------------------------------------- #
# grading
# --------------------------------------------------------------------------- #


def share(numerator: float, denominator: float) -> float | None:
    return None if denominator <= 0 else numerator / denominator


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
        report.refute("the dispatch ran the treatment rather than the control", True, f"unit {unit.get('unit')!r}")
        return "DISCARDED", report

    learning = tau2.get("learning") or {}
    edited = learning.get("edited")
    rows = learning.get("rows")
    traced = unit.get("traced")
    if not isinstance(traced, int) or not isinstance(edited, int):
        report.predict("the artefact records what it read", None, f"traced={traced!r}, edited={edited!r}")
        return "NO_MEASUREMENT", report
    traced_share = share(traced, edited)
    report.predict(
        f"at least {PREDICTED_TRACED_SHARE_MIN:.0%} of the corrections carry a trace",
        traced_share is not None and traced_share >= PREDICTED_TRACED_SHARE_MIN,
        f"{traced} of {edited} ({traced_share:.3%})" if traced_share is not None else "no corrections",
    )
    if traced_share is None or traced_share < PREDICTED_TRACED_SHARE_MIN:
        report.note("traced share below the floor: the unit under test did not run on this population")
        return "NO_MEASUREMENT", report

    form = tau2.get("distillForm") or {}
    refused = form.get("refused")
    report.predict(
        "the ban refuses none of the claims, because the trace form writes conditions in the requester's words",
        None if not isinstance(refused, int) else refused == 0,
        f"form {form.get('form')!r}, refused {refused!r}",
    )

    census = unit.get("consolidation")
    if not isinstance(census, dict):
        report.predict("the recurrence pass ran and reported its census", None, "consolidation absent")
        return "NO_MEASUREMENT", report

    considered = census.get("considered")
    retained = census.get("retained")
    groups = census.get("groups")
    if not all(isinstance(value, int) for value in (considered, retained, groups)):
        report.predict("the census carries its counts", None, json.dumps(census)[:120])
        return "NO_MEASUREMENT", report

    after = census.get("supportAfter") or {}
    values: list[int] = []
    for key, count in after.items():
        try:
            values.append(int(key))
            values.extend([int(key)] * (int(count) - 1))
        except (TypeError, ValueError):
            continue
    if not values:
        report.predict("the census carries an after-distribution", None, "supportAfter empty")
        return "NO_MEASUREMENT", report

    at_two = sum(1 for value in values if value >= 2)
    retained_share = share(retained, considered)

    report.predict(
        "the pass is no longer inert: at least one group merges",
        groups >= PREDICTED_GROUPS_MIN,
        f"{groups} group(s), {census.get('merged')} item(s) merged",
    )
    report.predict(
        f"at least {PREDICTED_SUPPORT2_MIN} item(s) reach support 2",
        at_two >= PREDICTED_SUPPORT2_MIN,
        f"{at_two} of {len(values)} (after {distribution(values)}, before {census.get('supportBefore')})",
    )
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

    report.predict(
        "the learning half is the whole half the split produced",
        None if not isinstance(rows, int) else rows > 32,
        f"rows {rows!r} (R58 read 32), edited {edited!r}",
    )

    # The attribution reading: the same store under the floor R58 used.
    #
    # It is only a reading when the pass left the store alone. The artefact carries the store *after*
    # the pass, so a run that merged two items has one item fewer and the pair is gone: re-scoring it
    # under either measure finds nothing, which says nothing about either measure. R58 could be
    # re-scored because its pass merged nothing; R59 cannot be, and grading it as a failed prediction
    # would abandon a run for the shape of the artefact rather than for what it measured.
    stored = (tau2.get("storeItems") or {}).get("items")
    items = stored if isinstance(stored, list) and stored else None
    re_scorable = items is not None and groups == 0
    if items is None:
        report.predict(
            "the floor is the reason: Jaccard at 0.70 merges strictly fewer groups than containment at 0.60",
            None,
            "storeItems absent",
        )
    elif not re_scorable:
        report.predict(
            "the floor is the reason: Jaccard at 0.70 merges strictly fewer groups than containment at 0.60",
            None,
            f"the pass merged {groups} group(s): the stored sample is the post-pass store and holds no pair to re-score",
        )
        report.note(
            "the attribution reading is unavailable here, and not because the run was silent: the store "
            "the artefact carries is the one the pass left, so the pair it merged is not in it"
        )
    else:
        kept_before, _ = _groups_under(items, "jaccard")
        kept_after, _ = _groups_under(items, "containment")
        report.predict(
            "the floor is the reason: Jaccard at 0.70 merges strictly fewer groups than containment at 0.60",
            kept_after > kept_before,
            f"containment {kept_after} group(s) against Jaccard {kept_before} over {len(items)} stored item(s)",
        )
        report.note(f"re-scoring over the store the run kept: containment {kept_after}, Jaccard {kept_before}")

    # What the pass actually did, on the store it left — which is a different question from what the
    # floor would do to that store, and the only one that can be asked of a run that merged something.
    if items:
        readings, inferred = group_readings(items)
        priced = [row for row in readings if row[2] != "(survivor not in the sample)"]
        if readings:
            if inferred:
                report.note(
                    "the retired members carry no statusReason: each was linked to the live item that "
                    "contains it most, which is exact for one group and can only over-state for more"
                )
            for score, member, survivor in readings:
                jac = jaccard(tokens(member), tokens(survivor))
                report.note(
                    f"  merged {score:.3f} containment / {jac:.3f} Jaccard: {member[:100]!r} -> {survivor[:100]!r}"
                )
            report.refute(
                "a merged group is not one claim: the floor fell below the register's resolution",
                bool(priced) and min(row[0] for row in priced) < CONTENT_FLOOR,
                f"weakest pair {min((row[0] for row in priced), default=0.0):.3f} against a floor of {CONTENT_FLOOR:.2f}",
            )
        else:
            report.note("no merged group carries a retired member in the sample")

    coverage = tau2.get("coverage") or {}
    quantiles = coverage.get("nonzeroQuantiles") or {}
    report.note(
        f"census: {considered}→{retained} item(s), floors {census.get('threshold')} content / "
        f"{census.get('conditionMinShared')} shared condition term(s), refusals "
        f"condition/payload/evidence {census.get('refusedCondition')}/{census.get('refusedPayload')}/"
        f"{census.get('refusedDuplicateEvidence')}"
    )
    report.note(
        f"learning {rows!r} row(s), {edited!r} correction(s); coverage p50 {quantiles.get('p50')!r}"
    )

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

    # R59's refutations, in the order the registration states them.
    report.refute(
        "no group merges again: lexical consolidation is inert on this register",
        groups == 0,
        f"{groups} group(s) over {considered} item(s)",
    )
    report.refute(
        "the pass bought support by halving the store",
        retained_share is not None and retained_share < PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept",
    )
    if re_scorable:
        kept_before, _ = _groups_under(items or [], "jaccard")
        kept_after, _ = _groups_under(items or [], "containment")
        report.refute(
            "the two measures agree on this store, so the calibration is wrong about which reading was inert",
            kept_after == kept_before and kept_after >= 1,
            f"containment {kept_after} against Jaccard {kept_before}",
        )
        if kept_after == 0 and groups > 0:
            report.note(
                "the re-scoring found no group on the stored sample while the run merged "
                f"{groups}: the sample is the post-pass store, not the population the pass read"
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
    "stated them and stop once all are applied rather than adding extra lookups or calculations"
)
OTHER = (
    "When a request involves multiple orders apply the requested change to every affected order not just "
    "one before finishing"
)
NEAR_JACCARD_A = "confirm identity before changing pending reservation total items"
NEAR_JACCARD_B = "confirm identity before changing pending reservation total items quote"


def stored_item(identifier: str, statement: str, when: str, task: str, status: str = "active",
                reason: str | None = None, support: int = 1) -> dict[str, Any]:
    return {
        "id": identifier,
        "kind": "procedure",
        "scope": {"task": "retail"},
        "statement": statement,
        "when": when,
        "status": status,
        "statusReason": reason or "confidence-cleared",
        "payload": None,
        "supportTasks": support,
        "evidence": [
            {"feedbackId": f"fb_{identifier}_{index}", "runId": f"run_{identifier}", "taskId": task}
            for index in range(support)
        ],
    }


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: one group merged, one item at support 2, the whole learning half used."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.60, "k": 4, "tasks": 57},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {"rows": 57, "edited": 13},
            "distillForm": {"form": "trace", "refused": 0},
            "distillUnit": {
                "unit": "trace",
                "traces": 57,
                "traced": 13,
                "claims": 26,
                "consolidation": {
                    "considered": 24,
                    "groups": 1,
                    "merged": 1,
                    "retained": 23,
                    "threshold": 0.6,
                    "conditionMinShared": 3,
                    "refusedCondition": 0,
                    "refusedPayload": 0,
                    "refusedDuplicateEvidence": 0,
                    "supportBefore": {"1": 24},
                    "supportAfter": {"1": 22, "2": 1},
                    "maxSupportBefore": 1,
                    "maxSupportAfter": 2,
                },
            },
            "coverage": {"measuredPairs": 228, "nonzeroQuantiles": {"p50": 0.071}},
            "storeItems": {
                "items": [
                    stored_item("k1", PAIR_A, "the user asks for several changes in one request", "retail/0"),
                    stored_item(
                        "k2",
                        PAIR_B,
                        "the user asks for several modifications in one request",
                        "retail/1",
                        status="retired",
                        reason="consolidated:k1",
                    ),
                    stored_item("k3", OTHER, "the customer has more than one order", "retail/2"),
                ]
            },
        },
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
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        inert = base_artefact(**{
            "tau2.distillUnit.consolidation.groups": 0,
            "tau2.distillUnit.consolidation.merged": 0,
            "tau2.distillUnit.consolidation.retained": 24,
            "tau2.distillUnit.consolidation.supportAfter": {"1": 24},
            "tau2.storeItems": None,
        })
        halved = base_artefact(**{
            "tau2.distillUnit.consolidation.retained": 8,
            "tau2.distillUnit.consolidation.merged": 16,
            "tau2.distillUnit.consolidation.supportAfter": {"2": 8},
        })
        # The calibration refutation is about a store the pass left alone: on a post-pass store the
        # merged pair is gone, so "containment merges nothing here" is the artefact's shape and not a
        # fact about either measure. The fixture is therefore a store the pass did not touch but
        # which both measures would merge — the case the refutation exists for.
        agree = base_artefact(**{
            "tau2.distillUnit.consolidation.groups": 0,
            "tau2.distillUnit.consolidation.merged": 0,
            "tau2.distillUnit.consolidation.retained": 24,
            "tau2.distillUnit.consolidation.supportAfter": {"1": 24},
            "tau2.storeItems": {
                "items": [
                    stored_item("k1", NEAR_JACCARD_A, "the user asks for several changes", "retail/0"),
                    stored_item(
                        "k2",
                        NEAR_JACCARD_B,
                        "the user asks for several changes",
                        "retail/1",
                        status="retired",
                        reason="consolidated:k1",
                    ),
                ]
            },
        })
        post_pass = base_artefact(**{
            "tau2.distillUnit.consolidation.groups": 1,
            "tau2.distillUnit.consolidation.merged": 1,
            "tau2.distillUnit.consolidation.retained": 23,
            "tau2.distillUnit.consolidation.supportAfter": {"1": 22, "2": 1},
            "tau2.storeItems": {
                "items": [
                    stored_item("k1", PAIR_A, "several changes at once", "retail/0", support=2),
                    stored_item("k3", OTHER, "several changes at once", "retail/2"),
                ]
            },
        })
        not_one_claim = base_artefact(**{
            "tau2.storeItems": {
                "items": [
                    stored_item("k1", OTHER, "the customer has more than one order", "retail/0"),
                    stored_item(
                        "k2",
                        "Quote the order total before applying a discount code to an order",
                        "the customer has more than one order",
                        "retail/1",
                        status="retired",
                        reason="consolidated:k1",
                    ),
                ]
            }
        })
        cases: list[tuple[str, dict[str, Any], str, str | None]] = [
            ("a store whose two closest items are one claim grades", base_artefact(), "GRADED", None),
            ("a pass that merged nothing again abandons: the mechanism is inert", inert, "ABANDONED", "no group merges again"),
            ("a store that recurs by halving is the R56 defect and abandons", halved, "ABANDONED", "halving the store"),
            (
                "both measures merging the same group abandons: the calibration is wrong",
                agree,
                "ABANDONED",
                "the two measures agree",
            ),
            (
                "a merged group that is not one claim abandons: the floor is too low",
                not_one_claim,
                "ABANDONED",
                "not one claim",
            ),
            (
                "a post-pass store grades the merge it shows and leaves the re-scoring ungraded",
                post_pass,
                "GRADED",
                "holds no pair to re-score",
            ),
            (
                "the correction arm is discarded rather than reinterpreted",
                base_artefact(**{"tau2.distillUnit.unit": "correction"}),
                "DISCARDED",
                None,
            ),
            (
                "an artefact that does not record its unit cannot be read",
                base_artefact(**{"tau2.distillUnit": None}),
                "NO_MEASUREMENT",
                None,
            ),
            (
                "a trace arm with no census did not run its pass",
                base_artefact(**{"tau2.distillUnit.consolidation": None}),
                "NO_MEASUREMENT",
                None,
            ),
            (
                "traces on too few corrections leaves the treatment unmeasured",
                base_artefact(**{"tau2.distillUnit.traced": 3}),
                "NO_MEASUREMENT",
                None,
            ),
            (
                "another scenario pair is discarded",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
                None,
            ),
            (
                "no storeItems leaves the attribution reading ungraded rather than failed",
                base_artefact(**{"tau2.storeItems": None}),
                "GRADED",
                "storeItems absent",
            ),
            (
                "no distillForm leaves the ban reading ungraded rather than failed",
                base_artefact(**{"tau2.distillForm": None}),
                "GRADED",
                "refused None",
            ),
            (
                "a learning half still capped at 32 fails the population prediction",
                base_artefact(**{"tau2.learning.rows": 32}),
                "ABANDONED",
                "rows 32",
            ),
            (
                "a run that did not score four trials abandons",
                base_artefact(**{"metrics.k": 1}),
                "ABANDONED",
                "registered trial count",
            ),
        ]
        failures = 0
        for label, artefact, expected, fragment in cases:
            state, report = grade(artefact)
            rendered = report.render()
            # The state alone can pass for the wrong reason: a fixture that abandons because the run
            # scored one trial would also pass a case written about the calibration. The fragment is
            # what says *which* reason fired.
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
