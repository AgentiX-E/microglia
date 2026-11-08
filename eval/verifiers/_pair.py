"""The paired verdict, which no arm artefact carries.

An arm artefact is written by one arm's driver: it knows its own tasks, its own
store and its own packs, and it has no pairing to report. The verdict and the
paired delta are written by `eval:l4-pair` into `poc-l4-pair.json`.

Every verifier in this directory read `artefact["verdict"]` -- a field that only
exists on the synthetic artefacts their own self-tests build. So the refutation
that decides whether R45 reverts a treatment could never fire on real evidence,
and the predictions phrased as "no revert branch fires" passed by not measuring
anything. A check that passes because its input is missing is worse than no check,
because the report says `PASS`.

Two shapes are read, because the two artefacts disagree about the field's name
and about where the number lives:

  arm    {"verdict": {"state": ..., "deltaPp": ...}}          -- synthetic, and
                                                                 the shape a
                                                                 future driver
                                                                 could write
  pair   {"verdict": {"state": ...}, "comparison": {"deltaPp": ...}}

`pair` wins when both are present: it is the record the pairing step wrote after
seeing both arms, and the arm cannot see the other arm at all.
"""

from __future__ import annotations

from typing import Any


def verdict_of(artefact: dict[str, Any], pair: dict[str, Any] | None) -> dict[str, Any]:
    """The verdict, from the pairing artefact when one was supplied."""
    block = (pair or {}).get("verdict")
    if isinstance(block, dict) and block:
        return block
    own = artefact.get("verdict")
    return own if isinstance(own, dict) else {}


def delta_of(pair: dict[str, Any] | None, verdict: dict[str, Any]) -> Any:
    """The paired delta in percentage points, from whichever record states it.

    The pair file keeps it under `comparison`, beside the counts it was computed
    from; an arm-level block may carry it directly. Reading only one of the two
    is how a verifier reports `delta None` beside a verdict of `HARM`.
    """
    if isinstance(verdict.get("deltaPp"), (int, float)):
        return verdict["deltaPp"]
    comparison = (pair or {}).get("comparison")
    return comparison.get("deltaPp") if isinstance(comparison, dict) else None
