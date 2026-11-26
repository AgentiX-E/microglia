#!/usr/bin/env python3
"""Does the request name the record its write touches? R227's bar, measured before any money is spent.

R217a refused the airline dispatch because the board's *family* rule found 30.0% of the required writes. The
successor rewrites the contract rather than the word list: an item settles a receipt that **touches the record the ask
names**, whichever family that receipt is in. That contract is only worth arming if requests name their records, and
the registration puts a number on it — record recall at or above **0.75**, measured by a census.

This is that census, and it is the first one in this lane whose ground truth is *state* rather than a call name. The
record a write touches is resolved against the domain's own database (projected by `scripts/build_airline_records.py`,
with the source's sha256 beside it), and the request is tokenised by the board's own `words_of`, so the reading
describes what the board can see rather than what a regex could see.

## Three grades, and why the ladder is reported rather than one number

    id      the request contains the reservation code the write carries
    unique  the request contains a token that appears in exactly one of the user's records — a route end, a
            passenger, a flight number, a date — so it identifies that record among the ones the user owns
    pair    the request contains at least two of the record's identity tokens

A single shared token is **not** naming: "economy" is in the record and in the request and identifies nothing. A pair
is the weakest rule that can identify a route or a flight-and-date, which is how this corpus writes a record it does
not code. All three are reported because a bar cleared only by the loosest rule is a bar cleared by a looser contract
than the one that would ship, and the ladder makes that visible instead of arguable.

Two structural rules keep the reading honest:

* **identity is the record's own fields** — code, route (code and city), flight numbers, dates, passengers. Cabin and
  flight type are in the record and are deliberately excluded: they describe the record's class, not which record it
  is, and including them raises the reading by matching `economy`.
* **a booking has no record yet**, so its identity is the itinerary the graded call asks for, with airports resolved
  from the domain's flight table. Skipping those writes would report a booking as a miss of a rule that never applied
  to it.

Run: `python3 eval/tools/record_census.py --self-test`
     `python3 eval/tools/record_census.py --goals eval/manifests/airline-records.json --family-found 15 --json`
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

#: The months this corpus writes dates with. A request says "May 20" and the record stores `2024-05-20`, so a census
#: without this map reads every date as a miss — and the corpus is set in thirteen days of May and two of June, which
#: makes a date one of the few tokens that identifies a leg rather than a class.
MONTHS = {
    name: index
    for index, name in enumerate(
        "january february march april may june july august september october november december".split(),
        start=1,
    )
}

#: The year the corpus is set in. A date written without one is the corpus's own.
YEAR = 2024

#: Grades, best first. A write is reported at the best grade it reaches, so the columns nest and the steps between
#: them are the only difference between the rules.
GRADES = ("id", "unique", "pair")


def _siblings() -> str:
    """Put this file's own directory on `sys.path`, and answer it.

    `goal_board` lives beside this file and is imported for its tokeniser rather than for a function: two readings of
    the same request that disagreed about what a word is would be two readings of two different requests. The import
    is lazy for the reason `goal_board` gives its own — script mode puts the directory on the path and
    `python3 -m coverage run` does not, and CI measures this module through `-m`.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    return here


def board_words(text) -> list:
    """The board's own content words, imported at the call rather than at the module."""
    _siblings()
    from goal_board import words_of  # noqa: PLC0415 - see `_siblings`

    return words_of(text)


def iso_dates(text) -> "set[str]":
    """The dates a sentence states, normalised to the form the record stores.

    Both orders the corpus uses ("May 20", "20 May"), the ordinal suffix ("May 20th"), and an ISO date written out.
    A bare number is **not** a date: "add 3 bags" would otherwise become 2024-03-03 and match nothing, which is
    harmless, or match a record's flight on the third, which is not.
    """
    if not isinstance(text, str):
        return set()
    lowered = text.lower()
    found: "set[str]" = set()
    months = "|".join(MONTHS)
    for match in re.finditer(rf"\b({months})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", lowered):
        found.add(f"{YEAR}-{MONTHS[match.group(1)]:02d}-{int(match.group(2)):02d}")
    for match in re.finditer(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({months})\b", lowered):
        found.add(f"{YEAR}-{MONTHS[match.group(2)]:02d}-{int(match.group(1)):02d}")
    for match in re.finditer(rf"\b{YEAR}-\d{{2}}-\d{{2}}\b", lowered):
        found.add(match.group(0))
    return found


def request_tokens(text) -> "set[str]":
    """What the request says, in the board's own vocabulary plus the dates it states.

    The board's `words_of` drops pure numbers, so a date never survives it; adding the normalised form back is the
    smallest honest repair and it is applied to both sides of the comparison.
    """
    return set(board_words(text)) | iso_dates(text)


def route_tokens(code: str, cities: dict) -> "list[str]":
    """An airport as the record stores it and as a user says it: `JFK` and New York.

    The city is expanded through the manifest's map rather than a table in this file, because the map is part of the
    projection from the domain and a second copy here would drift from it.
    """
    if not code:
        return []
    found = [code.lower()]
    city = cities.get(code.upper()) or ""
    found.extend(board_words(city))
    return found


def itinerary_tokens(flights: list, passengers: list, cities: dict) -> "set[str]":
    """The identity of an itinerary: its flight numbers, both ends of every leg, its dates, and its passengers.

    This is what a booking is measured on and what a change is measured *by*: the new legs are the ones the request
    states ("change it to a nonstop from ATL to LAS"), while the record's own route is what is being changed from.
    """
    found: "set[str]" = set()
    for flight in flights or []:
        number = (flight.get("number") or "").lower()
        if number:
            found.add(number)
        found.update(route_tokens(flight.get("origin") or "", cities))
        found.update(route_tokens(flight.get("destination") or "", cities))
        date = (flight.get("date") or "").lower()
        if date:
            found.add(date)
    for passenger in passengers or []:
        for part in passenger or []:
            found.update(board_words(part))
    return found


def record_tokens(record: dict, cities: dict) -> "set[str]":
    """The identity of a reservation: its code, its route, its flights, its dates, its passengers.

    Cabin, flight type, baggage count and insurance are left out on purpose — see the module docstring. They are
    facts a request can ask to *change*, so a match on them is a match on the question rather than on the record.
    """
    found: "set[str]" = set()
    identifier = (record.get("id") or "").lower()
    if identifier:
        found.add(identifier)
    found.update(route_tokens(record.get("origin") or "", cities))
    found.update(route_tokens(record.get("destination") or "", cities))
    found.update(itinerary_tokens(record.get("flights") or [], record.get("passengers") or [], cities))
    return found


def write_tokens(write: dict, records: list, cities: dict) -> "set[str]":
    """Everything the graded call names: the record it touches and the itinerary it asks for.

    A read of the arguments alone would miss every `cancel_reservation`, which carries a code and nothing else; a read
    of the record alone would miss every booking, which carries no code at all. Both answer the same question — what
    does this call name — so both are folded in.
    """
    found = set(itinerary_tokens(write.get("itinerary") or [], write.get("passengers") or [], cities))
    identifier = write.get("record")
    if identifier:
        found.add(identifier.lower())
        for record in records or []:
            if (record.get("id") or "") == identifier:
                found.update(record_tokens(record, cities))
    return found


def grade(write: dict, records: list, cities: dict, request: "set[str]", shared: dict) -> str:
    """The best grade at which the request names the record this write touches, or `""`.

    `shared` maps a token to how many of the user's records carry it, computed once per task: a token in two records
    is not an identification however many times it appears. A token that is in the write's itinerary and in no record
    at all counts as identifying — a flight number the agent has just been offered names that leg and nothing else.
    """
    identifier = (write.get("record") or "").lower()
    if identifier and identifier in request:
        return "id"
    matched = write_tokens(write, records, cities) & request
    if not matched:
        return ""
    if any(shared.get(token, 0) <= 1 for token in matched):
        return "unique"
    return "pair" if len(matched) >= 2 else ""


def board_items(text: str) -> list:
    """The board's own ask extraction, imported at the call for the same reason as its tokeniser."""
    _siblings()
    from goal_board import items_of  # noqa: PLC0415 - see `_siblings`

    return items_of(text)


def board_families() -> dict:
    """The board's tool-to-family table, which decides what counts as a state change at all."""
    _siblings()
    from goal_board import FAMILIES  # noqa: PLC0415 - see `_siblings`

    return FAMILIES


def family_hits(reason: str, writes: list) -> "list[bool]":
    """Whether the family rule reaches each write, with the same allocation `goal_board.census` uses.

    One ask of a family settles **one** write of that family: a request that says "cancel my reservations" once and
    is graded on three cancels has stated one family, and a rule that counted it three times would report a parser
    that found 100% of a set it named once. The allocation is the retail census's and it is re-derived here rather
    than imported because it is applied to *writes* here and to *families* there; CI asserts the two totals agree.
    """
    families = board_families()
    budget: dict = {}
    for item in board_items(reason):
        budget[item["family"]] = budget.get(item["family"], 0) + 1
    found: "list[bool]" = []
    for write in writes:
        family = families.get(write.get("name") or "")
        if family and budget.get(family, 0) > 0:
            budget[family] -= 1
            found.append(True)
        else:
            found.append(False)
    return found


def census(document: dict) -> dict:
    """The reading: each grade's share of the graded writes, the misses, and the per-task rows.

    The **family column is computed here as well**, because it is needed twice: once as the set of writes the old rule
    reaches, which is what the union has to be taken over, and once as a check that this file and `goal_board.census`
    agree about the same 50 writes. CI asserts both totals against the numbers R217a published.
    """
    cities = document.get("cities") or {}
    counts = {name: 0 for name in GRADES}
    totals = {"tasks": 0, "writing": 0, "refusing": 0, "writes": 0, "familyFound": 0, "unionFound": 0}
    misses: "list[dict]" = []
    per_task: "list[dict]" = []
    for task in document.get("tasks") or []:
        writes = task.get("writes") or []
        records = task.get("records") or []
        totals["tasks"] += 1
        if not writes:
            totals["refusing"] += 1
            continue
        totals["writing"] += 1
        reason = task.get("reason") or ""
        request = request_tokens(reason)
        shared: dict = {}
        for record in records:
            for token in record_tokens(record, cities):
                shared[token] = shared.get(token, 0) + 1
        by_family = family_hits(reason, writes)
        row = {
            "id": task.get("id"), "writes": len(writes), "named": 0, "family": sum(by_family), "union": 0,
            "grades": {name: 0 for name in GRADES},
        }
        for index, write in enumerate(writes):
            found = grade(write, records, cities, request, shared)
            totals["writes"] += 1
            totals["familyFound"] += 1 if by_family[index] else 0
            row["union"] += 1 if (found or by_family[index]) else 0
            if found:
                counts[found] += 1
                row["named"] += 1
                row["grades"][found] += 1
            else:
                misses.append({
                    "task": task.get("id"),
                    "name": write.get("name"),
                    "record": write.get("record"),
                    "tokens": len(write_tokens(write, records, cities)),
                    "family": by_family[index],
                })
        totals["unionFound"] += row["union"]
        per_task.append(row)
    # The columns nest: every write the code grade reaches is also reached by the two weaker rules. `counts` holds the
    # writes whose **best** grade is exactly that one, so the three thresholds are sums over it and nothing is counted
    # twice. A reader who wants the exact grade reads `counts`; a reader who wants the bar reads `pairRecall`.
    writes = totals["writes"]
    every = counts["id"] + counts["unique"] + counts["pair"]
    single = counts["id"] + counts["unique"]
    return {
        **totals,
        "counts": counts,
        "idOnly": counts["id"],
        "idRecall": (counts["id"] / writes) if writes else None,
        "single": single,
        "singleRecall": (single / writes) if writes else None,
        "pair": every,
        "pairRecall": (every / writes) if writes else None,
        "familyRecall": (totals["familyFound"] / writes) if writes else None,
        "unionRecall": (totals["unionFound"] / writes) if writes else None,
        "misses": misses,
        "perTask": per_task,
    }


def agreement(reading: dict, family_found: int) -> dict:
    """Whether this file's family column agrees with `goal_board --census` over the same writes.

    The allocation rule — one ask of a family settles one write of that family — is now implemented twice, once per
    tool, because one is applied to families and the other to writes. Two implementations of one rule is exactly the
    drift this project has paid for before, so the second is not trusted: it is **checked** against the first, in the
    self-test on a fixture and in CI on the corpus, and a disagreement fails the build rather than being reported.
    """
    theirs = int(family_found)
    return {"recordCensus": reading.get("familyFound"), "goalBoard": theirs, "agrees": reading.get("familyFound") == theirs}


def render(reading: dict) -> str:
    """The reading as sentences, in the order the round's bar is stated."""
    def share(value) -> str:
        return "n/a" if value is None else f"{value:.1%}"

    lines = [
        f"{reading['writes']} graded write(s) over {reading['writing']} writing task(s) and "
        f"{reading['refusing']} task(s) whose correct outcome is no write",
        f"  id      {reading['idOnly']:2d}/{reading['writes']}  {share(reading['idRecall'])}  the request states the code",
        f"  unique  {reading['single']:2d}/{reading['writes']}  {share(reading['singleRecall'])}  a token only this record carries",
        f"  pair    {reading['pair']:2d}/{reading['writes']}  {share(reading['pairRecall'])}  two identity tokens together",
        f"  family  {reading['familyFound']:2d}/{reading['writes']}  {share(reading['familyRecall'])}  "
        f"the tool's family, which is the rule this round retires",
        f"  union   {reading['unionFound']:2d}/{reading['writes']}  {share(reading['unionRecall'])}  record or family, each write once",
    ]
    if reading["misses"]:
        lines.append(f"{len(reading['misses'])} write(s) no rule reaches:")
        for miss in reading["misses"]:
            lines.append(
                f"  task {miss['task']:>2}  {miss['name']:30s} record {miss['record'] or '-':6s} "
                f"{miss['tokens']} identity token(s), family {'yes' if miss['family'] else 'no'}"
            )
    return "\n".join(lines)


def _quiet(argv: list) -> int:
    """Run the command line with its output discarded, so a self-test can reach the handlers."""
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()):
        return main(argv)


def _quiet_report(failed: list) -> int:
    """Report with the output discarded, so the negative control does not print a failure the build should not see."""
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()):
        return _report(failed)


def _capture(argv: list) -> str:
    """Run the command line and return what it printed, for the assertions that read the output."""
    import contextlib
    import io

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        main(argv)
    return buffer.getvalue()


#: The names of the assertions that failed. A list rather than a counter so the reporting branch is exercised by the
#: suite that reports: a self-test whose failure path is never run is a suite that cannot fail visibly.
def _report(failed: list) -> int:
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("record census: all assertions hold")
    return 0


def self_test() -> int:
    """Assertions over records small enough to check by eye."""
    failed: "list[str]" = []

    def check(name: str, condition: bool) -> None:
        if not condition:
            failed.append(name)

    cities = {"JFK": "New York", "LAX": "Los Angeles", "ATL": "Atlanta", "LAS": "Las Vegas"}

    # The module finds its own directory, and the tokeniser is the board's rather than a second one.
    check("the module finds its own directory", _siblings() == os.path.dirname(os.path.abspath(__file__)))
    check("the board's tokeniser is the one used", board_words("the lamp") == ["lamp"])

    # Dates. The corpus writes "May 20", "20 May", "May 20th" and stores 2024-05-20.
    check("a month-first date normalises", iso_dates("on May 20") == {"2024-05-20"})
    check("a day-first date normalises", iso_dates("on 20 May") == {"2024-05-20"})
    check("an ordinal normalises", iso_dates("on May 20th") == {"2024-05-20"})
    check("a day-first ordinal normalises", iso_dates("the 3rd of June") == {"2024-06-03"})
    check("an ISO date is kept", iso_dates("on 2024-05-20") == {"2024-05-20"})
    check("a bare number is not a date", iso_dates("add 3 bags") == set())
    check("a non-string states no date", iso_dates(None) == set())
    check("the date is not a word the tokeniser keeps", "20" not in board_words("on May 20"))
    check("and the request keeps it anyway", "2024-05-20" in request_tokens("on May 20"))

    # A record's identity.
    record = {
        "id": "XEHM4B", "origin": "JFK", "destination": "LAS", "cabin": "business", "flightType": "round_trip",
        "flights": [{"number": "HAT005", "origin": "JFK", "destination": "LAS", "date": "2024-05-20"}],
        "passengers": [["Omar", "Rossi"]],
    }
    tokens = record_tokens(record, cities)
    check("the code is identity", "xehm4b" in tokens)
    check("the route end is identity", "jfk" in tokens)
    check("the city is identity too", "new" in tokens and "york" in tokens)
    check("a flight number is identity", "hat005" in tokens)
    check("a date is identity", "2024-05-20" in tokens)
    check("a passenger is identity", "omar" in tokens)
    check("the cabin is not identity", "business" not in tokens)
    check("the flight type is not identity", "round" not in tokens and "trip" not in tokens)
    check("a record with no code still has tokens", "atl" in record_tokens({"origin": "ATL"}, cities))
    check("an empty route expands to nothing", route_tokens("", cities) == [])
    check("an unknown airport keeps its code", route_tokens("XXX", cities) == ["xxx"])
    check("an itinerary with no date adds none", itinerary_tokens([{"number": "HAT1", "origin": "", "destination": ""}],
                                                                 [], cities) == {"hat1"})

    # Three grades on one record set.
    other = {"id": "ZZ9999", "origin": "ATL", "destination": "LAS", "flights": [], "passengers": []}
    records = [record, other]
    shared: dict = {}
    for entry in records:
        for token in record_tokens(entry, cities):
            shared[token] = shared.get(token, 0) + 1
    write = {"name": "cancel_reservation", "record": "XEHM4B", "itinerary": [], "passengers": []}
    check("the code is the top grade",
          grade(write, records, cities, request_tokens("cancel XEHM4B"), shared) == "id")
    check("a passenger alone identifies",
          grade(write, records, cities, request_tokens("remove Omar"), shared) == "unique")
    check("a route end that one record carries identifies",
          grade(write, records, cities, request_tokens("the flight from New York"), shared) == "unique")
    check("a route end two records carry does not",
          grade(write, records, cities, request_tokens("the LAS flight"), shared) == "")
    check("a route with both ends and a date reaches a grade",
          grade(write, records, cities, request_tokens("from New York to Las Vegas on May 20"), shared) == "unique")
    check("two tokens neither of which identifies reach the pair grade",
          grade(write, records, cities, request_tokens("New York to Las Vegas"), shared) in ("unique", "pair"))
    check("an unrelated request names nothing", grade(write, records, cities, request_tokens("hello"), shared) == "")
    check("a write that names no record still has identity", "hat005" in write_tokens({"itinerary": [
        {"number": "HAT005"}], "passengers": []}, records, cities))

    # A booking is measured on the itinerary it asks for.
    booking = {
        "name": "book_reservation", "record": None,
        "itinerary": [{"number": "HAT110", "origin": "LAX", "destination": "JFK", "date": "2024-05-24"}],
        "passengers": [["Mei", "Li"]],
    }
    check("a booking has tokens", "hat110" in write_tokens(booking, [], cities))
    check("a booking names its route through the flight table",
          grade(booking, [], cities, request_tokens("fly from Los Angeles to New York on May 24"), {}) != "")
    check("a booking the request does not state is a miss",
          grade(booking, [], cities, request_tokens("book the cheapest flight you can find"), {}) == "")

    # The census over a document small enough to check by hand.
    document = {
        "cities": cities,
        "tasks": [
            {"id": "1", "reason": "cancel XEHM4B", "records": records, "writes": [write]},
            {"id": "2", "reason": "hello", "records": records, "writes": [write]},
            {"id": "3", "reason": "cancel everything", "records": records, "writes": []},
        ],
    }
    reading = census(document)
    check("the census counts tasks", reading["tasks"] == 3)
    check("a task with no write is a refusal task", reading["refusing"] == 1)
    check("writing tasks are counted apart", reading["writing"] == 2)
    check("the write is counted once per task", reading["writes"] == 2)
    check("one code match is the id grade", reading["counts"]["id"] == 1)
    check("the columns nest", reading["single"] == 1 and reading["pair"] == 1)
    check("a write no rule reaches is a miss", len(reading["misses"]) == 1)
    check("the miss names its task", reading["misses"][0]["task"] == "2")
    check("the miss counts the identity it had", reading["misses"][0]["tokens"] > 0)
    check("the shares are over writes", reading["singleRecall"] == 0.5)
    check("the per-task row counts what it named", reading["perTask"][0]["named"] == 1)
    check("an empty document reads as nothing", census({"tasks": []})["pairRecall"] is None)

    check("the family rule is applied per write, not per family", reading["familyFound"] == 1)
    check("the union is over writes, not over finds", reading["unionFound"] == 1)
    check("a write both rules reach is counted once", reading["unionRecall"] == 0.5)
    check("the agreement names both readings", agreement(reading, 1)["agrees"] is True)
    check("and a disagreement is a disagreement", agreement(reading, 2)["agrees"] is False)
    check("an empty union reads as nothing", census({"tasks": []})["unionRecall"] is None)

    # The reading is rendered, not summarised by hand.
    text = render(reading)
    check("the reading states its denominators", "2 graded write(s)" in text)
    check("the reading names the three grades", "unique" in text and "pair" in text and "id " in text)
    check("the reading states the union", "union" in text)
    check("a miss is printed", "task  2" in text)
    check("a reading with no miss prints no miss line", "no rule reaches" not in render({**reading, "misses": []}))

    # The command line, over a document this test writes.
    import tempfile

    with tempfile.TemporaryDirectory() as temporary:
        path = os.path.join(temporary, "records.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        check("the census runs from the command line", _quiet(["--goals", path]) == 0)
        check("a missing argument prints the usage", _quiet([]) == 2)
        parsed = json.loads(_capture(["--goals", path, "--json"]))
        check("the json form parses", parsed["writes"] == 2)
        check("and carries the union", parsed["unionFound"] == 1)
        check("a family count that agrees passes", _quiet(["--goals", path, "--family-found", "1"]) == 0)
        check("a family count that disagrees fails the run", _quiet(["--goals", path, "--family-found", "2"]) == 1)
        check("the disagreement is printed", "disagree" in _capture(["--goals", path, "--family-found", "2"]))

    check("the reporter on an empty list exits zero", _quiet_report([]) == 0)
    check("the reporter on a failure exits one", _quiet_report(["negative control (must fail)"]) == 1)
    return _report(failed)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Does the request name the record its write touches?")
    parser.add_argument("--goals", default="")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--family-found", type=int, default=None,
                        help="the family reading over the same writes, from goal_board --census")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if not arguments.goals:
        parser.print_help()
        return 2
    with open(arguments.goals, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    reading = census(document)
    if arguments.family_found is not None:
        checked = agreement(reading, arguments.family_found)
        reading["agreement"] = checked
        if not checked["agrees"]:
            print(f"the family column disagrees with goal_board: {checked['recordCensus']} here, {checked['goalBoard']} there")
            return 1
    if arguments.json:
        print(json.dumps(reading, indent=1, sort_keys=True))
    else:
        print(render(reading))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
