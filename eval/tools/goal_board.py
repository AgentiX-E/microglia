#!/usr/bin/env python3
"""What the request asked for, and what a tool receipt proves was done.

Three rounds of this lane have served a **sentence about a failure** and measured a wash (R212: rescue +1.8 pp,
exact p = 1.0; R213: naming 100% of the unmet requirements and repairing fewer of them than a sentence that named
half). The published ablation of the system that holds the SOTA on this benchmark prices exactly that channel at
**+2.0 points with an interval that includes zero** and prices the other channel — *verified working state* — at
**+23.9** (Recuris, arXiv 2608.24876). The lesson channel is what this repository has been measuring; the state
channel is what it has never built.

This module is the state channel, and it is a parser rather than a model call for the reason the verdict arm was a
parser: the request is in front of the agent on the first turn, the receipts are in front of it on every turn, and
neither has to be paraphrased to be useful. A board of four asks that costs zero tokens cannot lose the cost
argument that a sentence of ninety-six tokens has to win.

## The three readings, and the one thing this module refuses to do

    items        the asks, extracted from the user's own messages: a family (exchange, return, cancel, modify,
                 address, payment, transfer) and the content words that name the object
    receipts     the state-changing calls that succeeded, with the names of the items they touched, read from the
                 tool results the episode already carries
    settled      an item and a receipt of the same family whose touched item *name* is contained in the item's own
                 words

The refusal is the design: **an item is never marked done because something of the same kind happened.** Two
exchanges in one order, one performed, is the shape this benchmark fails on, and a board that reports "exchange:
done" after the first is a board that removes the agent's reason to look — the harm channel R213 measured at 8.5%
of met requirements. So a receipt settles an item only when the product it names is named by the ask, and a receipt
whose product cannot be named (an address change carries no item id; a read was never made) is reported in its own
line as *unattributed* rather than credited to the nearest open ask.

Nothing here imports a provider, a harness or a file. `--self-test` runs offline; `--census` measures the extractor
against the evaluator's own list of required calls, which the board never sees.

Run: `python3 eval/tools/goal_board.py --self-test`
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

#: The schema travels into the artefact so a reading names the shape it was taken from.
SCHEMA = "microglia.goal-board/1"

#: The tag the block is injected under. Distinct from the knowledge tag because a reader that could not tell the
#: two apart could not say which channel a movement belonged to, and because `is_pack_message` has to remove the
#: previous copy of *this* block on every turn.
BOARD_TAG = "microglia-board"

#: A board is re-served every turn, so its length is the bill. Eight asks is more than any retail task states and
#: leaves room for the two header lines; the ceiling bounds the whole block, not the items.
MAX_ITEMS = 8
BOARD_MAX_CHARS = 720

#: The state-changing tools, mapped to the family an ask is written in. A read tool has no family because a read
#: cannot satisfy an ask: `get_order_details` is the agent looking, not the agent changing anything.
FAMILIES = {
    "exchange_delivered_order_items": "exchange",
    "return_delivered_order_items": "return",
    "cancel_pending_order": "cancel",
    "modify_pending_order_items": "modify",
    "modify_pending_order_address": "address",
    "modify_user_address": "address",
    "modify_pending_order_payment": "payment",
    "transfer_to_human_agents": "transfer",
}

#: How an ask is recognised in the user's words. Closed and short on purpose: a cue list that grows with the
#: corpus is a parser fitted to the corpus, and the census in `--census` would then be a measurement of the fit.
CUES = (
    ("exchange", r"\b(exchang\w*|swap\w*|replac\w*)\b"),
    ("return", r"\b(return\w*|refund\w*)\b"),
    ("cancel", r"\b(cancel\w*)\b"),
    ("address", r"\baddress\b"),
    ("payment", r"\bpayment\b"),
    ("transfer", r"\b(human|representative|supervisor)\b"),
    ("modify", r"\b(modify\w*|chang\w*)\b"),
)

#: Words that name no object. Deliberately the same closed list the debit reader uses for requirement words, plus
#: the retail vocabulary that would otherwise settle every ask at once ("order", "item", "want").
STOP = frozenset(
    """a an the and or of to in on for with by is are was were be been being as at from that this these those
    it its should agent user both all any if then than not no do does did done can could will would may might
    must have has had before after instead then only every each other another same want wants wanted wish like
    please help need needs you your my me i we our us they them he she his her order orders item items thing
    things one ones get got make sure also too very really just about into over more most some such there here
    what which who whom when where why how now really again still even well back""".split()
)

#: Identifier shapes. An id is evidence of *which* record, never of *which product*, so it is stripped before a
#: value is turned into words: `#W2378156` in an address argument would otherwise make every address ask unsettleable.
ID = re.compile(r"#?[A-Za-z]?\d{6,}")

#: A clause boundary. `and`, `but`, `then`, `also` and a bare comma each start a new ask in this corpus —
#: "return the cleaner, headphone, and smart watch" is three asks and one call, which is the case the board exists
#: to keep visible.
CLAUSE = re.compile(r"(?<=[.!?;])\s+|\s*,?\s+(?:and|but|then|also)\s+|,\s*", re.IGNORECASE)

#: Words that end the object phrase inside an ask. After one of these the clause is talking about a condition
#: ("if it is not possible"), a preference ("prefer battery over usb") or a substitute ("for the same one"), and
#: the words beyond it are not the thing being asked for.
BOUNDARY = frozenset(
    """for to instead because if when until but so since prefer preferably rather same compatible""".split()
)

WORD = re.compile(r"[a-z0-9]+")

#: Words that lead into the object rather than naming it: "exchange **the** keyboard", "change the address **to**
#: 123 Main Street". Dropped before the phrase is read, so the first word of an ask is a thing.
LEAD = frozenset("""to for the a an my your it its this that at in on with""".split())

#: A clause that starts with one of these is a modifier of the ask before it ("... but with clicky switches",
#: "... to purple, same size", "prefer polyester"), not a new object. Kept only when the clause carries its own cue,
#: because "only exchange the desk lamp" is an ask and "with clicky switches" is not.
CONTINUATION = frozenset(
    """with without instead prefer preferably only if when unless rather same at on in to for then so because
    since until but and or also""".split()
)

#: The address family keeps the prepositions the other families stop at, because the value it is asked for is a
#: place and "to"/"in"/"at" are part of how the place is named.
ADDRESS_BOUNDARY = frozenset(BOUNDARY - {"to", "in"})


def words_of(text: str) -> list[str]:
    """The content words of a phrase, in order, deduplicated.

    Two, not three characters: `tv` and `ac` are products in this catalogue, and a floor of three silently made
    them unnameable — the same defect the debit reader's word floor had (AUDIT 34.212). Pure numbers and identifiers
    are dropped because they name a record rather than a thing.
    """
    if not isinstance(text, str):
        return []
    found = []
    for word in WORD.findall(text.lower()):
        if len(word) < 2 or word in STOP or word.isdigit():
            continue
        if word not in found:
            found.append(word)
    return found


def family_of(text: str) -> str:
    """The family an ask is written in, or `""` when the clause names no action."""
    if not isinstance(text, str):
        return ""
    lowered = text.lower()
    for family, pattern in CUES:
        if re.search(pattern, lowered):
            return family
    return ""


def items_of(text: str) -> list[dict]:
    """The asks in a user message: one item per object phrase, in the order they were stated.

    A clause inherits the family of the clause before it **within the same sentence**, which is what makes "the
    smart thermostat for one compatible with Google Home" an exchange rather than a fragment. Inheritance stops at
    the sentence because the next sentence is where this corpus changes the subject ("If not possible, you are
    angry") and an inherited family there manufactures asks nobody made.
    """
    if not isinstance(text, str) or not text.strip():
        return []
    found: list[dict] = []
    for sentence in re.split(r"(?<=[.!?])\s+|;\s*", text):
        family = ""
        sentence_items: list[dict] = []
        for clause in CLAUSE.split(sentence):
            clause = (clause or "").strip()
            if not clause:
                continue
            named = family_of(clause)
            if named and _negated(clause, named):
                # "do not exchange anything" is not an ask to exchange. Dropping it is the conservative reading:
                # a board that lists a forbidden action as pending sends the agent to do what the user refused.
                continue
            if named:
                family = named
            if family == "":
                continue
            if named == "" and _first_word(clause) in CONTINUATION:
                continue
            object_words = _object_words(clause, family)
            # An ask that names no object is still an ask: "cancel the order" is the whole of what some tasks
            # want, and `order` is a stopword because it names a record rather than a thing. It is kept with no
            # words and settled by the family rule below, which is the only rule that can apply to it.
            sentence_items.append({"family": family, "words": object_words, "clause": clause.strip(" .!?;,")[:120]})
        # A verb whose objects arrived in the clauses after it — "I want to return, the lamp, the chair" — leaves a
        # wordless ask in front of the ones that name the objects. Settled by family, it would be ticked by the
        # first receipt and report a change to nothing, so it is dropped whenever the sentence named an object of
        # the same family. `cancel the order` keeps its wordless ask because nothing follows it.
        named = {item["family"] for item in sentence_items if item["words"]}
        found.extend(item for item in sentence_items if item["words"] or item["family"] not in named)
    # Two clauses that yield the same family and the same words are one ask: a user who says "return the lamp and
    # return the lamp" has not asked twice, and a board that lists it twice spends a line saying nothing.
    return _folded(found)


def _first_word(clause: str) -> str:
    found = WORD.findall(clause.lower())
    return found[0] if found else ""


def _negated(clause: str, family: str) -> bool:
    """Whether the family's own cue is negated: "do not exchange", "don't return", "never cancel"."""
    pattern = pattern_for(family)
    match = re.search(pattern, clause.lower()) if pattern else None
    if match is None:
        return False
    before = clause.lower()[max(0, match.start() - 14) : match.start()]
    return bool(re.search(r"(\bnot\b|n't|\bnever\b)\s*\w*\s*$", before))


def _folded(items: list) -> list:
    """One ask per object: a clause that repeats an ask already listed is dropped.

    Equality only, and deliberately: folding a *shorter* statement of a longer one — dropping "the thermostat"
    because "the smart thermostat" is already listed — reads well and costs objects. The census measured it at ten
    required objects across the 114 tasks (79.6% recall against 75.2%), because a comma list of products folds into
    the first one whenever the products share a word. A board that misses an object is the defect this whole lane
    exists to remove, so the repeat is what gets folded and the near-repeat is not.
    """
    unique: list[dict] = []
    seen: set = set()
    for item in items:
        key = (item["family"], tuple(item["words"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def pattern_for(family: str) -> str:
    """The cue pattern a family is recognised by, so the parser can cut the clause where the ask begins."""
    for name, pattern in CUES:
        if name == family:
            return pattern
    return ""


def _object_words(clause: str, family: str = "") -> list[str]:
    """The words of the thing asked for: what follows the verb, up to the first conditional or preference.

    Cutting at the verb is what keeps "I want to exchange the keyboard" from being read as an ask about *wanting*:
    the words before the cue describe the user, the words after it name the object. An address keeps its
    prepositions — "change the address **to** 123 Main Street" is one value — which is why the boundary set is
    per-family rather than global.
    """
    lowered = clause.lower()
    pattern = pattern_for(family)
    match = re.search(pattern, lowered) if pattern else None
    tokens = WORD.findall(lowered[match.end():] if match else lowered)
    while tokens and tokens[0] in LEAD:
        tokens.pop(0)
    boundary = ADDRESS_BOUNDARY if family == "address" else BOUNDARY
    kept: list[str] = []
    for word in tokens:
        if word in boundary:
            break
        kept.append(word)
    return words_of(" ".join(kept))


def messages_of(document) -> list:
    """The message list of a simulation, a document holding one, or a bare list."""
    if isinstance(document, list):
        return document
    if isinstance(document, dict):
        messages = document.get("messages")
        return messages if isinstance(messages, list) else []
    messages = getattr(document, "messages", None)
    return messages if isinstance(messages, list) else []


def _field(message, name: str):
    """One field of a message, in whichever of the three shapes it arrives.

    A τ² message is a pydantic model, a transcript read back from a document is a dict, and the agent's own
    self-check threads `(role, content)` tuples because the wrapper only ever reads those two fields. All three are
    the same message, and a parser that read one of them would be a parser that works on the paid run and not in
    the suite that proves it.
    """
    if isinstance(message, dict):
        return message.get(name)
    if isinstance(message, tuple) and len(message) == 2:
        if name == "role":
            return message[0]
        return message[1] if name == "content" else None
    return getattr(message, name, None)


def role_of(message) -> str:
    return str(_field(message, "role") or "").lower()


def _walk(node, found: list) -> None:
    """Collect every `{item_id, name}` pair in a tool result, at any depth.

    The results are τ²'s pydantic models serialised whole: an order holds items, an item holds an id and a name,
    and an exchange result holds the *new* order with the new items. A recursive walk is what makes the same rule
    read all three without a schema per tool.
    """
    if isinstance(node, dict):
        item_id = node.get("item_id")
        name = node.get("name")
        if isinstance(item_id, str) and isinstance(name, str) and name.strip():
            found.append((item_id, name))
        for value in node.values():
            _walk(value, found)
    elif isinstance(node, list):
        for value in node:
            _walk(value, found)


def name_table(messages) -> dict:
    """`item_id -> product name`, as the episode's own tool results proved it.

    Built from reads as well as writes, in the order they arrived, because the id an exchange touches is named by
    the `get_order_details` that preceded it and nothing in the write result has to repeat the name.
    """
    table: dict[str, str] = {}
    for message in messages:
        if role_of(message) != "tool":
            continue
        content = _field(message, "content")
        if not isinstance(content, str) or "item_id" not in content:
            continue
        try:
            parsed = json.loads(content)
        except (TypeError, ValueError):
            continue
        found: list = []
        _walk(parsed, found)
        for item_id, name in found:
            table.setdefault(item_id, name)
    return table


def _id_values(value, found: list) -> None:
    """Every identifier-shaped string in a tool call's arguments, at any depth."""
    if isinstance(value, str):
        if ID.fullmatch(value.strip()):
            found.append(value.strip())
    elif isinstance(value, (list, tuple)):
        for entry in value:
            _id_values(entry, found)
    elif isinstance(value, dict):
        for entry in value.values():
            _id_values(entry, found)


def _free_text(value, found: list) -> None:
    """Every argument string that is not an identifier, which is what an address change proves itself with."""
    if isinstance(value, str):
        stripped = ID.sub(" ", value)
        if words_of(stripped):
            found.append(stripped)
    elif isinstance(value, (list, tuple)):
        for entry in value:
            _free_text(entry, found)
    elif isinstance(value, dict):
        for entry in value.values():
            _free_text(entry, found)


def receipts_of(messages) -> list[dict]:
    """The state-changing calls, each with whether it succeeded and the product names it touched.

    Pairing is positional: τ² runs the calls of one assistant message in order and answers each with one tool
    message, so the k-th call is answered by the k-th result. A result that carries `error: true` is a call that
    changed nothing, and crediting it would make the board say "done" about a change the environment refused.
    """
    calls: list[dict] = []
    results: list[dict] = []
    for message in messages:
        role = role_of(message)
        if role in ("assistant", "agent"):
            for call in _field(message, "tool_calls") or []:
                name = _field(call, "name")
                if not isinstance(name, str) or name not in FAMILIES:
                    continue
                arguments = _field(call, "arguments")
                ids: list = []
                free: list = []
                _id_values(arguments, ids)
                _free_text(arguments, free)
                calls.append(
                    {
                        "name": name,
                        "family": FAMILIES[name],
                        "ids": ids,
                        "free": free,
                    }
                )
        elif role == "tool":
            results.append(
                {
                    "ok": _field(message, "error") is not True,
                    "content": _field(message, "content") or "",
                }
            )
    receipts: list[dict] = []
    for index, call in enumerate(calls):
        # A call with no result is not a receipt: the episode ended, the tool raised, or the message was dropped, and
        # in every one of those the environment changed nothing this document can show.
        ok = False
        if index < len(results):
            ok = bool(results[index]["ok"]) and "error" not in str(results[index]["content"]).lower()[:40]
        receipts.append({**call, "ok": ok})
    return receipts


def settles(item: dict, receipt: dict, table: dict) -> bool:
    """Whether this receipt proves *this* ask was performed by name.

    Containment runs in both directions, because the two sides abbreviate differently: a user says "the keyboard"
    about a **Mechanical Keyboard**, and a user says "the mechanical keyboard" about a product the catalogue calls
    **Keyboard**. What is refused is the case the board exists to refuse — a receipt that names a *different*
    product than the ask does — and containment is what makes that refusal computable without a catalogue.

    An ask that names no object cannot be settled here; it is settled by family in `board_of`, one receipt per ask.
    """
    if not receipt.get("ok") or receipt.get("family") != item.get("family"):
        return False
    words = set(item.get("words") or ())
    if not words:
        return False
    named = [table[identifier] for identifier in receipt.get("ids") or [] if identifier in table]
    if named:
        for name in named:
            name_words = set(words_of(name))
            if name_words and (name_words <= words or words <= name_words):
                return True
        return False
    # The free-text branch runs the other way round: an ask's words have to be spelled by the receipt, because a
    # receipt that names a place or a value names it in full, and a superset is a receipt about this ask.
    free = set()
    for text in receipt.get("free") or []:
        free.update(words_of(text))
    return bool(words) and words <= free


def board_of(messages) -> dict:
    """The board: the asks seen so far, each with the receipt that settled it or `None`.

    Items come from the user's messages and receipts from the agent's, and both are recomputed from the message
    list on every turn. That is what makes this working memory rather than a note: the board the agent reads at
    turn nine is the board turn nine's receipts support, not the board the first turn wrote.
    """
    items: list[dict] = []
    for message in messages:
        if role_of(message) in ("user", "human"):
            content = _field(message, "content")
            if isinstance(content, str):
                items.extend(items_of(content))
    unique = _folded(items)
    table = name_table(messages)
    receipts = receipts_of(messages)
    settled: dict = {}
    unattributed: list[dict] = []
    for receipt in receipts:
        hit = False
        for index, item in enumerate(unique):
            if index in settled:
                continue
            if settles(item, receipt, table):
                settled[index] = receipt
                hit = True
        if not hit:
            # An ask that names no object ("cancel the order") is settled by the first receipt of its family and
            # by nothing else: there is no product to contain, and the alternative — leaving it open for ever —
            # would have the board tell the agent to cancel an order it has already cancelled.
            for index, item in enumerate(unique):
                if index in settled or item["words"]:
                    continue
                if item["family"] == receipt["family"] and receipt.get("ok"):
                    settled[index] = receipt
                    hit = True
                    break
        if not hit:
            # A receipt that settles nothing is either a change nobody asked for or a change this board could not
            # attribute. Both are worth a line: the first is the agent inventing work, the second is the board's
            # own limit, and a reader who cannot tell them apart would read a limit as a result.
            unattributed.append(receipt)
    return {
        "items": [
            {**item, "settled_by": (settled.get(index) or {}).get("name")} for index, item in enumerate(unique)
        ],
        "unattributed": [{"name": receipt["name"]} for receipt in unattributed],
        "receipts": len(receipts),
        "names": len(table),
    }


def render(board: dict) -> str:
    """The block the agent reads: the asks, the ones a receipt settled, and what could not be attributed.

    Written as a status list rather than as advice, because the thing being measured is whether *state* helps. An
    instruction ("remember to finish everything") would be the lesson channel wearing a list, and R212/R213 have
    already priced that.
    """
    items = board.get("items") or []
    if not items:
        return ""
    lines = ["Open asks from the request — a line is ticked only when a tool receipt names it:"]
    for item in items[:MAX_ITEMS]:
        mark = "x" if item.get("settled_by") else " "
        lines.append(f"[{mark}] {item['family']}: {' '.join(item['words'][:8])}")
    hidden = len(items) - MAX_ITEMS
    if hidden > 0:
        lines.append(f"… and {hidden} more ask(s) not shown")
    unattributed = board.get("unattributed") or []
    if unattributed:
        names = sorted({entry["name"] for entry in unattributed})
        lines.append(f"Not attributed to any ask: {len(unattributed)} call(s) — {', '.join(names[:3])}")
    body = "\n".join(lines)
    if len(body) > BOARD_MAX_CHARS:
        body = body[: BOARD_MAX_CHARS - 1].rstrip() + "…"
    return body


def board_body(messages) -> str:
    """The rendered board for a message list, or `""` when the request has stated no ask yet."""
    return render(board_of(messages))


def census(document: dict, wanted=None) -> dict:
    """How much of the evaluator's own list of required changes the extractor finds, and what it charges for it.

    The unit is the **object**, not the call: a return of three items is one call and three asks, and a census that
    counted calls would report two spurious asks for a board that was exactly right. Each required write is weighted
    by the number of order items it touches, and `found` is the number of those objects the board has an ask for, in
    the same family, counted one-for-one. `spurious` is the asks no required object of that family can account for —
    the price of the parser, and the number that decides how much of the block is noise.

    This is an **upper bound** and is documented as one: it runs over `reason_for_call`, the text the user simulator
    was given, while the board at run time reads the simulator's paraphrase. The paid run is what measures the real
    thing, and the artefact carries the counters it is measured by.
    """
    wanted = set(wanted) if wanted else None
    found = required = 0
    spurious = 0
    per_family: dict = {}
    covered = 0
    tasks = 0
    family_required = family_found = 0
    for task in document.get("tasks") or []:
        if wanted is not None and str(task.get("id")) not in wanted:
            continue
        tasks += 1
        counts: dict = {}
        for item in items_of(task.get("reason") or ""):
            counts[item["family"]] = counts.get(item["family"], 0) + 1
        writes: list[dict] = []
        for entry in task.get("writes") or []:
            if isinstance(entry, str):
                writes.append({"name": entry, "objects": 1})
            else:
                writes.append({"name": entry.get("name") or "", "objects": int(entry.get("objects") or 1)})
        objects = [(FAMILIES.get(entry["name"]), entry["objects"]) for entry in writes if FAMILIES.get(entry["name"])]
        required += sum(count for _family, count in objects)
        matched = 0
        for family, count in objects:
            available = counts.get(family, 0)
            take = min(available, count)
            found += take
            matched += take
            counts[family] = available - take
            bucket = per_family.setdefault(family, {"required": 0, "found": 0, "asks": 0})
            bucket["required"] += count
            bucket["found"] += take
            bucket["asks"] += 1 if available > 0 else 0
            family_required += 1
            family_found += 1 if available > 0 else 0
        covered += 1 if matched == sum(count for _family, count in objects) else 0
        spurious += sum(counts.values())
    return {
        "tasks": tasks,
        "required": required,
        "found": found,
        "recall": (found / required) if required else None,
        "spurious": spurious,
        "precision": (found / (found + spurious)) if (found + spurious) else None,
        "asksPerTask": ((found + spurious) / tasks) if tasks else None,
        "tasksCovered": covered,
        # The family reading is the second half of the same question and the one a set-phrased ask is measured
        # fairly by: "modify all your pending tshirts" is one ask covering two order items, so an object count
        # charges the board for a request the user stated as a set. Both numbers are reported; the gate holds both.
        "familyRequired": family_required,
        "familyFound": family_found,
        "familyRecall": (family_found / family_required) if family_required else None,
        "perFamily": per_family,
    }


def _task_key(task: str):
    """Tasks sort numerically when they are numbers, which every τ² id is, and lexically when they are not."""
    return (0, int(task)) if str(task).isdigit() else (1, str(task))


def compare_of(control: dict, treatment: dict) -> dict:
    """The paired reading: of the tasks one attempt each, how many the board turned over.

    Paired by task and by nothing else, because both arms ran the same task in the same world at the same seed —
    the two documents are the two answers to one question, and a difference of two independent rates would throw
    away the pairing that makes a 114-task grid able to resolve nine points.

    Three numbers, and the third is why this is a reading rather than a score. `moved` is the discordant count that
    favours the board; `broke` is the discordant count against it; a board that flips five tasks each way has a
    delta of zero and has done a great deal, and a reader who saw only the delta would call it inert. The exact
    test is McNemar's, which conditions on the discordant pairs and is the only test paired binary data supports.
    The interval is Newcombe's for two independent proportions and is quoted as **conservative**: ignoring the
    pairing widens it, so an interval that excludes zero here would exclude it under the paired calculation too.
    """
    from memory_debit import newcombe  # lazy: the arm imports this module every episode and needs no statistics

    left = _attempts_of(control)
    right = _attempts_of(treatment)
    shared = sorted(set(left) & set(right), key=_task_key)
    both = moved = broke = neither = 0
    for task in shared:
        passed_control = left[task] >= 1.0
        passed_board = right[task] >= 1.0
        if passed_control and passed_board:
            both += 1
        elif passed_board:
            moved += 1
        elif passed_control:
            broke += 1
        else:
            neither += 1
    total = len(shared)
    control_rate = (both + broke) / total if total else None
    board_rate = (both + moved) / total if total else None
    return {
        "tasks": total,
        "controlPassed": both + broke,
        "boardPassed": both + moved,
        "controlRate": control_rate,
        "boardRate": board_rate,
        "delta": (board_rate - control_rate) if total else None,
        "both": both,
        "moved": moved,
        "broke": broke,
        "neither": neither,
        "p": mcnemar_exact(moved, broke),
        "ci": newcombe(both + moved, total, both + broke, total),
        "unpaired": len(set(left) ^ set(right)),
    }


def _attempts_of(document: dict) -> dict:
    """The best attempt per task, which on a one-attempt arm is the attempt."""
    from rescue_rate import trials_of  # lazy, for the same reason as `compare_of`'s import

    by_task = trials_of(document)
    return {task: max(trials.values()) for task, trials in by_task.items() if trials}


def mcnemar_exact(moved: int, broke: int) -> float | None:
    """McNemar's exact test: given `moved + broke` discordant pairs, how surprising is this split under a coin.

    The two-sided p is the probability of a split at least as lopsided as the one observed, doubled and capped at
    one — the same shape as `rescue_rate.fisher_two_sided` and for the same reason: the discordant pairs are the
    only ones that carry information about the treatment, and a test that used the concordant ones would be a test
    of the population rather than of the change.
    """
    total = moved + broke
    if total == 0:
        return None
    tail = sum(math.comb(total, index) for index in range(0, min(moved, broke) + 1)) / (2**total)
    return min(1.0, 2 * tail)


def render_comparison(reading: dict) -> str:
    """One paragraph a reader can quote, and the state that decides whether they should."""
    total = reading["tasks"]
    if total == 0:
        return "UNPAIRED: the two arms share no task, so there is nothing to pair"
    delta = reading["delta"]
    p = reading["p"]
    interval = reading["ci"]
    moved, broke = reading["moved"], reading["broke"]
    if p is None:
        state = "NO_MEASUREMENT"
        sentence = "the arms disagree on no task: one attempt per task cannot separate them"
    elif delta >= 0.10 and interval is not None and interval[0] > 0:
        state = "BOARD_UP"
        sentence = "the board clears the bar and the interval excludes zero"
    elif delta <= -0.10 and interval is not None and interval[1] < 0:
        state = "BOARD_DOWN"
        sentence = "the board is worse by the bar's own size, with the interval excluding zero"
    elif p < 0.05:
        state = "MOVED"
        sentence = "real movement, short of the ten-point bar"
    else:
        state = "NO_LIFT"
        sentence = "no movement larger than the grid's noise"
    return (
        f"{state}: control {reading['controlPassed']}/{total} ({reading['controlRate']:.1%}) against board "
        f"{reading['boardPassed']}/{total} ({reading['boardRate']:.1%}), delta {100 * delta:+.1f} pp "
        f"[{100 * interval[0]:+.1f}, {100 * interval[1]:+.1f}] pp, McNemar exact p = "
        f"{p if p is None else format(p, '.4f')}; moved {moved}, broke {broke}, held {reading['both']}, "
        f"neither {reading['neither']} — {sentence}"
    )


#: The names of the assertions that failed. A list rather than a counter so the reporting branch is exercised by
#: the suite that reports: a self-test whose failure path is never run is a suite that cannot fail visibly.
FAILED: list = []


def self_test() -> int:
    """Assertions over text a reader can check by eye, and over the shapes tau2 hands over."""
    FAILED.clear()

    def check(name: str, condition: bool) -> None:
        if not condition:
            FAILED.append(name)

    def arm(rewards: dict) -> dict:
        return {
            "simulations": [
                {"task_id": task, "trial": 0, "reward_info": {"reward": value}} for task, value in rewards.items()
            ]
        }

    # Words, and the floor that keeps `tv` nameable.
    check("words keep a two-letter product", "tv" in words_of("the tv"))
    check("words drop a stopword", "the" not in words_of("the tv"))
    check("words drop pure numbers", "1234" not in words_of("order 1234"))
    check("words dedupe", words_of("lamp lamp") == ["lamp"])
    check("words of a non-string", words_of(None) == [])

    # Families.
    check("exchange is a family", family_of("exchange the keyboard") == "exchange")
    check("swap is an exchange", family_of("swap it") == "exchange")
    check("return is a family", family_of("return the lamp") == "return")
    check("refund is a return", family_of("refund it") == "return")
    check("cancel is a family", family_of("cancel the order") == "cancel")
    check("address before modify", family_of("change my address") == "address")
    check("payment is a family", family_of("use another payment") == "payment")
    check("a human is a transfer", family_of("give me a human") == "transfer")
    check("change is a modify", family_of("change the size") == "modify")
    check("no cue is no family", family_of("hello there") == "")

    # Items.
    one = items_of("I want to exchange the mechanical keyboard for clicky switches.")
    check("one ask is one item", len(one) == 1 and one[0]["family"] == "exchange")
    check("the object stops at the substitution", one[0]["words"] == ["mechanical", "keyboard"])
    two = items_of(
        "You received #W2378156 and want to exchange the mechanical keyboard for a clicky one "
        "and the thermostat for a Google Home one."
    )
    check("the second object inherits the family", [item["family"] for item in two] == ["exchange", "exchange"])
    check("both objects are named", [item["words"][0] for item in two] == ["mechanical", "thermostat"])
    three = items_of("I want to return the cleaner, headphone, and smart watch.")
    check("a comma list is three asks", len(three) == 3)
    check("the list keeps its words", [item["words"] for item in three] == [["cleaner"], ["headphone"], ["smart", "watch"]])
    check("inheritance stops at the sentence", items_of("You want to return everything. If not, you are angry.") == [
        {"family": "return", "words": ["everything"], "clause": "You want to return everything"}
    ])
    check("a fragment before the first verb is not an ask", items_of("You received your order #W2378156.") == [])
    check("the same ask twice is one ask", len(items_of("return the lamp and return the lamp")) == 1)
    check("an empty message has no asks", items_of("") == [])
    check("a non-string has no asks", items_of(None) == [])

    # The name table, at depth, from a result that carries ids and names.
    order = {"order_id": "#W2378156", "items": [{"item_id": "1151293680", "name": "Mechanical Keyboard", "price": 1.0}]}
    table = name_table([{"role": "tool", "content": json.dumps(order)}])
    check("a name is read from a nested item", table == {"1151293680": "Mechanical Keyboard"})
    check("a result that is not json is skipped", name_table([{"role": "tool", "content": "no json"}]) == {})
    check("a result without an item id is skipped", name_table([{"role": "tool", "content": '{"a": 1}'}]) == {})
    check("a non-tool message is skipped", name_table([{"role": "user", "content": json.dumps(order)}]) == {})

    # Receipts: pairing, success, and the refusal to credit a failed call.
    messages = [
        {"role": "user", "content": "I want to exchange the keyboard."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"name": "get_order_details", "arguments": {"order_id": "#W2378156"}},
                {
                    "name": "exchange_delivered_order_items",
                    "arguments": {"order_id": "#W2378156", "item_ids": ["1151293680"]},
                },
            ],
        },
        {"role": "tool", "content": json.dumps(order)},
        {"role": "tool", "content": json.dumps({"success": True})},
    ]
    receipts = receipts_of(messages)
    check("a read is not a receipt", [receipt["name"] for receipt in receipts] == ["exchange_delivered_order_items"])
    check("the receipt pair is positional and succeeded", receipts[0]["ok"] is True)
    check("the receipt carries its ids", receipts[0]["ids"] == ["#W2378156", "1151293680"])
    failed = receipts_of(
        [
            {
                "role": "assistant",
                "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W2378156"}}],
            },
            {"role": "tool", "content": "Error: order is delivered", "error": True},
        ]
    )
    check("a failed call is a receipt that did not happen", failed[0]["ok"] is False)
    check("a failed call settles nothing", settles({"family": "cancel", "words": []}, failed[0], {}) is False)

    # Settling: the containment rule and its two refusals.
    board_messages = messages + [
        {"role": "user", "content": "Also exchange the thermostat."},
    ]
    board = board_of(board_messages)
    check("the board holds both asks", len(board["items"]) == 2)
    check("the named ask is settled", board["items"][0]["settled_by"] == "exchange_delivered_order_items")
    check("the unnamed ask is not", board["items"][1]["settled_by"] is None)
    check("the board counts the receipts", board["receipts"] == 1)
    one_exchange = board_of(
        [
            {"role": "user", "content": "exchange the keyboard and the thermostat"},
            {
                "role": "assistant",
                "tool_calls": [{"name": "exchange_delivered_order_items", "arguments": {"item_ids": ["1151293680"]}}],
            },
            {"role": "tool", "content": json.dumps(order)},
        ]
    )
    check("one receipt settles the ask it names", one_exchange["items"][0]["settled_by"] is not None)
    check("one receipt does not settle the ask it does not name", one_exchange["items"][1]["settled_by"] is None)
    unnamed = board_of(
        [
            {"role": "user", "content": "please cancel the pending order for the lamp"},
            {
                "role": "assistant",
                "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W2378156"}}],
            },
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a receipt with no name does not settle an ask it cannot name", unnamed["items"][0]["settled_by"] is None)
    check("and it is reported as unattributed", unnamed["unattributed"] == [{"name": "cancel_pending_order"}])
    faceless = board_of(
        [
            {"role": "user", "content": "cancel the order"},
            {
                "role": "assistant",
                "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W2378156"}}],
            },
            {"role": "tool", "content": "ok"},
        ]
    )
    check("an ask that names nothing is settled by its family", faceless["items"][0]["settled_by"] == "cancel_pending_order")
    check("and it is not counted as unattributed", faceless["unattributed"] == [])
    address = board_of(
        [
            {"role": "user", "content": "Please change the address to 123 Main Street Chicago"},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "name": "modify_user_address",
                        "arguments": {"user_id": "u1", "address1": "123 Main Street", "city": "Chicago"},
                    }
                ],
            },
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a free-text receipt settles an ask with no ids", address["items"][0]["settled_by"] == "modify_user_address")
    # A comma inside an address is a clause boundary, so the value arrives as two asks — and the receipt spells
    # both, so both settle. The case is pinned because the split is a property of the parser a reader should be
    # able to see rather than a surprise to be discovered in a reading.
    address_comma = board_of(
        [
            {"role": "user", "content": "Please change the address to 123 Main Street, Chicago"},
            {
                "role": "assistant",
                "tool_calls": [{"name": "modify_user_address", "arguments": {"address1": "123 Main Street Chicago"}}],
            },
            {"role": "tool", "content": "ok"},
        ]
    )
    check("an address stated with a comma is two asks", len(address_comma["items"]) == 2)
    check("and one change settles both halves", all(item["settled_by"] for item in address_comma["items"]))
    check("and nothing is left unattributed", address_comma["unattributed"] == [])
    mismatch = board_of(
        [
            {"role": "user", "content": "change the address to 9 Oak Avenue"},
            {
                "role": "assistant",
                "tool_calls": [{"name": "modify_user_address", "arguments": {"address1": "123 Main Street"}}],
            },
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a free-text receipt settles nothing it does not spell", mismatch["items"][0]["settled_by"] is None)

    # Rendering: bounded, marked, and empty when there is nothing to say.
    rendered = render(board)
    check("the board names itself", rendered.splitlines()[0].startswith("Open asks"))
    check("a settled ask is ticked", "[x] exchange: keyboard" in rendered)
    check("an open ask is not", "[ ] exchange: thermostat" in rendered)
    check("no asks renders nothing", render({"items": []}) == "")
    many = render({"items": [{"family": "return", "words": ["item"], "settled_by": None}] * (MAX_ITEMS + 2)})
    check("the board bounds its lines", "and 2 more" in many)
    long_board = render({"items": [{"family": "return", "words": ["x" * 200], "settled_by": None}]})
    check("the board bounds its length", len(long_board) <= BOARD_MAX_CHARS)
    check("the unattributed line is bounded", "Not attributed" in render({"items": board["items"], "unattributed": [
        {"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}]}))

    # Message shapes.
    check("a bare list is a message list", len(messages_of(messages)) == 4)
    check("a document holding messages", len(messages_of({"messages": messages})) == 4)
    check("a document without messages is empty", messages_of({"a": 1}) == [])
    check("an object with messages", len(messages_of(type("D", (), {"messages": messages})())) == 4)
    check("an empty board on no messages", board_body([]) == "")

    # Edges the happy path never reaches, each one a shape a real episode produces.
    check("a blank message has no asks", items_of("   ") == [])
    check("a wordless ask before its objects is dropped", [item["words"] for item in items_of("I want to return , , the lamp")] == [["lamp"]])
    check("a wordless ask with nothing after it is kept", items_of("cancel the order")[0]["words"] == [])
    check("a receipt that names nothing cannot settle a named ask", settles({"family": "return", "words": ["lamp"]},
          {"family": "return", "ok": True, "ids": [], "free": []}, {}) is False)
    check("an unknown family has no cue", pattern_for("nope") == "")
    check("a message that is not a dict is read by attribute", _field(type("M", (), {"role": "user"})(), "role") == "user")
    check("a two-tuple is a role and a content", _field(("user", "hi"), "content") == "hi")
    check("a two-tuple has no third field", _field(("user", "hi"), "tool_calls") is None)
    check("a board reads a tuple transcript", board_of([("user", "return the lamp")])["items"][0]["words"] == ["lamp"])
    check("broken json in a result is skipped", name_table([{"role": "tool", "content": '{"item_id": bad}'}]) == {})
    check("a nested argument dict is walked for ids",
          receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
          "arguments": {"body": {"order_id": "#W2378156"}}}]}])[0]["ids"] == ["#W2378156"])
    check("a nested argument dict is walked for free text",
          receipts_of([{"role": "assistant", "tool_calls": [{"name": "modify_user_address",
          "arguments": {"body": {"address1": "9 Oak Avenue"}}}]}])[0]["free"] == ["9 Oak Avenue"])
    check("a call with no result is a receipt that did not happen",
          receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
          "arguments": {"order_id": "#W2378156"}}]}])[0]["ok"] is False)
    check("a tool result that says error is a receipt that did not happen",
          receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {}}]},
                       {"role": "tool", "content": "Error: nope"}])[0]["ok"] is False)
    check("a user message with no content adds no ask", board_of([{"role": "user", "content": None}])["items"] == [])
    repeated = board_of([{"role": "user", "content": "return the lamp"},
                         {"role": "user", "content": "return the lamp"}])
    check("the same ask in two messages is one line", len(repeated["items"]) == 1)

    # The census, on a document small enough to check by hand.
    little = {"tasks": [
        {"id": "0", "reason": "I want to return the lamp.", "writes": [{"name": "return_delivered_order_items",
                                                                        "objects": 1}]},
        {"id": "1", "reason": "I want to exchange the lamp.", "writes": [{"name": "return_delivered_order_items",
                                                                          "objects": 1}]},
        {"id": "2", "reason": "I want to return the lamp and the desk.", "writes": [
            {"name": "return_delivered_order_items", "objects": 3}, "return_delivered_order_items"]},
        {"id": "3", "reason": "hello", "writes": []},
    ]}
    reading = census(little)
    check("the census counts the tasks", reading["tasks"] == 4)
    check("an object is weighted by what the call touches", reading["required"] == 1 + 1 + 3 + 1)
    check("a same-family ask counts once", reading["found"] == 1 + 0 + 2)
    check("the objects the family cannot cover are spurious", reading["spurious"] == 1)
    check("the family reading is over families, not objects", reading["familyRequired"] == 4)
    check("a mentioned family counts", reading["familyFound"] == 2)
    check("a task with every object covered is covered", reading["tasksCovered"] == 2)
    check("a task with no write is neither required nor covered", census({"tasks": [little["tasks"][3]]})["recall"] is None)
    check("a wanted task filters the census", census(little, wanted=["0"])["tasks"] == 1)
    check("a task id may be an int", census({"tasks": [{"id": 7, "reason": "cancel the order", "writes": []}]},
          wanted=["7"])["tasks"] == 1)

    # The pairing states, including the one only a real dispatch produces.
    moved_only = compare_of(arm({str(i): 0 for i in range(8)} | {str(i): 1 for i in range(8, 114)}),
                            arm({str(i): 1 for i in range(114)}))
    check("eight moves in a hundred and fourteen is real but short", render_comparison(moved_only).startswith("MOVED"))
    check("a report of no tasks says unpaired", render_comparison({"tasks": 0}) == "UNPAIRED: the two arms share no task, so there is nothing to pair")

    # The paired reading: the table, the exact test, and the states that decide whether a number may be quoted.
    check("McNemar on no discordant pair says nothing", mcnemar_exact(0, 0) is None)
    check("McNemar on five-and-none", abs(mcnemar_exact(5, 0) - 0.0625) < 1e-9)
    check("McNemar on a balanced split is one", mcnemar_exact(3, 3) == 1.0)
    check("McNemar is capped at one", mcnemar_exact(1, 0) == 1.0)

    balanced = compare_of(arm({"0": 1, "1": 1, "2": 0, "3": 0}), arm({"0": 1, "2": 1, "1": 0, "3": 0}))
    check("the pair table counts both", balanced["both"] == 1)
    check("the pair table counts the move", balanced["moved"] == 1)
    check("the pair table counts the loss", balanced["broke"] == 1)
    check("the pair table counts neither", balanced["neither"] == 1)
    check("a wash has no delta", balanced["delta"] == 0.0)
    check("and reads as no lift", render_comparison(balanced).startswith("NO_LIFT"))
    check("no discordant pair is its own state", render_comparison(compare_of(arm({"0": 1}), arm({"0": 1}))).startswith("NO_MEASUREMENT"))
    three = compare_of(
        arm({str(i): 1 for i in range(100)} | {"100": 0, "101": 0, "102": 0}), arm({str(i): 1 for i in range(103)})
    )
    check("a sweep of three in a hundred and three is three points", abs(three["delta"] - 3 / 103) < 1e-9)
    check("a three-point sweep does not clear the bar", render_comparison(three).startswith("NO_LIFT"))
    floor = {str(i): 0 for i in range(30)}
    up = compare_of(arm(floor | {str(i): 1 for i in range(30, 114)}), arm({str(i): 1 for i in range(114)}))
    check("a sweep of thirty in a hundred and fourteen is the bar", up["delta"] > 0.25)
    check("and reads as the board up", render_comparison(up).startswith("BOARD_UP"))
    down = compare_of(arm({str(i): 1 for i in range(114)}), arm(floor | {str(i): 1 for i in range(30, 114)}))
    check("the sign follows the arms", down["delta"] < 0)
    check("and a drop of the same size reads as down", render_comparison(down).startswith("BOARD_DOWN"))
    check("no shared task is unpaired", render_comparison(compare_of(arm({"0": 1}), arm({"1": 1}))).startswith("UNPAIRED"))
    check("the unpaired count is reported", compare_of(arm({"0": 1}), arm({"1": 1}))["unpaired"] == 2)
    check("a missing best attempt is not a pass", _attempts_of(arm({"0": 0})) == {"0": 0})

    # Handlers the arm never calls but the operator does: the census, the board on a document, and the paired
    # reading from two paths. Exercised through `main` because that is the surface a dispatch uses, and a CLI that
    # is only ever exercised by hand is the part of the lane that breaks without a red build.
    import contextlib
    import io
    import tempfile

    def quiet(argv: list) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return main(argv)

    check("family_of on a non-string is no family", family_of(None) == "")
    check("a message of separators has no asks", items_of(", , .") == [])
    check("an ask that names nothing is not settled by name",
          settles({"family": "cancel", "words": []}, {"family": "cancel", "ok": True, "ids": [], "free": []}, {}) is False)
    two_receipts = board_of([
        {"role": "user", "content": "cancel the order"},
        {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {}},
                                             {"name": "cancel_pending_order", "arguments": {}}]},
        {"role": "tool", "content": "ok"},
        {"role": "tool", "content": "ok"},
    ])
    check("a second receipt of the family finds no ask left", len(two_receipts["unattributed"]) == 1)
    tall = render({"items": [{"family": "return", "words": ["x" * 300], "settled_by": None}] * 3})
    check("three tall lines are cut at the ceiling", len(tall) <= BOARD_MAX_CHARS and tall.endswith("…"))

    with tempfile.TemporaryDirectory() as scratch:
        goals = os.path.join(scratch, "goals.json")
        with open(goals, "w", encoding="utf-8") as handle:
            json.dump(little, handle)
        check("the census runs from the command line", quiet(["--census", "--goals", goals]) == 0)
        check("and reports as json", quiet(["--census", "--goals", goals, "--json"]) == 0)
        messages_path = os.path.join(scratch, "sim.json")
        with open(messages_path, "w", encoding="utf-8") as handle:
            json.dump({"messages": messages}, handle)
        check("a board is printed from a document", quiet(["--messages", messages_path]) == 0)
        with open(messages_path, "w", encoding="utf-8") as handle:
            json.dump({"messages": [{"role": "user", "content": "hello"}]}, handle)
        check("a document with no asks prints the empty notice", quiet(["--messages", messages_path]) == 0)
        check("an ask is printed from a list", quiet(["--messages", messages_path]) in (0,))
        left = os.path.join(scratch, "control.json")
        right = os.path.join(scratch, "board.json")
        with open(left, "w", encoding="utf-8") as handle:
            json.dump(arm({"0": 1, "1": 0, "2": 0}), handle)
        with open(right, "w", encoding="utf-8") as handle:
            json.dump(arm({"0": 1, "1": 1, "2": 0}), handle)
        check("the paired reading runs from two documents", quiet(["--compare", left, right]) == 0)
        check("and reports as json", quiet(["--compare", left, right, "--json"]) == 0)
        directory = os.path.join(scratch, "results")
        os.mkdir(directory)
        with open(os.path.join(directory, "results-2.json"), "w", encoding="utf-8") as handle:
            json.dump(arm({"2": 1}), handle)
        check("a directory of phases is merged before it is read", quiet(["--compare", left, directory]) == 0)
        check("no arguments is the usage exit", quiet([]) == 2)

    # The harness's own negative control, counted and then removed, so the branch that reports a failure is
    # exercised on every green run rather than on the first red one.
    check("negative control (must fail)", False)
    check("the harness counted the control", FAILED.count("negative control (must fail)") == 1)
    FAILED.remove("negative control (must fail)")
    for name in FAILED:
        print(f"FAIL {name}")
    print(f"{len(FAILED)} failure(s)")
    return 1 if FAILED else 0


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="The asks of a request and the receipts that settle them.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--messages", default="", help="a simulation document, or a JSON list of messages")
    parser.add_argument("--goals", default="", help="the census manifest (eval/manifests/retail-goals.json)")
    parser.add_argument("--census", action="store_true")
    parser.add_argument("--compare", nargs=2, default=None, metavar=("CONTROL", "BOARD"),
                        help="two result documents or directories: the paired one-attempt reading")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if arguments.census:
        path = arguments.goals or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manifests", "retail-goals.json"
        )
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
        reading = census(document)
        if arguments.json:
            print(json.dumps(reading, indent=1, sort_keys=True))
        else:
            print(
                f"{reading['found']}/{reading['required']} required objects have an ask of their family "
                f"({reading['recall']:.1%}); {reading['familyFound']}/{reading['familyRequired']} required families "
                f"are mentioned ({reading['familyRecall']:.1%}); {reading['spurious']} spurious ask(s), "
                f"precision {reading['precision']:.1%}, {reading['tasksCovered']}/{reading['tasks']} tasks fully covered"
            )
            for family, bucket in sorted(reading["perFamily"].items()):
                print(f"  {family:9s} {bucket['found']}/{bucket['required']} objects, {bucket['asks']} task(s)")
        return 0
    if arguments.compare:
        from rescue_rate import documents_of, merge  # lazy, for the same reason as `compare_of`'s import

        documents = []
        for path in arguments.compare:
            directories = [Path(path)] if Path(path).is_dir() else []
            if directories:
                documents.append(merge(documents_of(directories[0])))
            else:
                with open(path, "r", encoding="utf-8") as handle:
                    documents.append(json.load(handle))
        reading = compare_of(documents[0], documents[1])
        if arguments.json:
            print(json.dumps(reading, indent=1, sort_keys=True))
        else:
            print(render_comparison(reading))
        return 0
    if arguments.messages:
        with open(arguments.messages, "r", encoding="utf-8") as handle:
            document = json.load(handle)
        body = board_body(messages_of(document))
        print(body if body else "(no asks)")
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
