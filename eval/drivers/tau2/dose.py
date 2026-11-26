#!/usr/bin/env python3
"""R218e — the dose, joined to the task and the attempt it was served in.

The agent records one dict an episode: how many turns the episode took, how many times the block was rendered,
how many characters it carried, how many of those reached the prompt, and how many renders changed it. That
recording is the dose. What it does not carry is the **identity** of the episode, and the reason is a property of
the harness rather than a choice: τ² constructs an agent per simulation and never tells it which task or attempt it
is in (R136). The runner holds both sides, so the join lives here — beside the runner, in its own module, because a
join is a thing whose failure mode is silent.

The agent records the episode's **opening text**; the runner resolves text to task with `boundary_task_ids`, the
same reader R136 built for the census. This module therefore receives tasks, not texts: a second text matcher
beside the first is a second answer to "which task is this", and the two would agree until the day one of them
learned about whitespace.

## How the attempt is established, and why not by turn count

The obvious key for the attempt is the turn count: the record says how many model calls the episode made, and the
document says how many assistant messages it holds. It was rejected on a measurement, for free, before any
dispatch: on R219b's `board.json` the phase counted **1,171** agent calls and the transcript holds **1,274**
assistant messages — a gap of 103 over 114 episodes, so the two are not the same quantity, and a join on them
would be off by one episode somewhere in the middle of the grid while looking correct everywhere else.

`--rounds` gives an exact key instead. A round is one `run_tasks` call with `trials=1`, so **inside a round every
task appears exactly once**, and the round *is* the attempt index: `merge_rounds` writes it as the document's
`trial`. Records are appended in boundary order and a round completes before the next one starts, so the runner's
snapshot of the recording's length after each round **partitions** it into rounds. That partition is the join:
round `i`'s slice of records is matched to round `i`'s simulations by task, one each.

Refused rather than guessed at — **only** the runner's own bookkeeping, never an episode:

  * the recording and the task list are different lengths;
  * the per-round snapshots do not match the rounds, go backwards, or stop short of the recording.

Attributed rather than refused — and this is the repair of the first dispatch, which lost a ¥8.7 grid to a refusal
about facts the harness produces by design:

| state | how often, R218e's first dispatch | what it means | what the join does |
|---|---|---|---|
| a task opens **two** records in one round | 8 of 228 | τ² retried the simulation | takes the **last** record, which is the attempt the document scores, and counts a `retry` |
| a boundary text resolves to **no** task | 11 of 236 | the retry's opening message differed from the one that was scored | keeps the record in the raw dump, counts it `unresolved` |
| a task has **no** record in a round | 3 of 228 | its episode never called the model | drops the episode, counts it `missing` |

The first version refused all three, so the join returned nothing, the sidecar was never written, and the only trace of
236 records was three aggregates in the census — a refusal that costs the money it was protecting. A join may refuse to
*attribute*; it may not refuse to *record* (AUDIT 34.266).

Reported rather than refused: `--trials k` with one round runs the k attempts **concurrently**, so the order inside a
task is completion order and the trial index is not recoverable. Rows are still written, with `trial: None` and
`identity: "unordered"`, because the counts remain exact even where the pairing does not — a reader can use the counts
and must refuse the pairs.

## Usage

  python3 eval/drivers/tau2/dose.py --self-test
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

#: The fields a row carries into the sidecar. `chars` is the material served, `written` the material carried, and
#: `turns` the confound the reading has to hold. The opening text is kept out on purpose: it is the join key, it is
#: a whole user message, and a sidecar that repeated 114 of them would be a second copy of the document.
FIELDS = ("task", "trial", "retries", "turns", "renders", "chars", "written", "changes", "stable")


def _field(entry, name: str, default=None):
    """One field of a simulation, from a pydantic model or from a dict.

    The runner reads `results.simulations` before the document is written and `merge_rounds` reads it back as a
    dict, so both shapes reach this module on the same run.
    """
    value = getattr(entry, name, None)
    if value is None and isinstance(entry, dict):
        value = entry.get(name)
    return default if value is None else value


def rows(records, tasks, marks, rounds) -> dict:
    """The recording, cut into rounds and joined to the episodes each round ran.

    `records` is the agent's dose list, `tasks` the task each boundary opened for (same length, same order, resolved
    by the runner from the boundary text), `marks` the recording's length after each round, and `rounds` the
    simulations each round produced. Returns the rows, the totals a reader checks the recording against the phase's
    own counters with, the counts that say what could not be attributed, and a `refused` sentence when the runner's
    own bookkeeping does not add up.

    Three states are **attributed rather than refused**, because all three are things the harness does: a retry that
    opens a second record for one task in one round (the last record is the attempt the document scores), a boundary
    text that resolves to no task (the retry's opening message differed), and a task whose episode never called the
    model. The first dispatch refused all three and wrote nothing, which is how a complete recording became three
    aggregates (AUDIT 34.266).
    """
    if len(records) != len(tasks):
        return _refused(f"lengths-differ:{len(records)}/{len(tasks)}")
    if len(marks) != len(rounds):
        return _refused(f"marks-differ:{len(marks)}/{len(rounds)}")
    # Checked before the final-mark rule, because a snapshot that went *backwards* is a different defect from one
    # that stopped short, and the sentence a reader gets should name the one that happened.
    if any(later < earlier for earlier, later in zip([0] + list(marks), marks)):
        return _refused("marks-not-increasing")
    if not marks or marks[-1] != len(records):
        # The last snapshot is taken after the last round, so a recording that grew afterwards belongs to no round.
        return _refused(f"recording-grew-after-the-last-round:{marks[-1] if marks else 0}/{len(records)}")

    built: list = []
    counts = {"records": len(records), "joined": 0, "missing": 0, "retried": 0, "unresolved": 0, "unordered": 0}
    lower = 0
    for index, upper in enumerate(marks):
        slice_records = records[lower:upper]
        slice_tasks = tasks[lower:upper]
        lower = upper
        simulations = rounds[index] or []
        by_task: "dict[str, list]" = {}
        for offset, task in enumerate(slice_tasks):
            if isinstance(task, str) and task != "":
                by_task.setdefault(task, []).append(offset)
            else:
                counts["unresolved"] += 1
        ordered = [str(_field(simulation, "task_id", "") or "") for simulation in simulations]
        wanted: "dict[str, int]" = {}
        for task in ordered:
            if task == "":
                counts["missing"] += 1
                continue
            wanted[task] = wanted.get(task, 0) + 1
        # Attempts that ran together inside one round cannot be told apart by position, so their trial is withheld.
        unordered = any(count > 1 for count in wanted.values())
        for task, attempts in wanted.items():
            offsets = by_task.get(task) or []
            if not offsets:
                counts["missing"] += attempts
                continue
            # One episode a task: it is the one the document scores, and a retry means the **last** record describes
            # it — the earlier attempt's conversation was thrown away and so was its record's claim on the episode.
            # Several attempts a task: they ran concurrently, so the pairing is positional within the task and the
            # trial is withheld; every record is still used, in order, and a short supply falls back to the last.
            picks = [offsets[-1]] if attempts == 1 else [
                offsets[index] if index < len(offsets) else offsets[-1] for index in range(attempts)
            ]
            counts["retried"] += max(0, len(offsets) - attempts)
            for record_offset in picks:
                record = slice_records[record_offset]
                built.append(
                    {
                        "task": task,
                        "trial": None if unordered else index,
                        "retries": max(0, len(offsets) - attempts),
                        "turns": int(record.get("turns") or 0),
                        "renders": int(record.get("renders") or 0),
                        "chars": int(record.get("chars") or 0),
                        "written": int(record.get("written") or 0),
                        "changes": int(record.get("changes") or 0),
                        "stable": int(record.get("stable") or 0),
                    }
                )
        counts["joined"] = len(built)
    counts["unordered"] = sum(1 for row in built if row["trial"] is None)
    return {"rows": built, "refused": None,
            "identity": "unordered" if counts["unordered"] else "round",
            "totals": _totals(built), "counts": counts}


def _refused(reason: str) -> dict:
    return {"rows": [], "refused": reason, "identity": None, "totals": _totals([]),
            "counts": {"records": 0, "joined": 0, "missing": 0, "retried": 0, "unresolved": 0, "unordered": 0}}


def _totals(built: list) -> dict:
    """The sums a phase can be checked against, over the rows that were actually joined."""
    keys = ("turns", "renders", "chars", "written", "changes", "stable")
    return {key: sum(row[key] for row in built) for key in keys}


def write_raw(path, records, tasks) -> int:
    """Write every record exactly as the agent made it, whatever the join made of it.

    This exists because the first dispatch's join refused and wrote nothing, so a complete recording of 236 episodes
    survived only as three aggregates in a census and a ¥8.7 grid could not be read per episode at all (AUDIT 34.266).
    A join may refuse to *attribute*; it may not refuse to *record*. The raw dump keeps the opening text, which is the
    join key and therefore the only way to diagnose why a boundary resolved to no task, and a `task` column that is
    empty exactly where the resolution failed.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8") as stream:
        for index, record in enumerate(records):
            row = {
                "index": index,
                "task": tasks[index] if index < len(tasks) else None,
                "text": record.get("text") or "",
                "turns": int(record.get("turns") or 0),
                "renders": int(record.get("renders") or 0),
                "chars": int(record.get("chars") or 0),
                "written": int(record.get("written") or 0),
                "changes": int(record.get("changes") or 0),
                "stable": int(record.get("stable") or 0),
            }
            stream.write(json.dumps(row) + "\n")
    return len(records)


def write(path, built: "list[dict]") -> int:
    """Write the rows as JSONL, one an episode, and answer how many were written.

    JSONL rather than a JSON array: the sidecar is one line an episode, in the order the episodes ran, and a reader
    can stream it without holding the grid in memory. The file is written even when it holds no rows, so "the
    recording was empty" and "no sidecar was produced" stay different states.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8") as stream:
        for row in built:
            stream.write(json.dumps({key: row[key] for key in FIELDS}) + "\n")
    return len(built)


def load(path) -> "list[dict]":
    """The rows a sidecar holds, with a line that will not parse refused by its number."""
    loaded = []
    with open(path, encoding="utf-8") as stream:
        for number, line in enumerate(stream, start=1):
            text = line.strip()
            if text == "":
                continue
            try:
                entry = json.loads(text)
            except json.JSONDecodeError as error:
                raise SystemExit(f"dose-sidecar-line-{number}:{error.msg}")
            if not isinstance(entry, dict):
                raise SystemExit(f"dose-sidecar-line-{number}:not-an-object")
            loaded.append(entry)
    return loaded


def self_test() -> int:
    """The join on grids whose answer is known, including the states it must refuse."""
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def record(**over):
        base = {"turns": 4, "renders": 3, "chars": 300, "written": 120, "changes": 1, "stable": 2}
        base.update(over)
        return base

    def simulation(task, trial=0):
        return {"task_id": task, "trial": trial}

    # --- the happy path: one round, one record a task -------------------------------------------------
    reading = rows([record(), record()], ["a", "b"], [2], [[simulation("a"), simulation("b")]])
    check("two records join two episodes", len(reading["rows"]) == 2, reading)
    check("nothing is refused", reading["refused"] is None, reading["refused"])
    check("the identity is the round", reading["identity"] == "round", reading["identity"])
    check("the trial is the round index", [row["trial"] for row in reading["rows"]] == [0, 0])
    check("the totals are the rows", reading["totals"]["chars"] == 600, reading["totals"])
    check("a row carries every field", set(reading["rows"][0]) == set(FIELDS), set(reading["rows"][0]))

    # --- two rounds: the snapshot partitions the recording, and the trial is the round -----------------
    records = [record(), record(), record(chars=90), record(chars=90)]
    reading = rows(records, ["a", "b", "a", "b"], [2, 4],
                   [[simulation("a"), simulation("b")], [simulation("a", 1), simulation("b", 1)]])
    check("four records join four episodes", len(reading["rows"]) == 4, reading)
    by_key = {(row["task"], row["trial"]): row["chars"] for row in reading["rows"]}
    check("the second round's rows carry the second attempt", by_key[("a", 1)] == 90, by_key)
    check("and the first round's carry the first", by_key[("a", 0)] == 300, by_key)
    check("the totals span both rounds", reading["totals"]["chars"] == 780, reading["totals"])
    check("the join is by task, not by position",
          rows([record(chars=11), record(chars=22)], ["b", "a"], [2],
               [[simulation("a"), simulation("b")]])["rows"][0]["chars"] == 22)

    # --- the refusals, which are the runner's bookkeeping and nothing else ---------------------------------
    check("records and tasks of different lengths are refused",
          rows([record()], ["a", "b"], [1], [[simulation("a")]])["refused"].startswith("lengths-differ"))
    check("a recording that grew after the last round is refused",
          rows([record(), record()], ["a", "b"], [1], [[simulation("a")]])["refused"].startswith("recording-grew"))
    check("marks that do not match the rounds are refused",
          rows([], [], [0], [[], []])["refused"].startswith("marks-differ"))
    check("marks that are not increasing are refused",
          rows([record(), record()], ["a", "b"], [2, 1], [[simulation("a")], [simulation("b")]])
          ["refused"] == "marks-not-increasing")
    check("a refused join writes no rows", rows([], [], [0], [[], []])["rows"] == [])
    check("a refused join counts nothing", rows([], [], [0], [[], []])["totals"]["chars"] == 0)
    check("a refused join has no identity", rows([], [], [0], [[], []])["identity"] is None)

    # --- the three states that are attributed rather than refused, and the first dispatch is why ----------
    # 114 tasks, two rounds, 236 records: every task opened one record a round, eight episodes opened a second one
    # because τ² retried them, and eleven boundary texts resolved to no task. The first version of this join refused
    # all three and the ¥8.7 grid it was reading produced no sidecar at all (AUDIT 34.266). The fixture reproduces
    # that shape at a readable scale: two tasks, two rounds, one retry, one unresolved text, one episode missing.
    retry_records = [record(chars=500), record(chars=50), record(), record(chars=999),
                     record(chars=70), record(chars=80)]
    retry_tasks = ["a", "a", "b", None, "a", "b"]
    retry = rows(retry_records, retry_tasks, [4, 6],
                 [[simulation("a"), simulation("b")], [simulation("a", 1), simulation("b", 1)]])
    check("a retry is attributed to the attempt the document scores", retry["refused"] is None, retry["refused"])
    check("and the last record is the one used", retry["rows"][0]["chars"] == 50, retry["rows"][0])
    check("the retry is counted", retry["counts"]["retried"] == 1, retry["counts"])
    check("an unresolved boundary text is counted, not refused", retry["counts"]["unresolved"] == 1,
          retry["counts"])
    check("and it costs its own episode only", retry["counts"]["joined"] == 4, retry["counts"])
    check("the second round still joins both tasks", [row["trial"] for row in retry["rows"]] == [0, 0, 1, 1],
          [row["trial"] for row in retry["rows"]])
    check("the unresolved record is not attributed to anybody", 999 not in [row["chars"] for row in retry["rows"]],
          [row["chars"] for row in retry["rows"]])
    short = rows([record()], ["a"], [1], [[simulation("a"), simulation("b")]])
    check("an episode with no record is counted missing", short["counts"]["missing"] == 1, short["counts"])
    check("and the rest still joins", len(short["rows"]) == 1, short)
    notask = rows([record()], ["a"], [1], [[{"task_id": ""}]])
    check("a simulation with no task is counted missing", notask["counts"]["missing"] == 1, notask["counts"])
    check("an unresolved boundary alone is not a refusal", notask["refused"] is None)

    # --- the state that is reported rather than refused -------------------------------------------------
    concurrent = rows([record(), record(renders=9)], ["a", "a"], [2], [[simulation("a"), simulation("a")]])
    check("attempts that ran together join by count", len(concurrent["rows"]) == 2, concurrent)
    check("each takes its own record", [row["renders"] for row in concurrent["rows"]] == [3, 9], concurrent["rows"])
    check("but their trial is withheld", all(row["trial"] is None for row in concurrent["rows"]), concurrent)
    check("and the identity says why", concurrent["identity"] == "unordered", concurrent["identity"])
    three = rows([record(), record()], ["a", "a"], [2],
                 [[simulation("a"), simulation("a", 1), simulation("a", 2)]])
    check("a third attempt with two records falls back to the last", three["rows"][-1]["renders"] == 3, three["rows"])
    check("and the shortfall is not silent", three["counts"]["retried"] == 0 and len(three["rows"]) == 3,
          three["counts"])

    # --- the file ---------------------------------------------------------------------------------------
    import tempfile

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        path = root / "arm.dose.jsonl"
        check("one row is written", write(path, [{"task": "a", "trial": 0, "retries": 0, "turns": 1, "renders": 1,
                                                  "chars": 10, "written": 10, "changes": 1, "stable": 0,
                                                  "text": "dropped"}]) == 1)
        loaded = load(path)
        check("and read back without the join key", loaded == [{"task": "a", "trial": 0, "retries": 0, "turns": 1,
                                                               "renders": 1, "chars": 10, "written": 10, "changes": 1,
                                                               "stable": 0}], loaded)
        write(path, [])
        check("an empty recording writes an empty file", load(path) == [] and path.stat().st_size == 0)
        # The raw dump: every record, whatever the join decided, with the join key kept because it is the only thing
        # that can explain a resolution failure after the fact.
        raw_path = root / "arm.dose.raw.jsonl"
        check("every record is dumped", write_raw(raw_path, [record(text="a"), record(text="b")], ["a", None]) == 2)
        raw = [json.loads(line) for line in raw_path.read_text(encoding="utf-8").splitlines()]
        check("the dump keeps the join key", raw[0]["text"] == "a")
        check("and the task where the resolution worked", raw[0]["task"] == "a")
        check("and nothing where it did not", raw[1]["task"] is None)
        check("the index is positional", [row["index"] for row in raw] == [0, 1])
        check("a dump of no records is empty", write_raw(raw_path, [], []) == 0 and raw_path.stat().st_size == 0)
        check("a dump shorter than the task list does not invent one",
              write_raw(raw_path, [record(text="a")], []) == 1 and
              json.loads(raw_path.read_text(encoding="utf-8").splitlines()[0])["task"] is None)
        path.write_text('{"task": "a"}\n\n{"task": "b"}\n', encoding="utf-8")
        check("blank lines are skipped", len(load(path)) == 2)
        path.write_text("{oops\n", encoding="utf-8")
        refused = None
        try:
            load(path)
        except SystemExit as error:
            refused = str(error)
        check("a line that will not parse is refused by its number",
              (refused or "").startswith("dose-sidecar-line-1"), refused)
        path.write_text("[1, 2]\n", encoding="utf-8")
        refused = None
        try:
            load(path)
        except SystemExit as error:
            refused = str(error)
        check("a line that is not an object is refused", (refused or "").endswith("not-an-object"), refused)
        check("a sidecar in a directory that does not exist is created", write(root / "x" / "y.jsonl", []) == 0)

    # --- the suite's own failure path, diverted into the list rather than into the log ------------------
    planted_at = len(failures)
    check("a check that must fail", False, "deliberate")
    check("a check that must fail without a detail", False)
    planted = failures[planted_at:]
    del failures[planted_at:]
    cases -= 2
    check("the suite can say no", len(planted) == 2, planted)
    check("a model-shaped simulation is read", _field(type("S", (), {"task_id": "x"})(), "task_id") == "x")
    check("a missing field answers its default", _field({}, "task_id", "") == "")

    # The report's two answers and the command line's refusal, into a buffer: a branch whose failing half has never
    # run is a branch that cannot fail visibly, and this suite's whole job is to be able to say no.
    import io

    buffer = io.StringIO()
    check("the report answers one for a failure",
          _report(["planted"], 2, buffer) == 1 and "planted" in buffer.getvalue(), buffer.getvalue())
    buffer = io.StringIO()
    check("the report answers zero for none",
          _report([], 2, buffer) == 0 and "2 check(s) passed" in buffer.getvalue(), buffer.getvalue())
    refused = None
    try:
        main([])
    except SystemExit as error:
        refused = error.code
    check("the command line refuses to do nothing", refused == 2, refused)
    return _report(failures, cases)


def _report(failures: "list[str]", cases: int, stream=None) -> int:
    """Print the failures and the count, and answer with the exit code the workflow reads."""
    out = stream or sys.stderr
    if failures:
        for failure in failures:
            print(f"[dose] FAIL {failure}", file=out)
        print(f"[dose] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[dose] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    import argparse

    parser = argparse.ArgumentParser(description="the dose, joined to the task and the attempt it was served in")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    parser.error("nothing to do: pass --self-test")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
