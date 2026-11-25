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

## The contract, and the three readings

R214 built this as a transcript reader and measured two defects at once: the board grew to **10.6 asks** an episode
against the **1.58** a request states, and because its text changed on nearly every turn the provider's prefix cache
fell from 90.4% to 75.1% and the bill rose 77% for a 200-character block. A list that moves every turn is not
cheap because it is small; it is expensive because it moves (PROGRESS 244.3).

So the unit is a **contract** rather than a transcript:

    items        the asks the *request* states — the first thing the user says — a family (exchange, return,
                 cancel, modify, address, payment, transfer) and the content words that name the object. Later
                 turns are clarifications: they refine a clause this parser cannot identify, and a parser that
                 cannot tell which clause a "yes" refines must not add one
    receipts     the state-changing calls that succeeded, with the names of the items they touched, read from the
                 tool results the episode already carries
    settled      an item and a receipt of the same family whose touched item *name* is contained in the item's own
                 words

The contract is what makes this a checker rather than a renderer: the text the board is checked against is fixed
before the first call, so the board's content can only move when a receipt moves it — a handful of times an
episode, not twenty-five. `scope="conversation"` still reads every user turn, and R214's numbers are reproduced by
it; it is kept so the two readings can be subtracted rather than argued about.

The refusal is the design: **an item is never marked done because something of the same kind happened.** Two
exchanges in one order, one performed, is the shape this benchmark fails on, and a board that reports "exchange:
done" after the first is a board that removes the agent's reason to look — the harm channel R213 measured at 8.5%
of met requirements. So a receipt settles an item only when the product it names is named by the ask, and a receipt
that settles nothing is reported as one of two different things:

    unrequested  the request never stated an ask of this family — the agent did work nobody asked for, which is
                 the failure τ² charges for, and the line the board exists to make visible
    unattributed the family was asked for, and this board could not name what the receipt touched — the parser's
                 own limit, not the agent's mistake

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

#: The schema travels into the artefact so a reading names the shape it was taken from. `/2` is the contract: R214's
#: `/1` read every user turn and moved on each of them. `/3` is the set ask: an ask whose words name no product in
#: the episode's own name table is settled by family and **absorbs** the later receipts of that family, because
#: "return everything from my two most recent orders" is one ask over four products and no containment rule can
#: ever satisfy it (AUDIT 34.225).
SCHEMA = "microglia.goal-board/3"

#: Where the asks come from. `REQUEST` is the product's reading and the one R215 registers: the first user message,
#: fixed before the first call, so the block a turn carries can only change when a receipt changes it. `CONVERSATION`
#: is R214's reading, kept because a subtraction between the two is how this round prices its own fix.
REQUEST = "request"
CONVERSATION = "conversation"

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

#: The words that make an ask a **set**: it asks for all of something, so one call is the start of it and not the
#: end. Read from the request's own vocabulary rather than from a list of products, because a set phrase is exactly
#: the ask whose objects the parser cannot enumerate — "return everything from my two most recent orders" names no
#: product at all, and R215 spent a dispatch calling those receipts unattributed (AUDIT 34.225).
#: The weaker of the two settlement grades: a shared content word and half of the shorter side. Half is a
#: measurement rather than a taste — every one of R215's 28 refused successes shared exactly one word, and in all of
#: them that word was half of the product's name ("Hiking Boots" against "boots", "Smart Watch" against "watch").
#: A quarter would tick a lamp for a lamp, and containment (1.0) is the grade that missed them.
OVERLAP = 0.5

#: The words that make an ask a **set**: it asks for all of something, so one call is the start of it and not the
#: end. Read from the request's own vocabulary rather than from a list of products, because a set phrase is exactly
#: the ask whose objects the parser cannot enumerate — "return everything from my two most recent orders" names no
#: product at all, and R215 spent a dispatch calling those receipts unattributed (AUDIT 34.225).
QUANTIFIERS = frozenset(
    """everything anything all both each every whole entire rest remaining others some any""".split()
)


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


#: A refusal in front of the verb it refuses. Three words of room, because this corpus writes "I don't **want to**
#: return" more often than "don't return", and a detector that only saw the contracted form let every one of them
#: through as a live ask — a board telling the agent to do what the user ruled out.
NEGATION = re.compile(r"(\bnot\b|n't|\bnever\b)(?P<between>(?:\s+\w+){0,3})\s*$")

#: Determiners that turn the cue from a verb into a noun: "if the agent doesn't allow **the** exchange" is a
#: conditional about an exchange, not a refusal of one, and reading it as a refusal cost a required ask on task 107.
NOMINAL = frozenset("the a an my your his her its this that these those".split())


def _negated(clause: str, family: str) -> bool:
    """Whether the family's own cue is negated: "do not exchange", "don't return", "never cancel"."""
    pattern = pattern_for(family)
    match = re.search(pattern, clause.lower()) if pattern else None
    if match is None:
        return False
    before = clause.lower()[max(0, match.start() - 32) : match.start()]
    found = NEGATION.search(before)
    if found is None:
        return False
    between = found.group("between").split()
    # "not only return it, but exchange it" refuses nothing: the correlative is a list of two asks, and reading it
    # as a refusal would drop both. A determiner between the negation and the cue makes the cue a noun
    # ("doesn't allow the exchange"), which is a condition about the ask rather than a refusal of it.
    return "only" not in between and not (NOMINAL & set(between))


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


def grade_of(name_words: set, words: set) -> str:
    """The grade of a match between a product's name and an ask's words: `"name"`, `"overlap"`, or `""`.

    One function for both callers, because `settles` and `names_a_product` have to agree: if the board can tick an
    ask it does not consider to name a product, then the same ask is both settled and a set, and the two rules would
    fight over it in the order the loop happens to run.
    """
    if not name_words or not words:
        return ""
    if name_words <= words or words <= name_words:
        return "name"
    if len(name_words & words) / min(len(name_words), len(words)) >= OVERLAP:
        return "overlap"
    return ""


def settlement(item: dict, receipt: dict, table: dict) -> str:
    """How strongly this receipt proves this ask was performed: `"name"`, `"overlap"`, or `""` for no.

    Two grades, because the corpus has two kinds of match and calling them one made R215 refuse 28 of its own
    successes. The evidence is in its artefact (PROGRESS 245.3, re-read before R216 was dispatched):

        ask `specifically boots ordered`   receipt names **Hiking Boots**      one word short of containment
        ask `watch received`               receipt names **Smart Watch**        one word short either way
        ask `gaming related purchased`     receipt names **Gaming Mouse**       one word short

    Containment — one word set inside the other — is the **strict** grade and it is unchanged: a receipt that names a
    product the ask names in full is a settlement, and it is what every tick in R214/R215 was. The second grade is
    **overlap**: at least one content word in common and at least half of the shorter side. That is what these three
    cases are, and it is deliberately weaker than containment, so the board pays for it in honesty: every settlement
    of this grade is counted (`loose`), the count travels into the artefact, and a reading whose ticks are mostly
    loose is a reading about a looser rule than the one that was registered.

    The refusal is unchanged for the case the board exists to refuse — a receipt that names a *different* product.
    "Desk Lamp" against "Table Lamp" is now a tick where it used to be a refusal, and that is the price of the 28;
    it is stated here because the alternative was a board that could not see three quarters of its own successes.
    """
    if not receipt.get("ok") or receipt.get("family") != item.get("family"):
        return ""
    words = set(item.get("words") or ())
    if not words:
        return ""
    named = [table[identifier] for identifier in receipt.get("ids") or [] if identifier in table]
    if named:
        grade = ""
        for name in named:
            found = grade_of(set(words_of(name)), words)
            if found == "name":
                return "name"
            grade = grade or found
        return grade
    # The free-text branch runs the other way round: an ask's words have to be spelled by the receipt, because a
    # receipt that names a place or a value names it in full, and a superset is a receipt about this ask.
    free = set()
    for text in receipt.get("free") or []:
        free.update(words_of(text))
    return "name" if words <= free else ""


def settles(item: dict, receipt: dict, table: dict) -> bool:
    """Whether this receipt proves this ask was performed by name, at either grade.

    An ask that names no object cannot be settled here; it is settled by family in `board_of`, one receipt per ask.
    """
    return settlement(item, receipt, table) != ""


def names_a_product(item: dict, table: dict) -> bool:
    """Whether this ask names a product the episode has already seen.

    The test is the containment rule of `settles` run against the name table instead of against one receipt, and it
    is what separates the two kinds of ask τ² retail actually contains:

        "return the mechanical keyboard"                    names a product  → settled by that product, or by nothing
        "return everything from my two most recent orders"  names no product → settled by family, absorbs its receipts

    The distinction has to be drawn against the *episode's* table rather than a catalogue, because the board never
    has a catalogue: a name the episode has not yet read is a name it cannot match. R215 shipped without this test and
    reported 73% of its writes as unattributed or unrequested (AUDIT 34.225) — the set phrase had no rule, because
    the only rule asked a set phrase to contain a product name.
    """
    words = set(item.get("words") or ())
    if not words:
        return False
    return any(grade_of(set(words_of(name)), words) for name in table.values())


def settles_by_family(item: dict, table: dict) -> bool:
    """Whether this ask is one no receipt can name, so its family's first successful call is its settlement.

    Two conditions, and the second is the one R216 had to learn from its own artefact:

    * **the ask names no product the episode has read.** An ask that names one is settled by that product or by
      nothing — that is the refusal `settles` exists for, and it is unchanged.
    * **an ask with words needs a catalogue to be judged nameless.** An empty table means the board has nothing to
      search, so it cannot tell a set phrase from a mis-parsed one, and a rule that fired there would tick "cancel the
      pending order for the lamp" on the strength of any cancel — the over-credit R215 was right to refuse. With one
      order read, the same ask is *matched* against the lamp it names (at overlap grade) and refused for the right
      reason. A **wordless** ask needs no catalogue: there is nothing to look for.

    Under those two conditions the shapes that arrive are all of one kind: order-level ("cancel the order"), set
    ("return everything from my two most recent orders"), and account-level ("the address is wrong", "split the
    payment between two cards"), where the receipt carries no item id at all and a name match is meaningless. The
    measurement that produced this rule is in PROGRESS 245.3 and was taken **before** this round's dispatch: of
    R215's 107 writing episodes, 29 failed on a family that had asked and 29 on an object the board could not name,
    and the account families are most of the second group.
    """
    words = set(item.get("words") or ())
    if not words:
        # "Cancel the order" names a container. There is no product to look for, so no catalogue is needed to know
        # that the family is the only evidence available.
        return True
    if not table:
        return False
    return not names_a_product(item, table)


def absorbs_receipts(item: dict, table: dict) -> bool:
    """Whether later calls of this ask's family belong to it.

    Only a **set** ask absorbs: it asked for all of something, so the second, third and fourth call are the same ask
    being performed. An order-level ask does not — "cancel the order" twice is a duplicate, and a board that absorbed
    the second would hide the only anomaly that shape can produce.
    """
    return settles_by_family(item, table) and bool(set(item.get("words") or ()) & QUANTIFIERS)


def request_of(messages) -> str:
    """The request: the first thing the user said, and the only text the asks are read from.

    In τ² the first user turn is the request and every later turn is the simulator answering a question the agent
    asked — "yes, the blue one", "no, only the lamp", "I'd rather have a refund". Those sentences name objects and
    follow verbs, so a parser that read them listed **10.6** asks an episode where the request states **1.58**
    (PROGRESS 244.2), and a board of eleven lines with one tick is not a working memory.

    **R216 seals the contract at the first user turn that yields an ask, not at the first user turn.** The two are
    the same message in most episodes and they are not in 14 of R215's 107 writing episodes, where the request opens
    with a greeting ("hi, I need help with a couple of orders") and the asks arrive in the second sentence the user
    says. A contract sealed on the greeting is empty, and an empty contract calls every one of the episode's changes
    *unrequested* — the board's most damning line, printed at an agent that was doing what it was told.

    The growth defect is not re-opened by this, and the distinction is the whole of R215's finding: a rule that stops
    at the first productive turn takes **one** message, and a rule that reads every turn takes twenty-five. What is
    still refused is a clarification: once a turn has yielded an ask, later turns are the agent's answers, not the
    contract.

    `""` when no user has spoken yet, which is a real turn: the agent's first call happens before the user's first
    message in a τ² episode that starts with a greeting, and a board that guessed a request would be inventing one.
    """
    first = ""
    for message in messages:
        if role_of(message) not in ("user", "human"):
            continue
        content = _field(message, "content")
        if not isinstance(content, str) or not content.strip():
            continue
        if not first:
            first = content
        if items_of(content):
            return content
    return first


def board_of(messages, scope: str = REQUEST) -> dict:
    """The board: the asks the contract states, each with the receipt that settled it or `None`.

    Items come from the request and receipts from the agent's calls, and both are recomputed from the message list
    on every turn. That is what makes this working memory rather than a note: the board the agent reads at turn nine
    is the board turn nine's receipts support, not the board the first turn wrote. What it may *not* do is learn new
    asks from turns after the first — see `request_of` and PROGRESS 244.2 for the measurement that rule comes from.
    """
    items: list[dict] = []
    if scope == CONVERSATION:
        for message in messages:
            if role_of(message) in ("user", "human"):
                content = _field(message, "content")
                if isinstance(content, str):
                    items.extend(items_of(content))
    else:
        items.extend(items_of(request_of(messages)))
    unique = _folded(items)
    table = name_table(messages)
    receipts = receipts_of(messages)
    settled: dict = {}
    absorbed: dict = {}
    unrequested: list[dict] = []
    unattributed: list[dict] = []
    # Which asks are ones no receipt can name — order-level and set phrases — so the family rule below is the only
    # rule that can settle them. Computed once, because it depends on the table and not on the receipts, and an ask
    # does not stop being a set when a product with a similar word arrives later.
    sets = {index for index, item in enumerate(unique) if settles_by_family(item, table)}
    absorbing = {index for index, item in enumerate(unique) if absorbs_receipts(item, table)}
    loose = 0
    for receipt in receipts:
        hit = False
        for index, item in enumerate(unique):
            if index in settled:
                continue
            grade = settlement(item, receipt, table)
            if grade:
                settled[index] = receipt
                loose += 1 if grade == "overlap" else 0
                hit = True
        if not hit:
            # An ask that names no product ("cancel the order", "return everything from my two most recent orders")
            # is settled by the first receipt of its family and by nothing else: there is no product to contain, and
            # the alternative — leaving it open for ever — would have the board tell the agent to cancel an order it
            # has already cancelled.
            for index in sorted(sets):
                if index in settled:
                    continue
                if unique[index]["family"] == receipt["family"] and receipt.get("ok"):
                    settled[index] = receipt
                    hit = True
                    break
        if hit:
            continue
        # A receipt that settles nothing is one of two different facts, and a reader who could not tell them apart
        # would read the parser's limit as the agent's mistake. A call the request never asked for is the failure
        # this benchmark charges for and the line worth showing; a call whose object this board could not name (an
        # address change carries no item id) is the same board's blind spot. A call that *failed* changed nothing
        # and is neither: reporting it would put an attempt on a list of state.
        if not receipt.get("ok"):
            continue
        # …and a third fact, which R215 could not express: a receipt that belongs to a **set** ask already settled.
        # Returning four products against "return everything from my two most recent orders" is one ask performed
        # with four calls, not three changes nobody asked for. The receipt is counted against the ask that absorbed
        # it — the count is shown, so a set that grew after the tick is still visible — rather than reported as either
        # failure. Absorbing it is not free: the board is saying "this ask is being worked on", and a run where the
        # absorbed count runs away is a run whose set ask is standing in for several asks the parser never read.
        owner = next(
            (
                index
                for index in sorted(absorbing)
                if unique[index]["family"] == receipt["family"] and index in settled
            ),
            None,
        )
        if owner is not None:
            absorbed[owner] = absorbed.get(owner, 0) + 1
            continue
        family_asked = any(item["family"] == receipt["family"] for item in unique)
        (unattributed if family_asked else unrequested).append(receipt)
    return {
        "scope": REQUEST if scope != CONVERSATION else CONVERSATION,
        "items": [
            {
                **item,
                "settled_by": (settled.get(index) or {}).get("name"),
                "absorbed": absorbed.get(index, 0),
            }
            for index, item in enumerate(unique)
        ],
        "unattributed": [{"name": receipt["name"]} for receipt in unattributed],
        "unrequested": [{"name": receipt["name"]} for receipt in unrequested],
        "absorbed": sum(absorbed.values()),
        # How many of the ticks came from the weaker grade. A reading whose ticks are mostly loose is a reading about
        # a looser rule than the one that was registered, and the number is here so that can be said rather than
        # discovered (see `settlement`).
        "loose": loose,
        "receipts": len(receipts),
        "names": len(table),
    }


def render(board: dict, state_only: bool = False) -> str:
    """The block the agent reads: the asks, the ones a receipt settled, and what could not be attributed.

    Written as a status list rather than as advice, because the thing being measured is whether *state* helps. An
    instruction ("remember to finish everything") would be the lesson channel wearing a list, and R212/R213 have
    already priced that.

    Three lines and two of them are refusals. `Not asked for by the request` is the checker's most useful output: a
    state-changing call the contract never asked for is the failure this benchmark charges for, and it is the one
    thing a transcript cannot make visible without a fixed contract to compare against.

    **R219, and the one thing this function was wrong about.** The two refusal lines are the only part of the block
    that makes a claim about the *request* rather than about the state, and the claim is the parser's, not the
    evaluator's: an entry says a call was unrequested when the parser found no ask of that family, and says it was
    unattributable when the parser could not name the object. `false_accusations` judges both against the evaluator's
    own action list over the episodes R218b already paid for — 456 episodes, 107 tasks with criteria — and **1,808 of
    1,965 entries (92.0%) name a family the task requires a write in**; over the last block of each episode it is
    239 of 277 (86.3%), on 178 episodes. The block tells the agent it did something nobody asked for, on a task where
    somebody did, because the parser missed the ask. A refusal that is wrong nine times in ten is not state and it is
    not a check; it is the lesson channel wearing a list, and the literature already prices that channel at +2.0
    points with an interval that includes zero (Recuris, arXiv 2608.24876) against +23.9 for state.

    `state_only` is therefore the admission rule, kept here as a rendering switch rather than as a second renderer:
    the block admits the asks and their ticks and refuses to admit either refusal. The counters in `board_of` keep
    counting both, because a reading still has to be able to see what the arm did not say.
    """
    items = board.get("items") or []
    unrequested = [] if state_only else (board.get("unrequested") or [])
    unattributed = [] if state_only else (board.get("unattributed") or [])
    if not items and not (unrequested or unattributed):
        return ""
    where = "from the request" if board.get("scope", REQUEST) == REQUEST else "from the conversation"
    # The header promises lines, so it is only printed when there are some: a block that opens "Open asks" and then
    # says nothing about asks is a block a reader has to decode.
    lines = [f"Open asks {where} — a line is ticked only when a tool receipt names it:"] if items else []
    for item in items[:MAX_ITEMS]:
        mark = "x" if item.get("settled_by") else " "
        line = f"[{mark}] {item['family']}: {' '.join(item['words'][:8])}"
        # A set ask that absorbed calls says so, because the count is the only visible difference between "the board
        # credited this ask once" and "this ask is being performed by four calls". A tick with no count is one call;
        # a tick with `+3` is a set, and a reader who wanted to know whether the agent stopped early can tell.
        if item.get("absorbed"):
            line += f" (+{item['absorbed']} call{'s' if item['absorbed'] > 1 else ''})"
        lines.append(line)
    hidden = len(items) - MAX_ITEMS
    if hidden > 0:
        lines.append(f"… and {hidden} more ask(s) not shown")
    if unrequested:
        names = sorted({entry["name"] for entry in unrequested})
        lines.append(f"Not asked for by the request: {len(unrequested)} call(s) — {', '.join(names[:3])}")
    if unattributed:
        names = sorted({entry["name"] for entry in unattributed})
        lines.append(f"Not attributed to any ask: {len(unattributed)} call(s) — {', '.join(names[:3])}")
    body = "\n".join(lines)
    if len(body) > BOARD_MAX_CHARS:
        body = body[: BOARD_MAX_CHARS - 1].rstrip() + "…"
    return body


def board_body(messages, scope: str = REQUEST) -> str:
    """The rendered board for a message list, or `""` when there is nothing to say about it yet."""
    return render(board_of(messages, scope))


def census(document: dict, wanted=None) -> dict:
    """How much of the evaluator's own list of required changes the extractor finds, and what it charges for it.

    The unit is the **object**, not the call: a return of three items is one call and three asks, and a census that
    counted calls would report two spurious asks for a board that was exactly right. Each required write is weighted
    by the number of order items it touches, and `found` is the number of those objects the board has an ask for, in
    the same family, counted one-for-one. `spurious` is the asks no required object of that family can account for —
    the price of the parser, and the number that decides how much of the block is noise.

    This is **the same kind of text the board reads**, and R215 is the round that made that true: the census has
    always parsed `reason_for_call`, one paragraph, while the R214 board parsed every user turn of the episode and
    listed 10.6 asks against the census's 3.8. The board now reads the request and the census reads the request, so
    the two numbers are the same quantity measured on the two texts a simulator moves between. What is still an
    upper bound is the fidelity of that move: the simulator paraphrases, shortens and occasionally drops a clause,
    and the paid run is what measures the result.
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


def replay(document: dict) -> dict:
    """Re-parse a document the arm already produced, and say what the board would have shown at each turn's end.

    The cheapest measurement this lane has and the one it was missing: an artefact from a previous dispatch carries
    every message the episode exchanged, so a parser change can be priced **before** a single call is paid for. R216
    was registered on a set rule that turned out to be worth two settlements in a hundred and seven episodes; running
    this first is what showed the round's real defect was somewhere else (PROGRESS 245.3).

    The counts are episode-level, because the question a reading asks is "did the agent's writes connect to what was
    asked", and a per-ask rate answers a different one. `writing` is the episodes that *attempted* a state change —
    the denominator the registered bar is written over — and `ticked` those where at least one ask ended settled.
    `loose` and `absorbed` travel with it so the reading says which rule produced the ticks, and `unrequested` is
    the checker's own output rather than a defect count: a call of a family the contract never stated is the failure
    this benchmark charges for, and it is the one thing a transcript cannot make visible.

    An episode with no messages is skipped rather than counted as unticked: a document that was truncated mid-grid
    would otherwise report a rate over episodes that never ran.
    """
    writing = ticked = asks = settled = absorbed = loose = unrequested = unattributed = skipped = 0
    for simulation in document.get("simulations") or []:
        messages = simulation.get("messages") or []
        if not messages:
            skipped += 1
            continue
        board = board_of(messages)
        items = board.get("items") or []
        asks += len(items)
        settled += sum(1 for item in items if item.get("settled_by"))
        absorbed += board.get("absorbed") or 0
        loose += board.get("loose") or 0
        unrequested += len(board.get("unrequested") or [])
        unattributed += len(board.get("unattributed") or [])
        if board.get("receipts"):
            writing += 1
            ticked += 1 if any(item.get("settled_by") for item in items) else 0
    return {
        "episodes": len(document.get("simulations") or []),
        "skipped": skipped,
        "writing": writing,
        "ticked": ticked,
        "tickShare": (ticked / writing) if writing else None,
        "asks": asks,
        "settled": settled,
        "settledShare": (settled / asks) if asks else None,
        "absorbed": absorbed,
        "loose": loose,
        "unrequested": unrequested,
        "unattributed": unattributed,
    }


def _required_families(task) -> set:
    """The write families the evaluator requires of a task, read from the evaluator's own action list.

    The block never sees this list — that is the point of using it as ground truth. τ² writes it as
    `evaluation_criteria.actions` in the results document, one entry per call the task is graded on, and the write
    tools among them are exactly the changes the task is about. A task whose document carries no criteria is a task
    this instrument cannot judge, and it returns an empty set rather than a verdict: the alternative is to count
    every refusal on such a task as correct.
    """
    if not isinstance(task, dict):
        return set()
    criteria = task.get("evaluation_criteria") or task.get("criteria") or {}
    actions = criteria.get("actions") if isinstance(criteria, dict) else None
    found = set()
    for action in actions or []:
        name = action.get("name") if isinstance(action, dict) else None
        if isinstance(name, str) and name in FAMILIES:
            found.add(FAMILIES[name])
    return found


def false_accusations(document: dict, whole_episode: bool = False) -> dict:
    """How often the block's two judgment lines are wrong about the task, over a document an arm already produced.

    R219's instrument, and the reason the admission rule exists. The unit is an **entry** — one call the block
    reported as `unrequested` or `unattributed` — counted on every turn the block would have shown it, because the
    question is what the agent *read* rather than what the episode ended with. An entry is false when the family it
    names is a family the evaluator requires a write in: the block is then telling the agent that a required change
    was not asked for, or could not be attributed, on the strength of a parser that missed the ask.

    Nothing here is a model call and nothing is sampled: the document carries the transcripts and the evaluator's
    own list, so the rate is exact for the episodes it covers. What it is *not* is causal — a false accusation is a
    defect in the block's content, and whether it moved an outcome is what the dispatch measures. Keeping the two
    apart is the difference between fixing a lie and claiming a rescue.

    Cost is quadratic in episode length (the board is recomputed per turn, as the arm does), so `whole_episode`
    exists for a document large enough that the per-turn reading is not worth its seconds: it judges the last block
    only, which is the one the count of *episodes* is about.
    """
    tasks = {str(task.get("id")): task for task in document.get("tasks") or []}
    buckets = {"unrequested": {"entries": 0, "false": 0}, "unattributed": {"entries": 0, "false": 0}}
    entries = wrong = judged = episodes = episodes_judged = flagged = 0
    for simulation in document.get("simulations") or []:
        messages = simulation.get("messages") or []
        if not messages:
            continue
        episodes += 1
        required = _required_families(tasks.get(str(simulation.get("task_id"))))
        episodes_judged += 1 if required else 0
        seen = False
        stops = (len(messages),) if whole_episode else range(1, len(messages) + 1)
        for stop in stops:
            board = board_of(messages[:stop])
            for bucket in ("unrequested", "unattributed"):
                for entry in board.get(bucket) or []:
                    entries += 1
                    buckets[bucket]["entries"] += 1
                    if not required:
                        continue
                    judged += 1
                    family = FAMILIES.get(entry.get("name") or "")
                    if family and family in required:
                        wrong += 1
                        buckets[bucket]["false"] += 1
                        seen = True
        if seen:
            flagged += 1
    return {
        "episodes": episodes,
        "entries": entries,
        "judged": judged,
        "false": wrong,
        # `None` rather than `0` when the document carried no criteria: a rate over nothing is the absence-as-zero
        # this lane has now read four times, and a reader who saw `0.0` would take it for a clean block.
        "falseShare": (wrong / judged) if judged else None,
        "episodesFalse": flagged,
        # Over the episodes this document could judge, not over all of them: a task with no criteria contributes a
        # zero that means "not asked" rather than "clean", and that is the absence-as-zero this lane has read four
        # times. `tasksJudged` is the other half of the same sentence.
        "episodesJudged": episodes_judged,
        "episodesFalseShare": (flagged / episodes_judged) if episodes_judged else None,
        "perBucket": buckets,
        "tasksJudged": sum(1 for task in tasks.values() if _required_families(task)),
    }


def _task_key(task: str):
    """Tasks sort numerically when they are numbers, which every τ² id is, and lexically when they are not."""
    return (0, int(task)) if str(task).isdigit() else (1, str(task))


def compare_of(control: dict, treatment: dict, k: int = 1, names: tuple[str, str] = ("control", "board")) -> dict:
    """The paired reading: of the tasks both arms ran, how many the board turned over, at pass^k.

    Paired by task and by nothing else, because both arms ran the same task in the same world at the same seed —
    the two documents are the two answers to one question, and a difference of two independent rates would throw
    away the pairing that makes a 114-task grid able to resolve nine points.

    `k` is the number of attempts a task must survive to count as passed, and it defaults to one because every arm
    before R218b was a one-attempt arm, where "the best attempt" and "the attempt" are the same number. A four-
    attempt arm needs `k = 4` to ask the reliability question, and passing the wrong `k` is not a small error: at
    `k = 1` a four-attempt arm reads its **first** attempt, which is the honest per-attempt estimate, while
    `max(attempts)` — the rule this function used before R218b — would read *best of four*, the opposite end of the
    ladder from `pass^4` and the most flattering of the four readings available. The reading reports the `k` it used
    so a quoted number cannot be re-read as the other one.

    Three numbers, and the third is why this is a reading rather than a score. `moved` is the discordant count that
    favours the board; `broke` is the discordant count against it; a board that flips five tasks each way has a
    delta of zero and has done a great deal, and a reader who saw only the delta would call it inert. The exact
    test is McNemar's, which conditions on the discordant pairs and is the only test paired binary data supports.
    The interval is Newcombe's for two independent proportions and is quoted as **conservative**: ignoring the
    pairing widens it, so an interval that excludes zero here would exclude it under the paired calculation too.
    """
    from memory_debit import newcombe  # lazy: the arm imports this module every episode and needs no statistics

    left = _attempts_of(control, k)
    right = _attempts_of(treatment, k)
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
        "k": k,
        # The two arm names as files, because `R216b` pairs `front` against `board` and a reading that called its
        # left arm "control" would be a sentence about a document that was never written.
        "left": names[0],
        "right": names[1],
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


def _attempts_of(document: dict, k: int = 1) -> dict:
    """The `pass^k` outcome per task: one when its first `k` attempts all passed, zero otherwise.

    A task with fewer than `k` attempts **leaves the map** rather than counting as a failure — the same rule
    `note_pilot.py` applies to a `pass^k` denominator and `packages/eval/src/l4.ts` applies on the TypeScript side.
    Filling it with a zero would report "reliably fails" about a task nobody tried twice, which is the defect this
    lane has caught once already in a different coat.
    """
    from rescue_rate import trials_of  # lazy, for the same reason as `compare_of`'s import

    by_task = trials_of(document)
    outcome = {}
    for task, trials in by_task.items():
        if not trials or len(trials) < k:
            continue
        kept = [trials[index] for index in sorted(trials)[:k]]
        outcome[task] = 1.0 if all(value is not None and value >= 1.0 for value in kept) else 0.0
    return outcome


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
    k = reading.get("k", 1)
    ladder = "" if k == 1 else f" at pass^{k}"
    left = reading.get("left", "control")
    right = reading.get("right", "board")
    return (
        f"{state}{ladder}: {left} {reading['controlPassed']}/{total} ({reading['controlRate']:.1%}) against {right} "
        f"{reading['boardPassed']}/{total} ({reading['boardRate']:.1%}), delta {100 * delta:+.1f} pp "
        f"[{100 * interval[0]:+.1f}, {100 * interval[1]:+.1f}] pp, McNemar exact p = "
        f"{p if p is None else format(p, '.4f')}; moved {moved}, broke {broke}, held {reading['both']}, "
        f"neither {reading['neither']} — {sentence}"
    )


#: The names of the assertions that failed. A list rather than a counter so the reporting branch is exercised by
#: the suite that reports: a self-test whose failure path is never run is a suite that cannot fail visibly.
FAILED: list = []


def _report(failed: list) -> int:
    """Print the failures and the count, and answer with the exit code the workflow reads.

    A function rather than four lines at the end of `self_test`, because those four lines are the only part of this
    file that runs once and only on a red build — the one branch a green suite can never reach. Called with a list
    whose answer is known, it is covered on every run.
    """
    for name in failed:
        print(f"FAIL {name}")
    print(f"{len(failed)} failure(s)")
    return 1 if failed else 0


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

    def multi_arm(attempts: dict) -> dict:
        """One document whose tasks each carry a list of attempt rewards, in attempt order."""
        return {
            "simulations": [
                {"task_id": task, "trial": index, "reward_info": {"reward": value}}
                for task, values in attempts.items()
                for index, value in enumerate(values)
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
    # The refusal to list a forbidden action. A board that listed "do not exchange anything" as pending would send
    # the agent to do the one thing the user ruled out, which is the harm channel in its purest form.
    check("a negated ask is not an ask", items_of("Please do not exchange the keyboard.") == [])
    check("and a contracted negation is not either", items_of("I don't want to return the lamp.") == [])
    check("but a correlative that refuses nothing is still an ask", [item["family"] for item in items_of(
        "I not only want to return the lamp but also exchange the keyboard.")] == ["return", "exchange"])
    check("and a condition about the ask is not a refusal of it", [item["family"] for item in items_of(
        "If the agent doesn't allow the exchange, get a refund.")] == ["exchange", "return"])
    check("a sentence with no cue before the ask is skipped", [item["words"] for item in items_of(
        "Thanks! I want to return the lamp.")] == [["lamp"]])
    check("a family with no cue has no negation", _negated("anything", "nope") is False)
    check("a clause that only modifies the ask before it is not an ask", [item["words"] for item in items_of(
        "I want to exchange the keyboard, with clicky switches.")] == [["keyboard"]])

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
    # Two scopes, one transcript: the request states one ask and the conversation states two. R215's whole claim is
    # this difference, so it is asserted as a difference rather than as a comment on one of the two readings.
    board = board_of(board_messages, CONVERSATION)
    check("the conversation holds both asks", len(board["items"]) == 2)
    check("the named ask is settled", board["items"][0]["settled_by"] == "exchange_delivered_order_items")
    check("the unnamed ask is not", board["items"][1]["settled_by"] is None)
    check("the board counts the receipts", board["receipts"] == 1)
    contract = board_of(board_messages)
    check("the request holds the ask it stated", len(contract["items"]) == 1)
    check("and not the one a later turn added", contract["items"][0]["words"] == ["keyboard"])
    check("the request scope is named in the reading", contract["scope"] == REQUEST)
    check("the conversation scope is named in its own", board["scope"] == CONVERSATION)
    check("and the two render differently", "from conversation" in render(board) or "from the conversation" in render(board))
    check("the request render says so", "from the request" in render(contract))
    later_only = board_of(
        [
            {"role": "user", "content": "hello"},
            {"role": "user", "content": "I want to return the lamp."},
        ]
    )
    # R215 refused this and R216 accepts it, and the reversal is a measurement rather than a change of mind: the
    # greeting-then-request shape is 14 of R215's 107 writing episodes, and a contract sealed on the greeting classified
    # every change those episodes made as work nobody asked for (PROGRESS 245.3). What is still refused is the
    # *clarification*: once a turn has yielded an ask, no later turn adds one — asserted four lines above.
    check("a greeting before the request does not seal an empty contract",
          [item["words"] for item in later_only["items"]] == [["lamp"]])
    settled_contract = board_of(
        [
            {"role": "user", "content": "hello"},
            {"role": "user", "content": "I want to return the lamp."},
            {"role": "user", "content": "and the desk lamp too"},
        ]
    )
    check("but a turn after the seal adds nothing", len(settled_contract["items"]) == 1)
    check("no user message is no request", request_of([{"role": "assistant", "content": "hi"}]) == "")
    check("an empty first message is skipped", request_of([{"role": "user", "content": "  "},
                                                         {"role": "user", "content": "return it"}]) == "return it")
    check("a request of a tuple transcript", request_of([("user", "return the lamp")]) == "return the lamp")
    check("a non-string turn in conversation scope adds no ask", board_of(
        [{"role": "user", "content": None}, {"role": "user", "content": "return the lamp"}], CONVERSATION
    )["items"][0]["words"] == ["lamp"])
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

    # The set ask, which is the shape R215 could not settle at all (AUDIT 34.225). One ask over several products:
    # the first call settles it and the rest belong to it, so the board reports a ticked ask with a count instead of
    # a ticked ask beside three changes nobody asked for.
    set_messages = [
        {"role": "user", "content": "I want to return everything from my two most recent orders."},
        {"role": "assistant", "tool_calls": [{"name": "get_order_details", "arguments": {"order_id": "#W1"}}]},
        {"role": "tool", "content": json.dumps(order)},
        {"role": "assistant", "tool_calls": [{"name": "return_delivered_order_items",
                                              "arguments": {"item_ids": ["1151293680"]}}]},
        {"role": "tool", "content": "ok"},
        {"role": "assistant", "tool_calls": [{"name": "return_delivered_order_items",
                                              "arguments": {"item_ids": ["4983901480"]}}]},
        {"role": "tool", "content": "ok"},
    ]
    set_board = board_of(set_messages)
    check("a set ask is settled by its family", set_board["items"][0]["settled_by"] == "return_delivered_order_items")
    check("and its second call belongs to it", set_board["items"][0]["absorbed"] == 1)
    check("so nothing is left unattributed", set_board["unattributed"] == [])
    check("and the total is counted on the board", set_board["absorbed"] == 1)
    check("the block shows the count", "(+1 call)" in render(set_board))

    # An ask one word short of the product it names, which is 28 of R215's own successes (PROGRESS 245.3). It settles
    # now, at the loose grade, and the board says how many of its ticks were loose.
    loose_board = board_of(
        [
            {"role": "user", "content": "I want to return the watch I received."},
            {"role": "assistant", "tool_calls": [{"name": "get_order_details", "arguments": {"order_id": "#W9"}}]},
            {"role": "tool", "content": json.dumps({"items": [{"item_id": "2222222222", "name": "Smart Watch"}]})},
            {"role": "assistant", "tool_calls": [{"name": "return_delivered_order_items",
                                                  "arguments": {"item_ids": ["2222222222"]}}]},
            {"role": "tool", "content": "ok"},
        ]
    )
    check("an ask one word short of its product settles", loose_board["items"][0]["settled_by"] is not None)
    check("and the board counts it as loose", loose_board["loose"] == 1)
    check("an untouched set ask stays open",
          board_of([{"role": "user", "content": "return everything from my latest order"}])["items"][0]["settled_by"] is None)

    # The three predicates the rule is built from, checked one at a time because each is the answer to a different
    # question and a single end-to-end case would let one of them be wrong without saying so.
    table = {"1151293680": "Mechanical Keyboard", "4983901480": "Desk Lamp"}
    # The two grades, one at a time. A containment tick is the grade every R214/R215 tick was; an overlap tick is the
    # grade R216 added, and the count of them is what a reader needs to know the reading's rule was loosened.
    check("containment is the strict grade",
          settlement({"family": "return", "words": ["mechanical", "keyboard"]},
                     {"family": "return", "ok": True, "ids": ["1151293680"], "free": []}, table) == "name")
    check("one shared word of a two-word name is the loose grade",
          settlement({"family": "return", "words": ["watch", "received"]},
                     {"family": "return", "ok": True, "ids": ["4983901480"], "free": []}, table) == "")
    check("and half of a three-word name is enough",
          grade_of({"hiking", "boots"}, {"boots", "ordered", "specifically"}) == "overlap")
    check("a quarter of the shorter side is not enough",
          grade_of({"water", "bottle", "steel"}, {"bottle", "please", "very", "much"}) == "")
    check("and containment is never the loose grade",
          grade_of({"garden", "hose"}, {"hose", "garden", "green"}) == "name")
    check("no shared word is no grade", grade_of({"desk", "lamp"}, {"kettle"}) == "")
    check("an empty side is no grade", grade_of(set(), {"lamp"}) == "")

    check("a named product is found in the table",
          names_a_product({"family": "return", "words": ["mechanical", "keyboard"]}, table) is True)
    check("the table's own name is found in a longer ask",
          names_a_product({"family": "return", "words": ["desk", "lamp", "shade"]}, table) is True)
    check("a set phrase names no product",
          names_a_product({"family": "return", "words": ["everything", "two"]}, table) is False)
    check("an ask with no words names no product", names_a_product({"family": "cancel", "words": []}, table) is False)
    check("a set phrase is settled by family",
          settles_by_family({"family": "return", "words": ["everything", "two"]}, table) is True)
    check("and it absorbs", absorbs_receipts({"family": "return", "words": ["everything", "two"]}, table) is True)
    check("an ask naming a product is never settled by family",
          settles_by_family({"family": "return", "words": ["desk", "lamp"]}, table) is False)
    check("an unresolved object is not a set either",
          settles_by_family({"family": "cancel", "words": ["pending", "order", "lamp"]}, {}) is False)
    check("an order-level ask is settled by family but absorbs nothing",
          (settles_by_family({"family": "cancel", "words": []}, table),
           absorbs_receipts({"family": "cancel", "words": []}, table)) == (True, False))
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

    # The checker's two refusals, which are different facts and are charged differently. A call of a family the
    # request never named is work nobody asked for; a call of an asked family that this board cannot name is the
    # board's own blind spot. R214 reported both as `unattributed` and a reader could not tell which was which.
    invented = board_of(
        [
            {"role": "user", "content": "I want to exchange the mechanical keyboard."},
            {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]},
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a call of a family nobody asked for is unrequested", invented["unrequested"] == [{"name": "cancel_pending_order"}])
    check("and it is not called unattributed", invented["unattributed"] == [])
    check("and the ask it did not touch stays open", invented["items"][0]["settled_by"] is None)
    check("the render names the invented call", "Not asked for by the request" in render(invented))
    check("a board with no ask but an invented call still renders", render(invented).startswith("Open asks"))
    # R219. The admission rule, as a property of the renderer: the same board, read with `state_only`, states the
    # asks and refuses to state either judgment. The board is otherwise unchanged — the counters still hold both —
    # so a reading can still see what the arm declined to say.
    check("the state-only render drops the invented call", "Not asked for by the request" not in render(invented, state_only=True))
    check("and still states the ask", "[ ] exchange" in render(invented, state_only=True))
    check("the admission rule leaves the board's own counters alone", invented["unrequested"] == [{"name": "cancel_pending_order"}])
    statements = board_of([{"role": "user", "content": "I want to exchange the mechanical keyboard."}])
    check("a board with asks renders the same either way",
          render(statements, state_only=True) == render(statements))
    lonely = board_of(
        [
            {"role": "user", "content": "Hello, I need some help today."},
            {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]},
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a board with no ask and an invented call renders nothing under the rule",
          render(lonely).startswith("Not asked for") and render(lonely, state_only=True) == "")
    blind = board_of(
        [
            {"role": "user", "content": "I want to exchange the mechanical keyboard."},
            {"role": "assistant", "tool_calls": [{"name": "exchange_delivered_order_items",
                                                  "arguments": {"item_ids": ["999"]}}]},
            {"role": "tool", "content": "ok"},
        ]
    )
    check("a call of an asked family with no name is unattributed", blind["unattributed"] == [
        {"name": "exchange_delivered_order_items"}])
    check("and not unrequested", blind["unrequested"] == [])
    rejected = board_of(
        [
            {"role": "user", "content": "cancel the order"},
            {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]},
            {"role": "tool", "content": "Error: delivered", "error": True},
        ]
    )
    check("a failed call is on neither list, because it changed no state",
          rejected["unattributed"] == [] and rejected["unrequested"] == [])
    check("and its ask stays open", rejected["items"][0]["settled_by"] is None)
    orphan = render({"items": [], "unrequested": [{"name": "cancel_pending_order"}]})
    check("a board with no asks and one refusal is not empty", "Not asked for" in orphan)
    check("and it does not claim an open line it has none of", "[ ]" not in orphan)

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
    # An argument that is neither a string nor a container — a null, a count, a boolean. τ²'s tool schemas allow
    # them and the walkers must not raise on them, which is the only reason the two `elif` chains end nowhere.
    flat = receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
          "arguments": {"order_id": None, "count": 3, "force": True}}]}])[0]
    check("a non-string argument is neither an id nor free text", flat["ids"] == [] and flat["free"] == [])
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
    four = multi_arm({"0": [1, 1, 1, 1], "1": [1, 1, 1, 0], "2": [1, 0, 1, 1], "3": [0, 1, 1, 1]})
    check("pass^1 at four attempts is its first attempt, not its best",
          _attempts_of(four) == {"0": 1.0, "1": 1.0, "2": 1.0, "3": 0.0})
    check("pass^4 at four attempts is all four", _attempts_of(four, 4) == {"0": 1.0, "1": 0.0, "2": 0.0, "3": 0.0})
    two = multi_arm({"0": [1, 1], "1": [1, 0]})
    check("a task with two attempts leaves a pass^4 reading", _attempts_of(two, 4) == {})
    check("but enters a pass^2 reading", _attempts_of(two, 2) == {"0": 1.0, "1": 0.0})
    check("the reading reports the k it used", compare_of(four, four, 4)["k"] == 4)
    check("and the rendered sentence carries it", " at pass^2" in render_comparison(compare_of(four, two, 2)))
    check("a one-attempt reading is not labelled with a ladder", "pass^" not in render_comparison(
        compare_of(arm({"0": 1}), arm({"0": 0}))))
    named = render_comparison(compare_of(arm({"0": 1}), arm({"0": 0}), names=("front", "board")))
    check("the reading names the arms it was given", " front 1/1 " in named and " against board " in named)
    check("and defaults to the names the grid has always used",
          " control 1/1 " in render_comparison(compare_of(arm({"0": 1}), arm({"0": 0}))))

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
    # The replay, which is the measurement this round was registered on: a document that already exists, parsed by
    # the parser under test. Two fixtures, because the two ways it can mislead are a denominator over episodes that
    # never ran and a numerator that counts an episode with no writes.
    replayed = replay({"simulations": [
        {"task_id": "1", "messages": set_messages},
        {"task_id": "2", "messages": [{"role": "user", "content": "return the lamp"}]},
        {"task_id": "3"},
    ]})
    check("a writing episode that ticks is the numerator", (replayed["writing"], replayed["ticked"]) == (1, 1))
    check("and the share is over writing episodes", replayed["tickShare"] == 1.0)
    check("an episode with no writes is not in the denominator", replayed["episodes"] == 3)
    check("an episode with no messages is skipped, not counted", replayed["skipped"] == 1)
    check("and a document with no writes has no share", replay({"simulations": []})["tickShare"] is None)

    # R219's instrument, on the document shape τ² writes: the evaluator's criteria carry the required writes and the
    # transcript carries the calls, so the same episode is judged without the block ever reading the criteria. The
    # fixture is the smallest one that has both failures at once — a required write the parser cannot name (three
    # turns of it, because the block is re-read every turn) and a write of a family the task requires nothing in.
    accused = {
        "tasks": [{"id": "7", "evaluation_criteria": {"actions": [
            {"name": "find_user_id_by_name_zip"}, {"name": "return_delivered_order_items"}]}}],
        "simulations": [{"task_id": "7", "messages": [
            {"role": "user", "content": "I want to return the lamp."},
            {"role": "assistant", "tool_calls": [{"name": "return_delivered_order_items",
                                                  "arguments": {"item_ids": ["999"]}}]},
            {"role": "tool", "content": "ok"},
            {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W9"}}]},
            {"role": "tool", "content": "ok"},
        ]}],
    }
    judged = false_accusations(accused)
    check("a required write the parser cannot name is a false accusation",
          judged["perBucket"]["unattributed"] == {"entries": 3, "false": 3})
    check("a write of a family the task requires nothing in is a true one",
          judged["perBucket"]["unrequested"] == {"entries": 1, "false": 0})
    check("the rate is over the entries that can be judged", judged["falseShare"] == 0.75)
    check("and the episode is counted once against its own denominator",
          (judged["episodesFalse"], judged["episodesJudged"]) == (1, 1))
    check("the last block alone is cheaper and smaller",
          (false_accusations(accused, whole_episode=True)["entries"],
           false_accusations(accused, whole_episode=True)["false"]) == (2, 1))
    blank = {"tasks": [], "simulations": accused["simulations"]}
    check("a document with no criteria judges nothing", false_accusations(blank)["falseShare"] is None)
    check("and reports its episode share as absent rather than zero",
          false_accusations(blank)["episodesFalseShare"] is None)
    check("an episode with no messages is skipped rather than judged",
          false_accusations({"tasks": accused["tasks"], "simulations": [{"task_id": "7"}]})["episodes"] == 0)
    check("a task that is not a dict has no requirements", _required_families(None) == set())
    check("a criteria block that is not a dict has none", _required_families({"evaluation_criteria": "x"}) == set())
    check("an action that names no write tool is not a requirement", _required_families(
        {"criteria": {"actions": [{"name": "get_order_details"}, "junk"]}}) == set())
    check("and the criteria are read by tool name", _required_families(accused["tasks"][0]) == {"return"})

    tall = render({"items": [{"family": "return", "words": ["x" * 300], "settled_by": None}] * 3})
    check("three tall lines are cut at the ceiling", len(tall) <= BOARD_MAX_CHARS and tall.endswith("…"))

    with tempfile.TemporaryDirectory() as scratch:
        goals = os.path.join(scratch, "goals.json")
        with open(goals, "w", encoding="utf-8") as handle:
            json.dump(little, handle)
        check("the census runs from the command line", quiet(["--census", "--goals", goals]) == 0)
        written = os.path.join(scratch, "replay.json")
        with open(written, "w", encoding="utf-8") as handle:
            json.dump({"simulations": [{"task_id": "1", "messages": set_messages}]}, handle)
        check("the replay runs from the command line", quiet(["--replay", written]) == 0)
        accused_path = os.path.join(scratch, "accused.json")
        with open(accused_path, "w", encoding="utf-8") as handle:
            json.dump(accused, handle)
        check("the accusations run from the command line", quiet(["--accusations", accused_path]) == 0)
        check("and read as json, whole episode or per turn",
              quiet(["--accusations", accused_path, "--json"]) == 0
              and quiet(["--accusations", accused_path, "--whole-episode"]) == 0)
        with open(accused_path, "w", encoding="utf-8") as handle:
            json.dump(blank, handle)
        check("a document with no criteria prints the no-verdict sentence",
              quiet(["--accusations", accused_path]) == 0)
        check("and reads as json when asked", quiet(["--replay", written, "--json"]) == 0)
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
    # The reporter itself is exercised on a list whose answer is known. A suite whose only unreachable line is the
    # one that prints a failure is a suite that has never printed one, and `FAILED` is emptied on green before the
    # loop — so the branch is covered by calling it, not by hoping.
    reported = io.StringIO()
    with contextlib.redirect_stdout(reported):
        code = _report(["negative control (must fail)"])
    check("the reporter prints a failure", reported.getvalue().startswith("FAIL negative control (must fail)"))
    check("and exits non-zero", code == 1)
    with contextlib.redirect_stdout(io.StringIO()):
        check("the reporter on an empty list exits zero", _report([]) == 0)
    FAILED.remove("negative control (must fail)")
    return _report(FAILED)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="The asks of a request and the receipts that settle them.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--messages", default="", help="a simulation document, or a JSON list of messages")
    parser.add_argument("--goals", default="", help="the census manifest (eval/manifests/retail-goals.json)")
    parser.add_argument("--census", action="store_true")
    parser.add_argument("--compare", nargs=2, default=None, metavar=("CONTROL", "BOARD"),
                        help="two result documents or directories: the paired reading")
    parser.add_argument("--k", type=int, default=1,
                        help="attempts a task must survive to count as passed (default 1; a four-attempt arm wants 4)")
    parser.add_argument("--replay", default="", help="a result document the arm already produced")
    parser.add_argument("--accusations", default="",
                        help="a result document carrying the evaluator's criteria: how often the refusal lines are wrong")
    parser.add_argument("--whole-episode", action="store_true",
                        help="judge the last block only, which is cheaper on a large document")
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
    if arguments.replay:
        with open(arguments.replay, "r", encoding="utf-8") as handle:
            document = json.load(handle)
        reading = replay(document)
        if arguments.json:
            print(json.dumps(reading, indent=1, sort_keys=True))
        else:
            share = reading["tickShare"]
            print(
                f"{reading['ticked']} of {reading['writing']} writing episode(s) ended with a tick "
                f"({share:.1%})" if share is not None else "no episode in this document made a state-changing call"
            )
            print(
                f"{reading['settled']}/{reading['asks']} ask(s) settled, {reading['loose']} of them loose, "
                f"{reading['absorbed']} absorbed, {reading['unrequested']} unrequested, "
                f"{reading['unattributed']} unattributed, {reading['skipped']} episode(s) skipped"
            )
        return 0
    if arguments.accusations:
        with open(arguments.accusations, "r", encoding="utf-8") as handle:
            document = json.load(handle)
        reading = false_accusations(document, whole_episode=arguments.whole_episode)
        if arguments.json:
            print(json.dumps(reading, indent=1, sort_keys=True))
        else:
            share = reading["falseShare"]
            print(
                f"{reading['false']} of {reading['judged']} refusal entr(ies) name a family the task requires "
                f"({share:.1%})" if share is not None
                else "no entry in this document can be judged: it carries no evaluator criteria"
            )
            print(
                f"{reading['entries']} entr(ies) over {reading['episodes']} episode(s); "
                f"{reading['episodesFalse']} episode(s) carried at least one false accusation; "
                f"{reading['tasksJudged']} task(s) had criteria"
            )
            for bucket, counts in sorted(reading["perBucket"].items()):
                print(f"  {bucket:13s} {counts['false']}/{counts['entries']} false")
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
        reading = compare_of(
            documents[0], documents[1], k=max(1, arguments.k),
            names=(Path(arguments.compare[0]).stem, Path(arguments.compare[1]).stem),
        )
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
