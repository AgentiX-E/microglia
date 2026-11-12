#!/usr/bin/env python3
"""Record-length census over the tau2 retail corpus, with no model call and no store.

R85 wrote twelve records, clipped all twelve at 700 characters, and kept 58 of 137 entity
values (42.34%). That reading says the ceiling cut the text. It does not say how much larger
the ceiling would have to be, which is the only question the next dispatch needs answered, and
answering it by trying a bigger number and paying for another evaluation would be guessing with
extra steps. This tool answers it from the corpus: it rebuilds each task's record the way
`rawLogStatement` builds one (`Q:` the instruction, `A:` the gold calls rendered by
`renderCall`), measures the length distribution, and reports what a given ceiling would keep.

## Two limits, stated before any number is used

**The reconstruction is a lower bound on length.** R85's records also carried a `note:` line --
the correction's own statement -- which this census cannot rebuild because the statements lived in
the run and not in the artefact. So the real records are somewhat longer than the ones measured
here, and a ceiling chosen at this corpus's maximum is a ceiling with no margin for that line.

**`faithfulness` is weaker on a lexical record than on an abstracted claim, and this census is how
that showed up.** At 700 the census keeps 64.53% of entity values while R85 kept 42.34%, and the
gap is not the missing `note:` line -- it is that an entity value quoted in the question (`order
#W2378156`) is *also* the argument of the gold call, so it survives a slice that removed the whole
`A:` line. The instrument asks "does the store's text for this run contain the value", and for a
record whose first line is the question the answer is yes more often than the detail survived. That
does not make the metric wrong -- it makes it an upper bound on preservation for this unit, which is
worth knowing before it is used to acquit or convict a ceiling.

**A ceiling is per domain, and the two domains differ by a factor of two.** Measured at v0.2.0:

| domain | tasks | p50 | p95 | max | clipped at 2000 |
| --- | --- | --- | --- | --- | --- |
| retail | 114 | 744 | 1260 | 1532 | 0 |
| airline | 50 | 684 | 1899 | **3129** | 2 (4%) |

So 2000 is right for R88 and wrong for the airline arm that would transfer it: an itinerary with
three legs renders a call list twice retail's length, and the ceiling has to be measured on the
domain the arm will serve rather than borrowed from the one it was tuned on. This is the same defect
as the 700 it replaced, one level up -- the constant was inherited from a *unit*, and it would be
inherited from a *domain* next. `rawCeiling` is a registration header precisely so the number travels
with the experiment that measured it.

Usage:

    python3 eval/tools/record_length_census.py --tasks data/tau2/domains/retail/tasks.json
    python3 eval/tools/record_length_census.py --self-test
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys

# The entity rule `tau2-faithfulness.ts` uses: a correction's own argument values, at least
# three characters and at most sixty-four, deduplicated per correction.
ENTITY_MIN = 3
ENTITY_MAX = 64


def render_value(value: object) -> str:
    """`JSON.stringify` as the TypeScript renderer calls it."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value, ensure_ascii=False)


def render_call(action: dict) -> str:
    name = action.get("name") if isinstance(action.get("name"), str) else ""
    arguments = action.get("arguments")
    if not isinstance(arguments, dict):
        return name
    if not arguments:
        return f"{name}()"
    pairs = ", ".join(f"{key}={render_value(value)}" for key, value in arguments.items())
    return f"{name}({pairs})"


def instruction_of(task: dict) -> str:
    """`reason_for_call` then `task_instructions`, which is what `instructionOf` joins."""
    instructions = (task.get("user_scenario") or {}).get("instructions") or {}
    parts = [instructions.get("reason_for_call"), instructions.get("task_instructions")]
    return " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())


def calls_of(task: dict) -> list[str]:
    actions = (task.get("evaluation_criteria") or {}).get("actions") or []
    return [render_call(action) for action in actions if isinstance(action, dict)]


def flatten(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(flatten(item))
        return out
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [str(value)]
    return []


def entities_of(task: dict) -> list[str]:
    """The argument values a correction carries, by the faithfulness module's rule."""
    seen: list[str] = []
    for action in (task.get("evaluation_criteria") or {}).get("actions") or []:
        if not isinstance(action, dict):
            continue
        for value in (action.get("arguments") or {}).values():
            for text in flatten(value):
                if ENTITY_MIN <= len(text) <= ENTITY_MAX and text not in seen:
                    seen.append(text)
    return seen


def statement_of(task: dict) -> str:
    lines = []
    question = instruction_of(task)
    if question:
        lines.append(f"Q: {question}")
    calls = calls_of(task)
    if calls:
        lines.append(f"A: {'; '.join(calls)}")
    return "\n".join(lines)


def keep_at(text: str, entities: list[str], ceiling: int) -> tuple[int, int]:
    """How many entity values survive a head-slice at `ceiling`, and the full length."""
    clipped = text if len(text) <= ceiling else text[: ceiling - 2] + " …"
    lowered = clipped.lower()
    kept = sum(1 for entity in entities if entity.lower() in lowered)
    return kept, len(text)


def percentile(values: list[int], share: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def sweep(tasks: list[dict], ceilings: list[int]) -> dict[int, tuple[float, int]]:
    """Kept share and clipped count at each ceiling, over the same population."""
    out: dict[int, tuple[float, int]] = {}
    statements = [statement_of(task) for task in tasks]
    entities = [entities_of(task) for task in tasks]
    for ceiling in ceilings:
        kept = 0
        total = 0
        clipped = 0
        for statement, here in zip(statements, entities):
            if statement == "":
                continue
            if len(statement) > ceiling:
                clipped += 1
            share, _ = keep_at(statement, here, ceiling)
            kept += share
            total += len(here)
        out[ceiling] = (kept / total if total else 0.0, clipped)
    return out


FIXTURE = [
    {
        "id": "0",
        "user_scenario": {
            "instructions": {
                "reason_for_call": "You received your order #W2378156 and want an exchange.",
                "task_instructions": "Be concise.",
            }
        },
        "evaluation_criteria": {
            "actions": [
                {
                    "name": "get_order_details",
                    "arguments": {"order_id": "#W2378156"},
                },
                {
                    "name": "exchange_delivered_order_items",
                    "arguments": {"order_id": "#W2378156", "item_ids": ["1151293680"]},
                },
            ]
        },
    }
]


def self_test() -> int:
    """The five properties the numbers rest on, asserted rather than assumed."""
    cases: list[tuple[str, bool, str]] = []

    statement = statement_of(FIXTURE[0])
    cases.append(
        (
            "the record opens with the question, which is the half a lexical retriever matches",
            statement.startswith("Q: You received your order #W2378156"),
            statement.split("\n")[0],
        )
    )
    cases.append(
        (
            "arguments are rendered as renderCall does, lists included",
            'exchange_delivered_order_items(order_id="#W2378156", item_ids=["1151293680"])'
            in statement,
            statement.split("\n")[1],
        )
    )
    entities = entities_of(FIXTURE[0])
    cases.append(
        (
            "an entity is an argument value inside the length window, deduplicated",
            sorted(entities) == sorted(["#W2378156", "1151293680"]),
            str(entities),
        )
    )

    # The census's central caveat, asserted so it cannot be forgotten: the order id is in the
    # question, so it survives a slice that removes the whole answer line.
    cut = statement[: statement.index("\n") + 2]
    kept, _ = keep_at(cut, entities, len(cut))
    cases.append(
        (
            "a value quoted in the question survives the slice that removed the answer",
            kept == 1,
            f"{kept} of {len(entities)} kept from the question line alone",
        )
    )

    lengths = [len(statement_of(task)) for task in FIXTURE]
    cases.append(
        (
            "percentile is over the population it was given",
            percentile(lengths, 0.5) == lengths[0],
            f"p50={percentile(lengths, 0.5)}",
        )
    )

    failures = 0
    for label, ok, detail in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}  ({detail})" if not ok else f"  PASS  {label}")
        if not ok:
            failures += 1
    print(f"self-test: {len(cases) - failures}/{len(cases)} cases")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="record length census")
    parser.add_argument("--tasks", help="path to tau2 retail tasks.json")
    parser.add_argument("--ceiling", type=int, default=700, help="the ceiling to grade")
    parser.add_argument(
        "--sweep",
        default="700,1000,1500,2000,3000,4000,6000",
        help="comma-separated ceilings to report the kept share at",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.tasks:
        print("census: --tasks is required unless --self-test", file=sys.stderr)
        return 2

    with open(args.tasks, encoding="utf-8") as handle:
        tasks = json.load(handle)

    statements = [statement_of(task) for task in tasks]
    lengths = [len(text) for text in statements if text != ""]
    if not lengths:
        print("census: no record could be rebuilt from this corpus", file=sys.stderr)
        return 2

    populated = [task for task in tasks if statement_of(task) != ""]
    graded = sweep(populated, [args.ceiling])[args.ceiling]
    print(f"tasks                    {len(lengths)}")
    print(
        "record length  min/p50/p90/p95/max  "
        f"{min(lengths)} / {percentile(lengths, 0.5)} / {percentile(lengths, 0.9)} / "
        f"{percentile(lengths, 0.95)} / {max(lengths)}"
    )
    print(f"mean length              {statistics.mean(lengths):.0f}")
    share, clipped = graded
    print(f"clipped at {args.ceiling:<5}          {clipped} of {len(lengths)} "
          f"({clipped / len(lengths):.1%})")
    print(f"entity values kept       {share:.2%}  (an upper bound: the question quotes entities)")
    print()
    print("ceiling sweep (head-slice, as the arm clips):")
    table = sweep(populated, [int(text) for text in args.sweep.split(",") if text.strip()])
    for ceiling in sorted(table):
        kept, cut = table[ceiling]
        print(
            f"  {ceiling:>5}  kept {kept:6.2%}  clipped {cut:3d} of {len(lengths)} "
            f"({cut / len(lengths):5.1%})"
        )

    longest = max(populated, key=lambda task: len(statement_of(task)))
    print()
    print(f"longest record           {longest.get('id')} at {len(statement_of(longest))} characters")
    print("the ceiling has to clear that plus the `note:` line the run also wrote")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
