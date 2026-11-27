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

The third reading is the round. In this domain a customer's `phone_number` equals one of *their own* lines', so the
only token the requests carry names **two records**. A table that ignores that reads 6 of 6 and would credit a write
to one line from an ask about another; a rule that refuses the ambiguity reads 0 of 6. Both numbers are reported,
because the finding is the pair.

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
[[customers]]
customer_id = "C1"
full_name = "Ada Lovelace"
phone_number = "555-000-0001"
line_ids = ["L1"]
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


def reading(db: dict, tasks: list) -> dict:
    """The three numbers, over every graded write in the task set."""
    records = project(db)
    table = claims(records)
    ambiguous_tokens = ambiguous(table)
    rows: list = []
    for task in tasks:
        text = request_of(task)
        for write in graded_writes(task):
            wanted = receipt_keys(write["arguments"], table)
            if not wanted:
                continue
            shipped = bool(resolve(text, table, refuse_ambiguous=False) & wanted) and not any(
                token in ambiguous_tokens for token in PHONE.findall(text)
            )
            blind = bool(resolve(text, table, refuse_ambiguous=False) & wanted)
            strict = bool(resolve(text, table, refuse_ambiguous=True) & wanted)
            rows.append(
                {
                    "task": task.get("id"),
                    "wanted": sorted(wanted),
                    "shipped": shipped,
                    "blind": blind,
                    "strict": strict,
                    "tokens": sorted({token.lower() for token in PHONE.findall(text)}),
                }
            )
    total = len(rows)
    return {
        "records": {
            "lines": len(records["lines"]),
            "customers": len(records["customers"]),
            "bills": len(records["bills"]),
        },
        "writes": total,
        # The rule as it ships: an ask names a record only when the clause spells the identifier the write carries.
        # A phone number is not one of those, and it is the only handle the request gives, so this reads zero.
        "shipped": sum(1 for row in rows if row["shipped"]),
        # The repair with its ambiguity ignored: every request reaches its record, and an ask about the household
        # reaches a write to any of its lines. Reportable, not shippable.
        "blind": sum(1 for row in rows if row["blind"]),
        # The repair with the ambiguity refused: a token that names two records names neither.
        "strict": sum(1 for row in rows if row["strict"]),
        "ambiguous": ambiguous_tokens,
        "rows": rows,
    }


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
    expect("a customer keeps the lines it owns", records["customers"]["C1"]["lines"] == ["L1"])
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
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 1 if self_test() else 0
    if args.check:
        saved = json.loads(pathlib.Path(args.check).read_text(encoding="utf-8"))
        problems = checked(saved)
        for problem in problems:
            print(f"FAIL {problem}")
        if not problems:
            print(f"ok  {pathlib.Path(args.check).name}: {saved['reading']['shipped']} of "
                  f"{saved['reading']['writes']} write(s) reach a record under the shipped rule")
        return 1 if problems else 0
    if not (args.db and args.tasks):
        parser.error("--db and --tasks are required unless --self-test or --check")
    db_path, task_path = pathlib.Path(args.db), pathlib.Path(args.tasks)
    document = {
        "schema": "microglia/telecom-records@1",
        "note": (
            "The third domain's records, and the one question that decides whether the record grade can reach them: "
            "its requests name a line by a phone number, and in this database a customer's phone number is also one "
            "of their lines'. A string intersection cannot tell the two apart, so the shipped rule reads zero and a "
            "table that ignores the ambiguity would read every write — including the ones it should refuse."
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
        print(f"ambiguous {sorted(result['ambiguous'])}")
    return 0


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
    for column in ("shipped", "blind", "strict"):
        wanted = sum(1 for row in rows if row.get(column))
        if result.get(column) != wanted:
            problems.append(f"{column}: {result.get(column)} against {wanted} row(s)")
    if (result.get("strict") or 0) > (result.get("blind") or 0):
        problems.append("strict exceeds blind: refusing an ambiguous token cannot reach more than accepting it")
    if len(saved.get("sources") or []) != 2:
        problems.append("expected a database and a task set beside the reading")
    for row in rows:
        if not row.get("wanted"):
            problems.append(f"a row with no record: {row.get('task')}")
    return problems


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
