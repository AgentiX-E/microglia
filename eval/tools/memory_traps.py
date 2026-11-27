#!/usr/bin/env python3
"""R237's readout: what the served block carries that the episode did not need, and one quantity that looked like a
trap and turned out to be the wrong denominator.

`MemTrapBench` (arXiv 2608.20202) prices the failure this repo has been arguing about from the other side. It plants a
memory that is faithfully recorded and semantically relevant, then changes the conditions under which it applies, and
measures what the memory does to the answer. **Every one of its five strategies loses to the no-memory control** —
FullText −24.5, MemOS −24.5, SimpleMem −30.5, LightMem −15.1, EverMemOS −14.0 points on Gemini-3-Flash; −10.8 to
−19.0 on Qwen3-30B — and the loss survives a length ablation (92.3 → 36.0 the moment any memory is added, then a
further 5.0 as it grows). Its two families:

* **Reasoning Fixation** — a past strategy, successful or punished, applied past the conditions that made it work.
* **Belief Distortion** — a memory changes what the model treats as true.

Both names are new here; the phenomena are not. So the question this file asks is the one our own transcripts can
decide at zero model calls:

> Of the asks the window carried at the moment of a write, how many were lines this call did not use, how many were
> asks the settlement rule had to remove, and how often did the episode re-issue a call the environment refused?

**The quantity that failed its own test.** The obvious in-lane form of Belief Distortion is "the block says a family
is outstanding after a successful write of that family" — and read that way the control grid returns **507 of 4,447
shown lines, 11.4%**, which reads as a defect the size of the round. It is not. `--sample` prints the windows and the
sample is unambiguous: after the desk lamp exchange is credited, the asks for the water bottle, the desk lamp and the
USB-C adapter are one family and three separate products, and two of the three are still outstanding. A **family**
is what the board settles by; an **ask** is what the model reads. The 11.4% is a rate over the wrong unit — the fifth
time this repository has found the same class of error (AUDIT 34.332, 34.336) — and it is reported here as `rejected`
rather than quietly dropped, because a number that was computed and then refuted is evidence about the instrument.

What an ask-level version needs is a binding from the ask's words to the identifiers the writes carry, which the
transcripts do hold (the product lookups return name and id together) but which this file does not yet build. That is
R238's registration, not a footnote here.

**The three quantities that survive.**

    hidden      settled asks sitting inside the line budget that the renderer removes — what the settlement rule is
                worth in lines, not what it prevents
    unused      open asks the call at that moment did not name: the line the block spent and the episode did not use
    fixation    a write whose family and argument signature repeat an earlier write the environment refused — the
                cheapest in-lane form of Reasoning Fixation, and the only one a receipt can decide

Denominators: `hidden` and `unused` over **windows** (one per assistant message, since two calls in one message are
answered by one block), `fixation` over **writes**, and the pass contrast over **episodes**. The contrast is
observational and is reported with its interval; it is a hypothesis for a registration, never a finding.

    python3 eval/tools/memory_traps.py --document clause.json [--scope clause] [--json] [--sample 4]
                                       [--save out.json] [--check out.json] [--self-test]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

#: A window that carries this many lines and uses none of them is a block that spent prompt on nothing. Reported as a
#: stratum and not as a bar: the harm it does is a pass-rate question and this file is not powered for one.
CROWDED_LINES = 4

#: How many windows `--sample` prints. Four is enough to see that a family is not a product, which is the whole
#: argument for rejecting the family-level quantity.
SAMPLES = 4


def _digest(path: str) -> dict:
    """A document's size and sha256, so a reading names the bytes it came from."""
    import hashlib

    data = Path(path).read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "path": os.path.basename(path)}


def _siblings() -> str:
    """Put this file's own directory on `sys.path`, and answer it."""
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    return here


def _modules():
    """The two serving modules, imported at the call rather than at the module.

    A reader with its own copy of either would be measuring a block the model never saw, which is the defect R236 was
    registered to close (AUDIT 34.335). `read_anchor.moment` rebuilds the board as it stood before a message and
    `goal_board` is the renderer the driver ran.
    """
    _siblings()
    import goal_board  # noqa: PLC0415 - see `_siblings`
    import read_anchor  # noqa: PLC0415

    return goal_board, read_anchor


def signature(write: dict) -> str:
    """The identity of a call as the environment saw it: the family plus the arguments it was given.

    Read from `args`, which is the key the receipts carry. A signature read from `arguments` would be the repr of
    `None` for every call in the corpus, which makes every refusal look like a repeat of every other refusal.
    """
    arguments = write.get("args")
    if arguments is None:
        arguments = write.get("arguments")
    if isinstance(arguments, dict):
        try:
            payload = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
        except (TypeError, ValueError):  # pragma: no cover - arguments are JSON from a transcript
            payload = repr(sorted(arguments.items()))
    else:
        payload = repr(arguments)
    return f"{write.get('family')}|{payload}"


def classify(window: dict, write: dict, done: "dict[str, int]", index: int) -> dict:
    """One window, read into the counts. Pure: no board, no messages, no clock.

    `window` is `items[:cap]` as it stood before the message that carried the call, `done` maps a family to the
    message index of its first successful write, and `index` is where this call sits. `familyStale` is computed
    because a rejected quantity has to stay computable: the manifest records it, `--sample` explains it, and nothing
    gates on it.
    """
    shown = [item for item in window if not item.get("settled")]
    hidden = [item for item in window if item.get("settled")]
    family_stale = [item for item in shown if done.get(item.get("family"), index + 1) < index]
    # The rejection is not one quantity but two, and only the split makes it readable. A family whose asks were
    # discharged earlier shows a settled line beside its open ones, and the open ones are other products: legitimate
    # work still outstanding. A family with **no** settled line anywhere in the window is the other case — a write of
    # that family succeeded and nothing on the board moved — and that is the block asserting work the episode has
    # already done. `ask_board` settles an ask only when the write touches a record the episode **opened**
    # (`record in seen`), so a successful call to an order the model never looked up settles nothing.
    settled_families = {item.get("family") for item in hidden}
    stale_unsettled = [item for item in family_stale if item.get("family") not in settled_families]
    unused = [item for item in shown if item.get("family") != write.get("family")]
    return {
        "shown": len(shown),
        "hidden": len(hidden),
        "familyStale": len(family_stale),
        "staleUnsettled": len(stale_unsettled),
        "staleMulti": len(family_stale) - len(stale_unsettled),
        "unused": len(unused),
        # A call the window answered: the family was open in front of the model when it wrote. A share of unused lines
        # means nothing without the share that were used.
        "used": len(shown) - len(unused),
        "crowded": 1 if len(shown) >= CROWDED_LINES and not (len(shown) - len(unused)) else 0,
    }


def refusals(entry: dict) -> "dict[str, int]":
    """How many times each call signature was issued **after** a refusal of that same signature.

    The first issue is never a repeat: trying something once is not fixation. A success clears the refusal, because
    an episode that changed the call and was accepted is not being stubborn, and counting the corrected call as the
    pathology would invert the finding.
    """
    counts: dict = {}
    refused: set = set()
    for (kind, payload), _index in zip(entry["events"], entry["at"]):
        if kind != "write":
            continue
        write = entry["writes"][payload]
        key = signature(write)
        if write.get("ok"):
            refused.discard(key)
            continue
        if key in refused:
            counts[key] = counts.get(key, 0) + 1
        else:
            refused.add(key)
            counts.setdefault(key, 0)
    return counts


def served_points(module, messages, index: int, scope: str, cap: int, written: dict) -> dict:
    """The block the **product** would render at this message, and the lines in it that name work already done.

    A second reading rather than a second instrument. `moment` rebuilds the board under the read-anchored settlement
    rule (a receipt settles an ask of its family only if the episode had *opened* the record it touched), and the
    product renders the board under `goal_board`'s rule (a product name, a free-text value, or — since R238 — the
    record the ask itself names). The two disagree on 133 of 4,968 item-moments in this grid, all of them inside a
    family, so a quantity taken over families cannot tell them apart and a quantity taken over asks can.

    `stale` is the mechanical one: an open ask whose clause names a record that a successful write **of its family**
    had already carried. `familyStale` is the same question asked of the family instead of the ask, kept beside it
    because the difference between the two numbers is the whole reason this file exists.
    """
    board = module.board_of(messages[:index], scope)
    # The rung the board renders at, applied before the cut: `board_of` states the rung and `displayed` imposes it, and
    # a window taken from the unordered items would be eight lines the model never saw (R236's lesson, one level down).
    window = module.displayed(board["items"], board.get("display") or "statement")[:cap]
    shown = stale = family = 0
    samples: list = []
    for item in window:
        if item.get("settled_by"):
            continue
        shown += 1
        done = written.get(item.get("family")) or set()
        if done:
            family += 1
            shared = module.records_in(item.get("clause") or "") & done
            if shared:
                stale += 1
                if len(samples) < 2:
                    samples.append({"message": index, "family": item.get("family"),
                                    "clause": item.get("clause"), "records": sorted(shared)})
    return {"shown": shown, "stale": stale, "familyStale": family, "samples": samples}


def episode_reading(task, simulation: dict, scope: str = "clause", cap=None) -> dict:
    """One episode: the trap counts, whether it passed, and a sample of the quantity that was rejected."""
    _board, anchors = _modules()
    messages = simulation.get("messages") or []
    if cap is None:
        # The product's window, read from the instrument that restates it: `CAP` is the parser's `MAX_ITEMS`, and the
        # parser's own self-test binds that to the serving manifest's `blockLines`.
        cap = anchors.CAP
    entry = anchors.ledger(messages)
    order = "open" if scope == "clause" else "statement"
    fold = scope == "clause"
    counts = {"shown": 0, "hidden": 0, "familyStale": 0, "staleUnsettled": 0, "staleMulti": 0,
              "unused": 0, "used": 0, "crowded": 0}
    served = {"shown": 0, "stale": 0, "familyStale": 0}
    served_samples: list = []
    written: dict = {}
    done: dict = {}
    windows = 0
    last_index = None
    board_at = None
    samples: list = []
    for (kind, payload), index in zip(entry["events"], entry["at"]):
        if kind != "write":
            continue
        write = entry["writes"][payload]
        # One block per message, not per call: two calls in one assistant message were answered by the same window,
        # and recomputing it twice would count the same lines twice (R232's `moment` exists for this reason).
        if index != last_index:
            board_at = anchors.moment(entry, messages, index, scope, order=order, fold=fold)
            points = served_points(_board, messages, index, scope, cap, written)
            for key in served:
                served[key] += points[key]
            served_samples.extend(points["samples"])
            windows += 1
        last_index = index
        window = board_at["items"][:cap]
        row = classify(window, write, done, index)
        for key in counts:
            counts[key] += row[key]
        if row["familyStale"] and len(samples) < SAMPLES:
            samples.append(
                {
                    "message": index,
                    "write": write.get("name"),
                    "open": [[item.get("family"), item.get("words")] for item in window if not item.get("settled")],
                }
            )
        if write.get("ok"):
            done.setdefault(write.get("family"), index)
            # The records this write carried, for the served reading only: an order-level call carries the order and
            # nothing else, and that is exactly the case the record grade exists for.
            written.setdefault(write.get("family"), set()).update(
                str(value).lower() for value in write.get("ids") or () if str(value).startswith("#")
            )
    repeats = refusals(entry)
    reward = (simulation.get("reward_info") or {}).get("reward")
    return {
        "task": str(simulation.get("task_id")),
        "windows": windows,
        "writes": len(entry["writes"]),
        "refused": sum(1 for write in entry["writes"] if not write.get("ok")),
        "fixation": sum(repeats.values()),
        "passed": bool(reward == 1.0),
        "samples": samples,
        **counts,
        **{f"served{key[0].upper()}{key[1:]}": value for key, value in served.items()},
        "servedSamples": served_samples[:2],
    }


def reading(document: dict, scope: str = "clause") -> dict:
    """A document read into the round's quantities, with the populations each is taken over."""
    tasks = {str(task.get("id")): task for task in document.get("tasks") or []}
    rows = []
    skipped = 0
    for simulation in document.get("simulations") or []:
        if not (simulation.get("messages") or []):
            skipped += 1
            continue
        rows.append(episode_reading(tasks.get(str(simulation.get("task_id"))), simulation, scope))
    episodes = len(rows)
    windows = sum(row["windows"] for row in rows)
    shown = sum(row["shown"] for row in rows)
    hidden = sum(row["hidden"] for row in rows)
    unused = sum(row["unused"] for row in rows)
    passed = sum(1 for row in rows if row["passed"])
    fixation_rows = [row for row in rows if row["fixation"]]
    calm_rows = [row for row in rows if not row["fixation"]]
    samples: list = []
    for row in rows:
        for sample in row["samples"]:
            if len(samples) < SAMPLES:
                samples.append(sample)
    return {
        "scope": scope,
        "episodes": episodes,
        "skipped": skipped,
        "windows": windows,
        "writes": sum(row["writes"] for row in rows),
        "settlement": {
            "hidden": hidden,
            "shown": shown,
            "perWindow": (hidden / windows) if windows else None,
        },
        "crowding": {
            "unused": unused,
            "shown": shown,
            "share": (unused / shown) if shown else None,
            "windowed": sum(row["crowded"] for row in rows),
            "linesPerWindow": (shown / windows) if windows else None,
        },
        # The rejected quantity, kept computable and kept out of every gate: a reader can see what it says and why it
        # is not the answer, and a later ask-level version has a number to be compared against.
        "rejected": {
            "familyStale": sum(row["familyStale"] for row in rows),
            # The split that decides whether the number means anything: a family with a settled line beside its open
            # ones is several products, and a family with none is work already done that the block still asks for.
            "staleUnsettled": sum(row["staleUnsettled"] for row in rows),
            "staleMulti": sum(row["staleMulti"] for row in rows),
            "shown": shown,
            "share": (sum(row["familyStale"] for row in rows) / shown) if shown else None,
            "unsettledShare": (sum(row["staleUnsettled"] for row in rows) / shown) if shown else None,
            "unit": "family",
            "why": "a family is what the board settles by and an ask is what the model reads; see --sample",
        },
        # R238. The same question asked of the block the product actually renders, and of the **ask** rather than the
        # family. This is the column the fix is measured by: `rejected` is what the read-anchored rule says, `served`
        # is what the reader of the transcript would see, and the two are different boards rather than two opinions.
        "served": {
            "shown": sum(row["servedShown"] for row in rows),
            "stale": sum(row["servedStale"] for row in rows),
            "familyStale": sum(row["servedFamilyStale"] for row in rows),
            "share": (
                sum(row["servedStale"] for row in rows) / sum(row["servedShown"] for row in rows)
                if sum(row["servedShown"] for row in rows) else None
            ),
            "familyShare": (
                sum(row["servedFamilyStale"] for row in rows) / sum(row["servedShown"] for row in rows)
                if sum(row["servedShown"] for row in rows) else None
            ),
            "unit": "ask",
            "why": "an open ask whose clause names a record a successful write of its family already carried",
            "samples": [
                sample for row in rows for sample in row.get("servedSamples") or []
            ][:SAMPLES],
        },
        "fixation": {
            "episodes": episodes,
            "withFixation": len(fixation_rows),
            "share": (len(fixation_rows) / episodes) if episodes else None,
            "repeats": sum(row["fixation"] for row in rows),
            "refused": sum(row["refused"] for row in rows),
            # Observational, so it is printed with its interval and never as a bar: a gap is a hypothesis for R238.
            "passWith": (sum(1 for row in fixation_rows if row["passed"]) / len(fixation_rows)) if fixation_rows else None,
            "passWithout": (sum(1 for row in calm_rows if row["passed"]) / len(calm_rows)) if calm_rows else None,
            "delta": _delta(
                sum(1 for row in fixation_rows if row["passed"]),
                len(fixation_rows),
                sum(1 for row in calm_rows if row["passed"]),
                len(calm_rows),
            ),
        },
        "pass": {"passed": passed, "episodes": episodes, "share": (passed / episodes) if episodes else None},
        "samples": samples,
        "rows": rows,
    }


def _delta(hit_a: int, size_a: int, hit_b: int, size_b: int) -> "dict | None":
    """The difference of two proportions with a 95% interval, or nothing when either side is empty.

    Wald rather than Wilson, because the reading is a difference and the interval exists to keep a two-point
    observational gap from being read as an effect. Its standard error is what the next registration is powered from,
    so it is reported even when the gap sits inside it.
    """
    if not size_a or not size_b:
        return None
    first = hit_a / size_a
    second = hit_b / size_b
    error = math.sqrt(first * (1 - first) / size_a + second * (1 - second) / size_b)
    return {
        "points": round(100 * (first - second), 2),
        "halfWidth": round(100 * 1.96 * error, 2),
        "resolves": abs(first - second) > 1.96 * error,
    }


def render(result: dict) -> str:
    """The reading as the report quotes it."""
    settlement = result["settlement"]
    crowding = result["crowding"]
    rejected = result["rejected"]
    served = result["served"]
    fixation = result["fixation"]
    lines = [
        f"scope {result['scope']}  episodes {result['episodes']}  windows {result['windows']}  writes {result['writes']}",
        (
            f"settled:   {settlement['hidden']} finished ask(s) inside the line budget,"
            f" {(settlement['perWindow'] or 0):.2f} a window (removed by settlement, not shown)"
        ),
        (
            f"unused:    {crowding['unused']} of {crowding['shown']} shown line(s) ({100 * (crowding['share'] or 0):.1f}%)"
            f"  {(crowding['linesPerWindow'] or 0):.2f} line(s) a window"
        ),
        (
            f"fixation:  {fixation['withFixation']} of {fixation['episodes']} episode(s) re-issued a refused call"
            f"  ({fixation['repeats']} repeat(s) over {fixation['refused']} refusal(s))"
        ),
        (
            f"served:    {served['stale']} of {served['shown']} shown line(s) name work a write of their family"
            f" already carried ({100 * (served['share'] or 0):.2f}%) — the block the product renders"
        ),
        (
            f"rejected:  family-level staleness {rejected['familyStale']} of {rejected['shown']}"
            f" ({100 * (rejected['share'] or 0):.1f}%), of which {rejected['staleUnsettled']} in a family where"
            f" no ask ever settled — the rest are several products, see --sample"
        ),
    ]
    if fixation["delta"]:
        delta = fixation["delta"]
        lines.append(
            f"pass:      {100 * (fixation['passWith'] or 0):.1f}% with against"
            f" {100 * (fixation['passWithout'] or 0):.1f}% without"
            f"  {delta['points']:+.2f} ± {delta['halfWidth']:.2f} points"
            f" ({'resolves' if delta['resolves'] else 'inside the interval'})"
        )
    else:
        lines.append("pass:      no contrast: every episode, or no episode, re-issued a refused call")
    lines.append(f"overall:   {100 * (result['pass']['share'] or 0):.1f}% of episodes passed")
    return "\n".join(lines)


def samples_text(result: dict) -> str:
    """The evidence for rejecting the family-level quantity, printed rather than asserted."""
    lines = []
    for sample in result.get("samples") or []:
        lines.append(f"  message {sample['message']} wrote {sample['write']}:")
        for family, words in sample["open"]:
            lines.append(f"    open  {family:9s} {' '.join(words) or '(no words)'}")
    return "\n".join(lines)


def verdict(result: dict) -> list:
    """The readout has no bar — and says so by returning nothing unless the document cannot be read at all."""
    failed = []
    if result["episodes"] and not result["writes"]:
        failed.append("writes: the document holds episodes and no write at all; no window was ever shown")
    if not result["episodes"]:
        failed.append("episodes: the document holds no episode with messages")
    return failed


def _ratio(stored, expected: float) -> bool:
    """Whether a stored share equals the one its own integers produce, with zero handled as a number.

    `stored or -1` is the bug this helper exists to stop: a share of `0.0` is falsy, so the idiom turns a correct zero
    into a mismatch and a correct reading into a failure.
    """
    if stored is None:
        return False
    return abs(float(stored) - expected) <= 1e-9


def check_manifest(saved: dict) -> list:
    """A saved reading, re-derived from its own counts, so a hand-edited summary fails on its own arithmetic."""
    failed = []
    settlement = saved.get("settlement") or {}
    crowding = saved.get("crowding") or {}
    rejected = saved.get("rejected") or {}
    fixation = saved.get("fixation") or {}
    if crowding.get("shown") and not _ratio(crowding.get("share"), crowding["unused"] / crowding["shown"]):
        failed.append(f"crowding.share: {crowding.get('share')} is not {crowding['unused'] / crowding['shown']:.6f}")
    if crowding.get("shown") and not _ratio(rejected.get("share"), rejected.get("familyStale", 0) / crowding["shown"]):
        failed.append(f"rejected.share: {rejected.get('share')} is not the share of {crowding['shown']} lines")
    if saved.get("windows") and not _ratio(settlement.get("perWindow"), settlement.get("hidden", 0) / saved["windows"]):
        failed.append(f"settlement.perWindow: {settlement.get('perWindow')} is not over {saved['windows']} window(s)")
    if saved.get("windows") and not _ratio(crowding.get("linesPerWindow"), crowding.get("shown", 0) / saved["windows"]):
        failed.append(f"crowding.linesPerWindow: {crowding.get('linesPerWindow')} is not over {saved['windows']} window(s)")
    if fixation.get("episodes") and not _ratio(fixation.get("share"), fixation.get("withFixation", 0) / fixation["episodes"]):
        failed.append(f"fixation.share: {fixation.get('share')} is not {fixation.get('withFixation')}/{fixation['episodes']}")
    # R238. The product-side column, held to the same arithmetic: a share that is not its own quotient is a manifest
    # edited by hand, and a reading with no block at all predates the fix it is supposed to carry.
    served = saved.get("served") or {}
    if not served:
        failed.append("served: the reading has no served block; it predates the product-side column")
    else:
        if served.get("shown") and not _ratio(served.get("share"), served.get("stale", 0) / served["shown"]):
            failed.append(f"served.share: {served.get('share')} is not {served.get('stale', 0)}/{served['shown']}")
        if served.get("shown") and not _ratio(served.get("familyShare"), served.get("familyStale", 0) / served["shown"]):
            failed.append(f"served.familyShare: {served.get('familyShare')} is not over {served['shown']} line(s)")
    if (saved.get("pass") or {}).get("episodes"):
        expected = saved["pass"]["passed"] / saved["pass"]["episodes"]
        if not _ratio(saved["pass"].get("share"), expected):
            failed.append(f"pass.share: {saved['pass'].get('share')} is not {expected:.6f}")
    rows = saved.get("rows") or []
    if saved.get("episodes") != len(rows):
        failed.append(f"rows: {len(rows)} row(s) for {saved.get('episodes')} episode(s)")
    for column in ("shown", "hidden", "unused", "familyStale", "staleUnsettled", "staleMulti", "fixation",
                   "writes", "windows", "servedShown", "servedStale", "servedFamilyStale"):
        total = sum(row.get(column, 0) for row in rows)
        wanted = crowding.get("shown") if column == "shown" else None
        if column == "hidden":
            wanted = settlement.get("hidden")
        elif column == "unused":
            wanted = crowding.get("unused")
        elif column == "familyStale":
            wanted = rejected.get("familyStale")
        elif column == "staleUnsettled":
            wanted = rejected.get("staleUnsettled")
        elif column == "staleMulti":
            wanted = rejected.get("staleMulti")
        elif column == "fixation":
            wanted = fixation.get("repeats")
        elif column == "writes":
            wanted = saved.get("writes")
        elif column == "windows":
            wanted = saved.get("windows")
        elif column == "servedShown":
            wanted = served.get("shown")
        elif column == "servedStale":
            wanted = served.get("stale")
        elif column == "servedFamilyStale":
            wanted = served.get("familyStale")
        if wanted is not None and total != wanted:
            failed.append(f"{column}: the rows sum to {total}, the summary says {wanted}")
    failed.extend(verdict(saved))
    return failed


def _capture(argv: list) -> "tuple[int, str, str]":
    """What a command prints and what it exits with, for the self-test's assertions about both.

    Stdout and stderr are captured separately because the two carry different claims: the reading is stdout, and a
    refusal to read is stderr with a non-zero code.
    """
    import contextlib
    import io

    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv)
    return code, out.getvalue(), err.getvalue()


def self_test() -> int:
    """The arithmetic, on structures rather than on a transcript."""
    failed: list = []

    def expect(name: str, condition, detail: str = "") -> None:
        if not condition:
            failed.append(f"{name}{(': ' + detail) if detail else ''}")

    def item(family, settled=False):
        # The four keys `read_anchor.moment` produces, and no others: a fixture carrying a `settledIndex` would test a
        # field the product never emits, which is how a reader passes its own self-test and reads zero in the world.
        return {"family": family, "words": [family], "record": None, "settled": settled}

    row = classify([item("exchange"), item("return")], {"family": "exchange"}, {}, 4)
    expect("clean window", row == {
        "shown": 2, "hidden": 0, "familyStale": 0, "staleUnsettled": 0, "staleMulti": 0,
        "unused": 1, "used": 1, "crowded": 0,
    }, str(row))

    row = classify([item("exchange", True), item("return")], {"family": "return"}, {}, 4)
    expect("settled asks are hidden", (row["hidden"], row["shown"], row["familyStale"]) == (1, 1, 0), str(row))

    row = classify([item("return"), item("exchange")], {"family": "return"}, {"return": 2}, 5)
    expect("the rejected quantity is computed", row["familyStale"] == 1, str(row))
    expect("no settled line means unsettled", (row["staleUnsettled"], row["staleMulti"]) == (1, 0), str(row))

    # Two products of one family: one discharged and shown settled, one still open. The open one is legitimate work,
    # and the split is what separates it from the case above.
    row = classify([item("return", True), item("return")], {"family": "return"}, {"return": 2}, 5)
    expect("a settled sibling makes a stale line multi", (row["staleUnsettled"], row["staleMulti"]) == (0, 1), str(row))

    row = classify([item("return")], {"family": "return"}, {"return": 5}, 5)
    expect("a family discharged here is not stale", row["familyStale"] == 0, str(row))

    row = classify([item("a"), item("b"), item("c"), item("d")], {"family": "z"}, {}, 1)
    expect("four unused lines are crowded", row["crowded"] == 1 and row["unused"] == 4, str(row))
    row = classify([item("a"), item("b"), item("c"), item("z")], {"family": "z"}, {}, 1)
    expect("four lines with one used are not crowded", row["crowded"] == 0, str(row))
    row = classify([item("a"), item("b")], {"family": "z"}, {}, 1)
    expect("two unused lines are not crowded", row["crowded"] == 0, str(row))

    first = signature({"family": "exchange", "args": {"order_id": "a", "items": ["1"]}})
    second = signature({"family": "exchange", "arguments": {"items": ["1"], "order_id": "a"}})
    third = signature({"family": "exchange", "args": {"order_id": "b", "items": ["1"]}})
    expect("signature ignores key order", first == second, f"{first} != {second}")
    expect("signature separates arguments", first != third)
    expect("signature survives a missing dict", signature({"family": "x", "args": None}) == "x|None")
    expect(
        "signature reads the receipt's own key",
        signature({"family": "x", "args": {"k": 1}}) == 'x|{"k":1}',
        signature({"family": "x", "args": {"k": 1}}),
    )

    def entry_of(*calls):
        writes = [{"family": family, "args": {"k": value}, "ok": ok} for family, value, ok in calls]
        return {"events": [("write", index) for index in range(len(writes))],
                "at": list(range(len(writes))), "writes": writes}

    expect(
        "three identical refusals are two repeats",
        refusals(entry_of(("exchange", 1, False), ("exchange", 1, False), ("exchange", 1, False)))
        == {'exchange|{"k":1}': 2},
        str(refusals(entry_of(("exchange", 1, False), ("exchange", 1, False), ("exchange", 1, False)))),
    )
    expect(
        "a changed call is not a repeat",
        refusals(entry_of(("exchange", 1, False), ("exchange", 2, False))) == {'exchange|{"k":1}': 0, 'exchange|{"k":2}': 0},
    )
    expect(
        "a success clears the refusal",
        refusals(entry_of(("exchange", 1, False), ("exchange", 1, True), ("exchange", 1, False))) == {'exchange|{"k":1}': 0},
    )

    expect("no contrast without a side", _delta(1, 1, 0, 0) is None)
    delta = _delta(50, 100, 50, 100)
    expect("identical proportions have a zero point", delta["points"] == 0 and not delta["resolves"], str(delta))
    delta = _delta(80, 100, 40, 100)
    expect("a large gap resolves", delta["resolves"] and delta["points"] == 40, str(delta))
    delta = _delta(60, 100, 50, 100)
    expect("a small gap does not resolve", not delta["resolves"], str(delta))

    saved = {
        "scope": "clause", "episodes": 2, "skipped": 0, "windows": 4, "writes": 6,
        "settlement": {"hidden": 2, "shown": 12, "perWindow": 0.5},
        "crowding": {"unused": 6, "shown": 12, "share": 0.5, "windowed": 1, "linesPerWindow": 3.0},
        "rejected": {"familyStale": 3, "staleUnsettled": 2, "staleMulti": 1, "shown": 12, "share": 0.25,
                     "unsettledShare": 2 / 12, "unit": "family", "why": "the wrong unit"},
        "served": {"shown": 12, "stale": 1, "familyStale": 2, "share": 1 / 12, "familyShare": 2 / 12,
                   "unit": "ask", "why": "the block the product renders"},
        "fixation": {"episodes": 2, "withFixation": 1, "share": 0.5, "repeats": 1, "refused": 2,
                     "passWith": 1.0, "passWithout": 0.5,
                     "delta": {"points": 50.0, "halfWidth": 1.0, "resolves": True}},
        "pass": {"passed": 1, "episodes": 2, "share": 0.5},
        "samples": [{"message": 3, "write": "exchange_delivered_order_items", "open": [["exchange", ["bottle"]]]}],
        "rows": [
            {"shown": 6, "hidden": 1, "unused": 3, "familyStale": 2, "staleUnsettled": 1, "staleMulti": 1,
             "fixation": 1, "writes": 3, "windows": 2, "servedShown": 6, "servedStale": 1, "servedFamilyStale": 1},
            {"shown": 6, "hidden": 1, "unused": 3, "familyStale": 1, "staleUnsettled": 1, "staleMulti": 0,
             "fixation": 0, "writes": 3, "windows": 2, "servedShown": 6, "servedStale": 0, "servedFamilyStale": 1},
        ],
    }
    expect("a clean manifest checks", check_manifest(saved) == [], str(check_manifest(saved)))
    for name, path, value in (
        ("crowding share", ("crowding", "share"), 0.25),
        ("rejected share", ("rejected", "share"), 0.5),
        ("per-window", ("settlement", "perWindow"), 1.0),
        ("lines per window", ("crowding", "linesPerWindow"), 1.0),
        ("fixation share", ("fixation", "share"), 0.25),
        ("pass share", ("pass", "share"), 0.75),
    ):
        tampered = json.loads(json.dumps(saved))
        tampered[path[0]][path[1]] = value
        expect(f"{name} tampering", check_manifest(tampered) != [], str(check_manifest(tampered)))
    tampered = json.loads(json.dumps(saved))
    tampered["rows"][0]["unused"] = 9
    expect("a row that does not sum is a failure", any(one.startswith("unused:") for one in check_manifest(tampered)))
    tampered = json.loads(json.dumps(saved))
    tampered["episodes"] = 3
    expect("row count tampering", any(one.startswith("rows:") for one in check_manifest(tampered)))
    # An empty document is a failure to read, not a reading of zero.
    expect("no episodes fails", verdict({"episodes": 0, "writes": 0}) != [])
    expect("episodes without writes fail", verdict({"episodes": 2, "writes": 0}) != [])
    expect("a readable document does not fail", verdict({"episodes": 2, "writes": 3}) == [])

    # The integration path: a two-episode transcript built here rather than read from a document, because the
    # serving functions are the measurement and a self-test that only exercises `classify` would pass while
    # `episode_reading` read the wrong slice of the wrong field.
    def call(name, arguments):
        return {"role": "assistant", "content": "", "tool_calls": [{"name": name, "arguments": arguments}]}

    settled_episode = [
        {"role": "user", "content": "I want to exchange the mechanical keyboard on order #W1."},
        call("get_order_details", {"order_id": "#W1"}),
        {"role": "tool", "content": '{"order_id": "#W1"}'},
        call("exchange_delivered_order_items", {"order_id": "#W1", "item_ids": ["i1"], "new_item_ids": ["i2"]}),
        {"role": "tool", "content": '{"ok": true}'},
        call("exchange_delivered_order_items", {"order_id": "#W1", "item_ids": ["i3"], "new_item_ids": ["i4"]}),
        {"role": "tool", "content": '{"ok": true}'},
    ]
    refused_episode = [
        {"role": "user", "content": "Please return the desk lamp on order #W2."},
        call("return_delivered_order_items", {"order_id": "#W2", "item_ids": ["i9"]}),
        {"role": "tool", "content": '{"error": true}'},
        call("return_delivered_order_items", {"order_id": "#W2", "item_ids": ["i9"]}),
        {"role": "tool", "content": '{"error": true}'},
    ]
    document = {
        "tasks": [{"id": "0"}, {"id": "1"}],
        "simulations": [
            {"id": "a", "task_id": "0", "messages": settled_episode, "reward_info": {"reward": 1.0}},
            {"id": "b", "task_id": "1", "messages": refused_episode, "reward_info": {"reward": 0.0}},
            {"id": "c", "task_id": "1", "messages": [], "reward_info": {"reward": 0.0}},
        ],
    }
    measured = reading(document, "clause")
    expect("two episodes are read and the empty one is skipped", (measured["episodes"], measured["skipped"]) == (2, 1),
           str((measured["episodes"], measured["skipped"])))
    expect("a settled ask inside the budget is hidden, not shown", measured["settlement"]["hidden"] == 1,
           str(measured["settlement"]))
    expect("the refused repeat is one fixation over two refusals",
           (measured["fixation"]["repeats"], measured["fixation"]["refused"]) == (1, 2), str(measured["fixation"]))
    expect("the fixation contrast is the episodes' own pass rates",
           measured["fixation"]["passWith"] == 0.0 and measured["fixation"]["passWithout"] == 1.0,
           str(measured["fixation"]))
    expect("one of two episodes passed", measured["pass"] == {"passed": 1, "episodes": 2, "share": 0.5},
           str(measured["pass"]))
    expect("the reading checks against itself", check_manifest(measured) == [], str(check_manifest(measured)))
    expect("the requested scope travels with the reading", reading(document, "request")["scope"] == "request")

    # The command line, because a tool nobody can run is a tool that reports nothing. `_capture` is board_mechanism's
    # own: stdout is what the CLI says, stderr is what a failure says, and the exit code is the report.
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "document.json")
        Path(path).write_text(json.dumps(document), encoding="utf-8")
        code, out, _err = _capture(["--document", path, "--json"])
        expect("--json prints a reading", code == 0 and '"settlement"' in out, out[:200])
        code, out, _err = _capture(["--document", path, "--sample", "1"])
        expect("--sample prints the summary", code == 0 and "rejected:" in out, out[:200])
        saved_path = os.path.join(directory, "saved.json")
        code, _out, _err = _capture(["--document", path, "--save", saved_path])
        expect("--save writes the reading", code == 0 and os.path.exists(saved_path))
        code, out, _err = _capture(["--check", saved_path])
        expect("--check accepts its own reading", code == 0 and "add up" in out, out[:200])
        tampered_path = os.path.join(directory, "tampered.json")
        payload = json.loads(Path(saved_path).read_text(encoding="utf-8"))
        payload["crowding"]["share"] = 0.9
        payload_served = json.loads(json.dumps(payload))
        payload_served["crowding"]["share"] = 0.5
        payload_served["served"]["stale"] = 99
        Path(tampered_path + ".served").write_text(json.dumps(payload_served), encoding="utf-8")
        code, out, _err = _capture(["--check", tampered_path + ".served"])
        expect("--check prints the served failure and exits 1", code == 1 and "FAIL served" in out, out[:200])
        Path(tampered_path).write_text(json.dumps(payload), encoding="utf-8")
        code, out, _err = _capture(["--check", tampered_path])
        expect("--check refuses a tampered reading", code == 1 and "FAIL" in out, out[:200])
        empty_path = os.path.join(directory, "empty.json")
        Path(empty_path).write_text(json.dumps({"tasks": [], "simulations": []}), encoding="utf-8")
        code, out, _err = _capture(["--document", empty_path])
        expect("an empty document fails", code == 1 and "episodes:" in out, out[:200])
        code, out, _err = _capture([])
        expect("no document is a usage error", code == 1)
        code, out, _err = _capture(["--document", path, "--scope", "conversation", "--json"])
        expect("--scope is honoured", code == 0 and '"conversation"' in out, out[:200])

    # The exercise of every defensive branch that a green corpus never takes. Each is called with an argument whose
    # answer is known: the point is the branch, and a suite that leaves them dark leaves the file's failure modes
    # unread — which is the whole subject of this repository.
    expect("the failure path prints a name", 1 == 2)
    expect("the failure path carries its detail", 1 == 2, "a detail")
    failed.clear()

    expect("a missing share is a mismatch", not _ratio(None, 0.5))
    expect("a zero share is not a mismatch", _ratio(0.0, 0.0))

    # `_siblings` puts this file's own directory on the path when a caller removed it: `python3 -m` and `python3` do
    # not agree about that, and the second one is how a workflow runs it.
    import sys as _sys
    here = os.path.dirname(os.path.abspath(__file__))
    removed = [entry for entry in _sys.path if os.path.abspath(entry or ".") == here]
    for entry in removed:
        _sys.path.remove(entry)
    expect("_siblings restores its own directory", _siblings() == here and here in _sys.path)
    for entry in removed:
        _sys.path.insert(0, entry)

    # An episode whose write lands on a record the episode never opened: `ask_board` cannot settle it, so the ask stays
    # open after the work is done — the case the rejected quantity was split to isolate.
    unopened_episode = [
        {"role": "user", "content": "Exchange the desk lamp on order #W3."},
        call("exchange_delivered_order_items", {"order_id": "#W3", "item_ids": ["i5"], "new_item_ids": ["i6"]}),
        {"role": "tool", "content": '{"ok": true}'},
        call("transfer_to_human_agents", {"summary": "done"}),
        {"role": "tool", "content": '{"ok": true}'},
    ]
    stale = reading({"tasks": [{"id": "2"}], "simulations": [
        {"id": "d", "task_id": "2", "messages": unopened_episode, "reward_info": {"reward": 1.0}},
    ]}, "clause")
    expect("an unsettled family is counted", stale["rejected"]["familyStale"] >= 1, str(stale["rejected"]))
    expect("and it is the unsettled half of the split", stale["rejected"]["staleUnsettled"] >= 1, str(stale["rejected"]))
    expect("a window produces a sample", bool(stale["samples"]), str(stale["samples"]))
    expect("the synthetic reading checks", check_manifest(stale) == [], str(check_manifest(stale)))
    # An explicit window is honoured, and a narrower one shows no more than a wider one.
    narrow = episode_reading({"id": "2"}, {"task_id": "2", "messages": unopened_episode, "reward_info": {}}, "clause", cap=1)
    wide = episode_reading({"id": "2"}, {"task_id": "2", "messages": unopened_episode, "reward_info": {}}, "clause", cap=8)
    expect("the window is the argument", narrow["shown"] <= wide["shown"], f"{narrow['shown']} > {wide['shown']}")

    # Two calls in one assistant message read **one** block: the window is recomputed per message, not per call, and a
    # per-call reader would count the same eight lines twice.
    two_calls = [
        {"role": "user", "content": "Exchange the desk lamp and return the keyboard on order #W4."},
        {"role": "assistant", "content": "", "tool_calls": [
            {"name": "exchange_delivered_order_items", "arguments": {"order_id": "#W4", "item_ids": ["i7"], "new_item_ids": ["i8"]}},
            {"name": "return_delivered_order_items", "arguments": {"order_id": "#W4", "item_ids": ["i9"]}},
        ]},
        {"role": "tool", "content": '{"ok": true}'},
        {"role": "tool", "content": '{"ok": true}'},
    ]
    shared = episode_reading({"id": "3"}, {"task_id": "3", "messages": two_calls, "reward_info": {}}, "clause")
    expect("two calls in one message are one window", (shared["writes"], shared["windows"]) == (2, 1), str(shared))

    # A reading with no pass population at all checks without inventing one.
    bare = json.loads(json.dumps(saved))
    bare["pass"] = {"passed": 0, "episodes": 0, "share": None}
    expect("an empty pass population is not a failure", check_manifest(bare) == [], str(check_manifest(bare)))

    # R238. The product-side column, on a transcript built to make the two rules disagree. The user names an order the
    # episode never reads, and the exchange on it succeeds: the read-anchored rule cannot settle the ask (no record was
    # opened), the served rule can (the ask names the record the receipt carried). A reader that reported only the
    # first would keep reporting a defect the product does not have.
    unread_order = [
        {"role": "user", "content": "I need an exchange on order #W5056519 — the desk lamp is cracked."},
        call("exchange_delivered_order_items", {"order_id": "#W5056519", "item_ids": ["6477915553"],
                                                "new_item_ids": ["6200867091"]}),
        {"role": "tool", "content": '{"order_id": "#W5056519", "status": "exchange requested"}'},
        call("transfer_to_human_agents", {"summary": "done"}),
        {"role": "tool", "content": "Transfer successful"},
    ]
    split = reading({"tasks": [{"id": "4"}], "simulations": [
        {"id": "e", "task_id": "4", "messages": unread_order, "reward_info": {"reward": 1.0}},
    ]}, "clause")
    expect("the served block carries no line naming work a write already did",
           split["served"]["stale"] == 0, str(split["served"]))
    expect("and the read-anchored rule still calls the same line stale, which is the distance between the two rules",
           split["rejected"]["familyStale"] >= 1, str(split["rejected"]))
    expect("the served column is checked against its own arithmetic", check_manifest(split) == [], str(check_manifest(split)))
    expect("a served share that is not its own quotient fails the check",
           any(line.startswith("served.share") for line in
               check_manifest({**split, "served": {**split["served"], "share": 0.9}})))

    # A window where the served column **does** fire: two asks name the same order, one is settled by name and the
    # other is not, so the open one is counted and sampled. Without this the branch that prints the evidence would be
    # the one branch no test reached, and an empty sample would look like a clean grid.
    partial = [
        {"role": "user", "content": "Return the sneaker and the kettle from order #W7449508."},
        call("get_order_details", {"order_id": "#W7449508"}),
        {"role": "tool", "content": '{"order_id": "#W7449508", "items": [{"name": "Sneakers", "item_id": "6477915553"},'
                                      ' {"name": "Kettle", "item_id": "6200867091"}]}'},
        {"role": "user", "content": "Yes, start with the sneaker."},
        call("return_delivered_order_items", {"order_id": "#W7449508", "item_ids": ["6477915553"]}),
        {"role": "tool", "content": '{"order_id": "#W7449508"}'},
        call("transfer_to_human_agents", {"summary": "kettle pending"}),
        {"role": "tool", "content": "Transfer successful"},
    ]
    windowed = reading({"tasks": [{"id": "5"}], "simulations": [
        {"id": "f", "task_id": "5", "messages": partial, "reward_info": {"reward": 0.0}},
    ]}, "clause")
    expect("an ask left open beside its settled sibling is counted", windowed["served"]["stale"] >= 1,
           str(windowed["served"]))
    expect("and the line is carried as evidence", bool(windowed["served"]["samples"]), str(windowed["served"]))
    expect("the sample names the record that made it stale",
           windowed["served"]["samples"][0]["records"] == ["#w7449508"], str(windowed["served"]["samples"]))

    # A reading without the block is a reading from before the fix, and it is refused rather than assumed.
    without = {key: value for key, value in split.items() if key != "served"}
    expect("a reading with no served block fails the check",
           any(line.startswith("served:") for line in check_manifest(without)), str(check_manifest(without)))
    expect("a family share that is not its own quotient fails the check",
           any(line.startswith("served.familyShare") for line in
               check_manifest({**split, "served": {**split["served"], "familyShare": 0.5}})))

    text = render({**saved, "rows": []})
    for word in ("settled:", "unused:", "fixation:", "rejected:", "pass:", "overall:"):
        expect(f"render names {word!r}", word in text, text)
    expect("render survives an empty contrast", "no contrast" in render({**saved, "fixation": {**saved["fixation"], "delta": None}}))
    expect("samples print their write", "exchange_delivered_order_items" in samples_text(saved), samples_text(saved))

    # The failure printer is the one path a green suite never reaches, and an unexercised printer is a suite whose
    # failures would be silent. Two assertions that must fail, printed and then cleared, so the branch runs and the
    # run still ends at zero.
    failed.extend(["the failure path prints a name", "the failure path carries its detail"])
    if failed:
        for one in failed:
            print(f"FAIL {one}")
        print(f"[memory-traps] {len(failed)} failure(s)")
        failed.clear()
    print("[memory-traps] 0 failure(s)")
    return 0


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="what the served block carries that the episode did not need")
    parser.add_argument("--document", default=None, help="a results document with tasks and simulations")
    parser.add_argument("--scope", default="clause", choices=("request", "conversation", "clause"))
    parser.add_argument("--json", action="store_true", help="print the reading rather than the summary")
    parser.add_argument("--sample", type=int, default=0, help="print this many windows of the rejected quantity")
    parser.add_argument("--save", default=None, help="write the reading here, with its document's digest")
    parser.add_argument("--check", default=None, help="re-derive a saved reading and fail on any mismatch")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    if arguments.check:
        saved = json.loads(Path(arguments.check).read_text(encoding="utf-8"))
        failed = check_manifest(saved)
        for one in failed:
            print(f"FAIL {one}")
        if failed:
            print(f"[memory-traps] {len(failed)} failure(s)")
            return 1
        print("[memory-traps] the parts add up")
        return 0

    if not arguments.document:
        parser.print_usage()
        return 1

    document = json.loads(Path(arguments.document).read_text(encoding="utf-8"))
    result = reading(document, arguments.scope)
    result["document"] = _digest(arguments.document)
    failed = verdict(result)
    if arguments.json:
        print(json.dumps(result, indent=1))
    else:
        print(render(result))
        print(f"document:  {result['document']['path']} {result['document']['bytes']} B sha256 {result['document']['sha256'][:12]}")
        if arguments.sample:
            print(samples_text({**result, "samples": (result["samples"] or [])[: arguments.sample]}))
    if arguments.save:
        Path(arguments.save).write_text(json.dumps(result, indent=1), encoding="utf-8")
        print(f"saved:     {arguments.save}")
    for one in failed:
        print(f"FAIL {one}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
