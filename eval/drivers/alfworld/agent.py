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

**Why the pack is fixed per episode, and where it sits.** DeepSeek caches on a token-block prefix, so a
block that changes every turn makes every turn after it a miss; the τ² lane paid for that lesson already
(R57's Amendment 4). The pack is therefore rendered once per episode, and it is prepended to the first
observation — after the examples, immediately before the game's own text — because that is where the
competitor puts it (`insert_before_task_prompt` appends the rule block after the few-shot block and
before the task line in `agent/react.py@LeapLabTHU/ExpeL`). Everything before the first observation is
fixed for the episode, so the prefix is stable either way; the position is fidelity, not caching.

**What this skeleton does not reproduce, stated once.** The competitor sends its two example transcripts
inside one human message and carries the task at the end (`Now it's your turn!\n<task>`); this file
splits each transcript into alternating turns and carries the task line at the top of the first human
turn. Both are renderings of the same prompt, they are identical across arms, so the paired delta this
lane reports is unaffected by them — but a comparison against a published absolute number is a
comparison of two different renderings, and that limit is registered rather than argued away.

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
import hashlib
import http.client
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

ARMS = ("none", "always-in", "retrieved", "sham")
# The registered retrieval budget. Named as a constant because the arm's label is derived from it: the two have to
# agree, or `retrieved` at its own default would be labelled as if it were a contrast.
DEFAULT_TOP_K = 3
# The three splits the installed environment publishes, in its own names. `eval_in_distribution` is
# `valid_seen` (140 games) and it is *training* data for the rule bank: ExpeL extracts its rules there
# and reports on `valid_unseen`, and a bank distilled from the held-out split would be a leak dressed
# as a memory.
SPLITS = ("eval_out_of_distribution", "eval_in_distribution", "train")
# How many games each split publishes, counted from the installed corpus rather than quoted:
# `find <split> -name game.tw-pddl | wc -l` gives 134, 140 and 3,553. Two things need the number. A `--games`
# larger than the split it names is a typo that would otherwise be bought as a shorter pass with a rate that
# reads like a full one. And a join across two sections has to know which section's size its tiling check holds
# to, because a 274-game reading that quietly tiled 134 twice is a doubled denominator (AUDIT 34.251).
SPLIT_SIZES = {"eval_out_of_distribution": 134, "eval_in_distribution": 140, "train": 3553}
# The directory each of those names lives in inside the published corpus. The environment renames the
# sections (`valid_unseen` is `eval_out_of_distribution`), and the two names have to be related somewhere
# or every count of the corpus is an argument about which directory was meant.
SPLIT_DIRS = {"eval_out_of_distribution": "valid_unseen", "eval_in_distribution": "valid_seen", "train": "train"}
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

# The rules block, in the competitor's own words. `prompts/templates/human.py@LeapLabTHU/ExpeL` carries
# it as `RULE_TEMPLATE['alfworld']` and its grammar is left alone deliberately — *"experience you
# gather"*, not *"experiences you gathered"* — because an arm that is offered as the competitor's
# mechanism is a rendering of the competitor's prompt, and a silently corrected sentence is a
# difference between two arms that nobody registered.
#
# This replaced a header written by this project ("Rules from earlier attempts:"). The replacement is
# not cosmetic: the `always-in` arm is the control for a published 19pp, and a control rendered in this
# repository's voice rather than the paper's is a measurement of this repository's prompt with the
# paper's name on it.
PACK_HEADER = (
    "The following are some experience you gather on a similar task of completing a household task by "
    "interacting in a household environment. Use these as references to help you perform this task:"
)

# The competitor's parser, transliterated. Order matters: a reply that opens with `> think` is a
# thought even if the rest of it looks like an action, and a reply with no prefix at all is wrapped as
# one rather than being thrown away.
THINK_PATTERN = r"(?i)(?:>|)\s*think(?::|)"
CARET_PATTERN = r"(?i)>\s*"
ACTION_VERB_PATTERN = r"(?i)(?:go to|open|take|put|use|heat|cool|look|clean|inventory)"

# What the model hears when the turn it wrote did not reach the world. `OK.` is the examples' own token for
# a thought that was only a thought (`react_put_0` answers four of them that way), and it is a true answer to
# such a turn. It is **not** a true answer to a reply whose first line is a thought and whose later line is a
# command: the first-line rule refuses that command, nothing moves, and answering `OK.` told the model the
# command had executed. The corpus has its own word for a command that changed nothing -- `Nothing happens.`,
# the string a rejected action gets -- so that is the string a refused turn gets, and it is the string the
# model already knows the meaning of (AUDIT 34.259).
NO_OP = "Nothing happens."
# The guard's line, and the whole of R189. `OK.` answers a thought truthfully and that is exactly the problem: a model
# that has started narrating is told, once per turn, that narrating is a fine thing to do. This answer says the same
# `OK.` and then names the requirement, which is the one sentence a loop turn can be interrupted by without a second
# call, without a second pack and without a rule that would sit in front of the 98.7% of turns that are not loops.
# It is a function of the state the episode is in -- the previous reply carried no command -- so it cannot fire in a
# game that never enters the state, and `guard_fires` is recorded per episode so a join can prove it engaged.
COMMAND_GUARD = "OK. Reply with one command only."
# How many refused commands an episode quotes back beside the count. Three is enough to name the shape of a
# model's mistake in an arm file and small enough that a 274-game pass does not become a transcript.
REFUSED_SAMPLES = 3

# The parser is the one part of the harness this lane refused to change, because every published number on this
# corpus was produced by it and a lane that changes its own reader cannot be compared to the rows it is compared
# to. R180 and R182 spent two rounds trying to reach the format from the prompt instead and moved it by 0.00 pp and
# 15% (AUDIT 34.261). R183 therefore makes the change explicit as a **channel**: a second reader that executes the
# command the first-line rule refuses, named in every episode, in every label, and in every join (AUDIT 34.262).
#
# `reference` is the competitor's parser transliterated -- `re.match` anchored at the first line -- and it stays the
# default forever, because an artefact written before this field existed was driven by it.
REFERENCE_PARSER = "reference"
# The same first-line rule, with one addition: when the first line is a thought and a later line is a command, that
# command is executed instead of dropped. The reply is not re-read and nothing is invented; the only difference is
# what happens to a command the rule found and refused.
ANY_LINE_PARSER = "any-line"
PARSERS = (REFERENCE_PARSER, ANY_LINE_PARSER)
# How a channel is spelled inside a label, which is a token and not a sentence: `always-in@anyline`.
PARSER_TOKENS = {ANY_LINE_PARSER: "anyline"}

# Three thoughts in a row is what the competitor's own examples contain at their most deliberate, so a
# run of three is counted rather than punished. What is punished is spending without stepping: a thought
# consumes one of the `max_steps` turns exactly as an action does, because the alternative -- thoughts free,
# actions capped -- is an episode that can call the model forever and never reach the environment's verdict.
#
# The first version of this file raised when three thoughts arrived in a row. The first dispatch found out
# what that costs: on `pick_cool_then_place_in_recep-Bread`, the model reached the end of its patience and
# began narrating ("I was unable to complete the task..."), which is a *failure the arm is supposed to
# record*, and the run died two minutes in with zero games driven. A skeleton that cannot represent a
# model giving up cannot measure an arm whose whole question is how often the model gives up.
STALL_THOUGHTS = 3

DEFAULT_MODEL = "deepseek-flash"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

# The retry policy, as numbers rather than as a description. A 134-game sweep is ~5,000 calls and a training
# slice ~1,300 over four hours; the failed run `44685314225` had made 722 successful calls when one connection
# was closed before its response, and the whole job ended there. Five attempts at 1+2+4+8 seconds bounds the
# waiting at 15 seconds out of four hours, which is the trade a run this long wants: the alternative was not
# "no waiting", it was "no result".
RETRY_SECONDS = (1.0, 2.0, 4.0, 8.0)
RETRY_ATTEMPTS = len(RETRY_SECONDS) + 1
TRANSIENT_STATUS = frozenset({408, 429, 500, 502, 503, 504})

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

    A multi-line entry keeps its number on the first line and is indented under it, so a bank that holds a
    verbatim transcript renders as one item rather than as a numbered line followed by unnumbered prose. For
    a single-line entry — every bank before `bank-rawput-1.json` — the two branches produce the same bytes,
    which is what keeps every earlier arm's rendered length and price unchanged.

    The trailing blank line is this file's separator between the block and the room description that
    follows it. The competitor separates the same two things with a task line (`Now it's your turn!`),
    which this skeleton carries at the top of the first human turn instead; see the module docstring on
    what that costs and what it does not.
    """
    if not entries:
        return ""
    lines = [PACK_HEADER]
    for index, text in enumerate(entries, start=1):
        body = str(text).split("\n")
        lines.append(f"{index}. {body[0]}")
        lines.extend(f"   {line}" for line in body[1:])
    return "\n".join(lines) + "\n\n"


def build_opening(examples: dict, kind: str, instruction: str, max_steps: int) -> "list[dict[str, str]]":
    """The messages every arm shares: the system line, the instruction, and the two examples.

    The pack is not here. It is prepended to the first observation instead, which is where the
    competitor puts it — after the examples, immediately before the game's own text, with only the task
    line in between. Two consequences, both wanted: the `none` arm's prompt is *byte-identical* to the
    one the 20-game calibration measured (nothing is inserted), and the arms still differ in exactly
    one block.
    """
    opening: "list[dict[str, str]]" = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
    opening.append({"role": "user", "content": HUMAN_TEMPLATE.format(instruction=instruction, max_steps=max_steps)})
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


def refused_command(reply: str) -> "str | None":
    """The command a thought reply carried on a later line, which the first-line rule refuses.

    The rule itself is the competitor's and is not changed here: `re.match` anchors at the start, so a reply
    that opens with `> think` is a thought and the command under it is dropped. What the rule drops has to be
    *counted*, because the drop is invisible in every other field of the record -- the command is never
    handed to the environment, so it is not an invalid action, not a stalled thought, and not a turn the arm
    can see. The transcript is the only place it shows, and a transcript is not what the lane prices.

    Returned rather than executed, and returned rather than discarded: `run_episode` answers the turn with the
    corpus's own no-op string when this is not `None`, which is the difference between a model that is told
    nothing happened and a model that is told its `put` worked.
    """
    for line in reply.splitlines()[1:]:
        kind, payload = parse_reply(line.strip())
        if kind == "action" and payload:
            return payload
    return None


def words_of(text: str) -> "set[str]":
    """Lowercased alphanumeric words. The anchor's whole vocabulary, and deliberately a small one."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def permute_words(text: str, seed: int) -> str:
    """The same words in an order that means nothing, deterministically.

    Fisher-Yates over the rule's own tokens with the splitmix64 `Draw` the floor uses, so the sham is a
    function of `(text, seed)` and of nothing else: a bank loaded twice renders the same block, and two
    runs that happened to list the rules in a different order still produce the same sham for the same rule.

    A one-word rule is returned unchanged rather than reordered — there is nothing to reorder, and the
    alternative (dropping it) would change the entry count, which is the one surface property the sham has
    to preserve.
    """
    words = text.split()
    if len(words) < 2:
        return text
    draw = Draw(seed)
    shuffled = list(words)
    for index in range(len(shuffled) - 1, 0, -1):
        swap = draw.below(index + 1)
        shuffled[index], shuffled[swap] = shuffled[swap], shuffled[index]
    return " ".join(shuffled)


def sham_entries(entries: "list[str]") -> "list[str]":
    """The placebo: every rule permuted inside itself, seeded by the rule's own text.

    `arXiv:2601.22436` finds that agents respond to a condensed block's existence and shape more than to its
    semantic content — corrupt, irrelevant and filler summaries often leave the score where it was while an
    emptied raw trajectory collapses it. Word permutation is the tightest surface match available: the entry
    count, the token count, the punctuation and the header are all exactly the bank's, and only the order
    carries no information. If this arm earns the bank's delta, the delta is about format.

    The seed is derived from the text rather than from the position, so the sham does not depend on the order
    the bank happens to be stored in — a permuted bank file must still produce a permuted prompt, not a
    differently-permuted one.
    """
    return [permute_words(str(text), int(hashlib.sha256(str(text).encode("utf-8")).hexdigest()[:12], 16)) for text in entries]


def arm_label(
    arm: str,
    top_k: int,
    gate_share: float,
    gate_kind: bool = False,
    parser: str = REFERENCE_PARSER,
    guard_commandless: bool = False,
) -> str:
    """The arm's identity, including only the knobs that were moved off their registered values.

    `retrieved` at k=3 and `retrieved` at k=1 are two treatments with one name, and so are the ungated and the gated
    one. Their artefacts carry `arm=retrieved` either way, so a sweep that dispatched both would leave the reading
    grouping two arms into one — refused as doubled games, after the money is spent. The label is the family plus
    the moved knobs, in a fixed order, so that `--compare "retrieved@k1,none"` names one arm and not a family.

    `gate_kind` is the second gate and it applies to the pack arms as well as to retrieval, which is why it can be
    the only moved knob: `always-in@kind` is the six-sentence store carrying one sentence per game, and it is a
    different treatment from `always-in`. On the control it moves nothing — the control carries no bank, so there
    is nothing to select and its artefact records `gate_kind: null` — and the label stays `none`, because a knob
    that selects from an empty set has not been moved. Renaming it `none@kind` would have split the control family
    in two and made the one arm every other reading is compared against unrecognisable in aggregate (AUDIT 34.246).

    `parser` is the harness rather than the prompt, and it is in the label for the same reason the budget is: two
    channels of one arm are two harnesses, and a join that grouped them would refuse the doubled games only after
    both were paid for. It moves even on the control — `none@anyline` — because the channel changes what the
    environment does with a reply, so unlike a pack knob it is never selecting from an empty set.

    The registered arms keep the names they have always had: a label that appeared only when a knob moved means the
    default reading is unchanged, which is what makes every artefact before this one still comparable.

    `guard_commandless` is the fourth harness knob and the only one that changes the driver's own answer rather than
    the prompt or the reader, so it travels in the label for the same reason the channel does: R189's two arms are one
    family, one bank, one channel and one cap, and this token is the entire difference between them. A join that
    grouped them would refuse the doubled games only after both were paid for.
    """
    moved = []
    if arm == "retrieved":
        if top_k != DEFAULT_TOP_K:
            moved.append(f"k{top_k}")
        if gate_share > 0:
            moved.append(f"g{gate_share:g}")
    if gate_kind and arm != "none":
        moved.append("kind")
    if parser != REFERENCE_PARSER:
        moved.append(PARSER_TOKENS.get(parser, parser.replace("-", "")))
    if guard_commandless:
        moved.append("guard")
    return f"{arm}@{'+'.join(moved)}" if moved else arm


def applicable(rules: "list[str]", kinds: "list[list[str]] | None", kind: str) -> "list[str]":
    """The rules a game of this kind may carry: an untagged rule everywhere, a tagged one where it is claimed.

    R174.2 is why this exists. The read-time gate it registered — a floor on the share of the observation's own
    content words a rule must account for — admitted **nothing** on this corpus in 134 of 134 games, because a
    room description is 22 content words of furniture and a rule is a sentence about an action: the largest
    overlap available is one word, and the floor asked for five. The gate was therefore not a filter that was
    too strict; it was a filter on the wrong signal.

    What the harness knows before the first call, and for nothing, is the game's own task kind, read out of the
    gamefile's path by `task_kind_of`. A bank that tags its sentences (`"kinds": ["put", "puttwo"]`) can carry
    one sentence per game, which is the shape the product needs — a store as wide as the corpus and a pack as
    narrow as one line. An entry with no tags is carried everywhere, which is what keeps every artefact before
    this one comparable: the knob is inert on an untagged bank.

    A kinds list that does not line up with the rules is refused rather than zipped, because the misalignment is
    precisely what a cap applied to `rules` and not to `kinds` produces — and its symptom is an arm that carries
    the sentence it believes it dropped.
    """
    if kinds is None:
        return list(rules)
    if len(kinds) != len(rules):
        fail(f"{len(kinds)} kind tags for {len(rules)} rules: a tag list that does not line up cannot select")
    return [text for text, tags in zip(rules, kinds) if not tags or kind in tags]


def anchor(query: str, entries: "list[str]", top_k: int, floor_share: float = 0.0) -> "list[str]":
    """The entries whose words the observation already contains, best overlap first.

    Lexical on purpose. A semantic retriever would need an embedding model, and the one this project
    has is currently rate-limited — but more to the point, the arm this control is compared against
    (`always-in`) needs no retriever at all, so a retriever with a learned component would confound
    *which entries* with *which embedding*. Ties keep bank order, so the function is deterministic.

    `floor_share` is the read-time gate `arXiv:2610.07311` names rather than implies: memory that is correctly
    stored and correctly retrieved still distorts inference when only part of its evidence transfers, and the harm
    peaks at *intermediate* overlap. Ranking by a count has no notion of intermediate — a rule sharing one word
    with a long observation is admitted exactly as a rule sharing five — so the gate is a floor on the share of
    the observation's own content words the rule must account for. It runs before the budget, so a gated arm
    carries fewer entries and its prefix is shorter, which is visible in `pack_entries` and in the bill.

    Zero is the registered arm and means what it always meant: any overlap at all. A floor above 1.0 can never be
    met, which is not an error — it is the "carry nothing" end of the contrast, and it is cheaper than an arm.
    """
    tokens = words_of(query) - STOPWORDS
    if not tokens or not entries:
        return []
    scored = []
    for index, text in enumerate(entries):
        overlap = len(tokens & (words_of(text) - STOPWORDS))
        if not overlap:
            continue
        if floor_share > 0 and overlap / len(tokens) < floor_share:
            continue
        scored.append((-overlap, index, text))
    scored.sort()
    return [text for _, _, text in scored[:top_k]]


# --------------------------------------------------------------------------------------------------
# The call
# --------------------------------------------------------------------------------------------------


def transient(error: BaseException) -> bool:
    """Whether an error is the network rather than the request.

    The distinction decides whether a pass spends fifteen more seconds or four more hours, and it is a table
    rather than a guess: a dropped connection, a body cut short, a refusal, a timeout and the five server-side
    statuses are all things that were true only for a moment. A 400 is the endpoint saying this request is
    wrong, and retrying it would report a broken key as a broken network.

    Why the original handler missed the case that killed run `44685314225`: `http.client.RemoteDisconnected`
    derives from `ConnectionResetError`, not from `urllib.error.URLError`, so the `except URLError` clause never
    saw it, the traceback escaped, and a four-hour job ended at game 20 of 35. `http.client.HTTPException` is
    the branch that covers what a socket actually raises.
    """
    if isinstance(error, urllib.error.HTTPError):
        return error.code in TRANSIENT_STATUS
    return isinstance(error, (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError))


def attempt_once(body: bytes, url: str, api_key: str, timeout: float) -> dict:
    """One POST, decoded. Everything it can raise is the caller's to classify."""
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def parse_completion(payload: dict) -> "tuple[str, dict]":
    """The text and the usage out of a decoded response, or an error naming which of the three shapes failed.

    A refusal, an empty choice list and a response with no text are three different exceptions, and a run that
    confused them would report a broken key as a broken model. Split out from the request so that the three
    shapes are testable as values rather than as sockets.
    """
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LaneError(f"the response carried no choices: {json.dumps(payload)[:300]}")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or content.strip() == "":
        raise LaneError(f"the response carried no text: {json.dumps(payload)[:300]}")
    return content, payload.get("usage") or {}


def chat(
    messages: "list[dict[str, str]]",
    model: str,
    api_key: str,
    timeout: float,
    url: str = DEEPSEEK_URL,
    attempts: int = RETRY_ATTEMPTS,
    sleep=time.sleep,
) -> "tuple[str, dict, int]":
    """One completion, retried while the failure is the network's, with the retry count returned beside it.

    `url` and `sleep` are parameters so that the failure paths are exercised against a real socket and the
    backoff is asserted as numbers: the backoff is a cost (1+2+4+8 seconds out of four hours), and a test that
    waited for it would be a test nobody runs.

    The retry count is returned rather than swallowed because it is evidence about the provider. A pass that
    reports `retries: 0` and a pass that reports `retries: 37` produced their scores under different conditions,
    and a reader deciding whether a number will repeat needs to know which one they have.
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

    retries = 0
    while True:
        try:
            payload = attempt_once(body, url, api_key, timeout)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:400]
            if error.code not in TRANSIENT_STATUS:
                # The endpoint saying this request is wrong. Retrying it would spend four attempts on a fact
                # that will not change, and report a broken key as a broken network.
                raise LaneError(f"HTTP {error.code} from the model endpoint: {detail}") from error
            failure: BaseException = LaneError(f"HTTP {error.code} from the model endpoint: {detail}")
        except Exception as error:  # noqa: BLE001 -- classified by `transient`, which is a table with a test
            if not transient(error):
                raise
            failure = error
        else:
            content, usage = parse_completion(payload)
            return content, usage, retries
        if retries >= attempts - 1:
            raise LaneError(
                f"the model endpoint failed {attempts} attempts in a row; the last cause was "
                f"{type(failure).__name__}: {failure}"
            ) from failure
        sleep(RETRY_SECONDS[min(retries, len(RETRY_SECONDS) - 1)])
        retries += 1


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
    trace: int = 0,
    record_transcripts: bool = False,
    gate_share: float = 0.0,
    rule_kinds: "list[list[str]] | None" = None,
    gate_kind: bool = False,
    parser: str = REFERENCE_PARSER,
    guard_commandless: bool = False,
) -> dict:
    """One game, driven by one arm. Returns the episode record; never a partly-filled one.

    `record_transcripts` adds the trajectory in the shape the competitor's critique prompt reads it —
    the first observation, then every reply as `> …` prefixed and every answer to it as its own line —
    which is what a rule bank has to be distilled from. It is off by default because 134 transcripts
    are about 700 KB of artefact that a scored run has no use for, and an artefact nobody reads is a
    field that quietly stops being true.
    """
    # Checked before the first call rather than after the bill: `any_line` is one character from `any-line` and it
    # would be a 274-game pass whose channel nobody can name afterwards.
    if parser not in PARSERS:
        fail(f"parser {parser!r} is not one of {PARSERS}; the channel is spelled exactly or not driven at all")
    observation, info = env.reset()
    raw_gamefile = info["extra.gamefile"]
    gamefile = game_key(raw_gamefile[0] if isinstance(raw_gamefile, (list, tuple)) else raw_gamefile)
    kind = task_kind_of(gamefile)

    opening: "list[dict[str, str]] | None" = None
    messages: "list[dict[str, str]]" = []
    actions: "list[str]" = []
    replies: "list[str]" = []
    thoughts = 0
    stalls = 0
    calls = 0
    retries = 0
    invalid = 0
    off_space = 0
    refused = 0
    refused_samples: "list[str]" = []
    # The same event on the other side of the parser. A reply whose first line is a thought and whose later line is a
    # command is one format event either way; the reference channel drops the command and counts it as `refused`,
    # the any-line channel executes it and counts it here. Keeping both means a channel can be shown to have driven
    # the same model behaviour rather than a repaired model (AUDIT 34.262).
    recovered = 0
    recovered_samples: "list[str]" = []
    # The guard's three counters. `fires` is the line sent, `checked` is the fires a later reply answered, and
    # `relapsed` is the ones whose answer carried no command either. A fire on the last turn of a pass is unchecked
    # rather than relapsed: there is no later reply to read, and counting it either way would invent an outcome.
    guard_fires = 0
    guard_checked = 0
    guard_relapsed = 0
    guard_pending = False
    pack_entries: "int | None" = None
    # The rendered pack's length, as opposed to the prefix's. `prefix_chars` is the whole fixed prompt — examples,
    # system instruction and pack — so two arms of different lengths differ by a number that also contains the
    # examples. This records the pack alone, which is what a length-matched experiment has to compare and what
    # `aggregate.py` now reports beside `carried` (AUDIT 34.249).
    pack_chars: "int | None" = None
    # Which pack this game read, as content rather than as a filename. Under a kind gate this changes with the kind,
    # which is the point: the pass is one bank and the games are several packs.
    pack_digest = ""
    prefix_chars = 0
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "cache_hit_tokens": 0, "cache_miss_tokens": 0}
    observe_chars: "list[int]" = [len(str(observation[0]))]
    steps = 0
    done = False
    won = False
    last = str(observation[0])
    # The trajectory, in the competitor's rendering: the game's own text first, then `> reply` and its
    # answer on alternating lines. Built only when asked for, but built the same way either way — a
    # second function that reconstructed it from `messages` afterwards would be a second answer to
    # "what did this episode look like".
    trajectory: "list[str]" = [last.strip()]

    # `steps` counts model turns, not environment steps: a thought spends one and moves nothing, which is
    # how a turn budget bounds the bill while leaving the world's own 50-step cap to decide the game.
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
            if arm == "always-in" or arm == "sham":
                # `sham` is permuted once in `main`, before the pass starts, so the block is as fixed as
                # `always-in`'s and the two arms cost the same prefix. Permuting here would re-permute per
                # episode and turn a length-matched control into a moving block.
                selected = applicable(rules, rule_kinds, kind) if gate_kind else list(rules)
            elif arm == "retrieved":
                # The kind gate runs before the anchor rather than after it, so the retriever can only choose
                # among the sentences this game's task claims; gating the output instead would let the anchor
                # spend its budget on rules that were never applicable.
                pool = applicable(rules, rule_kinds, kind) if gate_kind else rules
                selected = anchor(last, pool, top_k, gate_share)
            pack_entries = len(selected)
            pack = render_pack(selected)
            pack_chars = len(pack)
            pack_digest = digest_of(selected) if selected else ""
            opening = build_opening(examples, kind, instruction, max_steps)
            prefix_chars = sum(len(message["content"]) for message in opening) + len(pack)
            messages = list(opening)
            messages.append({"role": "user", "content": pack + last})

        consecutive_thoughts = 0
        action: "str | None" = None
        # Not `while action is None`: every path through this body either sets the action and breaks or
        # raises, so a condition that can only be falsified through the break is a branch no run can
        # take. `True` says what the loop means.
        while True:
            if policy == "model":
                reply, usage, retried = chat(messages, model, api_key, timeout)
                numbers = usage_numbers(usage)
                for key, value in numbers.items():
                    usage_total[key] += value
                calls += 1
                retries += retried
                if retried:
                    # Printed because a run that survived a provider incident is a run whose score carries a
                    # caveat, and the reader of the log is the only one who can decide whether it matters.
                    print(f"  [{gamefile.split('/')[-3]}] the endpoint failed and then answered ({retried} retries)")
            elif policy == "seed":
                reply = f"> {admissible[draw.below(len(admissible))]}"
            else:
                reply = f"> {admissible[0]}"

            kind_of_reply, payload = parse_reply(reply)
            # Read once, before the branch, because the guard's ledger needs to know whether *this* reply carried a
            # command -- a reply whose first line is a thought and whose later line is one did carry it, and a guard
            # that counted it as a relapse would report its own recovery as a failure.
            refused_here = refused_command(reply)
            if guard_pending:
                # The previous turn fired the guard, so this reply is the answer to it. `checked` is the denominator
                # and `relapsed` the numerator: the registered question is "does an interrupted reply come back with
                # a command", and a fire nobody answered is not evidence either way.
                guard_pending = False
                guard_checked += 1
                if kind_of_reply != "action" and refused_here is None:
                    guard_relapsed += 1
            replies.append(reply)
            if trace and len(replies) <= trace:
                print(f"  [{gamefile.split('/')[-3]}] turn {len(replies)} {kind_of_reply}: {reply[:160]!r}")
            spoken = reply if reply.startswith(">") else f"> think: {reply}"
            messages.append({"role": "assistant", "content": spoken})
            trajectory.append(spoken)
            if kind_of_reply == "action" and payload:
                action = payload
                break
            if refused_here is not None and parser == ANY_LINE_PARSER:
                # The command the first-line rule refuses is executed instead of dropped. The reply is not re-read
                # and nothing is invented: the parser found this command and refused it, and this channel is the
                # one where the refusal is not the end of the turn. It leaves the same way an action does -- through
                # the environment -- so it is counted as an action turn and the model is answered with an
                # observation (AUDIT 34.262).
                recovered += 1
                if len(recovered_samples) < REFUSED_SAMPLES:
                    recovered_samples.append(refused_here)
                action = refused_here
                break
            # A thought does not move the world, and the competitor answers it with `OK.` — the same
            # string its examples carry — rather than with a fresh observation. A reply that carried a
            # command under its first line is the exception: the command was refused, nothing moved, and the
            # answer has to say so (AUDIT 34.259).
            thoughts += 1
            steps += 1
            consecutive_thoughts += 1
            if consecutive_thoughts == STALL_THOUGHTS:
                stalls += 1
            if refused_here is not None:
                refused += 1
                if len(refused_samples) < REFUSED_SAMPLES:
                    refused_samples.append(refused_here)
            if refused_here is not None:
                answer = NO_OP
            elif guard_commandless:
                # The registered change, and the whole of it: the same answer, with the requirement named. The pack,
                # the reader, the cap and the call count are untouched, so anything this arm moves is the loop being
                # interrupted and nothing else (R189).
                answer = COMMAND_GUARD
                guard_fires += 1
                guard_pending = True
            else:
                answer = "OK."
            messages.append({"role": "user", "content": answer})
            trajectory.append(answer)
            if steps >= max_steps:
                # The budget ran out on a thought, so the episode ends without another environment step.
                break

        if action is None:
            # Every turn went on a thought. The episode ends where the budget ends, which is a verdict the
            # arm records rather than an infrastructure failure that hides it.
            break
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
        trajectory.append(last.strip())

    record = {
        "gamefile": gamefile,
        "task_kind": kind,
        "won": won,
        "steps": steps,
        # Two different unfinished endings, and conflating them was a bug the second dispatch found.
        # `budget_exhausted` is the pass's own cap doing its job -- a model that has not finished by turn
        # `max_steps` is a result. `truncated` is the environment ending nothing while the pass still had
        # turns left, which is a driver defect and fails the run.
        "truncated": not done and steps < max_steps,
        "budget_exhausted": not done and steps >= max_steps,
        "digest": digest_of(actions),
        "observe_chars": observe_chars,
        "observe_fingerprint": digest_of([str(count) for count in observe_chars]),
        "calls": calls,
        "retries": retries,
        "thoughts": thoughts,
        "stalls": stalls,
        "actions": len(actions),
        "invalid_actions": invalid,
        "off_space_actions": off_space,
        # A command the parser refused because the reply opened with a thought. Recorded beside the invalid
        # actions because they are the two ways a turn can fail to reach the world, and only one of them was
        # visible before: an invalid action is attempted and counted, a refused one is dropped in silence.
        "refused_actions": refused,
        "refused_samples": refused_samples,
        # The same format event, executed rather than dropped. Zero on the reference channel by construction, which
        # is what makes it readable: a channel that recovered nothing did not meet the format at all.
        "recovered_actions": recovered,
        "recovered_samples": recovered_samples,
        # The guard, per episode. `guard` is recorded on both arms rather than only on the guarded one: a field that is
        # absent from the control cannot be told apart from a control that was never armed, which is the ambiguity
        # `refused_actions` had to be read with for two rounds (AUDIT 34.259).
        "guard": bool(guard_commandless),
        "guard_fires": guard_fires,
        "guard_checked": guard_checked,
        "guard_relapsed": guard_relapsed,
        # Which reader drove this game. In the record and not only in the summary, because a join that pooled two
        # channels would otherwise be undetectable per episode (AUDIT 34.262).
        "parser": parser,
        "pack_entries": pack_entries,
        "pack_chars": pack_chars,
        # What this game actually read. Under `--gate-kind` two games of one pass read different entries, so this is
        # the only field that says so -- and it is deliberately not the field the join groups on (AUDIT 34.266).
        "pack_digest": pack_digest,
        "prefix_chars": prefix_chars,
        "prompt_chars": sum(len(message["content"]) for message in messages),
        "usage": dict(usage_total),
        "last_line": last.strip().splitlines()[-1][:120] if last.strip() else "",
    }
    if record_transcripts:
        record["trajectory"] = "\n".join(trajectory)
    return record


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


def write_json(path: Path, payload: dict) -> None:
    """Write through a temporary file and rename, so a killed job leaves a whole file or none.

    Run `44685314225` paid for twenty games of shard 1 and left a 330-byte artefact, because `--out` was written
    once at the end of a four-hour job. A half-written JSON would have been worse than none: the next step would
    have read it, found a truncated list, and reported the truncation as the pass's result.
    """
    temporary = path.with_name(path.name + ".part")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_bank(path: "Path | str") -> "tuple[list[str], list[list[str]]]":
    """A bank file as its rules and, per rule, the task kinds it was written for.

    One function rather than the four lines `main` used to hold, because the two lists have to be cut by the cap
    *together*: `rules[:cap]` beside an uncut `kinds` leaves every tag one rule out of place, and the kind gate
    then carries the sentence it believes it dropped. `applicable` refuses a misaligned pair, and this is the
    function that must not produce one.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    entries = payload["entries"]
    rules = [str(entry["text"]) if isinstance(entry, dict) else str(entry) for entry in entries]
    kinds = [list(entry.get("kinds") or []) if isinstance(entry, dict) else [] for entry in entries]
    cap = payload.get("cap")
    if isinstance(cap, int) and cap > 0:
        rules, kinds = rules[:cap], kinds[:cap]
    return rules, kinds


def bank_digest_of(rules: "list[str]", kinds: "list[list[str]] | None" = None) -> str:
    """A bank's identity: what it says **and** who it says it to.

    Text alone is not a bank. R186 and R187 hold the same two 354-character sentences and differ only in which kinds
    each is tagged for — one gives the precondition to `put`, the other to `put`, `cool`, `heat` and `puttwo` — so a
    digest over the texts reported the round that moved the boundary as the same bank as the round it was measured
    against, and the join's one-bank-per-label guard could not have seen it (AUDIT 34.269). The tags go in as a sorted
    set, because a tag list is a set: re-ordering one entry's kinds is not a new arm.
    """
    tagged = [] if kinds is None else kinds
    if len(tagged) != len(rules):
        fail(f"{len(tagged)} kind tags for {len(rules)} rules: a tag list that does not line up cannot be digested")
    return digest_of([f"{','.join(sorted(tags))}|{text}" for text, tags in zip(rules, tagged)])


def pass_header(arguments, rules: "list[str]", total: int, kinds: "list[list[str]] | None" = None) -> dict:
    """Everything that has to be equal for two artefacts to be two halves of one pass.

    Written once and compared field by field on resume, because a resumed pass that appended games to a file
    from a different arm, shard or model would produce one artefact describing two experiments — and the
    difference would be invisible in the reading, which only ever looks at `episodes`.
    """
    return {
        "arm": arguments.arm,
        "policy": arguments.policy,
        "split": arguments.split,
        # The section's own size, which is what a join's tiling check has to hold to. `games_requested` is the
        # pass's budget and is legitimately smaller for a calibration; this is the denominator the split
        # publishes, and two sections joined without it are a join nobody can check (AUDIT 34.251).
        "split_size": SPLIT_SIZES[arguments.split],
        "transcripts": bool(arguments.record_transcripts),
        "model": arguments.model if arguments.policy == "model" else None,
        "seed": arguments.seed,
        "shard": arguments.shard,
        "max_steps": arguments.max_steps,
        "top_k": arguments.top_k if arguments.arm == "retrieved" else None,
        "gate_share": arguments.gate_share if arguments.arm == "retrieved" else None,
        "gate_kind": bool(arguments.gate_kind) if arguments.arm != "none" else None,
        # What a reading groups on. `arm` stays the family so that every artefact before this field is still
        # comparable; the label is what distinguishes two configurations of the same family.
        "arm_label": arm_label(
            arguments.arm,
            arguments.top_k,
            arguments.gate_share,
            bool(arguments.gate_kind),
            arguments.parser,
            bool(arguments.guard_commandless),
        ),
        # The channel travels in the header as well as in every episode: a reader opening the file sees which reader
        # drove it before seeing a single score (AUDIT 34.262).
        "parser": arguments.parser,
        # And the guard, for the same reason: two dispatches of one arm that differ by this flag are two treatments,
        # and a reader of the summary has to be able to say which one this file is without opening an episode.
        "guard_commandless": bool(arguments.guard_commandless),
        "rules_in_bank": len(rules),
        # R185 swaps a bank under an unchanged label at an unchanged length. Without this field the two artefacts
        # differ only by run id, and a join of them would print one rate over two prompts.
        "bank_digest": bank_digest_of(rules, kinds) if rules else "",
        "games_requested": total,
    }


def pass_summary(
    header: dict, episodes: "list[dict]", elapsed: float, card: dict, partial: bool = False, resumed: int = 0
) -> dict:
    """One artefact's summary, from its episodes: the only place a rate or a bill is computed.

    Called after every episode with `partial=True` and once at the end with `partial=False`, so the two shapes
    cannot drift. A checkpoint whose summary disagreed with its own episodes would be a file that lies about
    itself while being the only evidence those games happened.
    """
    wins = sum(1 for episode in episodes if episode["won"])
    usage = {
        key: sum(episode["usage"][key] for episode in episodes)
        for key in ("prompt_tokens", "completion_tokens", "cache_hit_tokens", "cache_miss_tokens")
    }
    bill = bill_of(card, usage["prompt_tokens"], usage["cache_hit_tokens"], usage["completion_tokens"])
    low, high = wilson(wins, len(episodes))
    prefix_chars = [episode["prefix_chars"] for episode in episodes if episode["prefix_chars"]]
    summary = dict(header)
    summary.update(
        {
            "games_driven": len(episodes),
            "wins": wins,
            "rate": round(wins / len(episodes), 4) if episodes else 0.0,
            "wilson_low": round(low, 4),
            "wilson_high": round(high, 4),
            "steps_mean": round(sum(episode["steps"] for episode in episodes) / len(episodes), 2) if episodes else 0.0,
            "calls": sum(episode["calls"] for episode in episodes),
            "retries": sum(episode.get("retries", 0) for episode in episodes),
            "thoughts": sum(episode["thoughts"] for episode in episodes),
            "stalls": sum(episode["stalls"] for episode in episodes),
            "episodes_without_any_action": sum(1 for episode in episodes if episode["actions"] == 0),
            "budget_exhausted": sum(1 for episode in episodes if episode["budget_exhausted"]),
            "invalid_actions": sum(episode["invalid_actions"] for episode in episodes),
            # `get` rather than an index: an arm file written before this field existed is still a file the
            # lane prices and joins, and a summary that raised on it would make the repair unreadable against
            # the runs it was diagnosed from.
            "refused_actions": sum(episode.get("refused_actions", 0) for episode in episodes),
            "recovered_actions": sum(episode.get("recovered_actions", 0) for episode in episodes),
            # The guard's ledger, summed the same way. A pass that was not armed records zeros, which is the true
            # count of lines it sent.
            "guard_fires": sum(episode.get("guard_fires", 0) for episode in episodes),
            "guard_checked": sum(episode.get("guard_checked", 0) for episode in episodes),
            "guard_relapsed": sum(episode.get("guard_relapsed", 0) for episode in episodes),
            "off_space_actions": sum(episode["off_space_actions"] for episode in episodes),
            "usage": usage,
            "cache_hit_rate": round(usage["cache_hit_tokens"] / usage["prompt_tokens"], 4) if usage["prompt_tokens"] else None,
            "prefix_chars_mean": round(sum(prefix_chars) / len(prefix_chars), 1) if prefix_chars else None,
            "prompt_chars_mean": round(sum(episode["prompt_chars"] for episode in episodes) / len(episodes), 1)
            if episodes
            else None,
            "bill": bill,
            "partial": bool(partial),
            "resumed": resumed,
            "elapsed_s": round(elapsed, 1),
        }
    )
    return summary


def adopt(arguments, header: dict, episodes: "list[dict]", start: int, stop: int) -> int:
    """The episodes a checkpoint already paid for, appended to `episodes`; returns how many.

    The environment's position is the resume's premise and the reason it is safe: a pass asks the world for its
    next game, so a pass that drives `n - k` games after inheriting `k` is handed exactly the games the indices
    `k..n` name. When that premise is violated — an environment restarted from the beginning — the games repeat,
    and the duplicate check in the loop fails the pass instead of billing a game twice in silence.
    """
    path = Path(arguments.out)
    if not path.exists():
        fail(f"--resume names {path}, which is not there; a resumed pass continues a file and does not start one")
    payload = json.loads(path.read_text(encoding="utf-8"))
    recorded = payload.get("summary") or {}
    if not recorded:
        fail(f"{path} carries no summary, so there is nothing to continue")
    for field, wanted in header.items():
        if recorded.get(field) != wanted:
            fail(f"--resume was given {field}={wanted!r} but {path} was written with {recorded.get(field)!r}")
    inherited = payload.get("episodes") or []
    if len(inherited) > stop - start:
        fail(f"{path} holds {len(inherited)} episodes but this slice is {stop - start} games long")
    episodes.extend(inherited)
    return len(inherited)


def main() -> int:
    parser = argparse.ArgumentParser(description="Drive one ALFWorld arm and bill it")
    parser.add_argument("--arm", choices=ARMS, default="none")
    parser.add_argument("--policy", choices=POLICIES, default="model")
    parser.add_argument("--rules", default="", help="a rendered rule bank; required by always-in and retrieved")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K, help="entries the retrieved arm may carry")
    parser.add_argument(
        "--gate-share",
        type=float,
        default=0.0,
        help="the share of the observation's own content words a retrieved rule must account for; 0 is the registered arm",
    )
    parser.add_argument(
        "--gate-kind",
        action="store_true",
        help="carry only the bank entries tagged with this game's task kind (R175); inert on an untagged bank",
    )
    parser.add_argument("--games", type=int, default=0, help="0 drives the whole split")
    parser.add_argument(
        "--split",
        choices=SPLITS,
        default="eval_out_of_distribution",
        help="which split to drive; the held-out 134 by default, valid_seen's 140 for distillation",
    )
    parser.add_argument(
        "--record-transcripts",
        action="store_true",
        help="carry each episode's trajectory in the artefact, which is what a rule bank is distilled from",
    )
    parser.add_argument("--shard", default="0/1", help="i/n; the pass is sliced and each slice is a job")
    parser.add_argument(
        "--parser",
        choices=PARSERS,
        default=REFERENCE_PARSER,
        help="the reader this pass drives: `reference` is the competitor's first-line rule, `any-line` executes "
        "the command it refuses; a channel, so both arms are re-run on it and no level is pooled across it",
    )
    parser.add_argument("--max-steps", type=int, default=50, help="the environment's own cap")
    parser.add_argument(
        "--guard-commandless",
        action="store_true",
        help="answer a reply that carried no command with `OK. Reply with one command only.` instead of `OK.`; the "
        "registered change of R189, recorded per episode as `guard_fires` so a join can prove it engaged",
    )
    parser.add_argument("--seed", type=int, default=20261120)
    parser.add_argument("--model", default=os.environ.get("ALFWORLD_MODEL", DEFAULT_MODEL))
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--assert-floor", default="", help="a floor json the seed policy must reproduce")
    parser.add_argument(
        "--trace",
        type=int,
        default=0,
        help="print the first N replies of the pass; a calibration reads three of them before it reads its score",
    )
    parser.add_argument("--out", default=str(HERE / "agent.json"))
    parser.add_argument(
        "--resume",
        action="store_true",
        help="continue the pass `--out` already holds rather than starting it again; the file is written after every episode",
    )
    arguments = parser.parse_args()

    if arguments.arm != "none" and not arguments.rules:
        fail(f"--arm {arguments.arm} needs --rules; an empty bank is a different arm and is not assumed")
    if arguments.policy != "model" and arguments.shard != "0/1":
        fail("a sharded pass must be a model pass: the seed policy's sequence is a whole-pass sequence")

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if arguments.policy == "model" and api_key == "":
        fail("--policy model needs DEEPSEEK_API_KEY; this file does not fall back to a policy")

    rules: "list[str]" = []
    rule_kinds: "list[list[str]] | None" = None
    if arguments.rules:
        rules, rule_kinds = load_bank(arguments.rules)
    if arguments.gate_kind:
        if arguments.arm != "none" and not any(rule_kinds):
            # Refused rather than run: an untagged bank under a kind gate is `always-in` with a second name, and
            # paying for it would answer a question the register did not ask.
            fail("--gate-kind needs a bank whose entries carry `kinds`; this one has no tags to select on")
        # `--gate-kind` on the control is inert rather than refused: the control carries no bank, so there is
        # nothing to select, and the header records `gate_kind: null` for it. It was refused once, and the refusal
        # killed the control arm of every gated sweep — the workflow passes its flags to every arm in the matrix,
        # so a flag that is only meaningful for treatments cannot be an error on the control (AUDIT 34.246).
    if arguments.arm == "sham":
        # Permuted after the cap, so the sham has exactly as many entries as `always-in` would render.
        rules = sham_entries(rules)

    examples = load_examples()
    card = load_rate_card()

    env, num_games = build_env(train_eval=arguments.split)
    # `total` used to be `min(games, num_games)`, which answered a `--games 140` on the 134-game split with 134
    # games and a rate that read like a full pass — the one place in this file where a wrong number was silently
    # made smaller instead of refused. Both ceilings are now refusals: the split's published size, so a typo
    # cannot be bought as a shorter pass, and the corpus's own count, so a stale table cannot be bought at all
    # (`scripts/check-split-sizes.py` holds the table to the installed corpus in CI, AUDIT 34.251).
    published = SPLIT_SIZES[arguments.split]
    if arguments.games > published:
        fail(f"--games {arguments.games} is more than {arguments.split} publishes ({published})")
    if arguments.games > num_games:
        fail(f"--games {arguments.games} is more than the installed {arguments.split} corpus holds ({num_games})")
    total = num_games if arguments.games <= 0 else arguments.games
    start, stop = shard_bounds(arguments.shard, total)
    draw = Draw(arguments.seed)

    print(
        f"arm={arguments.arm} policy={arguments.policy} split={arguments.split} games={start}..{stop - 1} of {total} "
        f"max_steps={arguments.max_steps} rules={len(rules)} model={arguments.model if arguments.policy == 'model' else '-'}"
    )
    header = pass_header(arguments, rules, total, rule_kinds)
    if arguments.resume and arguments.policy != "model":
        fail(
            "--resume is a model-pass flag: the seed policy draws from one stream for the whole slice, so the "
            "position a resumed pass would start from is not the position the seed names"
        )
    episodes: "list[dict]" = []
    began = time.monotonic()
    # Inherited before the clock starts, so `elapsed_s` is what this process spent rather than what the pass
    # spent; `resumed` travels beside it for the same reason.
    resumed = adopt(arguments, header, episodes, start, stop) if arguments.resume else 0
    if resumed:
        print(f"  resuming      {resumed} games already paid for in {arguments.out}")
    # The batch environment always starts at the first game of its own order, so a slice is reached by *advancing*
    # to it rather than by being handed one. Without this, `--shard` controlled only how many games were driven and
    # never which: run `44685314225` produced 105 episodes over 82 distinct games, and the run after it produced
    # four identical slices, because four jobs each drove the first 35 games of their own environment. A reset
    # costs nothing — it initialises a world and asks it nothing — so the advance is at most 139 initialisations
    # and no money at all.
    for _ in range(start + resumed):
        env.reset()
    # Ascending over the slice, and the slice is contiguous: a model pass needs nothing from the games
    # it does not drive, and `--policy seed` refuses to be sliced because its sequence is a whole-pass
    # sequence.
    for index in range(start + resumed, stop):
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
            arguments.trace,
            arguments.record_transcripts,
            arguments.gate_share,
            rule_kinds,
            arguments.gate_kind,
            arguments.parser,
            arguments.guard_commandless,
        )
        # Checked before the write, so a file on disk never holds one game twice: the checkpoint is the
        # evidence, and evidence that has to be re-checked before it can be trusted is not evidence.
        if any(earlier["gamefile"] == episode["gamefile"] for earlier in episodes):
            fail(
                f"{episode['gamefile']} was already driven in this pass; a resumed pass whose environment "
                "restarted from the beginning would bill the same game twice, so it stops here"
            )
        episodes.append(episode)
        # Written after every episode rather than at the end. The cost is 35 rewrites of a 200 KB file; the
        # alternative is what run `44685314225` did, which was to pay for 1,078 calls and keep none of them.
        write_json(
            Path(arguments.out),
            {
                "summary": pass_summary(header, episodes, time.monotonic() - began, card, partial=True, resumed=resumed),
                "episodes": episodes,
            },
        )
        if len(episodes) % 10 == 0 or index + 1 == stop:
            wins = sum(1 for item in episodes if item["won"])
            elapsed = time.monotonic() - began
            print(f"  {len(episodes)}/{stop - start}  wins={wins}  calls={sum(e['calls'] for e in episodes)}  {elapsed:.0f}s")

    elapsed = time.monotonic() - began
    truncated = [episode["gamefile"] for episode in episodes if episode["truncated"]]
    if truncated:
        fail(
            f"{len(truncated)} episodes ended with the environment undecided and turns to spare, "
            f"first {truncated[0]}"
        )

    calls = sum(episode["calls"] for episode in episodes)
    if arguments.policy == "model" and calls == 0:
        fail("a model pass recorded no calls, so its bill would be zero for the wrong reason")
    # A pass in which no episode produced a single action is not a low score; it is a prompt the model did
    # not read as a prompt. Reporting a rate here would be reporting the syntax of the skeleton.
    if arguments.policy == "model" and all(episode["actions"] == 0 for episode in episodes):
        fail(
            "no episode produced an action: the skeleton was not followed, so the rate is a rate about the "
            f"format. First reply was {episodes[0]['last_line']!r}"
        )

    summary = pass_summary(header, episodes, elapsed, card, partial=False, resumed=resumed)
    wins = summary["wins"]
    bill = summary["bill"]

    determinism = None
    if arguments.assert_floor:
        determinism = compare_with_floor(episodes, Path(arguments.assert_floor))
        if determinism["mismatches"]:
            fail(f"the loop does not reproduce the floor: {json.dumps(determinism['first'])}")
        summary["floor_agreement"] = determinism

    write_json(Path(arguments.out), {"summary": summary, "episodes": episodes})

    print("")
    print(f"{arguments.arm} over {len(episodes)} games: {wins} wins = {100 * summary['rate']:.1f}%")
    print(f"  wilson 95%      [{100 * summary['wilson_low']:.1f}, {100 * summary['wilson_high']:.1f}]")
    print(f"  calls           {calls} ({summary['thoughts']} thoughts, {summary['invalid_actions']} invalid actions)")
    # Printed on every pass, not only when it is non-zero: a reader comparing a pre-repair arm against a
    # post-repair one needs to see the refused count *absent* from the old file and zero in the new one.
    print(f"  refused         {summary['refused_actions']} commands the first-line rule dropped")
    # Only on the channel where it can be non-zero: on the reference channel the field is structurally zero, and a
    # line that printed it there would teach a reader to skip both.
    if arguments.parser != REFERENCE_PARSER:
        print(f"  recovered       {summary['recovered_actions']} commands executed from a later line ({arguments.parser})")
    # Printed on both arms, because `0 fires` is the statement that the unguarded arm was not armed and it is the
    # number the guarded one is compared against. A line printed only when the flag was set would leave a reader
    # unable to tell a control from an old file.
    print(
        f"  guard           {summary['guard_fires']} fires, {summary['guard_relapsed']} relapsed of "
        f"{summary['guard_checked']} checked"
    )
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
