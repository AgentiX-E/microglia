"""A tau2-bench agent that recalls one microglia pack per episode.

Why this shape and not a fork of the benchmark: tau2 constructs its agents through
a registry (`tau2.registry.register_agent`) and calls
`AgentConstructor(tools=..., domain_policy=..., llm=..., llm_args=...)` for every
class that subclasses `LLMAgent`. Subclassing therefore needs no changes upstream —
the constructor is unchanged, and only `generate_next_message` is wrapped.

What the wrapper does:

  1. On the episode's first turn, takes the text of the incoming message and asks a
     local microglia facade for the pack relevant to it.
  2. Appends that pack as one additional system message on a **copy** of the state.
  3. Reuses the same pack for every later turn of that episode.

On the transient arm (R204) step 2 is preceded by one model call: the block the facade served is handed
to the arm's own model with the request, and what is injected is the one sentence that comes back. The
records are read, the sentence is used, nothing is written — so the store is the same size at the end of
the phase as at the start, which is the whole difference between this arm and every lesson arm before it.

**The pack is fixed per episode, and it was not before.** It used to be recalled on
every turn from that turn's own message, which meant the second system message
changed on every call. Two consequences, one of them financial:

* **Prefix caching cannot work across turns.** DeepSeek caches on a token-block
  prefix, and every message after the first differing block is a cache miss. With a
  per-turn pack, the divergence point is the *second system message*, so the whole
  conversation history — the part that grows quadratically with episode length —
  was paid for at the miss rate on every single turn of the memory arm and on no
  turn of the reference arm. The two arms were not being billed differently by 7%;
  they were billed differently by the cache.
* **The treatment was not constant.** A pack that changes each turn is a different
  intervention each turn, so a delta over episodes cannot be attributed to "the
  memory" — it is a delta over a sequence of interventions. R57's three arms were
  measured under that arrangement and are re-read under `prereg/R57-toxicity.md`,
  Amendment 4, rather than compared across it.

An episode boundary is detected by the conversation getting shorter, which is the
only thing `LLMAgentState` says about where it is: `messages` grows monotonically
within an episode, so a length that does not exceed the last one is a new one.

The memory is not a tool and not a policy change. It is context, which is exactly
what the product claims to produce, and keeping it as one message makes the
injected text auditable in tau2's own simulation records.

Configuration is environment-only, because `llm_args` is forwarded verbatim to the
model call and a stray key there would break it: `MICROGLIA_MEMORY_URL`,
`MICROGLIA_DOMAIN`, and optionally `MICROGLIA_TIMEOUT_S`, `MICROGLIA_PACK_KNOBS`, and
`MICROGLIA_GUIDANCE` / `MICROGLIA_GUIDANCE_MODEL` (R204).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request


from tau2.agent.llm_agent import LLMAgent, LLMAgentState
from tau2.data_model.message import Message, SystemMessage

# R206. The note sidecar: the material is a sentence distilled from this task's own failed attempt, carried one
# attempt forward and discarded. It lives beside this module and imports nothing third-party, so the arm's
# identity rules — the key on the opening text, and R207's scope on the file — are exercised by a self-check that
# needs no harness.
from notes import lookup, scope_of, sentence_of, load as load_notes

# R214. The goal board. `eval/tools` is not on the path of a τ² invocation, so this module puts it there — one
# insert, beside the one import that needs it, rather than an environment variable every dispatch has to remember.
# The parser imports nothing outside the standard library, so an arm that turns the board on adds no dependency to
# the harness the benchmark installs.
_TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools")
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)
from goal_board import (  # noqa: E402
    BOARD_TAG,
    board_of as goal_board_of,
    render as render_goal_board,
    role_of,
)

# `ValidAgentInputMessage` moved in τ² v1.0.0: it lived in `tau2.agent.base` and now lives in
# `tau2.agent.base_agent`, beside the `HalfDuplexAgent` that `LLMAgent` extends. Both are tried
# because R92 runs one τ² and the arms before it ran another, and an import that names only one of
# them is a lane that can only reproduce half its own record.
try:
    from tau2.agent.base_agent import ValidAgentInputMessage
except ImportError:  # v0.2.0
    from tau2.agent.base import ValidAgentInputMessage

DEFAULT_TIMEOUT_S = 5.0
MAX_QUERY_CHARS = 500
PACK_TAG = "microglia-knowledge"

# R204's switch and its two bounds. The environment name is the one the driver sets from
# `TAU_SERVE_BODY`; the dry names are read here, in the arm, so the sentence's ceiling is a property of
# the mechanism rather than of the dispatch that asked for it.
GUIDANCE_ENV = "MICROGLIA_GUIDANCE"
GUIDANCE_MODEL_ENV = "MICROGLIA_GUIDANCE_MODEL"
#: One sentence is ~25 tokens. The ceiling is generous for a sentence and tight for a paragraph, which
#: is what makes "one sentence" a thing the bill can be read as rather than a hope.
GUIDANCE_MAX_TOKENS = 96
#: Longer than an episode turn's own timeout: this call happens once per episode, before the first turn,
#: and a summariser that is slow once is cheaper than an episode that starts with no memory.
GUIDANCE_TIMEOUT_S = 30.0
#: What the prompt injects. A sentence past this is a paragraph, and a paragraph is the durable artefact
#: this arm exists to not write.
GUIDANCE_MAX_CHARS = 400
#: How much of the served block the summariser reads. The pack is at most `TAU_PACK_BUDGET` characters
#: (1,200 by default), so this bound is above it and clips nothing on a normal arm: it exists so that a
#: misconfigured budget cannot turn one guidance call into a second, larger bill.
GUIDANCE_RECORDS_CHARS = 2_400

#: The instruction. Two things are stated rather than implied: the records are the only source, and the
#: way to say nothing is `NONE`. The second is what makes the arm's gate measurable — a prompt that
#: demanded a sentence would be answered with one even where the records say nothing about the request,
#: which is precisely the inert pack R200 found in 78% of servings.
GUIDANCE_SYSTEM = (
    "You write the one sentence of guidance an agent should read before it handles a request. "
    "Use only the RECORDS block you are given; they are notes from earlier attempts at similar "
    "requests in the same domain. If they do not bear on this request, answer exactly NONE. "
    "Otherwise answer one imperative sentence of at most 40 words, with no preamble, no quotes and "
    "no restatement of the request."
)

_failures = 0
_reported = False
_recalls = 0
# A recall that succeeded and returned nothing is not a recall that failed, and R123 is the first arm
# whose treatment *is* that state. Counted separately, and bucketed by the reason the facade reported,
# because "the pack was empty" has five causes (`nothing-matched`, `nothing-covered`,
# `nothing-corroborated`, `nothing-selected`, `no-leader`) and a run that reported one number for all of
# them could not say whether the gate withheld anything or the store had nothing to say.
_empty = 0
_silent_because: dict = {}
# The margin between the top two candidates, once per request that had one. This is R123a's whole
# instrument: the gate withholds a pack when the store's leader is not far enough ahead of its runner-up,
# and the *number* that decides how much traffic such a rule costs is a property of the store rather than
# of the rule. Recording the margins costs nothing (the facade computes them anyway), and the ladder they
# produce is exact -- `withheld 87 of 162` can be read off before a single dollar is spent on the arm.
_margins: list = []
# How many requests carried a census at all. R123a measured the need: the facade served `{ rendered }`,
# nothing arrived here, and an empty list of margins printed as `0 rivaled request(s)` -- a claim about the
# store made by a run that never asked it. The counter is what lets `rivaled` be `None` (no census) rather
# than `0` (a census that found no rival), and the two are different sentences in the run's log.
_census = 0
# The index of the request that opened each episode, so a served pack can be joined to the trial it was
# served into. R123a measured the need: `pack.ledger` carries the ids served per request and `per_trial`
# carries each trial's reward, and the two cannot meet because nothing says where one episode's requests
# stop -- `recall` fires once per episode, and 164 requests covered 160 episodes, so a positional join
# drifts at the four episodes that recalled twice. The index is the request count at the moment a new
# episode was recognised, which is the boundary a join needs and the only one this side of the socket
# can observe: the agent is never told which task or trial it is in.
_episode_starts: list = []
# Recalls that happened *inside* an episode: a retry that reset the conversation, or a host that asked again
# on the same episode. R123 measured the need. `episodeStarts` was appended on every recall rather than on
# every boundary, so on a phase with 162 recalls over 160 episodes it held `[0, 1, ..., 161]` -- strictly
# increasing, one entry per request, and therefore carrying no boundary at all. A reader cannot tell that from
# a phase that really did run 162 episodes, and both R123's serve split and R128's attribution were reading
# it. The counter is what makes the sentence checkable: `len(episodeStarts) + recallRepeats == recalls`.
_recall_repeats = 0
# R136. The task each boundary opened for, taken from the query text this side of the socket already
# holds. `_episode_starts` says *where* an episode began and nothing about *which* task it was, so on
# R135's arm — 41 boundaries for 40 scored episodes — the extra boundary was an unattributable row and
# every join in this lane refused. The text is recorded at the same moment as the index, because both
# are properties of the boundary rather than of the request, and the query the recall would send is
# already normalised to `MAX_QUERY_CHARS`, so two boundaries of one task carry equal strings and a
# retry is *named* by comparison rather than inferred from a count.
_boundary_tasks: list = []
# R218e. The dose, recorded where it is known: one dict an episode, opened at the same boundary that opens the
# entry in `_episode_starts`, `_episode_injected` and `_boundary_tasks` and mutated in place at the only two sites
# that can see the material — the renderer, which knows how many characters the block was, and the writer, which
# knows how many of them reached the prompt.
#
# The recording exists because the *transcript* cannot be the instrument. R218d tried to read the dose out of
# `results.json` and answered `NO_DOSE` on both arms of a 912-episode grid; R218e's amendment measured why, for free,
# on the four documents this lane already paid for: **τ² stores no `system` message at all** — `board.json`,
# `policy.json`, `front.json` and R216's tail arm carry 0 occurrences of `<microglia-board>` over 30 MB, and the only
# roles they hold are `assistant`, `user` and `tool`. So the block is absent from the transcript at *either*
# placement, and a reader built on the transcript could only ever have said `NO_DOSE`. A dose that is not written
# down where it is made is a dose nobody can read (PROGRESS 249.12).
#
# `chars` is the material as *served* — the sum over renders, which is what the model saw on every turn, including
# the turns that left an unchanged block where it was. `written` is the material as *carried* — the sum over the
# messages this agent actually put into the prompt, which is the quantity a transcript would show if it kept one.
# The two differ by the held turns, and that difference is the placement's whole price, so they travel apart.
_board_doses: list = []
# R205. Whether each episode's prompt carried a body, positional against `_episode_starts`.
#
# R204's fold reported 50 renders over 40 episodes of which six carried a sentence, and every gate that asked
# "did serving help" read the facade's count as the injected one. The flag is set where the injected message is
# built rather than where the pack is decided, because those are different moments: `guidance` can decline after
# the facade served, and a retry inside one episode can speak after the first attempt was silent. Whatever the
# cause -- a refusal, a provider error, an empty recall -- the effect is one message or none, and only the effect
# belongs in the population a share is read over.
_episode_injected: list = []


def _open_episode(text: str = "") -> None:
    """Record a boundary, its two flags and its dose slot together, because the join between them is positional.

    Two parallel lists are one list when they are appended at one site and a silent shift when they are
    appended at two: an episode count and a flag count that drift apart hand every flag after the drift to
    the wrong episode, and the share that comes out is over a population nobody chose. One function, one
    append order, and a length the reader can assert (`injectedEpisodes` and `episodeStarts` are equal in
    length on every artefact this module writes).

    R218e folded the boundary *text* into this function for the same reason, and the fold removed a real
    drift: the text used to be appended by each of the two callers, so `_boundary_tasks` was aligned with
    `_episode_starts` only as long as both callers remembered to append. The dose slot joins them here, which
    is what makes `len(doses) == len(boundaryTexts) == len(episodeStarts)` a property of one site rather than a
    convention four sites have to keep.
    """
    _episode_starts.append(_recalls)
    # Opened as unserved: the boundary is recorded before the pack exists, and the flag is raised at the one
    # place the prompt is actually built.
    _episode_injected.append(False)
    _boundary_tasks.append((text or "")[:MAX_QUERY_CHARS])
    if board_mode():
        _board_doses.append(
            {"text": (text or "")[:MAX_QUERY_CHARS], "turns": 0, "renders": 0, "chars": 0, "written": 0,
             "changes": 0, "stable": 0,
             # R236. Which board this episode was served, recorded at the boundary rather than inferred later from a
             # parse of the transcript: B1's first failure mode is an arm that only *claims* to serve the clause board,
             # and a column the reader can compare with `--note-source` is the difference between a finding about the
             # mechanism and a finding about the wiring.
             "scope": board_scope(), "display": board_display()}
        )
# Characters of the message this agent actually injects, and of the pack the facade served. R135 measured
# 559 tokens of system growth per call against a 725-character pack and could not say whether the other
# ~400 tokens were the pack's carriage or material no field had ever named: the census counts every system
# message together, so the pack and the adapter's preamble are one column. The three lengths recorded here
# are the layers that column has — the pack as served, the message as injected, and (in the census) the
# column as billed — and each is taken where it is produced so no ratio has to be assumed.
_pack_chars: list = []
_injected_chars = 0
_injected_lengths: list = []
# Generated messages, which is the denominator the per-call comparison needs. Not the same number as the
# census's call count: litellm's callback sees every model call the simulation makes, including the user
# simulator's, and the pack rides only this agent's. A per-call figure divided by the wrong one of those
# two is the arithmetic that would make a 750-character message look like 300.
_calls = 0
# R137. Copies of the block this agent removed from the state it was handed, because a state that already
# carried the pack is a state this method wrote. Counted rather than merely removed: the number is the
# evidence that the state is threaded at all, and it is the one figure a fixture without tau2 cannot
# invent. On a phase with B boundaries and C calls it reads `C - B` when the fix is in and `0` when the
# defect is, which is why it travels beside `injectedMessages` rather than instead of it.
_pack_copies_dropped = 0
# R204. What the pack is made of at serve time, which is the one field that separates the transient arm
# from every arm before it. `rendered` -- the default -- injects the block the facade served, which is what
# R92 through R198 measured. `guidance` reads the same records, makes **one** model call to turn them into
# one sentence for *this* request, injects the sentence, and writes nothing back: nothing durable is
# created, so the store's item count at the end of the phase is the count the learn half wrote.
#
# The three outcomes are counted apart because they are three different readings. A sentence is a served
# pack; `NONE` is the model declining to say anything about this request, which is the arm's own gate; a
# failure is the provider, and a run whose packs are mostly failures is a run whose score is about an
# unreachable summariser rather than about the mechanism.
_guidance_calls = 0
_guidance_refusals = 0
_guidance_failures = 0
_guidance_chars = 0
_guidance_sentences: list = []
_guidance_first_failure: str | None = None

# R206. The notes arm's own account: how often this agent looked for a note, how often it found one, how much
# text it served, and whether the file could be read at all. Four numbers rather than one, because `hits: 0` on a
# phase whose sidecar was unreadable and `hits: 0` on a phase whose first round had nothing to read yet are
# different findings, and only the second is the mechanism working as registered.
NOTES_ENV = "MICROGLIA_NOTES"

# R214. The working-memory arm's own account. A board is recomputed on every turn from the messages the episode
# already carries, so the three numbers that decide whether a reading is about the mechanism are how many turns it
# was served on, how many asks it listed, and how many of those a receipt had settled by then. An arm whose board
# never rendered is a null about the wiring; an arm whose board rendered and settled nothing is the parser's own
# limit, and the two must not be read as the same null.
#
# R215 adds the cadence, because R214's bill was a cadence and not a length. `changes` is the turns whose block
# differed from the previous turn's — the only turns that can invalidate the provider's prefix — and `stable` is the
# turns that re-served a byte-identical block. A board that changes six times in twenty-five turns leaves the prefix
# alone nineteen times; the arm that changed it every turn paid 77% more for a 200-character list (PROGRESS 244.3).
BOARD_ENV = "MICROGLIA_BOARD"
_board_renders = 0
_board_items = 0
_board_settled = 0
_board_chars = 0
_board_changes = 0
_board_stable = 0
#: R216. The tail placement's own two numbers: how often the block was written into the prompt, and how often a turn
#: found it already in place and left it alone. The second is the turns that cost nothing, and it is the whole point
#: of the placement — a block moved on every turn would pay for the messages behind it on every turn.
_board_tail_appends = 0
_board_tail_held = 0
_board_open = 0
_board_unrequested = 0
_board_unattributed = 0
_note_lookups = 0
_note_hits = 0
_note_chars = 0
#: Which identity produced the note. `key` is the opening text matching the one the runner wrote under; `task` is
#: the file naming the task this episode is in. R207's first prediction is about the second, and a single `hits`
#: counter could not separate the repair from the defect it repaired.
_note_key_hits = 0
_note_task_hits = 0
_note_problem: str | None = None
_note_loaded_at: object = None
_note_document: dict = {}

# Sentinel rather than `None`, because "" is a real answer: a facade that was asked
# and had nothing to say must not be asked again on the next turn.
_UNSET = object()


def board_mode() -> bool:
    """Whether this arm serves the goal board instead of a note."""
    return os.environ.get(BOARD_ENV, "").strip().lower() in (
        "1", "true", "yes", "front", "tail", "policy", "clause")


def board_scope() -> str:
    """Which turns the block may take its asks from: `request` as shipped, `clause` under R231's admission.

    R236. The value rides the same environment variable as the placement, for the reason `board_admission` gives: a
    second switch is a third treatment nobody registered, and the failure it produces — an arm whose block sits where
    it says and lists what it does not — is invisible in an artefact that records only one of the two.

    `clause` is one change and only one: the contract's turn read whole, every later turn read only through the clauses
    that name their own family. The placement (`tail`), the admission (`all`) and the window (eight lines) are what the
    control already ran, so the contrast against R218b's 456 episodes is the board's *reach* and nothing else.
    """
    raw = os.environ.get(BOARD_ENV, "").strip().lower()
    return "clause" if raw == "clause" else "request"


def board_display() -> str:
    """The rung the block is rendered at, as `goal_board` names it: `statement` as shipped, `grouped` for the clause arm.

    Read from the scope rather than from a fourth value, because R233's order and R234's fold were measured *on* the
    clause board and a clause board shown in statement order is a treatment neither round measured. The pairing is
    asserted in the self-check rather than left to this comment.
    """
    return "grouped" if board_scope() == "clause" else "statement"


def _dose_here() -> "dict | None":
    """This episode's dose record, or `None` on an arm that serves no board.

    `None` rather than an empty dict: an arm that is not the board arm has no dose, and a record of zeroes would
    make it indistinguishable from an arm whose block was empty on every turn — which is a finding about the
    parser, and one this lane has already had to tell apart from a finding about the wiring.
    """
    return _board_doses[-1] if _board_doses else None


def _dose_wrote(chars: int) -> None:
    """Record that `chars` of block were written into the prompt on this turn.

    Called from the one place the injected message is built, in both placements, so the number is taken from the
    message object rather than from the body: the wrapper's own `<microglia-board>` element is part of what the
    prompt carried and therefore part of the bill.
    """
    dose = _dose_here()
    if dose is not None:
        dose["written"] += chars


def board_admission() -> str:
    """What the block is allowed to say: `all` as measured through R218b, `state` under R219's admission rule.

    R219. The value is carried by the same environment variable as the placement, because an arm that has one switch
    for where the block sits and another for what it says is an arm whose two switches can disagree — and a
    disagreement of that kind is a third treatment nobody registered, which is the defect the placement switch was
    made single-valued to avoid.

    `policy` is therefore `state` at the tail: the shipped placement, with the block admitting the asks and their
    ticks and refusing to admit either refusal line. The refusals are the only part of the block that asserts a
    judgment about the agent's calls, and `goal_board.false_accusations` reads 1,808 of 1,965 of them (92.0%) as
    naming a family the task requires a write in — the parser's blindness reported as the agent's mistake.
    """
    return "state" if os.environ.get(BOARD_ENV, "").strip().lower() == "policy" else "all"


def board_placement() -> str:
    """Where the block sits in the prompt: `front` in the system block, `tail` after the conversation.

    R214 and R215 wrote the block into the system message, which sits in front of every token the episode will ever
    send — so a block that changed re-bought the whole prompt at the miss rate, and R215's arm paid 37% more for a
    200-character list. The measurement's own arithmetic says that price is not a property of the channel but of the
    address: 247 changes × 4,756 prompt tokens = 1.17 M of re-bought prefix, and 114 of those changes were first turns,
    which no per-turn block can avoid (AUDIT 34.226).

    `tail` moves the block behind the conversation. A change then re-bills only what came after it — the newest tool
    result, a few hundred tokens — and a turn whose block is unchanged re-bills nothing at all, because the block is
    left exactly where it was written. The channel's price becomes its own length instead of the prefix it sits on.
    """
    raw = os.environ.get(BOARD_ENV, "").strip().lower()
    if raw in ("1", "true", "yes", "front"):
        return "front"
    return "tail" if raw in ("tail", "policy", "clause") else "off"


def _memory_url() -> str:
    return os.environ.get("MICROGLIA_MEMORY_URL", "").strip()


def _timeout() -> float:
    raw = os.environ.get("MICROGLIA_TIMEOUT_S", "").strip()
    if raw == "":
        return DEFAULT_TIMEOUT_S
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIMEOUT_S
    return value if value > 0 else DEFAULT_TIMEOUT_S


def guidance_mode() -> str:
    """`guidance` when this arm writes its pack per request, `rendered` otherwise.

    R204. Read from the environment on every call rather than at import, for R123a's reason: a mode
    decided once at import cannot be varied inside one test session, and the self-check has to run both
    arms through the same module.
    """
    raw = os.environ.get(GUIDANCE_ENV, "").strip().lower()
    return "guidance" if raw in ("1", "true", "yes", "guidance", "on") else "rendered"


def guidance_model() -> str:
    """The model the guidance call names, in the id litellm's provider adapters accept.

    Defaulted to the arm's own model rather than to a separate one, because the mechanism this arm
    reproduces is "the agent that is being measured reads its own records and writes itself a note". A
    different summariser would be a different experiment, and `TAU_MODEL` is the name the run already
    resolved in this process — the same string τ² hands litellm for the episode's own calls.
    """
    override = os.environ.get(GUIDANCE_MODEL_ENV, "").strip()
    return override or os.environ.get("TAU_MODEL", "deepseek/deepseek-flash").strip()


def guidance_prompt(records: str, request: str) -> str:
    """The user turn: the records the store served, then the request they are for.

    One string rather than two messages, so a provider that only reads the last user turn cannot be
    handed half the question. The records are quoted as data and the request is quoted separately,
    because everything in the first block is text a previous episode wrote and nothing in it may be read
    as an instruction to this call.
    """
    return (
        "RECORDS\n<<<\n"
        f"{records.strip()[:GUIDANCE_RECORDS_CHARS]}\n"
        ">>>\n\n"
        "REQUEST\n<<<\n"
        f"{request.strip()[:MAX_QUERY_CHARS]}\n"
        ">>>\n"
    )


def notes_path() -> str:
    """The sidecar this arm reads, or an empty string when it is not the notes arm."""
    return os.environ.get(NOTES_ENV, "").strip()


def _notes_document() -> dict:
    """The sidecar, reloaded when the file changed under this process.

    Rounds share one process, so a document cached at import would serve round one's notes to round four and the
    arm would be a constant — the treatment would look inert for a reason that has nothing to do with the
    material. The stamp is `(mtime, size)`: the runner writes between rounds and never during one, so a change
    means a new round rather than a race.
    """
    global _note_document, _note_problem, _note_loaded_at
    path = notes_path()
    if path == "":
        return {}
    try:
        stamp = os.stat(path)
        marker = (stamp.st_mtime_ns, stamp.st_size)
    except OSError:
        # No file yet: round one, and not a fault. The problem slot stays empty so a phase that never had a
        # sidecar is distinguishable from one whose sidecar was broken.
        _note_document = {}
        _note_loaded_at = None
        return {}
    if _note_loaded_at == marker:
        return _note_document
    document, problem = load_notes(path)
    _note_document = document
    _note_loaded_at = marker
    if problem is not None:
        _note_problem = problem
        print(f"[microglia] note sidecar unreadable ({problem}); serving no notes", file=sys.stderr)
    return document


def note_for(text: str) -> str:
    """The note this task's last failed attempt earned, or an empty string.

    Counted apart from the facade's recall: this arm has no store and no retrieval, so a `recalls` counter that
    moved here would report a facade that was never asked.

    R207 splits the hit by identity. `keyHits` is the note found because this request's text matched the one the
    runner wrote under; `taskHits` is the note found because the sidecar declares the task this episode is in and
    holds one entry. The first is R206's mechanism, which the pilot measured as not identifying a task (0.006
    exact reuse over 168 same-task pairs); the second is this arm's, and a phase where `hits > 0` but
    `taskHits == 0` says the improvement came from the text rather than from the file.
    """
    global _note_lookups, _note_hits, _note_chars, _note_key_hits, _note_task_hits
    if notes_path() == "":
        return ""
    _note_lookups += 1
    note, how = lookup(_notes_document(), text)
    if note == "":
        return ""
    _note_hits += 1
    if how == "key":
        _note_key_hits += 1
    else:
        _note_task_hits += 1
    _note_chars += len(note)
    return note


def guidance_sentence(reply) -> str:
    """The sentence in a provider reply, or an empty string when the model declined.

    R206 moved the parser into `notes.py` and this is the one place that reads it: the two arms ask a model for
    one sentence and decline with `NONE`, and a second copy of that rule is the copy that drifts the first time
    the refusal token changes. `NONE` is *not* a failure — it is the arm's gate doing its job, and a run that
    counted it as an error would report an unreachable provider for a model that behaved exactly as asked.
    """
    return sentence_of(reply)[:GUIDANCE_MAX_CHARS]


def parse_knobs(raw: str) -> dict[str, str]:
    """The recall knobs a dispatch resolved, as query parameters.

    R55.1's switch is resolved in TypeScript — `pack-mode-plan.ts` decides what `prefix` means and
    `pack-knobs` renders it — and this driver only carries the answer across. That division is the point:
    a second place that knew what "no retrieval" means in query parameters would be the copy that drifts
    the first time the arm is refined.

    A malformed pair is dropped rather than passed through. It cannot be honoured either way, and an
    empty value would reach the route's validator, which refuses it with a 400 the run would record as a
    recall failure — a treatment that served nothing would then look like an unreachable sidecar.
    """
    knobs: dict[str, str] = {}
    for pair in raw.split("&"):
        key, sep, value = pair.partition("=")
        if sep and key.strip():
            knobs[key.strip()] = value.strip()
    return knobs


def recall_url(base: str, text: str, domain: str, knobs: dict[str, str]) -> str:
    """The one request this lane makes, built in one place so a knob cannot be added to a copy."""
    query = {"task": "tau2.act", "text": text[:MAX_QUERY_CHARS]}
    if domain:
        query["domain"] = domain
    query.update(knobs)
    return f"{base.rstrip('/')}/v1/recall?{urllib.parse.urlencode(query)}"


def recall(text: str) -> str:
    """The rendered pack for one turn, or an empty string.

    A memory that is slow or absent must not fail the episode: the benchmark is
    measuring the agent, and an unreachable sidecar is an infrastructure fact that
    should appear in the run's notes rather than as a crashed simulation.
    """
    global _failures, _reported, _recalls, _empty
    base = _memory_url()
    if base == "" or text.strip() == "":
        return ""
    _recalls += 1
    domain = os.environ.get("MICROGLIA_DOMAIN", "").strip()
    url = recall_url(base, text, domain, parse_knobs(os.environ.get("MICROGLIA_PACK_KNOBS", "")))
    try:
        with urllib.request.urlopen(url, timeout=_timeout()) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - any failure means "no pack"
        _failures += 1
        if not _reported:
            _reported = True
            print(f"[microglia] recall failed ({type(error).__name__}: {error}); continuing without it", file=sys.stderr)
        return ""
    _record_margin(payload)
    rendered = payload.get("rendered", "")
    if not isinstance(rendered, str):
        return ""
    if rendered == "":
        # The facade answered and had nothing to serve. The reason travels on the same response, so a
        # silence is attributed here rather than inferred later from an empty prompt.
        _empty += 1
        bucket = empty_bucket(payload)
        _silent_because[bucket] = _silent_because.get(bucket, 0) + 1
    return rendered


def guidance(records: str, request: str) -> str:
    """One model call: the records and this request in, one sentence out, nothing written back.

    R204. The call is made here rather than in the facade for two reasons, and the second is the one that
    decides it. First, the sentence is about *this request*, and the request is a string only this side of
    the socket holds in the form the episode will actually send. Second — and this is the reading the
    registration names first — the call is billed in the arm's own account: `run_split` counts every
    litellm call the process makes through a success callback, so a guidance call made here appears in
    `usage.calls` as exactly one call per served request, with its own prompt tokens in the prompt column.
    A call made in the TypeScript facade would be invisible to that counter and would have to be
    attributed by a second instrument.

    `litellm` is imported inside the function because it is τ²'s dependency rather than this module's: the
    self-check runs without it installed, and a module-level import would make the whole lane's
    instrumentation untestable in `pnpm check`. A missing package is one more failure, counted like the
    rest, so the arm reports "no sentence" rather than crashing an episode that is already paid for.
    """
    global _guidance_calls, _guidance_failures, _guidance_chars, _guidance_first_failure
    _guidance_calls += 1
    prompt = guidance_prompt(records, request)
    _guidance_chars += len(prompt)
    try:
        import litellm  # noqa: PLC0415 - τ²'s dependency, absent in the self-check

        reply = litellm.completion(
            model=guidance_model(),
            messages=[
                {"role": "system", "content": GUIDANCE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=GUIDANCE_MAX_TOKENS,
            timeout=GUIDANCE_TIMEOUT_S,
        )
    except Exception as error:  # noqa: BLE001 - any failure means "no sentence"
        _guidance_failures += 1
        if _guidance_first_failure is None:
            _guidance_first_failure = f"{type(error).__name__}: {error}"
            print(
                f"[microglia] guidance call failed ({_guidance_first_failure}); serving no pack",
                file=sys.stderr,
            )
        return ""
    sentence = guidance_sentence(reply)
    if sentence == "":
        global _guidance_refusals
        _guidance_refusals += 1
        return ""
    _guidance_sentences.append(len(sentence))
    return sentence


#: The rungs a margin ladder is priced at. The same ladder the relevance floor was priced on, so the two
#: curves are directly comparable: `0.00` is the default the lane has always run, and each rung above it
#: is a threshold nobody has ever charged a request for.
MARGIN_RUNGS = (0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30)


def decision_margin(payload: dict):
    """The margin the facade measured between its top two candidates, or `None` when it measured none.

    `None` is three facts and one of them is not a zero: the response carried no census, the pack had a
    single candidate (no rival, so nothing was contested), or the store returned nothing. A ladder built
    over a `0.0` standing in for those would report the whole run as contested.
    """
    decision = payload.get("decision")
    if not isinstance(decision, dict):
        return None
    margin = decision.get("margin")
    # `bool` is an `int` in Python, and `True` would otherwise enter the ladder as a margin of 1.0.
    if isinstance(margin, bool) or not isinstance(margin, (int, float)):
        return None
    return float(margin)


def margin_ladder(margins) -> dict:
    """How many of these requests each rung would withhold, exactly.

    `buildPack` withholds a pack when `margin < speakMargin`, so the count is strict and a margin equal
    to the rung serves. The denominator is the number of rivaled requests rather than the number of
    recalls: a request with one candidate cannot be contested at any rung, and putting it in the divisor
    would make every rung look cheaper than it is.
    """
    values = list(margins)
    return {f"{rung:.2f}": sum(1 for value in values if value < rung) for rung in MARGIN_RUNGS}


def _record_margin(payload: dict) -> None:
    global _census
    if isinstance(payload.get("decision"), dict):
        _census += 1
    margin = decision_margin(payload)
    if margin is not None:
        _margins.append(margin)


def quantile_of(values, q: float):
    """Nearest-rank quantile, or `None` for an empty population.

    Nearest-rank rather than interpolated: a margin the store never produced is not a margin, and the
    readback quotes this number as "the rung below which a quarter of the requests fell" — which is a
    statement about an observed request, not about a fitted line between two of them.
    """
    ordered = sorted(values)
    if not ordered:
        return None
    rank = max(1, min(len(ordered), int(-(-q * len(ordered) // 1))))
    return ordered[rank - 1]


def empty_bucket(payload: dict) -> str:
    """Which silence one empty response belongs to.

    The facade reports a `suppressed` reason when the memory chose to withhold and nothing when it merely
    had nothing, so the split is read here rather than guessed later from an empty prompt. `unattributed`
    is a state and not a catch-all: a facade that answered with no reason and no pack is one this driver
    cannot explain, and a bucket named for that is a bucket a reader can act on.
    """
    reason = payload.get("suppressed")
    return reason if isinstance(reason, str) and reason != "" else "unattributed"


def is_pack_message(message) -> bool:
    """Whether a system message is one of this agent's own blocks.

    The tag is the identity, and it is the *only* identity available: the state tau2 hands back carries
    messages, not provenance, so a block re-read from the state and a block built this turn are the same
    object shape. `injected_message` guarantees every block starts with the element, either because the
    facade emitted it or because the wrapper added it, so a prefix test is exact for the messages this
    module writes and cannot match a policy prompt that never mentions the tag.
    """
    content = getattr(message, "content", None)
    if not isinstance(content, str):
        return False
    head = content.lstrip()
    # R214: two tags, one rule. The board is a different channel from the store's pack and is removed by the same
    # test — a state that kept the previous turn's board would accumulate one board per turn, which is the defect
    # R137 repaired for the pack.
    return head.startswith(f"<{PACK_TAG}") or head.startswith(f"<{BOARD_TAG}")


def _attr(message, name: str):
    """One field of a message, from any of the three shapes this module is handed: object, dict, or a pair.

    The three arrive for the same reason `goal_board` has its own version: the driver sees pydantic models, a self-check
    sees dicts, and a transcript read back from a document sees whatever JSON had. A placement function that only
    understood the first would be correct in production and untestable in the suite that exists to protect it.
    """
    value = getattr(message, name, None)
    if value is not None:
        return value
    return message.get(name) if isinstance(message, dict) else None


def tail_index(messages) -> int:
    """Where a message of this module's own may be inserted without splitting a call from its results.

    An assistant message that carries `tool_calls` must be followed **immediately** by one tool message per call,
    and a provider enforces it: `An assistant message with 'tool_calls' must be followed by tool messages responding
    to each 'tool_call_id'`. R216's first dispatch inserted the board at the end of `state.messages` on every turn,
    which on the turn a call is made puts a system message between the call and the results it is about to receive —
    and **every episode failed**, 94 of 114 with no messages at all and the remaining 20 scored against a broken
    prompt (PROGRESS 246.6).

    So the position is computed rather than assumed. The last assistant message that carries calls is found, the run
    of tool messages after it is counted, and if the run does not answer every call the insertion point moves to
    *before* that assistant message. Everything else appends at the end, which is where the cheapest position is.
    """
    for index in range(len(messages) - 1, -1, -1):
        calls = _attr(messages[index], "tool_calls") or []
        if not calls:
            continue
        answered = 0
        for later in messages[index + 1 :]:
            if role_of(later) != "tool":
                break
            answered += 1
        return index if answered < len(calls) else len(messages)
    return len(messages)


def injected_message(pack: str, tag: str = PACK_TAG) -> SystemMessage:
    """The recalled block as one system message, given an element only if it arrives without one.

    This used to wrap unconditionally, and `renderPack` already emits the element — so every memory
    turn from R92 to R101 carried `<microglia-knowledge><microglia-knowledge version="1" note="…">`
    and the outer tag named a version it did not have. The sentence that does the work is the inner
    `note` attribute; the outer element was decoration that cost forty characters a call and told a
    reader the block was a copy of something.

    It is fixed as a **defect** rather than varied as a treatment, because no registration ever
    varied it and R102 moves the block: leaving it in the control would have made the R102/R99
    comparison differ in two places while the registration names one.

    The wrapping branch is kept for the facade that answers with data and no element. A block that
    arrives untagged is still made findable, because a host greps for one tag and a pack that no
    reader can locate is a pack that cannot be audited.
    """
    body = (
        pack
        if pack.lstrip().startswith(f"<{tag}")
        else f"<{tag}>\n{pack}\n</{tag}>"
    )
    return SystemMessage(role="system", content=body)


class MicrogliaAgent(LLMAgent):
    """`LLMAgent` whose recalled pack is settled on the first turn and then held.

    The two class attributes are defaults, not state: an instance that has never
    seen a turn reads `_UNSET` and an impossible length, and the first call settles
    both. Nothing is written in `__init__` because the constructor belongs to tau2.
    """

    _pack: object = _UNSET
    _turn: int = -1

    def board_for(self, state: LLMAgentState, text: str, role: str = "") -> str:
        """The goal board this turn should carry: the asks the request states, ticked by the receipts so far.

        Recomputed rather than held, and that is the whole difference between this channel and the note. A note is
        written once after a failure and read at the next attempt; a board is a function of the messages the episode
        already holds, so the board at turn nine knows what turn nine's tool receipts proved and the note at turn
        one could not. Nothing is memoised, because memoising it would make it the note again with a list inside.

        What **is** held is the last block, and only so the cadence can be counted: a turn whose block is
        byte-identical to the previous turn's is a turn the provider's prefix cache survives, and R214's arm changed
        the block on nearly every turn of every episode. The board's text is read from the request (R215), so the
        block can move only when a receipt moves it.

        The incoming message is read as a user turn only when it is one: τ² hands the tool results back through the
        same method, and a board that parsed `get_order_details` output as a request would list the catalogue.
        """
        global _board_renders, _board_items, _board_settled, _board_chars
        global _board_changes, _board_stable, _board_open, _board_unrequested, _board_unattributed
        if self.__dict__.get("_turn") is None:
            _open_episode(text or "")
        self._turn = len(state.messages)
        messages = list(state.messages)
        if isinstance(text, str) and text.strip() and role in ("", "user", "human"):
            messages = messages + [{"role": "user", "content": text}]
        board = goal_board_of(messages, board_scope())
        body = render_goal_board(board, state_only=board_admission() == "state")
        # R218e. The turn is counted before the early return, because a turn the block had nothing to say on is
        # still a model call the episode made: `turns` is the confound the dose reading has to hold, and a
        # population that silently dropped its empty turns would make the dose look steadier than it is.
        dose = _dose_here()
        if dose is not None:
            dose["turns"] += 1
        if body == "":
            return ""
        items = board.get("items") or []
        _board_renders += 1
        _board_items += len(items)
        _board_settled += sum(1 for item in items if item.get("settled_by"))
        _board_open += sum(1 for item in items if not item.get("settled_by"))
        _board_chars += len(body)
        _board_unrequested += len(board.get("unrequested") or ())
        _board_unattributed += len(board.get("unattributed") or ())
        same = self.__dict__.get("_body", None) == body
        if same:
            _board_stable += 1
        else:
            _board_changes += 1
        if dose is not None:
            dose["renders"] += 1
            dose["chars"] += len(body)
            if same:
                dose["stable"] += 1
            else:
                dose["changes"] += 1
        self._body = body
        return body

    def pack_for(self, state: LLMAgentState, text: str, role: str = "") -> str:
        """The pack this turn should carry, recalling only when the episode changed."""
        if board_mode():
            return self.board_for(state, text, role)
        turn = len(state.messages)
        held = self.__dict__.get("_pack", _UNSET)
        if held is _UNSET or turn <= self.__dict__.get("_turn", -1):
            # R128, repaired in R130. The boundary is recorded before the request, because the request is
            # what it names: `_recalls` is already the count of requests that succeeded, so it is the index
            # this one will take. It is recorded **only when a new instance opens**, which is the one
            # condition this side of the socket can distinguish: τ² constructs an agent per simulation, so
            # `_UNSET` means this episode has never recalled, while `turn <= _turn` can also mean a retry
            # inside the episode that already has a boundary. Appending on both made the list one entry per
            # request (R123: `[0..161]` over 160 episodes), which is a position, not a boundary.
            if held is _UNSET:
                # R218e: the text travels with the boundary from one site, because a caller that appends the text
                # itself is a caller that can forget — and one of them had (PROGRESS 249.13).
                _open_episode(text or "")
            else:
                global _recall_repeats
                _recall_repeats += 1
            held = recall(text)
            if held == "" and notes_path():
                # R206. No store on this arm: the material is the sentence the runner distilled from this task's
                # own last failed attempt. It is consulted only when the facade served nothing, because an arm
                # that carried both a pack and a note would be a third treatment nobody registered.
                held = note_for(text)
            if held:
                # The pack as the facade rendered it, before this agent adds anything. The difference
                # between this and the injected length is the wrapper's own carriage, and the difference
                # between that and the census's system column is the preamble's.
                _pack_chars.append(len(held))
                # R204: and then, when this arm writes its pack per request, the block becomes the
                # *input* to one model call instead of the thing the agent reads. The length above is
                # therefore the records the summariser was shown, and `injectedChars` below is the
                # sentence it wrote — two different objects, measured where each is made, which is what
                # R136's three lengths were for.
                if guidance_mode() == "guidance":
                    held = guidance(held, text)
        self._pack = held
        self._turn = turn
        return held

    def serve_tail(self, state: LLMAgentState, pack: str) -> LLMAgentState:
        """The state whose prompt carries exactly one board, placed after the conversation and moved only on change.

        Three properties, and each is a bug this did not have:

        * **one** — a state carrying two boards is a state that accumulated, which is what R137 repaired for the
          front placement and what a naive `kept + [injected]` would reintroduce here.
        * **after the conversation** — the front placement re-bills every token behind it when it moves; behind the
          conversation, a move re-bills only the messages that came after the old position.
        * **on change only** — an unchanged board is left exactly where it was written, so the turn costs nothing.
          A block re-written every turn would pay the message it sits behind on every turn, which is R215's bill
          with a smaller constant.
        * **legal** — never between an assistant message's `tool_calls` and the tool messages that answer them. That
          is not a preference: it is what the provider refuses, and R216's first dispatch lost a whole arm to it
          (`tail_index`).
        """
        global _injected_chars, _board_tail_appends, _board_tail_held, _pack_copies_dropped
        carried = [message for message in state.messages if is_pack_message(message)]
        if pack and carried and self.__dict__.get("_tail_body") == pack:
            _board_tail_held += 1
            return state
        if not pack and not carried:
            return state
        fresh = state.model_copy(deep=True)
        kept = [message for message in fresh.messages if not is_pack_message(message)]
        _pack_copies_dropped += len(fresh.messages) - len(kept)
        if pack:
            injected = injected_message(pack, BOARD_TAG)
            _injected_chars += len(injected.content)
            _injected_lengths.append(len(injected.content))
            # R218e. The dose as *carried*: this message, at this length, is what the prompt now holds. A held
            # turn returns above and adds nothing, which is the difference between the material served and the
            # material transported — the placement's price, recorded rather than inferred (PROGRESS 249.12).
            _dose_wrote(len(injected.content))
            if _episode_injected:
                _episode_injected[-1] = True
            at = tail_index(kept)
            kept = kept[:at] + [injected] + kept[at:]
            _board_tail_appends += 1
        self._tail_body = pack or None
        fresh.messages = kept
        return fresh

    def generate_next_message(
        self, message: ValidAgentInputMessage, state: LLMAgentState
    ) -> tuple:
        global _injected_chars, _calls, _pack_copies_dropped
        _calls += 1
        text = getattr(message, "content", None)
        pack = self.pack_for(
            state, text if isinstance(text, str) else "", str(getattr(message, "role", "") or "")
        )
        if board_mode() and board_placement() == "tail":
            # The board arm at R216: behind the conversation, one copy, moved only when a receipt moves it. The
            # front path below is kept unchanged so R214/R215's reading stays reproducible from a dispatch.
            return super().generate_next_message(message, self.serve_tail(state, pack))
        # R137. The invariant is not "inject a block" but "the prompt carries at most one block, and it is
        # this episode's". A state that already carries one is a state this method wrote — tau2 threads the
        # state the agent returns — so the earlier copy is removed whether or not this turn has one of its
        # own: a retry whose recall came back empty must not keep serving the attempt before it.
        carried = any(is_pack_message(m) for m in state.system_messages)
        if pack or carried:
            # A copy, not a mutation: appending to the shared state would make the
            # pack accumulate once per turn, and a ten-turn episode would carry ten
            # copies of it.
            state = state.model_copy(deep=True)
            # The copy above does not prevent that accumulation on its own, and this is the line that was
            # wrong for forty-five rounds: the copy is what the next turn is handed, so appending to it put
            # one more copy of the same block in the prompt every turn. The block is constant for the whole
            # episode (`pack_for` holds it), so any earlier copy is this method's own output read back.
            kept = [m for m in state.system_messages if not is_pack_message(m)]
            _pack_copies_dropped += len(state.system_messages) - len(kept)
            if pack:
                injected = injected_message(pack, BOARD_TAG if board_mode() else PACK_TAG)
                # R136: the length is taken from the message object rather than from the pack, because the
                # question is what the prompt *carried* — the element `injected_message` adds is part of the
                # bill, and a census that only knows the pack's length cannot see it.
                _injected_chars += len(injected.content)
                _injected_lengths.append(len(injected.content))
                # R218e, the front placement's half of the same record: here the block is replaced rather than
                # held, so `written` grows on every turn and the served and carried sums coincide. A placement
                # whose two numbers are equal is a placement that pays for its block on every turn — which is
                # exactly the bill R215 measured and R216 moved the block to avoid.
                _dose_wrote(len(injected.content))
                # R205: the episode this request belongs to carried a body. Guarded on the list being non-empty
                # because an agent constructed and driven without a recall has no boundary to raise, and a
                # `[-1]` on an empty list would take the episode down for the instrument's convenience.
                if _episode_injected:
                    _episode_injected[-1] = True
                kept = kept + [injected]
            state.system_messages = kept
        return super().generate_next_message(message, state)


def board_doses() -> list:
    """The dose records so far, in the order their boundaries opened.

    The runner needs them **between** rounds and not only at the end: `--rounds` runs each attempt as its own
    `run_tasks` call, and the round index is the only thing that tells two attempts at one task apart. A record
    carries the episode's opening text and not its task, because τ² never tells an agent which task it is in
    (R136), so the identity is resolved where the runner holds both sides — and the *round* is resolved here,
    by length, which is why this accessor returns the live list's contents rather than a counter.

    A copy of each record, not only of the list: `list(...)` protects the recording from an `append` and from nothing
    else, and a reader that edited `records[0]["turns"]` would be editing the phase's own total. The records are
    small and there are as many as there are episodes, so the copy is cheap and the alternative is a census nobody
    can trust.
    """
    return [dict(record) for record in _board_doses]


def memory_stats() -> dict:
    """What the run should record about the sidecar, so a zero is explainable."""
    stats = {
        "recall_url": _memory_url(),
        # R214: the board channel's own account. Absent on every arm that serves a note or a pack, present on the
        # arm whose material is computed from the episode rather than written between attempts.
        **(
            {
                "board": {
                    "placement": board_placement(),
                    # R219. What the block was allowed to say. A reading that reported the policy arm's numbers without
                    # this field would leave the one variable the round changed unstated, and a `state` value on an arm
                    # whose environment never carried it is the wiring defect this lane has counted six times.
                    "admission": board_admission(),
                    # R236. The turns the block was allowed to read and the rung it was rendered at. Two fields rather
                    # than a comment, because the arm a dispatch *asked* for is an argument and the arm that ran is a
                    # value: an environment that lost `clause` produces a block nobody measured, and the difference
                    # between that and a flat result is exactly this pair.
                    "scope": board_scope(),
                    "display": board_display(),
                    "renders": _board_renders,
                    "items": _board_items,
                    "settled": _board_settled,
                    "open": _board_open,
                    # The cadence, per turn. `changes / renders` is the share of turns that re-billed the prefix,
                    # which is the number R214 could only read from the provider's bill after the fact.
                    "changes": _board_changes,
                    "stable": _board_stable,
                    # The tail placement's price, per turn: appends are the writes and held is the free ones.
                    "tailAppends": _board_tail_appends,
                    "tailHeld": _board_tail_held,
                    # The checker's two refusals, apart: work nobody asked for, and the board's own blind spot.
                    "unrequested": _board_unrequested,
                    "unattributed": _board_unattributed,
                    "charsTotal": _board_chars,
                    "charsMean": round(_board_chars / _board_renders, 1) if _board_renders else None,
                    # R218e. How many episodes the recording holds, so a phase whose sidecar is short is visible in
                    # the census rather than only in the file: `len(doses)` at the end must equal the boundaries the
                    # same phase opened, and the writer's sum must equal the counters above.
                    "doseEpisodes": len(_board_doses),
                    "doseWritten": sum(record["written"] for record in _board_doses),
                    "doseChars": sum(record["chars"] for record in _board_doses),
                }
            }
            if board_mode()
            else {}
        ),
        # R218e. The dose records, one an episode. Carried beside the counters rather than inside them because the
        # runner *pops* this key: the records are joined to the task and the attempt, written as a sidecar, and the
        # log keeps the census rather than 114 dictionaries. A phase whose records are missing here is a phase whose
        # sidecar was never written, which is a different state from a phase whose join refused.
        **({"boardDoses": [dict(record) for record in _board_doses]} if board_mode() else {}),
        "recall_failures": _failures,
        "recalls": _recalls,
        # The population behind a treatment that withholds packs: `recalls - recall_empty` is what was
        # served, and `silent_because` is why the rest was not. A run that reports `recall_empty: 0` on
        # an arm whose gate never fired is a finding about the wiring, not about the store.
        "recall_empty": _empty,
        "silent_because": dict(_silent_because),
        # R123a: the population a margin gate would act on, and what each rung of it would cost. `rivaled`
        # is the denominator -- requests whose store returned at least two candidates -- and a run that
        # reports `rivaled: 0` on an arm whose gate never fired is a finding about the store rather than
        # about the rung.
        # `None` rather than `0` when no decision arrived: R123a read the absence as a zero and the run
        # printed a store result it had not measured. `census` is the denominator that tells them apart.
        "census": _census,
        # R128: where each episode's requests begin. `len(episodeStarts)` is the episode count, and the
        # difference between two consecutive entries is the requests one episode spent.
        "episodeStarts": list(_episode_starts),
        "recallRepeats": _recall_repeats,
        # R136: the task each boundary opened for, by the text the recall was built from. Same length and
        # same order as `episodeStarts` when the instrument ran, so a reader can subtract the two lists and
        # see a task that appears twice instead of a boundary count that disagrees with a trial count. The
        # *id* is not knowable on this side of the socket — the agent is never told which task it is in —
        # so the text travels and the runner resolves it against the messages it holds.
        "boundaryTexts": list(_boundary_tasks),
        # R205: one flag per boundary, positional against `episodeStarts`, and the count that sums it. The
        # population a served share is read over is the `True` entries -- not `recalls`, and not the number of
        # packs the facade rendered, which on a transient arm is the count of *inputs* to a summariser that
        # may have declined on most of them.
        "injectedEpisodes": list(_episode_injected),
        "episodesWithBody": sum(_episode_injected),
        # R136: the three lengths, in characters, that the system column is made of. `packChars` is what
        # the facade served, `injectedChars` is the message this agent built from it, and the census
        # carries the column the provider billed. `injectedCharsPerCall` divides by *this agent's* calls,
        # which is the only denominator the pack rides on: the census sees the user simulator's calls too.
        "packChars": round(sum(_pack_chars) / len(_pack_chars), 1) if _pack_chars else None,
        "injectedChars": round(sum(_injected_lengths) / len(_injected_lengths), 1)
        if _injected_lengths
        else None,
        "injectedMessages": len(_injected_lengths),
        # The sum, not only the mean: the census divides it by the calls *it* saw carrying a pack, and that
        # denominator is not this module's to assume — the two counts disagreeing is itself a reading.
        "injectedCharsTotal": _injected_chars,
        "injectedCharsPerCall": round(_injected_chars / _calls, 1) if _calls else None,
        "calls": _calls,
        # R137: the copies removed from the state the agent was handed. `calls - boundaries` when the
        # state is threaded and the block is injected once, which is the shape a reader checks this
        # against; a zero on a phase with more calls than boundaries is the defect this round fixed,
        # because it means the prompt never carried the block twice.
        "packCopiesDropped": _pack_copies_dropped,
        "rivaled": len(_margins) if _census else None,
        "margin_p10": quantile_of(_margins, 0.10),
        "margin_p50": quantile_of(_margins, 0.50),
        "margin_p90": quantile_of(_margins, 0.90),
        "margin_ladder": margin_ladder(_margins),
    }
    # R204: the transient arm's own account, absent on every arm that injects the block. Three populations
    # rather than one count, because a language model said something three different ways: `sentences` is a
    # served pack, `refusals` is the model declining on a request the records do not bear on (which is the
    # arm's own gate), and `failures` is the provider. A run whose failures are not zero cannot quote its
    # served share as the arm's own, which is why the count travels here and not only in a log line.
    if guidance_mode() == "guidance":
        stats["guidance"] = {
            "mode": "guidance",
            "model": guidance_model(),
            "calls": _guidance_calls,
            "sentences": len(_guidance_sentences),
            "refusals": _guidance_refusals,
            "failures": _guidance_failures,
            # What the summariser was shown, and what it wrote. The first is the block's own length plus
            # the request; the second is the sentence's, so the price of the arm is `promptChars` once an
            # episode against `sentenceChars` on every turn of it.
            "promptChars": _guidance_chars,
            "sentenceChars": round(sum(_guidance_sentences) / len(_guidance_sentences), 1)
            if _guidance_sentences
            else None,
            "firstFailure": _guidance_first_failure,
        }
    # R206: the notes arm's account, present only when this process was pointed at a sidecar. `hits / lookups`
    # is the coverage the registration predicts will be high (unlike R204's 6 of 40) because the summariser is
    # shown the task's own failure rather than records retrieved from other tasks.
    if notes_path() != "":
        stats["notes"] = {
            "path": notes_path(),
            "lookups": _note_lookups,
            "hits": _note_hits,
            # R207. The two identities, apart: a note found under the key is R206's mechanism, a note served
            # because the file names the task is this arm's. `hits` is their sum, so a reader that only knows the
            # older field still reads the same quantity.
            "keyHits": _note_key_hits,
            "taskHits": _note_task_hits,
            "chars": _note_chars,
            "problem": _note_problem,
            # What the file says it is: `task` on every R207 invocation, `many` only on a merge of them.
            "scope": scope_of(_note_document),
        }
    return stats
