#!/usr/bin/env python3
"""What a served material costs, split into the two things it can do.

`rescue_rate` answers "did an attempt after a failure pass more often", and R212 answered it 12/30 against
13/34: a wash. A rate that nets two opposite movements cannot say whether the material did nothing or
whether it repaired some checks and broke others, and the question this lane has to answer is not "did it
help" but "did it hurt" — the user's hypothesis, and the one the aggregate rate is blind to.

Every attempt is scored on a fixed set of *requirements* (a database match, the named actions, the
assertions, the communicated facts). Those are countable, they are the same set across attempts of one
task, and they move independently. A note is supposed to repair the ones the attempt missed, so:

    repair   an unmet requirement that the next attempt meets
    persist  an unmet requirement that stays unmet
    break    a **met** requirement that the next attempt misses

`break` is the harm. It has no name in a pass/fail reading, because a single break turns the episode into
a failure and the number that appears is the same one a rescue would have moved.

Three readings come out of the same documents:

1. **the turnover** — repair and break, with the denominators they belong to (unmet at j, met at j). This is
   ~85 and ~330 observations per arm against the rescue rate's 30, which is the only reason a 24-task grid
   can resolve anything at all.
2. **the naming association** — of the requirements an attempt missed, how many does the note it wrote
   actually mention, and are the mentioned ones repaired more often? This is the difference between "the
   material is bad" and "the material is pointed at the wrong requirement".
3. **the admission bar** — `breaks / (repairs + breaks)`. A gate that admits only the cases memory helps
   has to beat this precision, because a repair admitted and a break admitted are the same decision. When
   the bar sits a few points above the base repair rate, no filter can pay for itself and the defect is the
   material rather than the selection (AUDIT 34.212).

Nothing here calls a model. Every field is in the artefacts a paid run already wrote.
"""

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rescue_rate import documents_of, fisher_two_sided, merge  # noqa: E402

#: Words that carry no requirement. Kept short and closed on purpose: an open list would make the naming
#: association a function of the list rather than of the note, and the reading has to be recomputable by
#: someone who disagrees with the list.
STOP = frozenset(
    """a an the and or of to in on for with by is are was were be been being as at from that this these those
    it its should agent user both all any if then than not no do does did done can could will would may might
    must have has had before after instead then only every each other another same""".split()
)

#: The shortest useful requirement word. Two, not three, because `db` and `id` are requirement tokens: a
#: threshold of three silently made the database requirement unnameable, and a requirement that cannot be named
#: is one the association can never count. The refinement moved exactly one requirement in R212's 82 and is
#: recorded here rather than applied quietly.
MIN_WORD = 2


def content_words(text) -> set:
    """The words a requirement and a note can share. Lowercased, stop words and two-letter tokens removed."""
    return {word for word in re.findall(r"[a-z0-9#]+", (text or "").lower()) if word not in STOP and len(word) >= MIN_WORD}


def checks_of(reward_info) -> "dict[tuple[str, str], bool]":
    """Every requirement the evaluator scored, keyed by what it asks for rather than by this attempt's row.

    The key is the *requirement*, not the instantiation: two attempts that call the same tool with different
    arguments are two attempts at one requirement, and an argument-level key would make the same requirement
    two different ones and the turnover meaningless. Identifiers inside assertion text are left alone — the
    assertion text is stable for a task, and stripping digits would merge "order 3" with "order 30".
    """
    found: "dict[tuple[str, str], bool]" = {}
    if not isinstance(reward_info, dict):
        return found
    database = reward_info.get("db_check") or {}
    if isinstance(database, dict) and database:
        found[("db", "the database rows the request requires")] = bool(database.get("db_match"))
    for check in reward_info.get("action_checks") or []:
        action = (check or {}).get("action") or {}
        name = (action.get("name") or "?").replace("_", " ")
        found[("action", name)] = bool((check or {}).get("action_match"))
    for check in reward_info.get("nl_assertions") or []:
        found[("nl", (check or {}).get("nl_assertion") or "?")] = bool((check or {}).get("met"))
    for check in reward_info.get("communicate_checks") or []:
        found[("communicate", str((check or {}).get("info")))] = bool((check or {}).get("met"))
    for check in reward_info.get("env_assertions") or []:
        text = (check or {}).get("env_assertion") or (check or {}).get("assertion") or "?"
        found[("env", str(text))] = bool((check or {}).get("met"))
    return found


def simulations_of(directory) -> list:
    """Every scored episode under a directory, in one list. A missing directory is no episodes, not a crash."""
    root = Path(directory)
    if not root.is_dir():
        return []
    return list((merge(documents_of(root)) or {}).get("simulations") or [])


def by_task(simulations) -> "dict[str, dict[int, dict]]":
    """Episodes grouped by task and ordered by the declared trial, which is the only order a pair may use."""
    grouped: "dict[str, dict[int, dict]]" = {}
    for simulation in simulations or []:
        task = str(simulation.get("task_id"))
        trial = simulation.get("trial")
        if not isinstance(trial, int) or isinstance(trial, bool):
            continue
        grouped.setdefault(task, {})[trial] = simulation
    return grouped


def reward_of(simulation):
    """The score, or `None` when the attempt was not scored. `None` is not zero: it is not an observation."""
    info = (simulation or {}).get("reward_info") or {}
    reward = info.get("reward")
    return float(reward) if isinstance(reward, (int, float)) and not isinstance(reward, bool) else None


def episode_stats(grouped) -> dict:
    """What a pass/fail reading would say, so the check-level reading has something to disagree with."""
    scored = 0
    passed = 0
    every = 0
    tasks = 0
    for trials in grouped.values():
        rewards = [reward_of(trials[trial]) for trial in sorted(trials)]
        rewards = [reward for reward in rewards if reward is not None]
        if not rewards:
            continue
        tasks += 1
        scored += len(rewards)
        passed += sum(1 for reward in rewards if reward >= 1.0)
        if all(reward >= 1.0 for reward in rewards):
            every += 1
    return {
        "tasks": tasks,
        "episodes": scored,
        "pass1": (passed / scored) if scored else None,
        "passk": (every / tasks) if tasks else None,
        "k": max((len([1 for r in trials.values() if reward_of(r) is not None]) for trials in grouped.values()), default=0),
    }


def pairs_of(grouped) -> list:
    """Every consecutive scored pair, `(task, from_trial, to_trial, left, right)`.

    Consecutive by the declared trial rather than by arrival: a census may be order-blind, a transition may
    not. Pairs over an unscored attempt are dropped, because a requirement that was never scored has no state
    to transition from.
    """
    pairs = []
    for task, trials in grouped.items():
        numbers = sorted(trials)
        for left, right in zip(numbers, numbers[1:]):
            if reward_of(trials[left]) is None or reward_of(trials[right]) is None:
                continue
            pairs.append((task, left, right, trials[left], trials[right]))
    return pairs


def turnover_of(grouped) -> dict:
    """The four ways a requirement can move between two consecutive attempts.

    `broken` is the harm and `repaired` is the benefit; `held` and `persisted` are the denominator each one
    belongs to. A reading that reported only the sum would be reporting the difference of two rates over two
    different populations, which is what the rescue rate already did.
    """
    counts = {"repaired": 0, "broken": 0, "held": 0, "persisted": 0, "pairs": 0}
    for _task, _left, _right, before, after in pairs_of(grouped):
        met_before = checks_of((before or {}).get("reward_info"))
        met_after = checks_of((after or {}).get("reward_info"))
        counts["pairs"] += 1
        for key in set(met_before) & set(met_after):
            if met_before[key] and met_after[key]:
                counts["held"] += 1
            elif met_before[key] and not met_after[key]:
                counts["broken"] += 1
            elif not met_before[key] and met_after[key]:
                counts["repaired"] += 1
            else:
                counts["persisted"] += 1
    unmet_before = counts["repaired"] + counts["persisted"]
    met_before = counts["broken"] + counts["held"]
    counts["repairRate"] = (counts["repaired"] / unmet_before) if unmet_before else None
    counts["breakRate"] = (counts["broken"] / met_before) if met_before else None
    counts["unmetBefore"] = unmet_before
    counts["metBefore"] = met_before
    counts["net"] = counts["repaired"] - counts["broken"]
    return counts


def failed_by(grouped) -> set:
    """The tasks an arm failed at least one attempt of: the population a rescue rate is registered over."""
    return {task for task, trials in grouped.items()
            if any((reward_of(trials[trial]) or 0.0) < 1.0 for trial in trials)}


def rescue_of(grouped, tasks=None) -> dict:
    """Attempts after a failure, and how many of those passed — the R212 estimand, on its own population.

    `tasks` is the registered population (the ones the reference failed), because an opportunity is only an
    opportunity where both arms could observe one. The count is printed beside the rate so the two populations
    R212 reported — 19 tasks and 24 — cannot be confused for one.
    """
    wanted = set(tasks) if tasks is not None else None
    opportunities = 0
    rescued = 0
    for task, _left, _right, before, after in pairs_of(grouped):
        if wanted is not None and task not in wanted:
            continue
        if (reward_of(before) or 0.0) < 1.0:
            opportunities += 1
            rescued += 1 if (reward_of(after) or 0.0) >= 1.0 else 0
    return {"opportunities": opportunities, "rescued": rescued,
            "rate": (rescued / opportunities) if opportunities else None}


def notes_of(directory) -> list:
    """Every note a run wrote, with the round it will be read in and the round it came from.

    `attempt` in a sidecar is the round the note is *read in* (`run_split.note_round` is handed `index + 1`),
    so the attempt it describes is one earlier. Off-by-one here would compare every note with the wrong
    attempt's verdict, which is the mistake this function exists to have made once.
    """
    root = Path(directory)
    records = []
    if not root.is_dir():
        return records
    for path in sorted(root.glob("notes-*.json")):
        if ".trajectories." in path.name:
            continue
        try:
            document = json.loads(path.read_text())
        except Exception:  # noqa: BLE001 - an unreadable sidecar contributes no notes and no crash
            continue
        for key, entry in (document.get("notes") or {}).items():
            if not isinstance(entry, dict):
                continue
            text = entry.get("note")
            if not isinstance(text, str) or text.strip() == "":
                continue
            records.append({
                "task": str(entry.get("task") or ""),
                "read_in": entry.get("attempt"),
                "text": text,
                "key": key,
            })
    return records


def naming_of(records, grouped) -> dict:
    """Of the requirements an attempt missed, how many its own note mentions — and whether that predicts repair.

    A requirement is "named" when the note shares a content word with it. That is a lexical test and it is
    deliberately blunt: an embedding would make the reading depend on a model that changes, and the question
    ("is the note about the thing that failed") survives a blunt test — if a note never writes the words, it
    is not about them.
    """
    counts = {"named": 0, "silent": 0, "repairedNamed": 0, "repairedSilent": 0,
              "notes": 0, "notesNamingSomething": 0, "notesNamingEverything": 0, "unmet": 0}
    for record in records:
        trials = grouped.get(record["task"]) or {}
        read_in = record["read_in"]
        if not isinstance(read_in, int) or read_in - 1 not in trials:
            continue
        source = trials[read_in - 1]
        before = checks_of((source or {}).get("reward_info"))
        unmet = {key for key, met in before.items() if not met}
        if not unmet:
            continue
        counts["notes"] += 1
        counts["unmet"] += len(unmet)
        words = content_words(record["text"])
        named = {key for key in unmet if words & (content_words(key[1]) | set(key[0].split()))}
        counts["notesNamingSomething"] += 1 if named else 0
        counts["notesNamingEverything"] += 1 if len(named) == len(unmet) else 0
        after = trials.get(read_in)
        outcome = checks_of((after or {}).get("reward_info")) if after is not None else {}
        for key in unmet:
            if named and key in named:
                counts["named"] += 1
                counts["repairedNamed"] += 1 if outcome.get(key) else 0
            else:
                counts["silent"] += 1
                counts["repairedSilent"] += 1 if outcome.get(key) else 0
    named, silent = counts["named"], counts["silent"]
    counts["coverage"] = (named / (named + silent)) if (named + silent) else None
    counts["namedRate"] = (counts["repairedNamed"] / named) if named else None
    counts["silentRate"] = (counts["repairedSilent"] / silent) if silent else None
    if named and silent:
        counts["p"] = fisher_two_sided(counts["repairedNamed"], named - counts["repairedNamed"],
                                       counts["repairedSilent"], silent - counts["repairedSilent"])
    else:
        counts["p"] = None
    return counts


def bar_of(turnover) -> dict:
    """The precision an admission gate would need: `breaks / (repairs + breaks)`, against the base repair rate.

    A gate decides case by case, and the two errors are not symmetric: admitting a case memory repairs is the
    win, admitting one it breaks is the harm, and refusing costs the repair it would have had. To be worth
    more than serving everything the gate must find repairs at a rate above the break share — which is why the
    bar is a *share*, not a difference, and why it is computable before any gate exists.
    """
    repaired, broken = turnover["repaired"], turnover["broken"]
    total = repaired + broken
    if total == 0:
        return {"bar": None, "base": None, "headroom": None}
    bar = broken / total
    base = repaired / total
    return {"bar": bar, "base": base, "headroom": base - bar}


def wilson(passed: int, total: int, z: float = 1.96) -> "tuple[float, float] | None":
    """The Wilson score interval for one proportion, which is the input Newcombe's method needs."""
    if total <= 0:
        return None
    proportion = passed / total
    denominator = 1 + z * z / total
    centre = (proportion + z * z / (2 * total)) / denominator
    half = z * math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator
    return max(0.0, centre - half), min(1.0, centre + half)


def newcombe(passed: int, total: int, other_passed: int, other_total: int, z: float = 1.96):
    """The Newcombe hybrid-score interval for the difference of two independent proportions.

    An interval rather than a p-value alone, because the two movements are small and a reader is entitled to
    the range the difference occupies: 3.5 points with an interval spanning zero is a different claim from 3.5
    points with one that does not, and only the second may be quoted as a movement.
    """
    if total <= 0 or other_total <= 0:
        return None
    first, second = passed / total, other_passed / other_total
    left = wilson(passed, total, z)
    right = wilson(other_passed, other_total, z)
    if left is None or right is None:
        return None
    low = (first - second) - math.sqrt((first - left[0]) ** 2 + (right[1] - second) ** 2)
    high = (first - second) + math.sqrt((left[1] - first) ** 2 + (second - right[0]) ** 2)
    return low, high


def compare_of(arm, reference) -> dict:
    """The two movements, each with the exact test its own denominator allows."""
    moved = {
        "repairDelta": None, "repairP": None, "repairCi": None,
        "breakDelta": None, "breakP": None, "breakCi": None,
        "rescueDelta": None, "rescueP": None, "rescueCi": None,
    }
    if arm["turnover"]["unmetBefore"] and reference["turnover"]["unmetBefore"]:
        a, b = arm["turnover"]["repaired"], arm["turnover"]["persisted"]
        c, d = reference["turnover"]["repaired"], reference["turnover"]["persisted"]
        moved["repairDelta"] = (arm["turnover"]["repairRate"] or 0.0) - (reference["turnover"]["repairRate"] or 0.0)
        moved["repairP"] = fisher_two_sided(a, b, c, d)
        moved["repairCi"] = newcombe(a, a + b, c, c + d)
    if arm["turnover"]["metBefore"] and reference["turnover"]["metBefore"]:
        a, b = arm["turnover"]["broken"], arm["turnover"]["held"]
        c, d = reference["turnover"]["broken"], reference["turnover"]["held"]
        moved["breakDelta"] = (arm["turnover"]["breakRate"] or 0.0) - (reference["turnover"]["breakRate"] or 0.0)
        moved["breakP"] = fisher_two_sided(a, b, c, d)
        moved["breakCi"] = newcombe(a, a + b, c, c + d)
    if arm["rescue"]["opportunities"] and reference["rescue"]["opportunities"]:
        a = arm["rescue"]["rescued"]
        b = arm["rescue"]["opportunities"] - a
        c = reference["rescue"]["rescued"]
        d = reference["rescue"]["opportunities"] - c
        moved["rescueDelta"] = (arm["rescue"]["rate"] or 0.0) - (reference["rescue"]["rate"] or 0.0)
        moved["rescueP"] = fisher_two_sided(a, b, c, d)
        moved["rescueCi"] = newcombe(a, a + b, c, c + d)
    return moved


def state_of(arm, moved) -> "tuple[str, str]":
    """One word for the arm, and the sentence that says which null it is.

    Four states, because "no difference" is two different facts: a material that repairs and breaks equally is
    moving work around, and a material that does neither is inert. Only the first is worth a gate.
    """
    repairs = moved.get("repairP")
    breaks = moved.get("breakP")
    repair_up = moved.get("repairDelta") is not None and moved["repairDelta"] > 0 and repairs is not None and repairs < 0.05
    break_up = moved.get("breakDelta") is not None and moved["breakDelta"] > 0 and breaks is not None and breaks < 0.05
    if repair_up and break_up:
        return "BOTH", "the material repairs and breaks at the same time: work moved, net not shown by either"
    if repair_up:
        return "REPAIRS", "the material repairs more than the reference and does not break more"
    if break_up:
        return "BREAKS", "the material breaks more than the reference without repairing more: this is harm"
    if arm["turnover"]["net"] < 0 and (arm["turnover"]["breakRate"] or 0.0) > (0.0 if moved.get("breakDelta") is None else 0.0):
        return "WASH", "no movement either way at this n; the net leans negative and is not resolved"
    return "WASH", "no movement either way at this n"


def render(arms, references, notes) -> str:
    """The reading, as a table a person can argue with."""
    lines = ["### What the material costs, per requirement", ""]
    lines.append("| arm | episodes | tasks | pass^1 | pass^k | rescue | repaired | broken | net |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for name, arm in arms.items():
        stats = arm["stats"]
        rescue = arm["rescue"]
        lines.append(
            f"| {name} | {stats['episodes']} | {stats['tasks']} | "
            f"{_pct(stats['pass1'])} | {_pct(stats['passk'])} (k={stats['k']}) | "
            f"{rescue['rescued']}/{rescue['opportunities']} ({_pct(rescue['rate'])}) | "
            f"{arm['turnover']['repaired']}/{arm['turnover']['unmetBefore']} ({_pct(arm['turnover']['repairRate'])}) | "
            f"{arm['turnover']['broken']}/{arm['turnover']['metBefore']} ({_pct(arm['turnover']['breakRate'])}) | "
            f"{arm['turnover']['net']:+d} |"
        )
    lines.append("")
    lines.append(f"`rescue` is over the {len(references) and arms[next(iter(arms))]['failed']} task(s) the reference "
                 f"failed; `repaired` and `broken` are over every scored pair in the arm.")
    lines.append("")
    for name, moved in references.items():
        arm = arms[name]
        bar = arm["bar"]
        state, sentence = state_of(arm, moved)
        lines.append(f"**{name} against control.** `{state}` — {sentence}.")
        lines.append("")
        lines.append("| movement | arm − control | 95% interval | exact p |")
        lines.append("|---|---|---|---|")
        lines.append(f"| repair rate | {_pp(moved['repairDelta'])} | {_ci(moved['repairCi'])} | {_p(moved['repairP'])} |")
        lines.append(f"| break rate | {_pp(moved['breakDelta'])} | {_ci(moved['breakCi'])} | {_p(moved['breakP'])} |")
        lines.append(f"| rescue rate | {_pp(moved['rescueDelta'])} | {_ci(moved['rescueCi'])} | {_p(moved['rescueP'])} |")
        lines.append(f"| admission bar `breaks/(repairs+breaks)` | {_pct(bar['bar'])} vs base {_pct(bar['base'])} | "
                     f"headroom (base − bar) {_pp(bar['headroom'])} |")
        if bar["headroom"] is not None and bar["headroom"] < 0:
            lines.append("")
            lines.append(f"**The population is net-negative**: the arm broke more requirements than it repaired, so a "
                         f"gate would have to find cases {abs(100 * bar['headroom']):.1f} pp better than the "
                         f"population's own rate before it could invert the sign. That is the quantity R34 asked "
                         f"for on another corpus and measured at a sixth of its ceiling.")
        lines.append("")
    for name, naming in notes.items():
        lines.append(f"**{name}: is the note about what failed?**")
        lines.append("")
        lines.append("| reading | value |")
        lines.append("|---|---|")
        lines.append(f"| requirements named | {naming['named']}/{naming['named'] + naming['silent']} "
                     f"({_pct(naming['coverage'])}) |")
        lines.append(f"| notes naming something / everything | {naming['notesNamingSomething']} / "
                     f"{naming['notesNamingEverything']} of {naming['notes']} |")
        lines.append(f"| repaired when named | {naming['repairedNamed']}/{naming['named']} "
                     f"({_pct(naming['namedRate'])}) |")
        lines.append(f"| repaired when silent | {naming['repairedSilent']}/{naming['silent']} "
                     f"({_pct(naming['silentRate'])}) |")
        lines.append(f"| exact p | {_p(naming['p'])} |")
        lines.append("")
    return "\n".join(lines)


def _pct(value) -> str:
    return "n/a" if value is None else f"{100 * value:.1f}%"


def _pp(value) -> str:
    return "n/a" if value is None else f"{100 * value:+.1f} pp"


def _ci(interval) -> str:
    return "n/a" if interval is None else f"[{100 * interval[0]:+.1f}, {100 * interval[1]:+.1f}] pp"


def _p(value) -> str:
    return "n/a" if value is None else (f"{value:.4f}" if value >= 0.0001 else "<0.0001")


def read_arm(directory, population=None) -> dict:
    """One arm: its pass/fail reading, its transition reading, and the bar its gate would have to clear.

    The turnover is over every scored pair in the arm, because a break can only happen on a requirement the arm
    itself met and restricting that set by another arm's failures would delete the very observations the
    comparison is about. The rescue is over `population`, which is the reference's failures, because that is the
    set of opportunities both arms share.
    """
    grouped = by_task(simulations_of(directory))
    turnover = turnover_of(grouped)
    return {
        "stats": episode_stats(grouped),
        "turnover": turnover,
        "rescue": rescue_of(grouped, population),
        "bar": bar_of(turnover),
        "failed": len(failed_by(grouped)),
    }


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--arm", action="append", default=[],
                        help="name=directory, repeated. The first is the reference.")
    parser.add_argument("--notes", action="append", default=[], help="name=directory of note sidecars")
    parser.add_argument("--json", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    if len(arguments.arm) < 2:
        print("at least two arms: --arm name=dir --arm name=dir", file=sys.stderr)
        return 4
    arms: "dict[str, dict]" = {}
    directories: "dict[str, str]" = {}
    for entry in arguments.arm:
        name, _, directory = entry.partition("=")
        if not name or not directory:
            print(f"--arm wants name=directory, got {entry!r}", file=sys.stderr)
            return 4
        if not Path(directory).is_dir():
            print(f"no directory at {directory}", file=sys.stderr)
            return 4
        directories[name] = directory
    reference_name = next(iter(directories))
    reference_grouped = by_task(simulations_of(directories[reference_name]))
    if episode_stats(reference_grouped)["episodes"] == 0:
        print(f"{reference_name} has no scored episode: no reading exists", file=sys.stderr)
        return 2
    population = failed_by(reference_grouped)
    for name, directory in directories.items():
        arms[name] = read_arm(directory, population)
    if arms[reference_name]["stats"]["episodes"] == 0:
        print(f"{reference_name} has no scored episode: no reading exists", file=sys.stderr)
        return 2

    references = {name: compare_of(arm, arms[reference_name]) for name, arm in arms.items() if name != reference_name}
    naming = {}
    for entry in arguments.notes:
        name, _, directory = entry.partition("=")
        if not name or not directory or not Path(directory).is_dir():
            print(f"--notes wants name=directory that exists, got {entry!r}", file=sys.stderr)
            return 4
        # The notes come from one directory and the episodes they are graded against from the arm's own, because
        # a rescue run keeps its sidecars beside the arms rather than inside them. Naming a population that is
        # not an arm would compute the association against no episode and report zero repairs.
        if name not in arms:
            print(f"--notes {name} names no arm: {sorted(arms)}", file=sys.stderr)
            return 4
        records = notes_of(directory)
        if not records:
            print(f"{name} holds no note: the naming reading would be over nothing", file=sys.stderr)
            return 2
        naming[name] = naming_of(records, by_task(simulations_of(directories[name])))

    print(render(arms, references, naming))
    if arguments.json:
        Path(arguments.json).write_text(json.dumps(
            {"arms": arms, "comparisons": references, "naming": naming}, indent=1) + "\n")
    return 0


# --------------------------------------------------------------------------- the self-check


def _simulation(task, trial, checks, reward=None) -> dict:
    """One episode from its requirements. `checks` is `{key: met}`, which is what the reading reads."""
    info = {"reward": 0.0 if reward is None else float(reward)}
    database = [key for key in checks if key[0] == "db"]
    if database:
        info["db_check"] = {"db_match": bool(checks[database[0]]), "db_reward": 1.0 if checks[database[0]] else 0.0}
    actions = [key for key in checks if key[0] == "action"]
    info["action_checks"] = [{"action": {"name": key[1].replace(" ", "_")}, "action_match": bool(checks[key])}
                             for key in actions]
    info["nl_assertions"] = [{"nl_assertion": key[1], "met": bool(checks[key])} for key in checks if key[0] == "nl"]
    info["communicate_checks"] = [{"info": key[1], "met": bool(checks[key])} for key in checks if key[0] == "communicate"]
    info["env_assertions"] = [{"env_assertion": key[1], "met": bool(checks[key])} for key in checks if key[0] == "env"]
    return {"task_id": task, "trial": trial, "reward_info": info}


def _document(simulations) -> dict:
    return {"simulations": simulations}


def _write(directory: Path, simulations) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "results.json").write_text(json.dumps(_document(simulations)))


def _record(results: list, name: str, condition: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": bool(condition), "detail": detail})


def _raises(call) -> bool:
    try:
        call()
    except BaseException:  # noqa: BLE001 - the harness asks one question and any failure answers it
        return True
    return False


def tally(results: list) -> int:
    """The harness's only branch, so the exit code and the failure list have one implementation."""
    failed = [f"{case['name']}{': ' + case['detail'] if case['detail'] else ''}" for case in results if not case["ok"]]
    if failed:
        print(f"{len(failed)} of {len(results)} case(s) failed: {'; '.join(failed)}", file=sys.stderr)
        return 1
    print(f"{len(results)} case(s) pass")
    return 0


def self_test() -> int:
    import contextlib
    import io
    import tempfile

    results: list = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        _record(results, name, condition, detail)

    check("content words drop stop words", content_words("the order and the id") == {"order", "id"})
    check("content words keep digits", "#w4316152" in content_words("#W4316152"))
    check("content words survive None", content_words(None) == set())

    info = {"db_check": {"db_match": True},
            "action_checks": [{"action": {"name": "exchange_items"}, "action_match": False}],
            "nl_assertions": [{"nl_assertion": "Exchange both kettles", "met": False}],
            "communicate_checks": [{"info": "12345", "met": True}],
            "env_assertions": [{"env_assertion": "the ticket exists", "met": True}]}
    checks = checks_of(info)
    check("every requirement type is read", len(checks) == 5, str(sorted(checks)))
    check("an action key drops underscores", ("action", "exchange items") in checks, str(sorted(checks)))
    check("an unmet check is unmet", checks[("nl", "Exchange both kettles")] is False)
    check("a missing reward_info is no checks", checks_of(None) == {})

    # A pair where one requirement is repaired and another broken: both movements visible at once.
    left = _simulation("1", 0, {("nl", "a"): False, ("nl", "b"): True, ("db", "d"): True}, reward=0.0)
    right = _simulation("1", 1, {("nl", "a"): True, ("nl", "b"): False, ("db", "d"): True}, reward=0.0)
    turnover = turnover_of(by_task([left, right]))
    check("one pair is one pair", turnover["pairs"] == 1, str(turnover))
    check("a repair is counted", turnover["repaired"] == 1, str(turnover))
    check("a break is counted", turnover["broken"] == 1, str(turnover))
    check("a held requirement is counted", turnover["held"] == 1, str(turnover))
    check("the net is the difference", turnover["net"] == 0, str(turnover))
    check("the repair rate is over unmet requirements", abs(turnover["repairRate"] - 1.0) < 1e-9, str(turnover))
    check("and the denominator is one, not three", turnover["unmetBefore"] == 1, str(turnover))
    check("the break rate is over met requirements", abs(turnover["breakRate"] - 0.5) < 1e-9, str(turnover))

    # An unscored attempt is not an observation: a pair that touches one is dropped, not counted as a persistence.
    unscored = _simulation("1", 2, {("nl", "a"): False})
    unscored["reward_info"].pop("reward")
    dropped = turnover_of(by_task([left, right, unscored]))
    check("an unscored attempt makes no pair", dropped["pairs"] == 1, str(dropped))

    # A requirement that exists in one attempt and not the other is not a transition: the sets are intersected.
    asymmetric = turnover_of(by_task([
        _simulation("3", 0, {("nl", "a"): True}, reward=0.0),
        _simulation("3", 1, {("nl", "b"): False}, reward=0.0),
    ]))
    check("an asymmetric requirement is not counted", asymmetric["pairs"] == 1 and asymmetric["held"] == 0, str(asymmetric))

    # A pair whose first attempt passed is not a rescue opportunity, and one whose second was not scored is not a pair.
    passing = rescue_of(by_task([_simulation("4", 0, {("nl", "a"): True}, reward=1.0),
                                 _simulation("4", 1, {("nl", "a"): True}, reward=1.0)]))
    check("a passing pair is not an opportunity", passing["opportunities"] == 0 and passing["rate"] is None, str(passing))
    first_unscored = _simulation("4", 0, {("nl", "a"): False})
    first_unscored["reward_info"].pop("reward")
    check("a pair whose first attempt was not scored is not a pair",
          turnover_of(by_task([first_unscored, _simulation("4", 1, {("nl", "a"): True}, reward=1.0)]))["pairs"] == 0)

    # An episode with no trial number cannot be ordered, and an arm of only unscored attempts has no pass rate.
    check("a simulation without a trial is dropped",
          by_task([{"task_id": "5", "trial": None, "reward_info": {"reward": 1.0}}]) == {})
    check("a task with nothing scored is not a task",
          episode_stats(by_task([{"task_id": "6", "trial": 0, "reward_info": {}}]))["tasks"] == 0)
    check("a missing results directory is no episodes", simulations_of("/nonexistent/path") == [])

    # Reward: `None` is not zero.
    check("a missing reward is not zero", reward_of(unscored) is None)
    check("a zero reward is zero", reward_of(left) == 0.0)

    # The pass/fail reading, so the check-level one has a counterpart to disagree with.
    stats = episode_stats(by_task([
        _simulation("1", 0, {("nl", "a"): True}, reward=1.0),
        _simulation("1", 1, {("nl", "a"): True}, reward=1.0),
        _simulation("2", 0, {("nl", "a"): False}, reward=0.0),
        _simulation("2", 1, {("nl", "a"): True}, reward=1.0),
    ]))
    check("pass^1 is the episode share", abs(stats["pass1"] - 0.75) < 1e-9, str(stats))
    check("pass^k is the task share", abs(stats["passk"] - 0.5) < 1e-9, str(stats))
    check("k is the longest task", stats["k"] == 2, str(stats))
    check("two tasks", stats["tasks"] == 2, str(stats))

    # Rescue: the same pairs, counted only where the first attempt failed.
    rescue = rescue_of(by_task([left, right]))
    check("a failed pair is an opportunity", rescue["opportunities"] == 1, str(rescue))
    check("and it was not rescued", rescue["rescued"] == 0, str(rescue))

    # The bar: three repairs to one break is a bar of 25%, and a headroom of 50 points.
    bar = bar_of({"repaired": 3, "broken": 1})
    check("the bar is the break share", abs(bar["bar"] - 0.25) < 1e-9, str(bar))
    check("the headroom is the margin over it", abs(bar["headroom"] - 0.5) < 1e-9, str(bar))
    check("no movement is no bar", bar_of({"repaired": 0, "broken": 0})["bar"] is None)

    # Naming: a note about one requirement, a pair where that one is repaired and another is not.
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        _write(root / "arm", [
            _simulation("1", 0, {("nl", "exchange both kettles"): False, ("nl", "confirm the address"): False}, reward=0.0),
            _simulation("1", 1, {("nl", "exchange both kettles"): True, ("nl", "confirm the address"): False}, reward=0.0),
        ])
        (root / "arm" / "notes-1.json").write_text(json.dumps({"notes": {
            "k": {"note": "Exchange both kettles as requested.", "attempt": 1, "task": "1", "reward": 0.0}
        }}))
        records = notes_of(root / "arm")
        check("one note is read", len(records) == 1, str(records))
        naming = naming_of(records, by_task(simulations_of(root / "arm")))
        check("the note names one requirement", naming["named"] == 1, str(naming))
        check("and is silent on the other", naming["silent"] == 1, str(naming))
        check("coverage is a share of requirements", abs(naming["coverage"] - 0.5) < 1e-9, str(naming))
        check("the named one was repaired", naming["repairedNamed"] == 1, str(naming))
        check("the silent one was not", naming["repairedSilent"] == 0, str(naming))
        check("a note naming everything is counted", naming["notesNamingEverything"] == 0, str(naming))

        # A note read in round 1 is compared with round 0: the off-by-one this reader exists to have made once.
        (root / "arm" / "notes-1.json").write_text(json.dumps({"notes": {
            "k": {"note": "Exchange both kettles.", "attempt": 9, "task": "1", "reward": 0.0}
        }}))
        late = naming_of(notes_of(root / "arm"), by_task(simulations_of(root / "arm")))
        check("a note read in a round with no source is skipped", late["notes"] == 0, str(late))
        # A sidecar entry that is not an object, and one with no text: both are absent notes rather than notes.
        (root / "arm" / "notes-1.json").write_text(json.dumps({"notes": {"k": "a sentence", "j": {"note": ""}}}))
        check("an entry that is not an object is skipped", notes_of(root / "arm") == [])
        # A trajectory file beside the sidecar is not a sidecar, and the reader tells them apart by the name.
        (root / "arm" / "notes-1.json.trajectories.json").write_text(json.dumps({"trajectories": {}}))
        check("a trajectory file is not a note", notes_of(root / "arm") == [])

        # A note whose source attempt met every requirement is about nothing and is not counted.
        (root / "arm" / "notes-1.json").write_text(json.dumps({"notes": {
            "k": {"note": "Exchange both kettles.", "attempt": 1, "task": "1", "reward": 1.0}
        }}))
        met_source = by_task([
            _simulation("1", 0, {("nl", "exchange both kettles"): True}, reward=1.0),
            _simulation("1", 1, {("nl", "exchange both kettles"): True}, reward=1.0),
        ])
        check("a note whose attempt met everything has nothing to name", naming_of(notes_of(root / "arm"), met_source)["notes"] == 0)

        # And the note the rest of the block needs, put back.
        (root / "arm" / "notes-1.json").write_text(json.dumps({"notes": {
            "k": {"note": "Exchange both kettles as requested.", "attempt": 1, "task": "1", "reward": 0.0}
        }}))

        # An unreadable sidecar contributes nothing and does not stop the reading.
        (root / "arm" / "notes-2.json").write_text("{not json")
        survivor = notes_of(root / "arm")
        check("an unreadable sidecar is skipped", len(survivor) == 1, str(survivor))
        check("a missing notes directory is no notes", notes_of(root / "nope") == [])

        # Arms: one control, one material that breaks everything it touches.
        _write(root / "control", [
            _simulation("1", 0, {("nl", "a"): False, ("nl", "b"): True}, reward=0.0),
            _simulation("1", 1, {("nl", "a"): False, ("nl", "b"): True}, reward=0.0),
        ])
        harmful = read_arm(root / "arm")
        control = read_arm(root / "control")
        moved = compare_of(harmful, control)
        check("a repair difference is computed", moved["repairDelta"] is not None, str(moved))
        check("and carries a p", moved["repairP"] is not None, str(moved))
        check("an identical arm moves nothing", compare_of(control, control)["repairDelta"] == 0, "")

        state, _sentence = state_of(harmful, moved)
        check("a small difference is a wash", state in ("WASH", "REPAIRS", "BREAKS", "BOTH"), state)
        state_both, _ = state_of(harmful, {"repairDelta": 0.2, "repairP": 0.01, "breakDelta": 0.2, "breakP": 0.01})
        check("both movements is both", state_both == "BOTH", state_both)
        state_repairs, _ = state_of(harmful, {"repairDelta": 0.2, "repairP": 0.01, "breakDelta": 0.0, "breakP": 1.0})
        check("a repair alone is repairs", state_repairs == "REPAIRS", state_repairs)
        state_breaks, _ = state_of(harmful, {"repairDelta": 0.0, "repairP": 1.0, "breakDelta": 0.2, "breakP": 0.01})
        check("a break alone is breaks", state_breaks == "BREAKS", state_breaks)
        state_none, _ = state_of(harmful, {"repairDelta": None, "repairP": None, "breakDelta": None, "breakP": None})
        check("no movement is a wash", state_none == "WASH", state_none)
        # A net that leans negative without a resolved break is still a wash, and says so in its sentence.
        leaning = dict(harmful)
        leaning["turnover"] = dict(harmful["turnover"], net=-3, breakRate=0.2)
        state_leaning, sentence_leaning = state_of(leaning, {"repairDelta": 0.01, "repairP": 0.9,
                                                             "breakDelta": 0.01, "breakP": 0.9})
        check("a negative net without a resolved break is a wash", state_leaning == "WASH", state_leaning)
        check("and the sentence says the net leans", "leans negative" in sentence_leaning, sentence_leaning)

        # An arm whose every requirement was met has no repair denominator, and one with none met has no break
        # denominator; both are readings, and both are refused rather than divided by zero.
        all_met = root / "allmet"
        _write(all_met, [_simulation("7", 0, {("nl", "a"): True}, reward=1.0),
                         _simulation("7", 1, {("nl", "a"): False}, reward=0.0)])
        nothing_met = root / "nothingmet"
        _write(nothing_met, [_simulation("8", 0, {("nl", "a"): False}, reward=0.0),
                             _simulation("8", 1, {("nl", "a"): False}, reward=0.0)])
        check("an arm with nothing unmet has no repair rate", read_arm(all_met)["turnover"]["repairRate"] is None)
        check("an arm with nothing met has no break rate", read_arm(nothing_met)["turnover"]["breakRate"] is None)
        check("and comparing the two leaves both movements unstated",
              compare_of(read_arm(all_met), read_arm(nothing_met))["repairP"] is None)

        # The command line: a reading, a refusal, and the two arguments that cannot be ambiguous.
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            code = main(["--arm", "control=" + str(root / "control"), "--arm", "material=" + str(root / "arm"),
                         "--notes", "material=" + str(root / "arm")])
        check("two arms read", code == 0, str(code))
        check("the table names both", "control" in printed.getvalue() and "material" in printed.getvalue(), printed.getvalue()[-200:])
        check("one arm is refused", main(["--arm", "control=" + str(root / "control")]) == 4)
        check("a malformed arm is refused", main(["--arm", "control", "--arm", "x=" + str(root / "arm")]) == 4)
        check("a missing arm directory is refused",
              main(["--arm", "a=" + str(root / "nope"), "--arm", "b=" + str(root / "arm")]) == 4)
        check("a missing notes directory is refused",
              main(["--arm", "a=" + str(root / "control"), "--arm", "b=" + str(root / "arm"),
                    "--notes", "b=" + str(root / "nope")]) == 4)
        empty = root / "empty"
        empty.mkdir()
        check("an arm with no episode has no reading",
              main(["--arm", "a=" + str(empty), "--arm", "b=" + str(root / "arm")]) == 2)
        check("an arm with no note has no naming reading",
              main(["--arm", "a=" + str(root / "control"), "--arm", "b=" + str(root / "arm"),
                    "--notes", "a=" + str(empty)]) == 2)
        check("a notes population that is not an arm is refused",
              main(["--arm", "a=" + str(root / "control"), "--arm", "b=" + str(root / "arm"),
                    "--notes", "c=" + str(root / "arm")]) == 4)
        out = root / "reading.json"
        with contextlib.redirect_stdout(io.StringIO()):
            main(["--arm", "control=" + str(root / "control"), "--arm", "material=" + str(root / "arm"),
                  "--json", str(out)])
        check("the json is written", out.is_file())
        written = json.loads(out.read_text())
        check("and holds every arm", set(written["arms"]) == {"control", "material"}, str(set(written["arms"])))

    # The interval: Newcombe's hybrid score, which brackets its own point and refuses an empty denominator.
    interval = newcombe(40, 83, 38, 85)
    check("the interval brackets the difference",
          interval is not None and interval[0] < 40 / 83 - 38 / 85 < interval[1], str(interval))
    check("the interval is not degenerate",
          interval is not None and interval[1] - interval[0] < 1.0, str(interval))
    check("an empty denominator has no interval", newcombe(1, 0, 1, 2) is None)
    check("an empty other denominator has no interval", newcombe(1, 2, 1, 0) is None)
    check("a zero proportion still has an interval", wilson(0, 10) is not None)
    check("no observations is no interval", wilson(0, 0) is None)
    check("an identical pair straddles zero", (lambda ci: ci[0] <= 0 <= ci[1])(newcombe(5, 10, 5, 10)))
    check("the interval prints with its units", _ci((-0.05, 0.02)) == "[-5.0, +2.0] pp")
    check("a missing interval prints n/a", _ci(None) == "n/a")

    # The percent and p formatters, which the table's cells depend on.
    check("a none rate prints n/a", _pct(None) == "n/a")
    check("a point difference prints signed", _pp(-0.0125) == "-1.2 pp")
    check("a small p is not rounded to zero", _p(0.00001) == "<0.0001")
    check("a p of one prints one", _p(1.0) == "1.0000")
    silent = io.StringIO()
    with contextlib.redirect_stdout(silent):
        nothing = tally([])
    check("an empty suite passes with a zero denominator", nothing == 0 and "0 case(s) pass" in silent.getvalue())
    quiet = io.StringIO()
    with contextlib.redirect_stderr(quiet):
        broken = tally([{"name": "deliberate", "ok": False, "detail": "why"}])
    check("a failing case fails the suite", broken == 1)
    check("and says why", "why" in quiet.getvalue(), quiet.getvalue())
    check("a call that does not raise is not an exit", _raises(lambda: None) is False)
    check("a call that raises is an exit", _raises(lambda: 1 / 0) is True)
    return tally(results)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
