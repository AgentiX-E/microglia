#!/usr/bin/env python3
"""Did the dispatched run order the schema the way the free measurement said it would?

`pnpm eval:table-recall` predicts, at zero model calls, that ordering the schema by the gold tables of
the five nearest training questions puts every gold table ahead of every non-gold one on **56.65%** of
BIRD dev, against 42.89% for the lexical anchors. `recall-order` is the arm that carries that signal,
and its artefact now records what the signal actually achieved on the prompts it sent.

This verifier compares the two. It exists because the comparison is the one thing that can turn a
null into a finding or a finding into a defect, and the direction matters:

  REPRODUCED    the arm ran the mechanism that was measured, so its accuracy column means something
  DIVERGED      the signal did not behave as measured, so the accuracy column does not — the arm that
                was paid for is not the arm that was priced, and the correct response is to fix the
                wiring rather than to read the delta
  INCOMPARABLE  the run and the prior answer different questions (a different neighbour count)
  INCONSISTENT  the artefact contradicts itself (`clean` and `cleanShare` disagree, or a share is
                outside [0, 1]), which is a defect in the artefact rather than in the arm
  NO_MEASUREMENT  no ordering arm ran, or the artefact predates the block

The band is the registered tolerance plus one sampling width at the run's own n. That second term is
not decoration: at n=350 the sampling width alone is about 5.2pp, so a fixed 5pp band would flag a
faithful run as divergent roughly a third of the time. The reverse is stated as well — at a
twenty-question rehearsal the band is wider than any defect short of an inert arm, which is why a
rehearsal proves wiring and never a verdict.

Usage:
  python3 eval/verifiers/ordering.py --artefact eval/results/poc-sota-bird-R63-recall-order.json
  python3 eval/verifiers/ordering.py --artefact <run> --prior eval/results/poc-table-recall.json
  python3 eval/verifiers/ordering.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STATES = ("REPRODUCED", "DIVERGED", "INCOMPARABLE", "INCONSISTENT", "NO_MEASUREMENT")

#: Registered in `prereg/R63-recall-order.md`, before the run.
TOLERANCE_PP = 5.0

#: The registration's second criterion: an arm that fired through its anchors on most questions is
#: measuring anchors. Below this share the run cannot speak about retrieval at all.
RETRIEVED_FLOOR = 0.90


@dataclass(frozen=True)
class Side:
    """One reading of the same three quantities, from either the prior or the run."""

    label: str
    split: str | None
    n: int
    clean: int | None
    clean_share: float
    retrieved_share: float | None
    recall_k: int | None


@dataclass(frozen=True)
class Verdict:
    state: str
    why: str
    band_pp: float | None = None
    delta_pp: float | None = None


def prior_of(artefact: dict[str, Any]) -> Side | None:
    """The free measurement's `both` signal: the one the arm ships."""
    signals = artefact.get("signals")
    if not isinstance(signals, dict):
        return None
    both = signals.get("both")
    if not isinstance(both, dict):
        return None
    return Side(
        label=str(artefact.get("id") or "prior"),
        split=None if artefact.get("split") is None else str(artefact["split"]),
        n=int(both.get("n") or 0),
        clean=int(both.get("clean") or 0),
        clean_share=float(both.get("cleanShare") or 0.0),
        retrieved_share=float(artefact.get("retrieved_share") or 0.0),
        recall_k=int(artefact.get("recall_k") or 0),
    )


def run_of(artefact: dict[str, Any]) -> Side | None:
    """The dispatch's `ordering` block, written from the prompts the arm actually sent."""
    ordering = artefact.get("ordering")
    if not isinstance(ordering, dict):
        return None
    return Side(
        label=str(artefact.get("id") or "run"),
        split=None if artefact.get("split") is None else str(artefact["split"]),
        n=int(ordering.get("n") or 0),
        clean=int(ordering.get("clean") or 0),
        clean_share=float(ordering.get("cleanShare") or 0.0),
        retrieved_share=(
            None if ordering.get("retrieved_share") is None else float(ordering["retrieved_share"])
        ),
        recall_k=None if ordering.get("recall_k") is None else int(ordering["recall_k"]),
    )


def sampling_pp(share: float, n: int) -> float:
    """One 95% width of a share at this n, in percentage points."""
    if n <= 0:
        return 0.0
    return 196.0 * math.sqrt(max(0.0, share * (1.0 - share)) / n)


def grade(run: Side | None, prior: Side | None) -> Verdict:
    """Decide the state before any number is printed, the way every verifier here does."""
    if run is None:
        return Verdict(
            "NO_MEASUREMENT",
            "the artefact carries no `ordering` block: no ordering arm ran, so there is nothing to "
            "compare against the ceiling",
        )
    if run.n <= 0:
        return Verdict("INCONSISTENT", "the ordering block scored no questions")
    if run.clean is not None and abs(run.clean / run.n - run.clean_share) > 5e-4:
        return Verdict(
            "INCONSISTENT",
            f"`clean` ({run.clean}) and `cleanShare` ({run.clean_share:.4f}) disagree over n={run.n}; "
            "the artefact is answering two questions with one field",
        )
    if not 0.0 <= run.clean_share <= 1.0:
        return Verdict("INCONSISTENT", f"a share of {run.clean_share} is outside [0, 1]")
    if prior is None:
        return Verdict(
            "INCOMPARABLE",
            "no free measurement is committed, so there is no ceiling to reproduce; run "
            "`pnpm eval:table-recall` first",
        )
    if run.split is not None and prior.split is not None and run.split != prior.split:
        # A ceiling is a property of a question set as much as of a mechanism: `clean` asks whether the
        # question determines a table set, and that share differs between splits. The first version of
        # this verifier compared a minidev run against a dev prior and called a 44.86% reading
        # divergent, while the run's precision (39.98% against 39.27%) and gold recall (99.48% against
        # 99.66%) said the mechanism was identical. What had moved was the population.
        return Verdict(
            "INCOMPARABLE",
            f"the run is on `{run.split}` and the prior on `{prior.split}`: a clean-ordering share is a "
            "property of the questions as well as of the signal, so the prior has to be taken on the "
            "same split (`pnpm eval:table-recall` against that split's directory)",
        )
    if run.recall_k is not None and prior.recall_k and run.recall_k != prior.recall_k:
        return Verdict(
            "INCOMPARABLE",
            f"the run drew {run.recall_k} neighbours and the prior drew {prior.recall_k}: a dose is a "
            "different mechanism and its ceiling is a different number",
        )
    if run.retrieved_share is not None:
        # The floor is a screening criterion and a screen cannot screen at a scale it cannot resolve:
        # 80% of twenty questions is a 95% interval of [58, 92], which is indistinguishable from the
        # floor. The share is therefore compared against the floor *minus its own width*, so a
        # rehearsal reports the number without being called divergent for it.
        reach = run.retrieved_share + sampling_pp(RETRIEVED_FLOOR, run.n) / 100.0
        if reach < RETRIEVED_FLOOR:
            return Verdict(
                "DIVERGED",
                f"retrieval contributed a table on only {run.retrieved_share * 100:.2f}% of questions "
                f"(floor {RETRIEVED_FLOOR * 100:.0f}%, and the gap survives its own ±"
                f"{sampling_pp(RETRIEVED_FLOOR, run.n):.2f}pp width at n={run.n}): the arm fired "
                "through its anchors, so it measures the signal it was meant to replace",
                None,
                None,
            )
    band = TOLERANCE_PP + sampling_pp(prior.clean_share, run.n)
    delta_pp = (run.clean_share - prior.clean_share) * 100.0
    if abs(delta_pp) <= band:
        return Verdict(
            "REPRODUCED",
            f"{run.clean_share * 100:.2f}% against the prior's {prior.clean_share * 100:.2f}% "
            f"({delta_pp:+.2f}pp, band ±{band:.2f}pp = {TOLERANCE_PP:.0f}pp registered + "
            f"{sampling_pp(prior.clean_share, run.n):.2f}pp sampling at n={run.n})",
            band,
            delta_pp,
        )
    return Verdict(
        "DIVERGED",
        f"{run.clean_share * 100:.2f}% against the prior's {prior.clean_share * 100:.2f}% "
        f"({delta_pp:+.2f}pp, outside ±{band:.2f}pp at n={run.n}): the arm that was paid for is not "
        "the arm the ceiling priced, so its accuracy column is unreadable",
        band,
        delta_pp,
    )


def render(run: Side | None, prior: Side | None, verdict: Verdict) -> str:
    lines = [f"[ordering] {verdict.state}: {verdict.why}"]
    if prior is not None:
        lines.append(
            f"[ordering] prior {prior.label}: clean={prior.clean}/{prior.n} "
            f"({prior.clean_share * 100:.2f}%) retrieved={prior.retrieved_share * 100:.2f}% "
            f"k={prior.recall_k}"
        )
    if run is not None:
        retrieved = "" if run.retrieved_share is None else f" retrieved={run.retrieved_share * 100:.2f}%"
        lines.append(
            f"[ordering] run   {run.label}: clean={run.clean}/{run.n} "
            f"({run.clean_share * 100:.2f}%){retrieved} k={run.recall_k}"
        )
    return "\n".join(lines)


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)  # type: ignore[no-any-return]


def self_test() -> int:
    """Fixtures assert the *rejecting* direction, one per state and one per arithmetic trap."""

    def side(
        n: int,
        clean: int,
        share: float | None = None,
        retrieved: float | None = 1.0,
        k: int | None = 5,
        split: str | None = "dev",
    ) -> Side:
        return Side(
            label="fixture",
            split=split,
            n=n,
            clean=clean,
            clean_share=(clean / n if share is None else share),
            retrieved_share=retrieved,
            recall_k=k,
        )

    prior = side(1534, 869, retrieved=1.0, k=5)
    cases: list[tuple[str, Side | None, Side | None, str]] = [
        ("no ordering block measures nothing", None, prior, "NO_MEASUREMENT"),
        ("an empty block is a contradiction, not a null", side(0, 0, share=0.0), prior, "INCONSISTENT"),
        (
            "a share that contradicts its own count is refused",
            side(350, 100, share=0.5665),
            prior,
            "INCONSISTENT",
        ),
        ("a share outside [0, 1] is refused", side(350, 1, share=1.5), prior, "INCONSISTENT"),
        ("no prior leaves nothing to reproduce", side(350, 198), None, "INCOMPARABLE"),
        (
            "a different neighbour count is a different mechanism",
            side(350, 198, k=1),
            prior,
            "INCOMPARABLE",
        ),
        (
            "an arm that fired through its anchors is divergent, whatever its clean share",
            side(350, 198, retrieved=0.60),
            prior,
            "DIVERGED",
        ),
        ("a faithful run reproduces the ceiling", side(350, 198), prior, "REPRODUCED"),
        (
            "the anchors arm's own reading is divergent, which is the defect this exists to catch",
            side(350, 150),
            prior,
            "DIVERGED",
        ),
        (
            "a run on another split cannot be graded against this prior",
            side(350, 157, split="minidev"),
            prior,
            "INCOMPARABLE",
        ),
        (
            "a 4pp gap at n=350 is inside the band, because sampling alone is 5.2pp wide",
            side(350, 185),
            prior,
            "REPRODUCED",
        ),
        (
            "a rehearsal cannot diverge: at n=20 the band is wider than any non-inert defect",
            side(20, 13, retrieved=0.80),
            prior,
            "REPRODUCED",
        ),
    ]
    failures = 0
    for label, run, base, expected in cases:
        verdict = grade(run, base)
        ok = verdict.state == expected
        print(f"  {'ok  ' if ok else 'FAIL'} {label} -> {verdict.state}")
        if not ok:
            print(f"       expected {expected}, got {verdict.state}: {verdict.why}")
            failures += 1
    # The band arithmetic, stated once so a later edit cannot widen it silently.
    at_350 = TOLERANCE_PP + sampling_pp(prior.clean_share, 350)
    ok = 10.0 < at_350 < 10.4
    print(f"  {'ok  ' if ok else 'FAIL'} the band at n=350 is {at_350:.2f}pp -> expected about 10.2")
    if not ok:
        failures += 1
    print(f"{failures} failure(s)")
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artefact", type=Path, help="the dispatched run's artefact")
    parser.add_argument(
        "--prior",
        type=Path,
        default=Path("eval/results/poc-table-recall.json"),
        help="the committed free measurement",
    )
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()
    if arguments.artefact is None:
        parser.error("--artefact is required unless --self-test is given")
    run = run_of(load(arguments.artefact))
    base = prior_of(load(arguments.prior)) if arguments.prior.exists() else None
    verdict = grade(run, base)
    print(render(run, base, verdict))
    # Divergence is a finding about the run, not a broken gate: the exit code says "this number does
    # not mean what it says", which is exactly what a caller about to quote it needs to know.
    return 0 if verdict.state in ("REPRODUCED", "NO_MEASUREMENT") else 1


if __name__ == "__main__":
    sys.exit(main())
