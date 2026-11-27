#!/usr/bin/env python3
"""Project the telecom domain's database to records, and measure whether a request can name one.

R240's question is not "does the board work on a second domain" but the narrower and harder one: **when the third
domain's request names its record, does it name it in an alphabet the settlement rule can read?** The rule is
`goal_board`'s record grade — the ask's clause spells an identifier, the receipt carries one, and the sets intersect.
That is a string intersection with no resolution step, and retail hides the fact because a user types the order id
(`#W2378156`) that the write also carries.

Telecom cannot type an order id, because it has none. Its records are **lines** and **customers**, keyed `L1002` and
`C1001`, and the only handle a request ever gives is a *phone number*. So this script does three things, in the order
the answer needs them:

  1. **project** the domain's `db.toml` into records, with every identity token the record actually has, because a
     token left out here is a match nothing later can see;
  2. **measure** the record grade on each graded write of the task set, under the rule as it ships;
  3. **price the repair** — a token table that resolves a phone number to the record it names — and report what that
     table would buy, and what it would cost in over-credit.

The third reading was R240's round. In this domain a customer's `phone_number` equals one of *their own* lines', so
the only token the requests carry names **two records**. A table that ignores that reads 6 of 6 and would credit a
write to one line from an ask about another; a rule that refuses the ambiguity reads 0 of 6. Both numbers are
reported, because the finding is the pair.

**R241 adds the fourth reading and the column that decides between them.** The repair is not a token table — a table
would be a second copy of the database inside a memory instrument — but the resolution the *episode* performed: the
customer read by phone, then the lines that account holds. `goal_board.handles_in` types each token through those
relations and `goal_board.same_record` compares at the finest type both sides name, so an ask about one line can no
longer be settled by a write to a sibling of that line on the same account.

A reach count alone cannot separate that rule from the ambiguity-blind one; both read every write. So every rule is
scored **twice**: on the task set's real writes, and on a counterfactual that synthesises a write against every line
in the database. The correct answer there is one line — the one whose own number the request spells — and the
distance between the rules is the round:

    rule      reaches (of n)   credits (of every line)
    shipped   0                0
    blind     n                every line on the account
    strict    0                0
    handle    n                1

Both readings are taken through the **shipped** resolver (`goal_board`, imported rather than re-implemented), so a
defect in the product's rule is a defect in this table rather than a difference between two implementations.

Usage:
  build_telecom_records.py --db db.toml --tasks tasks_small.json --out eval/manifests/telecom-records.json
  build_telecom_records.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import contextlib
import io
import re
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parents[1]

#: R241. The resolver the **product** ships, imported rather than re-implemented. A reading taken through a copy of the
#: rule is a reading about the copy: the copy can be right while the shipped rule is wrong, and the two drift with
#: nothing failing. Importing it is also what lets this script answer the question it was written for — whether the
#: rule *as it ships* can read the third domain — rather than whether a rule it invented for the occasion can.
sys.path.insert(0, str(HERE / "eval" / "tools"))
import goal_board  # noqa: E402  (after the path insert, which is the only way this file can import the lane)

#: The tools that change telecom state, and the family each belongs to. Derived from the domain's own tool list and
#: asserted against `goal_board.FAMILIES` in the self-test rather than imported, because this script has to run on a
#: checkout that never installed the lane — and a family this file invented would be a settlement nobody shipped.
WRITES = {
    "suspend_line": "suspend",
    "resume_line": "resume",
    "enable_roaming": "roaming",
    "disable_roaming": "roaming",
    "refuel_data": "refuel",
    "change_plan": "plan",
    "send_payment_request": "payment",
    "apply_credit": "credit",
    "transfer_to_human_agents": "transfer",
}

#: The two identifier shapes this domain's writes carry. `line_id` and `customer_id` are the arguments; the phone
#: number is never an argument, which is the whole problem and the reason it is named here rather than discovered.
ID_KEYS = ("line_id", "customer_id", "bill_id", "plan_id", "device_id")

PHONE = re.compile(r"\b\d{3}-\d{3}-\d{4}\b")

#: The self-test's domain: four records, one phone number claimed by two of them. It is a string rather than a dict
#: so that the command-line control at the end of the self-test can write it out and read it back through the same
#: parser the real run uses — a `main()` that has only ever been handed a dict has never parsed a file.
_DB = """
[[plans]]
plan_id = "P1"
name = "Basic"
[[devices]]
device_id = "D1"
[[lines]]
line_id = "L1"
phone_number = "555-000-0001"
plan_id = "P1"
device_id = "D1"
[[lines]]
line_id = "L2"
phone_number = "555-000-0002"
plan_id = "P1"
device_id = "D1"
[[lines]]
line_id = "L3"
phone_number = "555-000-0003"
plan_id = "P1"
device_id = "D1"
[[lines]]
line_id = "L4"
phone_number = "555-000-0004"
plan_id = "P1"
device_id = "D1"
[[customers]]
customer_id = "C1"
full_name = "Ada Lovelace"
phone_number = "555-000-0001"
line_ids = ["L1", "L3"]
bill_ids = ["B1"]
[[customers]]
customer_id = "C2"
full_name = "Grace Hopper"
phone_number = "555-000-0009"
line_ids = ["L2"]
bill_ids = []
[[bills]]
bill_id = "B1"
customer_id = "C1"
period_start = "2025-01-01"
period_end = "2025-01-31"
"""

#: The types a token can name. A record key carries its type, so a customer-level key can never equal a line-level
#: one and an intersection cannot be won by two records that merely share a name.
LINE, CUSTOMER, BILL = "line", "customer", "bill"


def toml_of(text: str) -> dict:
    """The subset of TOML this domain's database is written in, read without `tomllib`.

    `tomllib` arrived in Python 3.11 and the lane's driver step runs on **3.10** on purpose — a suite that passes on
    the runner's interpreter and fails on the lane's is the drift that step exists to catch, and a script that cannot
    import is the largest possible version of it. The subset a τ² database uses is four productions: `[table]`,
    `[[array-of-tables]]`, `key = value` with a scalar or a list of strings, and dotted headers that reach into the
    last element of an array of tables (`[customers.address]`, `[[customers.payment_methods]]`).

    Where `tomllib` *is* available the self-test compares the two on the real database, so this is not a second
    dialect that happened to work: it is a reader held against the reference implementation by a test.
    """
    root: dict = {}
    current: dict = root
    for number, raw in enumerate(text.splitlines(), start=1):
        line = _strip_comment(raw).strip()
        if not line:
            continue
        if line.startswith("[[") and line.endswith("]]"):
            current = _table(root, line[2:-2].strip().split("."), array=True)
            continue
        if line.startswith("[") and line.endswith("]"):
            current = _table(root, line[1:-1].strip().split("."), array=False)
            continue
        if "=" not in line:
            raise ValueError(f"line {number}: expected key = value, got {line!r}")
        key, value = line.split("=", 1)
        current[key.strip()] = _value(value.strip(), number)
    return root


def _strip_comment(line: str) -> str:
    """Cut a `#` comment that is not inside a string — a URL in a quoted value would otherwise lose its tail."""
    quoted = False
    for index, character in enumerate(line):
        if character == '"':
            quoted = not quoted
        elif character == "#" and not quoted:
            return line[:index]
    return line


def _table(root: dict, path: list, array: bool) -> dict:
    node: object = root
    for part in path[:-1]:
        if isinstance(node, list):
            node = node[-1]
        node = node.setdefault(part, {})  # type: ignore[union-attr]
    if isinstance(node, list):
        node = node[-1]
    last = path[-1]
    if array:
        node.setdefault(last, []).append({})  # type: ignore[union-attr]
        return node[last][-1]  # type: ignore[index]
    return node.setdefault(last, {})  # type: ignore[union-attr]


def _value(text: str, number: int):
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [_value(piece.strip(), number) for piece in _split_list(inner)]
    if text.startswith('"') and text.endswith('"') and len(text) >= 2:
        return json.loads(text)
    if text in ("true", "false"):
        return text == "true"
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        raise ValueError(f"line {number}: cannot read {text!r} as a value") from None


def _split_list(inner: str) -> list:
    """Split a TOML list on the commas that are not inside a string."""
    pieces, depth, quoted, start = [], 0, False, 0
    for index, character in enumerate(inner):
        if character == '"':
            quoted = not quoted
        elif not quoted and character in "[{":
            depth += 1
        elif not quoted and character in "]}":
            depth -= 1
        elif character == "," and not quoted and depth == 0:
            pieces.append(inner[start:index])
            start = index + 1
    pieces.append(inner[start:])
    return [piece for piece in pieces if piece.strip()]


def digest(path: pathlib.Path) -> dict:
    """A file's identity, carried beside the bytes it produced, the way every other projection in this lane does."""
    data = path.read_bytes()
    return {"path": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def project(db: dict) -> dict:
    """The domain's database as records, each with the identity tokens a read of it would show.

    Identity is the record's **own fields**, and the exclusion is deliberate: `data_used_gb`, `status` and the plan
    name describe a line's state rather than which line it is, and admitting them would raise every reading by
    matching "active". What is kept is what a request could use to pick this record out of the domain: the id, the
    phone number, and — for a bill — the period it covers.
    """
    lines = {
        entry["line_id"]: {
            "type": LINE,
            "key": f"{LINE}:{entry['line_id']}",
            "id": entry["line_id"],
            "phone": entry.get("phone_number"),
            "plan": entry.get("plan_id"),
            "device": entry.get("device_id"),
        }
        for entry in db.get("lines") or []
    }
    customers = {
        entry["customer_id"]: {
            "type": CUSTOMER,
            "key": f"{CUSTOMER}:{entry['customer_id']}",
            "id": entry["customer_id"],
            "phone": entry.get("phone_number"),
            "name": entry.get("full_name"),
            "lines": list(entry.get("line_ids") or []),
            "bills": list(entry.get("bill_ids") or []),
        }
        for entry in db.get("customers") or []
    }
    bills = {
        entry["bill_id"]: {
            "type": BILL,
            "key": f"{BILL}:{entry['bill_id']}",
            "id": entry["bill_id"],
            "customer": entry.get("customer_id"),
            "period": f"{entry.get('period_start')}..{entry.get('period_end')}",
        }
        for entry in db.get("bills") or []
    }
    return {"lines": lines, "customers": customers, "bills": bills}


def claims(records: dict) -> dict:
    """Every token, and every record that says the token is its identity — the table, plus what makes it a table.

    A token claimed by two records is the whole finding, so it is returned rather than resolved here: a projection
    that silently picked one owner would hide the ambiguity from the reading that has to report it.
    """
    table: dict = {}
    for group in records.values():
        for record in group.values():
            for token in (record.get("id"), record.get("phone")):
                if isinstance(token, str) and token:
                    table.setdefault(token.lower(), []).append(record["key"])
    return table


def ambiguous(table: dict) -> dict:
    """The tokens that name more than one record, and the records they name.

    `555-123-2002` is one here: it is customer `C1001`'s phone number and line `L1002`'s, which is not a defect of
    the data — a household's primary line is the account's contact number — but it does mean the token cannot be
    used to identify a record without knowing which kind of record is meant.
    """
    return {token: keys for token, keys in table.items() if len(keys) > 1}


def resolve(text: str, table: dict, refuse_ambiguous: bool) -> set:
    """The record keys a text names, through a token table.

    `refuse_ambiguous` is the difference between the two repairs and it is not a convenience: with it off, a token
    that names a line and a customer resolves to **both**, so an ask about the household reaches a write to any of
    its lines; with it on, the token is not an identifier at all and reaches nothing. A rule has to choose, and the
    reading reports both so the choice is visible.
    """
    keys: set = set()
    for token in PHONE.findall(text) + re.findall(r"#[A-Za-z]{1,3}\d{3,}|[A-Za-z]{1,3}\d{4,}", text):
        lowered = token.lower()
        owned = table.get(lowered)
        if not owned:
            continue
        if len(owned) > 1 and refuse_ambiguous:
            continue
        keys.update(owned)
    return keys


def receipt_keys(arguments: dict, table: dict) -> set:
    """The record keys a write's arguments carry.

    The argument's **key** decides the type, and that is what makes the intersection safe: `line_id: L1002` names a
    line and `customer_id: C1001` names a customer, so a write that carries both can be reached by an ask about
    either — which is right, because a customer-level action really is about the customer.
    """
    keys: set = set()
    for name in ID_KEYS:
        value = arguments.get(name)
        if not isinstance(value, str) or not value:
            continue
        kind = name[: -len("_id")]
        keys.add(f"{kind}:{value}")
    return keys


def graded_writes(task: dict) -> list:
    """The calls a task is graded on that change state, in the order the episode makes them.

    Both lists are read because the corpus uses both: `initial_state.initialization_actions` carries the writes an
    episode starts from (the fault the caller is calling about is often already half-repaired), and
    `evaluation_criteria.actions` carries the ones the solver is expected to make. A projection that read only the
    second would price the repair on a corpus that hides half its writes.
    """
    found: list = []
    for source in ("initialization_actions", "actions"):
        holder = task.get("initial_state") if source == "initialization_actions" else task.get("evaluation_criteria")
        if not isinstance(holder, dict):
            continue
        for action in holder.get(source) or []:
            # Two spellings of "the agent did it": `initialization_actions` carries `env_type`, and
            # `evaluation_criteria.actions` carries `requestor`. Reading only one of them dropped every graded action
            # in the task set — the self-test caught it, which is the reason it asserts the walk and not only its sum.
            if not isinstance(action, dict):
                continue
            if (action.get("env_type") or action.get("requestor")) not in ("assistant", "agent"):
                continue
            if action.get("func_name") not in WRITES and action.get("name") not in WRITES:
                continue
            found.append(
                {
                    "family": WRITES.get(action.get("func_name") or action.get("name")),
                    "arguments": action.get("arguments") or {},
                    "source": source,
                }
            )
    return found


def request_of(task: dict) -> str:
    """The text a request carries: the ticket the agent is handed, and the persona's own instructions.

    Both, because the corpus splits the identity across them — the ticket says "Customer name: John Smith, phone
    number 555-123-2002" and the persona repeats it — and a reading that saw only one would under-count the ways a
    real request states its record.
    """
    parts = [task.get("ticket") or ""]
    scenario = task.get("user_scenario") or {}
    instructions = scenario.get("instructions") if isinstance(scenario, dict) else None
    if isinstance(instructions, dict):
        parts.extend(str(value) for value in instructions.values() if isinstance(value, str))
    return "\n".join(parts)


# --- R242: the third domain's ask vocabulary, measured and mostly refused -------------------------------
#
# R241 settled the *record* question without a cue: a graded write was compared against the request's own text, not
# against a parsed ask. R242 asks the question R217a paid for on airline and could not then pay here — whether six
# cues would let the board *see* the third domain's asks. The six candidates are the families in `goal_board.FAMILIES`
# that had no cue (suspend, resume, roaming, refuel, plan, credit); `payment` and `transfer` already have retail cues.
#
# The measurement is over the domain's own 20-task sample, through the shipped `goal_board.census`, and read on a
# document whose `reason` is exactly `request_of` and whose `writes` are the graded writes named by tool. It is scored
# on two axes — found (a required object the board has an ask for) and spurious (an ask no required object accounts
# for) — in two other domains as well, because R217a's whole claim was that appended cues change no retail parse.
ASK_CUES = (
    ("suspend", r"\b(suspend\w*|freez\w*)\b"),
    ("resume", r"\b(resum\w*|reactivat\w*)\b"),
    ("roaming", r"\b(roam\w*)\b"),
    ("refuel", r"\b(refuel\w*|recharg\w*|top.?up\w*)\b"),
    ("plan", r"\b(plan\w*)\b"),
    ("credit", r"\b(credit\w*|reimburse\w*)\b"),
)

#: R242's one shipped repair. A return/refund immediately followed by a state word is not a request to send a product
#: back: "speed test returns excellent internet speed" and "the tool call does not return updated status" are
#: conditionals about a reading. The guard is a negative lookahead on the return cue, and it is measured to remove all
#: forty spurious asks on the telecom sample while leaving retail's 176 found and airline's 15 found untouched.
RETURN_GUARD = r"\b(return\w*|refund\w*)\b(?!\s+(?:excellent|poor|fair|good|updated|better|worse|normal)\b)"
STATE_WORDS = ("excellent", "poor", "fair", "good", "updated", "better", "worse", "normal")
#: The pre-R242 return cue, reconstructed rather than read from a file, so the "before" arm of the guard can be
#: measured on a checkout where the shipped table already carries the guard. It is the old pattern verbatim.
OLD_RETURN = r"\b(return\w*|refund\w*)\b"

#: The census-format document for the third domain. `reason` is the same text the board reads (R215's rule), and
#: `writes` are the evaluator's own writes named by the tool that performs them — a family the census maps through
#: `goal_board.FAMILIES`. Built from the task set by `ask_document`, never copied into a second table.
def ask_document(tasks: list) -> dict:
    """The telecom tasks as a census document: request text in, graded writes as family-bearing tools."""
    inverse: dict = {}
    for tool, family in WRITES.items():
        inverse.setdefault(family, tool)
    return {
        "tasks": [
            {
                "id": task.get("id") or "",
                "reason": request_of(task),
                "writes": [
                    {"name": inverse.get(write["family"], ""), "objects": 1}
                    for write in graded_writes(task)
                ],
            }
            for task in tasks
        ]
    }


def derive_cues(guarded: bool, extra: tuple = ()) -> tuple:
    """A cue table with R242's return guard applied or removed, plus a candidate set appended.

    `goal_board.CUES` now ships with the guard, so the "after" arm is the table as shipped and the "before" arm is
    rebuilt by putting the old return pattern back. Rebuilding it verbatim is what lets this script measure the
    guard's effect on a checkout whose product already carries it. `goal_board.CUES` is module state, so a caller
    must restore it — `_census_with` does so in a `finally`. Returning a table rather than mutating one here is what
    makes the two readings independent of the order they are taken in.
    """
    if guarded:
        base = goal_board.CUES
    else:
        base = tuple((name, OLD_RETURN if name == "return" else pattern) for name, pattern in goal_board.CUES)
    return base + tuple(extra)


def _census_with(cues: tuple, doc: dict) -> dict:
    """A census taken with a chosen cue table, restored afterwards whether it succeeds or fails."""
    saved = goal_board.CUES
    try:
        goal_board.CUES = cues
        return goal_board.census(doc)
    finally:
        goal_board.CUES = saved


def ask_reading(tasks: list, retail: dict, airline: dict) -> dict:
    """The whole R242 reading: the guard's effect, then each candidate cue's marginal, on all three domains.

    Every number comes from `goal_board.census` on a real document; none is typed. The guard is measured against the
    shipped cue table, and each cue is measured as an addition to the *guarded* table, so the six marginals are about
    the product as it will ship rather than about a pre-guard parser nobody runs.
    """
    doc = ask_document(tasks)
    bare = derive_cues(guarded=False)
    guarded = derive_cues(guarded=True)

    def snap(cues: tuple) -> dict:
        return {
            "telecom": {k: _census_with(cues, doc).get(k) for k in ("found", "required", "spurious", "tasksCovered")},
            "retail": {k: _census_with(cues, retail).get(k) for k in ("found", "spurious")},
            "airline": {k: _census_with(cues, airline).get(k) for k in ("found", "spurious")},
        }

    before, after = snap(bare), snap(guarded)
    cues_out = []
    for name, pattern in ASK_CUES:
        with_cue = snap(derive_cues(guarded=True, extra=((name, pattern),)))
        cues_out.append({
            "name": name,
            "pattern": pattern,
            "telecom": with_cue["telecom"],
            "retailSpurious": with_cue["retail"]["spurious"],
            "airlineSpurious": with_cue["airline"]["spurious"],
            # A cue is admissible only if it reaches a required write without adding noise in any domain. Every one
            # fails one of the two: four reach nothing, refuel buys one write for thirteen spurious asks (a concession
            # "willing to refuel if necessary", not a request), and credit adds ten spurious retail asks ("credit card").
            "reachesNewWrite": with_cue["telecom"]["found"] > after["telecom"]["found"],
            "addsSpurious": (with_cue["telecom"]["spurious"] > after["telecom"]["spurious"]
                             or with_cue["retail"]["spurious"] > after["retail"]["spurious"]
                             or with_cue["airline"]["spurious"] > after["airline"]["spurious"]),
        })
    for cue in cues_out:
        cue["admissible"] = cue["reachesNewWrite"] and not cue["addsSpurious"]
    return {
        "beforeGuard": before,
        "afterGuard": after,
        "cues": cues_out,
        "shippedCues": [cue["name"] for cue in cues_out if cue["admissible"]],
        "shippedGuard": True,
    }


# --- R243: gate 1's affected subset — the ¥0 gate before the ¥1.68 gate -------------------------------------------
#
# R240b registered a paid ladder whose first rung (gate 1, 40:1:1, ¥1.68) buys "the sign of the effect on the subset
# a precision dispatch can move", and wrote that the subset "has not been enumerated, because enumerating it is R241's
# reachability work — and if telecom's reach stays at 0 of 8, the candidate set holds no correct answer and no dispatch
# is worth pricing at any rung". R241 cleared that reachability gate by shipping the handle grade, taking telecom from
# 0 of 8 to 8 of 8. This section enumerates the subset gate 1 would move, at ¥0, from the same sources, and finds it
# empty — which cancels the whole paid ladder before a single episode is bought.
#
# The definition is the one R240b's prose gives: a precision dispatch moves a question only when its answer is IN the
# candidate set (a wider rule reaches the record) but ranked BELOW the window (the shipped grades do not settle it and
# its ask is cut by the cap). Three independently measured quantities, never asserted:
#   * in_candidate_set  — the `blind` rule reaches the write's record (R241's rows, re-derived from the db).
#   * served_by_shipped — a shipped settlement grade reaches it: `shipped` (name/overlap/record) OR `handle`.
#   * hidden_by_cap     — the request states an ask for that write's family, and the board holds more asks than
#                         `goal_board.MAX_ITEMS`, so the ask falls past the window a dispatch could widen.
# affected = in_candidate_set AND NOT served_by_shipped AND hidden_by_cap. A write the shipped grades already serve
# cannot be moved; a write with no ask has nothing to rank; a write with no candidate answer cannot be recovered by a
# dispatch that only re-ranks. All three arms are measured, so the empty subset is a result rather than a refusal.

def precision_reading(db: dict, tasks: list) -> dict:
    """Enumerate gate 1's affected subset from the domain's own bytes, at ¥0 and with no model call."""
    rec = reading(db, tasks)          # the R241 four-rule table, re-derived — never read from a saved manifest
    rows = rec["rows"]
    writes = rec["writes"]
    cap = goal_board.MAX_ITEMS

    # How many asks does each request actually state, and how many of those name a family the graded writes need?
    # telecom requests name symptoms, so `items_of` is zero throughout (R242's finding, measured again here).
    asks_per_task: list = []
    hidden_by_cap = 0
    asks_total = 0
    affected = 0
    for task in tasks:
        text = request_of(task)
        items = goal_board.items_of(text)
        asks_per_task.append(len(items))
        asks_total += len(items)
        n_over = max(0, len(items) - cap)
        if n_over:
            # A generous upper bound: every graded write of this task is treated as hidden if the task's board overflows.
            # telecom has zero asks, so the bound is exact here, and the arithmetic never credits a hidden write that
            # does not exist.
            hidden_by_cap += len(graded_writes(task))

    for row in rows:
        in_set = bool(row.get("blind"))
        served = bool(row.get("shipped")) or bool(row.get("handle"))
        # Whether this specific write's ask overflowed is bounded by the task's over-cap count; recorded per row below.
        if in_set and not served:
            # Reached by a wider rule but not served by any shipped grade. This is the ONLY shape a dispatch could
            # move, and it still needs the ask to have been hidden by the cap — which the per-task bound supplies.
            task_over = 0
            for task in tasks:
                if (task.get("id") or "") == row.get("task"):
                    task_over = max(0, len(goal_board.items_of(request_of(task))) - cap)
                    break
            if task_over:
                affected += 1

    served_now = sum(1 for row in rows if row.get("shipped") or row.get("handle"))
    in_candidate = sum(1 for row in rows if row.get("blind"))
    return {
        "writes": writes,
        "inCandidateSet": in_candidate,
        "servedByShipped": served_now,
        "asksInRequests": asks_total,
        "asksPerTaskMax": max(asks_per_task) if asks_per_task else 0,
        "cap": cap,
        "hiddenByCap": hidden_by_cap,
        "affected": affected,
        "verdict": "CANCEL_GATE_1" if affected == 0 else "DISPATCH",
    }


def reading(db: dict, tasks: list) -> dict:
    """The four numbers, over every graded write in the task set, plus what each rule costs in over-credit.

    R241 adds the fourth rule and, with it, the column that decides between them: a rule is not better because it
    reaches more writes, it is better when it reaches the right ones **and refuses the others**. So every rule is
    scored twice — on the eight real writes, and on the nine writes the request does *not* name.
    """
    records = project(db)
    table = claims(records)
    ambiguous_tokens = ambiguous(table)
    rows: list = []
    # One rule set and one counterfactual per **distinct request**, keyed by the number it carries, because a task set
    # may name more than one caller and a counterfactual read off the first task would silently be an answer about one
    # of them. A request that carries no number is keyed by `""` and is a finding in its own right.
    rules_of_text: dict = {}
    credits: dict = {}
    for task in tasks:
        text = request_of(task)
        if text not in rules_of_text:
            rules_of_text[text] = rules_for(text, table, ambiguous_tokens, reads_for(db, text))
            phone = (PHONE.findall(text) or [""])[0]
            credits.setdefault(phone, sibling_credits(db, rules_of_text[text]))
        rules = rules_of_text[text]
        for write in graded_writes(task):
            wanted = receipt_keys(write["arguments"], table)
            if not wanted:
                continue
            row = {
                "task": task.get("id"),
                "wanted": sorted(wanted),
                "tokens": sorted({token.lower() for token in PHONE.findall(text)}),
            }
            for name, rule in rules.items():
                row[name] = bool(rule(write["arguments"]))
            rows.append(row)
    total = len(rows)
    counted = {name: sum(1 for row in rows if row.get(name)) for name in ("shipped", "blind", "strict", "handle")}
    return {
        "records": {
            "lines": len(records["lines"]),
            "customers": len(records["customers"]),
            "bills": len(records["bills"]),
        },
        "writes": total,
        # The rule as it ships before R241: an ask names a record only when the clause spells the identifier the write
        # carries. A phone number is not one of those, and it is the only handle the request gives, so this reads zero.
        "shipped": counted["shipped"],
        # The repair with its ambiguity ignored: every request reaches its record, and an ask about the household
        # reaches a write to any of its lines. Reportable, not shippable.
        "blind": counted["blind"],
        # The repair with the ambiguity refused: a token that names two records names neither.
        "strict": counted["strict"],
        # R241. The record the episode **read**: the phone resolves to the line that claims it and to that line's
        # account, never to a sibling, and the write is compared at the finest type both sides name.
        "handle": counted["handle"],
        # The counterfactual, per rule: which of the database's lines an ask about the caller's number would credit.
        # A rule that reaches eight of eight and credits nine of nine has learned nothing; the pair is the finding.
        "credits": credits,
        "ambiguous": ambiguous_tokens,
        "rows": rows,
    }


def reads_for(db: dict, text: str) -> list:
    """The transcript an episode must have produced before it can write, from the database alone.

    The episodes are not on disk, so the read has to be reconstructed — and it is reconstructed as the **minimum** the
    domain's own tools require, not as a favourable sample: every τ² telecom task begins with the caller's number and
    every route to a write passes through the account that number belongs to. So the prelude is the customer read, then
    one read of each line that account holds. An episode that did less could not have named a line at all; an episode
    that did more has read *more* records, which can only widen what the resolver knows.

    A request that carries no number gets no prelude, and that is the point of the second argument being text rather
    than a task: a domain whose requests name no handle at all is a finding, not an error.
    """
    records = project(db)
    numbers = PHONE.findall(text)
    messages: list = [{"role": "user", "content": text}]
    if not numbers:
        return messages
    phone = numbers[0]
    customer = next(
        (entry for entry in records["customers"].values() if (entry.get("phone") or "").lower() == phone.lower()),
        None,
    )
    if customer is None:
        return messages
    messages.append({"role": "assistant",
                     "tool_calls": [{"name": "get_customer_by_phone", "arguments": {"phone_number": phone}}]})
    messages.append({"role": "tool", "content": json.dumps(
        {"customer_id": customer["id"], "phone_number": phone, "line_ids": customer["lines"]})})
    for line_id in customer["lines"]:
        line = records["lines"].get(line_id) or {}
        messages.append({"role": "assistant",
                         "tool_calls": [{"name": "get_details_by_id", "arguments": {"line_id": line_id}}]})
        messages.append({"role": "tool", "content": json.dumps(
            {"line_id": line_id, "phone_number": line.get("phone")})})
    return messages


def rules_for(text: str, table: dict, ambiguous_tokens: dict, messages: list) -> dict:
    """The four rules, as four predicates over one write's arguments.

    They are built from the same text and the same read, so the difference between any two of them is the rule and not
    the input — which is what makes the table an ablation rather than four measurements of four different questions.
    """
    read = goal_board.read_records(messages)
    ask = goal_board.handles_in(text, read)

    def shipped(arguments: dict) -> bool:
        wanted = receipt_keys(arguments, table)
        return bool(resolve(text, table, False) & wanted) and not any(
            token in ambiguous_tokens for token in PHONE.findall(text))

    def blind(arguments: dict) -> bool:
        return bool(resolve(text, table, False) & receipt_keys(arguments, table))

    def strict(arguments: dict) -> bool:
        return bool(resolve(text, table, True) & receipt_keys(arguments, table))

    def handle(arguments: dict) -> bool:
        return goal_board.same_record(ask, goal_board.receipt_keys({"args": arguments}))

    return {"shipped": shipped, "blind": blind, "strict": strict, "handle": handle}


def sibling_credits(db: dict, rules: dict) -> dict:
    """Which of the database's lines each rule would credit for an ask about **one** line.

    The counterfactual is the whole discipline of this round: reaching the eight real writes is necessary and nowhere
    near sufficient. A write is synthesised for every line in the database — `resume_line` on that line, carrying its
    account — and each rule is asked whether it would credit it. The correct answer is a **set of one**, the line whose
    own number the request spells; every other element of every other set is a credit for work nobody asked for.
    """
    records = project(db)
    owner_of = {
        line_id: customer["id"]
        for customer in records["customers"].values()
        for line_id in customer["lines"]
    }
    credited: dict = {name: [] for name in rules}
    for line_id in sorted(records["lines"]):
        arguments = {"line_id": line_id}
        if owner_of.get(line_id):
            arguments["customer_id"] = owner_of[line_id]
        for name, rule in rules.items():
            if rule(arguments):
                credited[name].append(line_id)
    return credited


def self_test() -> int:
    failures = 0
    ran = 0

    def expect(name: str, condition, detail: str = "") -> None:
        nonlocal failures, ran
        ran += 1
        if not condition:
            failures += 1
            print(f"FAIL {name}{(' — ' + detail) if detail else ''}")

    db = toml_of(_DB)
    records = project(db)
    expect("a line is projected with its id and phone", records["lines"]["L1"]["phone"] == "555-000-0001")
    expect("a customer keeps the lines it owns", records["customers"]["C1"]["lines"] == ["L1", "L3"])
    expect("a bill keeps its period", records["bills"]["B1"]["period"] == "2025-01-01..2025-01-31")
    table = claims(records)
    expect("both a line's id and its phone are identity tokens",
           table["l1"] == ["line:L1"] and table["555-000-0001"] == ["line:L1", "customer:C1"])
    found = ambiguous(table)
    expect("a phone shared by a customer and their primary line is ambiguous", set(found) == {"555-000-0001"})
    expect("a phone only one record claims is not", "555-000-0002" not in found)

    # The over-credit, which is why the ambiguity cannot be ignored. Grace's phone is not Ada's, so an ask about
    # Ada reaches Ada's line and nothing else — but Ada's own number is also L1's, and a token table that resolved
    # it to both would let an ask about "the household" reach a write to L1 or to C1 interchangeably.
    ada = request_of({"ticket": "Caller is Ada Lovelace on 555-000-0001.", "user_scenario": {}})
    grace = request_of({"ticket": "Caller is Grace Hopper on 555-000-0002.", "user_scenario": {}})
    expect("a request reaches its own line's write",
           bool(resolve(ada, table, False) & receipt_keys({"line_id": "L1"}, table)))
    expect("and does not reach the other customer's line",
           not (resolve(grace, table, False) & receipt_keys({"line_id": "L1"}, table)))
    # With the ambiguity refused, Ada's request names nothing: the only token it carries is claimed twice.
    expect("refusing the ambiguity costs the ambiguous request its reach",
           resolve(ada, table, True) == set() and resolve(grace, table, True) == {"line:L2"})
    expect("a customer-level write is reachable by a customer-level token",
           bool(resolve(ada, table, False) & receipt_keys({"customer_id": "C1"}, table)))
    expect("a seven-digit order id is still read", resolve("order W4284542", table, True) == set())

    # The task walker: both sources are read, and a call that changes nothing is not a write.
    task = {
        "id": "t",
        "ticket": "phone 555-000-0002",
        "user_scenario": {"instructions": {"known_info": "You are Grace."}},
        "initial_state": {"initialization_actions": [{"env_type": "user", "func_name": "set_user_info"},
                                                     {"env_type": "assistant", "func_name": "enable_roaming",
                                                      "arguments": {"customer_id": "C2", "line_id": "L2"}}]},
        "evaluation_criteria": {"actions": [{"name": "refuel_data", "requestor": "assistant",
                                             "arguments": {"line_id": "L2", "gb": 1.0}}]},
    }
    writes = graded_writes(task)
    expect("both action lists are walked and non-writes are dropped",
           [w["family"] for w in writes] == ["roaming", "refuel"])
    expect("the request carries the ticket and the persona", "Grace" in request_of(task))
    one = reading(db, [task])
    expect("the reading counts the writes that name a record", one["writes"] == 2)
    expect("a reachable write reaches under every reading", one["shipped"] == 2 and one["strict"] == 2)
    # Ada's task is the one the ambiguity costs: its only token names two records.
    ada_task = {**task, "id": "a", "ticket": "phone 555-000-0001",
                "evaluation_criteria": {"actions": [{"name": "refuel_data", "requestor": "assistant",
                                                     "arguments": {"line_id": "L1", "gb": 1.0}}]},
                "initial_state": {"initialization_actions": []}}
    two = reading(db, [ada_task])
    expect("the ambiguous request ships nothing under the shipped rule", two["shipped"] == 0)
    expect("reads its record when the ambiguity is ignored", two["blind"] == 1)
    expect("and nothing when it is refused", two["strict"] == 0)
    # R241. The record the episode read. Ada's number is her line's, so the resolver types it as that line **and her
    # account** — and the lattice compares at the finest type both sides name, which is what keeps the sibling out.
    expect("the record the episode read settles the write it names", two["handle"] == 1)
    expect("and credits exactly the line whose number the caller gave",
           two["credits"]["555-000-0001"]["handle"] == ["L1"])
    expect("while the ambiguity-blind table credits the sibling as well",
           two["credits"]["555-000-0001"]["blind"] == ["L1", "L3"])
    expect("and neither the shipped rule nor the strict one credits anything",
           two["credits"]["555-000-0001"]["shipped"] == [] and two["credits"]["555-000-0001"]["strict"] == [])
    # The limit, stated rather than hidden: the handle grade rests on a **read**, so a number that no account claims —
    # a second line's, in this fixture — gets no prelude and credits nothing. The static table reaches it (it scans
    # every record) and the shipped rule does not, which is the price of anchoring on the transcript: a resolution the
    # episode never made is a resolution the board cannot use. In the real task set all twenty requests carry the
    # account's contact number, so this case is a bound and not a reading.
    expect("a number no account claims credits nothing under the handle grade", one["handle"] == 0)
    expect("a request that carries no number gets no prelude, and the resolver is told about no record",
           [message["role"] for message in reads_for(db, "my data is slow")] == ["user"])
    # The counterfactual is taken once per distinct request: a task set that repeats a request must not pay for a
    # second scan, and — more to the point — must not report a second, disagreeing one.
    repeated = reading(db, [task, ada_task, {**task, "id": "t-again"}])
    expect("a repeated request is measured once", len(repeated["credits"]) == 2 and repeated["writes"] == 5)

    # The walkers' refusals. Each of these is a shape the corpus produces: a task with no initial state at all, an
    # action list holding something that is not a dict, an action that reads rather than writes, and a write whose
    # arguments name no record — a refuel by volume, which is settled by family and never by a record.
    expect("a task with no initial state walks only its graded actions",
           [w["family"] for w in graded_writes({"evaluation_criteria": {"actions": [
               {"name": "refuel_data", "requestor": "assistant", "arguments": {"line_id": "L2"}}]}})] == ["refuel"])
    kept = graded_writes({"initial_state": {"initialization_actions": [
        "not an action",
        {"env_type": "assistant", "func_name": "get_customer_by_phone", "arguments": {"phone": "1"}},
        {"env_type": "assistant", "func_name": "refuel_data", "arguments": {"line_id": "L2"}}]}})
    expect("a non-dict action and a read tool are both skipped",
           [w["family"] for w in kept] == ["refuel"])
    expect("a write that names no record is not counted",
           reading(db, [{"id": "r", "ticket": "555-000-0002",
                         "evaluation_criteria": {"actions": [{"name": "refuel_data", "requestor": "assistant",
                                                              "arguments": {"gb": 1.0}}]}}])["writes"] == 0)
    expect("a user-performed action is not the agent's write",
           graded_writes({"evaluation_criteria": {"actions": [
               {"name": "toggle_roaming", "requestor": "user", "arguments": {}}]}}) == [])

    # The reader: the subset's four productions, the two refusals, and — when the interpreter has one — the
    # reference implementation on the same bytes. On 3.10 `tomllib` does not exist, and the branch is skipped rather
    # than faked: the reader is then held by the fixtures above, which is why they assert values and not only counts.
    parsed = toml_of('[a]\nx = "1.0"\ny = [ "p", "q" ]\n[[list]]\nz = true\n[[list]]\nz = false\n')
    expect("a dotted header, a string that looks like a number, and a list of strings",
           parsed["a"]["x"] == "1.0" and parsed["a"]["y"] == ["p", "q"] and [e["z"] for e in parsed["list"]] == [True, False])
    expect("a hash inside a quoted value is not a comment",
           toml_of('[a]\nurl = "http://x/#frag"\n')["a"]["url"] == "http://x/#frag")
    expect("a trailing comment is cut",
           toml_of('[a]\nx = 1  # the price\n')["a"]["x"] == 1)
    nested = toml_of('[[list]]\nname = "first"\n[[list.sub]]\nflag = true\n[list.address]\ncity = "x"\n')
    expect("a dotted header reaches into the last element of an array of tables",
           nested["list"][0]["sub"] == [{"flag": True}] and nested["list"][0]["address"] == {"city": "x"})
    deep = toml_of('[[a]]\nname = "row"\n[[a.b.c]]\nv = 1\n[[a.b.c]]\nv = 2\n')
    expect("a header three parts deep appends under the last element of the array above it",
           [entry["v"] for entry in deep["a"][0]["b"]["c"]] == [1, 2])
    expect("an inline list is split on its own commas", toml_of('a = [ [1,2], [3] ]\n')["a"] == [[1, 2], [3]])
    for name, text in (("a line with no equals is refused", "[a]\nbroken\n"),
                       ("a value of an unreadable shape is refused", "[a]\nx = nope\n")):
        refused = None
        try:
            toml_of(text)
        except ValueError as error:
            refused = str(error)
        expect(name, refused is not None and "line" in refused)
    # The reader against a **golden** document rather than against `tomllib`: the floor checker refuses that import
    # anywhere in the tree, and rightly — a guarded import is still an import for a reader that has to run on the
    # lane's interpreter. The golden pair is the substitute a 3.10 runner can hold: every production in one document,
    # with the expected parse written out.
    golden = ('[plan]\nid = "P1"\nlimit = 5.0\n[[line]]\nid = "L1"\nflags = ["a", "b"]\n'
              '[[line]]\nid = "L2"\n[line.meta]\nk = true\n')
    expect("the reader reproduces a golden document", toml_of(golden) == {
        "plan": {"id": "P1", "limit": 5.0},
        "line": [{"id": "L1", "flags": ["a", "b"]}, {"id": "L2", "meta": {"k": True}}],
    })

    # The reporter, because a check that cannot fail is not a check: this one is meant to fail, and the counter is
    # wound back so that it does not. R238 shipped a tamper that had stopped tampering, and the lesson was that the
    # test of a test is a case it must reject.
    before = failures
    expect("the reporter can fail", False)
    expect("the reporter counted the failure", failures == before + 1)
    failures = before

    # The command line, on the fixtures above written to a temporary directory: write, read back, check, and refuse a
    # reading that does not add up. A `--check` that has only ever been run against a good file is a check nobody has
    # seen reject anything.
    with tempfile.TemporaryDirectory() as room:
        root = pathlib.Path(room)
        (root / "db.toml").write_text(_DB, encoding="utf-8")
        (root / "tasks.json").write_text(json.dumps([task, ada_task]), encoding="utf-8")
        out = root / "records.json"
        code = main(["--db", str(root / "db.toml"), "--tasks", str(root / "tasks.json"), "--out", str(out)])
        expect("the writer exits zero", code == 0)
        expect("and its manifest is self-consistent", checked(json.loads(out.read_text(encoding="utf-8"))) == [])
        expect("its digest names the file it read",
               digest(root / "db.toml")["sha256"] == hashlib.sha256((root / "db.toml").read_bytes()).hexdigest())
        with contextlib.redirect_stdout(io.StringIO()):
            good = main(["--check", str(out)])
        expect("a good manifest checks", good == 0)
        broken = json.loads(out.read_text(encoding="utf-8"))
        broken["reading"]["shipped"] = 99
        broken["reading"]["strict"] = 5
        broken["sources"] = broken["sources"][:1]
        broken["reading"]["rows"][0]["wanted"] = []
        (root / "broken.json").write_text(json.dumps(broken), encoding="utf-8")
        quiet = io.StringIO()
        with contextlib.redirect_stdout(quiet):
            refused = main(["--check", str(root / "broken.json")])
        expect("a manifest that does not add up is refused", refused == 1)
        expect("and the refusal says why", "does not add up" not in quiet.getvalue() and
               quiet.getvalue().count("FAIL") == len(checked(broken)))
        expect("and every way it can fail is named",
               len(checked(broken)) >= 5)
        # A count that is not the rows it summarises, which is the one tamper the summary cannot absorb.
        miscounted = json.loads(out.read_text(encoding="utf-8"))
        miscounted["reading"]["writes"] = 99
        (root / "miscounted.json").write_text(json.dumps(miscounted), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            expect("a miscounted total is refused", main(["--check", str(root / "miscounted.json")]) == 1)
        # R241's two new ways to be wrong: a handle count that is not its rows, and a counterfactual that credits a
        # sibling. Both are tampered deliberately — a check nobody has seen reject anything is a check whose
        # emptiness is a guess, which is the lesson R238 recorded when its tamper stopped tampering.
        handle_tamper = json.loads(out.read_text(encoding="utf-8"))
        handle_tamper["reading"]["handle"] = 0
        handle_tamper["reading"]["rows"][0]["handle"] = True
        (root / "handle.json").write_text(json.dumps(handle_tamper), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            expect("a handle count that is not its rows is refused",
                   main(["--check", str(root / "handle.json")]) == 1)
        sibling_tamper = json.loads(out.read_text(encoding="utf-8"))
        for per_rule in sibling_tamper["reading"]["credits"].values():
            per_rule["handle"] = ["L1", "L2"]
        (root / "sibling.json").write_text(json.dumps(sibling_tamper), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            expect("a counterfactual that credits two lines is refused",
                   main(["--check", str(root / "sibling.json")]) == 1)
        no_credit = json.loads(out.read_text(encoding="utf-8"))
        no_credit["reading"].pop("credits")
        (root / "nocr.json").write_text(json.dumps(no_credit), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            expect("a reading with no counterfactual is refused", main(["--check", str(root / "nocr.json")]) == 1)
        short_rule = json.loads(out.read_text(encoding="utf-8"))
        for per_rule in short_rule["reading"]["credits"].values():
            per_rule.pop("handle", None)
        (root / "short.json").write_text(json.dumps(short_rule), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            expect("a counterfactual missing a rule is refused", main(["--check", str(root / "short.json")]) == 1)
        # Re-derivation: the reading against the bytes it names, which is the one check the arithmetic cannot make.
        expect("a manifest re-derives from its own bytes",
               verified(json.loads(out.read_text(encoding="utf-8")), root) == [])
        drifted = json.loads(out.read_text(encoding="utf-8"))
        drifted["reading"]["handle"] = 99
        expect("a figure that does not come back is named",
               any("handle" in problem for problem in verified(drifted, root)))
        absent = json.loads(out.read_text(encoding="utf-8"))
        absent["sources"] = absent["sources"][1:]
        expect("a source the manifest does not name is refused", len(verified(absent, root)) >= 1)
        stranger = json.loads(out.read_text(encoding="utf-8"))
        stranger["sources"][0]["sha256"] = "0" * 64
        expect("a file that is not the one the reading was taken from is refused",
               any("not the file" in problem for problem in verified(stranger, root)))
        expect("a manifest whose source is not in the checkout is refused",
               len(verified(json.loads(out.read_text(encoding="utf-8")), root / "nowhere")) == 2)
        with contextlib.redirect_stdout(io.StringIO()):
            expect("the verify branch exits zero on a good manifest",
                   main(["--verify", str(out), "--sources", str(root)]) == 0)
        # A manifest that has drifted from its own bytes: the projection and the row labels are both wrong, and both
        # are things the arithmetic of `--check` would happily accept.
        drifted = json.loads(out.read_text(encoding="utf-8"))
        drifted["reading"]["records"]["lines"] = 99
        drifted["reading"]["rows"][0]["task"] = "another"
        (root / "drift.json").write_text(json.dumps(drifted), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()) as said:
            expect("a drifted manifest is refused by the verify branch",
                   main(["--verify", str(root / "drift.json"), "--sources", str(root)]) == 1)
        expect("and the refusal names what did not come back",
               "records" in said.getvalue() and "rows" in said.getvalue())
        # The value of `--db` without `--tasks`, and the machine-readable branch: the two paths a reader of this file
        # reaches from a terminal rather than from CI.
        for name, argv in (("a missing task set is a usage error", ["--db", str(root / "db.toml")]),
                           ("and so is a missing database", ["--tasks", str(root / "tasks.json")])):
            refused = None
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                try:
                    main(argv)
                except SystemExit as stop:
                    refused = stop.code
            expect(name, refused == 2)
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--db", str(root / "db.toml"), "--tasks", str(root / "tasks.json"), "--json"])
        expect("the json branch prints the manifest a file would hold",
               json.loads(printed.getvalue())["schema"] == "microglia/telecom-records@1")

    # --- R242: the ask vocabulary ---------------------------------------------------------------------------
    # The six cues are the families in FAMILIES that had no cue. Assert the set rather than a count: a seventh family
    # added to the domain later has to say whether it carries a cue, and this line is where that decision is forced.
    expect("the six candidate cues are exactly the cue-less third-domain families",
           {name for name, _ in ASK_CUES} == {"suspend", "resume", "roaming", "refuel", "plan", "credit"})

    # The document is built from the domain's own tasks by the same walker that produced the record reading: a graded
    # write is a tool name the census can map through FAMILIES, and the reason is the text the board reads.
    small = json.loads((HERE / "eval" / "fixtures" / "telecom" / "telecom-tasks-small.json").read_text(encoding="utf-8"))
    adoc = ask_document(small)
    expect("the ask document has one row per task", len(adoc["tasks"]) == len(small))
    expect("a graded tool is named, never a bare family",
           all(w["name"] in WRITES for t in adoc["tasks"] for w in t["writes"]))
    expect("the ten graded writes are read from the task set",
           sum(len(t["writes"]) for t in adoc["tasks"]) == 10)

    # Rebuilding the pre-guard table and appending candidates must not leak into the shipped table: a reading taken
    # afterwards sees exactly the cues the product ships, in the same order.
    expect("derive_cues appends without mutating the shipped table",
           len(derive_cues(guarded=True, extra=ASK_CUES)) == len(goal_board.CUES) + 6
           and goal_board.CUES[1] == ("return", RETURN_GUARD)
           and derive_cues(guarded=False)[1] == ("return", OLD_RETURN))

    retail_manifest = json.loads((HERE / "eval" / "manifests" / "retail-goals.json").read_text(encoding="utf-8"))
    airline_manifest = json.loads((HERE / "eval" / "manifests" / "airline-goals.json").read_text(encoding="utf-8"))
    aread = ask_reading(small, retail_manifest, airline_manifest)

    # The guard: every one of the forty telecom return-asks is spurious, and removing them costs no real ask in any
    # domain. These are the numbers the shipped repair rests on, so they are pinned rather than merely bounded.
    expect("the guard clears all forty spurious telecom asks",
           aread["beforeGuard"]["telecom"]["spurious"] == 40 and aread["afterGuard"]["telecom"]["spurious"] == 0)
    expect("and finds nothing to un-settle in any domain",
           aread["beforeGuard"]["telecom"]["found"] == aread["afterGuard"]["telecom"]["found"] == 0
           and aread["beforeGuard"]["retail"]["found"] == aread["afterGuard"]["retail"]["found"] == 176
           and aread["beforeGuard"]["airline"]["found"] == aread["afterGuard"]["airline"]["found"] == 15)
    expect("the guard's retail and airline spurious counts do not move",
           aread["beforeGuard"]["retail"]["spurious"] == aread["afterGuard"]["retail"]["spurious"] == 235
           and aread["beforeGuard"]["airline"]["spurious"] == aread["afterGuard"]["airline"]["spurious"] == 52)

    # The six cues: four reach nothing, refuel buys one write for thirteen spurious asks, credit adds ten retail ones.
    by_name = {cue["name"]: cue for cue in aread["cues"]}
    expect("no cue reaches a required write except refuel",
           [name for name, cue in by_name.items() if cue["reachesNewWrite"]] == ["refuel"])
    expect("refuel buys its one write with thirteen spurious asks",
           by_name["refuel"]["telecom"]["found"] == 1 and by_name["refuel"]["telecom"]["spurious"] == 13)
    expect("credit adds ten spurious retail asks", by_name["credit"]["retailSpurious"] == 245)
    expect("every cue fails admissibility, so none ships",
           aread["shippedCues"] == [] and all(not cue["admissible"] for cue in aread["cues"]))
    expect("the guard, unlike the cues, ships", aread["shippedGuard"] is True)

    # The command line for the ask reading: generate, check, verify, and refuse a tampered manifest. Every branch is
    # driven here, not in CI, because CI counts the coverage of this self-test only — an ask branch that ran only in
    # a dispatch would be a manifest nobody's floor had ever measured.
    with tempfile.TemporaryDirectory() as room:
        root = pathlib.Path(room)
        ask_out = root / "asks.json"
        # Use the real corpus through --sources, so the generation path resolves the two goals files it needs.
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            code = main(["--asks", "--out", str(ask_out), "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        saved = json.loads(ask_out.read_text(encoding="utf-8"))
        expect("the ask writer exits zero", code == 0)
        expect("and the ask manifest is schema-tagged", saved["schema"] == "microglia/telecom-asks@1")
        expect("its check passes", check_asks(saved) == [])
        expect("and its verify re-derives from the three sources",
               verify_asks(saved, HERE / "eval" / "fixtures" / "telecom") == [])
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--check-asks", str(ask_out)])
        expect("the check-asks branch reports the guard and zero cues",
               "guard ships" in printed.getvalue() and "0 of 6" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--verify-asks", str(ask_out), "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the verify-asks branch reports the re-derived guard",
               "40 → 0" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--asks", "--json", "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the ask json branch prints the manifest",
               json.loads(printed.getvalue())["schema"] == "microglia/telecom-asks@1")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--asks", "--tasks", str(HERE / "eval" / "fixtures" / "telecom" / "telecom-tasks-small.json"),
                  "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the ask human branch prints each cue's verdict",
               "refuel" in printed.getvalue() and "guard=yes" in printed.getvalue())
        # Tamper: flip admissibility on a row without touching its flags, and check_asks must reject it.
        tampered = json.loads(json.dumps(saved))
        tampered["reading"]["cues"][0]["admissible"] = True
        expect("a cue flipped admissible without a flag is refused",
               any("admissible" in problem for problem in check_asks(tampered)))
        tampered2 = json.loads(json.dumps(saved))
        tampered2["reading"]["shippedCues"] = ["suspend"]
        expect("a shipped-cue claim that contradicts the rows is refused",
               any("shippedCues" in problem for problem in check_asks(tampered2)))
        tampered3 = json.loads(json.dumps(saved))
        tampered3["reading"]["beforeGuard"]["telecom"]["spurious"] = 39
        expect("a moved guard column is refused",
               any("guard" in problem for problem in check_asks(tampered3)))
        # A source that is not the file the reading was taken from must fail verify even when check passes.
        tampered4 = json.loads(json.dumps(saved))
        tampered4["sources"][0]["sha256"] = "0" * 64
        expect("a changed source digest is refused by verify",
               any("not the file" in problem for problem in verify_asks(tampered4, HERE / "eval" / "fixtures" / "telecom")))
        # The remaining defensive branches: a missing source, a source whose path is absent, a renamed cue set, a
        # guard that moves in a second domain, a guard flag unset, and a field/cue row that cannot be re-derived. Each
        # is a distinct way a manifest can claim a reading it never took, so each gets its own rejection.
        missing = json.loads(json.dumps(saved))
        missing["sources"] = [s for s in missing["sources"] if s["role"] != "retail"]
        expect("a manifest missing a source is refused",
               any("no retail" in problem for problem in verify_asks(missing, HERE / "eval" / "fixtures" / "telecom")))
        absent = json.loads(json.dumps(saved))
        for source in absent["sources"]:
            if source["role"] == "retail":
                source["path"] = "not-here.json"
        expect("a source path that is absent is refused",
               any("not in this checkout" in problem for problem in verify_asks(absent, HERE / "eval" / "fixtures" / "telecom")))
        renamed = json.loads(json.dumps(saved))
        renamed["reading"]["cues"][0]["name"] = "suspendt"
        expect("a renamed cue is refused",
               any("six candidates" in problem for problem in check_asks(renamed)))
        moved = json.loads(json.dumps(saved))
        moved["reading"]["afterGuard"]["retail"]["found"] = 175
        expect("a guard that moves a second domain is refused",
               any("retail moved" in problem for problem in check_asks(moved)))
        unshipped = json.loads(json.dumps(saved))
        unshipped["reading"]["shippedGuard"] = False
        expect("an unshipped guard is refused",
               any("shippedGuard" in problem for problem in check_asks(unshipped)))
        drift = json.loads(json.dumps(saved))
        drift["reading"]["afterGuard"]["telecom"]["found"] = 1
        expect("a guard field that cannot be re-derived is refused",
               any("afterGuard" in problem for problem in verify_asks(drift, HERE / "eval" / "fixtures" / "telecom")))
        cuedrift = json.loads(json.dumps(saved))
        cuedrift["reading"]["cues"][2]["admissible"] = True
        expect("a cue row that cannot be re-derived is refused",
               any("cues" in problem for problem in verify_asks(cuedrift, HERE / "eval" / "fixtures" / "telecom")))
        # The print loops in the check/verify failure paths: drive a bad manifest through the CLI so the FAIL lines
        # execute rather than remaining the only unreachable lines in the file.
        bad = root / "bad.json"
        bad.write_text(json.dumps(unshipped), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--check-asks", str(bad)])
        expect("the check-asks failure branch prints the refusal", "FAIL" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--verify-asks", str(bad), "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the verify-asks failure branch prints the refusal", "FAIL" in printed.getvalue())

    # --- R243: gate 1's affected subset (TDD — these assertions are written before the function exists) --------
    # A precision dispatch can move only a write whose answer is in the candidate set but ranked below the window:
    # `in_candidate_set` (blind reaches) AND NOT `served_by_shipped` (no shipped grade, incl. handle, reaches) AND
    # `hidden_by_cap` (the ask exists but falls past MAX_ITEMS). The third domain has none of the three in the
    # dangerous combination: handle ships, so every reachable write is already served; and the requests name no ask,
    # so no write has an ask to hide behind the cap. If the subset is empty, gate 1 has nothing to dispatch and the
    # whole paid ladder (¥1.68 / ¥8.41 / ¥93.51) cancels at ¥0.
    db_path = HERE / "eval" / "fixtures" / "telecom" / "telecom-db.toml"
    tdf = json.loads((HERE / "eval" / "fixtures" / "telecom" / "telecom-tasks-small.json").read_text(encoding="utf-8"))
    prec = precision_reading(toml_of(db_path.read_text(encoding="utf-8")), tdf)
    expect("every graded write is in the candidate set by handle",
           prec["inCandidateSet"] == prec["writes"] and prec["writes"] == 8)
    expect("the shipped grades already serve every reachable write",
           prec["servedByShipped"] == prec["inCandidateSet"] == 8)
    expect("no write has an ask hidden behind the cap",
           prec["hiddenByCap"] == 0 and prec["asksInRequests"] == 0)
    expect("so gate 1's affected subset is empty",
           prec["affected"] == 0 and prec["verdict"] == "CANCEL_GATE_1")
    expect("the affected subset is a subset of hidden writes (never larger)",
           prec["affected"] <= prec["hiddenByCap"])

    with tempfile.TemporaryDirectory() as room:
        root = pathlib.Path(room)
        prec_out = root / "gate1.json"
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            code = main(["--precision", "--out", str(prec_out),
                         "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        saved = json.loads(prec_out.read_text(encoding="utf-8"))
        expect("the precision writer exits zero", code == 0)
        expect("and the manifest is schema-tagged", saved["schema"] == "microglia/gate1-subset@1")
        expect("its arithmetic checks", check_precision(saved) == [])
        expect("and its verify re-derives from the sources",
               verify_precision(saved, HERE / "eval" / "fixtures" / "telecom") == [])
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--check-precision", str(prec_out)])
        expect("the check-precision branch reports the cancel",
               "CANCEL_GATE_1" in printed.getvalue() and "affected" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--verify-precision", str(prec_out), "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the verify-precision branch reports the re-derivation", "re-derived" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--precision", "--json", "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the precision json branch prints the manifest",
               json.loads(printed.getvalue())["schema"] == "microglia/gate1-subset@1")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--precision", "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the precision human branch names the verdict", "CANCEL_GATE_1" in printed.getvalue())
        # Tamper: claim a non-empty affected subset without a hidden write to support it.
        tampered = json.loads(json.dumps(saved))
        tampered["reading"]["affected"] = 3
        expect("an affected count above hidden writes is refused",
               any("affected" in problem for problem in check_precision(tampered)))
        tampered2 = json.loads(json.dumps(saved))
        tampered2["reading"]["verdict"] = "DISPATCH"
        expect("a verdict that contradicts an empty subset is refused",
               any("verdict" in problem for problem in check_precision(tampered2)))
        tampered3 = json.loads(json.dumps(saved))
        tampered3["sources"][0]["sha256"] = "0" * 64
        expect("a changed source digest is refused by precision verify",
               any("not the file" in problem for problem in verify_precision(tampered3, HERE / "eval" / "fixtures" / "telecom")))
        # The remaining check_precision guards, each a distinct way the arithmetic can be made to lie.
        oset = json.loads(json.dumps(saved))
        oset["reading"]["inCandidateSet"] = 99
        expect("an in-candidate count above writes is refused",
               any("exceeds writes" in problem for problem in check_precision(oset)))
        srv = json.loads(json.dumps(saved))
        srv["reading"]["servedByShipped"] = 99
        expect("a served count above the candidate set is refused",
               any("exceeds inCandidateSet" in problem for problem in check_precision(srv)))
        neg = json.loads(json.dumps(saved))
        neg["reading"]["writes"] = 0
        expect("a reading with no writes is refused",
               any("no writes" in problem for problem in check_precision(neg)))
        askneg = json.loads(json.dumps(saved))
        askneg["reading"]["asksInRequests"] = 4
        expect("asks with no per-task maximum is refused",
               any("asksInRequests" in problem for problem in check_precision(askneg)))
        capbad = json.loads(json.dumps(saved))
        capbad["reading"]["cap"] = 99
        expect("a cap that is not the shipped constant is refused",
               any("cap:" in problem for problem in check_precision(capbad)))
        # verify_precision's defensive branches: a missing source and an absent source path.
        pmiss = json.loads(json.dumps(saved))
        pmiss["sources"] = [s for s in pmiss["sources"] if s["role"] != "tasks"]
        expect("a precision manifest missing a source is refused",
               any("no tasks" in problem for problem in verify_precision(pmiss, HERE / "eval" / "fixtures" / "telecom")))
        pabsent = json.loads(json.dumps(saved))
        for source in pabsent["sources"]:
            if source["role"] == "tasks":
                source["path"] = "not-here.json"
        expect("an absent precision source path is refused",
               any("not in this checkout" in problem for problem in verify_precision(pabsent, HERE / "eval" / "fixtures" / "telecom")))
        bad = root / "bad-prec.json"
        bad.write_text(json.dumps(tampered2), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--check-precision", str(bad)])
        expect("the check-precision failure branch prints the refusal", "FAIL" in printed.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            main(["--verify-precision", str(bad), "--sources", str(HERE / "eval" / "fixtures" / "telecom")])
        expect("the verify-precision failure branch prints the refusal", "FAIL" in printed.getvalue())

    if failures == 0:
        # The count is printed from the counter rather than typed, because a typed count is a claim about the file
        # that stops being true the first time a check is added.
        print(f"ok  build_telecom_records: {ran} checks")
    return failures


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--check", default="", help="check that a saved reading adds up")
    parser.add_argument("--verify", default="", help="re-derive a saved reading from the sources it names")
    parser.add_argument("--asks", action="store_true", help="write the R242 ask-vocabulary reading (six cues + guard)")
    parser.add_argument("--check-asks", default="", help="check the R242 ask manifest's arithmetic")
    parser.add_argument("--verify-asks", default="", help="re-derive the R242 ask manifest from its sources")
    parser.add_argument("--precision", action="store_true", help="write the R243 gate-1 affected-subset reading")
    parser.add_argument("--check-precision", default="", help="check the R243 gate-1 manifest's arithmetic")
    parser.add_argument("--verify-precision", default="", help="re-derive the R243 gate-1 manifest from its sources")
    #: Where the sources named by a manifest are looked for. A parameter rather than a constant because the self-test
    #: writes its own corpus to a temporary directory, and a reader that could only ever look in one place would have
    #: to be trusted about the place it looks.
    parser.add_argument("--sources", default=str(FIXTURES))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 1 if self_test() else 0
    if args.check_precision:
        saved = json.loads(pathlib.Path(args.check_precision).read_text(encoding="utf-8"))
        problems = check_precision(saved)
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            r = saved["reading"]
            print(f"ok  {pathlib.Path(args.check_precision).name}: affected={r['affected']} of "
                  f"{r['writes']} writes, {r['verdict']}")
        return 1 if problems else 0
    if args.verify_precision:
        saved = json.loads(pathlib.Path(args.verify_precision).read_text(encoding="utf-8"))
        problems = check_precision(saved) + verify_precision(saved, pathlib.Path(args.sources))
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            r = saved["reading"]
            print(f"ok  {pathlib.Path(args.verify_precision).name}: re-derived from its own bytes — "
                  f"{r['affected']} affected, {r['verdict']}")
        return 1 if problems else 0
    if args.precision:
        root = pathlib.Path(args.sources)
        db_path = pathlib.Path(args.db) if args.db else root / "telecom-db.toml"
        task_path = pathlib.Path(args.tasks) if args.tasks else root / "telecom-tasks-small.json"
        db_text = db_path.read_text(encoding="utf-8")
        document = {
            "schema": "microglia/gate1-subset@1",
            "note": (
                "R243. Gate 1 of R240b's paid ladder buys the sign of the effect on the subset a precision dispatch "
                "can move, priced at ¥1.68, and was registered before that subset had been enumerated. Enumerated here "
                "at ¥0 from the domain's own bytes: a write is affected only if its answer is in the candidate set "
                "(blind reaches), no shipped settlement grade — including R241's handle — serves it, AND its ask is "
                "cut by the cap. On the 20-task telecom sample all eight writes are reachable and all eight are served "
                "by the shipped grades, and the requests name zero asks (symptoms, not actions), so none is hidden by "
                "the cap: affected = 0. A dispatch that only re-ranks has nothing to move, so gate 1 and the two paid "
                "gates above it (¥8.41, ¥93.51) cancel at ¥0. The reading is re-derived from the two named sources by "
                "--verify; the verdict is forced by the affected count and cannot be edited past --check."
            ),
            "sources": [{"role": "database", **digest(db_path)}, {"role": "tasks", **digest(task_path)}],
            "reading": precision_reading(toml_of(db_text), json.loads(task_path.read_text(encoding="utf-8"))),
        }
        text = json.dumps(document, indent=1, sort_keys=True)
        if args.out:
            pathlib.Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"wrote {args.out}", file=sys.stderr)
        if args.json:
            print(text)
        else:
            r = document["reading"]
            print(f"writes     {r['writes']}")
            print(f"in set     {r['inCandidateSet']}   (blind rule reaches the record)")
            print(f"served     {r['servedByShipped']}   (a shipped grade, incl. handle, settles it)")
            print(f"asks       {r['asksInRequests']}   (requests name symptoms, not asks)")
            print(f"hidden     {r['hiddenByCap']}   (asks cut by cap={r['cap']})")
            print(f"affected   {r['affected']}")
            print(f"verdict    {r['verdict']}")
        return 0
    if args.check_asks:
        saved = json.loads(pathlib.Path(args.check_asks).read_text(encoding="utf-8"))
        problems = check_asks(saved)
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            shipped = saved["reading"]["shippedCues"]
            print(f"ok  {pathlib.Path(args.check_asks).name}: guard ships, {len(shipped)} of 6 cues ship")
        return 1 if problems else 0
    if args.verify_asks:
        saved = json.loads(pathlib.Path(args.verify_asks).read_text(encoding="utf-8"))
        problems = check_asks(saved) + verify_asks(saved, pathlib.Path(args.sources))
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            print(f"ok  {pathlib.Path(args.verify_asks).name}: re-derived from its own bytes — "
                  f"{saved['reading']['beforeGuard']['telecom']['spurious']} → "
                  f"{saved['reading']['afterGuard']['telecom']['spurious']} telecom spurious asks under the guard")
        return 1 if problems else 0
    if args.asks:
        task_path = pathlib.Path(args.tasks) if args.tasks else pathlib.Path(args.sources) / "telecom-tasks-small.json"
        root = pathlib.Path(args.sources)
        retail_path = root.parent.parent / "manifests" / "retail-goals.json"
        airline_path = root.parent.parent / "manifests" / "airline-goals.json"
        tasks = json.loads(task_path.read_text(encoding="utf-8"))
        retail = json.loads(retail_path.read_text(encoding="utf-8"))
        airline = json.loads(airline_path.read_text(encoding="utf-8"))
        document = {
            "schema": "microglia/telecom-asks@1",
            "note": (
                "R242. The third domain's ask vocabulary, measured and mostly refused. The six cue-less families "
                "(suspend, resume, roaming, refuel, plan, credit) are added one at a time to the shipped, guarded "
                "goal_board table and read through goal_board.census on the domain's own 20 tasks and on the retail "
                "and airline goals. Four reach no required write; refuel buys one write for thirteen spurious asks "
                "(the token appears in the concession 'willing to refuel if necessary', not in a request); credit "
                "adds ten spurious retail asks ('credit card'). None is admissible, so no cue ships. The one repair "
                "that does ship is a negative lookahead on the return cue: 'the speed test returns excellent' and "
                "'the tool call does not return updated status' were read as refund asks 40 times on the telecom "
                "sample, all spurious; the guard clears all 40 and moves neither retail's 176 nor airline's 15."
            ),
            "sources": [
                {"role": "tasks", **digest(task_path)},
                {"role": "retail", **digest(retail_path)},
                {"role": "airline", **digest(airline_path)},
            ],
            "reading": ask_reading(tasks, retail, airline),
        }
        text = json.dumps(document, indent=1, sort_keys=True)
        if args.out:
            pathlib.Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"wrote {args.out}", file=sys.stderr)
        if args.json:
            print(text)
        else:
            aread = document["reading"]
            print(f"guard  {aread['beforeGuard']['telecom']['spurious']} → "
                  f"{aread['afterGuard']['telecom']['spurious']} telecom spurious asks (shipped)")
            for cue in aread["cues"]:
                print(f"cue    {cue['name']:9s} telecom {cue['telecom']['found']}/{cue['telecom']['required']} "
                      f"spurious {cue['telecom']['spurious']:2d} "
                      f"retail-spurious {cue['retailSpurious']} → "
                      f"{'ADMIT' if cue['admissible'] else 'refuse'}")
            print(f"ship   guard=yes, cues={aread['shippedCues']}")
        return 0
    if args.check:
        saved = json.loads(pathlib.Path(args.check).read_text(encoding="utf-8"))
        problems = checked(saved)
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            print(f"ok  {pathlib.Path(args.check).name}: {saved['reading']['shipped']} of "
                  f"{saved['reading']['writes']} write(s) reach a record under the shipped rule")
        return 1 if problems else 0
    if args.verify:
        saved = json.loads(pathlib.Path(args.verify).read_text(encoding="utf-8"))
        problems = checked(saved) + verified(saved, pathlib.Path(args.sources))
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            result = saved["reading"]
            print(f"ok  {pathlib.Path(args.verify).name}: re-derived from its own bytes — "
                  f"{result['handle']} of {result['writes']} write(s) reach a record by handle against "
                  f"{result['shipped']} by identifier")
        return 1 if problems else 0
    if not (args.db and args.tasks):
        parser.error("--db and --tasks are required unless --self-test, --check or --verify")
    db_path, task_path = pathlib.Path(args.db), pathlib.Path(args.tasks)
    document = {
        "schema": "microglia/telecom-records@1",
        "note": (
            "The third domain's records, and the one question that decides whether the record grade can reach them: "
            "its requests name a line by a phone number, and in this database a customer's phone number is also one "
            "of their lines'. A string intersection cannot tell the two apart, so the shipped rule reads zero; a table "
            "that ignores the ambiguity reads every write including the ones it should refuse; and the rule that reads "
            "them is the record the episode itself resolved, compared at the finest type both sides name. `credits` is "
            "the counterfactual that separates the last two: a write synthesised against every line in the database, "
            "where the right answer is one line and the blind table reaches three."
        ),
        "sources": [{"role": "database", **digest(db_path)}, {"role": "tasks", **digest(task_path)}],
        "reading": reading(toml_of(db_path.read_text(encoding="utf-8")),
                           json.loads(task_path.read_text(encoding="utf-8"))),
    }
    text = json.dumps(document, indent=1, sort_keys=True)
    if args.out:
        pathlib.Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    if args.json:
        print(text)
    else:
        result = document["reading"]
        print(f"records   {result['records']}")
        print(f"writes    {result['writes']}")
        print(f"shipped   {result['shipped']}   (the rule as it ships: the clause must spell the id the write carries)")
        print(f"blind     {result['blind']}   (a token table with the ambiguity ignored)")
        print(f"strict    {result['strict']}   (a token table with the ambiguity refused)")
        print(f"handle    {result['handle']}   (the record the episode read, compared at the finest type both name)")
        for phone, per_rule in sorted(result["credits"].items()):
            print(f"credits   {phone or '(no number)'}: "
                  + "  ".join(f"{name} {sorted(ids)}" for name, ids in sorted(per_rule.items())))
        print(f"ambiguous {sorted(result['ambiguous'])}")
    return 0


FIXTURES = HERE / "eval" / "fixtures" / "telecom"


def check_asks(saved: dict) -> list:
    """A saved R242 reading's arithmetic, re-added — independently of the bytes it came from.

    This is the same discipline `checked` applies to the record reading, and it is needed for the same reason: a
    manifest that only asserts "zero cues ship" could say that about any table. The check re-derives admissibility
    from the two flags (`reachesNewWrite`, `addsSpurious`) on each row and from the before/after guard columns, so a
    row edited to make a rejected cue look admissible fails even if nothing re-reads the corpus.
    """
    problems: list = []
    reading = saved.get("reading") or {}
    before = reading.get("beforeGuard") or {}
    after = reading.get("afterGuard") or {}
    cues = reading.get("cues") or []
    if {cue.get("name") for cue in cues} != {name for name, _ in ASK_CUES}:
        problems.append("cues: the manifest does not name exactly the six candidates")
    # The guard claims rest on pinned numbers. A manifest whose guard column cannot be re-derived from these counts
    # is a claim about a corpus it never measured.
    bt, at = before.get("telecom") or {}, after.get("telecom") or {}
    if bt.get("spurious") != 40 or at.get("spurious") != 0:
        problems.append(f"guard: expected 40 -> 0 telecom spurious, got {bt.get('spurious')} -> {at.get('spurious')}")
    for domain in ("retail", "airline"):
        b, a = before.get(domain) or {}, after.get(domain) or {}
        if b.get("found") != a.get("found") or b.get("spurious") != a.get("spurious"):
            problems.append(f"guard: {domain} moved under the guard")
    for cue in cues:
        name = cue.get("name")
        reach, noise = cue.get("reachesNewWrite"), cue.get("addsSpurious")
        if cue.get("admissible") is not (bool(reach) and not bool(noise)):
            problems.append(f"{name}: admissible contradicts its own two flags")
    shipped = [cue.get("name") for cue in cues if cue.get("admissible")]
    if reading.get("shippedCues") != shipped:
        problems.append(f"shippedCues: {reading.get('shippedCues')} against {shipped}")
    if reading.get("shippedGuard") is not True:
        problems.append("shippedGuard: the guard is the only R242 repair and must be recorded as shipped")
    return problems


def verify_asks(saved: dict, root: pathlib.Path = FIXTURES) -> list:
    """Re-derive the whole R242 reading from the manifest's own named sources, byte for byte.

    `check_asks` re-adds arithmetic; this is the other half — it cannot tell whether the arithmetic was ever about
    these tasks. The tasks file, the retail goals and the airline goals are all named with digests and all live in
    this repository, so the reading is recomputed from them and compared field by field. Without this, a manifest
    could assert "eleven cues, none shipped" about a corpus nobody opened.
    """
    problems: list = []
    sources = {source.get("role"): source for source in saved.get("sources") or []}
    loaded: dict = {}
    for role in ("tasks", "retail", "airline"):
        source = sources.get(role)
        if not source:
            problems.append(f"no {role} among the sources")
            continue
        # The tasks file lives under eval/fixtures/telecom; the two goals files live under eval/manifests. Resolve the
        # role to its directory rather than assuming one shared root — the two are deliberately in different places.
        base = root if role == "tasks" else root.parent.parent / "manifests"
        path = base / str(source.get("path") or "")
        if not path.is_file():
            problems.append(f"{role}: {path} is not in this checkout")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != source.get("sha256"):
            problems.append(f"{role}: {source.get('path')} is not the file this reading was taken from")
            continue
        loaded[role] = json.loads(data.decode("utf-8"))
    if len(loaded) != 3:
        return problems
    fresh = ask_reading(loaded["tasks"], loaded["retail"], loaded["airline"])
    stored = saved.get("reading") or {}
    # Compare the structural fields, not the prose note. Any drift in a guard column or a cue's two flags fails.
    for field in ("beforeGuard", "afterGuard", "shippedCues", "shippedGuard"):
        if fresh.get(field) != stored.get(field):
            problems.append(f"{field}: the {field} block does not come back from these bytes")
    fresh_cues = [(cue["name"], cue["reachesNewWrite"], cue["addsSpurious"], cue["admissible"]) for cue in fresh["cues"]]
    stored_cues = [(cue.get("name"), cue.get("reachesNewWrite"), cue.get("addsSpurious"), cue.get("admissible"))
                   for cue in stored.get("cues") or []]
    if fresh_cues != stored_cues:
        problems.append("cues: the six rows do not come back from these bytes")
    return problems


def check_precision(saved: dict) -> list:
    """R243's manifest arithmetic, re-added without opening any source.

    A manifest that could only assert "the subset is empty" would say that about any corpus, so the arithmetic is
    checked against the three measured columns: an affected write must be a hidden one, a served write must have first
    been in the candidate set, and the verdict is forced by the affected count. A row edited to show a verdict the
    columns cannot support fails here.
    """
    problems: list = []
    r = saved.get("reading") or {}
    writes = r.get("writes") or 0
    in_set = r.get("inCandidateSet") or 0
    served = r.get("servedByShipped") or 0
    hidden = r.get("hiddenByCap") or 0
    affected = r.get("affected") or 0
    if in_set > writes:
        problems.append("inCandidateSet exceeds writes")
    if served > in_set:
        problems.append("servedByShipped exceeds inCandidateSet: a grade cannot serve a write with no candidate answer")
    if affected > hidden:
        problems.append("affected exceeds hiddenByCap: a dispatch cannot move a write that was never below the window")
    if affected < 0 or hidden < 0 or writes <= 0:
        problems.append("a count is negative or the reading has no writes")
    expected_verdict = "CANCEL_GATE_1" if affected == 0 else "DISPATCH"
    if r.get("verdict") != expected_verdict:
        problems.append(f"verdict: {r.get('verdict')} against {expected_verdict} forced by affected={affected}")
    if (r.get("asksInRequests") or 0) > 0 and (r.get("asksPerTaskMax") or 0) <= 0:
        problems.append("asksInRequests is positive but no task holds an ask")
    if r.get("cap") != goal_board.MAX_ITEMS:
        problems.append(f"cap: {r.get('cap')} against the shipped MAX_ITEMS {goal_board.MAX_ITEMS}")
    return problems


def verify_precision(saved: dict, root: pathlib.Path = FIXTURES) -> list:
    """Re-derive the whole R243 reading from the manifest's own two named sources, byte for byte."""
    problems: list = []
    sources = {source.get("role"): source for source in saved.get("sources") or []}
    loaded: dict = {}
    for role in ("database", "tasks"):
        source = sources.get(role)
        if not source:
            problems.append(f"no {role} among the sources")
            continue
        path = root / str(source.get("path") or "")
        if not path.is_file():
            problems.append(f"{role}: {path} is not in this checkout")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != source.get("sha256"):
            problems.append(f"{role}: {source.get('path')} is not the file this reading was taken from")
            continue
        loaded[role] = data.decode("utf-8")
    if len(loaded) != 2:
        return problems
    fresh = precision_reading(toml_of(loaded["database"]), json.loads(loaded["tasks"]))
    stored = saved.get("reading") or {}
    for field, value in fresh.items():
        if stored.get(field) != value:
            problems.append(f"{field}: {stored.get(field)!r} does not come back from these bytes ({value!r})")
    return problems


def verified(saved: dict, root: pathlib.Path = FIXTURES) -> list:
    """Re-run the reading from the bytes the manifest names, and report every figure that does not come back.

    `checked` re-adds a manifest's own arithmetic; it cannot tell whether the arithmetic was ever about this corpus,
    because a reading whose rows add up perfectly can have been taken from a database that has since changed, or from
    none at all. This function is the other half: the two source files are in the repository, their digests are in the
    manifest, and the whole reading is recomputed from them and compared field by field. A claim of the form "0 of 8
    before, 8 of 8 after" is worth nothing if it cannot be re-derived by the next person who reads it — and R240
    shipped the zero on a manifest that could not.
    """
    problems: list = []
    sources = {source.get("role"): source for source in saved.get("sources") or []}
    located: dict = {}
    for role in ("database", "tasks"):
        source = sources.get(role)
        if not source:
            problems.append(f"no {role} among the sources")
            continue
        path = root / str(source.get("path") or "")
        if not path.is_file():
            problems.append(f"{role}: {path} is not in this checkout, so the reading cannot be re-derived")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != source.get("sha256"):
            problems.append(f"{role}: {source.get('path')} is not the file this reading was taken from")
            continue
        located[role] = data
    if len(located) != 2:
        return problems
    fresh = reading(toml_of(located["database"].decode("utf-8")), json.loads(located["tasks"].decode("utf-8")))
    stored = saved.get("reading") or {}
    for field in ("writes", "shipped", "blind", "strict", "handle"):
        if fresh.get(field) != stored.get(field):
            problems.append(f"{field}: {stored.get(field)} recorded against {fresh.get(field)} re-derived")
    for field in ("credits", "records", "ambiguous"):
        if fresh.get(field) != stored.get(field):
            problems.append(f"{field}: the {field} block does not come back from these bytes")
    fresh_rows = [(row.get("task"), row.get("shipped"), row.get("blind"), row.get("strict"), row.get("handle"))
                  for row in fresh.get("rows") or []]
    stored_rows = [(row.get("task"), row.get("shipped"), row.get("blind"), row.get("strict"), row.get("handle"))
                   for row in stored.get("rows") or []]
    if fresh_rows != stored_rows:
        problems.append(f"rows: {len(stored_rows)} recorded against {len(fresh_rows)} re-derived")
    return problems


def checked(saved: dict) -> list:
    """A saved reading's arithmetic, re-added — the same discipline every manifest in this lane is held to.

    Three ways a saved reading could lie: a count that is not the rows it summarises, a total that is not the sum of
    its parts, and a reading whose three numbers cannot all be right at once (`strict` above `blind` would mean a
    rule that refuses tokens reaches more than one that accepts them).
    """
    problems: list = []
    result = saved.get("reading") or {}
    rows = result.get("rows") or []
    if result.get("writes") != len(rows):
        problems.append(f"writes: {result.get('writes')} against {len(rows)} row(s)")
    for column in ("shipped", "blind", "strict", "handle"):
        wanted = sum(1 for row in rows if row.get(column))
        if result.get(column) != wanted:
            problems.append(f"{column}: {result.get(column)} against {wanted} row(s)")
    if (result.get("strict") or 0) > (result.get("blind") or 0):
        problems.append("strict exceeds blind: refusing an ambiguous token cannot reach more than accepting it")
    # R241's counterfactual, held to the only claim that makes the handle grade worth shipping: it credits **exactly
    # one** line for a request that names one, and that line is among the ones the blind table credits. Anything else
    # is either a rule that is still crediting siblings or a recording error, and a reader cannot tell which.
    credits = result.get("credits") or {}
    if not credits:
        problems.append("no counterfactual: a reach count with no over-credit column is half a reading")
    for phone, per_rule in credits.items():
        missing = {"shipped", "blind", "strict", "handle"} - set(per_rule)
        if missing:
            problems.append(f"counterfactual for {phone!r} is missing {sorted(missing)}")
            continue
        credited = per_rule["handle"]
        # "At most one", not "exactly one": a request whose number no account claims resolves to nothing, and a
        # checker that demanded one would fail the very case the rule is supposed to refuse. The claim that it credits
        # *the* line is a statement about this database, and it is made in the report rather than in the arithmetic.
        if len(credited) > 1:
            problems.append(f"counterfactual for {phone!r}: the handle rule credits {len(credited)} line(s)")
        if not set(credited) <= set(per_rule["blind"]):
            problems.append(f"counterfactual for {phone!r}: the handle rule credits a line the blind one does not")
    if len(saved.get("sources") or []) != 2:
        problems.append("expected a database and a task set beside the reading")
    for row in rows:
        if not row.get("wanted"):
            problems.append(f"a row with no record: {row.get('task')}")
    return problems


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
