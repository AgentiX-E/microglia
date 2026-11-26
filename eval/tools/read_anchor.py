#!/usr/bin/env python3
"""R228 — bind the item to the read, not to the words.

Three anchors have been measured and closed. R223 asked whether the *request* declares enough to settle an item, and
found 385 cut points at -2.81σ. R225 asked whether what the episode *reveals* does, and found 565 cut points at
+1.04σ with the chosen one reversing sign on the confirmation half. R227 asked whether the request *names the record*
a receipt touches, and found 54.0% against a bar of 0.75 — the misses being 13 predicate asks over sets and 6 bookings
whose object the policy chooses.

This round tests the anchor those three failures point at: **the record the episode read**. In τ² a write is always
preceded by a read of the record it touches, because the identifiers are not in the request. So the board becomes

    an item is a record the episode opened, carrying what the read returned
    it is settled by a successful write that touches it, whatever family that write is in
    a write no read reached is `unrequested`, which is the failure τ² itself charges for

and the claim is that a board built this way cannot miss a discharge. That claim is *definitionally* true when the
record was read, which is why the round's bar is not coverage alone: a rule that can only pass by construction is not a
bar. The cost side of the trade is measured on the same artefact and on the same episodes:

    coverage        of the writes the evaluator required **and** the episode performed, how many did the board
                    credit — per write, then rolled up to episodes
    unaccounted     writes that happened and that the board credited to nothing: the read rule is wider, so this is
                    the number that can kill it
    overCredit      credited calls the evaluator did not require. This is the harm channel R213 measured at 8.5%: a
                    board that says "done" about work nobody graded is the block lying in the direction that costs
                    task success. It is a proxy — the graded set is not the user's set — and is reported as
                    "outside the graded set" rather than "unasked"
    openUnneeded    items the board still shows as open that no required write needs

## Two scopes, both declared before the reading

    strict   a record is open when a read returned **its contents** (`get_order_details`, `get_user_details`) or a
             lookup returned **its identity** (`find_user_id_*`)
    loose    …plus every order id merely *listed* inside a user record

`strict` is the product-meaningful rule — a working memory shows what the agent looked at — and it is the one the bar
is written over. `loose` is reported as the upper bound of generosity, because `get_user_details` returns the user's
whole order list and a rule that counted those as items would open five items for a task that needs one.

## Where the ground truth comes from, and what it is not

Both boards are replayed from R218b's artefact: 456 episodes of a paid grid, with the transcripts, the calls, and the
evaluator's own action list. Nothing here is a model call. `required` is `evaluation_criteria.actions` restricted to
the write families, and a performed write is **discharged** when it matches a required write one-to-one on family and
record — one-to-one because a second cancel of the same order is not a second piece of required work.

The control grid is the primary reading because the block was absent from its prompts, so a replay of a board over it
cannot be scoring its own content. `front.json` is the replication, and a reading that only holds on one of them is a
reading about a grid.

Run: `python3 eval/tools/read_anchor.py --self-test`
     `python3 eval/tools/read_anchor.py --document /path/control.json --json`
     `python3 eval/tools/read_anchor.py --document /path/control.json --replicate /path/front.json`
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys

#: Records a read **opens**: the tool, the kind of record, and the argument that names it.
#:
#: Two kinds and no more, because two kinds is what the retail domain has: an order is the unit every graded write
#: touches, and a user is the unit `modify_user_address` touches. Products are read constantly and written never, so
#: making them items would open four items for a task that needs one — the open tax that would make the board noise.
OPENS = {
    "get_order_details": ("order", "order_id"),
    "get_user_details": ("user", "user_id"),
}

#: Reads whose **result** is a record's identity rather than its contents. The agent authenticates through one of
#: these, so the record it names is one the episode holds even though nothing was returned but an id.
LOOKUPS = {
    "find_user_id_by_name_zip": "user",
    "find_user_id_by_email": "user",
}

#: Reads that open nothing. Enumerated rather than left implicit: a tool this module has never heard of is a tool the
#: rule forgot, and `ledger` reports it instead of quietly treating it as a non-read.
OPENS_NOTHING = frozenset({"get_product_details", "get_item_details", "list_all_product_types", "calculate"})

#: An order's identity in a result. τ² codes orders `#W` and seven digits, and the field is the only place a result
#: spells one, so the pattern is read off the corpus rather than guessed at.
ORDER = re.compile(r"#[A-Z]\d{6,}")

#: R229's soundness bar: the share of an ask board's ticks that a graded write back. Registered at 0.90 before the
#: reading, and it is a constant so the number a reading was judged against is not a local in a function.
SOUNDNESS = 0.90

#: A user's identity, as a lookup returns it: `first_last_1234`. Anchored, because `credit_card_9513926` is a payment
#: method and is also a lower-case word with digits after it.
USER = re.compile(r"^[a-z][a-z_]*_\d{4}$")

#: R230's admission test, and it is one character. A turn that answers a question is a value filling a slot the agent
#: asked for; a turn that follows a statement or a tool call is the user volunteering. Nothing about the domain, no cue
#: list, no model call — which is the point: the round asks whether **turn structure** carries the distinction, so the
#: test must not be able to smuggle in a second discriminator.
QUESTION = "?"

#: R230's three bars, registered in `prereg/R230-not-an-answer.md` before the reading and constants here for the reason
#: `SOUNDNESS` is one: the number a reading was judged against is not a local in a function.
#: **Recovery** — of the writes R229 attributed to later-turn asks, how many the admitted turns still account for.
ADMIT_RECOVERY = 0.60
#: **Noise** — the admitted asks may not exceed twice the turn-one contract's items.
ADMIT_NOISE = 2.0
#: **Coverage** — ten points over the request board's 63.6%, registered as the absolute number so a later round that
#: moves the request board does not move this bar with it.
ADMIT_COVERAGE = 0.736

#: R231's three bars, registered in `prereg/R231-the-clause.md` before the reading. B1 and B3 are R230's, unchanged
#: and on purpose: the round has to be judged on the bar its predecessor failed, or a rescored bar becomes the result.
CLAUSE_RECOVERY = 0.60
#: **Efficiency**, and it is a **restatement rather than an inheritance**: R230 passed a count limit (1,110 items
#: against 1,940) while rescuing a sixth of what it targeted, because a ceiling on items is passed by any rule that
#: admits almost nothing (AUDIT 34.323). A ratio binds in the direction the round cares about — every item the rule
#: buys has to come with a write it rescued.
CLAUSE_EFFICIENCY = 1.5
CLAUSE_COVERAGE = 0.736


def _siblings() -> str:
    """Put this file's own directory on `sys.path`, and answer it.

    `goal_board` lives beside this file and is imported for the reading it already implementss — the request-anchored
    board, its receipts and its settlement grades. The import is lazy for the reason `goal_board` gives its own: script
    mode puts the directory on the path and `python3 -m coverage run` does not, and CI measures this module through
    `-m`.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    return here


def _board():
    """The sibling module, imported at the call rather than at the module."""
    _siblings()
    import goal_board  # noqa: PLC0415 - see `_siblings`

    return goal_board


def record_of(arguments) -> "tuple | None":
    """The record a call names, as `(kind, id)`, or `None` when it names none.

    `order_id` is an order and `user_id` is an account; every other argument is content. Stated as a function because
    the same rule has to hold for the evaluator's required actions and for the agent's own calls, and a rule written
    twice is a rule that can disagree with itself.
    """
    if not isinstance(arguments, dict):
        return None
    for key, kind in (("order_id", "order"), ("user_id", "user")):
        value = arguments.get(key)
        if isinstance(value, str) and value:
            return (kind, value)
    return None


def ledger(messages) -> dict:
    """Reads and writes in the order the episode made them.

    One pass, because the question is **when** a record became visible: a write to an order the episode opened two
    turns later is `unrequested` at the moment it happens, and a board that sorted by kind instead of by time would
    credit it and hide the one failure this rule can produce.

    Results are paired positionally with calls — τ² answers the k-th call with the k-th result — so a queue of pending
    calls is kept and one entry is consumed per result. A document whose queue runs dry is truncated, and the reads it
    lost are counted in `dropped` rather than assumed.
    """
    board = _board()
    receipts = board.receipts_of(messages)
    events: list = []
    pending: collections.deque = collections.deque()
    writes = 0
    dropped = 0
    unknown: set = set()
    for message in messages:
        role = board.role_of(message)
        if role in ("assistant", "agent"):
            for call in board._field(message, "tool_calls") or []:  # noqa: SLF001 - the board's own accessor
                name = board._field(call, "name")  # noqa: SLF001
                if not isinstance(name, str) or not name:
                    continue
                if name in board.FAMILIES:
                    events.append(("write", writes))
                    pending.append(("write", writes))
                    writes += 1
                elif name in OPENS:
                    kind, key = OPENS[name]
                    arguments = board._field(call, "arguments")  # noqa: SLF001
                    value = arguments.get(key) if isinstance(arguments, dict) else None
                    record = (kind, value) if isinstance(value, str) and value else None
                    events.append(("open", record))
                    pending.append(("open", record))
                elif name in LOOKUPS:
                    kind = LOOKUPS[name]
                    events.append(("lookup", kind))
                    pending.append(("lookup", kind))
                elif name in OPENS_NOTHING:
                    events.append(("nothing", name))
                    pending.append(("nothing", name))
                else:
                    unknown.add(name)
                    events.append(("unknown", name))
                    pending.append(("unknown", name))
        elif role == "tool":
            text = board._field(message, "content")  # noqa: SLF001
            text = text if isinstance(text, str) else ""
            if not pending:
                dropped += 1
                continue
            kind, payload = pending.popleft()
            listed = [("order", found) for found in ORDER.findall(text)]
            if kind == "open" and payload:
                # A read that opened a record also *names* it in its own result. Listing it again would be the same
                # record twice, and the second copy is the one a reader would have to explain.
                listed = [record for record in listed if record != payload]
            for record in listed:
                events.append(("listed", record))
            if kind == "lookup":
                candidate = text.strip().strip("\"'")
                if USER.match(candidate):
                    events.append(("open", (payload, candidate)))
            elif kind == "open":
                # A read that was asked for one record can also *name* another: `get_order_details` returns the user
                # the order belongs to. That is a listing rather than an opening — the episode holds the order's
                # state, not the account's — and the distinction is the same one that keeps a user record's order
                # list from opening five orders.
                user = _user_in(text)
                if user:
                    events.append(("listed", ("user", user)))
    if len(receipts) != writes:  # pragma: no cover - a defensive check, never reached by this corpus
        raise SystemExit(f"receipt positions drifted: {len(receipts)} from goal_board, {writes} counted here")
    return {
        "events": events,
        "writes": receipts,
        "unknown": sorted(unknown),
        "dropped": dropped,
        "calls": len(events),
    }


def _user_in(text: str) -> str:
    """The user id an order record carries, if it carries one.

    Not a general search of the text: the field has to be a JSON `"user_id": "…"` pair, because a product name or an
    address containing a similar shape would otherwise open a record that does not exist.
    """
    match = re.search(r'"user_id"\s*:\s*"([a-z][a-z_]*_\d{4})"', text)
    return match.group(1) if match else ""


def admitted_asks(messages) -> dict:
    """R230's reading of the conversation: every user turn, less the ones a question asked for.

    R229 measured the cost of following every user turn at 4,761 items for 625 credited writes — 3.90 unneeded open
    items per episode — and named the mechanism: the simulator's *answers* carry cue words ("the mechanical keyboard",
    "box", "manuals") and the parser reads them as asks. The refinement it could not make is lexical. This one is not:
    a turn is read when the assistant turn before it did not ask the user a question.

    Three edges, and each is a decision rather than an accident:

    * **The first user turn is always read.** Not because the contract is always there — `request_of` reads the first
      turn that states an ask, which is turn three or later on 52 of 403 episodes (AUDIT 34.324) — but because a rule
      that can drop the opening turn can return an empty board, and an empty board is a rule with nothing to measure.
      The contract's own turn is reported separately, as `contract`, precisely so this bullet cannot be read as a claim
      that the two coincide.
    * **A user turn with no assistant turn between it and the previous user turn is read.** There was no question to
      answer, and `last` is reset on every user turn so a question asked three turns ago cannot gate the fourth.
    * **An assistant turn carrying only tool calls carries no content**, so it asks nothing and the turn after it is
      read. τ² writes the closing text as its own message, so this is the common shape and not a corner.

    What it can get wrong is stated here because the round is decided by it: a **courtesy** question ("is there
    anything else I can help you with?") is a question by this test, and if τ²'s simulator closes most turns that way
    the filter removes volunteered turns along with answers. `skipped` is returned so that cost is visible as a count
    rather than as a shortfall somebody has to infer.
    """
    module = _board()
    asks: list = []
    admitted: list = []
    skipped: list = []
    contract = None
    seen = 0
    last = ""
    for message in messages:
        role = module.role_of(message)
        if role in ("assistant", "agent"):
            content = module._field(message, "content")  # noqa: SLF001 - the board's own accessor
            last = content if isinstance(content, str) else ""
            continue
        if role not in ("user", "human"):
            continue
        content = module._field(message, "content")  # noqa: SLF001
        text = content if isinstance(content, str) else ""
        position = seen
        seen += 1
        question = QUESTION in last
        # Reset before the branch, not after it: the *next* turn's previous turn is this one, whatever this one was.
        last = ""
        if not text.strip():
            # Nothing to read. Not a skip either — a turn that stated nothing is not a turn the filter refused, and
            # counting it as one would inflate the cost of the rule with turns that had no content to lose.
            continue
        found = module.items_of(text)
        if contract is None and found:
            # R230's second mechanism, recorded because it is the one that explains a *loss*: `request_of` does not
            # read turn one, it reads the first turn that **states anything** and falls back to the first turn only
            # when none does. So the contract's turn can be turn three, and a filter that refuses turn three is a
            # filter that refuses the contract itself — which is how admitting more turns can cover fewer writes.
            contract = position
        if position == 0 or not question:
            admitted.append(position)
            asks.extend(found)
        else:
            skipped.append(position)
    return {
        "asks": module._folded(asks),
        "turns": seen,
        "admitted": admitted,
        "skipped": skipped,
        "contract": contract,
        "contractAdmitted": contract is None or contract in admitted,
    }


def clause_asks(messages) -> dict:
    """R231's reading: the contract's turn as a whole, every other turn one clause at a time.

    R230 priced the positional test and it failed for a reason that is not about position: of 2,453 user turns,
    **1,893 (77.2%)** follow a question from the agent, so the requirement and the answer share a turn and a whole-turn
    filter cannot keep one without the other. The material is *inside* the turn, so the next discriminator has to be,
    and it already exists — it is the parser's inheritance rule, which R229 priced as the source of its 4,761 items:

        a clause with no cue of its own takes the family of the clause before it, within the same sentence

    Inside a request that rule is what makes "the smart thermostat for one compatible with Google Home" an exchange
    rather than a fragment. Inside an **answer** it is what manufactures an ask out of a value: "yes, the purple one"
    inherits the exchange the agent proposed and becomes a second ask carrying the answer's words. So the round does
    not add a rule; it restricts where one may reach:

    * **The contract's turn is read whole.** Not turn one — the first turn that states an ask, which is turn three or
      later on 52 of 403 episodes (AUDIT 34.324). This is the invariant that round's audit asked every later rule to
      state: the board's item set **contains the contract's asks**, so a rule that reads more turns can no longer
      cover fewer writes, and coverage moving down is a finding about the binding rather than about the gate.
    * **Every other turn contributes only its self-naming clauses.** No cue of its own, no ask — whatever precedes it.

    What it gives up is stated because the reading is decided by it: an object list continued across clauses ("return
    the lamp and the chair") loses everything after the first object, because only inheritance reaches the second. That
    is the cost the round exists to price, and `offered - kept` is that cost as a count rather than as a shortfall.
    """
    module = _board()
    turns: list = []
    seen = 0
    for message in messages:
        role = module.role_of(message)
        if role not in ("user", "human"):
            continue
        content = module._field(message, "content")  # noqa: SLF001 - the board's own accessor
        text = content if isinstance(content, str) else ""
        position = seen
        seen += 1
        if not text.strip():
            # Nothing to read, and nothing the rule refused. The turn is still counted, because `admitted_asks` counts
            # it: a turn that stated nothing is an event in the conversation even when neither rule reads it, and two
            # rules whose turn counts disagree cannot be compared on the denominator they share.
            continue
        turns.append({"position": position, "whole": module.items_of(text),
                      "own": module.items_of(text, inherit=False)})
    contract = next((turn["position"] for turn in turns if turn["whole"]), None)
    asks: list = []
    whole_turns: list = []
    partial: list = []
    offered = kept = 0
    for turn in turns:
        take = turn["whole"] if turn["position"] == contract else turn["own"]
        offered += len(turn["whole"])
        kept += len(take)
        if turn["position"] == contract:
            whole_turns.append(turn["position"])
        elif len(turn["own"]) < len(turn["whole"]):
            partial.append(turn["position"])
        asks.extend(take)
    return {
        "asks": module._folded(asks),
        "turns": seen,
        "contract": contract,
        "wholeTurns": whole_turns,
        "partialTurns": partial,
        # The asks the parser offers across these turns, and the asks the boundary kept. Their difference is exactly
        # what only inheritance reached — the objects of a list, and the value of an answer.
        "offered": offered,
        "kept": kept,
        "refusedInherited": offered - kept,
        "containsContract": contract is not None,
    }


def board(entry: dict, scope: str = "strict") -> dict:
    """The read-anchored board: items are records opened, ticks are writes that touch them.

    `scope` decides what counts as open. `strict` is a read that returned the record's contents or its identity;
    `loose` adds every order id merely listed inside a user record. Both are computed from the same event list, so the
    difference between them is exactly the listing rule and nothing else.
    """
    if scope not in ("strict", "loose"):
        raise ValueError(f"unknown scope {scope!r}")
    seen: dict = {}
    credited: list = []
    unaccounted: list = []
    unbound: list = []
    opened_at: dict = {}
    position = 0
    for kind, payload in entry["events"]:
        position += 1
        if kind == "open" and payload:
            seen.setdefault(payload, position)
            opened_at.setdefault(payload, position)
        elif kind == "listed" and payload and scope == "loose":
            seen.setdefault(payload, position)
        elif kind == "write":
            receipt = entry["writes"][payload]
            # A call the environment refused changed nothing, so it is neither credited nor accused. Tested before the
            # record because a refused transfer is a refused transfer, not an unbound call.
            if not receipt.get("ok"):
                continue
            record = record_of(receipt.get("args"))
            if record is None:
                # A transfer names no record. It is neither credited (there is nothing to bind) nor unrequested (the
                # request asked for exactly this), so it is a third bucket and is reported as one.
                unbound.append(payload)
                continue
            if record in seen:
                credited.append(payload)
            else:
                unaccounted.append(payload)
    items = [
        {"record": record, "settled": any(record_of(entry["writes"][p].get("args")) == record for p in credited)}
        for record in seen
    ]
    return {
        "scope": scope,
        "items": items,
        "credited": credited,
        "unaccounted": unaccounted,
        "unbound": unbound,
        "open": [item["record"] for item in items if not item["settled"]],
    }


def ask_board(entry: dict, messages, scope: str = "request") -> dict:
    """R229's rule: an item is an **ask**, and the read supplies only the binding.

    R228 measured the two anchors' failures as a trade rather than as a deficit: the request board attributes 63.6% of
    the writes the evaluator requires because it will only tick a *named* ask on a receipt that names the product, and
    the read board attributes 98.5% because it ticks any write to any record it opened — at the price of 2.5 items per
    episode that no required write needs. The two columns point at one rule:

        an item is an ask the request states
        it is settled by a successful write **of its family to a record the episode opened**, one ask per call

    So relevance comes from the request, which is the only thing that knows what is required, and attribution comes
    from the read, which is the only thing that knows which record a call touched. Neither board above can express
    this: the request board's settlement rule asks a receipt to *name* the ask's object, and the read board has no
    notion of an ask at all.

    What it gives up. An ask whose family has no open member left is a write nobody asked for, and the board says so —
    it does not fall back to the request board's containment rule, because a fallback would make the measurement a
    union of the two rules rather than a test of one. What it can get wrong. Two asks of one family and two records
    opened bind in the order the writes arrive, so a tick can name the wrong record; that is the over-credit column
    and it is the bar's third test.
    """
    module = _board()
    if scope not in ("request", "conversation", "admitted", "clause"):
        # Named rather than defaulted: an unknown scope used to fall through to the request board, which would make a
        # typo on the command line a quiet re-run of the previous round.
        raise ValueError(f"unknown ask scope {scope!r}")
    if scope == "admitted":
        admission = admitted_asks(messages)
    elif scope == "clause":
        admission = clause_asks(messages)
    else:
        admission = None
    if admission is not None:
        # R230 and R231. The asks come from the turns the rule admits; the binding is unchanged, so the difference
        # between this board and `askAll` is exactly the admission rule and nothing else. The diagnostics travel with
        # the board because the rounds' findings are the composition of the transcript, not the point they land on.
        asks = admission["asks"]
    else:
        asks = module.board_of(messages, module.CONVERSATION if scope == "conversation" else module.REQUEST)["items"]
    asks = [{"family": item["family"], "words": item["words"]} for item in asks]
    # R230's seed, taken here because it costs one more parse and decides what the next round is about: an ask the
    # board never read is not the same deficit as an ask it read and spent. `CONVERSATION` scope is the board's own
    # parser run over **every** user turn, so the difference between the two is disclosure order and nothing else.
    later = module.board_of(messages, module.CONVERSATION).get("items") or []
    later_families = {item["family"] for item in later}
    unaccounted_by = collections.Counter()
    open_asks: dict = collections.defaultdict(list)
    for index, ask in enumerate(asks):
        open_asks[ask["family"]].append(index)
    settled: dict = {}
    credited: list = []
    unaccounted: list = []
    unbound: list = []
    by_position: dict = {}
    seen: set = set()
    for kind, payload in entry["events"]:
        if kind == "open" and payload:
            seen.add(payload)
        elif kind == "write":
            receipt = entry["writes"][payload]
            if not receipt.get("ok"):
                continue
            record = record_of(receipt.get("args"))
            if record is None:
                unbound.append(payload)
                continue
            family = receipt.get("family")
            waiting = [index for index in open_asks.get(family, []) if index not in settled]
            if waiting and record in seen:
                index = waiting[0]
                settled[index] = payload
                credited.append(payload)
            else:
                unaccounted.append(payload)
                # Three causes, and they are three different rounds. The ask was never stated anywhere; it was stated
                # in a later turn, which the board does not read; or it was stated and the episode wrote more than it
                # asked for.
                if family not in open_asks and family in later_families:
                    cause = "disclosedLater"
                elif family in open_asks:
                    cause = "consumed"
                else:
                    cause = "neverStated"
                unaccounted_by[cause] += 1
                # …and which write it was, because R230's bar is recovery **of the writes** a later turn names: a
                # counter can say how many there were and only a position can say whether this board now credits them.
                by_position[payload] = cause
    items = [
        {
            "family": ask["family"],
            "words": ask["words"],
            "record": record_of(entry["writes"][position].get("args")) if position is not None else None,
            "settled": position is not None,
        }
        for ask, position in zip(asks, [settled.get(index) for index in range(len(asks))])
    ]
    return {
        "scope": f"ask-{scope}",
        "items": items,
        "credited": credited,
        "unaccounted": unaccounted,
        "unbound": unbound,
        "open": [{"family": item["family"], "words": item["words"]} for item in items if not item["settled"]],
        "unaccountedBy": dict(unaccounted_by),
        "unaccountedByPosition": by_position,
        "admission": admission,
    }


def required_writes(task) -> list:
    """The writes the evaluator requires, each with the record it names.

    Read from `evaluation_criteria.actions`, the same list `goal_board.census` reads, restricted to the write families.
    A task with no criteria is a task this instrument cannot judge and returns nothing for, which is the absence the
    caller has to report rather than a zero.
    """
    if not isinstance(task, dict):
        return []
    criteria = task.get("evaluation_criteria") or task.get("criteria") or {}
    actions = criteria.get("actions") if isinstance(criteria, dict) else None
    found = []
    for action in actions or []:
        name = action.get("name") if isinstance(action, dict) else None
        if not isinstance(name, str) or name not in _board().FAMILIES:
            continue
        arguments = action.get("arguments") if isinstance(action, dict) else None
        found.append({"name": name, "family": _board().FAMILIES[name], "record": record_of(arguments)})
    return found


def discharge(writes: list, required: list) -> dict:
    """Which performed calls discharge a required write, one required write per call.

    One-to-one, in the order the episode made them: a task that requires `cancel_pending_order` on `#W1` and the
    episode cancels `#W1` twice has discharged one requirement and made one extra call. Matching by family alone would
    credit the second cancel to the first requirement and call the episode more complete than it is.
    """
    matched: dict = {}
    taken: set = set()
    for position, receipt in enumerate(writes):
        if not receipt.get("ok"):
            continue
        family = receipt.get("family")
        record = record_of(receipt.get("args"))
        for index, want in enumerate(required):
            if index in taken or want["family"] != family:
                continue
            # A requirement that names no record (a transfer) is matched by family alone; one that names a record is
            # matched on it, because a cancel of the wrong order is not the cancel the task grades.
            if want["record"] is not None and want["record"] != record:
                continue
            taken.add(index)
            matched[position] = index
            break
    return {"byPosition": matched, "discharged": len(matched), "unmatched": len(required) - len(matched)}


def episode(document_task, simulation: dict) -> dict:
    """One episode, read three ways: the read board at both scopes and the request board.

    Returned as raw counts rather than rates so that the aggregation can pair episodes and report an interval over the
    same units the bar is written over; a rate computed here and averaged later would weight a one-write episode the
    same as a four-write one.
    """
    messages = simulation.get("messages") or []
    module = _board()
    entry = ledger(messages)
    required = required_writes(document_task)
    done = discharge(entry["writes"], required)
    requested = module.board_of(messages)
    required_records = {want["record"] for want in required if want["record"] is not None}
    out = {
        "id": simulation.get("id"),
        "task": str(simulation.get("task_id")),
        "writes": sum(1 for receipt in entry["writes"] if receipt.get("ok")),
        "required": len(required),
        "discharged": done["discharged"],
        "dropped": entry["dropped"],
        "unknown": entry["unknown"],
        "boards": {},
    }
    required_families = {want["family"] for want in required}
    # Hoisted rather than read inside the loop: both admission rounds need the ask board's per-write causes, and reading
    # them out of whichever loop entry happened to run first would make the measurement depend on the order of a tuple.
    ask_found = ask_board(entry, messages)
    late = ask_found.get("unaccountedByPosition") or {}
    disclosed = {position for position, cause in late.items() if cause == "disclosedLater"}
    admissions: dict = {}
    for scope in ("strict", "loose", "ask", "askAll", "admitted", "clause"):
        if scope == "askAll":
            found = ask_board(entry, messages, "conversation")
        elif scope in ("admitted", "clause"):
            found = ask_board(entry, messages, scope)
            admissions[scope] = found["admission"] or {}
        elif scope == "ask":
            found = ask_found
        else:
            found = board(entry, scope)
        covered = [position for position in found["credited"] if position in done["byPosition"]]
        opening = [item for item in found["items"] if not item["settled"]]
        if scope in ("ask", "askAll", "admitted", "clause"):
            # An open ask is unneeded when no required write is of its family. Its *record* is whatever the episode
            # happened to bind, so the record test the two read boards use would say nothing here.
            unneeded = sum(1 for item in opening if item["family"] not in required_families)
        else:
            unneeded = sum(1 for item in opening if item["record"] not in required_records)
        out["boards"][scope] = {
            "credited": len(found["credited"]),
            "covered": len(covered),
            "unaccounted": len(found["unaccounted"]),
            "unbound": len(found["unbound"]),
            "items": len(found["items"]),
            "open": len(opening),
            "openUnneeded": unneeded,
            # A credited call the evaluator does not require. Named for what it is: outside the graded set.
            "overCredit": sum(1 for position in found["credited"] if position not in done["byPosition"]),
            "unaccountedBy": found.get("unaccountedBy") or {},
            # R230's recovery column, on **every** board rather than only the two admission rules: the question it
            # answers — of the writes a later turn states, how many does this rule account for — is a property any
            # rule has, and the request board's zero is the arithmetic that makes the round a round.
            "recoveredFromLate": sum(1 for position in found["credited"] if position in disclosed),
        }
    credited = set(requested.get("credited") or [])
    covered = [position for position in credited if position in done["byPosition"]]
    record_carrying = [p for p, r in enumerate(entry["writes"]) if r.get("ok") and record_of(r.get("args"))]
    dropping = [p for p in record_carrying if p not in credited]
    out["boards"]["request"] = {
        "credited": len(credited),
        "covered": len(covered),
        # For the request board the unaccounted column is the calls it credited to nothing: the same sentence as the
        # read board's, over the same write set, which is what makes the comparison a comparison.
        "unaccounted": len(dropping),
        "unbound": 0,
        "items": len(requested.get("items") or []),
        "open": sum(1 for item in requested.get("items") or [] if not item.get("settled_by")),
        "openUnneeded": sum(
            1
            for item in requested.get("items") or []
            if not item.get("settled_by") and item.get("family") not in {want["family"] for want in required}
        ),
        "overCredit": sum(1 for position in credited if position not in done["byPosition"]),
        "asked": len(requested.get("items") or []),
        "unrequestedNamed": len(requested.get("unrequested") or []),
        "unattributedNamed": len(requested.get("unattributed") or []),
        # Zero by construction, and that is the point rather than a column without content: a write the contract
        # cannot account for *because a later turn states its family* is a write whose family the contract never
        # names, so no ask of the contract can settle it. The three admission rounds are measured against this zero.
        "recoveredFromLate": sum(1 for position in credited if position in disclosed),
    }
    out["recordCarrying"] = len(record_carrying)
    # Recovery is measured per episode and on positions, so it is the same write on both sides of the comparison: the
    # writes the contract could not account for *because a later turn states their family*, and how many of them a
    # given board now credits. A rate aggregated here would pair a two-write episode with a nine-write one; the counts
    # are summed in `compare` for the reason every other column is. `recovered` keeps R230's meaning — the admitted
    # board's column — because that reading is saved and pinned, and a saved reading has to stay reproducible by the
    # code that quotes it.
    out["lateWrites"] = len(disclosed)
    out["recovered"] = out["boards"]["admitted"]["recoveredFromLate"]
    admission = admissions.get("admitted") or {}
    out["turns"] = admission.get("turns", 0)
    out["admittedTurns"] = len(admission.get("admitted") or [])
    out["skippedTurns"] = len(admission.get("skipped") or [])
    out["contractLater"] = 1 if admission.get("contract") not in (None, 0) else 0
    out["contractLost"] = 1 if admission and not admission.get("contractAdmitted") else 0
    # R231's diagnostics: what the boundary kept, and what only inheritance would have reached. The second is the
    # round's cost, counted rather than inferred — a rule that is priced only by its coverage cannot say whether it
    # lost object lists or answers.
    clause = admissions.get("clause") or {}
    out["clauseWholeTurns"] = len(clause.get("wholeTurns") or [])
    out["clausePartialTurns"] = len(clause.get("partialTurns") or [])
    out["clauseOffered"] = clause.get("offered", 0)
    out["clauseKept"] = clause.get("kept", 0)
    return out


def compare(document: dict, scope: str = "strict") -> dict:
    """The reading: both boards over the same episodes, paired, with the bar evaluated where it was written.

    The denominator is episodes the episode **wrote in and the evaluator grades**, because that is the population both
    boards are claims about. An episode whose required writes were all performed and all credited is `complete`; the
    share of complete episodes is the column the registered bar names, and mean coverage over discharged writes is
    reported beside it so that a board which is complete less often but misses less is visible as what it is.
    """
    tasks = {str(task.get("id")): task for task in document.get("tasks") or []}
    rows = []
    skipped = 0
    for simulation in document.get("simulations") or []:
        if not (simulation.get("messages") or []):
            skipped += 1
            continue
        row = episode(tasks.get(str(simulation.get("task_id"))), simulation)
        rows.append(row)
    graded = [row for row in rows if row["discharged"]]
    summary: dict = {
        "episodes": len(rows),
        "skipped": skipped,
        "graded": len(graded),
        "writes": sum(row["writes"] for row in rows),
        "required": sum(row["required"] for row in rows),
        "discharged": sum(row["discharged"] for row in rows),
        "dropped": sum(row["dropped"] for row in rows),
        "unknownTools": sorted({name for row in rows for name in row["unknown"]}),
        "turns": sum(row["turns"] for row in graded),
        "admittedTurns": sum(row["admittedTurns"] for row in graded),
        "skippedTurns": sum(row["skippedTurns"] for row in graded),
        "contractLater": sum(row["contractLater"] for row in graded),
        "contractLost": sum(row["contractLost"] for row in graded),
        "lateWrites": sum(row["lateWrites"] for row in graded),
        "recovered": sum(row["recovered"] for row in graded),
        "clauseWholeTurns": sum(row["clauseWholeTurns"] for row in graded),
        "clausePartialTurns": sum(row["clausePartialTurns"] for row in graded),
        "clauseOffered": sum(row["clauseOffered"] for row in graded),
        "clauseKept": sum(row["clauseKept"] for row in graded),
        "boards": {},
    }
    for name in ("strict", "loose", "ask", "askAll", "admitted", "clause", "request"):
        block = [row["boards"][name] for row in graded]
        covered = sum(one["covered"] for one in block)
        summary["boards"][name] = {
            "covered": covered,
            "credited": sum(one["credited"] for one in block),
            "coverage": (covered / summary["discharged"]) if summary["discharged"] else None,
            "complete": sum(1 for row in graded if row["boards"][name]["covered"] == row["discharged"]),
            "completeShare": (
                sum(1 for row in graded if row["boards"][name]["covered"] == row["discharged"]) / len(graded)
            )
            if graded
            else None,
            "unaccounted": sum(one["unaccounted"] for one in block),
            "unbound": sum(one["unbound"] for one in block),
            "overCredit": sum(one["overCredit"] for one in block),
            "overCreditPerEpisode": (sum(one["overCredit"] for one in block) / len(graded)) if graded else None,
            "open": sum(one["open"] for one in block),
            "openPerEpisode": (sum(one["open"] for one in block) / len(graded)) if graded else None,
            "openUnneeded": sum(one["openUnneeded"] for one in block),
            "openUnneededPerEpisode": (sum(one["openUnneeded"] for one in block) / len(graded)) if graded else None,
            "items": sum(one["items"] for one in block),
            # Only the ask boards classify their misses; the read boards and the request board have no taxonomy, and a
            # column of zeros for them would be a claim that their misses were counted and came to nothing.
            "unaccountedBy": dict(sorted(collections.Counter(
                {key: sum((one.get("unaccountedBy") or {}).get(key, 0) for one in block)
                 for key in ("disclosedLater", "consumed", "neverStated")}
            ).items())) if name in ("ask", "askAll", "admitted", "clause") else None,
            # Of the writes a later turn states, the ones this board accounts for. Every board has the column,
            # because the difference between them is the round: the contract's zero against a rule's rescue.
            "recoveredFromLate": sum(one["recoveredFromLate"] for one in block),
            # Of the calls this board ticked, the share the evaluator also requires. A tick that is not backed by a
            # graded write is the harm channel: the block saying done about work nobody asked for.
            "precision": (covered / sum(one["credited"] for one in block)) if sum(one["credited"] for one in block) else None,
        }
    chosen = summary["boards"][scope]
    requested = summary["boards"]["request"]
    summary["paired"] = {
        "coverageDelta": _delta(chosen["coverage"], requested["coverage"]),
        "completeDelta": chosen["complete"] - requested["complete"],
        "unaccountedDelta": chosen["unaccounted"] - requested["unaccounted"],
        "overCreditDelta": chosen["overCredit"] - requested["overCredit"],
        "episodesCompleteGained": sum(
            1
            for row in graded
            if row["boards"][scope]["covered"] == row["discharged"]
            and row["boards"]["request"]["covered"] != row["discharged"]
        ),
        "episodesCompleteLost": sum(
            1
            for row in graded
            if row["boards"][scope]["covered"] != row["discharged"]
            and row["boards"]["request"]["covered"] == row["discharged"]
        ),
    }
    if scope == "admitted":
        summary["bar"] = admit_bar(summary)
    elif scope == "clause":
        summary["bar"] = clause_bar(graded, summary)
    else:
        summary["bar"] = _bar(graded, summary, scope)
    summary["tasksJudged"] = sum(1 for task in tasks.values() if required_writes(task))
    return summary


def _delta(one, other):
    """`one - other`, or `None` when either side is unread: a difference against a missing reading is missing."""
    if one is None or other is None:
        return None
    return one - other


def _bar(graded: list, summary: dict, scope: str) -> dict:
    """The three bars, evaluated where they were registered.

    B1 and B2 are R228's own registration. **B3 was added to it before this file was first run**, because B1 as
    written can only be satisfied by a rule that credits every write to a record it opened — the read anchor cannot
    miss a discharge by construction — and a bar a rule passes by being itself is not a bar. B3 is the cost side made
    binding: the items the board shows open that no required write needs must not outnumber the writes the task
    requires, so the block is at least half signal.
    """
    if not graded:
        # A bar over nothing is not a pass. This lane has read absence-as-zero five times, and the sixth would be a
        # rule that "holds" because the document carried no graded episode at all.
        return {"holds": False, "reason": "no episode discharged a required write, so no bar can be evaluated"}
    chosen = summary["boards"][scope]
    requested = summary["boards"]["request"]
    meanRequired = summary["required"] / len(graded)
    b1 = (chosen["covered"] >= requested["covered"]) and (chosen["complete"] >= requested["complete"])
    b2 = chosen["unaccounted"] <= requested["unaccounted"]
    if scope == "ask":
        # R229's B3. The ask board's items are the request's asks, so it cannot nag — an open item is an ask somebody
        # stated — and the cost it can pay instead is a tick against the wrong ask. The bar is the share of ticks that
        # a graded write backs: 0.90, registered before the reading, because below nine in ten a tick is not evidence
        # and the block's entire claim is that a tick is evidence.
        b3 = (chosen["precision"] or 0.0) >= SOUNDNESS
        third = {
            "B3_soundness": {
                "holds": b3,
                "precision": chosen["precision"],
                "bar": SOUNDNESS,
                "overCredit": chosen["overCredit"],
            }
        }
    else:
        b3 = (chosen["openUnneededPerEpisode"] or 0.0) <= meanRequired
        third = {
            "B3_openTax": {
                "holds": b3,
                "openUnneededPerEpisode": chosen["openUnneededPerEpisode"],
                "requiredPerEpisode": meanRequired,
            }
        }
    return {
        "B1_settlement": {
            "holds": b1,
            "covered": chosen["covered"],
            "against": requested["covered"],
            "complete": chosen["complete"],
            "againstComplete": requested["complete"],
        },
        "B2_accusation": {
            "holds": b2,
            "unaccounted": chosen["unaccounted"],
            "against": requested["unaccounted"],
        },
        **third,
        "holds": b1 and b2 and b3,
    }


def admit_bar(summary: dict) -> dict:
    """R230's three bars, evaluated where the registration wrote them.

    They are not R228's bars and cannot be: **B1 cannot be "at least the request board"**, because admitting a later
    turn can only add asks, and adding asks can only add ticks — a bar the rule passes by being itself is the exact
    defect AUDIT 34.321 refused last round. So B1 is written over the *writes the filter is supposed to rescue*: of the
    calls R229 attributed to a later-turn ask, the share this board now accounts for. B2 prices the rescue in items.
    B3 says the rescue has to be worth having, which is the one bar a filter that keeps only what it already had cannot
    satisfy.

    A summary with no later-turn write is refused rather than passed: a grid where the question never arises is a grid
    the bar was not tested on, and this lane has read absence-as-zero six times.
    """
    chosen = summary["boards"]["admitted"]
    requested = summary["boards"]["request"]
    if not summary["lateWrites"]:
        return {"holds": False, "reason": "no write was attributed to a later turn, so recovery cannot be evaluated"}
    recovery = summary["recovered"] / summary["lateWrites"]
    noise = ADMIT_NOISE * requested["items"]
    b1 = recovery >= ADMIT_RECOVERY
    b2 = chosen["items"] <= noise
    b3 = (chosen["coverage"] or 0.0) >= ADMIT_COVERAGE
    return {
        "B1_recovery": {
            "holds": b1,
            "recovered": summary["recovered"],
            "against": summary["lateWrites"],
            "recovery": recovery,
            "bar": ADMIT_RECOVERY,
        },
        "B2_noise": {
            "holds": b2,
            "items": chosen["items"],
            "against": noise,
            "requestItems": requested["items"],
        },
        "B3_coverage": {
            "holds": b3,
            "coverage": chosen["coverage"],
            "bar": ADMIT_COVERAGE,
            "againstRequest": requested["coverage"],
        },
        "holds": b1 and b2 and b3,
    }


def clause_bar(graded: list, summary: dict) -> dict:
    """R231's three bars, evaluated where the registration wrote them.

    B1 and B3 are R230's, unchanged and on purpose: a round judged on a rescored bar is not judged. B2 is the one that
    had to be rewritten, and the rewrite is the finding — R230 passed "items within twice the contract" while rescuing
    a sixth of what it targeted, because a ceiling on cost is satisfied by any rule that admits almost nothing
    (AUDIT 34.323). The ratio removes that route; what it adds is a second one, closed here:

    **A ratio with a zero denominator is not satisfied by a zero numerator.** A rule that adds no item and rescues no
    write would pass `added <= 1.5 * recovered` at `0 <= 0` — the degenerate rule passing the bar written to stop it,
    which is the same defect in the other direction. Recovery of zero is therefore a failure, not a pass, and the
    ratio is reported as `None` rather than as a number the arithmetic would have to invent.
    """
    if not graded:
        return {"holds": False, "reason": "no episode discharged a required write, so no bar can be evaluated"}
    if not summary["lateWrites"]:
        return {"holds": False, "reason": "no write was attributed to a later turn, so recovery cannot be evaluated"}
    chosen = summary["boards"]["clause"]
    requested = summary["boards"]["request"]
    recovered = chosen["recoveredFromLate"]
    recovery = recovered / summary["lateWrites"]
    # Can be negative only if the clause board holds fewer asks than the contract, which the contract's own turn makes
    # impossible — so the budget below is read as a ceiling rather than clamped, and a negative reading would show up
    # as an efficiency improvement that no rule could have earned.
    added = chosen["items"] - requested["items"]
    b1 = recovery >= CLAUSE_RECOVERY
    b2 = recovered > 0 and added <= CLAUSE_EFFICIENCY * recovered
    b3 = (chosen["coverage"] or 0.0) >= CLAUSE_COVERAGE
    return {
        "B1_recovery": {
            "holds": b1,
            "recovered": recovered,
            "against": summary["lateWrites"],
            "recovery": recovery,
            "bar": CLAUSE_RECOVERY,
        },
        "B2_efficiency": {
            "holds": b2,
            "added": added,
            "recovered": recovered,
            "perWrite": (added / recovered) if recovered else None,
            "budget": CLAUSE_EFFICIENCY * recovered,
            "bar": CLAUSE_EFFICIENCY,
        },
        "B3_coverage": {
            "holds": b3,
            "coverage": chosen["coverage"],
            "bar": CLAUSE_COVERAGE,
            "againstRequest": requested["coverage"],
        },
        "holds": b1 and b2 and b3,
    }


def render(reading: dict, scope: str = "strict") -> str:
    """The reading as sentences, in the order the bars are written.

    Every board is printed on every run, including the three the bar was not evaluated over: the round's finding is a
    *trade* between boards, and a reader who saw only the chosen one would see a score rather than a trade.
    """
    def share(value) -> str:
        return "n/a" if value is None else f"{value:.1%}"

    def signed(value) -> str:
        return "n/a" if value is None else f"{value:+.1%}"

    boards = reading["boards"]
    chosen = boards[scope]
    requested = boards["request"]
    paired = reading["paired"]
    bar = reading["bar"]
    lines = [
        f"{reading['episodes']} episode(s), {reading['graded']} of them graded with a discharged write, "
        f"{reading['discharged']}/{reading['required']} required write(s) discharged, "
        f"{reading['writes']} successful write(s) in all",
        f"{'board':9s} {'covered':>7s} {'coverage':>8s} {'complete':>8s} {'unacc':>6s} {'over':>5s} "
        f"{'items':>6s} {'open':>5s} {'unneeded':>8s} {'precision':>9s}",
    ]
    for name in ("strict", "loose", "ask", "askAll", "admitted", "clause", "request"):
        one = boards[name]
        lines.append(
            f"{name:9s} {one['covered']:7d} {share(one['coverage']):>8s} {one['complete']:8d} "
            f"{one['unaccounted']:6d} {one['overCredit']:5d} {one['items']:6d} {one['open']:5d} "
            f"{one['openUnneeded']:8d} {share(one['precision']):>9s}"
        )
    lines.append(
        f"coverage delta {signed(paired['coverageDelta'])} against the request board; "
        f"episodes complete gained {paired['episodesCompleteGained']}, lost {paired['episodesCompleteLost']}"
    )
    if scope == "admitted" and reading.get("contractLost"):
        # R230's diagnosis, printed by the scope rather than by the bar: a reading whose bar has no tests is still a
        # reading, and the sentence explains a *loss* the bars cannot see. Kept off a clause reading on purpose —
        # that number is about the turn filter's refusals, and this round has no filter.
        lines.append(
            f"the contract's turn is not turn one in {reading['contractLater']} episode(s) — the first turn stated no "
            f"ask — and the filter refused that very turn in {reading['contractLost']} of them"
        )
    if "B2_efficiency" in bar:
        # R231's bars, printed with their own denominators. The efficiency line is the one the round was built around,
        # so it is printed as a ratio and a budget together: a reader who saw only the ratio could not tell whether a
        # rule bought one item for one write or twenty.
        lines.append(
            f"B1 recovery   {'holds' if bar['B1_recovery']['holds'] else 'FAILS'} "
            f"({bar['B1_recovery']['recovered']} of {bar['B1_recovery']['against']} later-turn writes recovered, "
            f"{share(bar['B1_recovery']['recovery'])}, against a bar of {bar['B1_recovery']['bar']:.2f})"
        )
        per_write = bar["B2_efficiency"]["perWrite"]
        lines.append(
            f"B2 efficiency {'holds' if bar['B2_efficiency']['holds'] else 'FAILS'} "
            f"({bar['B2_efficiency']['added']} item(s) over the contract for {bar['B2_efficiency']['recovered']} "
            f"rescued write(s), {'n/a' if per_write is None else f'{per_write:.2f}'} each against a budget of "
            f"{bar['B2_efficiency']['budget']:.0f})"
        )
        lines.append(
            f"B3 coverage   {'holds' if bar['B3_coverage']['holds'] else 'FAILS'} "
            f"({share(bar['B3_coverage']['coverage'])} against a bar of {bar['B3_coverage']['bar']:.3f}, request "
            f"board {share(bar['B3_coverage']['againstRequest'])})"
        )
        # The invariant AUDIT 34.324 asked every later rule to state, printed as a count rather than left to prose:
        # the contract's turn is read whole, so this board's asks contain the contract's.
        lines.append(
            f"the contract's turn is read whole in {reading['clauseWholeTurns']} episode(s); the boundary dropped "
            f"{reading['clauseOffered'] - reading['clauseKept']} of the {reading['clauseOffered']} ask(s) the parser "
            f"offers across {reading['turns']} user turn(s) — the ones only inheritance reached"
        )
    elif "B1_recovery" in bar:
        # R230's bars read over different units — writes rescued, items spent, writes covered — so they are printed
        # with their own denominators rather than through R228's more-covered-than-what shape. `skippedTurns` is on
        # the noise line because the filter's cost is the turns it refused, and a reader who saw only the item count
        # would be pricing the rule by its output rather than by its decisions.
        lines.append(
            f"B1 recovery   {'holds' if bar['B1_recovery']['holds'] else 'FAILS'} "
            f"({bar['B1_recovery']['recovered']} of {bar['B1_recovery']['against']} later-turn writes recovered, "
            f"{share(bar['B1_recovery']['recovery'])}, against a bar of {bar['B1_recovery']['bar']:.2f})"
        )
        lines.append(
            f"B2 noise      {'holds' if bar['B2_noise']['holds'] else 'FAILS'} "
            f"({bar['B2_noise']['items']} items against {bar['B2_noise']['against']:.0f}, twice the request board's "
            f"{bar['B2_noise']['requestItems']}; {reading['skippedTurns']} of {reading['turns']} turn(s) were answers)"
        )
        lines.append(
            f"B3 coverage   {'holds' if bar['B3_coverage']['holds'] else 'FAILS'} "
            f"({share(bar['B3_coverage']['coverage'])} against a bar of {bar['B3_coverage']['bar']:.3f}, request "
            f"board {share(bar['B3_coverage']['againstRequest'])})"
        )
    elif "B1_settlement" in bar:
        lines.append(
            f"B1 settlement  {'holds' if bar['B1_settlement']['holds'] else 'FAILS'} "
            f"({chosen['covered']} vs {requested['covered']} covered, {chosen['complete']} vs "
            f"{requested['complete']} episodes complete)"
        )
        lines.append(
            f"B2 accusation  {'holds' if bar['B2_accusation']['holds'] else 'FAILS'} "
            f"({chosen['unaccounted']} unaccounted vs {requested['unaccounted']})"
        )
        if "B3_openTax" in bar:
            lines.append(
                f"B3 open tax    {'holds' if bar['B3_openTax']['holds'] else 'FAILS'} "
                f"({chosen['openUnneededPerEpisode']:.2f} unneeded open item(s) per episode vs "
                f"{bar['B3_openTax']['requiredPerEpisode']:.2f} required write(s) per episode)"
            )
        else:
            lines.append(
                f"B3 soundness   {'holds' if bar['B3_soundness']['holds'] else 'FAILS'} "
                f"({share(chosen['precision'])} of ticks backed by a graded write against a bar of "
                f"{bar['B3_soundness']['bar']:.2f})"
            )
    else:
        # A bar that was never evaluated has no tests to print, and printing nothing would read as a pass.
        lines.append(f"bars          not evaluated — {bar.get('reason', 'no bar is reported')}")
    if reading["unknownTools"]:
        lines.append(f"tools no rule classifies: {', '.join(reading['unknownTools'])}")
    if reading["dropped"]:
        lines.append(f"{reading['dropped']} result(s) had no pending call — the document is truncated")
    return "\n".join(lines)


def _digest(path: str) -> str:
    """The sha256 of a file, so a reading says which bytes it was taken from."""
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def note(failed: list, name: str, condition) -> None:
    """Record an assertion that did not hold. A function rather than a closure, so that the branch which records a
    failure is exercised by the suite: a self-test whose failure path is never run is a suite that cannot fail."""
    if not condition:
        failed.append(name)


def check_manifest(reading: dict) -> list:
    """Whatever about a saved reading does not add up, as a list of sentences.

    A reading is an arithmetic claim and the documents quote its parts. Every audit entry this repository has written
    in the last three rounds was a quantity that a document asserted and an artefact did not carry, so the parts are
    checked against each other rather than against the prose: the boards must agree on the denominator, the taxonomy
    must sum to the writes it explains, and a bar must be the one its own numbers imply.
    """
    problems: list = []
    boards = reading.get("boards") or {}
    graded = reading.get("graded")
    if not boards or not graded:
        return ["the reading carries no board or no graded episode"]
    for name, one in boards.items():
        if one["covered"] > (one["credited"] or 0):
            problems.append(f"{name}: more covered writes than credited calls")
        if one["open"] > one["items"]:
            problems.append(f"{name}: more open items than items")
        if one["openUnneeded"] > one["open"]:
            problems.append(f"{name}: more unneeded open items than open items")
        if one["overCredit"] > (one["credited"] or 0):
            problems.append(f"{name}: more over-credited calls than credited calls")
        if one["covered"] + one["overCredit"] != (one["credited"] or 0):
            problems.append(f"{name}: covered plus over-credited does not equal credited")
        if one["complete"] > graded:
            problems.append(f"{name}: more complete episodes than graded episodes")
        if one["coverage"] is not None and reading.get("discharged"):
            expected = one["covered"] / reading["discharged"]
            if abs(one["coverage"] - expected) > 1e-9:
                problems.append(f"{name}: coverage is not covered over discharged")
    ask = boards.get("ask") or {}
    taxonomy = ask.get("unaccountedBy") or {}
    if taxonomy:
        if sum(taxonomy.values()) != ask.get("unaccounted"):
            problems.append("the taxonomy does not sum to the writes it explains")
    for name, one in boards.items():
        if one.get("unaccountedBy") and sum(one["unaccountedBy"].values()) != one["unaccounted"]:
            problems.append(f"{name}: the taxonomy does not sum to its unaccounted writes")
    late = reading.get("lateWrites")
    if late is not None:
        # Recovery is a subset count and is written over the same denominator on every board. A board that recovered
        # more writes than the conversation discloses is a board credited twice, which is the defect the position
        # pairing was rebuilt to remove (AUDIT 34.320).
        for name, one in boards.items():
            if one.get("recoveredFromLate") is not None and one["recoveredFromLate"] > late:
                problems.append(f"{name}: more writes recovered from later turns than the conversation discloses")
        admitted = boards.get("admitted") or {}
        if reading.get("recovered") is not None and admitted.get("recoveredFromLate") is not None:
            if reading["recovered"] != admitted["recoveredFromLate"]:
                problems.append("the recovery column is not the admitted board's")
    if reading.get("clauseOffered") is not None:
        if reading.get("clauseKept", 0) > reading["clauseOffered"]:
            problems.append("the boundary kept more asks than the parser offered")
        clause = boards.get("clause") or {}
        if clause.get("items") is not None and reading.get("clauseKept", 0) < clause["items"]:
            # Folding across turns can only remove items, so a board holding more items than the rule kept is a board
            # that read something the rule did not admit.
            problems.append("the clause board holds more items than the boundary kept")
    bar = reading.get("bar") or {}
    if bar.get("holds") and any(value.get("holds") is False for value in bar.values() if isinstance(value, dict)):
        problems.append("the bar holds while one of its tests does not")
    return problems


def _report(failed: list) -> int:
    """The names of the assertions that failed, or a line saying they all held."""
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("read anchor: all assertions hold")
    return 0


def _call(name: str, **arguments) -> dict:
    """One assistant message carrying one call, in the shape τ² writes."""
    return {"role": "assistant", "content": "", "tool_calls": [{"name": name, "arguments": arguments}]}


def _result(content, error=False) -> dict:
    """One tool message, in the shape τ² writes."""
    return {"role": "tool", "content": content, "error": error}


def self_test() -> int:
    """Assertions over episodes small enough to check by eye."""
    failed: list = []

    def check(name: str, condition) -> None:
        note(failed, name, condition)

    # Every retail tool this module has ever seen is classified. The corpus's own list is the check, because a tool
    # nobody classified is a tool the rule silently treated as a non-read.
    board_module = _board()
    # The sibling import repairs `sys.path` for the reason its docstring gives, and under `-m coverage run` the path is
    # already repaired by the interpreter — so the repair is tested by taking it away rather than by trusting it.
    here = os.path.dirname(os.path.abspath(__file__))
    saved = list(sys.path)
    sys.path[:] = [entry for entry in sys.path if entry != here]
    try:
        check("the sibling import repairs the path it needs", _board().__name__ == "goal_board")
    finally:
        sys.path[:] = saved
    toolset = set(board_module.FAMILIES) | set(OPENS) | set(LOOKUPS) | set(OPENS_NOTHING)
    check("every retail tool is classified", {
        "get_order_details", "get_product_details", "get_user_details", "find_user_id_by_name_zip",
        "return_delivered_order_items", "modify_pending_order_items", "exchange_delivered_order_items",
        "find_user_id_by_email", "cancel_pending_order", "modify_pending_order_address", "transfer_to_human_agents",
        "calculate", "modify_user_address", "get_item_details", "list_all_product_types",
        "modify_pending_order_payment",
    } <= toolset)

    check("an order id is a record", record_of({"order_id": "#W1234567"}) == ("order", "#W1234567"))
    check("a user id is a record", record_of({"user_id": "mia_garcia_4516"}) == ("user", "mia_garcia_4516"))
    check("an item id is not a record", record_of({"item_ids": ["1"], "new_item_ids": ["2"]}) is None)
    check("a summary is not a record", record_of({"summary": "the customer asked for a human"}) is None)
    check("arguments that are not a dict name no record", record_of("not a dict") is None)
    check("an empty id names no record", record_of({"order_id": ""}) is None)

    # An episode that opens an order and cancels it: the read board credits the call, and so does the request board
    # once the request has been read for an ask.
    order = '{"order_id": "#W1234567", "user_id": "mia_garcia_4516", "items": []}'
    opened_then_written = [
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        _call("cancel_pending_order", order_id="#W1234567", reason="no longer needed"),
        _result(order),
    ]
    entry = ledger(opened_then_written)
    strict = board(entry, "strict")
    # The order is opened; the account the order names is only listed, because the episode holds the order's state and
    # not the account's. That distinction is what keeps a user record's five orders from becoming five items.
    check("the read opens the order it names, and only it", len(strict["items"]) == 1)
    check("the account the order names is known but not open", board(entry, "loose")["items"][0]["record"][0] == "order")
    check("the cancel is credited", len(strict["credited"]) == 1)
    check("nothing is unaccounted", not strict["unaccounted"])
    check("nothing is left open", not strict["open"])

    # A write to an order the episode never opened is the one failure this rule can produce, and it is not hidden.
    written_unread = [
        {"role": "user", "content": "Cancel both of my orders."},
        _call("cancel_pending_order", order_id="#W1234567", reason="duplicate"),
        _result("{}"),
    ]
    blind = board(ledger(written_unread), "strict")
    check("a write to a record nobody read is unaccounted", len(blind["unaccounted"]) == 1)
    check("and it credits nothing", not blind["credited"])

    # The listing rule: an order id inside the user record is *known* but not *opened*, which is the only difference
    # between the two scopes.
    user = '{"user_id": "mia_garcia_4516", "orders": ["#W1234567", "#W7654321"]}'
    listed = [
        {"role": "user", "content": "Cancel the lamp order."},
        _call("get_user_details", user_id="mia_garcia_4516"),
        _result(user),
        _call("cancel_pending_order", order_id="#W7654321", reason="customer changed their mind"),
        _result("{}"),
    ]
    listed_entry = ledger(listed)
    check("strict does not open an order that was only listed", len(board(listed_entry, "strict")["items"]) == 1)
    check("and therefore does not credit a write to it", not board(listed_entry, "strict")["credited"])
    check("loose opens it", len(board(listed_entry, "loose")["items"]) == 3)
    check("and credits the write", len(board(listed_entry, "loose")["credited"]) == 1)

    # A lookup opens the record its result names, and a payment method is not a record.
    lookup = [
        {"role": "user", "content": "Change the address on my account."},
        _call("find_user_id_by_name_zip", first_name="Mia", last_name="Garcia", zip="60614"),
        _result("mia_garcia_4516"),
        _call("modify_user_address", user_id="mia_garcia_4516", address1="1 Main St", zip="60614"),
        _result("{}"),
    ]
    found = board(ledger(lookup), "strict")
    check("a lookup opens the user it returns", len(found["items"]) == 1)
    check("and the address change is credited to it", len(found["credited"]) == 1)
    check("a payment method id is not a user", not USER.match("credit_card_9513926"))

    # A transfer names no record, so it is neither credited nor accused. The bucket exists because calling it
    # unrequested would charge the board for the one call a refusal task exists to produce.
    transfer = [
        {"role": "user", "content": "I want to speak to a human."},
        _call("transfer_to_human_agents", summary="customer asked for a representative"),
        _result("{}"),
    ]
    handed = board(ledger(transfer), "strict")
    check("a transfer is unbound rather than unaccounted", len(handed["unbound"]) == 1 and not handed["unaccounted"])

    # A failed call changed nothing. Crediting it would be the board saying done about a change the environment
    # refused, which is the failure `receipts_of` already refuses for the request board.
    refused = [
        {"role": "user", "content": "Cancel my order."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        _call("cancel_pending_order", order_id="#W1234567", reason="x"),
        _result('{"error": "order is delivered"}', error=True),
    ]
    check("a refused cancel credits nothing", not board(ledger(refused), "strict")["credited"])

    # An unclassified tool is reported rather than dropped.
    strange = [{"role": "assistant", "content": "", "tool_calls": [{"name": "teleport", "arguments": {}}]},
               _result("{}")]
    check("an unknown tool is reported", ledger(strange)["unknown"] == ["teleport"])
    check("a result with no pending call is counted as dropped", ledger([_result("{}")])["dropped"] == 1)

    # Discharge is one-to-one on family **and** record.
    writes = ledger(opened_then_written)["writes"]
    required = [{"name": "cancel_pending_order", "family": "cancel", "record": ("order", "#W1234567")}]
    done = discharge(writes, required)
    check("a required write on the record is discharged", done["discharged"] == 1)
    other = [{"name": "cancel_pending_order", "family": "cancel", "record": ("order", "#W9999999")}]
    check("a required write on another record is not", discharge(writes, other)["discharged"] == 0)
    twice = [
        {"role": "user", "content": "cancel"},
        _call("cancel_pending_order", order_id="#W1", reason="a"),
        _result("{}"),
        _call("cancel_pending_order", order_id="#W1", reason="b"),
        _result("{}"),
    ]
    check("a second cancel of the same order is one discharge",
          discharge(ledger(twice)["writes"], [{"name": "cancel_pending_order", "family": "cancel",
                                               "record": ("order", "#W1")}])["discharged"] == 1)
    check("a requirement that names no record is matched by family",
          discharge(ledger(transfer)["writes"], [{"name": "transfer_to_human_agents", "family": "transfer",
                                                  "record": None}])["discharged"] == 1)

    # The evaluator's list is read from the evaluator's own document, and a task without one contributes nothing.
    task = {"id": "1", "evaluation_criteria": {"actions": [
        {"name": "cancel_pending_order", "arguments": {"order_id": "#W1234567"}},
        {"name": "get_order_details", "arguments": {"order_id": "#W1234567"}},
    ]}}
    check("only the write families are required", [one["family"] for one in required_writes(task)] == ["cancel"])
    check("a task without criteria requires nothing", required_writes({"id": "2"}) == [])
    check("a task that is not a dict requires nothing", required_writes(None) == [])

    # The comparison, end to end, over two episodes that differ in the way the bar is about: one where the request's
    # words and the receipt's product meet, and one where only the record does.
    document = {
        "tasks": [
            task,
            {"id": "2", "evaluation_criteria": {"actions": [
                {"name": "return_delivered_order_items", "arguments": {"order_id": "#W7654321"}},
            ]}},
        ],
        "simulations": [
            {"id": "s1", "task_id": "1", "messages": opened_then_written},
            {"id": "s2", "task_id": "2", "messages": [
                {"role": "user", "content": "I want to send back the thing I bought last week."},
                _call("get_order_details", order_id="#W7654321"),
                _result('{"order_id": "#W7654321", "user_id": "mia_garcia_4516", "items": [{"name": "Desk Lamp"}]}'),
                _call("return_delivered_order_items", order_id="#W7654321", item_ids=["1"], payment_method_id="c"),
                _result("{}"),
            ]},
            {"id": "s3", "task_id": "1", "messages": []},
        ],
    }
    reading = compare(document)
    check("an empty episode is skipped, not counted as unticked", reading["episodes"] == 2 and reading["skipped"] == 1)
    check("both boards credit the first episode", reading["boards"]["strict"]["covered"] == 2)
    check("the read board also credits the second", reading["boards"]["strict"]["coverage"] == 1.0)
    check("the request board misses the one the words never named",
          reading["boards"]["request"]["coverage"] < reading["boards"]["strict"]["coverage"])
    check("the paired delta is positive", reading["paired"]["coverageDelta"] > 0)
    check("the bar evaluates", reading["bar"]["holds"] is True)
    check("and the settlement bar is the one that carried it", reading["bar"]["B1_settlement"]["holds"] is True)

    # The reading is rendered, not summarised by hand.
    text = render(reading)
    check("the reading states its denominator", "graded with a discharged write" in text)
    check("the reading names all three boards", "strict" in text and "loose" in text and "request" in text)
    check("the reading states the three bars", "B1" in text and "B2" in text and "B3" in text)
    check("the reading names every board it prints",
          all(name in text for name in ("strict", "loose", "ask", "askAll", "request")))
    check("a clean reading names no unknown tool", "tools no rule classifies" not in text)
    check("an unknown tool is named when there is one",
          "tools no rule classifies" in render({**reading, "unknownTools": ["teleport"]}))
    check("a dropped result is named when there is one", "truncated" in render({**reading, "dropped": 1}))
    check("the ask scope evaluates its own third bar", "B3 soundness" in render(compare(document, "ask"), "ask"))
    check("a clean reading names no unknown tool", "tools no rule classifies" not in text)
    check("an unknown tool is named when there is one",
          "tools no rule classifies" in render({**reading, "unknownTools": ["teleport"]}))
    check("a dropped result is named when there is one", "truncated" in render({**reading, "dropped": 1}))

    # A bar that cannot fail is not a bar: B3 has to be able to say no, so a board whose open tax runs away is refused.
    listed_grid = {
        "tasks": [task],
        "simulations": [
            {"id": "s1", "task_id": "1", "messages": [
                {"role": "user", "content": "cancel"},
                _call("get_user_details", user_id="mia_garcia_4516"),
                _result('{"user_id": "mia_garcia_4516", "orders": ["#W1111111", "#W2222222", "#W3333333", '
                        '"#W4444444", "#W5555555"]}'),
                _call("cancel_pending_order", order_id="#W1234567", reason="x"),
                _result("{}"),
            ]},
        ],
    }
    greedy = compare(listed_grid, scope="loose")
    check("a loose board that opens five items for one write fails the open tax",
          greedy["bar"]["B3_openTax"]["holds"] is False)
    check("and it is the open tax that refuses it, not the settlement bar alone",
          greedy["bar"]["B3_openTax"]["openUnneededPerEpisode"] == 6)
    tight = compare(listed_grid, scope="strict")
    check("the strict board on the same episode keeps the tax inside the bar",
          tight["bar"]["B3_openTax"]["holds"] is True)
    check("and the two scopes differ only through the listing rule",
          tight["boards"]["loose"]["items"] - tight["boards"]["strict"]["items"] == 5)

    # The command line, over documents this test writes.
    import tempfile

    def quiet(argv: list) -> int:
        # `argparse` reports a bad choice by raising `SystemExit`, and a suite that let it through would end the run
        # rather than record the assertion. The exit code is what the shell would see, so it is what is returned.
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                return main(argv)
            except SystemExit as exit_code:
                return int(exit_code.code or 0)

    def capture(argv: list) -> str:
        import contextlib
        import io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
            try:
                main(argv)
            except SystemExit:
                pass
        return buffer.getvalue()

    with tempfile.TemporaryDirectory() as temporary:
        path = os.path.join(temporary, "grid.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        check("the comparison runs from the command line", quiet(["--document", path]) == 0)
        check("a missing argument prints the usage", quiet([]) == 2)
        parsed = json.loads(capture(["--document", path, "--json"]))
        check("the json form parses", parsed["graded"] == 2)
        check("and carries both bars", parsed["bar"]["B1_settlement"]["holds"] is True)
        check("a scope of loose is honoured", quiet(["--document", path, "--scope", "loose"]) == 0)
        check("an unknown scope is refused", quiet(["--document", path, "--scope", "wide"]) == 2)
        check("a bar that holds exits zero", quiet(["--document", path, "--bar"]) == 0)
        check("a bad choice is refused by the parser", capture(["--document", path, "--scope", "wide"]) == "")
        failing = os.path.join(temporary, "greedy.json")
        with open(failing, "w", encoding="utf-8") as handle:
            json.dump(listed_grid, handle)
        check("a bar that fails exits one", quiet(["--document", failing, "--scope", "loose", "--bar"]) == 1)
        check("the ask scope runs end to end", quiet(["--document", path, "--scope", "ask"]) == 0)
        check("the admitted scope runs end to end", quiet(["--document", path, "--scope", "admitted"]) == 0)
        # A grid whose episodes never state anything after the first turn cannot evidence the recovery bar, and the
        # absence is a refusal rather than a pass — the fifth time this lane has had to say so, so it is a test.
        check("a grid with no later turn refuses the recovery bar",
              quiet(["--document", path, "--scope", "admitted", "--bar"]) == 1)
        check("and a replication that fails exits one too",
              quiet(["--document", path, "--replicate", failing, "--scope", "loose", "--bar"]) == 1)
        saved = os.path.join(temporary, "reading.json")
        check("the reading saves", quiet(["--document", path, "--save", saved]) == 0)
        check("and what it saved adds up", quiet(["--check", saved]) == 0)
        payload = json.loads(open(saved, encoding="utf-8").read())
        check("a saved reading names the bytes it came from", len(payload["document"]["sha256"]) == 64)
        check("and the size of them", payload["document"]["bytes"] > 0)
        with open(saved, "w", encoding="utf-8") as handle:
            json.dump({"boards": {}, "graded": 0}, handle)
        check("a manifest that does not add up fails", quiet(["--check", saved]) == 1)
        check("and says what is wrong", "no board" in capture(["--check", saved]))
        # The replication: the same document twice is the same reading, and a reading that fails its bar on either
        # grid is a reading that failed.
        check("a replication is reported", "replication" in capture(["--document", path, "--replicate", path]))

    def quiet_report(names: list) -> int:
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            return _report(names)

    check("the failing branch records the name", (lambda box: (note(box, "x", False), box == ["x"])[1])([]))
    check("a call with no name is not a record of anything",
          ledger([{"role": "assistant", "tool_calls": [{"arguments": {}}]},
                  {"role": "assistant", "tool_calls": [{"name": "", "arguments": {}}]}])["calls"] == 0)
    check("a read that opens nothing is classified as one",
          ledger([_call("calculate", expression="1+1"), _result("2")])["unknown"] == [])
    check("a lookup whose result is not an id opens nothing",
          ledger([_call("find_user_id_by_email", email="nobody@example.com"), _result("No user found.")])["events"]
          == [("lookup", "user")])
    check("an order result without an account lists nothing",
          [event for event, _ in ledger([_call("get_order_details", order_id="#W1234567"),
                                         _result('{"order_id": "#W1234567"}')])["events"]] == ["open"])
    check("an order result names its account as a listing",
          ("listed", ("user", "mia_garcia_4516")) in ledger([
              _call("get_order_details", order_id="#W1234567"), _result(order)])["events"])
    refused_scope = False
    try:
        board(entry, "wide")
    except ValueError:
        refused_scope = True
    check("an unknown scope is refused", refused_scope)
    check("a difference against a missing reading is missing", _delta(None, 1) is None and _delta(1, 2) == -1)
    failed_write = [
        {"role": "user", "content": "cancel"},
        _call("cancel_pending_order", order_id="#W1234567", reason="x"),
        _result('{"error": "delivered"}', error=True),
    ]
    check("a refused write discharges nothing",
          discharge(ledger(failed_write)["writes"], [{"name": "cancel_pending_order", "family": "cancel",
                                                      "record": ("order", "#W1234567")}])["discharged"] == 0)
    nothing_graded = compare({"tasks": [], "simulations": [
        {"id": "s", "task_id": "9", "messages": [
            {"role": "user", "content": "hello"},
            _call("get_order_details", order_id="#W1234567"), _result(order)]}]})
    check("a grid with nothing graded fails the bar rather than passing it",
          nothing_graded["bar"]["holds"] is False and "no episode" in nothing_graded["bar"]["reason"])

    # The ask board's three refusals, and the taxonomy of a miss that was disclosed after the first turn.
    disclosed = [
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        {"role": "user", "content": "Actually, also return the lamp I bought."},
        _call("return_delivered_order_items", order_id="#W1234567", item_ids=["1"], payment_method_id="c"),
        _result("{}"),
    ]
    check("a write with no open ask of its family is unaccounted", ask_board(ledger(disclosed), disclosed)[
        "unaccounted"] == [0])
    check("and a family only a later turn states is classified as disclosed late",
          ask_board(ledger(disclosed), disclosed)["unaccountedBy"] == {"disclosedLater": 1})
    check("a refused call is not an unaccounted one", ask_board(ledger(failed_write), failed_write)["unaccounted"] == [])
    check("a transfer is unbound on the ask board too",
          ask_board(ledger(transfer), transfer)["unbound"] == [0])
    consumed = [
        {"role": "user", "content": "Cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        _call("cancel_pending_order", order_id="#W1234567", reason="a"),
        _result("{}"),
        _call("cancel_pending_order", order_id="#W1234567", reason="b"),
        _result("{}"),
    ]
    check("a second cancel of the same record finds the ask spent",
          ask_board(ledger(consumed), consumed)["unaccountedBy"] == {"consumed": 1})

    # R230. The admission rule is one character, so the tests are about the shapes it has to tell apart: a turn that
    # **answers** a question, a turn that follows a statement, and a turn that follows nothing.
    answered = [
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        {"role": "assistant", "content": "I found #W1234567. Would you like me to cancel it?"},
        {"role": "user", "content": "Yes please, cancel the desk lamp order."},
        _call("cancel_pending_order", order_id="#W1234567", reason="customer asked"),
        _result("{}"),
    ]
    read = admitted_asks(answered)
    check("a turn that answers a question is not read", read["admitted"] == [0] and read["skipped"] == [1])
    check("and every user turn is counted, read or not", read["turns"] == 2)
    check("only the first turn's asks survive the filter", [item["family"] for item in read["asks"]] == ["cancel"])

    volunteered = [
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        {"role": "assistant", "content": "The order is pending; I have not changed anything yet."},
        {"role": "user", "content": "Actually, also return the lamp I bought."},
        _call("return_delivered_order_items", order_id="#W1234567", item_ids=["1"], payment_method_id="c"),
        _result("{}"),
    ]
    check("a turn that follows a statement is read", admitted_asks(volunteered)["admitted"] == [0, 1])
    check("the admitted board credits the write that turn states",
          len(ask_board(ledger(volunteered), volunteered, "admitted")["credited"]) == 1)
    # …and the board this round is compared against cannot, which is the deficit the round exists to close.
    check("the request board leaves the same write unaccounted",
          ask_board(ledger(volunteered), volunteered)["unaccounted"] == [0])
    check("and R229's taxonomy names the cause",
          ask_board(ledger(volunteered), volunteered)["unaccountedBy"] == {"disclosedLater": 1})
    check("the taxonomy names the write, not only the count",
          ask_board(ledger(volunteered), volunteered)["unaccountedByPosition"] == {0: "disclosedLater"})

    # The three edges, each of which a plausible implementation gets wrong.
    check("a user turn with no assistant turn before it is read",
          admitted_asks([{"role": "user", "content": "cancel the lamp"},
                         {"role": "user", "content": "and the desk"}])["admitted"] == [0, 1])
    check("a question two turns back does not gate this turn, because the turn before it was a user turn",
          admitted_asks([{"role": "assistant", "content": "Which one?"},
                         {"role": "user", "content": "the lamp"},
                         {"role": "user", "content": "and the desk"}])["admitted"] == [0, 1])
    check("an assistant turn carrying only a tool call asks nothing",
          admitted_asks([{"role": "user", "content": "cancel it"},
                         {"role": "assistant", "tool_calls": [{"name": "get_order_details",
                                                               "arguments": {"order_id": "#W1234567"}}]},
                         {"role": "user", "content": "and return the desk"}])["admitted"] == [0, 1])
    empty = [{"role": "user", "content": "cancel"},
             {"role": "assistant", "content": "Which order?"},
             {"role": "user", "content": "   "}]
    check("an empty user turn is neither read nor counted as refused",
          admitted_asks(empty)["skipped"] == [] and admitted_asks(empty)["turns"] == 2)
    check("a first turn is read even when an assistant spoke before it",
          admitted_asks([{"role": "assistant", "content": "Hello! How can I help?"},
                         {"role": "user", "content": "cancel my order"}])["admitted"] == [0])
    # The second mechanism the reading found: the contract is not "turn one", it is "the first turn that states an
    # ask", and the two differ whenever an episode opens with a greeting. A filter that refuses that turn refuses the
    # contract — which is how a board that reads *more* turns can cover *fewer* writes.
    greeting = [
        {"role": "user", "content": "Hi!"},
        {"role": "assistant", "content": "Hello! Which order would you like to cancel?"},
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("cancel_pending_order", order_id="#W1234567", reason="x"),
        _result("{}"),
    ]
    greeter = admitted_asks(greeting)
    check("a greeting states no ask", greeter["contract"] == 1)
    check("the contract's turn can be a turn the filter refuses", greeter["contractAdmitted"] is False)
    check("and the contract's own turn is still counted as a turn", greeter["turns"] == 2)
    contract_grid = compare({"tasks": [task],
                             "simulations": [{"id": "s", "task_id": "1", "messages": greeting}]}, "admitted")
    check("a grid whose contract turn was refused says so in the reading",
          "refused that very turn in 1 of them" in render(contract_grid, "admitted"))
    # …and the reason it has nothing to recover is that `request_of` had already fallen back to that turn: the write is
    # in the request board's contract, so it is not a later turn's deficit. It is a **loss**, and it is the whole of
    # the difference between the admitted board's 410 covered writes and the request board's 416.
    check("that grid is refused for having no later-turn write to recover",
          "no write was attributed" in contract_grid["bar"]["reason"])

    # The bar, end to end and in both directions. The negative control is the registration's own worry: a later turn
    # that is an answer states a requirement, and the filter that is supposed to rescue later turns must not rescue
    # this one — otherwise the "recovery" is the `askAll` board wearing a filter's name.
    late_answer = [
        {"role": "user", "content": "Please cancel my order #W1234567."},
        _call("get_order_details", order_id="#W1234567"),
        _result(order),
        {"role": "assistant", "content": "Anything else you would like me to look at?"},
        {"role": "user", "content": "I also want to return the lamp, on #W7654321."},
        _call("return_delivered_order_items", order_id="#W7654321", item_ids=["1"], payment_method_id="c"),
        _result("{}"),
    ]
    returns = {"id": "2", "evaluation_criteria": {"actions": [
        {"name": "return_delivered_order_items", "arguments": {"order_id": "#W7654321"}},
    ]}}
    refused_grid = compare({"tasks": [returns],
                            "simulations": [{"id": "s", "task_id": "2", "messages": late_answer}]}, "admitted")
    check("a later-turn write the filter refuses is counted as a loss",
          (refused_grid["lateWrites"], refused_grid["recovered"]) == (1, 0))
    check("and the recovery bar fails on it", refused_grid["bar"]["B1_recovery"]["holds"] is False)
    check("the grid is refused", refused_grid["bar"]["holds"] is False)
    lamp_return = {"id": "3", "evaluation_criteria": {"actions": [
        {"name": "return_delivered_order_items", "arguments": {"order_id": "#W1234567"}},
    ]}}
    won_grid = compare({"tasks": [lamp_return],
                        "simulations": [{"id": "s", "task_id": "3", "messages": volunteered}]}, "admitted")
    check("a later-turn write the filter admits is recovered",
          (won_grid["lateWrites"], won_grid["recovered"]) == (1, 1))
    check("and all three bars hold on it", won_grid["bar"]["holds"] is True)
    check("the admitted reading adds up", check_manifest(won_grid) == [])
    check("the admitted reading prints its own three bars", "B3 coverage" in render(won_grid, "admitted"))
    check("and names the cost of the filter", "turn(s) were answers" in render(won_grid, "admitted"))

    # The bars at their exact thresholds. A bar tested only far from its boundary is a bar whose boundary is unknown,
    # and this round's numbers are the boundary: 93 of 155, 1,940 items, 73.6%.
    def bar_of(recovered: int, late: int, items: int, coverage: float, requestItems: int = 970) -> dict:
        return admit_bar({
            "lateWrites": late,
            "recovered": recovered,
            "boards": {"admitted": {"items": items, "coverage": coverage},
                       "request": {"items": requestItems, "coverage": 0.636}},
        })

    check("recovery at exactly the bar holds", bar_of(93, 155, 1940, 0.736)["holds"] is True)
    check("one write below the recovery bar fails", bar_of(92, 155, 1940, 0.736)["B1_recovery"]["holds"] is False)
    check("one item above the noise bar fails", bar_of(93, 155, 1941, 0.736)["B2_noise"]["holds"] is False)
    check("coverage a hair under the bar fails", bar_of(93, 155, 1940, 0.7359)["B3_coverage"]["holds"] is False)
    blank = bar_of(0, 0, 10, 1.0)
    check("a grid with no later-turn write is refused rather than passed", blank["holds"] is False)
    check("and the refusal says why", "no write was attributed" in blank["reason"])
    ask_scope_refused = False
    try:
        ask_board(ledger(answered), answered, "wide")
    except ValueError:
        ask_scope_refused = True
    check("an unknown ask scope is refused rather than defaulted to the request", ask_scope_refused)
    # A printer that raises on the refusal is a printer that cannot report it, and the refusal is a result.
    check("a reading with nothing graded prints its refusal rather than raising",
          "not evaluated" in render(nothing_graded) and "n/a" in render(nothing_graded))
    with tempfile.TemporaryDirectory() as temporary:
        # The refusal has to survive the command line, not only the function: a bar that fails in Python and exits
        # zero from the shell is a gate nobody's CI can use.
        answered_path = os.path.join(temporary, "answered.json")
        with open(answered_path, "w", encoding="utf-8") as handle:
            json.dump({"tasks": [returns],
                       "simulations": [{"id": "s", "task_id": "2", "messages": late_answer}]}, handle)
        check("a grid whose later turn is an answer fails the bar and exits one",
              quiet(["--document", answered_path, "--scope", "admitted", "--bar"]) == 1)
        won_path = os.path.join(temporary, "won.json")
        with open(won_path, "w", encoding="utf-8") as handle:
            json.dump({"tasks": [lamp_return],
                       "simulations": [{"id": "s", "task_id": "3", "messages": volunteered}]}, handle)
        check("and a grid whose later turn is volunteered passes and exits zero",
              quiet(["--document", won_path, "--scope", "admitted", "--bar"]) == 0)

    # R231. The same fixture is the positive control, and it is the sharpest one available: the later turn states its
    # requirement in a clause that carries its own verb, so a boundary that admits self-naming clauses has to credit
    # exactly the write the turn filter's 16% could not reach.
    boundary = clause_asks(volunteered)
    check("the contract's turn is read whole and reported as such", boundary["wholeTurns"] == [0])
    check("a volunteered requirement names its own family and is admitted",
          [item["family"] for item in boundary["asks"]] == ["cancel", "return"])
    check("and the clause board credits the write the turn filter lost",
          (len(ask_board(ledger(volunteered), volunteered, "clause")["credited"]),
           ask_board(ledger(volunteered), volunteered)["unaccounted"]) == (1, [0]))
    # The negative control the round is built on: an object list continued across a comma is what the boundary drops,
    # because only inheritance reaches the second object. It is the cost the prereg predicted, measured on a fixture
    # small enough to check by eye.
    listed = clause_asks([{"role": "user", "content": "Please cancel my order #W1234567."},
                          {"role": "user", "content": "I want to return the lamp, the purple one."}])
    check("an object list continued across a clause is what the boundary drops",
          (listed["offered"], listed["kept"], listed["refusedInherited"]) == (3, 2, 1))
    check("and the turn it happened in is named", listed["partialTurns"] == [1])
    check("the boundary's own arithmetic adds up", boundary["offered"] - boundary["kept"]
          == boundary["refusedInherited"])
    check("a conversation that states no ask has no contract turn",
          clause_asks([{"role": "user", "content": "Hi there!"}])["containsContract"] is False)
    check("an empty turn is skipped by both admission rules alike",
          clause_asks(empty)["turns"] == admitted_asks(empty)["turns"] == 2)
    # The invariant AUDIT 34.324 asked every later rule to state, asserted rather than described: the clause board reads
    # the contract's turn whole, so it cannot contain fewer asks than the contract and cannot cover fewer writes.
    kept_grid = compare({"tasks": [lamp_return],
                         "simulations": [{"id": "s", "task_id": "3", "messages": volunteered}]}, "clause")
    check("the clause board holds at least the contract's asks",
          kept_grid["boards"]["clause"]["items"] >= kept_grid["boards"]["request"]["items"])
    check("and covers at least the contract's writes",
          kept_grid["boards"]["clause"]["covered"] >= kept_grid["boards"]["request"]["covered"])
    check("the request board recovers nothing from later turns, by construction",
          kept_grid["boards"]["request"]["recoveredFromLate"] == 0)
    check("the clause reading adds up", check_manifest(kept_grid) == [])
    shown = render(kept_grid, "clause")
    check("the clause reading prints its efficiency bar", "B2 efficiency" in shown)
    check("and states the invariant as a count rather than as prose", "read whole in" in shown)
    check("and does not print the turn filter's diagnosis under its own heading",
          "refused that very turn" not in render(contract_grid, "clause"))

    # R231's bars at their exact thresholds, and one below. The efficiency budget is `1.5 x recovered`, so the boundary
    # is a fraction of an item and the two sides are one item apart — which is the only way to test a ratio honestly.
    def clause_bar_of(recovered: int, late: int, items: int, coverage: float, requestItems: int = 970) -> dict:
        return clause_bar([1], {
            "lateWrites": late,
            "boards": {"clause": {"items": items, "coverage": coverage, "recoveredFromLate": recovered},
                       "request": {"items": requestItems, "coverage": 0.636}},
        })

    check("recovery at the bar holds, with an item exactly at the efficiency budget",
          clause_bar_of(93, 155, 1109, 0.736)["holds"] is True)
    check("one item over the budget fails", clause_bar_of(93, 155, 1110, 0.736)["B2_efficiency"]["holds"] is False)
    check("one write under the recovery bar fails", clause_bar_of(92, 155, 1109, 0.736)["B1_recovery"]["holds"] is False)
    check("coverage a hair under the bar fails", clause_bar_of(93, 155, 1109, 0.7359)["B3_coverage"]["holds"] is False)
    # The defect a ratio invites, closed before the reading: adding nothing for nothing satisfies `0 <= 1.5 * 0`, which
    # is the degenerate rule passing the bar written to stop it (AUDIT 34.323, mirrored).
    empty_rule = clause_bar_of(0, 155, 970, 0.736)
    check("a rule that rescues nothing cannot pass the efficiency bar by adding nothing",
          empty_rule["B2_efficiency"]["holds"] is False)
    check("and the ratio is reported as absent rather than as zero",
          empty_rule["B2_efficiency"]["perWrite"] is None)
    check("a grid with no later-turn write is refused rather than passed",
          "no write was attributed" in clause_bar([1], {
              "lateWrites": 0,
              "boards": {"clause": {"items": 10, "coverage": 1.0, "recoveredFromLate": 0},
                         "request": {"items": 10, "coverage": 1.0}}})["reason"])
    check("and a grid with nothing graded is refused too",
          "no bar can be evaluated" in clause_bar([], {"lateWrites": 0, "boards": {}})["reason"])
    # The manifest checker, on the two claims this round adds: recovery is a subset count, and the boundary cannot keep
    # more asks than the parser offered.
    gap = json.loads(json.dumps(kept_grid))
    gap["boards"]["clause"]["recoveredFromLate"] = gap["lateWrites"] + 1
    check("a board that recovered more writes than were disclosed is caught", check_manifest(gap) != [])
    unreachable = json.loads(json.dumps(kept_grid))
    unreachable["clauseKept"] = unreachable["boards"]["clause"]["items"] + 1
    check("a boundary that kept fewer asks than its board holds is caught", check_manifest(unreachable) != [])
    over_offered = json.loads(json.dumps(kept_grid))
    over_offered["clauseKept"] = over_offered["clauseOffered"] + 1
    check("a boundary that kept more than the parser offered is caught", check_manifest(over_offered) != [])
    wrong_board = json.loads(json.dumps(kept_grid))
    wrong_board["boards"]["clause"]["items"] = wrong_board["clauseKept"] + 1
    check("a clause board holding more items than the boundary kept is caught", check_manifest(wrong_board) != [])
    column = json.loads(json.dumps(kept_grid))
    column["recovered"] = column["boards"]["admitted"]["recoveredFromLate"] + 1
    check("a recovery column that is not the admitted board's is caught", check_manifest(column) != [])
    # And the absence a checker must walk past: a reading taken before the column existed is not a reading with a
    # wrong one, which is why the check is guarded rather than unconditional.
    older = json.loads(json.dumps(kept_grid))
    for key in ("lateWrites", "recovered", "clauseOffered", "clauseKept"):
        older.pop(key, None)
    check("a reading with no recovery column is not an arithmetic problem", check_manifest(older) == [])
    half = json.loads(json.dumps(kept_grid))
    half.pop("recovered")
    check("and neither is a reading that kept the subset count and lost the summary column",
          check_manifest(half) == [])

    # The saved reading has to add up against itself, because the documents quote its parts (AUDIT 34.311/34.315).
    check("a reading that adds up has no problem", check_manifest(reading) == [])
    check("an empty reading is a problem", len(check_manifest({})) == 1)
    broken = json.loads(json.dumps(reading))
    broken["boards"]["strict"]["openUnneeded"] = broken["boards"]["strict"]["open"] + 1
    check("more unneeded open items than open items is caught", check_manifest(broken) != [])
    doctored = json.loads(json.dumps(reading))
    doctored["boards"]["ask"]["unaccountedBy"] = {"disclosedLater": 99}
    check("a taxonomy that does not sum is caught", check_manifest(doctored) != [])
    lying = json.loads(json.dumps(reading))
    lying["bar"]["B1_settlement"]["holds"] = False
    check("a bar that holds while a test fails is caught", check_manifest(lying) != [])
    covered_over = json.loads(json.dumps(reading))
    covered_over["boards"]["request"]["covered"] = 99
    check("more covered writes than credited calls is caught", check_manifest(covered_over) != [])
    miscounted = json.loads(json.dumps(reading))
    miscounted["boards"]["request"]["coverage"] = 0.5
    check("a coverage that is not covered over discharged is caught", check_manifest(miscounted) != [])
    open_heavy = json.loads(json.dumps(reading))
    open_heavy["boards"]["request"]["open"] = open_heavy["boards"]["request"]["items"] + 1
    check("more open items than items is caught", check_manifest(open_heavy) != [])
    over_credited = json.loads(json.dumps(reading))
    over_credited["boards"]["request"]["overCredit"] = 99
    check("more over-credited calls than credited ones is caught", check_manifest(over_credited) != [])
    for name in ("strict", "request"):
        missing = json.loads(json.dumps(reading))
        missing["boards"][name]["covered"] = missing["boards"][name]["credited"] + 1
        check(f"a board whose covered exceeds its credited is caught ({name})", check_manifest(missing) != [])
    taxonomy_only = json.loads(json.dumps(reading))
    taxonomy_only["boards"]["askAll"]["unaccountedBy"] = {"consumed": 5}
    check("an askAll taxonomy that does not sum is caught", check_manifest(taxonomy_only) != [])
    over_complete = json.loads(json.dumps(reading))
    over_complete["boards"]["request"]["complete"] = over_complete["graded"] + 1
    check("more complete episodes than graded ones is caught", check_manifest(over_complete) != [])
    # …and the two absences the checker has to walk past rather than accuse: a board with no coverage to compare and a
    # board whose misses were never classified. Both are legal readings, and a checker that failed them would make the
    # absence of a number look like a wrong one.
    unread = json.loads(json.dumps(reading))
    unread["discharged"] = 0
    for name in ("strict", "loose", "ask", "askAll", "admitted", "request"):
        unread["boards"][name]["coverage"] = None
    check("a board with no coverage is not a coverage problem", check_manifest(unread) == [])
    no_taxonomy = json.loads(json.dumps(reading))
    for name in ("ask", "askAll", "admitted"):
        no_taxonomy["boards"][name]["unaccountedBy"] = {}
    check("a board with no taxonomy has nothing to sum", check_manifest(no_taxonomy) == [])

    check("the reporter on an empty list exits zero", quiet_report([]) == 0)
    check("the reporter on a failure exits one", quiet_report(["negative control (must fail)"]) == 1)
    return _report(failed)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Bind the item to the read, not to the words.")
    parser.add_argument("--document", default="", help="a results document with transcripts and tasks")
    parser.add_argument("--replicate", default="", help="a second document, read the same way")
    parser.add_argument("--scope", default="strict", choices=("strict", "loose", "ask", "admitted", "clause"))
    parser.add_argument("--bar", action="store_true", help="exit non-zero when a registered bar fails")
    parser.add_argument("--save", default="", help="write the reading to this path, for the documents to quote")
    parser.add_argument("--check", default="", help="check that a saved reading adds up, and exit non-zero if not")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if arguments.check:
        with open(arguments.check, "r", encoding="utf-8") as handle:
            saved = json.load(handle)
        # A saved reading is the reading plus the bytes it came from; a bare reading is accepted too, because the
        # self-test has one in memory and a tool that only reads its own wrapper is a tool with a private format.
        problems = check_manifest(saved.get("reading", saved))
        if not isinstance(saved.get("reading"), dict):
            problems = problems or ["the saved form carries no reading"]
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
        document = json.load(handle)
    reading = compare(document, arguments.scope)
    if arguments.replicate:
        with open(arguments.replicate, "r", encoding="utf-8") as handle:
            second = compare(json.load(handle), arguments.scope)
        reading["replication"] = second
    if arguments.json:
        print(json.dumps(reading, indent=1, sort_keys=True, default=str))
    else:
        print(render(reading, arguments.scope))
        if arguments.replicate:
            print("")
            print("replication")
            print(render(reading["replication"], arguments.scope))
    if arguments.save:
        payload = {"document": {"sha256": _digest(arguments.document), "bytes": os.path.getsize(arguments.document)},
                   "replicateDocument": ({"sha256": _digest(arguments.replicate),
                                          "bytes": os.path.getsize(arguments.replicate)}
                                         if arguments.replicate else None),
                   "scope": arguments.scope, "reading": reading}
        with open(arguments.save, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=1, sort_keys=True, default=str)
            handle.write("\n")
    if arguments.bar and (not reading["bar"]["holds"]
                          or (arguments.replicate and not reading["replication"]["bar"]["holds"])):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
