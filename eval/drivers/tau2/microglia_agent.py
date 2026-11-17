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
`MICROGLIA_DOMAIN`, and optionally `MICROGLIA_TIMEOUT_S`.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request


from tau2.agent.llm_agent import LLMAgent, LLMAgentState
from tau2.data_model.message import Message, SystemMessage

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

# Sentinel rather than `None`, because "" is a real answer: a facade that was asked
# and had nothing to say must not be asked again on the next turn.
_UNSET = object()


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
    return isinstance(content, str) and content.lstrip().startswith(f"<{PACK_TAG}")


def injected_message(pack: str) -> SystemMessage:
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
        if pack.lstrip().startswith(f"<{PACK_TAG}")
        else f"<{PACK_TAG}>\n{pack}\n</{PACK_TAG}>"
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

    def pack_for(self, state: LLMAgentState, text: str) -> str:
        """The pack this turn should carry, recalling only when the episode changed."""
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
                _episode_starts.append(_recalls)
                # The same moment as the index, from the same string the recall will send. A boundary
                # that named its index and not its task is what made R135's 41-versus-40 a refusal.
                _boundary_tasks.append((text or "")[:MAX_QUERY_CHARS])
            else:
                global _recall_repeats
                _recall_repeats += 1
            held = recall(text)
            if held:
                # The pack as the facade rendered it, before this agent adds anything. The difference
                # between this and the injected length is the wrapper's own carriage, and the difference
                # between that and the census's system column is the preamble's.
                _pack_chars.append(len(held))
        self._pack = held
        self._turn = turn
        return held

    def generate_next_message(
        self, message: ValidAgentInputMessage, state: LLMAgentState
    ) -> tuple:
        global _injected_chars, _calls, _pack_copies_dropped
        _calls += 1
        text = getattr(message, "content", None)
        pack = self.pack_for(state, text if isinstance(text, str) else "")
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
                injected = injected_message(pack)
                # R136: the length is taken from the message object rather than from the pack, because the
                # question is what the prompt *carried* — the element `injected_message` adds is part of the
                # bill, and a census that only knows the pack's length cannot see it.
                _injected_chars += len(injected.content)
                _injected_lengths.append(len(injected.content))
                kept = kept + [injected]
            state.system_messages = kept
        return super().generate_next_message(message, state)


def memory_stats() -> dict:
    """What the run should record about the sidecar, so a zero is explainable."""
    return {
        "recall_url": _memory_url(),
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
