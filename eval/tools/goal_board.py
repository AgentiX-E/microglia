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

#: R231's admission, as a **scope** rather than as a second board: the contract's turn read whole, and every turn after
#: it read only through the clauses that **name their own family**. The distinction is where the parser's inheritance
#: rule may reach, so the vocabulary, the sentence split and the settlement rules are the same ones, and the difference
#: between this board and `REQUEST` is exactly which turns are allowed to contribute an ask.
#:
#: It exists because a requirement and the answer to the agent's question share a turn: of 2,453 user turns in this
#: corpus, 1,893 (77.2%) follow an assistant question, so a whole-turn filter cannot keep the requirement without also
#: keeping the answer — and inside an answer the inheritance rule manufactures an ask out of a value ("yes, the purple
#: one" inherits the exchange the agent proposed). Restricting the rule's reach keeps the requirement and drops the
#: value. R231 measured the trade, R232-R234 measured what a window of eight lines can show of it, and R236 is the round
#: that serves it: a rule read off a transcript and a rule a model is shown are two different claims.
CLAUSE = "clause"

#: Every scope a board may be built at. Checked rather than defaulted: an unknown scope that falls through to the
#: request board turns a typo in a dispatch into a quiet re-run of the previous round.
SCOPES = (REQUEST, CONVERSATION, CLAUSE)

#: The orders a block can be rendered in — the ladder R233 and R234 climbed, as three names rather than two switches:
#: `statement` is the product's, asks in the order they were stated; `open` puts the unresolved asks first; `grouped`
#: then spends the window on one line per family. Each rung **contains** the one before it, which is why the rung is
#: named rather than assembled from a pair of flags that could disagree — and it is why the product's level and the
#: instrument's level can be compared as one string.
DISPLAYS = ("statement", "open", "grouped")

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
    # R217a. The airline domain's five state-changing tools. A family is the **shape of an ask** and not the name of a
    # tool, which is why the two updates that a single "change" can perform share the `modify` family and the two that
    # name their own object do not: "add a bag" and "add a passenger" are asks a request states in their own words, and
    # a receipt that settled them under `modify` would tick a flight change against a bag. `book` has no retail
    # analogue because retail's orders arrive already placed.
    "cancel_reservation": "cancel",
    "update_reservation_flights": "modify",
    "update_reservation_passengers": "passenger",
    "update_reservation_baggages": "baggage",
    "book_reservation": "book",
    # R241a. The third domain's nine state-changing tools. They are here for the same reason the airline five are: a
    # family is the **shape of an ask**, and a board that cannot see a write cannot settle one. What is *not* shipped
    # with them is a cue — the vocabulary that recognises these asks in a request — which is a separate axis (R217a
    # paid for the airline three) and is named in the manifest's `notYet` rather than left as a silent gap. Two of
    # these names collide with a retail family on purpose: `payment` is a payment in both domains, and the shape of the
    # ask is the same shape even though the object differs.
    "suspend_line": "suspend",
    "resume_line": "resume",
    "enable_roaming": "roaming",
    "disable_roaming": "roaming",
    "refuel_data": "refuel",
    "change_plan": "plan",
    "send_payment_request": "payment",
    "apply_credit": "credit",
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
    # R217a's three, appended so that no retail request can change its parse: a cue earlier in this list wins, and
    # every retail reason that mentions these words also states one of the seven above. The census over both domains is
    # what holds that claim (the retail numbers are asserted unchanged).
    ("baggage", r"\b(bag|bags|baggage)\b"),
    ("passenger", r"\bpassenger\w*\b"),
    ("book", r"\b(book|books|booking|reserve|reserved)\b"),
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
#:
#: R240. A record is not always an order number. Three shapes, and the rule for each is stated rather than implied
#: because the third domain's whole record grade turns on it:
#:
#:   `#W2378156`      the hash form retail writes, unchanged since R215;
#:   `L1002`, `C1001` a short letter prefix and four digits — a domain that keys its lines and customers by id, and
#:                    that a receipt carries under `line_id` / `customer_id`;
#:   `555-123-2002`   a phone number, which is the only handle a telecom request ever gives on a line.
#:
#: The bare numeric form keeps its six-digit floor on purpose: τ²'s zip codes are five digits, and a zip is a place
#: rather than a record, so a rule that read it as one would tick a cancel against every request that states where
#: the caller lives.
ID = re.compile(r"#[A-Za-z]{1,3}\d{3,}|[A-Za-z]{1,3}\d{4,}|\d{6,}|\d{3}-\d{3}-\d{4}")

#: A record identifier as a **user** writes it. The hash form is unchanged; R240 adds the two shapes a user types
#: without one, because a request that says "my order W4284542" (53 of the 2,744 user strings in the control grid) or
#: "the line is 555-123-2002" was naming a record the board could not read. A bare number in a sentence ("the 2
#: items", "2025 dollars") is still not a record: the bare form requires letters, and the phone form requires its
#: own separators.
RECORD = re.compile(r"#[A-Za-z]{1,3}\d{3,}|\b[A-Za-z]{1,3}\d{4,}\b|\b\d{3}-\d{3}-\d{4}\b")

#: A clause boundary. `and`, `but`, `then`, `also` and a bare comma each start a new ask in this corpus —
#: "return the cleaner, headphone, and smart watch" is three asks and one call, which is the case the board exists
#: to keep visible. Named for what it does rather than for what it cuts, because `CLAUSE` is the scope and a name that
#: means two things in one module is a name that will eventually be passed to the wrong one.
CLAUSE_SPLIT = re.compile(r"(?<=[.!?;])\s+|\s*,?\s+(?:and|but|then|also)\s+|,\s*", re.IGNORECASE)

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


def items_of(text: str, inherit: bool = True) -> list[dict]:
    """The asks in a user message: one item per object phrase, in the order they were stated.

    A clause inherits the family of the clause before it **within the same sentence**, which is what makes "the
    smart thermostat for one compatible with Google Home" an exchange rather than a fragment. Inheritance stops at
    the sentence because the next sentence is where this corpus changes the subject ("If not possible, you are
    angry") and an inherited family there manufactures asks nobody made.

    `inherit=False` reads each clause as standing alone, so an item exists only where a clause **names its own
    family**. It is the same vocabulary and the same sentence split; only the reach of the rule changes. R231 uses it
    for turns after the contract's, where the clause that inherits is a *value* filling a slot the agent asked for
    ("yes, the purple one") rather than a requirement — the same mechanism, correct inside a request and wrong
    inside an answer. The default is `True` for every caller that predates the round, which is all of them.
    """
    if not isinstance(text, str) or not text.strip():
        return []
    found: list[dict] = []
    for sentence in re.split(r"(?<=[.!?])\s+|;\s*", text):
        family = ""
        sentence_items: list[dict] = []
        for clause in CLAUSE_SPLIT.split(sentence):
            clause = (clause or "").strip()
            if not clause:
                continue
            named = family_of(clause)
            if named and _negated(clause, named):
                # "do not exchange anything" is not an ask to exchange. Dropping it is the conservative reading:
                # a board that lists a forbidden action as pending sends the agent to do what the user refused.
                continue
            if not named and not inherit:
                # The boundary. A clause with no cue of its own is not an ask here, whatever precedes it: outside
                # the turn that states the contract, the family of a neighbour belongs to the neighbour.
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


def clause_items(messages) -> dict:
    """R231's admission: the items the contract states, plus the items later turns **name themselves**.

    The contract is the first turn that states an ask — not turn one, which is a greeting on 52 of 403 episodes — and
    it is read whole, so the board's item set provably **contains** the request board's. Every later turn contributes
    only its self-naming clauses: no cue of its own, no ask, whatever precedes it. That is the parser's own
    inheritance rule with its reach restricted, not a second vocabulary.

    What it gives up is the price of the rule and is reported rather than hidden: an object list continued across
    clauses ("return the lamp and the chair") keeps only the first object, because only inheritance reaches the
    second, and `offered - kept` is that cost as a count.

    The diagnostics travel with the items because they are how a reading says *why* a board holds what it holds, and
    because the same function serves the product's rendering and the instrument's measurement — a rule written twice
    is a rule that can disagree with itself, and a block a model was shown that the reading cannot reproduce is a
    measurement of something else.
    """
    turns: list = []
    seen = 0
    for message in messages:
        if role_of(message) not in ("user", "human"):
            continue
        content = _field(message, "content")
        text = content if isinstance(content, str) else ""
        position = seen
        seen += 1
        if not text.strip():
            # Counted and not read: a turn that stated nothing is an event in the conversation, and two rules whose
            # turn counts disagree cannot be compared on the denominator they share.
            continue
        turns.append({"position": position, "whole": items_of(text), "own": items_of(text, inherit=False)})
    contract = next((turn["position"] for turn in turns if turn["whole"]), None)
    asks: list = []
    whole: list = []
    partial: list = []
    offered = kept = 0
    for turn in turns:
        take = turn["whole"] if turn["position"] == contract else turn["own"]
        offered += len(turn["whole"])
        kept += len(take)
        if turn["position"] == contract:
            whole.append(turn["position"])
        elif len(turn["own"]) < len(turn["whole"]):
            partial.append(turn["position"])
        asks.extend(take)
    return {
        "asks": _folded(asks),
        "turns": seen,
        "contract": contract,
        "wholeTurns": whole,
        "partialTurns": partial,
        "offered": offered,
        "kept": kept,
        "refusedInherited": offered - kept,
        "containsContract": contract is not None,
    }


def order_open(items: list, is_settled=None) -> list:
    """R233's order: the unresolved asks first, the settled ones after, statement order inside each group.

    A stable partition rather than a sort, so "statement order inside each group" is the identity on each group and
    the only thing that moved is which group comes first. `is_settled` is a parameter because the two callers carry the
    tick differently — the product's items carry the receipt's name, the instrument's carry a boolean — and a rule that
    could only read one of the two shapes would be two rules again.
    """
    settled = is_settled or (lambda item: bool(item.get("settled_by")))
    return [item for item in items if not settled(item)] + [item for item in items if settled(item)]


def fold_family(items: list) -> list:
    """R234's fold: one line per family, in the order the families were first stated.

    A stable two-bucket partition and nothing else. The first bucket is the first item of each family, the second is
    every other item, both in the order they arrived — so the rule's only input is a field every ask already carries
    and its only effect is which of two positions an item occupies. Nothing is removed and nothing is settled: the
    block has the same lines in it, it spends its first eight on distinct obligations instead of on nine restatements
    of one (R234: 636 of 654 writes reached, none hidden, against 632 and 4 before the fold).
    """
    firsts: list = []
    rest: list = []
    seen: set = set()
    for item in items:
        family = item.get("family")
        if family in seen:
            rest.append(item)
        else:
            seen.add(family)
            firsts.append(item)
    return firsts + rest


def displayed(items: list, level: str = "statement", is_settled=None) -> list:
    """The item list as a block of `MAX_ITEMS` lines would show it, at one rung of the ladder.

    The fold is applied **after** the order and **before** the cut, which is the only place it can be applied without
    becoming a different rule: before the order it would decide which items the partition sees, and after the cut it
    would decide nothing at all because the eight lines would already have been chosen.
    """
    if level not in DISPLAYS:
        raise ValueError(f"unknown display {level!r}")
    if level == "statement":
        return list(items)
    ordered = order_open(items, is_settled)
    return fold_family(ordered) if level == "grouped" else ordered


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


def records_in(text: str) -> set:
    """The record identifiers an ask spells, lowercased so that a comparison cannot fail on a capital.

    An ask's words are the content words of its clause and they carry no identifier — `words_of` drops numbers on
    purpose — so the record grade has to read the clause itself. That is the only place in this module where an ask is
    read as text rather than as a word set, and it is bounded: an identifier, or nothing.
    """
    if not isinstance(text, str):
        return set()
    return {found.lower() for found in RECORD.findall(text)}


#: R241. The three record types the third domain keys its state by, and the two relations between them. Written as
#: names rather than inferred from an argument's spelling because the lattice below compares at a **type**, and a type
#: that fell out of a string's shape would be a guess.
LINE, CUSTOMER, BILL = "line", "customer", "bill"

#: The types that are owned by another: a line belongs to the customer who holds it, a bill to the account it is issued
#: to. A key of one of these types carries its owner with it, which is why the lattice never has to look one up.
OWNED = (LINE, BILL)


def _records(value, found: list) -> None:
    """Every record-shaped dict in a tool result, at any depth.

    The test is the presence of a key that names a record's **own** identifier, because that is what distinguishes a
    record from the arguments that describe one: a line carries `line_id`, a customer `customer_id`, a bill `bill_id`.
    Nothing is inferred from the shape of the value — a rule that read `C1001` as a customer because of its letter
    would be a rule fitted to one database's spelling.
    """
    if isinstance(value, dict):
        if any(key in value for key in ("line_id", "customer_id", "bill_id")):
            found.append(value)
        for entry in value.values():
            _records(entry, found)
    elif isinstance(value, (list, tuple)):
        for entry in value:
            _records(entry, found)


def read_records(messages) -> dict:
    """The records an episode has **read**, as the three relations a settlement needs to be typed.

    R240 measured the third domain's record grade at zero and named the reason: its requests name a line by a phone
    number, and the shipped rule intersects the clause's identifiers against the receipt's, which is a string
    comparison with no resolution step. The repair is not a static token table — a table would be a second copy of the
    database living in a memory instrument — but the resolution **the episode itself performed**: the reads are in the
    transcript, they carry the phone number on one side and the record ids on the other, and a board that anchors on
    them cannot claim a resolution the episode never made.

    Three relations, and each one is stated because the lattice below depends on it:

        phones    `555-123-2002 -> L1002`   a **line** record whose own `phone_number` is that number. This is the
                                            only relation that types a phone as a line, and it is deliberately sourced
                                            from a line and not from a customer: a customer's phone number is the
                                            account's contact number, which is a different assertion.
        accounts  `555-123-1002 -> C1003`   a **customer** record whose own `phone_number` is that number. A token with
                                            no line of its own resolves here and stops: the ask named the account.
        owners    `L1002 -> C1001`          a customer record's `line_ids`, and a bill's `customer_id`. This is what
                                            makes a line reachable from its account and never from a sibling.

    `known` records which ids the transcript has actually shown, so an ask that spells `L1002` is typed as a line
    because a line was read and not because of its shape.
    """
    phones: dict = {}
    accounts: dict = {}
    owners: dict = {}
    known: dict = {}
    for message in messages:
        if role_of(message) != "tool":
            continue
        content = _field(message, "content")
        if not isinstance(content, str):
            continue
        try:
            parsed = json.loads(content)
        except (TypeError, ValueError):
            continue
        found: list = []
        _records(parsed, found)
        for record in found:
            line = record.get("line_id")
            customer = record.get("customer_id")
            bill = record.get("bill_id")
            phone = record.get("phone_number")
            if isinstance(line, str) and line:
                known.setdefault(line.lower(), set()).add(LINE)
                if isinstance(phone, str) and phone:
                    phones.setdefault(phone.lower(), line.lower())
            if isinstance(customer, str) and customer:
                known.setdefault(customer.lower(), set()).add(CUSTOMER)
                if isinstance(phone, str) and phone and not line:
                    accounts.setdefault(phone.lower(), customer.lower())
                for owned in record.get("line_ids") or []:
                    if isinstance(owned, str) and owned:
                        owners.setdefault(owned.lower(), customer.lower())
                        # A line id listed by an account is a line, even before the line itself has been read. That is
                        # the whole value of the relation: it types a bare `L1003` in an ask, which a rule reading only
                        # line records could not do until the agent happened to fetch that line.
                        known.setdefault(owned.lower(), set()).add(LINE)
            if isinstance(bill, str) and bill:
                known.setdefault(bill.lower(), set()).add(BILL)
                if isinstance(customer, str) and customer:
                    owners.setdefault(bill.lower(), customer.lower())
    return {"phones": phones, "accounts": accounts, "owners": owners, "known": known}


def handles_in(text: str, records: dict) -> set:
    """The typed records an ask names, resolved through what the episode read — and never through its siblings.

    A phone number that a **line** record claims resolves to that line *and its account*, which is the pair a request
    is really about: the call is coming from that line, on that person's account. It does not resolve to the account's
    other lines, and that is the whole of R241's repair — R240's `blind` reading resolved a household's number to
    every line on it and would have credited a repair on the wrong one.

    A token nothing was read for stays **untyped**. That is not a fallback for convenience: it is R238-R240's rule,
    kept so that a domain whose receipts carry identifiers the episode never read (`#W7449508` in retail, where no read
    is needed because the user types the order id) settles exactly as it did before this round.
    """
    keys: set = set()
    if not isinstance(text, str):
        return keys
    phones = records.get("phones") or {}
    accounts = records.get("accounts") or {}
    owners = records.get("owners") or {}
    known = records.get("known") or {}
    for token in RECORD.findall(text):
        lowered = token.lower()
        line = phones.get(lowered)
        if line:
            keys.add((LINE, line))
            if owners.get(line):
                keys.add((CUSTOMER, owners[line]))
            continue
        account = accounts.get(lowered)
        if account:
            keys.add((CUSTOMER, account))
            continue
        kinds = known.get(lowered)
        if kinds:
            keys.update((kind, lowered) for kind in kinds)
            continue
        keys.add(("", lowered))
    return keys


def receipt_keys(receipt: dict) -> set:
    """The typed records a receipt carries, keyed by the **argument name** that carried them.

    returns "`line_id: L1002` names a line and `customer_id: C1001` names a customer", and the type is what lets the
    lattice tell "a write on the account" from "a write on another line of the same account". A receipt that reached
    this module without its arguments — a hand-built one in a test, or a reader that built the list before R228 added
    `args` — falls back to its flattened `ids`, untyped, which is exactly the evidence it has.

    **Where the type is given, the shape is not required.** `_id_values` insists on an identifier-shaped string because
    the shape is the only evidence it has of anything; here the argument's own name has already said what the value is,
    so a database whose ids are `L1` and `C1` is read as readily as one whose ids are `L1002`. The reverse mistake —
    asking a typed value to also look like a record — silently empties the comparison on any corpus with short ids,
    and does it without failing: every set stays well-formed and every reading stays zero.
    """
    keys: set = set()
    arguments = receipt.get("args")
    if isinstance(arguments, dict):
        for name, value in arguments.items():
            if not isinstance(name, str):
                continue
            kind = ""
            # Four suffixes, and the cut is stated per branch because a single `[:-3]` is off by one for `_id` and
            # produces a type named `line_` — a defect that would not fail a test that only asked whether *some* key
            # was produced, and would silently make every typed comparison a comparison of two untyped spellings.
            if name.endswith("_ids"):
                kind = name[:-4]
            elif name.endswith("ids"):
                kind = name[:-3]
            elif name.endswith("_id"):
                kind = name[:-3]
            elif name.endswith("id"):
                kind = name[:-2]
            if not kind:
                continue
            for entry in value if isinstance(value, (list, tuple)) else [value]:
                if isinstance(entry, str) and entry.strip():
                    keys.add((kind, entry.strip().lower()))
    if not keys:
        keys.update(("", str(identifier).lower()) for identifier in receipt.get("ids") or [])
    return keys


def same_record(ask: set, carried: set) -> bool:
    """Whether an ask's typed keys and a receipt's name the same record, at the finest type both sides commit to.

    The lattice, stated as three rules in the order they are consulted:

      1. **both sides name a line** → the lines must intersect. This is the rule that refuses a sibling: an ask about
         the line whose number the caller gave cannot be settled by a write to another line on the same account, and
         a plain set intersection would settle it, because both sides also carry the account.
      2. **both sides name a bill** → the bills must intersect, for the same reason one level up.
      3. **otherwise** → compare the records themselves, ignoring type. A receipt that names only the account settles an
         ask about one of its lines (the write really is about that account), and an untyped key on either side —
         retail's order id, which no read ever typed — compares on its spelling, which is R238's rule unchanged.
    """
    if not ask or not carried:
        return False
    for kind in OWNED:
        left = {name for key, name in ask if key == kind}
        right = {name for key, name in carried if key == kind}
        if left and right:
            return bool(left & right)
    return bool({name for _, name in ask} & {name for _, name in carried})


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
    position = 0
    for message in messages:
        role = role_of(message)
        if role in ("assistant", "agent"):
            for call in _field(message, "tool_calls") or []:
                name = _field(call, "name")
                # The position is counted over **every** call and not over the write calls, because the results this
                # loop collects are not filtered: τ² answers the k-th call of the episode with the k-th tool message,
                # so a write's result sits at the index of the call and not at the index of the write. AUDIT 34.320:
                # counting writes only made a write inherit the verdict of the read before it, which is how a refused
                # cancel was reported as a change that happened on 37 of the 456 episodes this lane has on disk.
                here = position
                position += 1
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
                        "position": here,
                        "ids": ids,
                        "free": free,
                        # R228. The arguments as the call carried them, because a measurement that binds a receipt to
                        # a **record** needs the key the identifier arrived under (`order_id` is an order, `user_id`
                        # is an account) and `ids` has already flattened that away. The board itself never reads this;
                        # it travels so that the read-anchored comparison can index the same receipt list rather than
                        # pairing the calls a second time and drifting from this one.
                        "args": arguments if isinstance(arguments, dict) else {},
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
    for call in calls:
        # A call with no result is not a receipt: the episode ended, the tool raised, or the message was dropped, and
        # in every one of those the environment changed nothing this document can show.
        index = call["position"]
        ok = False
        if index < len(results):
            ok = bool(results[index]["ok"]) and "error" not in str(results[index]["content"]).lower()[:40]
        receipts.append({**call, "ok": ok})
    return receipts


def stem(word: str) -> str:
    """A word with a regular English plural removed, and nothing else.

    The board compares an ask's words against a catalogue's names, and the two spell one product differently: the user
    writes "the sneaker", the item is called "Sneakers (size 6, black)". A surface comparison refuses that settlement,
    the ask stays open, and the block asks for work the receipt already did — the cheapest possible form of the
    negative effect this project is measuring, and one that no amount of retrieval quality can fix (AUDIT 34.339).

    Three shapes are deliberately **not** plurals and are left alone: a word of three letters or fewer (`bus`), a word
    ending in a double s (`glass`), and anything whose `-es` follows a vowel (`shoes` → `shoe`, not `sho`). The rule
    is a stemmer of the corpus rather than of the language, and it is stated as one because a general stemmer would be
    a dependency whose behaviour this file could not check on the two hundred names the corpus actually contains.
    """
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("es") and word[:-2].endswith(("s", "x", "z", "ch", "sh")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def grade_of(name_words: set, words: set) -> str:
    """The grade of a match between a product's name and an ask's words: `"name"`, `"overlap"`, or `""`.

    One function for both callers, because `settles` and `names_a_product` have to agree: if the board can tick an
    ask it does not consider to name a product, then the same ask is both settled and a set, and the two rules would
    fight over it in the order the loop happens to run.

    Both sides are stemmed before they are compared (R238). Stemming one side only would make the rule asymmetric —
    "sneaker" would settle against "Sneakers" but not the reverse — and an asymmetric matcher is a bug waiting for a
    catalogue that spells its names the other way round.
    """
    name_words = {stem(word) for word in name_words}
    words = {stem(word) for word in words}
    if not name_words or not words:
        return ""
    if name_words <= words or words <= name_words:
        return "name"
    if len(name_words & words) / min(len(name_words), len(words)) >= OVERLAP:
        return "overlap"
    return ""


def settlement(item: dict, receipt: dict, table: dict, records: dict | None = None) -> str:
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
    grade = ""
    for name in named:
        found = grade_of(set(words_of(name)), words)
        if found == "name":
            return "name"
        grade = grade or found
    # The free-text branch runs the other way round: an ask's words have to be spelled by the receipt, because a
    # receipt that names a place or a value names it in full, and a superset is a receipt about this ask.
    if not grade:
        free = set()
        for text in receipt.get("free") or []:
            free.update(words_of(text))
        if words <= free:
            return "name"
    # R238. The record grade. An ask can name its object by **identifier** rather than by product — "I need an exchange
    # on order #W5056519", "return just the sneaker from order #W7449508" — and the receipt carries that identifier
    # whether or not the episode ever read the order. Without this branch the family rule below settles whichever ask
    # of the family stands first, so a receipt is credited to work nobody did and this ask keeps asking for work that
    # was done; that is the mechanism the trap reader counted, and it is the one branch here whose evidence is an
    # identifier rather than a product.
    #
    # It runs **after** both name grades, and the condition it needs is the one thing the two grades cannot supply:
    # the receipt names **no product at all**. That is not the same as "the ask names no product", and the difference
    # is a whole family of defects: `cancel_pending_order` and `modify_pending_order_address` carry an order id and
    # nothing else, so an ask that names one of the order's products ("cancel the entire order #W5481803 (both the
    # boots and the kettle)") has a product the receipt can never touch, is refused by every name grade, and is
    # excluded from the family rule by `names_a_product` — open for ever, after the order was cancelled. Guarding on
    # the receipt instead of the ask says the right thing: when the write carried products, a mismatch is a refusal and
    # an order id must not overrule it; when it carried none, the order id is the only evidence there is.
    if not grade and not named:
        # R241. The evidence is the **record the episode read**, not only the identifier the clause spells. A domain
        # whose requests name their record by a handle the database resolves (a phone number) has no identifier for a
        # string comparison to intersect, so the resolution has to come from the transcript — and it is graded
        # separately, because a tick that needed a read is a weaker claim than one the ask spelled out itself.
        ask = handles_in(item.get("clause") or "", records or {})
        if same_record(ask, receipt_keys(receipt)):
            return "handle" if any(kind for kind, _ in ask) else "record"
    return grade


def settles(item: dict, receipt: dict, table: dict, records: dict | None = None) -> bool:
    """Whether this receipt proves this ask was performed by name, at either grade.

    An ask that names no object cannot be settled here; it is settled by family in `board_of`, one receipt per ask.
    """
    return settlement(item, receipt, table, records) != ""


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
    if scope not in SCOPES:
        raise ValueError(f"unknown board scope {scope!r}")
    if scope == CLAUSE:
        items.extend(clause_items(messages)["asks"])
    elif scope == CONVERSATION:
        for message in messages:
            if role_of(message) in ("user", "human"):
                content = _field(message, "content")
                if isinstance(content, str):
                    items.extend(items_of(content))
    else:
        items.extend(items_of(request_of(messages)))
    unique = _folded(items)
    table = name_table(messages)
    # R241. The typed records the episode read, built once for the same reason the name table is: a settlement rule
    # that rebuilt them per receipt would be a second implementation of the same facts, and the two would drift.
    records = read_records(messages)
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
    # R238. How many ticks came from the record grade — the weakest of the three, and the only one whose evidence is an
    # identifier rather than a product. Counted for the same reason `loose` is: a reading whose ticks are mostly
    # records is a reading about a rule that trusts the ask's own spelling of its order.
    by_record = 0
    # R241. How many ticks came from the handle grade — the record the episode *read*, resolved through the relations a
    # read established. Counted separately from `by_record` because it is a weaker claim than an identifier the ask
    # spelled: a reader has to be able to see how much of a board rests on a resolution rather than on a spelling.
    by_handle = 0
    # R228. Which receipt settled which ask, by **position** in `receipts_of`'s list. The block a reader sees needs the
    # name (`settled_by`); a measurement that asks "did this board account for the call the evaluator required" needs
    # the position, because the call's family and the ask's family are the only thing a name can be compared on and a
    # set ask absorbs several calls under one tick. Recording the position costs nothing and it is the difference
    # between a column that can be recomputed and a column that has to be argued for.
    settled_index: dict = {}
    absorbed_index: dict = {index: [] for index in absorbing}
    for position, receipt in enumerate(receipts):
        hit = False
        for index, item in enumerate(unique):
            if index in settled:
                continue
            grade = settlement(item, receipt, table, records)
            if grade:
                settled[index] = receipt
                settled_index[index] = position
                loose += 1 if grade == "overlap" else 0
                by_record += 1 if grade == "record" else 0
                by_handle += 1 if grade == "handle" else 0
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
                    settled_index[index] = position
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
            absorbed_index[owner].append(position)
            continue
        family_asked = any(item["family"] == receipt["family"] for item in unique)
        (unattributed if family_asked else unrequested).append(receipt)
    return {
        "scope": scope,
        # R236. The rung the board renders at travels with the board, so a board built at the clause scope renders at
        # the clause rung without its caller repeating the pair — one value read by two functions rather than two
        # switches that can disagree, which is how an arm ends up being a third treatment nobody registered.
        "display": "grouped" if scope == CLAUSE else "statement",
        "items": [
            {
                **item,
                "settled_by": (settled.get(index) or {}).get("name"),
                "settledIndex": settled_index.get(index),
                "absorbed": absorbed.get(index, 0),
            }
            for index, item in enumerate(unique)
        ],
        "unattributed": [{"name": receipt["name"]} for receipt in unattributed],
        "unrequested": [{"name": receipt["name"]} for receipt in unrequested],
        "absorbed": sum(absorbed.values()),
        # The positions of the calls this board credited to some ask: the settling call of every ticked ask, plus the
        # calls a set ask absorbed. Anything else the episode wrote is a call the board did not account for, which is
        # what `unrequested` already says by name and what R228's coverage column has to say by position.
        "credited": sorted(
            [position for position in settled_index.values()]
            + [position for positions in absorbed_index.values() for position in positions]
        ),
        # How many of the ticks came from the weaker grade. A reading whose ticks are mostly loose is a reading about
        # a looser rule than the one that was registered, and the number is here so that can be said rather than
        # discovered (see `settlement`).
        "loose": loose,
        "byRecord": by_record,
        "byHandle": by_handle,
        "receipts": len(receipts),
        "names": len(table),
    }


def render(board: dict, state_only: bool = False, display: str = "") -> str:
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

    `display` is the third switch and the same kind of thing: the *rung* the items are shown at, defaulting to the one
    the board was built with. It moves no content — the same asks, the same ticks — and it can only change which of
    them the eight-line window holds. R233 and R234 measured it on transcripts; R236 is the round that shows a model
    the result, so the level a block was rendered at has to be a value this function reads and not a claim its caller
    makes.
    """
    items = board.get("items") or []
    level = display or board.get("display") or "statement"
    unrequested = [] if state_only else (board.get("unrequested") or [])
    unattributed = [] if state_only else (board.get("unattributed") or [])
    if not items and not (unrequested or unattributed):
        return ""
    # The window is filled in the order the rung decides, and the copy is taken before the cut so that `hidden` keeps
    # counting the same board: the fold moves lines out of the window, it does not remove them from the board.
    shown = displayed(items, level)
    where = {
        REQUEST: "from the request",
        CONVERSATION: "from the conversation",
        CLAUSE: "from the request and its later turns",
    }.get(board.get("scope", REQUEST), "from the request")
    # The header promises lines, so it is only printed when there are some: a block that opens "Open asks" and then
    # says nothing about asks is a block a reader has to decode.
    lines = [f"Open asks {where} — a line is ticked only when a tool receipt names it:"] if items else []
    for item in shown[:MAX_ITEMS]:
        mark = "x" if item.get("settled_by") else " "
        line = f"[{mark}] {item['family']}: {' '.join(item['words'][:8])}"
        # A set ask that absorbed calls says so, because the count is the only visible difference between "the board
        # credited this ask once" and "this ask is being performed by four calls". A tick with no count is one call;
        # a tick with `+3` is a set, and a reader who wanted to know whether the agent stopped early can tell.
        if item.get("absorbed"):
            line += f" (+{item['absorbed']} call{'s' if item['absorbed'] > 1 else ''})"
        lines.append(line)
    hidden = len(shown) - MAX_ITEMS
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
    writing = refusing = 0
    spurious_writing = spurious_refusing = 0
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
        left = sum(counts.values())
        spurious += left
        # R227. A task whose evaluator requires no write is a task whose **correct outcome is that nothing happens**:
        # the user still states an ask ("cancel reservation EHGLP3"), the policy refuses it, and an ask that is never
        # settled is the board working rather than noise. Counting those leftovers as spurious is a reading about the
        # corpus's refusals, not about the parser — in the airline manifest it is 29 of 52 — so the two are separated
        # and the split travels in the artefact. Nothing in retail reads it: there, a task with no required write is
        # a task this manifest does not contain.
        if objects:
            writing += 1
            spurious_writing += left
        else:
            refusing += 1
            spurious_refusing += left
    return {
        "tasks": tasks,
        "required": required,
        "found": found,
        "recall": (found / required) if required else None,
        "spurious": spurious,
        "spuriousOnWriting": spurious_writing,
        "spuriousOnRefusing": spurious_refusing,
        "writingTasks": writing,
        "refusingTasks": refusing,
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


def _siblings() -> str:
    """Put this file's own directory on `sys.path`, and answer it.

    The two imports below are lazy — `compare_of` needs Newcombe's interval, `main --compare` needs the merge — and
    both live beside this file rather than in it. `python3 eval/tools/goal_board.py` puts that directory on the path
    by itself; `python3 -m coverage run eval/tools/goal_board.py` does **not**, and CI measures this module through
    `-m` precisely because a suite that only runs one way is a suite that protects one way. The first push carrying
    R219's instrument failed CI for this and nothing else: `ModuleNotFoundError: No module named 'memory_debit'`, on a
    line the local interpreter had been reaching for eleven rounds.

    Idempotent, and the branch is measured: the second call is the one a module imported twice takes.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    return here


def strata_of(reference: dict, treatment: dict, k: int = 1) -> dict:
    """The split a treatment's harm and its gain are read from, on the tasks a *reference* arm solves.

    R216 read this split from two artefacts by hand and quoted it for four rounds; R219 quoted a version of it from a
    shell one-liner and got a different answer from the same documents, which is why it is a function here rather than
    an idiom in a terminal. The reference is normally the no-memory arm: the tasks it solves are the ones a block can
    only damage, and the tasks it fails are the ones a block can only rescue.

        regressions  tasks the reference solves and the treatment does not
        rescues      tasks the reference fails and the treatment does

    Both are counts of the same paired quantity, so they pool across dispatches without an estimator — which is what
    makes a replication cheap — and both are stratified by the **reference**, not by the treatment, because a stratum
    defined by the treated arm's own outcome would make the two counts true by construction.

    `only` is the count of tasks the reference ran and the treatment did not, reported rather than dropped: a treatment
    grid that covers fewer tasks than its reference is a paired reading over a subset, and the number says whether the
    subset is the whole thing.
    """
    left = _attempts_of(reference, k)
    right = _attempts_of(treatment, k)
    shared = sorted(set(left) & set(right), key=_task_key)
    solved = [task for task in shared if left[task] >= 1.0]
    failed = [task for task in shared if left[task] < 1.0]
    return {
        "k": k,
        "shared": len(shared),
        "only": len(set(left) ^ set(right)),
        "solved": len(solved),
        "failed": len(failed),
        "regressions": sum(1 for task in solved if right[task] < 1.0),
        "rescues": sum(1 for task in failed if right[task] >= 1.0),
        "regressionShare": (sum(1 for task in solved if right[task] < 1.0) / len(solved)) if solved else None,
        "rescueShare": (sum(1 for task in failed if right[task] >= 1.0) / len(failed)) if failed else None,
    }


def render_strata(reading: dict, names: tuple[str, str] = ("reference", "treatment")) -> str:
    """One sentence: what the treatment broke of what the reference had, and what it saved of what it did not."""
    regressions, rescues = reading["regressions"], reading["rescues"]
    share = reading["regressionShare"]
    rescue = reading["rescueShare"]
    head = f"{names[1]} against {names[0]}: "
    if not reading["solved"] and not reading["failed"]:
        return head + "no task in common — there is no stratum to read"
    parts = []
    if reading["solved"]:
        parts.append(f"breaks {regressions} of the {reading['solved']} tasks {names[0]} solves ({share:.1%})")
    if reading["failed"]:
        parts.append(f"rescues {rescues} of the {reading['failed']} it does not ({rescue:.1%})")
    tail = f"; {reading['only']} task(s) in one arm only" if reading["only"] else ""
    return head + ", ".join(parts) + tail


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
    _siblings()
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

    # R238. The corpus spells one product twice: the ask in the singular, the catalogue in the plural. A matcher that
    # compares surface forms refuses the settlement and the block keeps asking for work that was done — which is what
    # the trap reader counted as a defect before this round (AUDIT 34.339).
    check("a plural name settles a singular ask", grade_of({"sneakers"}, {"sneaker"}) == "name")
    check("and a singular name settles a plural ask", grade_of({"sneaker"}, {"sneakers"}) == "name")
    check("ies is y", grade_of({"batteries"}, {"battery"}) == "name")
    check("es after a sibilant strips whole", grade_of({"boxes"}, {"box"}) == "name")
    check("es after a vowel strips only the s", grade_of({"shoes"}, {"shoe"}) == "name")
    # The three shapes a naive `rstrip("s")` would merge into something else. Each is a product this catalogue sells.
    check("a three-letter word keeps its s", grade_of({"bus"}, {"bu"}) == "")
    check("a double s is not a plural", grade_of({"glass"}, {"glas"}) == "")
    check("a stem never empties a word", grade_of({"s"}, {"s"}) == "name")

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
    # R217a. The airline domain's vocabulary, appended after the seven retail cues so that no retail request can change
    # its parse. These three assertions and the retail census's unchanged numbers are what hold that claim.
    check("a bag is the baggage family", family_of("add 3 checked bags") == "baggage")
    check("a passenger names its own family", family_of("add my daughter as a passenger") == "passenger")
    check("a booking is the book family", family_of("book a new flight") == "book")
    check("and a reservation is one too", family_of("make a reservation for my friend") == "")
    # The last one is a **deliberate** miss and the reason the round failed: "reservation" alone names no action, and
    # a cue for it would fire on "cancel reservation EHGLP3" if it were ordered before `cancel`. It is asserted as a
    # miss so that a later round which fixes the *contract* rather than the vocabulary has to change this line.
    check("the airline families are receipts too", FAMILIES.get("cancel_reservation") == "cancel"
          and FAMILIES.get("update_reservation_baggages") == "baggage"
          and FAMILIES.get("book_reservation") == "book")
    check("a retail cue still wins over an airline one", family_of("cancel my bag") == "cancel")

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

    # The boundary R231 turns on: the same vocabulary, with inheritance's reach removed. Every assertion below is a
    # mechanism the round's reading depends on, and the first is the one that makes the option a restriction rather
    # than a different parser — a clause that names its own family reads identically either way.
    substitution = "I want to exchange the mechanical keyboard for clicky switches."
    check("a clause that names its own family reads the same without inheritance",
          items_of(substitution, inherit=False) == items_of(substitution))
    check("without inheritance the second object of a substitution is not an ask",
          [item["words"] for item in items_of(
              "You received #W2378156 and want to exchange the mechanical keyboard for a clicky one "
              "and the thermostat for a Google Home one.", inherit=False)] == [["mechanical", "keyboard"]])
    check("and a comma list collapses to the clause that carries the verb",
          [item["words"] for item in items_of("I want to return the cleaner, headphone, and smart watch.",
                                              inherit=False)] == [["cleaner"]])
    check("a later clause with a cue of its own survives the boundary", [item["family"] for item in items_of(
        "I want to return the lamp and exchange the keyboard.", inherit=False)] == ["return", "exchange"])
    check("a negation is read the same way at the boundary", items_of(
        "Return the lamp but do not exchange the keyboard.", inherit=False) == items_of(
        "Return the lamp but do not exchange the keyboard."))
    check("a message with no cue at all has no asks at the boundary",
          items_of("Yes, the purple one.", inherit=False) == [])
    check("and the same message is one ask inside a request", [item["words"] for item in items_of(
        "Return the lamp. Yes, the purple one.")] == [["lamp"]])
    check("the boundary stops at a sentence boundary too", len(items_of(
        "Return the lamp. Yes, the purple one.", inherit=False)) == 1)

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

    # R228 / AUDIT 34.320. The pair is positional over **every** call, not over the write calls: a write that follows a
    # read is answered by the result that follows the read's. Counting writes only made a write inherit a verdict from
    # the read before it, in both directions, and this is the pair of assertions that would have caught it.
    after_a_failed_read = receipts_of([
        {"role": "assistant", "tool_calls": [{"name": "get_order_details", "arguments": {"order_id": "#W1"}}]},
        {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]},
        {"role": "tool", "content": "Error: no such order", "error": True},
        {"role": "tool", "content": json.dumps({"success": True})},
    ])
    check("a write's verdict is the write's result, not the read's",
          after_a_failed_read[0]["ok"] is True)
    after_a_good_read = receipts_of([
        {"role": "assistant", "tool_calls": [{"name": "get_order_details", "arguments": {"order_id": "#W1"}}]},
        {"role": "assistant", "tool_calls": [{"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]},
        {"role": "tool", "content": json.dumps({"order_id": "#W1"})},
        {"role": "tool", "content": "Error: order is delivered", "error": True},
    ])
    check("and a refused write is refused even after a successful read",
          after_a_good_read[0]["ok"] is False)
    check("the receipt carries the position of its own call", after_a_good_read[0]["position"] == 1)

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

    # R238. The record grade: the ask names an order the receipt carries, and the ask names no product the episode has
    # read — so a product name cannot settle it and the family rule below would settle whichever ask of the family came
    # first. `#W7449508` is a real order id from the lane's control grid, and "sneaker" is how its own user asked.
    sneaker = {"family": "return", "words": ["sneaker"], "clause": "return just the sneaker from order #W7449508"}
    return_receipt = {"family": "return", "ok": True, "ids": ["#W7449508", "6477915553"], "free": []}
    check("an ask that names the receipt's record is settled at the record grade",
          settlement(sneaker, return_receipt, {}) == "record")
    check("a receipt for another order settles nothing",
          settlement(sneaker, {**return_receipt, "ids": ["#W9319364"]}, {}) == "")
    check("an ask that names no record is not settled at that grade",
          settlement({"family": "return", "words": ["sneaker"], "clause": "return the sneaker"},
                     return_receipt, {}) == "")
    check("a product name in the table still settles at the name grade, not the record grade",
          settlement({**sneaker, "words": ["sneakers"]}, return_receipt, {"6477915553": "Sneakers"}) == "name")
    check("and a product the table holds is refused by a receipt for a different product",
          settlement({"family": "return", "words": ["espresso", "machine"],
                      "clause": "return the espresso machine from order #W7449508"},
                     return_receipt, {"6477915553": "Sneakers", "6200867091": "Espresso Machine"}) == "")
    # R240. The grammar of a record identifier is not one domain's habit. Two shapes a user actually types were
    # unreadable: the order id **without** its `#` ("my order W4284542", 53 of the 2,744 user strings in the control
    # grid), and a phone number ("the line is 555-123-2002"), which is the only handle a telecom request ever gives.
    # A rule that cannot read them reads **zero** on that domain, and a zero is indistinguishable from a corpus whose
    # requests name nothing — the failure mode R238 found one level down.
    check("R240: an order id without its hash names the record",
          records_in("my order W4284542 is late") == {"w4284542"})
    check("R240: a phone number names a record",
          records_in("the line is 555-123-2002 and has no data") == {"555-123-2002"})
    check("R240: the hash form is unchanged",
          records_in("order #W7449508") == {"#w7449508"})
    check("R240: a bare number that names nothing is still not a record",
          records_in("I have 2025 dollars and 2 items") == set())
    # Both sides have to read the same shapes, or the grade stays unreachable: the receipt is where `L1002` and the
    # phone number arrive, and `_id_values` collects neither under a rule written for ten-digit item ids.
    telecom_ok = receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
                              "arguments": {"customer_id": "C1001", "line_id": "L1002", "gb": 2.0}}]},
                              {"role": "tool", "content": "{}"}])
    check("R240: the receipt side reads a short prefixed id",
          sorted(telecom_ok[0]["ids"]) == ["C1001", "L1002"])
    phone_ok = receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
                             "arguments": {"phone_number": "555-123-2002"}}]},
                            {"role": "tool", "content": "{}"}])
    check("R240: and a phone number", phone_ok[0]["ids"] == ["555-123-2002"])
    zip_ok = receipts_of([{"role": "assistant", "tool_calls": [{"name": "cancel_pending_order",
                          "arguments": {"zip": "19122", "item_ids": ["6477915553"]}}]},
                          {"role": "tool", "content": "{}"}])
    check("R240: a five-digit zip is still not an identifier", zip_ok[0]["ids"] == ["6477915553"])
    # An order-level write: `cancel_pending_order` carries the order and nothing else, so a product-naming ask about
    # that order has nothing to be compared against and would otherwise stay open after the order was cancelled.
    cancel_order = {"family": "cancel", "ok": True, "ids": ["#W5481803"], "free": []}
    check("an order-level receipt settles a product-naming ask that names its order",
          settlement({"family": "cancel", "words": ["boot"], "clause": "cancel the entire order #W5481803 (both the boots"},
                     cancel_order, {"6200867091": "Hiking Boots"}) == "record")
    check("and the same receipt settles nothing about another order",
          settlement({"family": "cancel", "words": ["boot"], "clause": "cancel the entire order #W1111111"},
                     cancel_order, {"6200867091": "Hiking Boots"}) == "")
    check("a receipt that carries a product is still refused by name",
          settlement({"family": "cancel", "words": ["boot"], "clause": "cancel order #W5481803"},
                     {**cancel_order, "ids": ["#W5481803", "6200867091"]}, {"6200867091": "Kettle"}) == "")

    # R241. The handle grade: the record the episode **read**. A telecom request names its line by a phone number, the
    # write carries `line_id` / `customer_id`, and no string comparison can bridge the two — R240 measured that gap at
    # zero of eight. The bridge is the read the agent had to make to answer at all, so the board anchors on it rather
    # than on a copy of the database. The transcript below is the shape of every τ² telecom episode: the caller states
    # the number, the agent resolves it to an account, then reads the line.
    telecom = [
        {"role": "user", "content": "My mobile data is not working. My phone number is 555-123-2002."},
        {"role": "assistant", "tool_calls": [{"name": "get_customer_by_phone",
                                              "arguments": {"phone_number": "555-123-2002"}}]},
        {"role": "tool", "content": json.dumps({"customer_id": "C1001", "phone_number": "555-123-2002",
                                                "line_ids": ["L1001", "L1002", "L1003"]})},
        {"role": "assistant", "tool_calls": [{"name": "get_details_by_id", "arguments": {"line_id": "L1002"}}]},
        {"role": "tool", "content": json.dumps({"line_id": "L1002", "phone_number": "555-123-2002",
                                                "status": "Active"})},
    ]
    read = read_records(telecom)
    check("the read types the phone as the line that claims it", read["phones"] == {"555-123-2002": "l1002"})
    check("and keeps the account the line belongs to", read["owners"]["l1002"] == "c1001")
    check("and knows which ids it has seen", read["known"]["l1002"] == {LINE} and read["known"]["c1001"] == {CUSTOMER})
    check("an ask about the number resolves to that line and its account",
          handles_in("the line is 555-123-2002", read) == {(LINE, "l1002"), (CUSTOMER, "c1001")})
    check("and to no sibling line",
          not any(key == LINE and name in ("l1001", "l1003") for key, name in handles_in("555-123-2002", read)))
    check("a token nothing was read for stays untyped",
          handles_in("order #W7449508 is late", read) == {("", "#w7449508")})
    check("a phone that is only an account's resolves to the account",
          handles_in("555-123-1002 is my number", read_records([{"role": "tool", "content": json.dumps(
              {"customer_id": "C1002", "phone_number": "555-123-1002", "line_ids": ["L1004"]})}]))
          == {(CUSTOMER, "c1002")})

    def telecom_receipt(name: str, arguments: dict) -> dict:
        return receipts_of([{"role": "assistant", "tool_calls": [{"name": name, "arguments": arguments}]},
                            {"role": "tool", "content": "{}"}])[0]

    resume = telecom_receipt("resume_line", {"customer_id": "C1001", "line_id": "L1002"})
    check("the receipt's keys are typed by the argument that carried them",
          receipt_keys(resume) == {(LINE, "l1002"), (CUSTOMER, "c1001")})
    check("a hand-built receipt without arguments falls back to its untyped ids",
          receipt_keys({**return_receipt}) == {("", "#w7449508"), ("", "6477915553")})
    check("the lattice refuses two different lines of the same account",
          same_record({(LINE, "l1002"), (CUSTOMER, "c1001")},
                      {(LINE, "l1003"), (CUSTOMER, "c1001")}) is False)
    check("and settles the account-level write it can reach",
          same_record({(LINE, "l1002"), (CUSTOMER, "c1001")},
                      {(CUSTOMER, "c1001"), (BILL, "b1234321")}) is True)
    check("and refuses a sibling's account-level write",
          same_record({(LINE, "l1002"), (CUSTOMER, "c1001")}, {(CUSTOMER, "c1002")}) is False)
    check("a wordless pair settles nothing", same_record(set(), set()) is False)

    # The grade, end to end on the transcript: the same write is a `handle` tick, a sibling is refused, and the
    # account-level write is credited — which is the three-way split R240 could only report as 0/8 or 8/8.
    ask = {"family": "resume", "words": ["mobile", "data"], "clause": "my mobile data is not working, 555-123-2002"}
    check("a write on the line the caller named is settled at the handle grade",
          settlement(ask, resume, {}, read) == "handle")
    check("a write on a sibling line of the same account is refused",
          settlement(ask, telecom_receipt("suspend_line", {"customer_id": "C1001", "line_id": "L1003"}), {}, read) == "")
    check("a write that names only the account is settled",
          settlement({**ask, "family": "payment"},
                     telecom_receipt("send_payment_request", {"customer_id": "C1001", "bill_id": "B1234321"}),
                     {}, read) == "handle")
    check("R240 is unchanged where nothing was read: the same ask reaches nothing",
          settlement(ask, resume, {}, {}) == "")
    check("and where nothing was read the grade is the record grade, not the handle grade",
          settlement({"family": "return", "words": ["sneaker"], "clause": "return the sneaker from order #W7449508"},
                     return_receipt, {}) == "record")
    # The board carries both counts: a reader has to be able to see how much of a tick list rests on a resolution the
    # episode performed rather than on an identifier the ask spelled.
    handled_board = board_of(telecom[:1] + telecom[1:])
    check("the board counts its handle ticks separately", handled_board["byHandle"] == 0)

    # The edges of the resolver, one per shape the corpus can produce. Each is a case where a rule written for the
    # happy path would either over-credit or silently produce an untyped key that looks like a comparison.
    check("a non-string clause names no record", records_in(None) == set() and handles_in(None, read) == set())
    check("a tool result that is not text is skipped", read_records([{"role": "tool", "content": ["L1002"]}])["known"] == {})
    check("a line with no number of its own types nothing",
          read_records([{"role": "tool", "content": json.dumps({"line_id": "L9"})}])["phones"] == {})
    check("a line whose account was never read still names itself",
          handles_in("555-999-9999", read_records([
              {"role": "tool", "content": json.dumps({"line_id": "L9", "phone_number": "555-999-9999"})}]))
          == {(LINE, "l9")})
    check("an account with no number of its own types nothing",
          read_records([{"role": "tool", "content": json.dumps({"customer_id": "C9", "line_ids": ["L9"]})}])["accounts"] == {})
    check("a line_ids entry that is not a name is skipped",
          read_records([{"role": "tool", "content": json.dumps(
              {"customer_id": "C9", "line_ids": ["L9", 7, ""]})}])["owners"] == {"l9": "c9"})
    bill_read = read_records([{"role": "tool", "content": json.dumps(
        {"bill_id": "B9", "customer_id": "C9", "total_due": 1.0})}])
    check("a bill is a record and its owner is its account",
          bill_read["known"]["b9"] == {BILL} and bill_read["owners"]["b9"] == "c9")
    check("an id the transcript has shown is typed even when the ask writes it bare",
          handles_in("L1003 is suspended", read) == {(LINE, "l1003")})
    check("a bill with no account prints no owner",
          read_records([{"role": "tool", "content": json.dumps({"bill_id": "B8"})}])["owners"] == {})
    check("an argument name that is not a string carries no type",
          receipt_keys({"args": {1: "A1001", "line_id": "A1001"}}) == {(LINE, "a1001")})
    # Four suffixes, because a corpus uses both `_id` and `_ids` and a hand-built reader may use neither separator.
    for name, kind in (("line_id", LINE), ("item_ids", "item"), ("orderids", "order"), ("customerid", CUSTOMER)):
        check(f"`{name}` types its value as `{kind}`",
              receipt_keys({"args": {name: ["A1001"]}}) == {(kind, "a1001")})
    check("a field that is not an id argument carries no type",
          receipt_keys({"args": {"note": "A1001", "ids": ["A1001"]}}) == set())
    # The vocabulary, bound to the manifest both repositories read. The board can return four grades and the product
    # declared two of them until R241 — a divergence that no test could see, because the declaration was never compared
    # with what the rule produces. This is the comparison: add a grade here without declaring it and the product's
    # manifest stops describing the artefact it ships, which fails on both sides at once.
    serving = json.loads((Path(__file__).resolve().parents[1] / "manifests" / "serving-defaults.json").read_text())
    check("every grade this board can return is one the serving manifest declares",
          {"name", "overlap", "record", "handle"} == set(serving["defaults"]["settlementGrades"]))

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

    # R236. The clause scope and the display ladder, as the product's own renderer reads them. Three rounds measured the
    # admission (R231), the order (R233) and the fold (R234) on transcripts; this round is the one that shows a model
    # the result, so every assertion below is about the *served* block and not about a reading of it.
    talked = [
        {"role": "user", "content": "I want to exchange the mechanical keyboard."},
        {"role": "assistant", "content": "Which keycap set would you like?"},
        {"role": "user", "content": "not that one, return the lamp, and the chair"},
    ]
    by_clause = board_of(talked, CLAUSE)
    by_every = board_of(talked, CONVERSATION)
    check("the clause board drops the object an answer only inherited",
          [item["words"] for item in by_clause["items"]] == [["mechanical", "keyboard"], ["lamp"]])
    check("and reading every turn keeps it", len(by_every["items"]) == 3)
    check("the clause board contains the request's asks",
          {(item["family"], tuple(item["words"])) for item in board_of(talked)["items"]}
          <= {(item["family"], tuple(item["words"])) for item in by_clause["items"]})
    boundary = clause_items(talked)
    check("the boundary counts what only inheritance reached",
          (boundary["offered"], boundary["kept"], boundary["refusedInherited"]) == (3, 2, 1))
    check("and names the turn that stated the contract", boundary["contract"] == 0)
    quiet_contract = [
        {"role": "user", "content": "Hello!"},
        {"role": "assistant", "content": "Hi — how can I help?"},
        {"role": "user", "content": "cancel the order I placed yesterday"},
    ]
    check("the contract is the first turn that states an ask, not turn one",
          clause_items(quiet_contract)["contract"] == 1)
    blank_first = clause_items([{"role": "user", "content": "   "}, {"role": "user", "content": "cancel the order"}])
    check("a blank turn is counted and contributes no ask, so the contract is the turn after it",
          (blank_first["turns"], blank_first["contract"], len(blank_first["asks"])) == (2, 1, 1))
    check("a clause board carries the rung it renders at", by_clause["display"] == "grouped")
    check("and a request board carries the shipped one", board_of(talked)["display"] == "statement")
    check("the block says where its asks came from", "later turns" in render(by_clause))
    refused_scope = False
    try:
        board_of([], "everything")
    except ValueError:
        refused_scope = True
    check("an unknown scope is refused rather than defaulted to the request's", refused_scope)

    # The ladder itself, on items whose shape is the product's: a settled tick, a repeated family, and a family that
    # only appears after the repetition. `grouped` has to differ from `open` on the third case or it is not a fold.
    ladder = [
        {"family": "address", "words": ["street"], "settled_by": "modify_user_address"},
        {"family": "cancel", "words": ["order"], "settled_by": None},
        {"family": "address", "words": ["city"], "settled_by": None},
    ]
    check("the shipped display is the statement's, item for item", displayed(ladder) == ladder)
    check("open puts the unresolved asks first and keeps statement order inside each group",
          [item["family"] for item in displayed(ladder, "open")] == ["cancel", "address", "address"])
    restated = [
        {"family": "cancel", "words": ["one"], "settled_by": None},
        {"family": "cancel", "words": ["two"], "settled_by": None},
        {"family": "address", "words": ["street"], "settled_by": None},
    ]
    check("grouped lifts the second family's first line ahead of the repetition",
          [item["words"][0] for item in displayed(restated, "grouped")] == ["one", "street", "two"])
    check("and it removes nothing and settles nothing",
          sorted(str(item) for item in displayed(restated, "grouped")) == sorted(str(item) for item in restated))
    check("every rung contains the one before it",
          [item["words"][0] for item in displayed(restated, "open")] == [item["words"][0] for item in restated])
    refused_display = False
    try:
        displayed(restated, "sorted-by-length")
    except ValueError:
        refused_display = True
    check("an unknown rung is refused rather than defaulted to the statement's", refused_display)
    # What the ladder buys, measured on the window rather than on the list: the same board, ten items, nine of them one
    # obligation. At the shipped rung the tenth never reaches the agent; at the folded rung it does — and the block's
    # own count of what it hid is unchanged, because the fold moves lines out of the window rather than off the board.
    repeated_lines = {"items": [{"family": "address", "words": [str(index)], "settled_by": None} for index in range(9)]
                               + [{"family": "modify", "words": ["late"], "settled_by": None}]}
    check("the shipped render spends its eight lines on one obligation nine times",
          "modify: late" not in render(repeated_lines))
    check("the folded render puts the tenth item's family in the window",
          "modify: late" in render(repeated_lines, display="grouped"))
    check("and the block still says how many lines it is not showing",
          "and 2 more" in render(repeated_lines, display="grouped"))
    manifest = json.loads((Path(__file__).resolve().parents[1] / "manifests" / "serving-defaults.json").read_text())
    check("the window is the line budget the product ships, read from the manifest",
          MAX_ITEMS == manifest["defaults"]["blockLines"])

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
    # R227. A spare ask on a task whose correct outcome is no write is not the same finding as a spare ask on a task
    # that had work to do, and the airline manifest is mostly the first kind. The split is a field, not a paragraph.
    refusals = {"tasks": [
        {"id": "0", "reason": "I want to return the lamp.", "writes": [{"name": "return_delivered_order_items",
                                                                        "objects": 1}]},
        {"id": "1", "reason": "I want to cancel the order.", "writes": []},
        {"id": "2", "reason": "hello", "writes": []},
    ]}
    split = census(refusals)
    check("a task with no required write is a refusal task", split["refusingTasks"] == 2)
    check("and a task with one is a writing task", split["writingTasks"] == 1)
    check("a spare ask is charged to the refusal task that made it", split["spuriousOnRefusing"] == 1)
    check("a writing task with nothing spare charges nothing", split["spuriousOnWriting"] == 0)
    check("the split adds up to the whole", split["spuriousOnRefusing"] + split["spuriousOnWriting"] == split["spurious"])
    check("a correct ask on a refusal task is still spare", split["found"] == 1 and split["recall"] == 1.0)

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

    # R219's stratum split, which was quoted from a shell one-liner once and disagreed with the documents. The
    # fixture is the smallest one with all four counts distinct: the reference solves 0 and 1, fails 2 and 3; the
    # treatment solves 0 and 2, so it breaks 1 and rescues 2 and leaves 3 alone.
    split = strata_of(arm({"0": 1, "1": 1, "2": 0, "3": 0}), arm({"0": 1, "1": 0, "2": 1, "3": 0}))
    check("a broken task is counted against the reference's own outcome",
          (split["regressions"], split["rescues"]) == (1, 1))
    check("and the strata are the reference's", (split["solved"], split["failed"]) == (2, 2))
    check("the shares are over each stratum", (split["regressionShare"], split["rescueShare"]) == (0.5, 0.5))
    check("the sentence says both halves",
          render_strata(split, ("control", "policy")) ==
          "policy against control: breaks 1 of the 2 tasks control solves (50.0%), rescues 1 of the 2 it does not "
          "(50.0%)")
    check("a task only one arm ran is counted rather than dropped",
          strata_of(arm({"0": 1, "1": 1}), arm({"0": 1}))["only"] == 1)
    lonely_split = strata_of(arm({"0": 1}), arm({"1": 1}))
    check("no shared task is no stratum", (lonely_split["solved"], lonely_split["failed"]) == (0, 0))
    check("and the sentence refuses rather than divides",
          render_strata(lonely_split).endswith("there is no stratum to read"))
    one_sided = strata_of(arm({"0": 1}), arm({"0": 0}))
    check("a reference that solved everything says nothing about rescues",
          "rescues" not in render_strata(one_sided))
    other_side = strata_of(arm({"0": 0}), arm({"0": 1}))
    check("and a reference that solved nothing says nothing about regressions",
          "breaks" not in render_strata(other_side) and "rescues 1 of the 1" in render_strata(other_side))
    check("a task only one arm ran is named in the sentence",
          "1 task(s) in one arm only" in render_strata(
              strata_of(arm({"0": 1, "1": 1}), arm({"0": 1})), ("control", "policy")))

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
    here = _siblings()
    check("the module finds its own directory", here == os.path.dirname(os.path.abspath(__file__)))
    # Idempotent asserted as "the second call changes nothing", not as "the directory appears once": script mode has
    # already put it on the path under the spelling it was typed (`eval/tools`) and this function adds the absolute
    # one, so a count would be measuring two spellings of one directory rather than a duplicate import root.
    untouched = list(sys.path)
    check("and does it once", _siblings() == here and sys.path == untouched)
    # The other branch, forced: the directory taken off the path and asked for again. This is the state the runner
    # was in — `-m` in front of the interpreter leaves the working directory first and the script's directory
    # nowhere — and it is the branch that failed a build when it was unexercised.
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != here]
    check("and puts it back when it is missing", _siblings() == here and here in sys.path)
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
        check("the stratum split runs from two documents", quiet(["--strata", left, right]) == 0)
        check("and reads as json", quiet(["--strata", left, right, "--json"]) == 0)
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
    parser.add_argument("--strata", nargs=2, default=None, metavar=("REFERENCE", "TREATMENT"),
                        help="two result documents: what the treatment breaks of what the reference solves, and what it rescues")
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
                f"are mentioned ({reading['familyRecall']:.1%}); {reading['spurious']} spare ask(s), "
                f"{reading['spuriousOnRefusing']} of them on the {reading['refusingTasks']} task(s) whose correct "
                f"outcome is no write (precision {reading['precision']:.1%} over every ask); "
                f"{reading['tasksCovered']}/{reading['tasks']} tasks fully covered"
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
    if arguments.strata:
        documents = []
        for path in arguments.strata:
            with open(path, "r", encoding="utf-8") as handle:
                documents.append(json.load(handle))
        reading = strata_of(documents[0], documents[1], k=max(1, arguments.k))
        if arguments.json:
            print(json.dumps(reading, indent=1, sort_keys=True))
        else:
            print(render_strata(reading, names=(Path(arguments.strata[0]).stem, Path(arguments.strata[1]).stem)))
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
        _siblings()
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
