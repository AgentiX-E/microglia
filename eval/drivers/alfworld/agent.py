"""Drive one arm of the ALFWorld lane against a model, and bill the run it produced.

`floor.py` settles what can be settled without a call: the split is covered, every episode terminates,
and the same seed replays. This file is the other half — the part that spends money — and it is written
so that the spending is observable from its own output rather than from a provider's dashboard.

**The prompt is the competitor's, read out of the competitor's file.** Two complete ReAct transcripts
per task type are carried in `prompts/alfworld-examples.json`, extracted from
`prompts/alfworld.py@LeapLabTHU/ExpeL` at blob `2b2093ef`; the system line, the human template
(`{instruction}You may take maximum of {max_steps} steps.\\nHere are two examples:`) and the reply
parser are that file's, transliterated. An arm is therefore a change to *what the prompt carries above
the transcript* and not a change to the transcript, which is the only arrangement in which a difference
between arms is attributable to the arm.

**Three arms, one skeleton.** `none` carries the task and its transcript; `always-in` carries up to the
bank's cap of rules rendered whole on every episode; `retrieved` carries the entries a lexical anchor
admits. The three differ in one block of text and in nothing else — same model, same decoding, same step
cap, same examples, same parser.

**Why the pack is fixed per episode and placed above the examples.** DeepSeek caches on a token-block
prefix, so a block that changes every turn makes every turn after it a miss; the τ² lane paid for that
lesson already (R57's Amendment 4). The pack is therefore rendered once, at the top of the first human
turn, and the whole prefix — system, pack, instruction, examples — is stable for the episode. A
`retrieved` arm that re-anchored per turn would be a different and much more expensive experiment, and
it is not this one.

**Two policies that never call a model.** `--policy seed` chooses uniformly among the commands the
environment publishes, using `floor.Draw`; `--policy first` takes the first. `seed` exists to be
compared against `floor.py` on the same games: both drive the environment through this same
`run_episode`, so a disagreement is a defect in the loop rather than in the arm. `--assert-floor` makes
that comparison an assertion.

**Nothing is repaired quietly.** A reply that parses to no action is recorded as such and the text is
sent to the environment as an action — the environment answers `Nothing happens.` and the step is
spent, which is what the competitor's own parser does. An episode that produces three thoughts in a row
without an action is not a low score, it is a broken skeleton, and it fails the run. A missing API key
fails the run instead of falling back to a policy.

Exit codes are the report: 0 the arm ran and its accounting closes, 1 the lane cannot report it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The environment side of this lane is `floor.py`: the same split, the same game identity, the same
# PRNG, the same wrapper. Importing rather than copying is the whole reason `--assert-floor` can mean
# anything — two implementations agreeing would be a coincidence, and one implementation agreeing with
# itself through two policies is a statement about the loop.
sys.path.insert(0, str(HERE))
from floor import DATA_ROOT, SPLIT, Draw, build_env, digest_of, game_key, wilson  # noqa: E402

ARMS = ("none", "always-in", "retrieved")
POLICIES = ("model", "seed", "first")

# The six task types the split publishes, keyed by the prefix the competitor keys its examples by. The
# match is `startswith` on the game directory's own name, because ALFWorld writes
# `pick_clean_then_place_in_recep-Cup-None-Cabinet-10` and the file whose examples are being used
# matches on `pick_clean_then_place`.
TASK_KIND_PREFIXES = (
    ("pick_and_place", "put"),
    ("pick_clean_then_place", "clean"),
    ("pick_heat_then_place", "heat"),
    ("pick_cool_then_place", "cool"),
    ("look_at_obj", "examine"),
    ("pick_two_obj", "puttwo"),
)

SYSTEM_INSTRUCTION = "Follow the syntax of the examples closely when taking actions."
HUMAN_TEMPLATE = "{instruction}You may take maximum of {max_steps} steps.\nHere are two examples:"
PACK_HEADER = "Rules from earlier attempts:"

# The competitor's parser, transliterated. Order matters: a reply that opens with `> think` is a
# thought even if the rest of it looks like an action, and a reply with no prefix at all is wrapped as
# one rather than being thrown away.
THINK_PATTERN = r"(?i)(?:>|)\s*think(?::|)"
CARET_PATTERN = r"(?i)>\s*"
ACTION_VERB_PATTERN = r"(?i)(?:go to|open|take|put|use|heat|cool|look|clean|inventory)"

# A skeleton that lets the model think forever is a skeleton that spends without stepping. Three in a
# row is what the competitor's own examples contain at their most deliberate; a fourth means the reply
# format was not learned and the run is measuring that instead of the arm.
MAX_THOUGHTS_PER_OBSERVATION = 3

DEFAULT_MODEL = "deepseek-flash"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

# Words that carry no evidence about which rule applies. Without this list the anchor matched on `the`
# and `is`, so *any* rule was admitted by *any* observation and the `retrieved` arm was `always-in` with
# extra steps. Found by the test that expects a rule about a fridge to be withheld from a room that has
# no fridge in it.
STOPWORDS = frozenset(
    "a an the is are was were be been being in on at of to for with from and or but if then than that this "
    "these those it its you your i my me we our they their he she his her not no do does did have has had "
    "can could should would will may might must there here what which who whom whose when where why how".split()
)

# Per million tokens, read from `eval/manifests/model-rates.json`. Two readers, one card: the τ² driver
# and the TypeScript lanes already share it, and a third hardcoded table is the arrangement in which one
# of the three is eventually wrong.
RATE_CARD_PATH = HERE.parents[1] / "manifests" / "model-rates.json"


class LaneError(RuntimeError):
    """Something that makes the run unable to report a number."""


def fail(message: str) -> "None":
    print(f"FAIL {message}")
    raise SystemExit(1)


# --------------------------------------------------------------------------------------------------
# The rate card
# --------------------------------------------------------------------------------------------------


def load_rate_card(path: "Path | None" = None) -> dict:
    """The card, as the object the bill and the peak guard both read. Malformed means raise."""
    source = path or RATE_CARD_PATH
    card = json.loads(Path(source).read_text(encoding="utf-8"))
    prices = card.get("prices")
    default = card.get("defaultModel")
    if not isinstance(prices, dict) or not isinstance(default, str) or default == "":
        raise ValueError(f"model-rates.json has no 'prices'/'defaultModel': {source}")
    for band in ("peak", "off_peak"):
        rates = (prices.get(default) or {}).get(band)
        if not isinstance(rates, dict) or not {"miss", "hit", "out"} <= set(rates):
            raise ValueError(f"model-rates.json has no usable '{band}' band for {default}: {source}")
    if not isinstance(card.get("peakWindows"), list) or not card["peakWindows"]:
        raise ValueError(f"model-rates.json has no 'peakWindows': {source}")
    return card


def is_peak(card: dict, now: "datetime | None" = None) -> bool:
    """Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays, and it costs exactly twice as much."""
    moment = now or datetime.now(timezone.utc)
    if bool(card.get("peakWeekdaysOnly", True)) and moment.weekday() >= 5:
        return False
    hour = moment.hour
    return any(
        int(window["fromHourUtc"]) <= hour < int(window["toHourUtc"]) for window in card["peakWindows"]
    )


def bill_of(card: dict, prompt: int, cached: int, completion: int, now: "datetime | None" = None) -> dict:
    """What the tokens cost, in the band they were spent in, with the other band beside it."""
    peak = is_peak(card, now)
    rates = card["prices"][card["defaultModel"]]["peak" if peak else "off_peak"]
    other = card["prices"][card["defaultModel"]]["off_peak" if peak else "peak"]
    uncached = max(0, prompt - cached)

    def price(rate: dict) -> float:
        return round(
            cached / 1_000_000 * rate["hit"]
            + uncached / 1_000_000 * rate["miss"]
            + completion / 1_000_000 * rate["out"],
            6,
        )

    return {
        "usd": price(rates),
        "band": "peak" if peak else "off_peak",
        "rates": rates,
        "usd_in_other_band": price(other),
    }


# --------------------------------------------------------------------------------------------------
# The prompt
# --------------------------------------------------------------------------------------------------


def load_examples(path: "Path | None" = None) -> dict:
    """The two ReAct transcripts per task type, with the provenance the file carries."""
    payload = json.loads((path or HERE / "prompts" / "alfworld-examples.json").read_text(encoding="utf-8"))
    examples = payload.get("examples")
    if not isinstance(examples, dict) or len(examples) != 6:
        raise LaneError("alfworld-examples.json does not carry six task types")
    for kind, pair in examples.items():
        if not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(text, str) for text in pair):
            raise LaneError(f"alfworld-examples.json carries {kind} without exactly two transcripts")
    return payload


def task_kind_of(gamefile: str) -> str:
    """Which of the six task types a game belongs to, decided by the directory the split names.

    The split nests as `<task type>/<trial>/game.tw-pddl`, so the name matching a prefix is two levels
    above the file rather than one. Walking the parts downward instead of hardcoding the depth is what
    keeps this honest when a caller hands over the directory itself, or a path with a different number
    of levels.
    """
    for part in reversed(Path(gamefile).parts):
        if part.endswith(".pddl") or part.startswith("game."):
            continue
        for prefix, kind in TASK_KIND_PREFIXES:
            if part.startswith(prefix):
                return kind
    raise LaneError(f"no task type matches {Path(gamefile).name!r}; the six the split publishes are known by prefix")


def split_transcript(text: str) -> "list[tuple[str, str]]":
    """One ReAct transcript as alternating turns: `> …` is the agent, everything else is the world.

    This is what the competitor's `CYCLER` and `STEP_IDENTIFIER` do, and the merge below is why the
    few-shot block arrives as a conversation rather than as one wall of text: the model is being shown
    a format, and a format it has never seen applied to a role is a format it will not apply.
    """
    turns: "list[tuple[str, str]]" = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        role = "assistant" if line.lstrip().lower().startswith(">") else "user"
        if turns and turns[-1][0] == role:
            turns[-1] = (role, turns[-1][1] + "\n" + line)
        else:
            turns.append((role, line))
    return turns


def render_pack(entries: "list[str]") -> str:
    """The rule block, numbered, rendered whole. Empty when there is nothing to say.

    An empty arm renders an empty string rather than a sentence saying so: a block that announces its
    own emptiness is information the `none` arm does not receive, and the two arms would then differ in
    two places instead of one.
    """
    if not entries:
        return ""
    lines = [PACK_HEADER]
    for index, text in enumerate(entries, start=1):
        lines.append(f"{index}. {text}")
    return "\n".join(lines) + "\n\n"


def build_opening(
    examples: dict, kind: str, instruction: str, max_steps: int, pack: str
) -> "list[dict[str, str]]":
    """The messages every arm shares, with the pack (when there is one) above the examples."""
    opening: "list[dict[str, str]]" = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
    opening.append({"role": "user", "content": pack + HUMAN_TEMPLATE.format(instruction=instruction, max_steps=max_steps)})
    for transcript in examples["examples"][kind]:
        for role, content in split_transcript(transcript):
            opening.append({"role": role, "content": content})
    return opening


def parse_reply(reply: str) -> "tuple[str, str | None]":
    """`('thought', text)` or `('action', command)`, exactly as the competitor's parser decides.

    The action is lowercased because the competitor lowercases it before handing it to the
    environment; the environment is case-insensitive, so this changes nothing about the game and
    everything about matching a recorded action digest against a published one.
    """
    if re.match(THINK_PATTERN, reply):
        return "thought", re.sub(r"(?i)(?:>|)\s*think(?::|)\s*", "", reply).strip()
    if re.match(CARET_PATTERN, reply):
        return "action", re.sub(CARET_PATTERN, "", reply.lower()).strip()
    if re.match(ACTION_VERB_PATTERN, reply):
        return "action", re.sub(r">\s*", "", reply.lower()).strip()
    return "thought", reply.strip()


def words_of(text: str) -> "set[str]":
    """Lowercased alphanumeric words. The anchor's whole vocabulary, and deliberately a small one."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def anchor(query: str, entries: "list[str]", top_k: int) -> "list[str]":
    """The entries whose words the observation already contains, best overlap first.

    Lexical on purpose. A semantic retriever would need an embedding model, and the one this project
    has is currently rate-limited — but more to the point, the arm this control is compared against
    (`always-in`) needs no retriever at all, so a retriever with a learned component would confound
    *which entries* with *which embedding*. Ties keep bank order, so the function is deterministic.
    """
    tokens = words_of(query) - STOPWORDS
    if not tokens or not entries:
        return []
    scored = []
    for index, text in enumerate(entries):
        overlap = len(tokens & (words_of(text) - STOPWORDS))
        if overlap:
            scored.append((-overlap, index, text))
    scored.sort()
    return [text for _, _, text in scored[:top_k]]


# --------------------------------------------------------------------------------------------------
# The call
# --------------------------------------------------------------------------------------------------


def chat(
    messages: "list[dict[str, str]]", model: str, api_key: str, timeout: float, url: str = DEEPSEEK_URL
) -> "tuple[str, dict]":
    """One completion, with the provider's own usage object returned beside the text.

    `url` is a parameter so that the failure paths can be exercised against a real socket instead of a
    stubbed function: a refusal, an empty choice list and a response with no text are three different
    exceptions, and a run that confused them would report a broken key as a broken model.
    """
    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": 256,
            # `deepseek-flash` deliberates by default and bills the deliberation at the output rate.
            # ALFWorld's agent is one short action per turn, so the mode is pinned off and the choice
            # travels in the artefact rather than in a comment.
            "thinking": {"type": "disabled"},
        }
    ).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400]
        raise LaneError(f"HTTP {error.code} from the model endpoint: {detail}") from error
    except urllib.error.URLError as error:
        raise LaneError(f"the model endpoint was unreachable: {error.reason}") from error
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LaneError(f"the response carried no choices: {json.dumps(payload)[:300]}")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or content.strip() == "":
        raise LaneError(f"the response carried no text: {json.dumps(payload)[:300]}")
    usage = payload.get("usage") or {}
    return content, usage


def usage_numbers(usage: dict) -> "dict[str, int]":
    """The four counts the bill needs, with a missing one raising rather than reading as zero."""

    def number(name: str) -> int:
        value = usage.get(name, 0)
        if not isinstance(value, int):
            raise LaneError(f"usage.{name} is not an integer: {value!r}")
        return value

    return {
        "prompt_tokens": number("prompt_tokens"),
        "completion_tokens": number("completion_tokens"),
        "cache_hit_tokens": number("prompt_cache_hit_tokens"),
        "cache_miss_tokens": number("prompt_cache_miss_tokens"),
    }


# --------------------------------------------------------------------------------------------------
# The episode
# --------------------------------------------------------------------------------------------------


def run_episode(
    env,
    arm: str,
    policy: str,
    examples: dict,
    rules: "list[str]",
    draw: Draw,
    max_steps: int,
    top_k: int,
    model: str,
    api_key: str,
    timeout: float,
) -> dict:
    """One game, driven by one arm. Returns the episode record; never a partly-filled one."""
    observation, info = env.reset()
    raw_gamefile = info["extra.gamefile"]
    gamefile = game_key(raw_gamefile[0] if isinstance(raw_gamefile, (list, tuple)) else raw_gamefile)
    kind = task_kind_of(gamefile)

    opening: "list[dict[str, str]] | None" = None
    messages: "list[dict[str, str]]" = []
    actions: "list[str]" = []
    replies: "list[str]" = []
    thoughts = 0
    calls = 0
    invalid = 0
    off_space = 0
    pack_entries: "int | None" = None
    prefix_chars = 0
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "cache_hit_tokens": 0, "cache_miss_tokens": 0}
    observe_chars: "list[int]" = [len(str(observation[0]))]
    steps = 0
    done = False
    won = False
    last = str(observation[0])

    while not done and steps < max_steps:
        admissible = list(info.get("admissible_commands", [[]])[0])
        if not admissible:
            break

        if opening is None:
            # The instruction is the observation's first line after the room description. ALFWorld
            # writes it as `Your task is to: …`; a game that does not is a game this lane does not
            # know how to open, so it raises rather than guessing at a prompt.
            match = re.search(r"Your task is to: (.*)", last)
            if match is None:
                raise LaneError(f"{gamefile}: no task line in the first observation")
            instruction = f"Your task is to: {match.group(1)}\n"
            selected: "list[str]" = []
            if arm == "always-in":
                selected = list(rules)
            elif arm == "retrieved":
                selected = anchor(last, rules, top_k)
            pack_entries = len(selected)
            opening = build_opening(examples, kind, instruction, max_steps, render_pack(selected))
            prefix_chars = sum(len(message["content"]) for message in opening)
            messages = list(opening)
            messages.append({"role": "user", "content": last})

        consecutive_thoughts = 0
        action: "str | None" = None
        # Not `while action is None`: every path through this body either sets the action and breaks or
        # raises, so a condition that can only be falsified through the break is a branch no run can
        # take. `True` says what the loop means.
        while True:
            if policy == "model":
                reply, usage = chat(messages, model, api_key, timeout)
                numbers = usage_numbers(usage)
                for key, value in numbers.items():
                    usage_total[key] += value
                calls += 1
            elif policy == "seed":
                reply = f"> {admissible[draw.below(len(admissible))]}"
            else:
                reply = f"> {admissible[0]}"

            kind_of_reply, payload = parse_reply(reply)
            replies.append(reply)
            messages.append({"role": "assistant", "content": reply if reply.startswith(">") else f"> think: {reply}"})
            if kind_of_reply == "action" and payload:
                action = payload
                break
            # A thought does not move the world, and the competitor answers it with `OK.` — the same
            # string its examples carry — rather than with a fresh observation.
            thoughts += 1
            consecutive_thoughts += 1
            messages.append({"role": "user", "content": "OK."})
            if consecutive_thoughts >= MAX_THOUGHTS_PER_OBSERVATION:
                raise LaneError(
                    f"{gamefile}: {consecutive_thoughts} thoughts in a row without an action; "
                    f"last reply {reply[:160]!r}"
                )

        if action not in admissible:
            invalid += 1
            if re.match(ACTION_VERB_PATTERN, action) is None:
                off_space += 1
        actions.append(action)
        observation, _scores, dones, info = env.step([action])
        steps += 1
        done = bool(dones[0])
        last = str(observation[0])
        observe_chars.append(len(last))
        won = bool(info.get("won", [False])[0])
        messages.append({"role": "user", "content": last})

    return {
        "gamefile": gamefile,
        "task_kind": kind,
        "won": won,
        "steps": steps,
        "truncated": not done,
        "digest": digest_of(actions),
        "observe_chars": observe_chars,
        "observe_fingerprint": digest_of([str(count) for count in observe_chars]),
        "calls": calls,
        "thoughts": thoughts,
        "actions": len(actions),
        "invalid_actions": invalid,
        "off_space_actions": off_space,
        "pack_entries": pack_entries,
        "prefix_chars": prefix_chars,
        "prompt_chars": sum(len(message["content"]) for message in messages),
        "usage": dict(usage_total),
        "last_line": last.strip().splitlines()[-1][:120] if last.strip() else "",
    }


# --------------------------------------------------------------------------------------------------
# The pass
# --------------------------------------------------------------------------------------------------


def shard_bounds(shard: str, total: int) -> "tuple[int, int]":
    """`i/n` as a contiguous range, so that a dispatch can be split across jobs without overlap."""
    match = re.fullmatch(r"(\d+)/(\d+)", shard)
    if match is None:
        raise LaneError(f"--shard wants i/n, got {shard!r}")
    index, count = int(match.group(1)), int(match.group(2))
    if count < 1 or index < 0 or index >= count:
        raise LaneError(f"--shard {shard} is not a position in its own split")
    size = (total + count - 1) // count
    # Clamped at both ends: more shards than games is a legal dispatch (a pool of rushes that size) and
    # must produce empty slices rather than a range that runs backwards.
    start = min(total, index * size)
    return start, min(total, start + size)


def compare_with_floor(episodes: "list[dict]", floor_path: Path) -> dict:
    """The loop against the floor's own reading of the same games, field by field."""
    recorded = json.loads(floor_path.read_text(encoding="utf-8"))["episodes"]
    by_game = {episode["gamefile"]: episode for episode in recorded}
    mismatches = []
    for episode in episodes:
        reference = by_game.get(episode["gamefile"])
        if reference is None:
            mismatches.append({"gamefile": episode["gamefile"], "field": "missing", "floor": None})
            continue
        for field in ("won", "steps", "digest", "observe_fingerprint"):
            if episode[field] != reference[field]:
                mismatches.append(
                    {"gamefile": episode["gamefile"], "field": field, "this": episode[field], "floor": reference[field]}
                )
                break
    return {"games_compared": len(episodes), "mismatches": len(mismatches), "first": mismatches[0] if mismatches else None}


def main() -> int:
    parser = argparse.ArgumentParser(description="Drive one ALFWorld arm and bill it")
    parser.add_argument("--arm", choices=ARMS, default="none")
    parser.add_argument("--policy", choices=POLICIES, default="model")
    parser.add_argument("--rules", default="", help="a rendered rule bank; required by always-in and retrieved")
    parser.add_argument("--top-k", type=int, default=3, help="entries the retrieved arm may carry")
    parser.add_argument("--games", type=int, default=0, help="0 drives the whole split")
    parser.add_argument("--shard", default="0/1", help="i/n; the pass is sliced and each slice is a job")
    parser.add_argument("--max-steps", type=int, default=50, help="the environment's own cap")
    parser.add_argument("--seed", type=int, default=20261120)
    parser.add_argument("--model", default=os.environ.get("ALFWORLD_MODEL", DEFAULT_MODEL))
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--assert-floor", default="", help="a floor json the seed policy must reproduce")
    parser.add_argument("--out", default=str(HERE / "agent.json"))
    arguments = parser.parse_args()

    if arguments.arm != "none" and not arguments.rules:
        fail(f"--arm {arguments.arm} needs --rules; an empty bank is a different arm and is not assumed")
    if arguments.policy != "model" and arguments.shard != "0/1":
        fail("a sharded pass must be a model pass: the seed policy's sequence is a whole-pass sequence")

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if arguments.policy == "model" and api_key == "":
        fail("--policy model needs DEEPSEEK_API_KEY; this file does not fall back to a policy")

    rules: "list[str]" = []
    if arguments.rules:
        payload = json.loads(Path(arguments.rules).read_text(encoding="utf-8"))
        rules = [str(entry["text"]) if isinstance(entry, dict) else str(entry) for entry in payload["entries"]]
        cap = payload.get("cap")
        if isinstance(cap, int) and cap > 0:
            rules = rules[:cap]

    examples = load_examples()
    card = load_rate_card()

    env, num_games = build_env()
    total = num_games if arguments.games <= 0 else min(arguments.games, num_games)
    start, stop = shard_bounds(arguments.shard, total)
    draw = Draw(arguments.seed)

    print(
        f"arm={arguments.arm} policy={arguments.policy} games={start}..{stop - 1} of {total} "
        f"max_steps={arguments.max_steps} rules={len(rules)} model={arguments.model if arguments.policy == 'model' else '-'}"
    )
    episodes: "list[dict]" = []
    began = time.monotonic()
    # Ascending over the slice, and the slice is contiguous: a model pass needs nothing from the games
    # it does not drive, and `--policy seed` refuses to be sliced because its sequence is a whole-pass
    # sequence.
    for index in range(start, stop):
        episode = run_episode(
            env,
            arguments.arm,
            arguments.policy,
            examples,
            rules,
            draw,
            arguments.max_steps,
            arguments.top_k,
            arguments.model,
            api_key,
            arguments.timeout,
        )
        episodes.append(episode)
        if len(episodes) % 10 == 0 or index + 1 == stop:
            wins = sum(1 for item in episodes if item["won"])
            elapsed = time.monotonic() - began
            print(f"  {len(episodes)}/{stop - start}  wins={wins}  calls={sum(e['calls'] for e in episodes)}  {elapsed:.0f}s")

    elapsed = time.monotonic() - began
    seen = [episode["gamefile"] for episode in episodes]
    if len(seen) != len(set(seen)):
        fail("a game was driven twice, so the slice does not mean what it says")
    truncated = [episode["gamefile"] for episode in episodes if episode["truncated"]]
    if truncated:
        fail(f"{len(truncated)} episodes never terminated, first {truncated[0]}")

    wins = sum(1 for episode in episodes if episode["won"])
    usage = {
        key: sum(episode["usage"][key] for episode in episodes)
        for key in ("prompt_tokens", "completion_tokens", "cache_hit_tokens", "cache_miss_tokens")
    }
    calls = sum(episode["calls"] for episode in episodes)
    if arguments.policy == "model" and calls == 0:
        fail("a model pass recorded no calls, so its bill would be zero for the wrong reason")

    bill = bill_of(card, usage["prompt_tokens"], usage["cache_hit_tokens"], usage["completion_tokens"])
    low, high = wilson(wins, len(episodes))
    prefix_chars = [episode["prefix_chars"] for episode in episodes if episode["prefix_chars"]]
    summary = {
        "arm": arguments.arm,
        "policy": arguments.policy,
        "model": arguments.model if arguments.policy == "model" else None,
        "seed": arguments.seed,
        "shard": arguments.shard,
        "max_steps": arguments.max_steps,
        "top_k": arguments.top_k if arguments.arm == "retrieved" else None,
        "rules_in_bank": len(rules),
        "games_requested": total,
        "games_driven": len(episodes),
        "wins": wins,
        "rate": round(wins / len(episodes), 4) if episodes else 0.0,
        "wilson_low": round(low, 4),
        "wilson_high": round(high, 4),
        "steps_mean": round(sum(episode["steps"] for episode in episodes) / len(episodes), 2) if episodes else 0.0,
        "calls": calls,
        "thoughts": sum(episode["thoughts"] for episode in episodes),
        "invalid_actions": sum(episode["invalid_actions"] for episode in episodes),
        "off_space_actions": sum(episode["off_space_actions"] for episode in episodes),
        "usage": usage,
        "cache_hit_rate": round(usage["cache_hit_tokens"] / usage["prompt_tokens"], 4) if usage["prompt_tokens"] else None,
        "prefix_chars_mean": round(sum(prefix_chars) / len(prefix_chars), 1) if prefix_chars else None,
        "prompt_chars_mean": round(sum(episode["prompt_chars"] for episode in episodes) / len(episodes), 1) if episodes else None,
        "bill": bill,
        "elapsed_s": round(elapsed, 1),
    }

    determinism = None
    if arguments.assert_floor:
        determinism = compare_with_floor(episodes, Path(arguments.assert_floor))
        if determinism["mismatches"]:
            fail(f"the loop does not reproduce the floor: {json.dumps(determinism['first'])}")
        summary["floor_agreement"] = determinism

    Path(arguments.out).write_text(
        json.dumps({"summary": summary, "episodes": episodes}, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print("")
    print(f"{arguments.arm} over {len(episodes)} games: {wins} wins = {100 * summary['rate']:.1f}%")
    print(f"  wilson 95%      [{100 * summary['wilson_low']:.1f}, {100 * summary['wilson_high']:.1f}]")
    print(f"  calls           {calls} ({summary['thoughts']} thoughts, {summary['invalid_actions']} invalid actions)")
    print(f"  cache hit rate  {summary['cache_hit_rate']}")
    print(f"  prefix chars    {summary['prefix_chars_mean']}")
    print(f"  bill            ${bill['usd']} ({bill['band']}); other band ${bill['usd_in_other_band']}")
    if determinism is not None:
        print(f"  floor agreement {determinism['games_compared']} games, {determinism['mismatches']} mismatches")
    print(f"  written         {arguments.out}")
    print("PASS the arm ran and its accounting closes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
