"""Self-check for the tau2 memory agent, runnable without tau2 installed.

The agent's job is not "produce a pack", it is "produce **one** pack per episode", and
both ways of getting that wrong are expensive rather than merely wrong:

* recalling every turn puts a different second system message in front of the same
  conversation, which destroys prefix caching for the rest of the prompt and makes the
  memory arm cost several times what the reference arm costs on identical work;
* accumulating a pack per turn makes the prompt grow with the square of the episode and
  makes the treatment a function of its own history.

Neither is visible in a run's score. Both are visible in a run's bill, which is why they
are asserted here rather than inferred from a delta afterwards.

`tau2` is not a dependency of this repository — it is cloned by the lane's workflow — so
the three names this module imports are stubbed. That is the point of the file: the
behaviour under test is *our* wrapper, and a test that needs a 400 MB benchmark installed
to check a loop counter is a test that will not run in `pnpm check`.

Run: `python3 eval/drivers/tau2/selfcheck_agent.py --self-test`
"""

from __future__ import annotations

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------------------- stubs


class SystemMessage:
    def __init__(self, role: str, content: str) -> None:
        self.role = role
        self.content = content

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"SystemMessage({self.content!r})"


class Message:  # noqa: D101 - only ever used as a type
    pass


class LLMAgentState:
    """The two fields the wrapper reads, with pydantic's copy semantics."""

    def __init__(self, messages=None, system_messages=None) -> None:
        self.messages = list(messages or [])
        self.system_messages = list(system_messages or [])

    def model_copy(self, deep: bool = False) -> "LLMAgentState":
        del deep
        return LLMAgentState(self.messages, self.system_messages)


class LLMAgent:
    def __init__(self, *args, **kwargs) -> None:
        del args, kwargs

    def generate_next_message(self, message, state):
        self.seen = state
        return ("assistant", state)


def _install_stub() -> None:
    """Register the three tau2 modules the agent imports, and nothing else."""
    modules = {
        "tau2": {},
        "tau2.agent": {},
        "tau2.data_model": {},
        "tau2.agent.llm_agent": {"LLMAgent": LLMAgent, "LLMAgentState": LLMAgentState},
        "tau2.data_model.message": {"Message": Message, "SystemMessage": SystemMessage},
        "tau2.agent.base": {"ValidAgentInputMessage": Message},
    }
    for name, attributes in modules.items():
        module = types.ModuleType(name)
        module.__path__ = []  # every stub is a package, so submodules resolve
        for key, value in attributes.items():
            setattr(module, key, value)
        sys.modules[name] = module


_install_stub()
sys.path.insert(0, HERE)

import microglia_agent as subject  # noqa: E402 - after the stub, by construction


# ----------------------------------------------------------------------- fixtures


class Turn:
    """A user or tool message, which is all the wrapper reads off one."""

    def __init__(self, content) -> None:
        self.content = content


def fresh(pack: str = "RULE", *, fail: bool = False):
    """An agent and a recorder, with `recall` replaced.

    `recall` is the module-level function, so patching it is the only seam that also
    covers the empty-string case — a capture that returns "" must settle the episode,
    not schedule another attempt on the next turn.
    """
    calls: list[str] = []

    def fake_recall(text: str) -> str:
        calls.append(text)
        if fail:
            raise AssertionError("recall must not be called")
        return pack

    original = subject.recall
    subject.recall = fake_recall
    return subject.MicrogliaAgent(), calls, original


def episode_step(agent, state, text: str):
    """One turn: the agent answers, and the conversation grows by two messages."""
    state.messages.append(("user", text))
    result = agent.generate_next_message(Turn(text), state)
    state.messages.append(("assistant", "ok"))
    return result


# -------------------------------------------------------------------------- tests


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


@case
def recalls_once_for_a_whole_episode(checks):
    agent, calls, original = fresh()
    try:
        state = LLMAgentState()
        for index in range(6):
            episode_step(agent, state, f"turn {index}")
    finally:
        subject.recall = original
    checks.equal(len(calls), 1, "six turns cost one recall")
    checks.equal(calls[0], "turn 0", "the pack is keyed on the first turn")


@case
def a_second_episode_recalls_again(checks):
    agent, calls, original = fresh()
    try:
        first = LLMAgentState()
        for index in range(4):
            episode_step(agent, first, f"a{index}")
        second = LLMAgentState()
        for index in range(3):
            episode_step(agent, second, f"b{index}")
    finally:
        subject.recall = original
    checks.equal(len(calls), 2, "one recall per episode, not per agent")
    checks.equal(calls[1], "b0", "the second pack comes from the second episode's first turn")


@case
def the_same_pack_is_served_every_turn(checks):
    agent, _, original = fresh(pack="STABLE")
    try:
        state = LLMAgentState()
        contents = []
        for index in range(3):
            episode_step(agent, state, f"t{index}")
            contents.append(agent.seen.system_messages[-1].content)
    finally:
        subject.recall = original
    checks.equal(len(set(contents)), 1, "the injected text does not move between turns")
    checks.substring(contents[0], "STABLE", "and it is the pack that was recalled")


@case
def the_pack_does_not_accumulate(checks):
    agent, _, original = fresh()
    try:
        state = LLMAgentState()
        lengths = []
        for index in range(5):
            episode_step(agent, state, f"t{index}")
            lengths.append(len(agent.seen.system_messages))
    finally:
        subject.recall = original
    checks.equal(lengths, [1, 1, 1, 1, 1], "one injected message, not one per turn")


@case
def an_empty_pack_is_not_injected(checks):
    agent, calls, original = fresh(pack="")
    try:
        state = LLMAgentState()
        episode_step(agent, state, "t0")
        first = len(agent.seen.system_messages)
        episode_step(agent, state, "t1")
    finally:
        subject.recall = original
    checks.equal(first, 0, "nothing is added when there is nothing to add")
    checks.equal(len(calls), 1, "and an empty answer still settles the episode")


@case
def the_state_is_copied_rather_than_mutated(checks):
    agent, _, original = fresh()
    try:
        state = LLMAgentState(messages=["seed"])
        episode_step(agent, state, "t0")
    finally:
        subject.recall = original
    checks.equal(len(state.system_messages), 0, "the caller's state is untouched")
    checks.equal(len(agent.seen.system_messages), 1, "the copy carries the pack")


@case
def the_block_is_wrapped_once(checks):
    """The renderer emits the element, and this wrapper used to emit a second one around it.

    The prompt carried `<microglia-knowledge><microglia-knowledge version="1" note="…">`, so the
    outer tag named no version and the inner one carried the sentence that does the work. Every
    memory turn of every arm from R92 to R101 was delivered that way. It is a defect rather than a
    treatment: no registration ever varied it, and R102 moves the block, so a reader comparing R102
    with R99 would have found two differences where the file names one.
    """
    block = (
        '<microglia-knowledge version="1" note="Reference data." items="1">\n'
        '{"id":"k_1"}\n'
        "</microglia-knowledge>"
    )
    agent, _, original = fresh(pack=block)
    try:
        state = LLMAgentState()
        episode_step(agent, state, "t0")
    finally:
        subject.recall = original
    content = agent.seen.system_messages[-1].content
    checks.equal(content.count("<microglia-knowledge"), 1, "one element, not an element in an element")
    checks.equal(content.count("</microglia-knowledge>"), 1, "and one closing tag")
    checks.equal(content, block, "the message is the block the facade rendered, byte for byte")


@case
def a_bare_body_is_wrapped_rather_than_sent_untagged(checks):
    """A facade that answered with data and no element is given one, so the block is still findable."""
    agent, _, original = fresh(pack='{"id":"k_1"}')
    try:
        state = LLMAgentState()
        episode_step(agent, state, "t0")
    finally:
        subject.recall = original
    content = agent.seen.system_messages[-1].content
    checks.substring(content, "<microglia-knowledge>", "a body with no element is wrapped")
    checks.substring(content, '{"id":"k_1"}', "and the body survives intact")
    checks.equal(content.count("<microglia-knowledge"), 1, "exactly once")


@case
def a_reused_agent_resets_on_a_shorter_conversation(checks):
    agent, calls, original = fresh()
    try:
        state = LLMAgentState()
        for index in range(9):
            episode_step(agent, state, f"long{index}")
        # tau2 hands the same instance a fresh state; only the length says so.
        fresh_state = LLMAgentState(messages=["only"])
        agent.generate_next_message(Turn("fresh"), fresh_state)
    finally:
        subject.recall = original
    checks.equal(len(calls), 2, "a conversation that shrank is a new episode")


@case
def a_non_string_message_still_produces_a_call(checks):
    agent, calls, original = fresh()
    try:
        state = LLMAgentState()
        state.messages.append(("user", "x"))
        agent.generate_next_message(Turn(content=None), state)
    finally:
        subject.recall = original
    checks.equal(calls, [""], "a tool call with no text is asked about as the empty string")


@case
def recall_is_not_attempted_without_a_facade(checks):
    """The real `recall`, against no URL: it must not count as a recall."""
    saved = os.environ.get("MICROGLIA_MEMORY_URL")
    os.environ["MICROGLIA_MEMORY_URL"] = ""
    before = subject._recalls  # noqa: SLF001 - the counter is the thing under test
    try:
        result = subject.recall("anything")
    finally:
        if saved is None:
            os.environ.pop("MICROGLIA_MEMORY_URL", None)
        else:
            os.environ["MICROGLIA_MEMORY_URL"] = saved
    checks.equal(result, "", "no facade means no pack")
    checks.equal(subject._recalls, before, "and no recall on the counter")  # noqa: SLF001


@case
def memory_stats_exposes_the_recall_count(checks):
    agent, _, original = fresh()
    try:
        state = LLMAgentState()
        for index in range(3):
            episode_step(agent, state, f"t{index}")
    finally:
        subject.recall = original
    stats = subject.memory_stats()
    checks.contains(
        sorted(stats),
        ["recall_failures", "recall_url", "recalls"],
        "the artefact can tell a store that was consulted from one that was not",
    )


# ------------------------------------------------------------------------- runner


class Checks:
    def __init__(self) -> None:
        self.total = 0
        self.failed: list[str] = []

    def equal(self, actual, expected, why: str) -> None:
        self.total += 1
        if actual != expected:
            self.failed.append(f"{why}: expected {expected!r}, got {actual!r}")

    def contains(self, actual, expected, why: str) -> None:
        self.total += 1
        if actual != expected:
            self.failed.append(f"{why}: expected {expected!r}, got {actual!r}")

    def substring(self, actual: str, expected: str, why: str) -> None:
        self.total += 1
        if expected not in actual:
            self.failed.append(f"{why}: {expected!r} is not in {actual!r}")


@case
def the_prefix_arm_asks_for_the_pack_the_registration_named(checks):
    """R55.1's switch has to reach the one request this lane makes.

    The knobs are resolved in TypeScript and carried here as a query fragment, so the failure this case
    covers is not a wrong value -- the route validates those and refuses them with a 400 -- but a
    fragment that never arrives. An arm that reported `packMode: prefix` and asked for a retrieved pack
    would be the control filed under the treatment's name, which is the defect the switch exists to end.
    """
    base = "http://memory.local"
    plain = subject.recall_url(base, "cancel my order", "retail", {})
    checks.equal(
        plain,
        "http://memory.local/v1/recall?task=tau2.act&text=cancel+my+order&domain=retail",
        "the retrieved arm sends exactly the request every committed artefact sent",
    )
    prefix = subject.recall_url(
        base,
        "cancel my order",
        "retail",
        subject.parse_knobs("anchoring=scope&minCoverage=0&limit=999&budget=200000"),
    )
    for fragment in ("anchoring=scope", "minCoverage=0", "limit=999", "budget=200000"):
        checks.substring(prefix, fragment, "the prefix arm carries every knob the resolver rendered")
    checks.equal(len(prefix.split("&")), 7, "four knobs are added to the three the lane always sends")


@case
def a_malformed_knob_is_dropped_rather_than_sent(checks):
    # An empty value would reach the route's validator and come back a 400, which this agent reports as
    # a recall failure -- an arm that served nothing would look like an unreachable sidecar.
    knobs = subject.parse_knobs("anchoring=scope&=&novalue&limit=999")
    checks.equal(sorted(knobs), ["anchoring", "limit"], "only the two well-formed pairs survive")


def main(argv: list[str]) -> int:
    if "--self-test" not in argv:
        print(__doc__)
        return 2
    checks = Checks()
    for fn in CASES:
        try:
            fn(checks)
            print(f"PASS  {fn.__name__}")
        except Exception as error:  # noqa: BLE001 - a raising case is a failing case
            checks.failed.append(f"{fn.__name__} raised {type(error).__name__}: {error}")
            print(f"FAIL  {fn.__name__} raised {type(error).__name__}: {error}")
    if checks.failed:
        print()
        for line in checks.failed:
            print(f"FAIL  {line}")
        return 1
    print(f"\n{len(CASES)} cases, {checks.total} assertions, all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
