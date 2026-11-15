"""R125 — the per-turn census, read from a phase's own trajectories.

## Why the unit had to move

`l4-paired` compares **tasks**, and retail ships forty of them in the published split. Forty tasks give a
standard error of 7.76pp on a paired difference, so a 10pp effect sits at `z = 1.29` and the minimum
detectable difference this lane has actually reported is 25.26pp. Buying trials does not help: six trials on
forty tasks is still forty tasks, and the record has now paid twice to learn that (R124's 26.21pp, R123a's
14.01pp). Buying tasks does not help either — 114 give 4.60pp and 300 are needed.

What *is* affordable is per-turn behaviour. A phase of 160 episodes records 1,813 assistant turns, and a
memory that induces a wrong action shows up in them as a call that came back in error, as the same call made
twice with the same arguments, and as the user turn that follows either. Those messages are already in the
document the runner writes; reading them costs no model call.

## What this module refuses to do

**It does not turn an unread phase into a zero.** Every branch that cannot see the input returns `None`
rather than a count, because `toolErrors: 0` must mean *the tools answered and none failed* and not *this
release stopped serialising the flag*. The record has repaired that collapse nine times, and the census is
built to be the tenth occasion it cannot happen: `toolResultsWithFlag` is the denominator, and when it is
zero the numerator is `None`.

**It does not invent a repetition.** Two calls to the same tool are a repeat only when their argument
payloads are identical *and* both payloads were readable. A call whose arguments this reader could not see
would otherwise collapse to its name, and `retail` would look like an agent that calls `get_order_details`
twice on every episode.

No imports beyond the standard library, so the self-check that exercises this reader can run without a
provider, a harness, or a network.
"""

from __future__ import annotations

import json


def field(item, name, default=None):
    """One attribute of a message, whether it arrives as an object or as the JSON that crossed a socket."""
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def call_key(call) -> tuple[str, str, bool]:
    """One tool call as `(name, canonical arguments, had readable arguments)`.

    The third element is why this is a triple. A call whose payload is missing is excluded from the
    repetition population and counted separately, which is the same rule the pack applies to a shape it
    cannot name: an unnameable unit is not a unit that recurred.
    """
    name = field(call, "name")
    if not isinstance(name, str) or name.strip() == "":
        return ("", "", False)
    arguments = field(call, "arguments")
    if isinstance(arguments, str):
        return (name.strip(), arguments, True)
    if isinstance(arguments, dict):
        try:
            return (name.strip(), json.dumps(arguments, sort_keys=True), True)
        except (TypeError, ValueError):
            pairs = sorted(((str(key), repr(value)) for key, value in arguments.items()))
            return (name.strip(), repr(pairs), True)
    return (name.strip(), "", False)


def turn_row(simulation) -> dict | None:
    """One episode's counts, or `None` when this episode's messages were not readable."""
    reader = field(simulation, "get_messages")
    if not callable(reader):
        messages = field(simulation, "messages")
        if not isinstance(messages, list):
            return None
    else:
        try:
            messages = reader()
        except Exception:  # noqa: BLE001 - upstream shape, not our error
            return None
    if not messages:
        return None

    assistant = 0
    user = 0
    user_after_action = 0
    user_after_error = 0
    tool_calls = 0
    tool_results = 0
    flagged = 0
    tool_errors = 0
    repeat_calls = 0
    argless = 0
    saw_action = False
    saw_error = False
    seen: set[tuple[str, str]] = set()

    for message in messages:
        role = field(message, "role")
        # A user message that follows the agent's first action is a turn the simulator took *in reaction*
        # to it. Counting all user messages would fold the opening instruction into the same number and
        # make `userAfterError` a share of a population no error can precede.
        if role in ("user", "human"):
            user += 1
            if saw_action:
                user_after_action += 1
            if saw_error:
                user_after_error += 1
            continue
        if role in ("assistant", "agent"):
            assistant += 1
            for call in field(message, "tool_calls") or []:
                tool_calls += 1
                saw_action = True
                name, key, readable = call_key(call)
                if name == "":
                    continue
                if not readable:
                    argless += 1
                    continue
                pair = (name, key)
                if pair in seen:
                    repeat_calls += 1
                else:
                    seen.add(pair)
            continue
        if role == "tool":
            tool_results += 1
            # `error` is a field upstream always serialises. Counting the results that carried it is what
            # separates "no tool failed" from "this release stopped saying", and only the first is a
            # measurement.
            if hasattr(message, "error") or (isinstance(message, dict) and "error" in message):
                flagged += 1
                if field(message, "error") is True:
                    tool_errors += 1
                    saw_error = True

    return {
        "task": str(field(simulation, "task_id", "") or ""),
        "trial": int(field(simulation, "trial", 0) or 0),
        "assistant": assistant,
        "user": user,
        "userAfterAction": user_after_action,
        "userAfterError": user_after_error,
        "toolCalls": tool_calls,
        "toolResults": tool_results,
        "toolResultsWithFlag": flagged,
        "toolErrors": tool_errors if flagged else None,
        "repeatCalls": repeat_calls,
        "callsWithoutArguments": argless,
    }


def turn_census(simulations) -> dict:
    """The phase's totals beside the per-episode rows the paired reading joins on.

    `episodes` counts what the phase ran and `measurable` counts what this reader could see. A phase that
    recorded 160 and measured 0 has an instrument that never reached the document — a different finding from
    a run without tool errors, and the reason both numbers travel.
    """
    rows = []
    episodes = 0
    for simulation in simulations or []:
        episodes += 1
        row = turn_row(simulation)
        if row is not None:
            rows.append(row)
    flagged = sum(row["toolResultsWithFlag"] for row in rows)
    return {
        "episodes": episodes,
        "measurable": len(rows),
        "toolErrors": sum(row["toolErrors"] or 0 for row in rows) if flagged else None,
        "toolResultsWithFlag": flagged,
        "toolCalls": sum(row["toolCalls"] for row in rows),
        "toolResults": sum(row["toolResults"] for row in rows),
        "repeatCalls": sum(row["repeatCalls"] for row in rows),
        "callsWithoutArguments": sum(row["callsWithoutArguments"] for row in rows),
        "userAfterAction": sum(row["userAfterAction"] for row in rows),
        "userAfterError": sum(row["userAfterError"] for row in rows),
        "assistant": sum(row["assistant"] for row in rows),
        "rows": rows,
    }
