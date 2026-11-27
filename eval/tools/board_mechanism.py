#!/usr/bin/env python3
"""R236's readout: was the clause board served, and did the model write what the window carried?

The round asks a mechanism question and not an accuracy one, so its bars are proportions over the **dispatched**
transcript rather than a contrast of pass rates — sixty episodes cannot see a three-point effect, and a round that
reported one would be R235's defect one level down.

Three numbers, and the amendment in `prereg/R236-clause-mechanism.md` says why each has the shape it has:

* **B1 — the wiring.** On at least 80% of episodes the recomputed block carries **at least one ask the request board
  does not**. This is the signature of an arm that actually served the clause board: it reads 94.5% on the 456
  control transcripts (431 of 456 episodes, 7.0 extra items an episode) and **0%** on an environment that lost the
  switch. It is a wiring certificate, not a result, and it is the first bar because a lost environment makes every
  other number a null about a treatment that never ran.
* **B2 — the model, at the window it read.** Of the episodes that made a *graded* call (one that discharges a
  requirement the evaluator states), the share whose call names a family that was open on the window **at that
  call's moment**. The registered bar is the replay ceiling minus the resolution — 97.8% − 9 = **88.8%** — because
  the falsifiable risk here is that a wider board makes the model *worse*, not that it makes it better: the window is
  a superset of the contract's by construction, so a rise is what the arithmetic predicts and only a fall is news.
* **B3 — the bill**, read from the run's own `agent_cost` and `user_cost` (the workflow's step, not this file).

Neither number existed anywhere before this file. `read_anchor --replay` reports ticks over the *request* board and
`--compare` pairs two arms' rewards, so the measurement the round was registered for had no reader — and a
registration whose bar has no instrument is a bar read by hand after the money, or not at all.

**Where the block comes from.** τ² stores no injected message: the tail placement writes into a copy of the state, so
no transcript carries the block and a reader cannot quote it. What a reader can do is **recompute** it from the same
messages the driver had, with the same functions — `read_anchor.moment` rebuilds the board as it stood before a given
message, at a given scope, order and fold, and `goal_board` is the renderer that produced it. The recomputation is
the measurement, and it is only trustworthy because the driver and this file call the same code.

**What each counts, exactly.**

    wiring   ∃ an ask in board_of(messages, scope) whose (family, words) the request board does not hold
    served   ∃ a write whose window (items[:CAP] after the order and the fold) held an open ask of its family
    acted    ∃ a graded write whose window held an open ask of its family
             denominator: episodes with at least one graded write

The settled instance of a family does not count as open: a line saying the work is done is the opposite of an ask.
`unrequested` and `unattributed` calls are never asks and never enter a numerator.

    python3 eval/tools/board_mechanism.py --document clause.json [--control front.json] [--replicate other.json]
                                          [--scope clause] [--bar] [--save out.json] [--check out.json]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

#: R236 amendment 1, registered before the dispatch. **B1** is a wiring certificate at 80%: the control grid reads
#: 94.5% and a lost environment reads zero, so the bar separates the two by fourteen points and a sample of sixty
#: cannot fail it for noise. The original 95% asked a per-*episode* share to carry a per-*write* rate, and the
#: arithmetic in the amendment shows the correct arm failing it at 89.5%.
WIRED_BAR = 0.80

#: The half-width of a two-sided 95% interval for a difference of two proportions at 60 against 456 — the number the
#: registration quotes (±9 points). B2's bar is the replay ceiling minus this, and it is printed beside every share so
#: a reader cannot mistake a direction for a win: a difference inside this band is not evidence of anything.
RESOLUTION = 0.09

#: The ceiling B2 is judged against when no control document is supplied — the replay of the same board over the 456
#: control transcripts, 394 of 403 graded episodes. It is a constant rather than an argument because a reading taken
#: without the control still has to be judged against something, and the manifest that produced it is pinned by
#: `eval/manifests/r236-replay.json` and re-checked on every push.
CEILING = 0.9777


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
    """The two modules this reader reuses, imported at the call rather than at the module.

    Script mode puts the directory on the path and `python3 -m coverage run` does not, so the import is lazy for the
    reason `goal_board` gives its own. Both are the *serving* code: `read_anchor.moment` builds the board as it stood
    before a message, and `goal_board` is the renderer the driver ran. A reader with its own copy of either would be
    measuring a block the model never saw, which is the defect R236 was registered to close (AUDIT 34.335).
    """
    _siblings()
    import goal_board  # noqa: PLC0415 - see `_siblings`
    import read_anchor  # noqa: PLC0415

    return goal_board, read_anchor


def board_order(scope: str) -> str:
    """The rung a scope renders at: the clause board is folded, every other scope is statement order.

    Read from the scope rather than passed, because a clause board shown in statement order is a treatment neither
    R233 nor R234 measured — and because the driver's own `board_display()` makes the same pairing.
    """
    if scope not in ("request", "conversation", "clause"):
        raise ValueError(f"unknown board scope {scope!r}")
    return "open" if scope == "clause" else "statement"


def windows(entry: dict, messages, scope: str, cap: int) -> "dict[int, set]":
    """`message index -> the families open on the window the model read there`, for every call in the episode.

    Keyed by message rather than by call because two calls in one assistant message were answered by **one** block:
    a per-call key would let the second call see a board the first one never did, which is the leak R232's `moment`
    was built to remove.
    """
    _board, anchors = _modules()
    found: dict = {}
    order = board_order(scope)
    fold = scope == "clause"
    for (kind, _payload), index in zip(entry["events"], entry["at"]):
        if kind != "write" or index in found:
            continue
        board = anchors.moment(entry, messages, index, scope, order=order, fold=fold)
        # The cut is applied here and not in `moment` because the cut belongs to the *rendering*: the same board is
        # read uncut by the attribution columns, and a reader that asked `moment` for a cut board would be asking the
        # attribution to be a window.
        shown = board["items"][:cap]
        found[index] = {item["family"] for item in shown if not item["settled"]}
    return found


def episode_reading(task, simulation: dict, scope: str = "clause", cap=None) -> dict:
    """One episode: whether the window carried the family the episode wrote, and whether it reached further.

    Returns counts rather than rates, because the aggregation is over episodes and a rate computed here and averaged
    later weights a one-write episode the same as a five-write one.
    """
    board, anchors = _modules()
    messages = simulation.get("messages") or []
    if cap is None:
        # The window is the product's, read from the instrument that restates it: `CAP` is bound to the parser's
        # `MAX_ITEMS`, which is bound to the serving manifest by the parser's own self-test.
        cap = anchors.CAP
    entry = anchors.ledger(messages)
    required = anchors.required_writes(task) if isinstance(task, dict) else []
    done = anchors.discharge(entry["writes"], required)
    graded = set(done["byPosition"])
    found = windows(entry, messages, scope, cap)
    writes = 0
    served = 0
    graded_open = 0
    for (kind, payload), index in zip(entry["events"], entry["at"]):
        if kind != "write":
            continue
        receipt = entry["writes"][payload]
        writes += 1
        family = receipt.get("family")
        open_at = found.get(index) or set()
        if family and family in open_at:
            served += 1
        # `payload` is the write's position in `entry["writes"]`, which is what `discharge` keys its answer by. The
        # event's own index is a different number, and comparing the wrong one is how a reader reports zero graded
        # calls on an episode that discharged three.
        if payload in graded and receipt.get("ok") and family and family in open_at:
            graded_open += 1
    # The reach, over the finished conversation: an ask this board holds that the request board does not. It is the
    # wiring signature and it is computed once an episode rather than at every call, because the switch either was on
    # or it was not — a per-call version of this would price the conversation, not the arm.
    request = {(item["family"], tuple(item["words"])) for item in board.board_of(messages)["items"]}
    reached = {(item["family"], tuple(item["words"])) for item in board.board_of(messages, scope)["items"]}
    return {
        "task": str(simulation.get("task_id")),
        # Writes, not calls: a read is not an ask being answered, and `ledger` emits a write event for a
        # state-changing call and nothing for `get_order_details`. The name says which of the two this is.
        "writes": writes,
        "graded": len(graded),
        # B1. The reach, as a count of the asks only this board holds.
        "extra": len(reached - request),
        "wired": bool(reached - request),
        # The diagnostic, reported and never a bar: how many writes named a family the window carried. An episode
        # with none of them is an episode whose window and whose work did not meet, which is worth seeing.
        "served": served,
        # B2, as a count: a graded write whose family was open on the window at the moment of the write.
        "gradedOpen": graded_open,
        "required": len(required),
        "acted": graded_open > 0,
    }


def reading(document: dict, scope: str = "clause") -> dict:
    """A document read into the round's three quantities, with the populations they are taken over."""
    tasks = {str(task.get("id")): task for task in document.get("tasks") or []}
    rows = []
    skipped = 0
    for simulation in document.get("simulations") or []:
        if not (simulation.get("messages") or []):
            skipped += 1
            continue
        rows.append(episode_reading(tasks.get(str(simulation.get("task_id"))), simulation, scope))
    episodes = len(rows)
    wired = sum(1 for row in rows if row["wired"])
    graded_rows = [row for row in rows if row["graded"]]
    acted = sum(1 for row in graded_rows if row["acted"])
    return {
        "scope": scope,
        "episodes": episodes,
        "skipped": skipped,
        "writes": sum(row["writes"] for row in rows),
        # B1: over every episode, because a wiring check that excluded the episodes with no graded write would let a
        # broken arm pass on the episodes it happened to run.
        "wiring": {
            "episodes": episodes,
            "wider": wired,
            "share": (wired / episodes) if episodes else None,
            "extraItems": sum(row["extra"] for row in rows),
            "bar": WIRED_BAR,
            "holds": (wired / episodes) >= WIRED_BAR if episodes else False,
        },
        # The diagnostic, reported beside both bars and never judged.
        "served": {
            "writes": sum(row["served"] for row in rows),
            "allWrites": sum(row["writes"] for row in rows),
        },
        # B2: over the graded episodes, because the evaluator's own requirement is the only write whose naming says
        # anything about the task. An episode with no graded write is a task this instrument cannot judge, which is a
        # different absence from a failure and is reported as `skipped` at the document level.
        "acted": {
            "episodes": len(graded_rows),
            "acted": acted,
            "share": (acted / len(graded_rows)) if graded_rows else None,
            "ceiling": CEILING,
            "bar": round(CEILING - RESOLUTION, 4),
            "holds": (acted / len(graded_rows)) >= CEILING - RESOLUTION if graded_rows else False,
            "resolution": RESOLUTION,
        },
        "rows": rows,
    }


def half_width(share: float | None, count: int) -> "float | None":
    """The ± of a share at this count, as the reading prints it beside the number.

    A share printed without one is a number a reader will compare to another number as if both were exact, and this
    round's B2 is a comparison of two proportions at 60 against 456 — the whole reason its registration states a
    direction and a margin instead of a win.
    """
    if share is None or count <= 0:
        return None
    return 1.959963985 * math.sqrt(share * (1 - share) / count)


def verdict(measured: dict, control: "dict | None" = None) -> list:
    """Whatever about a reading does not hold, as sentences. Empty means every registered bar held."""
    problems: list = []
    wiring = measured["wiring"]
    if not wiring["episodes"]:
        problems.append("no episode carried a message: this is not a reading")
    elif not wiring["holds"]:
        problems.append(
            f"B1: the block reached further than the request board on {wiring['wider']} of {wiring['episodes']} "
            f"episodes ({wiring['share']:.1%}); the bar is {wiring['bar']:.0%} — the arm was not served, and no B2 "
            "number may be quoted")
    acted = measured["acted"]
    if not acted["episodes"]:
        problems.append("B2: no episode made a graded write, so there is nothing to measure")
    elif not acted["holds"]:
        problems.append(
            f"B2: the model wrote a family the window carried on {acted['acted']} of {acted['episodes']} graded "
            f"episodes ({acted['share']:.1%}); the bar is {acted['bar']:.1%} — the replay ceiling "
            f"{acted['ceiling']:.1%} less the registered resolution {acted['resolution']:.0%}")
    if control is not None:
        theirs = control["acted"]
        if theirs["share"] is None:
            problems.append("B2: the control has no graded episode, so there is nothing to compare")
    return problems


def _quiet_report(failed: list) -> int:
    """`_report` with its output swallowed, for the self-test's own negative control."""
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()):
        return _report(failed)


def _capture(argv: list) -> str:
    """What a command prints, for the self-test's assertions about prose."""
    import contextlib
    import io

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        main(argv)
    return buffer.getvalue()


def _report(failed: list) -> int:
    """Print the failures and the count, and answer with the exit code a workflow reads.

    A function rather than four lines at the end of `self_test`, because those lines are the only part of this file
    that runs once and only on a red build — the one branch a green suite can never reach. Called with a list whose
    answer is known, it is covered on every run.
    """
    for name in failed:
        print(f"FAIL {name}")
    print(f"[board-mechanism] {len(failed)} failure(s)")
    return 1 if failed else 0


def check_manifest(saved: dict) -> list:
    """Whatever about a saved reading does not add up, as sentences.

    A reading is an arithmetic claim and the documents quote its parts, so the parts are checked against each other
    rather than against the prose: every share has to be its own counts, the episode count has to be the row count
    plus the skipped ones, and each verdict has to be its own comparison against its own bar. The failure this
    catches is the one this project has published before — a percentage computed over one denominator and printed
    beside another.
    """
    problems: list = []
    labels = saved.get("readings") or {"measured": saved.get("reading"), "control": saved.get("control")}
    for label, one in labels.items():
        if one is None:
            continue
        rows = one.get("rows") or []
        if one.get("episodes") != len(rows):
            problems.append(f"{label}: {one.get('episodes')} episode(s) but {len(rows)} row(s)")
        wiring = one.get("wiring") or {}
        acted = one.get("acted") or {}
        if wiring.get("episodes") != one.get("episodes"):
            problems.append(f"{label}: B1 is over {wiring.get('episodes')} episode(s), the reading over "
                            f"{one.get('episodes')}")
        if wiring.get("wider") != sum(1 for row in rows if row.get("wired")):
            problems.append(f"{label}: B1's count is not the rows'")
        if wiring.get("extraItems") != sum(int(row.get("extra") or 0) for row in rows):
            problems.append(f"{label}: B1's extra asks are not the rows'")
        if acted.get("episodes") != sum(1 for row in rows if row.get("graded")):
            problems.append(f"{label}: B2's denominator is not the graded rows")
        if acted.get("acted") != sum(1 for row in rows if row.get("graded") and row.get("acted")):
            problems.append(f"{label}: B2's count is not the rows'")
        for name, part, key in (("B1", wiring, "wider"), ("B2", acted, "acted")):
            if part.get("share") is not None and part.get("episodes"):
                if abs(part["share"] - part[key] / part["episodes"]) > 1e-9:
                    problems.append(f"{label}: {name}'s share is not its count over its population")
        if wiring.get("share") is not None and wiring.get("bar") is not None:
            if wiring["holds"] != (wiring["share"] >= wiring["bar"]):
                problems.append(f"{label}: B1's verdict is not its own comparison")
        if acted.get("share") is not None and acted.get("bar") is not None:
            if acted["holds"] != (acted["share"] >= acted["bar"]):
                problems.append(f"{label}: B2's verdict is not its own comparison")
    return problems


def render(result: dict, control: "dict | None" = None) -> str:
    """The reading as a table, with the populations and the intervals beside every share."""
    lines = [f"scope {result['scope']}: {result['episodes']} episode(s), {result['skipped']} skipped, "
             f"{result['writes']} write(s)"]
    wiring = result["wiring"]
    width = half_width(wiring["share"], wiring["episodes"])
    lines.append(
        f"B1 wired    {wiring['wider']}/{wiring['episodes']}"
        + (f" ({wiring['share']:.1%} ±{width:.1%})" if width is not None else "")
        + f"  bar {wiring['bar']:.0%}  {'HOLDS' if wiring['holds'] else 'FAILS'}"
        + f"  ({wiring['extraItems']} extra ask(s))")
    acted = result["acted"]
    width = half_width(acted["share"], acted["episodes"])
    lines.append(
        f"B2 acted    {acted['acted']}/{acted['episodes']}"
        + (f" ({acted['share']:.1%} ±{width:.1%})" if width is not None else "")
        + f"  bar {acted['bar']:.1%} (ceiling {acted['ceiling']:.1%} - {acted['resolution']:.0%})"
        + f"  {'HOLDS' if acted['holds'] else 'FAILS'}")
    served = result["served"]
    if served["allWrites"]:
        lines.append(f"   diagnosed {served['writes']}/{served['allWrites']} write(s) named a family the window "
                     "carried")
    if control is not None:
        other = control["acted"]
        width = half_width(other["share"], other["episodes"])
        lines.append(
            f"   control  {other['acted']}/{other['episodes']}"
            + (f" ({other['share']:.1%} ±{width:.1%})" if other["share"] is not None and width is not None else "")
            + f"  [{control['scope']}]")
        if acted["share"] is not None and other["share"] is not None:
            lines.append(f"   delta    {100 * (acted['share'] - other['share']):+.1f} pp")
    return "\n".join(lines)


def self_test() -> int:
    """The reader on transcripts whose answer is known by construction, and no provider.

    The fixture is the case R231 registered the admission for: the requirement arrives in a later turn, beside an
    answer that inherits the agent's own question. Three claims are asserted on it — the clause board **reaches** an
    ask the request board does not (B1's wiring signature), the window carries that ask when the graded write happens
    (B2's numerator), and neither is true at the request scope. Then the arithmetic, the saved form, and the CLI.
    """
    board, anchors = _modules()
    failed: list = []

    def check(name: str, condition) -> None:
        if not condition:
            failed.append(name)

    here = os.path.dirname(os.path.abspath(__file__))
    keep = list(sys.path)
    try:
        sys.path[:] = [entry for entry in sys.path if os.path.abspath(entry or ".") != here]
        check("the module finds its siblings with the directory off the path", _siblings() == here)
    finally:
        sys.path[:] = keep

    def call(name: str, **arguments) -> dict:
        return {"role": "assistant", "tool_calls": [{"name": name, "arguments": arguments}]}

    def result(payload: dict) -> dict:
        return {"role": "tool", "content": json.dumps(payload)}

    task = {"id": "0", "evaluation_criteria": {"actions": [
        {"name": "return_delivered_order_items", "arguments": {"order_id": "#W1", "item_ids": ["1"]}}]}}
    later_turn = [
        {"role": "user", "content": "I want to exchange the mechanical keyboard."},
        {"role": "assistant", "content": "Which one would you like?"},
        {"role": "user", "content": "not that one, return the lamp, and the chair"},
        call("get_order_details", order_id="#W1"),
        result({"order_id": "#W1", "items": [{"item_id": "1", "name": "Desk Lamp"}]}),
        call("return_delivered_order_items", order_id="#W1", item_ids=["1"]),
        result({"ok": True}),
    ]
    at_clause = episode_reading(task, {"task_id": "0", "messages": later_turn}, "clause")
    at_request = episode_reading(task, {"task_id": "0", "messages": later_turn}, "request")
    check("the clause board holds an ask the request board does not", at_clause["wired"] is True)
    check("and the count is the asks only this board carries", at_clause["extra"] == 1)
    check("the request board cannot reach further than itself", at_request["wired"] is False)
    check("the write named a family the clause window carried", at_clause["served"] == 1)
    check("so the graded write acted on the window", at_clause["acted"] is True)
    check("and at the request scope it did not", at_request["acted"] is False)
    check("the graded write is counted as graded", at_clause["graded"] == 1)
    narrow = episode_reading(task, {"task_id": "0", "messages": later_turn}, "clause", cap=1)
    check("a one-line window carries the first ask only, so the later write is not acted on",
          narrow["writes"] == 1 and narrow["served"] == 0 and narrow["acted"] is False)

    unasked = [
        {"role": "user", "content": "I want to exchange the mechanical keyboard."},
        call("cancel_pending_order", order_id="#W1"),
        result({"ok": True}),
    ]
    wrong = episode_reading(task, {"task_id": "0", "messages": unasked}, "clause")
    check("a write of a family no window carried is not B2", wrong["acted"] is False)
    check("and it is not counted as served either", wrong["served"] == 0)
    check("an episode with no extra ask is not wired", wrong["wired"] is False)

    silent = episode_reading(task, {"task_id": "0", "messages": []}, "clause")
    check("an episode with no message makes no claim", silent["wired"] is False and silent["writes"] == 0)

    document = {"tasks": [task], "simulations": [
        {"task_id": "0", "messages": later_turn},
        {"task_id": "0", "messages": []},
    ]}
    whole = reading(document, "clause")
    check("the reading counts the episodes that reached the model", whole["episodes"] == 1)
    check("and reports the ones that did not", whole["skipped"] == 1)
    check("B1 holds on a document whose one episode was served", whole["wiring"]["holds"] is True)
    check("B2's population is the graded episodes", whole["acted"]["episodes"] == 1)
    check("and its bar is the ceiling less the resolution",
          abs(whole["acted"]["bar"] - (CEILING - RESOLUTION)) < 1e-9)
    check("the diagnostic counts writes rather than episodes", whole["served"]["allWrites"] == whole["writes"])

    empty = reading({"tasks": [], "simulations": []}, "clause")
    check("an empty document is not a passing reading", empty["wiring"]["holds"] is False)
    check("and its verdict says so", any("not a reading" in problem for problem in verdict(empty)))
    check("an empty document's B2 has no population", empty["acted"]["episodes"] == 0)

    flat = {"scope": "clause", "episodes": 10, "skipped": 0, "writes": 10, "rows": [],
            "wiring": {"episodes": 10, "wider": 10, "share": 1.0, "extraItems": 10, "bar": WIRED_BAR,
                       "holds": True},
            "acted": {"episodes": 10, "acted": 9, "share": 0.9, "ceiling": CEILING,
                      "bar": round(CEILING - RESOLUTION, 4), "holds": True, "resolution": RESOLUTION},
            "served": {"writes": 9, "allWrites": 10}}
    check("a reading whose bars hold has no problem", verdict(flat) == [])
    check("a wiring that fails withholds B2 rather than reporting it",
          any("no B2 number may be quoted" in problem for problem in verdict(
              {**flat, "wiring": {**flat["wiring"], "wider": 7, "share": 0.7, "holds": False}})))
    check("a B2 below its bar names the ceiling and the resolution",
          any("less the registered resolution" in problem for problem in verdict(
              {**flat, "acted": {**flat["acted"], "acted": 5, "share": 0.5, "holds": False}})))
    check("an arm with no graded write has nothing to measure",
          any("nothing to measure" in problem for problem in verdict(
              {**flat, "acted": {**flat["acted"], "episodes": 0, "acted": 0, "share": None, "holds": False}})))
    check("a control with no graded episode leaves nothing to compare",
          any("nothing to compare" in problem for problem in verdict(
              flat, {"acted": {"episodes": 0, "acted": 0, "share": None}, "scope": "request"})))
    check("a control at the ceiling is not a problem",
          verdict(flat, {"acted": {"episodes": 403, "acted": 394, "share": 0.978}, "scope": "clause"}) == [])

    check("the interval is wider on a smaller sample", half_width(0.9, 60) > half_width(0.9, 456))
    check("and absent where there is no share", half_width(None, 0) is None)
    check("the table prints both bars", "B1 wired" in render(whole) and "B2 acted" in render(whole))
    check("and a delta only against a control", "delta" not in render(whole))
    check("a control adds its population and its delta",
          "delta" in render(whole, {"acted": {"episodes": 403, "acted": 300, "share": 0.744}, "scope": "request"}))
    check("a control with no share prints its population and no delta",
          "delta" not in render(whole, {"acted": {"episodes": 0, "acted": 0, "share": None}, "scope": "request"}))

    # The saved form, and its own arithmetic check: a reading is a claim and the claim is recomputable.
    check("a reading that adds up passes its own check",
          check_manifest({"readings": {"measured": whole, "control": None}}) == [])
    for fragment, mutate in (
            ("row(s)", lambda one: one.__setitem__("episodes", 9)),
            ("B1's count", lambda one: one["wiring"].__setitem__("wider", 0)),
            ("extra asks", lambda one: one["wiring"].__setitem__("extraItems", 99)),
            ("denominator", lambda one: one["acted"].__setitem__("episodes", 9)),
            ("B2's count", lambda one: one["acted"].__setitem__("acted", 0)),
            ("share is not its count", lambda one: one["acted"].__setitem__("share", 0.5)),
            ("verdict", lambda one: one["wiring"].__setitem__("holds", False))):
        broken = json.loads(json.dumps(whole))
        mutate(broken)
        check(f"a reading whose {fragment} disagrees with its parts is refused",
              any(fragment in problem for problem in check_manifest({"readings": {"measured": broken}})))

    # The failure path of `check` itself, exercised and then removed: a suite whose only red path is the one a green
    # run never takes is a suite whose reporter has never run.
    recorded = len(failed)
    check("negative control (must be recorded)", False)
    check("a false assertion is recorded rather than printed", len(failed) == recorded + 1)
    failed.pop()

    import contextlib
    import io
    import tempfile

    def quiet(argv: list) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return main(argv)

    with tempfile.TemporaryDirectory() as temporary:
        document_path = Path(temporary) / "clause.json"
        document_path.write_text(json.dumps({"tasks": [task], "simulations": [
            {"task_id": "0", "messages": later_turn}]}), encoding="utf-8")
        saved_path = Path(temporary) / "reading.json"
        check("the reader runs from the command line and saves",
              quiet(["--document", str(document_path), "--save", str(saved_path)]) == 0)
        check("and the saved reading adds up", quiet(["--check", str(saved_path)]) == 0)
        check("a saved reading names the bytes it came from",
              json.loads(saved_path.read_text())["documents"]["measured"]["bytes"] > 0)
        check("its two bars hold, so --bar exits zero",
              quiet(["--document", str(document_path), "--bar"]) == 0)
        check("a control and a replication are both read",
              "delta" in _capture(["--document", str(document_path), "--control", str(document_path),
                                   "--control-scope", "request", "--replicate", str(document_path)]))
        empty_path = Path(temporary) / "empty.json"
        empty_path.write_text(json.dumps({"tasks": [], "simulations": []}), encoding="utf-8")
        check("an empty document fails the bar and exits one", quiet(["--document", str(empty_path), "--bar"]) == 1)
        check("and its verdict is printed", "not a reading" in _capture(["--document", str(empty_path)]))
        check("a document that is not named prints the usage", quiet([]) == 2)
        check("the json form is all three readings",
              "replicate" in _capture(["--document", str(document_path), "--json"]))
        broken_path = Path(temporary) / "broken.json"
        broken_path.write_text(json.dumps({"readings": {"measured": {"episodes": 1, "rows": []}}}),
                               encoding="utf-8")
        check("a saved file whose parts disagree exits one", quiet(["--check", str(broken_path)]) == 1)

    refused = None
    try:
        board_order("everything")
    except ValueError as error:
        refused = str(error)
    check("an unknown scope is refused rather than defaulted", "unknown board scope" in (refused or ""))
    check("the clause scope renders at the folded rung", board_order("clause") == "open")
    check("and every other scope at the statement's", board_order("request") == "statement")
    check("the cut is the product's line budget", anchors.CAP == board.MAX_ITEMS)

    check("a report of no failure is zero, and one failure is one",
          _quiet_report([]) == 0 and _quiet_report(["negative control (must fail)"]) == 1)
    return _report(failed)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Did the block carry the ask, and did the model write it?")
    parser.add_argument("--document", default="", help="a results document with transcripts and tasks")
    parser.add_argument("--control", default="", help="the document B2 is compared against")
    # R236's amendment. The control is the **same board replayed over the control transcripts** by default, because
    # the question is whether a model reading a window that carries the family writes it — and the replay is the only
    # measurement of what the window would have carried. Comparing against the contract board instead would price the
    # window's width, which is a superset by construction, as if it were the model acting.
    parser.add_argument("--control-scope", default="", choices=("", "request", "conversation", "clause"),
                        help="the scope the control is read at; empty means the measured arm's own scope")
    # A third document, read at the measured arm's scope: the **replication**. R236's amendment quotes one reading
    # and a ceiling, and a third 456-episode grid read the same way is the only evidence that the ceiling is a
    # property of the board rather than of the grid it was taken on.
    parser.add_argument("--replicate", default="", help="a second document read at the measured arm's scope")
    parser.add_argument("--scope", default="clause", choices=("request", "conversation", "clause"))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--bar", action="store_true", help="exit non-zero when a registered bar fails")
    parser.add_argument("--save", default="", help="write the reading here, with the documents' digests")
    parser.add_argument("--check", default="", help="check that a saved reading adds up, and exit non-zero if not")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if arguments.check:
        with open(arguments.check, "r", encoding="utf-8") as handle:
            problems = check_manifest(json.load(handle))
        for problem in problems:
            print(problem)
        if problems:
            return 1
        print("reading: the parts add up")
        return 0
    if not arguments.document:
        parser.print_help()
        return 2
    with open(arguments.document, "r", encoding="utf-8") as handle:
        measured = reading(json.load(handle), arguments.scope)
    replicate = None
    if arguments.replicate:
        with open(arguments.replicate, "r", encoding="utf-8") as handle:
            replicate = reading(json.load(handle), arguments.scope)
    control = None
    if arguments.control:
        with open(arguments.control, "r", encoding="utf-8") as handle:
            # The control is read at the scope its own arm ran: a clause control would be a comparison of the
            # treatment with itself, which is the defect the placement switch was made single-valued to avoid.
            control = reading(json.load(handle), arguments.control_scope or arguments.scope)
    if arguments.json:
        print(json.dumps({"measured": measured, "control": control, "replicate": replicate},
                         indent=1, sort_keys=True, default=str))
    else:
        print(render(measured, control))
        for problem in verdict(measured, control):
            print(problem)
    if arguments.save:
        payload = {
            "schema": "microglia.r236-mechanism/1",
            "command": f"board_mechanism.py --scope {arguments.scope} --control-scope "
                       f"{arguments.control_scope or arguments.scope}",
            "documents": {
                "measured": _digest(arguments.document),
                "control": _digest(arguments.control) if arguments.control else None,
                "replicate": _digest(arguments.replicate) if arguments.replicate else None,
            },
            "readings": {
                "measured": measured,
                "control": control,
                "replicate": replicate,
            },
        }
        with open(arguments.save, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=1, sort_keys=True, default=str)
            handle.write("\n")
    if arguments.bar and verdict(measured, control):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
