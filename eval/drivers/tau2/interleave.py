#!/usr/bin/env python3
"""R218c — the placebo, interleaved: two arms that are the same code, task by task.

R218b's grid put `control` and `front` thirty-five minutes apart, and its `front` arm had by then already read
**86.84%**, **81.60%** and **78.07%** across three dispatches of one afternoon while `control` read 78.95% and then
84.21% — a swap of the ranking with no change of material. Every "−6.1 pp" this lane has quoted from one dispatch is
therefore a number with an unmeasured confound under it: the order the arms ran in, and the half-hour between them.

This file buys the cheapest test of that confound. Two arms, **identical code, identical material, identical seed**,
run *block by block and arm by arm* — block 0 on `control-a`, then block 0 on `control-b`, then block 1 on
`control-a` — so the only thing that differs between the two readings of a task is *when* it ran. The registered
prediction is a delta of zero. If the instrument cannot produce a zero on two arms that are the same code, then no
contrast measured on this grid is a contrast, and the repair is the grid rather than the treatment.

## Why a process per (block, arm) rather than one process for both

The obvious implementation is to alternate arms *inside* one `run_tasks` call. It is also the one implementation that
cannot answer the question: two arms in one process share the provider client, the interpreter's clock and — the
detail that matters — the `litellm` callback that counts this lane's tokens, so their bills and their latencies are
the same object's. The preregistration names this as its own refutation case: *a delta of exactly zero on every task
would say the two arms shared a process*. So each invocation is a `run_split.py` child process, and the interleave is
over **time** rather than over memory.

That choice costs thirty process starts — the τ² import is about twelve seconds — and buys three things a shared
process cannot: a bill per arm that is a real sum of per-invocation bills, a wall clock per part that measures the
gap the confound rides on, and a round that can be resumed after a transient failure without re-buying the parts it
already has.

## What the reading is, and what it refuses

`verdict()` applies the four endpoints the preregistration names, in an order that decides what the sentence says
when two of them fail at once:

  `UNPAIRED`          the arms do not cover the same tasks, so there is no pairing and no reading
  `SHARED_PROCESS`    the arms disagree on **no** task — suspicious rather than reassuring (the prereg's third case)
  `GRID_ORDERED`      |delta| above the bar: the *order* the arms ran in is inside the measurement
  `ORDER_ASYMMETRIC`  moved and broke differ by more than two tasks: the second arm inherited something
  `BILL_DRIFT`        the two arms' bills per episode differ by more than 10%: they did not run under one provider
  `PLACEBO_HELD`      every endpoint held, which is what makes the grid's other contrasts readable

One endpoint needs no branch of its own, and the arithmetic is the reason: with `moved` and `broke` within two tasks
of each other the exact McNemar p is at least 0.5 (the tightest such split, 2 against 0, is p = 0.5), so the
registered `p > 0.05` bar is **implied** by the symmetry bar. It is still reported, because a reader quoting the
p-value should be able to see the number the symmetry bar stands in for.

## Usage

  python3 eval/drivers/tau2/interleave.py --plan --tasks 0,1,2,3,4,5 --chunk 3
  python3 eval/drivers/tau2/interleave.py --run --tasks "$LIST" --chunk 8 --dir eval/results/working-memory \\
      --seed 400 --require-off-peak
  python3 eval/drivers/tau2/interleave.py --read --dir eval/results/working-memory
  python3 eval/drivers/tau2/interleave.py --self-test

`--read` spends nothing and is idempotent: it re-merges the parts already on disk and re-derives the verdict, which
is what makes an interrupted grid readable rather than lost. Both modes print the manifest path, and `--json` prints
the reading alone so a workflow step can assert on it.
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# The driver's own directory, put on `sys.path` the way every suite in this tree does it: `python3 <file>` inserts
# the *script's* directory on 3.11 and only on 3.11, and a bare-name import that works here and not in the workflow
# is the drift `check-python-floor.py` was written after (AUDIT 34.251).
HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[1] / "tools"
for entry in (str(HERE), str(TOOLS)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from notes import merge_documents  # noqa: E402  — no third-party import of its own, so this stays importable
from note_pilot import fits_window  # noqa: E402  — the window guard, read from the rate card and not restated
# The paired reader is `eval/tools/goal_board.py`'s, not a second copy of it: `compare_of` is the function eleven
# rounds of readings were taken with, its `k` rule and its McNemar are the ones the reports quote, and a second
# implementation here would be the copy that disagrees with the document the number was published in.
from goal_board import compare_of  # noqa: E402

#: The two arms, in the order they are run inside a block. The order is fixed rather than randomised because the
#: question is whether a *fixed* order leaves a trace; a randomised order would average the trace into the noise the
#: round is trying to measure.
ARMS = ("control-a", "control-b")

#: Tasks per invocation. Registered at eight: small enough that the gap between the two readings of a task is a
#: couple of minutes rather than R218b's thirty-five, large enough that thirty process starts do not dominate the
#: run's wall clock. The gap each block actually achieved is measured and reported, because a block size that buys a
#: gap nobody looked at is the confound again with a smaller constant.
DEFAULT_CHUNK = 8

#: The endpoints, exactly as `prereg/R218c-interleave.md` registers them.
DELTA_BAR_PP = 5.0
SYMMETRY_TASKS = 2
BILL_BAR = 0.10

#: What a task costs at the off-peak rate, in seconds, taken from the workflow's own estimate and not re-derived:
#: a second copy of this number is a second number. The overhead is per invocation (interpreter start plus the τ²
#: import) and is charged once per part, which is the cost this design pays for not sharing a process.
SECONDS_PER_EPISODE = 26
OVERHEAD_MINUTES = 1

#: USD→CNY at the rate the reports quote. Stated once here so a total in the manifest and a total in the report
#: cannot be converted at two different rates.
CNY_PER_USD = 7.2

RATE_CARD = HERE.parents[1] / "manifests" / "model-rates.json"


def _now() -> datetime:
    """The clock, in a function, so the self-test can pass a fixed one where a caller means "now"."""
    return datetime.now(timezone.utc)


def blocks(ids: "list[str]", size: int) -> "list[list[str]]":
    """The population in scheduled blocks, in the order it was given.

    Three refusals, each a state that would otherwise produce a run about nothing: a size below one schedules
    nothing, an empty list is a grid over no tasks, and a blank id is a task the runner would silently drop
    (`run_split.py` filters empty entries out of its `--tasks`), so the arm would come back one task short of the
    plan and the merge would report `UNPAIRED` — after the money was spent. Cheaper to refuse here.
    """
    if size < 1:
        raise SystemExit(f"tau2-interleave-chunk:{size}")
    if not ids:
        raise SystemExit("tau2-interleave-no-tasks")
    for entry in ids:
        if not str(entry).strip():
            raise SystemExit("tau2-interleave-blank-task")
    ordered = [str(entry).strip() for entry in ids]
    seen = set()
    for entry in ordered:
        if entry in seen:
            raise SystemExit(f"tau2-interleave-duplicate-task:{entry}")
        seen.add(entry)
    return [ordered[index : index + size] for index in range(0, len(ordered), size)]


def plan(ids: "list[str]", size: int, arms: "tuple[str, ...]" = ARMS) -> "list[dict]":
    """The invocation order: every arm of block *i* before any arm of block *i+1*.

    This is the whole round. R218b's grid ran one arm to completion and then the other, so each task's two readings
    were separated by the length of a grid; here they are separated by a block, and the manifest records the gap that
    was actually achieved so the claim can be checked rather than assumed.
    """
    if len(set(arms)) != len(arms):
        raise SystemExit("tau2-interleave-duplicate-arm")
    ordered = []
    for index, block in enumerate(blocks(ids, size)):
        for arm in arms:
            ordered.append(
                {
                    "block": index,
                    "arm": arm,
                    "tasks": list(block),
                    "part": f"{arm}.part{index:02d}",
                }
            )
    return ordered


def part_path(root, part: dict) -> Path:
    """Where one invocation writes. Under `parts/`, because the round's merged documents live in `root` and every
    workflow step in this lane globs `root/*.json` — a part beside a merged arm would be counted twice in a bill."""
    return Path(root) / "parts" / f"{part['part']}.json"


def argv_for(
    part: dict,
    *,
    python: str,
    runner: Path,
    domain: str,
    seed: int,
    trials: int,
    max_steps: int,
    root,
    off_peak: bool,
) -> "list[str]":
    """One invocation's command line, as a list rather than a shell string.

    A list, because the population is a comma-joined argument of a hundred and fourteen ids and a shell would need
    quoting rules this file would have to get right; and because the self-test drives this function's output through
    `subprocess` with a fake runner, so the argv is a contract that can be exercised without a provider.
    """
    argv = [
        python,
        str(runner),
        "--phase",
        "eval",
        "--agent",
        "microglia_agent",
        "--domain",
        domain,
        "--tasks",
        ",".join(part["tasks"]),
        "--trials",
        str(trials),
        "--max-steps",
        str(max_steps),
        "--seed",
        str(seed),
        "--out",
        str(part_path(root, part)),
    ]
    if off_peak:
        # Forwarded rather than checked once: a part is one process and one bill, and a process that opens inside a
        # peak band pays double for its own episodes. The round-level guard below is what keeps the run from
        # *reaching* a band; this is what keeps a late part from paying for one it reached anyway.
        argv.append("--require-off-peak")
    return argv


def estimate_minutes(
    tasks: int, arms: int = 2, trials: int = 1, concurrency: int = 3, chunk: int = DEFAULT_CHUNK
) -> int:
    """What the whole interleave should take, for the window guard.

    Per invocation rather than per episode, because the overhead of this design is exactly the thing a per-episode
    estimate would miss: thirty τ² imports at twelve seconds is six minutes that no episode count contains.
    Conservative on purpose — a guard that under-estimates is a run that starts inside an off-peak window and ends
    in a peak band, where the same tokens cost twice as much.
    """
    per_block = max(1, min(tasks, chunk))
    parts = max(1, (tasks + chunk - 1) // chunk) * arms
    minutes = per_block * trials * SECONDS_PER_EPISODE / max(1, concurrency) / 60
    return int(parts * (minutes + OVERHEAD_MINUTES)) + 1


def bill_per_episode(document: dict) -> "float | None":
    """The arm's bill per episode, from τ²'s own per-simulation costs.

    Read from `agent_cost + user_cost` rather than from this driver's token counter, because the counter is per
    process and this round has thirty processes: a sum over simulations is the one figure that survives the split.
    `None` rather than zero on an empty document, which is the absence-as-zero defect this lane has paid for twice.
    """
    simulations = document.get("simulations") if isinstance(document, dict) else None
    if not isinstance(simulations, list) or not simulations:
        return None
    total = 0.0
    for entry in simulations:
        if not isinstance(entry, dict):
            continue
        for field in ("agent_cost", "user_cost"):
            value = entry.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                total += float(value)
    return total / len(simulations)


def _sum_usage(documents: "list[dict]") -> dict:
    """The parts' token counters, summed, with the ratios recomputed rather than added.

    `merge_documents` keeps the first part's `usage` block, which is right for a round where the parts are trials of
    one grid and wrong here: a reader who quoted `control-a.json`'s cost would get one thirtieth of the arm. The
    counters that are counts are summed; the ones that are ratios are divided from the sums, because a mean of means
    over parts of unequal size is a different number from the mean.
    """
    totals = {
        "parts": len(documents),
        "measuredParts": 0,
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cached_tokens": 0,
        "uncached_tokens": 0,
        "usd": 0.0,
        "bands": [],
    }
    for document in documents:
        usage = document.get("usage") if isinstance(document, dict) else None
        if not isinstance(usage, dict):
            continue
        totals["measuredParts"] += 1
        for field in ("calls", "prompt_tokens", "completion_tokens", "cached_tokens", "uncached_tokens"):
            value = usage.get(field)
            if isinstance(value, int) and not isinstance(value, bool):
                totals[field] += value
        cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
        usd = cost.get("usd")
        if isinstance(usd, (int, float)) and not isinstance(usd, bool):
            totals["usd"] += float(usd)
        if isinstance(cost.get("band"), str):
            totals["bands"].append(cost["band"])
    prompt = totals["prompt_tokens"]
    totals["usd"] = round(totals["usd"], 4)
    totals["cny"] = round(totals["usd"] * CNY_PER_USD, 2)
    totals["cache_hit_rate"] = round(totals["cached_tokens"] / prompt, 4) if prompt else None
    # A page of numbers that mixes two bands is a page that cannot be re-priced: the peak rate is exactly twice the
    # off-peak one, so a total summed across a boundary is not a total any single band explains.
    totals["mixedBands"] = len(set(totals["bands"])) > 1
    return totals


def gaps(entries: "list[dict]", arms: "tuple[str, ...]" = ARMS) -> dict:
    """How far apart the two readings of a block actually ran, in seconds.

    This is the number the round exists to shrink, so it is measured rather than claimed. A part whose timestamps are
    missing (an interrupted run) contributes no gap rather than a zero: a zero would read as "the two arms ran
    simultaneously", which is the `SHARED_PROCESS` state the verdict refuses.
    """
    by_block: "dict[int, dict]" = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        block = entry.get("block")
        arm = entry.get("arm")
        if not isinstance(block, int) or arm not in arms:
            continue
        by_block.setdefault(block, {})[arm] = entry
    measured = []
    for block in sorted(by_block):
        seat = by_block[block]
        try:
            first = datetime.fromisoformat(seat[arms[0]]["endedAt"])
            second = datetime.fromisoformat(seat[arms[1]]["startedAt"])
        except (KeyError, TypeError, ValueError):
            continue
        measured.append(round((second - first).total_seconds(), 1))
    if not measured:
        return {"blocks": 0, "median": None, "max": None, "perBlock": []}
    return {
        "blocks": len(measured),
        "median": statistics.median(measured),
        "max": max(measured),
        "perBlock": measured,
    }


def verdict(
    reading: dict,
    left_bill: "float | None",
    right_bill: "float | None",
    gap: dict,
    *,
    delta_bar: float = DELTA_BAR_PP,
    symmetry: int = SYMMETRY_TASKS,
    bill_bar: float = BILL_BAR,
) -> dict:
    """The four registered endpoints, in the order that decides what the sentence says when two fail at once.

    The order is the round's argument, not a convenience: an unpaired grid has no reading at all; a grid whose arms
    never disagree is an instrument that measured an import; a delta above the bar is the confound the round was
    built to find; an asymmetry is that confound with a direction; and a bill gap says the two arms did not run in
    one world even if their rates agree. Each state is reachable, and the self-test reaches every one of them.
    """
    total = int(reading.get("tasks") or 0)
    moved = int(reading.get("moved") or 0)
    broke = int(reading.get("broke") or 0)
    delta = reading.get("delta")
    delta_pp = round(100 * float(delta), 2) if isinstance(delta, (int, float)) else None
    ratio = None
    if left_bill and right_bill:
        ratio = round(right_bill / left_bill, 4)
    block = {
        "tasks": total,
        "moved": moved,
        "broke": broke,
        "held": int(reading.get("both") or 0),
        "neither": int(reading.get("neither") or 0),
        "unpaired": int(reading.get("unpaired") or 0),
        "deltaPp": delta_pp,
        "p": reading.get("p"),
        "leftRate": reading.get("controlRate"),
        "rightRate": reading.get("boardRate"),
        "billPerEpisode": [left_bill, right_bill],
        "billRatio": ratio,
        "gapSeconds": gap,
        "bars": {"deltaPp": delta_bar, "symmetry": symmetry, "bill": bill_bar},
    }
    if total == 0 or block["unpaired"] > 0:
        state = "UNPAIRED"
    elif moved + broke == 0:
        state = "SHARED_PROCESS"
    elif delta_pp is not None and abs(delta_pp) > delta_bar:
        state = "GRID_ORDERED"
    elif abs(moved - broke) > symmetry:
        state = "ORDER_ASYMMETRIC"
    elif ratio is not None and abs(ratio - 1.0) > bill_bar:
        state = "BILL_DRIFT"
    else:
        state = "PLACEBO_HELD"
    block["state"] = state
    return block


def render_verdict(block: dict) -> str:
    """One sentence a reader can quote, and the state that decides whether they should."""
    left, right = ARMS
    gap = block["gapSeconds"]
    where = (
        f", the two readings of a task {gap['median']}s apart (median over {gap['blocks']} block(s), worst "
        f"{gap['max']}s)" if gap.get("median") is not None else ", with no measured gap"
    )
    body = (
        f"{block['leftRate']:.1%} against {block['rightRate']:.1%} on {block['tasks']} task(s), delta "
        f"{block['deltaPp']:+.2f} pp, moved {block['moved']}, broke {block['broke']}, held {block['held']}, "
        f"neither {block['neither']}, McNemar p = {block['p']}{where}"
    ) if block["tasks"] else f"no shared task over {block['tasks']} task(s)"
    return {
        "UNPAIRED": f"UNPAIRED: {body} — the arms do not cover the same tasks, so nothing is paired",
        "SHARED_PROCESS": (
            f"SHARED_PROCESS: {body} — the arms disagree on no task at all, which is the suspicious case rather "
            "than the reassuring one: two processes on one grid disagree somewhere"
        ),
        "GRID_ORDERED": (
            f"GRID_ORDERED: {body} — the two arms are the same code and they differ by more than the bar, so the "
            "order they ran in is inside every contrast this grid has measured"
        ),
        "ORDER_ASYMMETRIC": (
            f"ORDER_ASYMMETRIC: {body} — one arm moved more tasks than the other by more than two, so the second "
            "reading inherited something the first one left behind"
        ),
        "BILL_DRIFT": (
            f"BILL_DRIFT: {body}, bill per episode {block['billLeft']:.5f} against {block['billRight']:.5f} — the "
            "two halves ran under different provider conditions"
        ),
        "PLACEBO_HELD": (
            f"PLACEBO_HELD: {body} — two arms of the same code are indistinguishable, so a contrast measured "
            "inside one dispatch of this grid is a contrast about the material"
        ),
    }[block["state"]]


def _stamp(block: dict) -> dict:
    """The verdict with the two bills named, so `render_verdict` can print them without a second lookup."""
    bills = block.get("billPerEpisode") or [None, None]
    block = dict(block)
    block["billLeft"] = bills[0] or 0.0
    block["billRight"] = bills[1] or 0.0
    return block


def _read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as stream:
        document = json.load(stream)
    if not isinstance(document, dict):
        raise SystemExit(f"tau2-interleave-bad-document:{path}")
    return document


def merge_arm(arm: str, entries: "list[dict]", root) -> dict:
    """One arm's parts into one document, with the counters summed and the per-invocation census pointed at.

    `merge_documents` is `notes.py`'s own and refuses what a reader downstream would read as a grid: a task listed
    twice, a `(task, trial)` pair from two documents. Reusing it rather than writing a second merge is the point —
    the round already has one merge with two refusals and a suite, and a second copy is the copy that drifts.
    """
    paths = [part_path(root, entry) for entry in entries]
    documents = [_read_json(path) for path in paths]
    merged = merge_documents(documents)
    merged["arm"] = arm
    merged["usage"] = _sum_usage(documents)
    # `diagnostics` is a per-invocation census — means over that invocation's calls, and a `cache` block whose
    # first-call ratio belongs to one process. Summing it would invent a number no process measured, and keeping the
    # first part's would report one thirtieth of the run as the run. Naming the parts is the honest option.
    merged["diagnostics"] = {
        "parts": len(paths),
        "perPart": [path.name for path in paths],
        "why": "a per-invocation census: the parts are the measurement, and the totals are under `usage`",
    }
    return merged


def read_round(root, manifest: dict, arms: "tuple[str, ...]" = ARMS) -> dict:
    """Merge the parts on disk, write the arms' documents, and derive the round's verdict.

    Free and idempotent: it reads files and writes files. That is what makes an interrupted grid readable — R218b
    lost its reading twice at the transport, and a round whose numbers can only be recovered by paying again is a
    round that gets paid for twice.
    """
    from goal_board import compare_of  # lazy: the comparison lives in `eval/tools`, one directory up

    entries = manifest.get("parts") or []
    written = {}
    for arm in arms:
        mine = [entry for entry in entries if entry.get("arm") == arm]
        if not mine:
            raise SystemExit(f"tau2-interleave-arm-has-no-parts:{arm}")
        for entry in mine:
            # A scheduled part with no document is a grid with a hole in it. Refused by name rather than merged
            # short, because a grid of 106 tasks that reads like a grid of 114 is the failure mode every reader
            # downstream is built to trust (`unpaired == 0` says the two arms agree, not that the plan was met).
            if not part_path(root, entry).exists():
                raise SystemExit(f"tau2-interleave-missing-part:{entry['part']}")
        document = merge_arm(arm, mine, root)
        out = Path(root) / f"{arm}.json"
        with open(out, "w", encoding="utf-8") as stream:
            json.dump(document, stream, indent=1)
            stream.write("\n")
        written[arm] = document
    reading = compare_of(written[arms[0]], written[arms[1]], 1, (arms[0], arms[1]))
    block = verdict(
        reading,
        bill_per_episode(written[arms[0]]),
        bill_per_episode(written[arms[1]]),
        gaps(entries, arms),
    )
    block["documents"] = {arm: str(Path(root) / f"{arm}.json") for arm in arms}
    block["episodes"] = {
        arm: len(written[arm].get("simulations") or []) for arm in arms
    }
    block["usd"] = {arm: written[arm]["usage"]["usd"] for arm in arms}
    manifest["reading"] = block
    manifest["readAt"] = _now().isoformat()
    return block


def _write_manifest(root, manifest: dict) -> Path:
    path = Path(root) / "parts" / "manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=1)
        stream.write("\n")
    return path


def run_phase(
    manifest: dict,
    root,
    *,
    python: str,
    runner: Path,
    domain: str,
    seed: int,
    trials: int,
    max_steps: int,
    off_peak: bool,
    resume: bool,
    log=None,
) -> dict:
    """Run every scheduled invocation, in order, recording what each one cost and when it ran.

    Resumption is per part and never per task: an invocation writes its document at the end, so a file that parses
    with simulations in it is an invocation that completed, and re-running it would buy the same episodes twice. The
    check is `resume` plus a task-set match, because a part left by another round is a part whose grid was a
    different one — the failure mode `notes.py` and `run_split.py` both refuse in their own places.
    """
    for entry in manifest["parts"]:
        target = part_path(root, entry)
        if resume and target.exists():
            try:
                document = _read_json(target)
            except (SystemExit, json.JSONDecodeError):
                document = {}
            present = {str((task or {}).get("id")) for task in (document.get("tasks") or []) if isinstance(task, dict)}
            if present == set(entry["tasks"]) and document.get("simulations"):
                entry["skipped"] = True
                continue
            # A file that does not match this block is removed rather than left: `run_split.py` deletes an existing
            # `--out` itself before it starts, so keeping it here would only make the next read ambiguous.
            target.unlink(missing_ok=True)
        argv = argv_for(
            entry,
            python=python,
            runner=runner,
            domain=domain,
            seed=seed,
            trials=trials,
            max_steps=max_steps,
            root=root,
            off_peak=off_peak,
        )
        log_path = target.with_suffix(".log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry["startedAt"] = _now().isoformat()
        started = time.monotonic()
        with open(log_path, "w", encoding="utf-8") as stream:
            stream.write(" ".join(argv) + "\n")
            stream.flush()
            done = subprocess.run(argv, stdout=stream, stderr=subprocess.STDOUT, check=False)
        entry["endedAt"] = _now().isoformat()
        entry["seconds"] = round(time.monotonic() - started, 1)
        entry["returncode"] = done.returncode
        entry["log"] = log_path.name
        if log:
            log(f"[interleave] block {entry['block']} {entry['arm']}: exit {done.returncode} in "
                f"{entry['seconds']}s")
        if done.returncode != 0:
            # The manifest is on disk before this raises, so the parts already bought stay readable: an operator
            # resumes rather than re-runs, and the bill is not paid twice for a transient failure.
            raise SystemExit(f"tau2-interleave-part-failed:{entry['part']}:{done.returncode}")
    return manifest


def self_test() -> int:
    """Every refusal, every verdict state, and one end-to-end round against a fake runner.

    The end-to-end case is the one that matters: it writes a *real* `results.json` through a *real* subprocess and
    merges it with the same code the dispatch uses. A self-test that called the functions in order would prove the
    functions run; this one proves the round runs, and it spends nothing because the child is eleven lines of
    `json.dump`.
    """
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            # `str(detail)` rather than `detail`: half of these checks quote a dict or a tuple, and a failure that
            # raised while reporting itself is the one failure a suite cannot describe.
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def refuses(name, code, function):
        nonlocal cases
        cases += 1
        try:
            function()
        except SystemExit as error:
            if str(error) != code:
                failures.append(f"{name}: refused with {str(error)!r} rather than {code!r}")
        else:
            failures.append(f"{name}: accepted")

    def refuses_with(name, prefix, function):
        """The same, for a refusal whose text carries a clock: `fits_window` names the moment it refused."""
        nonlocal cases
        cases += 1
        try:
            function()
        except SystemExit as error:
            if not str(error).startswith(prefix):
                failures.append(f"{name}: refused with {str(error)!r} rather than {prefix!r}…")
        else:
            failures.append(f"{name}: accepted")

    def exits_with(directory, code: int) -> Path:
        """A runner that spends nothing and fails, for the one path that must not swallow a nonzero exit."""
        path = Path(directory) / "exits.py"
        path.write_text(f"import sys\nsys.exit({code})\n", encoding="utf-8")
        return path

    def never_peak(directory) -> str:
        """The other side of `always_peak`: a card that declares no band, so the guard lets the same run through."""
        path = Path(directory) / "never-peak.json"
        # An hour that no clock can be in: `is_peak` compares `from <= hour < to`, and -1 <= hour < -1 is never
        # true. Written as a band rather than an empty list because `is_peak` refuses a card that declares none.
        path.write_text(json.dumps({"peakWindows": [{"fromHourUtc": -1, "toHourUtc": -1}]}), encoding="utf-8")
        return str(path)

    def always_peak(directory) -> str:
        """A rate card whose peak band is the whole day, so the guard refuses whenever the suite is run.

        A fixture that depends on the hour would pass or fail according to what time it is — the defect `_cost`
        carries a `now` parameter to avoid, one file over.
        """
        path = Path(directory) / "always-peak.json"
        path.write_text(
            json.dumps({"peakWindows": [{"fromHourUtc": 0, "toHourUtc": 24}], "peakWeekdaysOnly": False}),
            encoding="utf-8",
        )
        return str(path)

    # --- the schedule ---------------------------------------------------------------------------------
    check("six tasks in blocks of three", blocks([str(index) for index in range(6)], 3) == [["0", "1", "2"], ["3", "4", "5"]])
    check("a ragged last block is kept", blocks(["a", "b", "c", "d"], 3) == [["a", "b", "c"], ["d"]])
    check("whitespace is not an id", blocks([" a ", "b"], 1) == [["a"], ["b"]])
    refuses("a chunk of zero", "tau2-interleave-chunk:0", lambda: blocks(["a"], 0))
    refuses("an empty population", "tau2-interleave-no-tasks", lambda: blocks([], 4))
    refuses("a blank task", "tau2-interleave-blank-task", lambda: blocks(["a", "  "], 2))
    refuses("a task twice", "tau2-interleave-duplicate-task:a", lambda: blocks(["a", "a"], 2))
    refuses("one arm twice", "tau2-interleave-duplicate-arm", lambda: plan(["a"], 1, ("x", "x")))

    schedule = plan(["0", "1", "2", "3"], 2)
    check("two blocks, four invocations", len(schedule) == 4)
    check(
        "block 0 runs both arms before block 1",
        [entry["part"] for entry in schedule]
        == ["control-a.part00", "control-b.part00", "control-a.part01", "control-b.part01"],
    )
    check("each invocation carries its own block's tasks", schedule[2]["tasks"] == ["2", "3"])

    # --- the argv a dispatch actually runs ------------------------------------------------------------
    argv = argv_for(
        schedule[0],
        python="/usr/bin/python3",
        runner=Path("/repo/run_split.py"),
        domain="retail",
        seed=400,
        trials=1,
        max_steps=100,
        root="/tmp/round",
        off_peak=True,
    )
    check("the runner is the one under test", argv[1] == "/repo/run_split.py")
    check("the block is the `--tasks` argument", argv[argv.index("--tasks") + 1] == "0,1")
    check("the seed is the registered one", argv[argv.index("--seed") + 1] == "400")
    check("the part is written under parts/", argv[argv.index("--out") + 1] == "/tmp/round/parts/control-a.part00.json")
    check("the window guard travels with the part", argv[-1] == "--require-off-peak")
    without = argv_for(
        schedule[0],
        python="p",
        runner=Path("r"),
        domain="retail",
        seed=1,
        trials=1,
        max_steps=1,
        root="/tmp/round",
        off_peak=False,
    )
    check("no guard when none was asked for", "--require-off-peak" not in without)

    # --- the bill ------------------------------------------------------------------------------------
    check(
        "the bill is the two costs over the episodes",
        bill_per_episode({"simulations": [{"agent_cost": 0.01, "user_cost": 0.01}, {"agent_cost": 0.02}]})
        == 0.04 / 2,
    )
    check("no episodes is no rate", bill_per_episode({"simulations": []}) is None)
    check("a document with no simulations is no rate", bill_per_episode({}) is None)
    check("a non-numeric cost is not a cost", bill_per_episode({"simulations": [{"agent_cost": "1", "user_cost": 0.5}]}) == 0.5)

    # --- the counters, summed -------------------------------------------------------------------------
    summed = _sum_usage(
        [
            {"usage": {"calls": 3, "prompt_tokens": 100, "cached_tokens": 60, "completion_tokens": 10,
                       "uncached_tokens": 40, "cost": {"usd": 0.1, "band": "off_peak"}}},
            {"usage": {"calls": 2, "prompt_tokens": 300, "cached_tokens": 240, "completion_tokens": 20,
                       "uncached_tokens": 60, "cost": {"usd": 0.2, "band": "off_peak"}}},
            {"no": "usage"},
        ]
    )
    check("the calls are summed", summed["calls"] == 5)
    check("the prompt is summed", summed["prompt_tokens"] == 400)
    check("the hit rate is divided, not averaged", summed["cache_hit_rate"] == 0.75)
    check("the bill is summed in USD and converted once", summed["usd"] == 0.3 and summed["cny"] == 2.16)
    check("one band is not mixed", summed["mixedBands"] is False)
    check("the parts that reported are counted", summed["measuredParts"] == 2 and summed["parts"] == 3)
    mixed = _sum_usage([{"usage": {"cost": {"usd": 1, "band": "peak"}}}, {"usage": {"cost": {"usd": 1, "band": "off_peak"}}}])
    check("two bands are mixed", mixed["mixedBands"] is True)
    empty = _sum_usage([{"usage": {}}])
    check("no tokens is no rate", empty["cache_hit_rate"] is None and empty["usd"] == 0.0)

    # --- the gap -------------------------------------------------------------------------------------
    import tempfile

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        entries = [
            {"block": 0, "arm": "control-a", "startedAt": "2026-11-26T04:00:00+00:00",
             "endedAt": "2026-11-26T04:02:00+00:00", "tasks": ["0"]},
            {"block": 0, "arm": "control-b", "startedAt": "2026-11-26T04:02:30+00:00",
             "endedAt": "2026-11-26T04:04:30+00:00", "tasks": ["0"]},
            {"block": 1, "arm": "control-a", "startedAt": "2026-11-26T04:05:00+00:00",
             "endedAt": "2026-11-26T04:06:00+00:00", "tasks": ["1"]},
            {"block": 1, "arm": "control-b", "startedAt": "2026-11-26T04:06:20+00:00",
             "endedAt": "2026-11-26T04:08:00+00:00", "tasks": ["1"]},
        ]
        measured = gaps(entries)
        check("both blocks are measured", measured["blocks"] == 2 and measured["perBlock"] == [30.0, 20.0])
        check("the median is the middle", measured["median"] == 25.0 and measured["max"] == 30.0)
        check("a missing timestamp is no gap, not a zero", gaps([{"block": 0, "arm": "control-a"}])["median"] is None)
        check("an unparseable timestamp is no gap", gaps(
            [{"block": 0, "arm": "control-a", "endedAt": "never", "startedAt": "never"},
             {"block": 0, "arm": "control-b", "startedAt": "2026-11-26T04:00:00+00:00"}])["median"] is None)

        # --- the verdicts, one case per state ---------------------------------------------------------
        def reading(tasks, moved, broke, both=0, neither=0, unpaired=0, delta=None):
            return {
                "tasks": tasks,
                "moved": moved,
                "broke": broke,
                "both": both,
                "neither": neither,
                "unpaired": unpaired,
                "delta": delta if delta is not None else ((moved - broke) / tasks if tasks else None),
                "p": 0.72,
                "controlRate": 0.9,
                "boardRate": 0.9,
            }

        held = verdict(reading(114, 3, 2, both=80, neither=29), 0.005, 0.0051, measured)
        check("a three-two split over a hundred and fourteen holds", held["state"] == "PLACEBO_HELD", held["state"])
        check("the bar is reported with the reading", held["bars"] == {"deltaPp": 5.0, "symmetry": 2, "bill": 0.10})
        unpaired = verdict(reading(114, 3, 2, unpaired=1), 0.005, 0.005, measured)
        check("an unpaired grid is unpaired", unpaired["state"] == "UNPAIRED")
        nothing = verdict(reading(0, 0, 0), None, None, gaps([]))
        check("an empty grid is unpaired", nothing["state"] == "UNPAIRED")
        shared = verdict(reading(114, 0, 0), 0.005, 0.005, measured)
        check("no disagreement at all is the suspicious state", shared["state"] == "SHARED_PROCESS")
        ordered = verdict(reading(114, 20, 2, both=70, neither=22), 0.005, 0.005, measured)
        check("a nineteen-point delta is grid order", ordered["state"] == "GRID_ORDERED", ordered["state"])
        asymmetric = verdict(reading(114, 7, 3, both=80, neither=24), 0.005, 0.005, measured)
        check("seven against three is an asymmetry", asymmetric["state"] == "ORDER_ASYMMETRIC", asymmetric["state"])
        drifted = verdict(reading(114, 3, 2, both=80, neither=29), 0.005, 0.0056, measured)
        check("a bill twelve percent apart is drift", drifted["state"] == "BILL_DRIFT", drifted["state"])
        unchecked = verdict(reading(114, 3, 2, both=80, neither=29), None, None, measured)
        check("no bill is no bill bar", unchecked["state"] == "PLACEBO_HELD")

        for state, block in (
            ("PLACEBO_HELD", held),
            ("UNPAIRED", unpaired),
            ("SHARED_PROCESS", shared),
            ("GRID_ORDERED", ordered),
            ("ORDER_ASYMMETRIC", asymmetric),
            ("BILL_DRIFT", drifted),
        ):
            sentence = render_verdict(_stamp(block))
            check(f"the {state} sentence names its state", sentence.startswith(state + ":"), sentence)
        check("the sentence carries the gap", "30.0s" in render_verdict(_stamp(held)))
        check(
            "a reading with no gap says so",
            "no measured gap" in render_verdict(_stamp(verdict(reading(114, 3, 2), 0.005, 0.005, gaps([])))),
        )
        check("an empty reading renders", "no shared task" in render_verdict(_stamp(nothing)))

        # --- one round, end to end, against a runner that writes a real document --------------------
        #
        # The fake runner is eleven lines and no provider. What it must reproduce is the *contract*: read `--out`
        # and `--tasks` off the argv, and write the document `run_split.py` writes. Its rewards are chosen so the
        # two arms differ by exactly two tasks in opposite directions — `moved 2, broke 2` — which is the state a
        # working placebo produces on a real grid.
        fake = root / "fake_runner.py"
        fake.write_text(
            "import json, sys\n"
            "argv = sys.argv[1:]\n"
            "out = argv[argv.index('--out') + 1]\n"
            "tasks = argv[argv.index('--tasks') + 1].split(',')\n"
            "arm = 'b' if 'control-b' in out else 'a'\n"
            "simulations = []\n"
            "for task in tasks:\n"
            "    failed = (arm == 'a' and task in ('1', '2')) or (arm == 'b' and task in ('3', '4'))\n"
            "    simulations.append({'task_id': task, 'trial': 0, 'messages': [{'role': 'user', 'content': 'x'}],\n"
            "                        'reward_info': {'reward': 0.0 if failed else 1.0},\n"
            "                        'agent_cost': 0.004, 'user_cost': 0.001})\n"
            "document = {'domain': 'retail', 'tasks': [{'id': task} for task in tasks], 'simulations': simulations,\n"
            "            'usage': {'calls': 1, 'prompt_tokens': 10, 'cached_tokens': 5, 'completion_tokens': 1,\n"
            "                      'uncached_tokens': 5, 'cost': {'usd': 0.01, 'band': 'off_peak'}}}\n"
            "json.dump(document, open(out, 'w'))\n",
            encoding="utf-8",
        )
        round_root = root / "round"
        manifest = {
            "round": "R218c",
            "parts": plan(["0", "1", "2", "3", "4", "5"], 3),
            "startedAt": _now().isoformat(),
        }
        _write_manifest(round_root, manifest)
        run_phase(
            manifest,
            round_root,
            python=sys.executable,
            runner=fake,
            domain="retail",
            seed=400,
            trials=1,
            max_steps=2,
            off_peak=False,
            resume=False,
        )
        check("every invocation ran", all(entry.get("returncode") == 0 for entry in manifest["parts"]))
        check("the manifest records a part's span", all("startedAt" in entry and "endedAt" in entry for entry in manifest["parts"]))
        block = read_round(round_root, manifest)
        check("six tasks, two blocks, one episode each", block["episodes"] == {"control-a": 6, "control-b": 6})
        check("the merged arm has every task", block["tasks"] == 6)
        check("the fake grid moves two and breaks two", (block["moved"], block["broke"]) == (2, 2), block)
        check("a two-two split holds", block["state"] == "PLACEBO_HELD", (block["state"], block["deltaPp"]))
        check("the merged bill is the parts' sum", block["usd"]["control-a"] == 0.02, block["usd"])
        check("both documents were written", all(Path(path).exists() for path in block["documents"].values()))

        # Resumption: the same call again must skip every part rather than buy them again.
        resumed = json.loads((round_root / "parts" / "manifest.json").read_text())
        for entry in resumed["parts"]:
            entry.pop("startedAt", None)
        run_phase(
            resumed,
            round_root,
            python=sys.executable,
            runner=Path("/nonexistent/runner.py"),
            domain="retail",
            seed=400,
            trials=1,
            max_steps=2,
            off_peak=False,
            resume=True,
        )
        check("resume skips what is already bought", all(entry.get("skipped") for entry in resumed["parts"]))
        # And a part whose task set is not this block's is discarded rather than counted.
        stale = json.loads((round_root / "parts" / "manifest.json").read_text())
        first = stale["parts"][0]
        part_path(round_root, first).write_text(json.dumps({"tasks": [{"id": "zzz"}], "simulations": [{}]}))
        run_phase(
            stale,
            round_root,
            python=sys.executable,
            runner=fake,
            domain="retail",
            seed=400,
            trials=1,
            max_steps=2,
            off_peak=False,
            resume=True,
        )
        check("a part from another grid is re-run", stale["parts"][0].get("skipped") is None)

        # --- the command line ------------------------------------------------------------------------
        # The command line, driven for real: `--run` launches the fake runner as a child process, `--read` re-derives
        # from what it wrote, and `--plan` writes nothing at all. No monkeypatch anywhere — a suite that replaces
        # `subprocess` proves that the code calls `subprocess`, which is not the property this round needs.
        code = main(["--run", "--tasks", "0,1,2,3", "--chunk", "2", "--dir", str(root / "cli"),
                     "--runner", str(fake), "--python", sys.executable, "--seed", "400",
                     "--max-steps", "2", "--json"])
        check("`--run` answers zero", code == 0, code)
        printed = json.loads((root / "cli" / "parts" / "manifest.json").read_text())
        check("`--run` wrote the manifest", printed["parts"][0]["tasks"] == ["0", "1"])
        check("`--run` scheduled two blocks of two, two arms", len(printed["parts"]) == 4, len(printed["parts"]))
        check("`--run` recorded every exit", [entry["returncode"] for entry in printed["parts"]] == [0] * 4)
        check("`--run` recorded the reading", printed["reading"]["tasks"] == 4, printed["reading"]["state"])
        free = main(["--read", "--dir", str(root / "cli"), "--json"])
        check("`--read` answers zero without buying anything", free == 0)

        planned = main(["--plan", "--tasks", "0,1,2", "--chunk", "2", "--json"])
        check("`--plan` answers zero", planned == 0)
        check("`--plan` writes no manifest", not (root / "planned" / "parts").exists())
        # A grid with a hole in it: one of the arm's parts removed is refused by name rather than merged short.
        holed = json.loads((root / "cli" / "parts" / "manifest.json").read_text())
        (root / "cli" / "parts" / "control-b.part01.json").unlink(missing_ok=True)
        refuses(
            "a schedule with a missing part",
            "tau2-interleave-missing-part:control-b.part01",
            lambda: read_round(root / "cli", holed),
        )
        refuses("neither a plan nor a read nor a run was asked for", "2", lambda: main([]))
        refuses(
            "a read with no manifest",
            f"tau2-interleave-no-manifest:{root / 'nothing' / 'parts' / 'manifest.json'}",
            lambda: main(["--read", "--dir", str(root / "nothing")]),
        )
        refuses(
            "a run with no directory",
            "tau2-interleave-no-directory",
            lambda: main(["--run", "--tasks", "0"]),
        )
        refuses_with(
            "a window guard that does not fit",
            "tau2-pilot-peak-window",
            lambda: main(["--run", "--tasks", "0,1", "--chunk", "1", "--dir", str(root / "window"),
                          "--require-off-peak", "--rate-card", always_peak(root)]),
        )
        check("the refused run bought nothing", not (root / "window" / "parts" / "manifest.json").exists())
        check("the estimate counts the imports", estimate_minutes(114) > estimate_minutes(8))
        check("the estimate scales with the chunk", estimate_minutes(114, chunk=4) > estimate_minutes(114, chunk=32))

        # The guard's other side: a card with no band at all must let the same command through. A guard whose only
        # exercised answer is "refuse" is a guard that may have been refusing everything.
        check(
            "a window guard that fits lets the run through",
            main(["--run", "--tasks", "0,1", "--chunk", "1", "--dir", str(root / "clear"),
                  "--runner", str(fake), "--python", sys.executable, "--max-steps", "2",
                  "--require-off-peak", "--rate-card", never_peak(root), "--json"]) == 0,
        )

        # A part that failed is refused by name *after* the manifest is written, which is the property that makes an
        # interrupted grid resumable rather than lost.
        refuses(
            "a part that exits nonzero",
            "tau2-interleave-part-failed:control-a.part00:7",
            lambda: run_phase(
                {"parts": plan(["0"], 1)[:1]},
                root / "failing",
                python=sys.executable,
                runner=exits_with(root, 7),
                domain="retail",
                seed=1,
                trials=1,
                max_steps=1,
                off_peak=False,
                resume=False,
            ),
        )
        check("the failing part wrote no document", not (root / "failing" / "parts" / "control-a.part00.json").exists())

        # A document that is not an object, and a resume over one: both refusals are about a file the round cannot
        # read, which is the only state that can silently become a smaller grid.
        broken = root / "broken.json"
        broken.write_text("[]", encoding="utf-8")
        refuses("a part that is not an object", f"tau2-interleave-bad-document:{broken}", lambda: _read_json(broken))
        (root / "round" / "parts" / "control-a.part00.json").write_text("not json", encoding="utf-8")
        unreadable = json.loads((root / "round" / "parts" / "manifest.json").read_text())
        run_phase(
            unreadable,
            root / "round",
            python=sys.executable,
            runner=fake,
            domain="retail",
            seed=400,
            trials=1,
            max_steps=2,
            off_peak=False,
            resume=True,
        )
        check(
            "an unreadable part is re-run rather than trusted",
            unreadable["parts"][0].get("skipped") is None and unreadable["parts"][0]["returncode"] == 0,
        )

        # An arm with no parts at all: the merge has nothing to pair, so it refuses by name.
        refuses(
            "an arm with no parts",
            "tau2-interleave-arm-has-no-parts:control-b",
            lambda: read_round(root / "round", {"parts": [entry for entry in unreadable["parts"]
                                                          if entry["arm"] == "control-a"]}),
        )
        # A counter block that is not a block, a document that is not a document: the summing reports what it read.
        check("a part with no usage is counted as unmeasured", _sum_usage([{"usage": "no"}, "neither"])["measuredParts"] == 0)
        check(
            "an episode that is not an object is skipped by the bill",
            # 0.25, not 0.5: the denominator is the document's own episode count and a junk entry still occupies
            # a slot. An entry that is not an object contributes no cost, but dropping it from the count would make
            # the bill per episode rise when a document got malformed — the failure would read as a price.
            bill_per_episode({"simulations": ["junk", {"agent_cost": 0.5}]}) == 0.25,
        )
        # The report, on both answers, into a buffer rather than into the log of a green build.
        buffer = io.StringIO()
        check("the report answers one for a failure", _report(["planted"], 2, buffer) == 1 and "planted" in buffer.getvalue())
        buffer = io.StringIO()
        check("the report answers zero for none", _report([], 2, buffer) == 0 and "2 check(s) passed" in buffer.getvalue())
        check("a gap entry that is not an object is skipped", gaps(["nope"])["blocks"] == 0)
        check(
            "a gap whose arm is unknown is skipped",
            gaps([{"block": 0, "arm": "control-z", "startedAt": "2026-11-26T04:00:00+00:00"},
                  {"block": "0", "arm": "control-a"}])["blocks"] == 0,
        )

        # The suite's own failure paths, exercised on purpose and then discarded. A check whose failing branch has
        # never run is a check that cannot fail visibly — the reason `goal_board.py` keeps its `FAILED` list rather
        # than counting.
        def raises(text):
            def inner():
                raise SystemExit(text)

            return inner

        planted_at = len(failures)
        check("a check that must fail", False, "deliberate")
        refuses("a refusal that must not fire", "tau2-nope", lambda: None)
        refuses("a refusal with another code", "tau2-nope", raises("other"))
        refuses_with("a refusal that must not fire", "tau2-nope", lambda: None)
        refuses_with("a refusal with another prefix", "tau2-nope", raises("other"))
        planted = failures[planted_at:]
        del failures[planted_at:]
        cases -= 5
        check("the suite can say no", len(planted) == 5, planted)
        check("and says what failed", any("deliberate" in line for line in planted), planted)

    return _report(failures, cases)


def _report(failures: "list[str]", cases: int, stream=None) -> int:
    """Print the failures and the count, and answer with the exit code the workflow reads.

    A function rather than four lines at the end of `self_test`, because those four lines are the only part of this
    file that a green suite never runs — and a reporting branch nobody has run is a branch that can print a pass
    while holding a failure.
    """
    # `stream` is a parameter so the self-test can run this branch into a buffer: a suite that proves its failure
    # reporting by printing a failure into the log of a green build is a suite nobody can read.
    out = stream or sys.stderr
    if failures:
        for failure in failures:
            print(f"[interleave] FAIL {failure}", file=out)
        print(f"[interleave] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[interleave] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(description="R218c's interleaved placebo: two arms, one grid, one order")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true", help="print the schedule and stop; spends nothing")
    mode.add_argument("--run", action="store_true", help="run the schedule, then merge and read")
    mode.add_argument("--read", action="store_true", help="re-merge the parts on disk and re-derive the verdict")
    mode.add_argument("--self-test", action="store_true")
    parser.add_argument("--tasks", default="", help="the population, comma-separated, in the order it was read")
    parser.add_argument("--chunk", type=int, default=DEFAULT_CHUNK, help="tasks per invocation")
    parser.add_argument("--dir", default="", help="the round's directory: parts/ under it, merged arms beside it")
    parser.add_argument("--runner", default=str(HERE / "run_split.py"))
    parser.add_argument("--python", default=sys.executable, help="the interpreter the parts run on")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--seed", type=int, default=400)
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--require-off-peak", action="store_true",
                        help="refuse unless the whole schedule fits in the provider's off-peak window")
    parser.add_argument("--resume", action="store_true", help="keep the parts a previous attempt already bought")
    parser.add_argument("--rate-card", default=str(RATE_CARD))
    parser.add_argument("--json", action="store_true", help="print the reading alone")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    if arguments.plan:
        wanted = [entry for entry in arguments.tasks.split(",") if entry.strip()]
        schedule = plan(wanted, arguments.chunk)
        minutes = estimate_minutes(len(wanted), 2, arguments.trials, arguments.concurrency)
        document = {"tasks": len(wanted), "chunk": arguments.chunk, "invocations": len(schedule),
                    "estimateMinutes": minutes, "parts": schedule}
        print(json.dumps(document, indent=1))
        return 0

    if not arguments.dir:
        raise SystemExit("tau2-interleave-no-directory")
    root = Path(arguments.dir)
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "parts" / "manifest.json"

    if arguments.read:
        if not manifest_path.exists():
            raise SystemExit(f"tau2-interleave-no-manifest:{manifest_path}")
        manifest = _read_json(manifest_path)
        block = read_round(root, manifest)
        _write_manifest(root, manifest)
        print(json.dumps(_stamp(block), indent=1) if arguments.json else render_verdict(_stamp(block)))
        return 0

    wanted = [entry for entry in arguments.tasks.split(",") if entry.strip()]
    if arguments.require_off_peak:
        with open(arguments.rate_card, encoding="utf-8") as stream:
            card = json.load(stream)
        minutes = estimate_minutes(len(wanted), 2, arguments.trials, arguments.concurrency, arguments.chunk)
        fits, reason = fits_window(_now(), minutes, card)
        if not fits:
            raise SystemExit(f"{reason} (this schedule needs {minutes} min)")
    manifest = {
        "round": "R218c",
        "domain": arguments.domain,
        "seed": arguments.seed,
        "trials": arguments.trials,
        "chunk": arguments.chunk,
        "startedAt": _now().isoformat(),
        "estimateMinutes": estimate_minutes(
            len(wanted), 2, arguments.trials, arguments.concurrency, arguments.chunk
        ),
        "parts": plan(wanted, arguments.chunk),
    }
    _write_manifest(root, manifest)
    print(f"[interleave] {len(manifest['parts'])} invocation(s) over {len(wanted)} task(s), manifest "
          f"{manifest_path}", file=sys.stderr)
    run_phase(
        manifest,
        root,
        python=arguments.python,
        runner=Path(arguments.runner),
        domain=arguments.domain,
        seed=arguments.seed,
        trials=arguments.trials,
        max_steps=arguments.max_steps,
        off_peak=arguments.require_off_peak,
        resume=arguments.resume,
        log=lambda line: print(line, file=sys.stderr),
    )
    _write_manifest(root, manifest)
    block = read_round(root, manifest)
    _write_manifest(root, manifest)
    print(json.dumps(_stamp(block), indent=1) if arguments.json else render_verdict(_stamp(block)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
