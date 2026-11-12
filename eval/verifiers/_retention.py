"""Retention as a sentence, because the number is in the artefact and nothing read it.

`pass^4` collapses four trials into one number and cannot separate a memory that helped once
from one that carried a task every time. The comparator this lane is graded against persists a
memory inside a single episode and reports hold rate -- `P(pass at t+1 | pass at t)`, pooled over
pairs, `undefined` when there is no pair. `l4-pair` writes that reading as `retention`, and until
this module existed the pair artefact carried a number no reader printed, which is the same defect
as a counter taken after the parse: correct, and invisible.

Two things the sentence has to say that a rate alone cannot:

  - **`undefined` is not zero.** No pair at all means this run cannot answer, and printing `0.000`
    would say the knowledge never held -- a claim about the memory drawn from an absence of
    evidence. The word is printed, not a number.
  - **the denominator is pairs, not tasks.** A rate over seven pairs is not comparable to one over
    twenty, so both counts are printed beside the rate, and tasks that carried no ordered outcomes
    are counted rather than silently dropped from the population.
"""

from __future__ import annotations

from typing import Any

# The pair writes the two arms under these names and in this order -- reference first, because the
# memory arm is the treatment and a sentence that led with it would read as the baseline.
ARMS = ("reference", "memory")

ABSENT = "retention: absent (no per_trial ledger on both arms, so there is no pair sequence to read)"


def _rate_of(arm: str, reading: Any) -> str:
    """One arm's rate, with the counts that give it a denominator."""
    if not isinstance(reading, dict):
        return f"{arm} absent"
    rate = reading.get("rate")
    held = reading.get("held")
    pairs = reading.get("pairs")
    # `undefined` in the artefact is `None` in Python, and it is printed as the word rather than as
    # a zero the run did not measure.
    shown = "undefined" if not isinstance(rate, (int, float)) else f"{rate:.3f}"
    sentence = f"{arm} {shown} ({held} held of {pairs} pair(s))"
    ordered = reading.get("ordered")
    without = reading.get("withoutOrder")
    if isinstance(without, int) and without > 0:
        sentence += f", {without} of {(ordered if isinstance(ordered, int) else 0) + without} task(s) carried no order"
    return sentence


def retention_note(pair: dict[str, Any]) -> str:
    """The retention line for a pair artefact, or the word `absent` with its reason.

    `absent` rather than an empty string: a reader that prints nothing here is a reader whose
    output cannot distinguish "this pair has no retention" from "this reader does not look".
    """
    retention = pair.get("retention")
    if not isinstance(retention, dict):
        return ABSENT
    parts = ", ".join(_rate_of(arm, retention.get(arm)) for arm in ARMS)
    return (
        f"retention: {parts} -- P(pass at t+1 | pass at t), pooled over consecutive pairs, not "
        "averaged per task"
    )
