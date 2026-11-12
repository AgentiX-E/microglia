"""Where the funnel stopped, and the sentence the driver wrote when it stopped there.

Two verifiers need this and neither owns it. `r56_readback.py` reads a run whose whole question was
*which of three facts is this zero*; `r58_readback.py` reads the round that was supposed to move the
numbers feeding that funnel, so a stop at the same place is the first thing its report has to say. The
functions lived inside `r56_readback.py` until R58's verifier needed them, and a copy in the second file
is the defect this directory's `_pair.py` header describes: two implementations of one claim, drifting
the first time a branch is added, with each file's self-test grading its own copy.

The chain is rendered in the shape `funnelReading` prints it (`packages/protocol/src/gates.ts`), units
and all, because the artefact carries that sentence too and a reader holding both should not have to
work out whether `32 -> 30` and `32 correction(s) -> 30 candidate(s)` are the same chain.

`asked` and `dropped` are printed only when the artefact carries them. They were added because a zero at
the candidate stage is three different facts — an event that never reached the distiller, a reply the
parser emptied, and a reply that arrived empty — and `candidates` is counted after the parse, so it is
zero in all three. A run written before the fields existed renders exactly as it did before: a reading
is not a licence to rewrite older evidence.
"""

from __future__ import annotations

from typing import Any

# The writer is `l4.ts`'s `noMeasurement`, and the sentence after this prefix is `funnelReading`'s.
# `packages/eval/src/__tests__/stopped-run-sentence.test.ts` asserts that this literal and the one in
# the writer are the same, so a reworded note cannot turn the relay below into a silent `absent`.
STOPPED_PREFIX = "The run stopped before any task was scored:"


def funnel_chain(funnel: dict[str, Any]) -> str:
    """The chain, with the counts that tell three zeros apart."""
    marks = (
        ("corrections", "correction(s)"),
        ("asked", "asked"),
        ("candidates", "candidate(s)"),
        ("admitted", "admitted"),
        ("stored", "stored"),
        ("servable", "servable"),
    )
    chain = " -> ".join(
        f"{funnel.get(key)} {label}"
        for key, label in marks
        if not (key == "asked" and funnel.get(key) is None)
    )
    dropped = funnel.get("dropped") or {}
    total = sum(int(count) for count in dropped.values()) if isinstance(dropped, dict) else 0
    tail = [f"refused {funnel.get('refused')}", f"failed {funnel.get('failed')}"]
    if total:
        # Largest reason first, ties by name: two runs that dropped the same claims print the same
        # sentence, which is what makes the sentence diffable.
        ranked = sorted(dropped.items(), key=lambda pair: (-int(pair[1]), str(pair[0])))
        tail.append(f"{total} dropped: " + ", ".join(f"{name} {count}" for name, count in ranked))
    return f"{chain} ({', '.join(tail)})"


def refusal_sentence(artefact: dict[str, Any]) -> str | None:
    """The driver's own sentence for a run it stopped before measurement.

    `l4.ts`'s `noMeasurement` writes it as the first note, and the sentence is `funnelReading`'s: one
    implementation of *where the funnel stopped*, produced by the code that has the funnel in hand.
    Re-deriving it here would be a second implementation of one claim, and the two would drift the
    first time a branch was added — so this relays it instead.

    Both note shapes are read because the artefact stores notes as an object keyed by index once it has
    been through `writeJson`, and as a list while it is still in memory.
    """
    notes = artefact.get("notes")
    if isinstance(notes, dict):
        texts = [str(notes[key]) for key in sorted(notes, key=str)]
    elif isinstance(notes, list):
        texts = [str(text) for text in notes]
    else:
        return None
    for text in texts:
        if text.startswith(STOPPED_PREFIX):
            return text[len(STOPPED_PREFIX):].strip()
    return None


def funnel_notes(report: Any, artefact: dict[str, Any]) -> None:
    """Both readings, in the order a reader needs them: the chain, then why it stopped.

    `absent` rather than silence for the sentence, so a reader can tell *no sentence was written* from
    *this reader forgot to look*. That distinction is R56's finding: its artefact carried the sentence
    and the report printed the funnel as `12 -> 0`, leaving the question the sentence answers to
    whoever read the number.
    """
    funnel = (artefact.get("tau2") or {}).get("funnel") or {}
    if funnel:
        report.note(f"funnel: {funnel_chain(funnel)}")
    report.note(f"stopped before measurement: {refusal_sentence(artefact) or 'absent'}")
