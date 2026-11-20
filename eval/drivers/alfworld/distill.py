"""Distil a rule bank from successful trajectories, with the competitor's own critique prompt.

`agent.py` drives games; this file turns the ones that were **won** into the numbered list of rules that
`always-in` and `retrieved` carry. The production of that list is a mechanism in its own right, and it is
the part of the competitor most often left out of a reproduction: ExpeL's 19 points are not from *having*
rules, they are from how the rules were written, and a bank distilled by a different prompt is a different
treatment wearing the same arm's name.

**What is ported.** `agent/expel.py@LeapLabTHU/ExpeL` at blob `e41ec9a2` carries the whole chain:

* `create_rules` splits the successful trajectories into chunks of `success_critique_num` (8 in
  `configs/agent/expel.yaml`), calls the critique prompt once per chunk, and feeds the existing list back in
  so that later chunks can `AGREE`/`EDIT`/`REMOVE` earlier rules rather than only adding;
* `prompt_critique` builds two messages — the system line
  `You will be given successful tasks trials in which you were placed in a household environment and tasks
  to complete.` and the human template that ends with the operation format and the "list is full" suffix;
* `parse_rules` reads the four operations out of the reply, and `update_rules` applies them with the vote
  arithmetic that `packages/eval/src/rule-bank.ts` already ports for the TypeScript side.

This file is the same arithmetic in Python, because the ALFWorld lane runs in Python on a runner that has
`textworld` and no `node` guarantee. Two implementations of one arithmetic is a drift hazard, so the hazard
is handled rather than tolerated: `rule-op-vectors.json` beside this file is a shared contract, and both
`test_distill.py` and `packages/eval/src/__tests__/rule-bank-vectors.test.ts` read it. A port that starts
agreeing with itself and not with the other side fails two builds, not none.

**The one path the competitor uses that this file cannot.** ExpeL's first critique pass compares a
successful trial against *failed trials of the same task* — it needs several attempts per task, and both
splits give one (`AUDIT.md` 34.213, AM.24). Only the success path (`all_success_existing_rules`) is
available here, so a bank built by this file is the competitor's extraction minus its contrast, and the
report says so where the number is reported rather than in a footnote.

**What it costs.** The critique calls, which is one call per chunk of eight: a 140-game training pass at the
measured 55% success rate is 77 wins, about ten calls. The trajectories themselves cost what the pass costs
(¥1.96 for `valid_seen` at the measured rate), and this file bills both, because a bank that is quoted at
"ten calls" is a bank whose training pass has been left out of the quote.

Exit codes are the report: 0 the bank was written, 1 the lane cannot report one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import agent as driver  # noqa: E402  (the lane's own module: chat, bill, rate card)

SCHEMA = "microglia.alfworld-bank/1"

# --------------------------------------------------------------------------------------------------
# The operation arithmetic
# --------------------------------------------------------------------------------------------------

# ExpeL's parse pattern, transliterated from `parse_rules`. The trailing label-eater
# `(?:[a-zA-Z\s\d]+: |)` strips a prefix such as `Rule 3: ` and cannot eat a sentence boundary because it
# excludes the period.
REPLY_SOURCE = r"((?:REMOVE|EDIT|ADD|AGREE)(?: \d+|)): (?:[a-zA-Z\s\d]+: |)(.*)"

# The words ExpeL refuses to see in rule text, tested as substrings rather than as tokens — which is the
# competitor's behaviour and the reason a rule containing `ADDITIONAL` is silently discarded.
BANNED = ("ADD", "AGREE", "EDIT")

ADD_VOTES = 2
OVERFLOW_MARGIN = 5
OVERFLOW_PENALTY = 3

IDENTITIES = ("substring", "exact", "tokens")


def parse_operations(reply: str) -> "list[dict]":
    """The rules a reply states, in the order it stated them.

    Three filters, all ExpeL's: an empty body, a body containing a banned word, and a body that does not
    end in a period (a truncation guard that also discards a legitimate rule written without a full stop).
    """
    operations: "list[dict]" = []
    for head, body in re.findall(REPLY_SOURCE, reply):
        text = body.strip()
        if text == "":
            continue
        if any(word in text for word in BANNED):
            continue
        if not text.endswith("."):
            continue
        parts = head.split(" ")
        kind = parts[0]
        number = None
        if len(parts) > 1 and parts[1].isdigit():
            number = int(parts[1])
        operations.append({"kind": kind, "number": number, "text": text})
    return operations


def normalize_tokens(text: str) -> str:
    """A rule's text reduced to the set of words it is made of, order discarded on purpose.

    `check the lamp first` and `first check the lamp` are the same instruction in a list that is rendered in
    bank order; what order carries is a constraint *within* a rule, and the extraction prompt asks for one
    imperative per line.
    """
    words = [word for word in re.split(r"[^a-z0-9]+", text.lower()) if word != ""]
    return " ".join(sorted(set(words)))


def same_rule(existing: str, incoming: str, identity: str) -> bool:
    """Whether an incoming rule is the same rule as an existing one, under one identity mode."""
    if identity == "exact":
        return existing == incoming
    if identity == "tokens":
        return normalize_tokens(existing) == normalize_tokens(incoming)
    # ExpeL's direction, kept: the *existing* rule has to be contained in the incoming text, so a rule
    # shortened into an extension of an existing one is a new rule and the reverse is invisible.
    return existing in incoming


def find_rule(bank: "list[dict]", text: str, identity: str) -> int:
    """The index of the first entry the text is judged to repeat, or -1. First match, as ExpeL takes."""
    for index, entry in enumerate(bank):
        if same_rule(entry["text"], text, identity):
            return index
    return -1


def merge_operations(
    bank: "list[dict]",
    operations: "list[dict]",
    identity: str = "substring",
    cap: "int | None" = None,
    overflow_penalty: int = OVERFLOW_PENALTY,
    overflow_margin: int = OVERFLOW_MARGIN,
) -> dict:
    """Apply one reply's operations to a bank, in ExpeL's order and with ExpeL's arithmetic.

    The resolve-then-apply split is the competitor's, and so is the pass that never deduplicates a reply
    against itself: two identical `ADD`s in one reply both land, because neither has arrived when the other
    is checked. A port that fixed that would be a different function from the one being controlled.
    """
    working = [dict(entry) for entry in bank]
    peak = len(working)
    applied = 0
    rejected = 0
    # Counted by kind because R164 registered a prediction about the ratio: a rule ends with a full stop, so a
    # substring identity test almost only fires on a verbatim restatement, and `EDIT` should therefore be nearly
    # unreachable. `applied` alone cannot confirm or refute that -- it is one number over four operations.
    by_kind = {"ADD": 0, "EDIT": 0, "AGREE": 0, "REMOVE": 0}
    resolved: "list[tuple[dict, int]]" = []

    for operation in operations:
        kind = operation["kind"]
        if kind == "ADD":
            if find_rule(working, operation["text"], identity) != -1:
                rejected += 1
                continue
            resolved.append((operation, -1))
            continue
        if kind == "EDIT":
            by_text = find_rule(working, operation["text"], identity)
            if by_text != -1:
                # An `EDIT` whose text already exists is an agreement written with the wrong verb.
                resolved.append(({**operation, "kind": "AGREE"}, by_text))
                continue
            named = -1 if operation["number"] is None else operation["number"] - 1
            # One deliberate divergence from the competitor, and it is a rejection rather than a rewrite:
            # ExpeL checks `rule_num > len(rules)` but not `rule_num < 1`, so `EDIT 0` reaches `rules[-1]`
            # — Python indexes from the end — and edits the last rule. Reproducing an out-of-bounds access
            # that happens to be legal in one language is not fidelity.
            if named < 0 or named >= len(working):
                rejected += 1
                continue
            resolved.append((operation, named))
            continue
        found = find_rule(working, operation["text"], identity)
        if found == -1:
            rejected += 1
            continue
        resolved.append((operation, found))

    for kind in ("REMOVE", "AGREE", "EDIT", "ADD"):
        for operation, index in resolved:
            if operation["kind"] != kind:
                continue
            by_kind[kind] += 1
            if kind == "ADD":
                working.append({"text": operation["text"], "votes": ADD_VOTES})
                applied += 1
                peak = max(peak, len(working))
                continue
            entry = working[index]
            applied += 1
            if kind == "REMOVE":
                full = cap is not None and cap + overflow_margin <= len(working)
                working[index] = {"text": entry["text"], "votes": entry["votes"] - (overflow_penalty if full else 1)}
                continue
            if kind == "AGREE":
                working[index] = {"text": entry["text"], "votes": entry["votes"] + 1}
                continue
            working[index] = {"text": operation["text"], "votes": entry["votes"] + 1}

    surviving = [entry for entry in working if entry["votes"] > 0]
    culled = len(working) - len(surviving)
    # Descending by votes, stable: two rules with equal support keep the order they entered in, which is
    # the order a reader compares two runs by.
    surviving.sort(key=lambda entry: entry["votes"], reverse=True)
    return {
        "bank": surviving,
        "rejected": rejected,
        "culled": culled,
        "peak": peak,
        "applied": applied,
        "by_kind": by_kind,
    }


def renderable(bank: "list[dict]", cap: "int | None") -> "list[dict]":
    """The rules a prompt would carry, which is where a cap that nothing enforces becomes visible."""
    return bank if cap is None else bank[:cap]


# --------------------------------------------------------------------------------------------------
# The critique prompt
# --------------------------------------------------------------------------------------------------

# `prompts/alfworld.py@LeapLabTHU/ExpeL`, blob `2b2093ef`.
SYSTEM_CRITIQUE = (
    "You will be given successful tasks trials in which you were placed in a household environment and tasks "
    "to complete."
)

# `prompts/templates/human.py`, `FORMAT_RULES_OPERATION_TEMPLATE`, verbatim including the trailing space that
# the suffix below is concatenated onto.
OPERATION_FORMAT = (
    "<OPERATION> <RULE NUMBER>: <RULE>\n\n"
    "The available operations are: AGREE (if the existing rule is strongly relevant for the task), REMOVE (if "
    "one existing rule is contradictory or similar/duplicated to other existing rules), EDIT (if any existing "
    "rule is not general enough or can be enhanced, rewrite and improve it), ADD (add new rules that are very "
    "different from existing rules and relevant for other tasks). Each needs to CLOSELY follow their "
    "corresponding formatting below (any existing rule not edited, not agreed, nor removed is considered "
    "copied):\n\n"
    "AGREE <EXISTING RULE NUMBER>: <EXISTING RULE>\n"
    "REMOVE <EXISTING RULE NUMBER>: <EXISTING RULE>\n"
    "EDIT <EXISTING RULE NUMBER>: <NEW MODIFIED RULE>\n"
    "ADD <NEW RULE NUMBER>: <NEW RULE>\n\n"
    "Do not mention the trials in the rules because all the rules should be GENERALLY APPLICABLE. Each rule "
    "should be concise and easy to follow. Any operation can be used MULTIPLE times. Do at most 4 operations "
    "and each existing rule can only get a maximum of 1 operation. "
)

HUMAN_CRITIQUE = """{instruction}
Here are the trials:
{success_history}

Here are the EXISTING RULES:
{existing_rules}

By examining the successful trials, and the list of existing rules, you can perform the following operations: add, edit, remove, or agree so that the new list of rules are general and high level insights of the successful trials or proposed way of Thought so they can be used as helpful tips to different tasks in the future. Have an emphasis on tips that help the agent perform better Thought and Action. Follow the below format:

""" + OPERATION_FORMAT

CRITIQUE_SUFFIX_FULL = (
    "Focus on REMOVE rules first, and stop ADD rule unless the new rule is VERY insightful and different "
    "from EXISTING RULES. Below are the operations you do to the above list of EXISTING RULES:\n"
)
CRITIQUE_SUFFIX_NOT_FULL = "Below are the operations you do to the above list of EXISTING RULES:\n"


def numbered(bank: "list[dict]") -> str:
    """The list as the prompt renders it: `1. rule` per line, and an empty string for an empty bank."""
    return "\n".join(f"{index}. {entry['text']}" for index, entry in enumerate(bank, 1))


def critique_messages(bank: "list[dict]", trials: str, cap: "int | None") -> "list[dict]":
    """The two messages of one critique call, in the competitor's order and with its suffix rule.

    The suffix is appended without a separator because the competitor appends it without one
    (`message.content + critique_summary_suffix`) and the format above ends in a space, so the concatenation
    reads as one sentence. A newline inserted here would be a prompt this file invented.
    """
    human = HUMAN_CRITIQUE.format(instruction="", success_history=trials, existing_rules=numbered(bank))
    full = cap is not None and cap <= len(bank)
    return [
        {"role": "system", "content": SYSTEM_CRITIQUE},
        {"role": "user", "content": human + (CRITIQUE_SUFFIX_FULL if full else CRITIQUE_SUFFIX_NOT_FULL)},
    ]


# --------------------------------------------------------------------------------------------------
# The pass
# --------------------------------------------------------------------------------------------------


def successes(episode_files: "list[Path]") -> "list[dict]":
    """Every won episode in the given artefacts, deduplicated by game and sorted by it.

    Sorted rather than shuffled: the competitor divides its successes at random under a seed, which makes
    *which rules* a function of the seed. Here the order is the split's order, so a bank is reproducible from
    the artefacts alone — and the divergence is stated because grouping decides what each critique sees.
    """
    seen: "dict[str, dict]" = {}
    for path in episode_files:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        for episode in payload.get("episodes", []):
            game = episode.get("gamefile")
            if not episode.get("won") or not isinstance(game, str):
                continue
            trajectory = episode.get("trajectory")
            if not isinstance(trajectory, str) or trajectory.strip() == "":
                driver.fail(
                    f"{game} was won but carries no trajectory: the pass was driven without "
                    "--record-transcripts, so there is nothing to distil from"
                )
            seen[game] = episode
    return [seen[game] for game in sorted(seen)]


def tiled(episode_files: "list[Path]", expected: int) -> int:
    """How many distinct games the artefacts cover, refused when that is not the whole slice.

    A bank is a function of the games it was distilled from, and a bank built from three of four shards is a
    different treatment wearing the same name. Run `44685314225` is exactly that case: one shard died on a
    dropped connection and the other three completed, so the union of a later run with the surviving artefacts
    is legitimate *only* if the union is complete. This is the check that makes "complete" a fact rather than
    an assumption, and it costs nothing because the files are already read.
    """
    games = set()
    for path in episode_files:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        for episode in payload.get("episodes", []):
            game = episode.get("gamefile")
            if isinstance(game, str):
                games.add(game)
    if expected and len(games) != expected:
        driver.fail(
            f"the artefacts cover {len(games)} games but the slice is {expected}: a bank distilled from a partial "
            "slice is a different treatment, so it is refused rather than reported beside a rate that assumes it"
        )
    return len(games)


def kept(episodes: "list[dict]", kinds: str) -> "list[dict]":
    """The episodes whose task kind is named by `kinds`, or all of them when it names none.

    The filter exists for one experiment: a bank distilled from `cool`+`heat` and scored on all six kinds has the
    same shape, header and length as the registered bank and a different vocabulary. Without it, the only control
    this lane can build for the *content* of a bank is a permutation of the bank itself, and a permutation keeps the
    words — which is the confound `44763220821` ran into when its placebo earned the treatment's delta.
    """
    if not kinds:
        return episodes
    named = [item.strip() for item in kinds.split(",") if item.strip()]
    published = sorted(kind for _, kind in driver.TASK_KIND_PREFIXES)
    unknown = sorted(set(named) - set(published))
    if unknown:
        driver.fail(f"--kinds names {unknown}; the split publishes {published}")
    chosen = [episode for episode in episodes if driver.task_kind_of(episode["gamefile"]) in named]
    if not chosen:
        driver.fail(f"no won episode belongs to {named}, so the bank would be distilled from nothing")
    return chosen


def chunks_of(items: "list[dict]", size: int) -> "list[list[dict]]":
    """Consecutive slices of `size`, which is the competitor's `success_critique_num`."""
    if size < 1:
        driver.fail(f"--critique-num wants a positive chunk size, got {size}")
    return [items[start : start + size] for start in range(0, len(items), size)]


def trials_text(chunk: "list[dict]") -> str:
    """The trials block: the competitor joins each task and its trajectory with a newline, then joins the
    trials with a blank line. Our trajectory already carries the task line, because that is where ALFWorld
    renders it in the first observation."""
    return "\n\n".join(episode["trajectory"].strip() for episode in chunk)


def build_bank(
    chunk_list: "list[list[dict]]",
    cap: "int",
    model: str,
    api_key: str,
    timeout: float,
    identity: str = "substring",
    trace: int = 0,
    chat_fn=None,
) -> dict:
    """Run one critique per chunk, feeding the list back in, and report what each reply did to it."""
    caller = chat_fn or driver.chat
    bank: "list[dict]" = []
    stats = {
        "applied": 0,
        "rejected": 0,
        "culled": 0,
        "peak": 0,
        "empty_replies": 0,
        "operations": 0,
        "retries": 0,
        "by_kind": {"ADD": 0, "EDIT": 0, "AGREE": 0, "REMOVE": 0},
    }
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "cache_hit_tokens": 0, "cache_miss_tokens": 0}
    calls = 0
    for index, chunk in enumerate(chunk_list, 1):
        messages = critique_messages(bank, trials_text(chunk), cap)
        # Three values, because `driver.chat` returns the retry count beside the reply. The count is summed here for
        # the same reason it is summed in a pass: a bank distilled across a provider incident is a bank whose cost
        # has a caveat, and this is the only place that knows it happened.
        reply, reported, retried = caller(messages, model, api_key, timeout)
        calls += 1
        stats["retries"] += retried
        for key, value in driver.usage_numbers(reported).items():
            usage[key] += value
        operations = parse_operations(reply)
        if not operations:
            # A reply that states no operation is not an error -- the model may judge the list complete --
            # but a bank built from ten of them is a bank nobody wrote.
            stats["empty_replies"] += 1
        if trace and index <= trace:
            print(f"  [critique {index}/{len(chunk_list)}] {len(operations)} operation(s); reply {reply[:200]!r}")
        report = merge_operations(bank, operations, identity=identity, cap=cap)
        bank = report["bank"]
        stats["operations"] += len(operations)
        for key in ("applied", "rejected", "culled"):
            stats[key] += report[key]
        for kind, count in report["by_kind"].items():
            stats["by_kind"][kind] += count
        stats["peak"] = max(stats["peak"], report["peak"])
    return {"bank": bank, "stats": stats, "usage": usage, "calls": calls}


def main() -> int:
    parser = argparse.ArgumentParser(description="Distil a rule bank from won ALFWorld episodes")
    parser.add_argument("--episodes", nargs="+", required=True, help="arm json files to read trajectories from")
    parser.add_argument("--out", default=str(HERE / "bank.json"))
    parser.add_argument("--cap", type=int, default=20, help="the competitor's max_num_rules")
    parser.add_argument("--critique-num", type=int, default=8, help="the competitor's success_critique_num")
    parser.add_argument("--identity", choices=IDENTITIES, default="substring", help="the competitor's rule identity")
    parser.add_argument("--model", default=driver.DEFAULT_MODEL)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--trace", type=int, default=0)
    parser.add_argument(
        "--kinds",
        default="",
        help="comma separated task kinds to distil from (put, clean, heat, cool, examine, puttwo); empty uses all",
    )
    parser.add_argument(
        "--expect-games",
        type=int,
        default=0,
        help="the training slice's size; a union of artefacts that does not tile it is refused (0 skips the check)",
    )
    arguments = parser.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if api_key == "":
        driver.fail("distillation needs DEEPSEEK_API_KEY; there is no offline bank")

    files = [Path(path) for path in arguments.episodes]
    covered = tiled(files, arguments.expect_games)
    won = successes(files)
    if not won:
        driver.fail("no won episode carried a trajectory, so there is nothing to distil from")
    won = kept(won, arguments.kinds)

    chunk_list = chunks_of(won, arguments.critique_num)
    print(
        f"distilling from {len(won)} won episodes of {covered} driven in {len(chunk_list)} critique(s) of up to "
        f"{arguments.critique_num}, cap {arguments.cap}, identity {arguments.identity}"
    )
    began = time.monotonic()
    result = build_bank(
        chunk_list,
        arguments.cap,
        arguments.model,
        api_key,
        arguments.timeout,
        arguments.identity,
        arguments.trace,
    )
    elapsed = time.monotonic() - began

    if not result["bank"]:
        driver.fail("every critique replied without an operation the parser accepts, so the bank is empty")
    if result["stats"]["peak"] > arguments.cap + OVERFLOW_MARGIN:
        # The cap is soft in the competitor and it is checked here for the same reason the arm reports
        # `pack_entries`: a bank that drifted past the margin is a fourth arm nobody registered.
        driver.fail(f"the bank peaked at {result['stats']['peak']} entries, past the cap's own margin")

    card = driver.load_rate_card()
    bill = driver.bill_of(
        card, result["usage"]["prompt_tokens"], result["usage"]["cache_hit_tokens"], result["usage"]["completion_tokens"]
    )
    payload = {
        "schema": SCHEMA,
        "entries": result["bank"],
        "cap": arguments.cap,
        "identity": arguments.identity,
        "source": {
            "episodes": len(won),
            "chunks": len(chunk_list),
            "critique_num": arguments.critique_num,
            "kinds": sorted(item.strip() for item in arguments.kinds.split(",") if item.strip()) or None,
            "model": arguments.model,
            "prompt": "all_success_existing_rules@LeapLabTHU/ExpeL:e41ec9a2",
        },
        "stats": result["stats"],
        "usage": result["usage"],
        "calls": result["calls"],
        "bill": bill,
        "elapsed_s": round(elapsed, 1),
    }
    Path(arguments.out).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("")
    print(f"bank: {len(result['bank'])} rule(s) from {result['calls']} critique call(s)")
    print(f"  rendered       {len(renderable(result['bank'], arguments.cap))} within the cap")
    print(f"  operations     {result['stats']['operations']} parsed, {result['stats']['applied']} applied, "
          f"{result['stats']['rejected']} rejected, {result['stats']['culled']} culled")
    print(f"  retried        {result['stats']['retries']} call(s)")
    print(f"  bill           ${bill['usd']} ({bill['band']}); other band ${bill['usd_in_other_band']}")
    print(f"  written        {arguments.out}")
    print("PASS the bank was built from the trajectories it was given")
    return 0


if __name__ == "__main__":
    sys.exit(main())

