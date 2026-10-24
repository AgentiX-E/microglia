"""A tau2-bench agent that recalls a microglia pack before every turn.

Why this shape and not a fork of the benchmark: tau2 constructs its agents through
a registry (`tau2.registry.register_agent`) and calls
`AgentConstructor(tools=..., domain_policy=..., llm=..., llm_args=...)` for every
class that subclasses `LLMAgent`. Subclassing therefore needs no changes upstream —
the constructor is unchanged, and only `generate_next_message` is wrapped.

What the wrapper does:

  1. Takes the text of the incoming user or tool message.
  2. Asks a local microglia facade for the pack relevant to it.
  3. Prepends the pack as one additional system message, on a **copy** of the state,
     so a pack is never repeated turn after turn as the conversation grows.

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


def recall(text: str) -> str:
    """The rendered pack for one turn, or an empty string.

    A memory that is slow or absent must not fail the episode: the benchmark is
    measuring the agent, and an unreachable sidecar is an infrastructure fact that
    should appear in the run's notes rather than as a crashed simulation.
    """
    global _failures, _reported
    base = _memory_url()
    if base == "" or text.strip() == "":
        return ""
    domain = os.environ.get("MICROGLIA_DOMAIN", "").strip()
    query = {"task": "tau2.act", "text": text[:MAX_QUERY_CHARS]}
    if domain:
        query["domain"] = domain
    url = f"{base.rstrip('/')}/v1/recall?{urllib.parse.urlencode(query)}"
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
    """`LLMAgent` with one recalled system message in front of each turn."""

    def generate_next_message(
        self, message: ValidAgentInputMessage, state: LLMAgentState
    ) -> tuple:
        text = getattr(message, "content", None)
        pack = recall(text if isinstance(text, str) else "")
        if pack:
            # A copy, not a mutation: appending to the shared state would make the
            # pack accumulate once per turn, and a ten-turn episode would carry ten
            # copies of it.
            state = state.model_copy(deep=True)
            state.system_messages = list(state.system_messages) + [injected_message(pack)]
        return super().generate_next_message(message, state)


def memory_stats() -> dict:
    """What the run should record about the sidecar, so a zero is explainable."""
    return {"recall_url": _memory_url(), "recall_failures": _failures}
