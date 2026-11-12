"""A tau2-bench agent that recalls one microglia pack per episode.

Why this shape and not a fork of the benchmark: tau2 constructs its agents through
a registry (`tau2.registry.register_agent`) and calls
`AgentConstructor(tools=..., domain_policy=..., llm=..., llm_args=...)` for every
class that subclasses `LLMAgent`. Subclassing therefore needs no changes upstream —
the constructor is unchanged, and only `generate_next_message` is wrapped.

What the wrapper does:

  1. On the episode's first turn, takes the text of the incoming message and asks a
     local microglia facade for the pack relevant to it.
  2. Prepends that pack as one additional system message on a **copy** of the state.
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
from tau2.agent.base import ValidAgentInputMessage

DEFAULT_TIMEOUT_S = 5.0
MAX_QUERY_CHARS = 500
PACK_TAG = "microglia-knowledge"

_failures = 0
_reported = False
_recalls = 0

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
    global _failures, _reported, _recalls
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
    rendered = payload.get("rendered", "")
    return rendered if isinstance(rendered, str) else ""


def injected_message(pack: str) -> SystemMessage:
    return SystemMessage(
        role="system",
        content=f"<{PACK_TAG}>\n{pack}\n</{PACK_TAG}>",
    )


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
            held = recall(text)
        self._pack = held
        self._turn = turn
        return held

    def generate_next_message(
        self, message: ValidAgentInputMessage, state: LLMAgentState
    ) -> tuple:
        text = getattr(message, "content", None)
        pack = self.pack_for(state, text if isinstance(text, str) else "")
        if pack:
            # A copy, not a mutation: appending to the shared state would make the
            # pack accumulate once per turn, and a ten-turn episode would carry ten
            # copies of it.
            state = state.model_copy(deep=True)
            state.system_messages = list(state.system_messages) + [injected_message(pack)]
        return super().generate_next_message(message, state)


def memory_stats() -> dict:
    """What the run should record about the sidecar, so a zero is explainable."""
    return {
        "recall_url": _memory_url(),
        "recall_failures": _failures,
        "recalls": _recalls,
    }
