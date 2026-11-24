#!/usr/bin/env python3
"""R208's material ablation: two summarisers, one bank, the same failures.

R207's pilot proved the lane could not be measured on a grid that fails once in forty-eight. The bank
(`note_bank.py`) bought the population instead: 456 episodes over the retail split, 85 failed attempts, every one
of them explained by the evaluator. This tool spends the bank — it shows each failed attempt to the summariser
twice, once as the attempt alone (R207's material) and once as the attempt plus the verdict (R208's), and measures
the four things the registration predicted:

  P1  the verdict is read          every failure renders at least one line, or the material does not exist
  P2  the refusal rate falls       at least half of what the attempt-only arm declined, the verdict arm writes
  P3  the note names the check     the note holds a token only its own failure's verdict holds
  P4  the block is cheap           the verdict adds at most a third of the attempt's prompt characters

The design is **paired**: the same failures, the same model, the same ceiling, one call each side. That is what
makes McNemar's exact test the right instrument for P2 rather than a difference of proportions — only the
discordant pairs carry information about a change, and with 85 failures the exact test is cheap.

It reads a bank and calls the provider; it needs no simulator, so a material question costs cents rather than the
¥14.5 the bank itself cost.

Usage:
  python3 eval/tools/note_material_ablation.py --bank eval/results/note-bank/control.json
  python3 eval/tools/note_material_ablation.py --bank control.json --limit 10 --json /tmp/ablation.json
  python3 eval/tools/note_material_ablation.py --bank control.json --dry-run
  python3 eval/tools/note_material_ablation.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

# The renderers and the entity reader, from the driver that owns them: the ablation must measure the prompt the
# arm will actually send, not a copy of it that drifts the first time a constant moves.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "drivers" / "tau2"))

import notes  # noqa: E402

#: The two materials, in the order they are reported. `attempt` is R207's, `verdict` is R208's, and the names are
#: the artefact's keys so a reader never has to map a label to a behaviour.
MATERIALS = ("attempt", "verdict")

#: R208's registered bars, in one place. `P1` is "at most a fifth may render nothing", `P2` and `P3` are shares,
#: and `P4` is a ratio against the attempt's own ceiling rather than an absolute, because the attempt is what the
#: block is added to.
P1_BAR = 0.8
P2_BAR = 0.5
P3_BAR = 0.5
P4_BAR = notes.TRAJECTORY_CHARS / 3

#: Characters per token, the estimator the rest of the lane uses for a prompt it has not billed yet.
CHARS_PER_TOKEN = 4

#: The rate card, as a module constant so the self-check can point the readers at a missing or broken file. A
#: branch that cannot be reached in a test is a branch nobody has ever run, which is the defect this lane keeps
#: finding in its own instruments.
CARD = Path(__file__).resolve().parent.parent / "manifests" / "model-rates.json"


def failures_of(document) -> list:
    """Every failed attempt in the bank, as `{task, trial, reward, simulation}` in trial order.

    A pass is not material and an unscored episode is not a failure: `notes.reward_of` returns `None` for the
    second and `1.0` or more for the first, and this reader keeps only what a summariser can be shown. A row with
    no task id is dropped rather than keyed under the empty string, because the specificity check needs to know
    which failure is whose.
    """
    simulations = document.get("simulations") if isinstance(document, dict) else None
    kept = []
    for simulation in simulations if isinstance(simulations, list) else []:
        if not isinstance(simulation, dict):
            continue
        task = simulation.get("task_id")
        if not isinstance(task, str) or task.strip() == "":
            continue
        reward = notes.reward_of(simulation)
        if reward is None or reward >= 1.0:
            continue
        kept.append({"task": task.strip(), "trial": simulation.get("trial"), "reward": reward,
                     "simulation": simulation})
    return kept


def failing_text(verdict: str) -> set:
    """The tokens of a verdict's *failing* lines, which is the requirement the note should name.

    The whole verdict is the wrong denominator for specificity: `REWARD`, `DB CHECK`, `ACTION met` and every
    passing check appear in nearly every failure, so a note that mentions them is naming the schema rather than
    the mistake. R210 measured what that costs — with the whole verdict as the vocabulary, 77 of 85 failures had an
    empty exclusive set and P3's ceiling was 9.4%, a bar no material could reach.
    """
    lines = [line for line in (verdict or "").split("\n") if "not met" in line]
    return notes.entities(" ".join(lines))


def names_own_check(note: str, verdict: str) -> bool:
    """Whether a note shares a token with its own failure's failing lines."""
    return bool(notes.entities(note) & failing_text(verdict))


def specificity_of(note: str, own: str, others) -> bool:
    """Whether a note names something only its own failure's verdict names.

    The vocabulary is `notes.entities` — the reader `N3` already uses — restricted to what the other failures'
    verdicts do not contain. A note made only of tokens every verdict holds ("agent", "check", "action") is a
    restatement no matter how well it is written, and this is the check that says so.
    """
    tokens = notes.entities(note)
    exclusive = notes.entities(own)
    for other in others or []:
        exclusive -= notes.entities(other)
    return bool(tokens & exclusive)


def mcnemar_exact(rescued: int, lost: int) -> float:
    """Two-sided exact McNemar p-value over the discordant pairs.

    Only the pairs that changed carry information: `rescued` is refused-then-written and `lost` is the reverse.
    Under the null the two are equally likely, so the count is binomial with `p = 1/2`; the exact two-sided
    p-value is twice the smaller tail, capped at 1. No normal approximation, because the bank's discordant count
    can be small enough that the approximation is the wrong instrument.
    """
    rescued = max(0, int(rescued or 0))
    lost = max(0, int(lost or 0))
    pairs = rescued + lost
    if pairs == 0:
        return 1.0
    tail = sum(math.comb(pairs, index) for index in range(min(rescued, lost) + 1))
    return min(1.0, 2 * tail / (2 ** pairs))


def usd_of(prompt_tokens: int, completion_tokens: int, model: str = "", band: str = "off_peak") -> "float | None":
    """The ablation's bill at the card's `band` row, or `None` when the card does not price the model.

    Read from `eval/manifests/model-rates.json` rather than restated: one card, two readers, and this is the third
    — a fourth copy of a price is the copy that is wrong. The band is an argument rather than an assumption,
    because this job does not use the τ² window guard (it runs no simulator) and therefore has to price itself in
    whichever band it is actually billed in.
    """
    try:
        with open(CARD, encoding="utf-8") as file:
            card = json.load(file)
        name = (model or card.get("defaultModel") or "").split("/")[-1]
        row = (card.get("prices") or {}).get(name) or (card.get("prices") or {}).get(card.get("defaultModel"))
        rates = (row or {}).get(band) or {}
    except (OSError, ValueError):
        return None
    if not rates:
        return None
    return (prompt_tokens * rates.get("miss", 0.0) + completion_tokens * rates.get("out", 0.0)) / 1_000_000


def priced_as(model: str = "") -> str:
    """The card row a model is billed at, named rather than implied.

    A model the card does not hold is billed at `defaultModel` — the card's own documented policy — and an
    approximation that names itself is a number with an assumption while one that does not is a number that lies.
    """
    try:
        with open(CARD, encoding="utf-8") as file:
            card = json.load(file)
    except (OSError, ValueError):
        return ""
    prices = card.get("prices") or {}
    name = (model or card.get("defaultModel") or "").split("/")[-1]
    return name if name in prices else str(card.get("defaultModel") or "")


def band_of(now=None) -> str:
    """`peak` or `off_peak` for a moment, from the same card the simulator lanes are guarded by.

    The card's windows are the provider's, and peak pricing applies on weekdays only — so a Saturday hour inside a
    window is off-peak, which is a fact a hardcoded hour comparison would get wrong in one direction and over-bill
    in the other.
    """
    import datetime  # noqa: PLC0415 - only this function needs the clock, and the self-test injects one

    moment = now or datetime.datetime.now(datetime.timezone.utc)
    if moment.weekday() >= 5:
        return "off_peak"
    try:
        with open(CARD, encoding="utf-8") as file:
            card = json.load(file)
    except (OSError, ValueError):
        return "off_peak"
    for window in card.get("peakWindows") or []:
        start = int(window.get("fromHourUtc", 0))
        end = int(window.get("toHourUtc", 0))
        if start <= moment.hour < end:
            return "peak"
    return "off_peak"


def plan_of(failures, model: str = "", band: str = "off_peak") -> dict:
    """What this run is about to cost, before it costs it: two prompts per failure, one refusal each side.

    The estimate is deliberately an over-estimate — the full attempt and the full verdict, plus the completion
    ceiling — because a budget that is optimistic is a budget that is wrong in the direction that spends. It exists
    so the tool can refuse, not so it can report after the fact.
    """
    calls = 2 * len(failures)
    prompt_chars = sum(len(notes.note_prompt(notes.trajectory_text(failure["simulation"]),
                                             notes.verdict_text(failure["simulation"])))
                       + len(notes.note_prompt(notes.trajectory_text(failure["simulation"]), ""))
                       for failure in failures)
    prompt_tokens = int(prompt_chars / CHARS_PER_TOKEN) + calls * 8
    completion_tokens = calls * notes.NOTE_MAX_TOKENS
    return {"calls": calls, "band": band, "promptTokens": prompt_tokens, "completionTokens": completion_tokens,
            "pricedAs": priced_as(model), "usd": usd_of(prompt_tokens, completion_tokens, model, band)}


def measure(rows, band: str = "off_peak") -> dict:
    """The four predictions over paired rows, and the bill.

    Each row is one failure: its `verdict_text` and, per material, the `sentence`, `state` and `promptChars` the
    summariser returned. The materials are named rather than positional so a row written by an older run cannot
    be read as the wrong arm — the same defect `merge_notes_blocks` refuses one level up.
    """
    rows = [row for row in (rows or []) if isinstance(row, dict)]
    entries = {
        name: [(row.get("materials") or {}).get(name) or {} for row in rows] for name in MATERIALS
    }
    materials = {}
    tokens = {}
    for name in MATERIALS:
        seen = entries[name]
        materials[name] = {
            "written": sum(1 for entry in seen if entry.get("state") == "sentence"),
            "refused": sum(1 for entry in seen if entry.get("state") == "refused"),
            "failed": sum(1 for entry in seen if entry.get("state") == "failed"),
            "truncated": sum(1 for entry in seen if entry.get("state") == "truncated"),
            "dry": sum(1 for entry in seen if entry.get("state") == "dry"),
            "promptChars": sum(int(entry.get("promptChars") or 0) for entry in seen),
            "noteChars": sum(len(str(entry.get("sentence") or "")) for entry in seen),
        }
        prompt = sum(int(((entry.get("usage") or {}) if isinstance(entry.get("usage"), dict) else {})
                         .get("prompt") or 0) for entry in seen)
        completion = sum(int(((entry.get("usage") or {}) if isinstance(entry.get("usage"), dict) else {})
                             .get("completion") or 0) for entry in seen)
        tokens[name] = {"prompt": prompt, "completion": completion, "usd": usd_of(prompt, completion, band=band)}

    # P1: the material exists at all. Measured over every failure, because a verdict that renders nothing on one
    # failure is a failure the summariser cannot be told about — and if more than a fifth are like that, the block
    # is not worth what it costs.
    verdicts = [str(row.get("verdictText") or "").strip() for row in rows]
    explained = sum(1 for text in verdicts if text != "")
    p1_share = (explained / len(rows)) if rows else None
    p1 = {"explained": explained, "failures": len(rows), "share": p1_share, "bar": P1_BAR,
          "pass": p1_share is not None and p1_share >= P1_BAR}

    # P2: the paired question. `declined` is what the attempt-only arm refused; `rescued` is how many of those the
    # verdict arm wrote. `lost` is the reverse and belongs in the same place, because a material that trades one
    # refusal for another refusal has not helped and a one-sided count would say it had.
    declined = sum(1 for row in rows
                   if (row.get("materials") or {}).get("attempt", {}).get("state") == "refused")
    rescued = sum(1 for row in rows
                  if (row.get("materials") or {}).get("attempt", {}).get("state") == "refused"
                  and (row.get("materials") or {}).get("verdict", {}).get("state") == "sentence")
    lost = sum(1 for row in rows
               if (row.get("materials") or {}).get("attempt", {}).get("state") == "sentence"
               and (row.get("materials") or {}).get("verdict", {}).get("state") == "refused")
    p2_share = (rescued / declined) if declined else None
    p2 = {"declined": declined, "rescued": rescued, "lost": lost, "share": p2_share, "bar": P2_BAR,
          "pass": p2_share is not None and p2_share >= P2_BAR}

    # P3: whether the note names a token of its own failure's *failing* lines. Three numbers, and the third is the
    # one that makes it a measurement: the same note against the other failures' failing lines is the rate a note
    # that named nothing in particular would reach, so `lift` is what the material is worth and `share` alone is
    # not. The exclusive-token reader this replaces is kept as `exclusive` for continuity: it caps at 64.7% on this
    # bank and inverts the incentive, because the action a note most needs to name is the one other failures name.
    p3 = {}
    for name in MATERIALS:
        own_hits = 0
        exclusive = 0
        graded = 0
        chances: list = []
        for index, row in enumerate(rows):
            sentence = str(((row.get("materials") or {}).get(name) or {}).get("sentence") or "").strip()
            if sentence == "":
                continue
            graded += 1
            verdict = verdicts[index]
            if names_own_check(sentence, verdict):
                own_hits += 1
            if specificity_of(sentence, verdict, [text for position, text in enumerate(verdicts)
                                                  if position != index]):
                exclusive += 1
            note_tokens = notes.entities(sentence)
            against = [1.0 if note_tokens & failing_text(text) else 0.0
                       for position, text in enumerate(verdicts) if position != index]
            chances.append(sum(against) / len(against) if against else 0.0)
        share = (own_hits / graded) if graded else None
        chance = (sum(chances) / len(chances)) if chances else None
        p3[name] = {"own": own_hits, "graded": graded, "share": share, "chance": chance,
                    "lift": (share / chance) if share is not None and chance else None,
                    "exclusive": (exclusive / graded) if graded else None,
                    "pass": share is not None and share >= P3_BAR}

    # The paired contrast between the materials, which is the question: does the verdict make a note more specific
    # on the failures both arms saw? Only the discordant pairs carry information, so it is McNemar again.
    paired = {"both": 0, "verdictOnly": 0, "attemptOnly": 0, "neither": 0, "p": 1.0}
    for index, row in enumerate(rows):
        attempt_note = str(((row.get("materials") or {}).get("attempt") or {}).get("sentence") or "")
        verdict_note = str(((row.get("materials") or {}).get("verdict") or {}).get("sentence") or "")
        if attempt_note == "" or verdict_note == "":
            continue
        a = names_own_check(attempt_note, verdicts[index])
        v = names_own_check(verdict_note, verdicts[index])
        key = {(True, True): "both", (False, True): "verdictOnly",
               (True, False): "attemptOnly", (False, False): "neither"}[(a, v)]
        paired[key] += 1
    paired["p"] = mcnemar_exact(paired["verdictOnly"], paired["attemptOnly"])

    # P4: what the block adds, per failure, against the attempt's own ceiling.
    added = []
    for row in rows:
        pair = (row.get("materials") or {})
        attempt_chars = int((pair.get("attempt") or {}).get("promptChars") or 0)
        verdict_chars = int((pair.get("verdict") or {}).get("promptChars") or 0)
        added.append(max(0, verdict_chars - attempt_chars))
    mean_added = (sum(added) / len(added)) if added else None
    p4 = {"mean": mean_added, "max": (max(added) if added else None), "bar": P4_BAR,
          "pass": mean_added is not None and mean_added <= P4_BAR and max(added) <= P4_BAR}

    truncated = sum(materials[name]["truncated"] for name in MATERIALS)
    p0 = {"truncated": truncated, "bar": 0, "pass": truncated == 0}

    bars = [
        {"name": "P0", "pass": p0["pass"], "reading": p0},
        {"name": "P1", "pass": p1["pass"], "reading": p1},
        {"name": "P2", "pass": p2["pass"], "reading": p2},
        {"name": "P3", "pass": p3["verdict"]["pass"], "reading": p3},
        {"name": "P4", "pass": p4["pass"], "reading": p4},
    ]
    return {
        "failures": len(rows),
        "materials": materials,
        "tokens": tokens,
        "p0": p0,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "paired": paired,
        "p4": p4,
        "mcnemar": {"rescued": rescued, "lost": lost, "p": mcnemar_exact(rescued, lost)},
        "bars": bars,
    }


def _percent(share) -> str:
    """A share as a percentage, or `n/a` when the denominator was zero."""
    return "n/a" if share is None else f"{share * 100:.1f}%"


def render(result) -> str:
    """The readings as a markdown table, in the order the registration states them.

    A share whose denominator is zero renders `n/a` rather than `0.0`: `P2` with nothing declined is not a failure
    of the material, it is a question the bank did not ask, and the report says which.
    """
    population = result.get("failures") or 0
    materials = result.get("materials") or {}
    tokens = result.get("tokens") or {}
    p0 = result.get("p0") or {}
    p1 = result.get("p1") or {}
    p2 = result.get("p2") or {}
    p3 = result.get("p3") or {}
    paired = result.get("paired") or {}
    p4 = result.get("p4") or {}
    mcnemar = result.get("mcnemar") or {}
    attempt = materials.get("attempt") or {}
    verdict = materials.get("verdict") or {}

    mean = p4.get("mean")
    worst = p4.get("max")
    p4_reading = "n/a" if mean is None else f"mean {round(mean)} chars, max {worst}"
    graded = (p3.get("verdict") or {}).get("graded", 0)

    lines = [
        f"**Population.** {population} failure(s), each shown twice: the attempt alone, and the attempt with the "
        "verdict.",
        "",
        "| reading | attempt | verdict |",
        "|---|---|---|",
        f"| written | {attempt.get('written', 0)} | {verdict.get('written', 0)} |",
        f"| refusals | {attempt.get('refused', 0)} | {verdict.get('refused', 0)} |",
        f"| provider failures | {attempt.get('failed', 0)} | {verdict.get('failed', 0)} |",
        f"| truncated | {attempt.get('truncated', 0)} | {verdict.get('truncated', 0)} |",
        f"| prompt chars | {attempt.get('promptChars', 0)} | {verdict.get('promptChars', 0)} |",
        f"| note chars | {attempt.get('noteChars', 0)} | {verdict.get('noteChars', 0)} |",
        f"| tokens (in / out) | {(tokens.get('attempt') or {}).get('prompt', 0)} / "
        f"{(tokens.get('attempt') or {}).get('completion', 0)} | {(tokens.get('verdict') or {}).get('prompt', 0)} / "
        f"{(tokens.get('verdict') or {}).get('completion', 0)} |",
        f"| cost | {_usd(tokens.get('attempt'))} | {_usd(tokens.get('verdict'))} |",
        "",
        "| prediction | reading | bar | result |",
        "|---|---|---|---|",
        f"| P0 no call was cut off | {p0.get('truncated', 0)} truncated | 0 | {_pass(p0.get('pass'))} |",
        f"| P1 the evaluator explained | {p1.get('explained', 0)} of {population} ({_percent(p1.get('share'))}) "
        f"| >= {P1_BAR * 100:.0f}% | {_pass(p1.get('pass'))} |",
        f"| P2 the verdict rescues what the attempt declined | {p2.get('rescued', 0)} of {p2.get('declined', 0)} "
        f"declined ({_percent(p2.get('share'))}), {p2.get('lost', 0)} lost | >= {P2_BAR * 100:.0f}% "
        f"| {_pass(p2.get('pass'))} |",
        f"| P3 a note names its own failing lines | attempt {_percent((p3.get('attempt') or {}).get('share'))} "
        f"(chance {_percent((p3.get('attempt') or {}).get('chance'))}), verdict "
        f"{_percent((p3.get('verdict') or {}).get('share'))} "
        f"(chance {_percent((p3.get('verdict') or {}).get('chance'))}) of {graded} | >= {P3_BAR * 100:.0f}% "
        f"| {_pass((p3.get('verdict') or {}).get('pass'))} |",
        f"| P4 the block is cheap | {p4_reading} | <= {P4_BAR:.0f} | {_pass(p4.get('pass'))} |",
        "",
        f"McNemar exact over the discordant pairs: {mcnemar.get('rescued', 0)} rescued, {mcnemar.get('lost', 0)} "
        f"lost, p = {mcnemar.get('p', 1.0):.4f}.",
        f"Specificity, paired: {paired.get('both', 0)} both, {paired.get('verdictOnly', 0)} verdict only, "
        f"{paired.get('attemptOnly', 0)} attempt only, {paired.get('neither', 0)} neither, "
        f"p = {paired.get('p', 1.0):.4f}.",
        "",
        f"**State.** {'GRADED' if all(bar.get('pass') for bar in result.get('bars') or []) else 'REFUTED'}",
    ]
    return "\n".join(lines)


def _usd(tokens) -> str:
    """A bill as dollars, or `n/a` when the card does not price the model."""
    amount = (tokens or {}).get("usd")
    return "n/a" if amount is None else f"${amount:.4f}"


def _pass(value) -> str:
    """A bar's outcome in the vocabulary a reader scans for."""
    return "pass" if value else "FAIL"


def _report(checks: int, failures) -> int:
    """Print the failures and the count, and answer with the exit code `main` returns."""
    for name in failures or []:
        print(f"FAIL  {name}")
    print(f"{checks} case(s), {len(failures or [])} failure(s)")
    return 0 if not failures else 1


def _rows_from_reading(previous) -> list:
    """The rows a reading kept, as the rows `measure` takes.

    Only P3 and its paired contrast are recomputed from these: a reading does not carry the prompt sizes or the
    provider's counters, so P0, P1, P2 and P4 keep the values the calls actually produced. A measure that changes
    is a measure that should not be re-billed to test.
    """
    rows = []
    for note in previous.get("notes") or []:
        if not isinstance(note, dict):
            continue
        rows.append({
            "task": note.get("task"), "trial": note.get("trial"), "reward": None,
            "verdictText": str(note.get("evaluator") or ""),
            "materials": {name: {"sentence": str(note.get(name) or ""),
                                 "state": "sentence" if note.get(name) else "refused",
                                 "promptChars": 0, "usage": {}}
                          for name in MATERIALS},
        })
    return rows


def _recompute(args) -> int:
    """Recompute P3 from a kept reading: `--from-reading reading.json`."""
    try:
        with open(args.from_reading, encoding="utf-8") as stream:
            previous = json.load(stream)
    except (OSError, ValueError) as error:
        print(f"no reading to recompute: {error}", file=sys.stderr)
        return 2
    rows = _rows_from_reading(previous)
    if not rows:
        print("the reading kept no notes — dispatch it with --keep-notes", file=sys.stderr)
        return 2
    fresh = measure(rows, previous.get("tokens", {}).get("verdict", {}).get("band", "off_peak")
                    if isinstance(previous.get("tokens"), dict) else "off_peak")
    result = dict(previous)
    result["p3"] = fresh["p3"]
    result["paired"] = fresh["paired"]
    result["bars"] = sorted([bar for bar in previous.get("bars") or [] if bar.get("name") != "P3"]
                            + [{"name": "P3", "pass": fresh["p3"]["verdict"]["pass"],
                                "reading": fresh["p3"]}], key=lambda bar: bar.get("name", ""))
    result["recomputed"] = "P3 and its paired contrast only; the calls are the reading's own"
    print(render(result))
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    return 0 if all(bar.get("pass") for bar in result["bars"]) else 1


def main(argv: list[str]) -> int:
    """0 measured and every bar met, 1 measured and a bar failed, 2 cannot measure."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bank", default="")
    parser.add_argument("--limit", type=int, default=0, help="first N failures, for a smoke run")
    parser.add_argument("--model", default="")
    parser.add_argument("--json", default="")
    parser.add_argument("--dry-run", action="store_true", help="render the prompts and bill nothing")
    parser.add_argument("--max-usd", type=float, default=0.5,
                        help="refuse before the first call when the estimate exceeds this")
    parser.add_argument("--from-reading", default="",
                        help="recompute P3 from a reading that kept its notes, without a provider call")
    parser.add_argument("--keep-notes", action="store_true",
                        help="carry the sentences and their verdicts into the reading, so they can be read")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if args.from_reading:
        return _recompute(args)
    if not args.bank:
        print("usage: note_material_ablation.py --bank <control.json> | --self-test", file=sys.stderr)
        return 2
    try:
        with open(args.bank, encoding="utf-8") as stream:
            document = json.load(stream)
    except (OSError, ValueError) as error:
        print(f"no bank to read: {error}", file=sys.stderr)
        return 2

    failures = failures_of(document)
    if not failures:
        print("the bank holds no failure — a saturated split has no material to ablate", file=sys.stderr)
        return 2
    if args.limit > 0:
        failures = failures[: args.limit]

    model = notes.note_model(args.model or document.get("info", {}).get("llm", ""))
    band = band_of()
    plan = plan_of(failures, model, band)
    # The budget is checked before the first call and printed either way: a job that runs no simulator has no
    # window guard over it, so the thing that bounds its spend is this estimate and the ceiling it is compared with.
    print(f"[ablation] {plan['calls']} call(s) at the {band} band, priced as {plan['pricedAs']}, about "
          f"{(plan['usd'] or 0):.4f} USD, ceiling {args.max_usd:.2f}", file=sys.stderr)
    if plan["usd"] is not None and plan["usd"] > args.max_usd:
        print(f"tau2-ablation-over-budget:{plan['usd']:.4f}>{args.max_usd:.2f}", file=sys.stderr)
        return 2
    # The call is `notes.call_note_model`: one place, with thinking switched off, and the counters and
    # `finish_reason` it returns are what let this reading tell a refusal from a truncation.
    def write(prompt: str):
        return notes.call_note_model(prompt, model)
    rows = []
    for index, failure in enumerate(failures, start=1):
        simulation = failure["simulation"]
        attempt = notes.trajectory_text(simulation)
        verdict = notes.verdict_text(simulation)
        row = {"task": failure["task"], "trial": failure["trial"], "reward": failure["reward"],
               "verdictText": verdict, "materials": {}}
        for material in MATERIALS:
            prompt = notes.note_prompt(attempt, verdict if material == "verdict" else "")
            if args.dry_run:
                row["materials"][material] = {"sentence": "", "state": "dry", "promptChars": len(prompt), "usage": {}}
                continue
            sentence, state, usage = write(prompt)
            row["materials"][material] = {"sentence": sentence, "state": state,
                                          "promptChars": len(prompt), "usage": usage}
        rows.append(row)
        if index % 10 == 0:
            print(f"[ablation] {index}/{len(failures)} failure(s)", file=sys.stderr)

    result = measure(rows, band)
    if args.keep_notes:
        # The reading is normally a census, and a census cannot tell a note that names the check from one that
        # paraphrases it. This carries the text so a reader can judge, and it is opt-in because a bank's verdicts
        # quote customer data.
        result["notes"] = [
            {"task": row["task"], "trial": row["trial"],
             "attempt": (row["materials"].get("attempt") or {}).get("sentence", ""),
             "verdict": (row["materials"].get("verdict") or {}).get("sentence", ""),
             "evaluator": row.get("verdictText", "")}
            for row in rows
        ]
    print(render(result))
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    if args.dry_run:
        return 0
    # A truncated call measures nothing: the model never reached an answer, so neither arm was compared and the
    # reading is a fact about the budget rather than about the material. That is exit 2 — cannot measure — and it
    # is the state R206a, R207 and R208 spent three rounds in without a name for it.
    if not result["p0"]["pass"]:
        print("tau2-ablation-truncated:" + str(result["p0"]["truncated"]), file=sys.stderr)
        return 2
    return 0 if all(bar["pass"] for bar in result["bars"]) else 1


def self_test() -> int:
    """The cases, each one a claim a reader of the report is entitled to.

    Written before the implementation, and the failure path is exercised deliberately: a suite whose green means
    nothing is the defect `r206_readback.py` warns about one level up.
    """
    import contextlib
    import io
    import tempfile

    checks = 0
    failed: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal checks
        checks += 1
        if not condition:
            failed.append(f"{name}{': ' + detail if detail else ''}")

    def simulation(task: str, reward, *, verdict: str = "", answer: str = "AGENT: done.") -> dict:
        info = {"reward": reward, "db_check": {"db_match": reward == 1.0},
                "action_checks": [{"action": {"name": "cancel_pending_order"}, "action_match": reward == 1.0}],
                "communicate_checks": [{"info": verdict, "met": False}] if verdict else []}
        return {"task_id": task, "trial": 0, "reward_info": info,
                "messages": [{"role": "user", "content": f"please help with task {task}"},
                             {"role": "assistant", "content": answer}]}

    # --- failures_of: what a bank holds is failed, scored attempts and nothing else.
    bank = {"simulations": [
        simulation("5", 0.0), simulation("5", 1.0), simulation("9", 0.0),
        {"task_id": "12", "reward_info": {"reward": None}},
        {"task_id": "", "reward_info": {"reward": 0.0}},
        {"reward_info": {"reward": 0.0}}, "not a simulation", {"task_id": "3", "reward_info": {"reward": True}},
    ]}
    kept = failures_of(bank)
    check("only failures are material", [row["task"] for row in kept] == ["5", "9"], str([r["task"] for r in kept]))
    check("an unscored episode is not a failure", all(row["reward"] is not None for row in kept))
    check("a failure keeps its reward", kept[0]["reward"] == 0.0, str(kept[0]["reward"]))
    check("a failure names its task", kept[1]["task"] == "9")
    check("a bool reward is not a failure", all(row["task"] != "3" for row in kept))
    check("an empty document holds nothing", failures_of({}) == [])
    check("a document that is not a document holds nothing", failures_of(None) == [])
    check("a partial reward is a failure", [r["task"] for r in failures_of({"simulations": [simulation("7", 0.5)]})] == ["7"])

    # --- specificity_of: naming the check, against every other failure's verdict.
    own = "REWARD 0\nDB CHECK not met\nACTION not met: cancel_pending_order"
    others = ["REWARD 0\nDB CHECK not met\nCOMMUNICATE not met: the agent must offer a refund",
              "REWARD 0\nACTION not met: exchange_delivered_order_items"]
    check("a note naming its own check is specific",
          specificity_of("Cancel the order with cancel_pending_order before confirming.", own, others))
    check("a note made of shared verdict words is not specific",
          not specificity_of("Check the reward and the action before answering.", own, others))
    check("an empty note is not specific", not specificity_of("", own, others))
    check("case does not decide specificity",
          specificity_of("CANCEL_PENDING_ORDER should have been called.", own, others))
    check("a token too short to identify anything does not count",
          not specificity_of("Check the db.", "DB CHECK not met", ["DB CHECK not met"]))
    check("an empty vocabulary is not specific", not specificity_of("anything at all", "", []))

    # --- mcnemar_exact: the paired test, exactly.
    check("no discordant pair is no evidence", mcnemar_exact(0, 0) == 1.0)
    check("an even split is no evidence", mcnemar_exact(3, 3) == 1.0, str(mcnemar_exact(3, 3)))
    check("ten rescues and nothing lost is significant", mcnemar_exact(10, 0) < 0.01, str(mcnemar_exact(10, 0)))
    check("the test is symmetric", mcnemar_exact(7, 1) == mcnemar_exact(1, 7))
    check("the test is capped at one", mcnemar_exact(1, 0) <= 1.0)
    check("more rescues is stronger evidence", mcnemar_exact(12, 0) < mcnemar_exact(6, 0))

    # --- measure: the four predictions, and the bill.
    def row(task: str, attempt_state: str, verdict_state: str, *, verdict: "str | None" = None,
            note: "str | None" = None, chars: int = 210) -> dict:
        # Each failure gets its own action name, because that is the fact P3 exists to test: a note is specific
        # when it names something no *other* failure's verdict names, and a fixture where every failure fails the
        # same action could not tell a specific note from a shared vocabulary.
        if verdict is None:
            verdict = f"REWARD 0\nDB CHECK not met\nACTION not met: cancel_order_{task}"
        if note is None:
            note = f"Call cancel_order_{task} before confirming."
        return {"task": task, "trial": 0, "reward": 0.0, "verdictText": verdict,
                "materials": {
                    "attempt": {"sentence": note if attempt_state == "sentence" else "", "state": attempt_state,
                                "promptChars": 2_000, "usage": {"prompt": 500, "completion": 20}},
                    "verdict": {"sentence": note if verdict_state == "sentence" else "", "state": verdict_state,
                                "promptChars": 2_000 + chars,
                                "usage": {"prompt": 560, "completion": 20}},
                }}

    paired = [row("5", "refused", "sentence"), row("9", "refused", "sentence"), row("12", "sentence", "sentence")]
    reading = measure(paired)
    check("the population is counted", reading["failures"] == 3, str(reading["failures"]))
    check("what the attempt arm declined is counted", reading["p2"]["declined"] == 2, str(reading["p2"]))
    check("what the verdict arm rescued is counted", reading["p2"]["rescued"] == 2, str(reading["p2"]))
    check("P2's share is over the declined", reading["p2"]["share"] == 1.0, str(reading["p2"]))
    check("P2 passes at the registered bar", reading["p2"]["pass"])
    check("P1 is measured over every failure", reading["p1"]["explained"] == 3, str(reading["p1"]))
    check("P3 is measured per material", set(reading["p3"]) == {"attempt", "verdict"}, str(reading["p3"].keys()))
    check("a note naming its check is specific in the verdict arm", reading["p3"]["verdict"]["pass"])
    check("P4 is measured against the attempt's ceiling", reading["p4"]["bar"] == P4_BAR, str(reading["p4"]["bar"]))
    check("the block is cheap at 210 characters", reading["p4"]["pass"], str(reading["p4"]))
    check("McNemar sees both rescues", reading["mcnemar"]["rescued"] == 2, str(reading["mcnemar"]))
    check("every bar is reported with its own name",
          [bar["name"] for bar in reading["bars"]] == ["P0", "P1", "P2", "P3", "P4"],
          str([bar["name"] for bar in reading["bars"]]))
    check("the bill is summed from the provider's own counters",
          reading["tokens"]["verdict"]["prompt"] == 1_680, str(reading["tokens"]["verdict"]))

    # A material that changes nothing is a refutation, and the reading has to say so.
    inert = measure([row("5", "refused", "refused"), row("9", "refused", "refused")])
    check("a material that writes nothing fails P2", not inert["p2"]["pass"], str(inert["p2"]))
    check("a material that writes nothing has a zero share", inert["p2"]["share"] == 0.0, str(inert["p2"]["share"]))
    check("a material that writes nothing still counts its refusals",
          inert["materials"]["verdict"]["refused"] == 2, str(inert["materials"]["verdict"]))
    # Nothing declined is a question not asked, not a failure of the material.
    nothing = measure([row("5", "sentence", "sentence")])
    check("nothing declined is not a share of zero", nothing["p2"]["share"] is None, str(nothing["p2"]))
    check("nothing declined does not pass P2 by default", not nothing["p2"]["pass"], str(nothing["p2"]))
    check("a provider failure is counted apart from a refusal",
          measure([row("5", "failed", "sentence")])["materials"]["attempt"]["failed"] == 1)
    # P1 over a bank whose evaluator explains nothing.
    silent = measure([row("5", "refused", "sentence", verdict="")])
    check("a failure the evaluator did not explain is not explained", silent["p1"]["explained"] == 0, str(silent["p1"]))
    check("P1 fails when the evaluator says nothing", not silent["p1"]["pass"], str(silent["p1"]))
    # P4 over an expensive block.
    expensive = row("5", "refused", "sentence", chars=int(P4_BAR) + 1)
    check("an expensive block fails P4", not measure([expensive])["p4"]["pass"],
          str(measure([expensive])["p4"]))
    check("an empty reading is not a measurement", measure([])["failures"] == 0)

    # --- render: what a reader sees, and the n/a that keeps a zero denominator out of the bars.
    text = render(measure(paired))
    check("the report names the population", "3 failure(s)" in text, text)
    check("the report states P2's share", "100.0%" in text, text)
    blank = render(measure([row("5", "sentence", "sentence")]))
    check("a zero denominator renders n/a", "n/a" in blank, blank)
    check("the report names its materials", "attempt" in text and "verdict" in text)

    # --- the price band and the budget, because a job with no simulator has no window guard over it.
    import datetime as _dt

    def moment(hour: int, weekday: int = 1) -> "_dt.datetime":
        # 2026-11-23 is a Monday, so `weekday=1` is a Tuesday and `weekday=5` a Saturday: the card's peak windows
        # apply on weekdays only, and a test that used "today" would pass or fail depending on when it ran.
        monday = _dt.datetime(2026, 11, 23, tzinfo=_dt.timezone.utc)
        return monday + _dt.timedelta(days=weekday, hours=hour)

    check("hour two is inside a peak window", band_of(moment(2)) == "peak", band_of(moment(2)))
    check("hour three is inside a peak window", band_of(moment(3, 3)) == "peak")
    check("hour four is past the first window", band_of(moment(4)) == "off_peak", band_of(moment(4)))
    check("hour seven is inside the second window", band_of(moment(7)) == "peak", band_of(moment(7)))
    check("hour ten is past the second window", band_of(moment(10)) == "off_peak")
    check("hour twelve is off peak", band_of(moment(12)) == "off_peak")
    check("a weekend hour inside a window is off peak", band_of(moment(7, 5)) == "off_peak",
          band_of(moment(7, 5)))
    check("peak is dearer than off peak",
          (usd_of(1_000, 100, band="peak") or 0) > (usd_of(1_000, 100, band="off_peak") or 0))
    # The card's policy, asserted rather than assumed: a model it does not hold is billed at `defaultModel` and the
    # row is named, which is what makes the plan's number a number with an assumption attached.
    check("an unpriced model is billed at the card's default",
          (usd_of(1_000, 100, model="no-such-model") or 0) > 0)
    check("the fallback is named", priced_as("no-such-model") == "deepseek-flash", priced_as("no-such-model"))
    check("a priced model is named as itself", priced_as("deepseek-v4-pro") == "deepseek-v4-pro")
    check("an empty model is the card's default", priced_as("") == "deepseek-flash")
    plan = plan_of(failures_of(bank), "deepseek-flash", "off_peak")
    check("the plan counts two calls a failure", plan["calls"] == 4, str(plan["calls"]))
    check("the plan names its band", plan["band"] == "off_peak")
    check("the plan names what it priced", plan["pricedAs"] == "deepseek-flash", str(plan["pricedAs"]))
    check("the plan prices the calls", (plan["usd"] or 0) > 0, str(plan))
    check("the plan over-estimates the completions",
          plan["completionTokens"] == 4 * notes.NOTE_MAX_TOKENS, str(plan["completionTokens"]))

    # --- the card, when it is not there or not readable: a branch nobody has run is a branch nobody can trust.
    import re
    import types as _types

    original = globals()["CARD"]
    try:
        globals()["CARD"] = Path(directory := tempfile.mkdtemp()) / "no-card.json"
        check("a missing card prices nothing", usd_of(1_000, 100) is None)
        check("a missing card names no row", priced_as("deepseek-flash") == "")
        check("a missing card has one band", band_of(moment(2)) == "off_peak")
        broken = Path(directory) / "broken.json"
        broken.write_text("{not json", encoding="utf-8")
        globals()["CARD"] = broken
        check("a broken card prices nothing", usd_of(1_000, 100) is None)
    finally:
        globals()["CARD"] = original

    # --- the provider path, driven with a stand-in module: the plumbing between `notes.sentence_of` and the reply
    # shape is exactly what a rewrite breaks, and a real call cannot be made in a self-check.
    def reply(content: str, prompt_tokens: int = 500, completion_tokens: int = 20, finish: str = "stop"):
        return _types.SimpleNamespace(
            choices=[_types.SimpleNamespace(message=_types.SimpleNamespace(content=content), finish_reason=finish)],
            usage=_types.SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
        )

    seen: list = []
    fake = _types.ModuleType("litellm")

    def completion(**kwargs):
        prompt = kwargs["messages"][1]["content"]
        seen.append(kwargs)
        if "RAISE" in prompt:
            raise RuntimeError("provider down")
        if "VERDICT" in prompt:
            # Each failure's verdict names its own reference, so a note that quotes it is specific to that failure
            # and the stand-in exercises P3 rather than a shared vocabulary.
            found = re.search(r"ref_\d+", prompt)
            return reply(f"Confirm {found.group(0)} before answering." if found else "NONE")
        return reply("NONE")

    fake.completion = completion
    sys.modules["litellm"] = fake
    try:
        # The tool does not own the call — `notes.call_note_model` does — so what is checked here is that the call
        # the tool *makes* is the one the arm makes: thinking off, one sentence, deterministic. R208's 96.0
        # tokens per call were a call without that body, and the check that would have caught it belongs beside the
        # request rather than beside this tool.
        notes.call_note_model("ATTEMPT\n<<<\nplease help\n>>>\nVERDICT\n<<<\nCOMMUNICATE not met: ref_5\n>>>\n")
        check("the ablation's call switches thinking off",
              seen[-1].get("extra_body") == {"thinking": {"type": "disabled"}}, str(seen[-1].get("extra_body")))
        check("the ablation's call is deterministic", seen[-1].get("temperature") == 0)
        check("the ablation's call is one sentence", seen[-1].get("max_tokens") == notes.NOTE_MAX_TOKENS)

        # The command line over a bank that fails twelve times: the progress print, the per-failure loop, and both
        # exit codes, with the provider answered by the stand-in rather than by a network.
        noisy = {"simulations": [simulation(str(task), 0.0, verdict=f"the agent must confirm ref_{task}000 items")
                                for task in range(20, 32)]}
        noisy_path = Path(tempfile.mkdtemp()) / "bank.json"
        noisy_path.write_text(json.dumps(noisy), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            graded = main(["--bank", str(noisy_path), "--max-usd", "1"])
        check("a material that rescues every refusal is graded", graded == 0, str(graded))

        # A budget that runs out before the answer is a P0 failure and exit 2: the model never wrote, so nothing
        # about the material was measured. This is the state R208's 85 failures were actually in.
        truncated = _types.ModuleType("litellm")
        truncated.completion = lambda **kwargs: reply("", finish="length", completion_tokens=96)
        sys.modules["litellm"] = truncated
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            cut = main(["--bank", str(noisy_path), "--limit", "2", "--max-usd", "1"])
        check("a truncated reading cannot measure", cut == 2, str(cut))
        check("a truncation is not a refusal",
              measure([{"task": "5", "trial": 0, "reward": 0.0, "verdictText": "REWARD 0",
                        "materials": {name: {"sentence": "", "state": "truncated", "promptChars": 100,
                                             "usage": {}} for name in MATERIALS}}])["p2"]["declined"] == 0)

        always_refused = _types.ModuleType("litellm")
        always_refused.completion = lambda **kwargs: reply("NONE")
        sys.modules["litellm"] = always_refused
        with contextlib.redirect_stdout(io.StringIO()) as text, contextlib.redirect_stderr(io.StringIO()):
            refused = main(["--bank", str(noisy_path), "--limit", "2", "--max-usd", "1"])
        check("a material that rescues nothing is refuted", refused == 1, str(refused))
        check("the limit bounds the population", "2 failure(s)" in text.getvalue(), text.getvalue()[:80])
    finally:
        del sys.modules["litellm"]

    # The command line, which is what the workflow runs.
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "bank.json"
        path.write_text(json.dumps(bank), encoding="utf-8")
        out = Path(directory) / "reading.json"
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            code = main(["--bank", str(path), "--dry-run", "--json", str(out)])
        check("a dry run reads the bank and bills nothing", code == 0, str(code))
        check("a dry run writes the reading when asked", json.loads(out.read_text())["failures"] == 2,
              out.read_text()[:120])
        check("a reading carries no notes unless asked", "notes" not in json.loads(out.read_text()))
        with contextlib.redirect_stdout(io.StringIO()):
            main(["--bank", str(path), "--dry-run", "--keep-notes", "--json", str(out)])
        kept = json.loads(out.read_text())["notes"]
        check("the notes are kept when asked", len(kept) == 2 and "evaluator" in kept[0], str(kept[:1]))
        check("a dry run's note is empty", kept[0]["attempt"] == "", str(kept[0]))
        # A reading can be re-measured without re-billing: only P3 is recomputed, and the calls stay the ones the
        # reading paid for. A measure that changes should not cost another dispatch to test.
        previous = {"failures": 2, "materials": {}, "tokens": {}, "p1": {"pass": True}, "p2": {"pass": True},
                    "p4": {"pass": True}, "p0": {"pass": True},
                    "bars": [{"name": name, "pass": True, "reading": {}} for name in ("P0", "P1", "P2", "P4")],
                    "notes": [{"task": "5", "trial": 0, "attempt": "Call cancel_order_5.",
                               "verdict": "Cancel order 5 with cancel_order_5.",
                               "evaluator": "REWARD 0\nACTION not met: cancel_order_5"},
                              {"task": "9", "trial": 0, "attempt": "Check the reward.",
                               "verdict": "Call cancel_order_9.", "evaluator": ""}]}
        reading_path = Path(directory) / "previous.json"
        reading_path.write_text(json.dumps(previous), encoding="utf-8")
        recomputed_path = Path(directory) / "recomputed.json"
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["--from-reading", str(reading_path), "--json", str(recomputed_path)])
        recomputed = json.loads(recomputed_path.read_text())
        check("a reading is recomputed without a provider", code == 0, str(code))
        check("the recomputed reading says so", "P3" in str(recomputed.get("recomputed")), str(recomputed.get("recomputed")))
        check("the other bars are the reading's own",
              [bar["name"] for bar in recomputed["bars"]] == ["P0", "P1", "P2", "P3", "P4"],
              str([bar["name"] for bar in recomputed["bars"]]))
        check("P3 is recomputed over the kept notes", recomputed["p3"]["attempt"]["graded"] == 2,
              str(recomputed["p3"]))
        with contextlib.redirect_stderr(io.StringIO()):
            bare = Path(directory) / "bare.json"
            bare.write_text(json.dumps({"notes": []}), encoding="utf-8")
            check("a reading with no notes is refused", main(["--from-reading", str(bare)]) == 2)
            check("a missing reading exits 2", main(["--from-reading", str(Path(directory) / "gone.json")]) == 2)
        check("a dry run calls no provider",
              json.loads(out.read_text())["materials"]["verdict"]["dry"] == 2
              and json.loads(out.read_text())["tokens"]["verdict"]["prompt"] == 0,
              out.read_text()[:200])
        with contextlib.redirect_stderr(io.StringIO()):
            check("a missing bank exits 2", main(["--bank", str(Path(directory) / "nope.json")]) == 2)
            check("neither a bank nor the self-test is refused", main([]) == 2)
            empty = Path(directory) / "empty.json"
            empty.write_text(json.dumps({"simulations": [simulation("5", 1.0)]}), encoding="utf-8")
            check("a saturated bank exits 2", main(["--bank", str(empty)]) == 2)
            # The budget gate, driven with a ceiling no job could meet: the refusal has to happen before the first
            # call, so a dry run is enough to prove it and nothing is billed to prove it.
            check("a job over its ceiling is refused before the first call",
                  main(["--bank", str(path), "--dry-run", "--max-usd", "0.0000001"]) == 2)

    # The suite's own failure path, driven deliberately: a case whose condition is false must reach the list, or
    # this file's green would mean nothing.
    probe = len(failed)
    check("a case that must not pass (deliberate)", False, "expected, and required to be recorded")
    check("the suite records a failure", len(failed) == probe + 1)
    del failed[probe:]
    # The reporter's own two answers, which is the only way this file's exit code can be trusted: a suite that
    # cannot fail is a suite whose green means nothing.
    with contextlib.redirect_stdout(io.StringIO()):
        check("a failing suite exits 1", _report(1, ["deliberate"]) == 1)
        check("a clean suite exits 0", _report(1, []) == 0)

    return _report(checks, failed)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
