"""The command record, read for the loop that the refusal trigger cannot see.

R194 answered **every** refused turn and still lost the two games it fired on most, because a model that
invents objects is not always refused: it walks back to the same receptacle, opens the same drawer and looks
at the same shelf, all of it admitted, none of it progress. The refusal trigger is blind to that by
construction -- it fires on the world's verdict, and the world says yes. The question this file answers costs
nothing: **in the games that were lost, was there a turn on which the model re-issued a command the world had
already accepted?** If there was, a cycle-aware line has somewhere to fire; if there was not, the next
dispatch would buy a treatment with no purchase on the corpus and the answer is worth ¥0 rather than ¥1.4.

**What it reads, and why only that.** Every episode the driver writes after R194 carries `commands` (the
commands that were *attempted*, refusals included) and `fire_turns` (the index of the command each line
answered). Those two fields are enough to reconstruct, per turn, whether the command had been issued before
and whether the world accepted it -- and nothing else is read, so the reading cannot quietly become a
re-reading of the win column. `len(commands) == actions + refused_actions` and `len(fire_turns) ==
ledger_fires` are checked because a record that disagrees with the counters beside it is a record whose
arithmetic nobody can trust.

**The identity the reading stands on.** A turn counts as *accepted* when no fire answered it, so the reader
needs `fire_turns` to be exactly the refused turns. In this corpus that is a measured fact rather than an
assumption -- across the 822 armed games of R191 and R193, `ledger_fires` equals `invalid_actions` on every
one (AUDIT 34.284) -- so the reader **refuses** a slice where the two disagree instead of reporting a repeat
count built on an unknown verdict. A refusal here is information: it says a refusal went unanswered, which is
a fact about the renderer that a fire count alone would have hidden.

**Three measures, because "a repeat" is not one thing.** A *repeat* is any turn whose command appeared
earlier; an *accepted repeat* is one the world did not refuse, which is the only kind a refusal-triggered
line cannot see. A *chain* is the same command `k` turns apart for consecutive turns (`go to countertop 1`,
`look`, `go to countertop 1`, `look`), which is the shape a two-room loop takes and which a repeat count
undercounts. The price is the rendered line's characters, summed, because the whole family is priced per
character and an unpriced proposal is the failure AUDIT 34.282 records twice.

Usage:
  cycles.py arm-0.json arm-1.json                 # the reading
  cycles.py arm-0.json --detail                    # one row per game that repeated anything
  cycles.py arm-0.json --json                      # the same numbers, for a document

Exit codes are the report: 0 the reading is written, 2 the slice cannot support one.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LINE = 'Again: "{command}" ({ordinal} time).'
SUFFIXES = {1: "st", 2: "nd", 3: "rd"}


class Refused(Exception):
    """A slice this reader will not turn into a number, carrying the sentence a reader needs to fix it."""


def ordinal(count: int) -> str:
    """`2nd`, `3rd`, `11th`: the occurrence's name, so the line says how long the loop has run.

    The teens are the case a suffix table gets wrong -- `11st` is what a rule keyed on the last digit alone
    produces -- so they are handled before the digit lookup rather than after it.
    """
    if 10 <= count % 100 <= 19:
        return f"{count}th"
    return f"{count}{SUFFIXES.get(count % 10, 'th')}"


def line_for(command: str, count: int) -> str:
    """The line a cycle trigger would send, which is also its price: the template is the whole cost model."""
    return LINE.format(command=command, ordinal=ordinal(count))


def refused_turns(episode: dict) -> "set[int]":
    """The turns a line answered, which the identity below ties to the world's own verdict."""
    return set(episode["fire_turns"])


def accepted_repeats(commands: "list[str]", refused: "set[int]") -> "list[tuple[int, int]]":
    """Every turn that re-issued an accepted command, with the occurrence number of that command.

    A repeat whose *earlier* occurrence was refused is excluded for free: the world's verdict on a command
    does not depend on when it is asked, so such a turn is refused too and therefore is in `refused`.
    """
    seen: "dict[str, int]" = {}
    repeats = []
    for turn, command in enumerate(commands):
        seen[command] = seen.get(command, 0) + 1
        if seen[command] > 1 and turn not in refused:
            repeats.append((turn, seen[command]))
    return repeats


def longest_run(commands: "list[str]", period: int) -> int:
    """The longest stretch of consecutive turns that repeat the command `period` turns earlier.

    A confirmation is counted only when the turn is not a stall: `a a a` repeats two turns earlier on every
    turn after the first, and a stall is what `most_repeated` is for. The number is **confirmations**, not the
    window's length, because that is the count a reader can check against the record: a period-2 chain of 2
    confirmations is three commands long, and saying so costs a sentence rather than an off-by-one.
    """
    best = 0
    run = 0
    for index in range(period, len(commands)):
        differs = any(commands[index] != commands[index - back] for back in range(1, period))
        if commands[index] == commands[index - period] and differs:
            run += 1
        else:
            run = 0
        best = max(best, run)
    return best


def commands_of(episode: dict) -> "list[str]":
    """The record, refused unless it says what it claims to say.

    The three checks are the ones whose failure would otherwise produce a number rather than an error: a
    record that predates the field, a record whose length disagrees with the counters that were written
    beside it, and a record whose fires are not the refusals this reader treats them as.
    """
    game = episode.get("gamefile", "?")
    commands = episode.get("commands")
    if not isinstance(commands, list) or not all(isinstance(item, str) and item for item in commands):
        raise Refused(
            f"{game} carries no command record (or a malformed one), so its repeats cannot be read; "
            "only episodes written after the record was added carry it"
        )
    fires = episode.get("fire_turns")
    if not isinstance(fires, list) or not all(isinstance(item, int) for item in fires):
        raise Refused(f"{game} carries no fire record, so no turn can be called accepted")
    if len(fires) != episode.get("ledger_fires"):
        raise Refused(
            f"{game} records {len(fires)} fires against ledger_fires={episode.get('ledger_fires')}, "
            "so the two counts of the same event disagree"
        )
    if "invalid_actions" in episode and len(fires) != episode["invalid_actions"]:
        raise Refused(
            f"{game} records {len(fires)} fires against {episode['invalid_actions']} refusals, so a fire is "
            "not a refusal here and this reader cannot tell an accepted turn from a refused one (AUDIT 34.284)"
        )
    if len(commands) != episode.get("actions", 0) + episode.get("refused_actions", 0):
        raise Refused(
            f"{game} records {len(commands)} commands against "
            f"{episode.get('actions')} actions + {episode.get('refused_actions')} refusals"
        )
    if fires != sorted(set(fires)) or any(not 0 <= turn < len(commands) for turn in fires):
        raise Refused(f"{game} records fire turns {fires} against {len(commands)} commands; they must be increasing")
    return commands


def read(episodes: "list[dict]") -> dict:
    """The slice's reading: how much of the corpus repeats an accepted command, and what naming it costs."""
    if not episodes:
        raise Refused("there is nothing to read")
    games = [episode.get("gamefile", "?") for episode in episodes]
    duplicated = sorted({game for game in games if games.count(game) > 1})
    if duplicated:
        raise Refused(f"{duplicated[:3]} appear in more than one slice, so a repeat would be counted twice")

    rows = []
    for episode in episodes:
        commands = commands_of(episode)
        refused = refused_turns(episode)
        repeats = accepted_repeats(commands, refused)
        rows.append(
            {
                "game": episode.get("gamefile", "?"),
                "won": bool(episode.get("won")),
                "commands": len(commands),
                "refused": len(refused),
                "accepted_repeats": len(repeats),
                "chars": sum(len(line_for(commands[turn], count)) + 1 for turn, count in repeats),
                "period_two": longest_run(commands, 2),
                "period_three": longest_run(commands, 3),
                "most_repeated": max([commands.count(command) for command in set(commands)] or [0]),
                "sample": line_for(commands[repeats[0][0]], repeats[0][1]) if repeats else "",
            }
        )

    repeats = sum(row["accepted_repeats"] for row in rows)
    lost = [row for row in rows if not row["won"]]
    lost_with = [row for row in lost if row["accepted_repeats"]]
    return {
        "episodes": len(rows),
        "won": len(rows) - len(lost),
        "lost": len(lost),
        "commands": sum(row["commands"] for row in rows),
        "refused": sum(row["refused"] for row in rows),
        "accepted_repeats": repeats,
        "games_with_repeat": len([row for row in rows if row["accepted_repeats"]]),
        "lost_with_repeat": len(lost_with),
        "repeat_share": 100.0 * repeats / sum(row["commands"] for row in rows) if rows else 0.0,
        "headroom": 100.0 * len(lost_with) / len(lost) if lost else 0.0,
        "chars": sum(row["chars"] for row in rows),
        "chars_per_line": sum(row["chars"] for row in rows) / repeats if repeats else 0.0,
        "longest_period_two": max([row["period_two"] for row in rows] or [0]),
        "longest_period_three": max([row["period_three"] for row in rows] or [0]),
        "most_repeated": max([row["most_repeated"] for row in rows] or [0]),
        "sample": next((row["sample"] for row in rows if row["sample"]), ""),
        "rows": rows,
    }


def load(paths: "list[str]") -> "list[dict]":
    """Every episode in every slice, refused when a file is not an arm's artefact."""
    episodes = []
    for path in paths:
        try:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise Refused(f"{path} is not an arm artefact: {error}") from error
        if not isinstance(payload, dict) or not isinstance(payload.get("episodes"), list):
            raise Refused(f"{path} has no episodes list, so it is not an arm's artefact")
        episodes.extend(payload["episodes"])
    return episodes


def report(reading: dict) -> "list[str]":
    """The reading as the lines a document quotes, one fact each."""
    lines = [
        f"episodes {reading['episodes']:,}  won {reading['won']:,}  lost {reading['lost']:,}",
        f"commands {reading['commands']:,}  refusals {reading['refused']:,}",
        f"accepted repeats {reading['accepted_repeats']:,} ({reading['repeat_share']:.2f}% of commands)  "
        f"games with one {reading['games_with_repeat']:,} ({100.0 * reading['games_with_repeat'] / reading['episodes']:.1f}%)",
        f"headroom {reading['lost_with_repeat']:,} of {reading['lost']:,} losses "
        f"({reading['headroom']:.1f}%) carried an accepted repeat",
        f"price {reading['chars']:,} characters over "
        f"{reading['accepted_repeats']:,} lines ({reading['chars_per_line']:.1f} chars/line)",
        f"chains {reading['longest_period_two']} turns repeating two back, "
        f"{reading['longest_period_three']} three back, most repeated {reading['most_repeated']}",
    ]
    if reading["sample"]:
        lines.append(f"sample line {reading['sample']}")
    return lines


def detail(reading: dict) -> "list[str]":
    """One row per game that repeated an accepted command, worst first: the corpus's own shortlist."""
    rows = [row for row in reading["rows"] if row["accepted_repeats"]]
    rows.sort(key=lambda row: (-row["accepted_repeats"], row["game"]))
    return [
        f"{'game':<56} {'won':>3} {'cmds':>4} {'rep':>3} {'p2':>3} {'p3':>3} {'chars':>5}"
    ] + [
        f"{row['game'][-56:]:<56} {str(row['won']):>3} {row['commands']:>4} {row['accepted_repeats']:>3} "
        f"{row['period_two']:>3} {row['period_three']:>3} {row['chars']:>5}"
        for row in rows
    ]


def main(argv: "list[str] | None" = None) -> int:
    parser = argparse.ArgumentParser(description="Read the command record for accepted repeats")
    parser.add_argument("input", nargs="+", help="arm artefacts, one per shard")
    parser.add_argument("--detail", action="store_true", help="one row per game that repeated a command")
    parser.add_argument("--json", action="store_true", help="the reading as JSON, without the rows")
    arguments = parser.parse_args(argv)
    try:
        reading = read(load(arguments.input))
    except Refused as refusal:
        sys.stderr.write(f"{refusal}\n")
        return 2
    if arguments.json:
        print(json.dumps({key: value for key, value in reading.items() if key != "rows"}, indent=2, sort_keys=True))
        return 0
    for line in report(reading):
        print(line)
    if arguments.detail:
        for line in detail(reading):
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
