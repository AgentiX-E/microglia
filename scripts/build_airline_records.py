#!/usr/bin/env python3
"""Project the airline domain's database down to the records its own tasks are graded on.

R227's question is whether a request **names the record** its write touches, and the only honest instrument for it
is the state the environment holds before the episode starts: `get_reservation_details` returns the reservation
object, so the record's identity tokens — its code, its route, its flight numbers, its dates, its passengers — are
exactly what the board could ever read. The database is 7 MB and 2000 records; the 50 airline tasks touch 27 users.
So this script writes the slice, and writes it **reproducibly**: the source's sha256 travels into the artefact beside
the bytes, the same way `airline-goals.json` carries its own.

Two rules keep the projection from being a private convenience:

* **nothing is dropped that a read would show.** Every field the read tool serialises is kept for the record, because
  a token left out here is a match the census could not see and the round would report as a miss;
* **the write side is the evaluator's own arguments**, not a re-derivation: `record` is the `reservation_id` the
  graded call carries and `itinerary` is the flight list it asks for, so a booking (which has no record yet) is
  measured on the itinerary it names rather than skipped.

Usage:
  build_airline_records.py --db /path/to/db.json --tasks /path/to/tasks.json --out eval/manifests/airline-records.json
  build_airline_records.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys

#: The tools whose calls change state. Kept in step with `goal_board.FAMILIES` by an assertion rather than by an
#: import: this script must run on a machine that never installed the lane, and a drift between the two lists would
#: show up as a task whose writes nobody measured.
WRITES = (
    "cancel_reservation",
    "update_reservation_flights",
    "update_reservation_passengers",
    "update_reservation_baggages",
    "book_reservation",
    "transfer_to_human_agents",
)

#: Airports in the domain, mapped to the city name a request would use. The database stores codes and some requests
#: say "New York" where the record says `JFK`, so the map is part of the projection rather than a later convenience:
#: a census that could not expand it would score a match as a miss and report the miss as a property of the parser.
CITIES = {
    "ATL": "Atlanta",
    "BOS": "Boston",
    "CLT": "Charlotte",
    "DEN": "Denver",
    "DFW": "Dallas",
    "DTW": "Detroit",
    "EWR": "Newark",
    "IAH": "Houston",
    "JFK": "New York",
    "LAS": "Las Vegas",
    "LAX": "Los Angeles",
    "LGA": "New York",
    "MCO": "Orlando",
    "MIA": "Miami",
    "MSP": "Minneapolis",
    "ORD": "Chicago",
    "PHL": "Philadelphia",
    "PHX": "Phoenix",
    "SEA": "Seattle",
    "SFO": "San Francisco",
}


def user_of(task: dict) -> str:
    """The user the task is about, read from the sentence the simulator is given.

    `known_info` is the only field that carries it and it is written four different ways across the corpus —
    `Your user id is x`, `Your user id is  x`, `Your user id is 'x'.` — so the pattern allows the quote and the
    extra space. A task this cannot parse is a task whose records are unknown, and it is returned as `""` rather
    than guessed: a wrong user would make every one of that task's records look foreign.
    """
    instructions = (task.get("user_scenario") or {}).get("instructions") or {}
    known = instructions.get("known_info") or ""
    found = re.search(r"user id is\s+'?([a-z0-9_]+)", known, re.IGNORECASE)
    return found.group(1) if found else ""


def record_of(record: dict) -> dict:
    """One reservation, flattened to the fields a read returns and a request can name."""
    flights = [
        {
            "number": flight.get("flight_number") or "",
            "origin": flight.get("origin") or "",
            "destination": flight.get("destination") or "",
            "date": flight.get("date") or "",
        }
        for flight in record.get("flights") or []
    ]
    return {
        "id": record.get("reservation_id") or "",
        "origin": record.get("origin") or "",
        "destination": record.get("destination") or "",
        "cabin": record.get("cabin") or "",
        "flightType": record.get("flight_type") or "",
        "flights": flights,
        "passengers": [
            [passenger.get("first_name") or "", passenger.get("last_name") or ""]
            for passenger in record.get("passengers") or []
        ],
        "totalBaggages": int(record.get("total_baggages") or 0),
        "insurance": record.get("insurance") or "",
    }


def write_of(action: dict) -> dict:
    """One graded state-changing call, flattened to what it names: the record it touches and the itinerary it asks for."""
    arguments = action.get("arguments") or {}
    flights = [
        {
            "number": flight.get("flight_number") or "",
            "date": flight.get("date") or "",
        }
        for flight in arguments.get("flights") or []
    ]
    return {
        "name": action.get("name") or "",
        "objects": 1,
        "record": arguments.get("reservation_id") or None,
        "itinerary": flights,
        "passengers": [
            [passenger.get("first_name") or "", passenger.get("last_name") or ""]
            for passenger in arguments.get("passengers") or []
        ],
        "cabin": arguments.get("cabin") or "",
        "baggages": arguments.get("total_baggages"),
    }


def project(tasks: list, reservations: dict, flights: dict) -> dict:
    """The manifest: per task, the user's records and the evaluator's own writes.

    `resolved` is the itinerary with its airports filled in from the flight table. The board never sees a flight
    number's route until a search returns it, so a booking is namable only through that resolution, and doing it
    here — with the table the domain ships — is what lets the census measure the request instead of the lookup.
    """
    by_user: dict = {}
    for record in reservations.values():
        by_user.setdefault(record.get("user_id") or "", []).append(record)

    entries = []
    for task in tasks:
        user = user_of(task)
        criteria = task.get("evaluation_criteria") or {}
        writes = []
        for action in criteria.get("actions") or []:
            if action.get("name") not in WRITES:
                continue
            write = write_of(action)
            for flight in write["itinerary"]:
                known = flights.get(flight["number"]) or {}
                flight["origin"] = known.get("origin") or ""
                flight["destination"] = known.get("destination") or ""
            writes.append(write)
        entries.append(
            {
                "id": str(task.get("id")),
                "user": user,
                "reason": ((task.get("user_scenario") or {}).get("instructions") or {}).get("reason_for_call") or "",
                "writes": writes,
                "records": [record_of(record) for record in sorted(by_user.get(user) or [], key=lambda r: r.get("reservation_id") or "")],
            }
        )
    return {
        "cities": CITIES,
        "tasks": entries,
    }


def _digest(path: pathlib.Path) -> "tuple[str, int]":
    payload = path.read_bytes()
    return hashlib.sha256(payload).hexdigest(), len(payload)


#: The names of the assertions that failed. A list rather than a counter so the reporting branch is exercised by the
#: suite that reports: a self-test whose failure path is never run is a suite that cannot fail visibly.
def _report(failed: list) -> int:
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("record manifest: all assertions hold")
    return 0


def self_test() -> int:
    """Assertions over text a reader can check by eye."""
    failed: "list[str]" = []

    def check(name: str, condition: bool) -> None:
        if not condition:
            failed.append(name)

    check("a quoted user id parses", user_of({"user_scenario": {"instructions": {
        "known_info": "Your user id is 'daiki_muller_1116'."}}}) == "daiki_muller_1116")
    check("a padded user id parses", user_of({"user_scenario": {"instructions": {
        "known_info": "You are Anya Garcia.\n\nYour user id is  anya_garcia_5901."}}}) == "anya_garcia_5901")
    check("an absent user id is empty", user_of({"user_scenario": {"instructions": {}}}) == "")
    check("a task with no scenario is empty", user_of({}) == "")

    record = record_of({
        "reservation_id": "XEHM4B", "origin": "IAH", "destination": "PHL", "cabin": "business",
        "flight_type": "round_trip", "total_baggages": 2, "insurance": "yes",
        "flights": [{"flight_number": "HAT005", "origin": "IAH", "destination": "PHL", "date": "2024-05-20", "price": 9}],
        "passengers": [{"first_name": "Omar", "last_name": "Rossi", "dob": "1970-06-06"}],
    })
    check("a record keeps its code", record["id"] == "XEHM4B")
    check("a record keeps its route", (record["origin"], record["destination"]) == ("IAH", "PHL"))
    check("a record keeps its flight", record["flights"][0]["number"] == "HAT005")
    check("a record keeps its passenger", record["passengers"] == [["Omar", "Rossi"]])
    check("a record drops the price, which no request can name", "price" not in record["flights"][0])
    check("an empty record is still a record", record_of({})["flights"] == [])

    write = write_of({"name": "update_reservation_flights", "arguments": {
        "reservation_id": "M05KNL", "cabin": "economy",
        "flights": [{"flight_number": "HAT110", "date": "2024-05-24"}],
        "passengers": [{"first_name": "Mei", "last_name": "Li"}], "total_baggages": 3}})
    check("a write names its record", write["record"] == "M05KNL")
    check("a write names its itinerary", write["itinerary"] == [{"number": "HAT110", "date": "2024-05-24"}])
    check("a booking names no record", write_of({"name": "book_reservation", "arguments": {}})["record"] is None)
    check("a write keeps the passenger it adds", write["passengers"] == [["Mei", "Li"]])

    projected = project(
        [
            {"id": 3, "user_scenario": {"instructions": {"known_info": "Your user id is u_1.", "reason_for_call": "r"}},
             "evaluation_criteria": {"actions": [
                 {"name": "get_reservation_details", "arguments": {"reservation_id": "A"}},
                 {"name": "book_reservation", "arguments": {"flights": [{"flight_number": "HAT110", "date": "d"}]}},
             ]}},
            {"id": 4, "user_scenario": {"instructions": {"known_info": "Your user id is nobody."}},
             "evaluation_criteria": {"actions": []}},
        ],
        {"R1": {"reservation_id": "R1", "user_id": "u_1", "flights": [], "passengers": []}},
        {"HAT110": {"origin": "LAX", "destination": "SFO"}},
    )
    check("a read is not a write", len(projected["tasks"][0]["writes"]) == 1)
    check("the itinerary is resolved against the flight table",
          projected["tasks"][0]["writes"][0]["itinerary"][0]["origin"] == "LAX")
    check("the user's records travel with the task", [r["id"] for r in projected["tasks"][0]["records"]] == ["R1"])
    check("a task id is a string", projected["tasks"][0]["id"] == "3")
    check("the cities travel with the manifest", projected["cities"]["JFK"] == "New York")

    # The command line over a database this test writes, so the projection's own entry point is measured rather than
    # trusted: a driver whose `main` never runs is a driver that has never written a manifest.
    import contextlib
    import io
    import json as _json
    import tempfile

    def quiet(argv: list) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return main(argv)

    def quiet_report(failed: list) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return _report(failed)

    with tempfile.TemporaryDirectory() as temporary:
        root = pathlib.Path(temporary)
        (root / "db.json").write_text(_json.dumps({
            "reservations": {"R1": {"reservation_id": "R1", "user_id": "u_1", "flights": [], "passengers": []}},
            "flights": {"HAT001": {"origin": "ATL", "destination": "DEN"}},
        }))
        (root / "tasks.json").write_text(_json.dumps({"tasks": [
            {"id": "9", "user_scenario": {"instructions": {"known_info": "Your user id is u_1."}},
             "evaluation_criteria": {"actions": [
                 {"name": "book_reservation", "arguments": {"flights": [{"flight_number": "HAT001", "date": "d"}]}}]}},
        ]}))
        out = root / "out.json"
        code = quiet(["--db", str(root / "db.json"), "--tasks", str(root / "tasks.json"), "--out", str(out)])
        written = _json.loads(out.read_text())
        # The corpus ships `tasks.json` as a bare list and the retail manifest as an object; both are read, because a
        # driver that only accepts one shape fails on the next domain for a reason that has nothing to do with records.
        bare = _json.loads((root / "tasks.json").read_text())["tasks"]
        (root / "wrapped.json").write_text(_json.dumps({"tasks": bare}))
        wrapped_out = root / "wrapped-out.json"
        wrapped_code = quiet(["--db", str(root / "db.json"), "--tasks", str(root / "wrapped.json"),
                              "--out", str(wrapped_out)])
    check("the command line writes a manifest", code == 0 and len(written["tasks"]) == 1)
    check("a task document that wraps its list is read too", wrapped_code == 0)
    check("the manifest names the source it came from", len(written["source"]["dbSha256"]) == 64)
    check("a manifest written from a task list is a list", written["tasks"][0]["writes"][0]["itinerary"][0]["origin"] == "ATL")
    check("a missing argument prints the usage", quiet([]) == 2)
    check("the reporter on an empty list exits zero", quiet_report([]) == 0)
    check("the reporter on a failure exits one", quiet_report(["negative control (must fail)"]) == 1)

    return _report(failed)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="Project the airline database down to the records its tasks touch.")
    parser.add_argument("--db", default="")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    if not (arguments.db and arguments.tasks and arguments.out):
        parser.print_help()
        return 2
    database = pathlib.Path(arguments.db)
    tasks_path = pathlib.Path(arguments.tasks)
    tasks = json.loads(tasks_path.read_text())
    if isinstance(tasks, dict):
        tasks = tasks.get("tasks") or []
    database_payload = json.loads(database.read_text())
    projected = project(tasks, database_payload.get("reservations") or {}, database_payload.get("flights") or {})
    db_digest, db_bytes = _digest(database)
    tasks_digest, tasks_bytes = _digest(tasks_path)
    document = {
        "source": {
            "db": "tau2-bench data/tau2/domains/airline/db.json",
            "tasks": "tau2-bench data/tau2/domains/airline/tasks.json",
            "ref": "v1.0.1",
            "dbSha256": db_digest,
            "dbBytes": db_bytes,
            "tasksSha256": tasks_digest,
            "tasksBytes": tasks_bytes,
            "reservations": len(database_payload.get("reservations") or {}),
            "tasksCount": len(tasks),
        },
        "note": (
            "The state the airline domain holds before an episode starts, projected to the 50 graded tasks: each "
            "task's user, that user's own reservations (which is what makes a token discriminating), and the "
            "evaluator's own state-changing calls with the record and itinerary they name. Written by "
            "scripts/build_airline_records.py from the sha256 recorded above; `cities` is the code-to-city map a "
            "request needs because the database stores `JFK` where the user says New York."
        ),
        "cities": projected["cities"],
        "tasks": projected["tasks"],
    }
    pathlib.Path(arguments.out).write_text(json.dumps(document, indent=1, sort_keys=False) + "\n")
    writes = sum(len(task["writes"]) for task in document["tasks"])
    records = sum(len(task["records"]) for task in document["tasks"])
    print(f"{len(document['tasks'])} task(s), {writes} write(s), {records} record(s) -> {arguments.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
