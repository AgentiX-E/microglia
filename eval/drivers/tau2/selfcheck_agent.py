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
import json
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
        # The real `recall` increments this, and it is the request index a boundary records: a stub that
        # left it still would make every boundary `0`, which is a fixture that cannot fail the check it
        # exists for.
        subject._recalls += 1  # noqa: SLF001
        return pack

    original = subject.recall
    subject.recall = fake_recall
    # R137: the copy counter is the claim in two cases below, so it starts each one at zero. The other
    # counters are read as differences or as facts about a phase this file builds, and resetting them
    # here would be a fixture deciding what the code under test had done before it was called.
    subject._pack_copies_dropped = 0  # noqa: SLF001
    return subject.MicrogliaAgent(), calls, original


def episode_step(agent, state, text: str):
    """One turn, under the contract tau2 actually honours: **the returned state is the next one.**

    This used to hand the same object back on every turn, which made the wrapper look idempotent for
    a reason that had nothing to do with the wrapper: the agent copies the state it is given, so a
    copy of a state that never grew carries one injected message however many turns pass. tau2
    threads the state the agent *returns* — that is the only reason the copy is visible to the next
    turn at all — so a fixture that drops the return value asserts a contract the benchmark does not
    have, and the two ways of getting the loop wrong (a pack per turn, a recall per turn) become
    invisible to the only test that was written to catch them.

    R137. The defect this fixture hid was measured before it was believed: 11,105.9 characters of
    system a packed call against a 705-character message leaves room for 5.4 copies of the block.
    """
    state.messages.append(("user", text))
    _, out = agent.generate_next_message(Turn(text), state)
    out.messages.append(("assistant", "ok"))
    return out


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
            state = episode_step(agent, state, f"turn {index}")
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
            first = episode_step(agent, first, f"a{index}")
        second = LLMAgentState()
        for index in range(3):
            second = episode_step(agent, second, f"b{index}")
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
            state = episode_step(agent, state, f"t{index}")
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
            state = episode_step(agent, state, f"t{index}")
            lengths.append(len(agent.seen.system_messages))
    finally:
        subject.recall = original
    checks.equal(lengths, [1, 1, 1, 1, 1], "one injected message, not one per turn")
    # R137: the identity of that one message, not only its count. A wrapper that dropped the block and
    # appended nothing would pass the lengths above and serve no memory at all.
    checks.equal(
        agent.seen.system_messages[0].content.count("<microglia-knowledge"),
        1,
        "and the message in the prompt is the block itself, once",
    )
    checks.equal(
        subject._pack_copies_dropped,  # noqa: SLF001 - the counter is the claim
        4,
        "four of the five turns were handed a state that already carried the pack",
    )


@case
def a_policy_prompt_survives_the_replacement(checks):
    """The block is removed by identity, and every other system message is left exactly where it was.

    A wrapper that reset `system_messages` to `[injected]` would satisfy the count above and delete the
    benchmark's own policy prompt, which is the failure mode a length-only assertion cannot see.
    """
    agent, _, original = fresh(pack="PACK")
    try:
        policy = SystemMessage(role="system", content="You are a retail agent.")
        state = LLMAgentState(system_messages=[policy])
        for index in range(3):
            state = episode_step(agent, state, f"t{index}")
    finally:
        subject.recall = original
    contents = [m.content for m in agent.seen.system_messages]
    checks.equal(len(contents), 2, "the policy and one block")
    checks.equal(contents[0], "You are a retail agent.", "the policy is first and untouched")
    checks.substring(contents[1], "PACK", "the block follows it")


@case
def a_block_from_another_episode_is_replaced_rather_than_stacked(checks):
    """A retry hands the agent a state that already carried a *different* pack.

    The held pack is a property of the episode, and an episode that reopens has a pack of its own; keeping
    the stale one beside the new one would serve two memories that disagree and call it a treatment.
    """
    agent, _, original = fresh(pack="NEW")
    try:
        stale = SystemMessage(role="system", content="<microglia-knowledge>\nOLD\n</microglia-knowledge>")
        state = LLMAgentState(system_messages=[stale])
        state = episode_step(agent, state, "retry")
    finally:
        subject.recall = original
    contents = [m.content for m in agent.seen.system_messages]
    checks.equal(len(contents), 1, "one block, not two")
    checks.substring(contents[0], "NEW", "the one in the prompt is the one this episode recalled")
    checks.equal(
        contents[0].count("<microglia-knowledge"), 1, "and the stale one left no element behind"
    )


@case
def an_empty_pack_is_not_injected(checks):
    agent, calls, original = fresh(pack="")
    try:
        state = LLMAgentState()
        state = episode_step(agent, state, "t0")
        first = len(agent.seen.system_messages)
        state = episode_step(agent, state, "t1")
    finally:
        subject.recall = original
    checks.equal(first, 0, "nothing is added when there is nothing to add")
    checks.equal(len(calls), 1, "and an empty answer still settles the episode")


@case
def the_state_is_copied_rather_than_mutated(checks):
    agent, _, original = fresh()
    try:
        given = LLMAgentState(messages=["seed"])
        state = episode_step(agent, given, "t0")
    finally:
        subject.recall = original
    checks.equal(len(given.system_messages), 0, "the caller's state is untouched")
    checks.equal(len(state.system_messages), 1, "the copy carries the pack")
    checks.equal(len(agent.seen.system_messages), 1, "and the agent answered from the copy")


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
        state = episode_step(agent, state, "t0")
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
        state = episode_step(agent, state, "t0")
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
            state = episode_step(agent, state, f"long{index}")
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
            state = episode_step(agent, state, f"t{index}")
    finally:
        subject.recall = original
    stats = subject.memory_stats()
    checks.contains(
        sorted(stats),
        [
            "boundaryTexts",
            "calls",
            "census",
            "episodeStarts",
            "injectedChars",
            "injectedCharsPerCall",
            "injectedCharsTotal",
            "injectedMessages",
            "margin_ladder",
            "margin_p10",
            "margin_p50",
            "margin_p90",
            "packChars",
            "packCopiesDropped",
            "recallRepeats",
            "recall_empty",
            "recall_failures",
            "recall_url",
            "recalls",
            "rivaled",
            "silent_because",
        ],
        "the artefact can tell a store that was consulted from one that was not, and a pack that was "
        "withheld from one that had nothing to say",
    )


@case
def the_margin_ladder_prices_every_rung_at_once(checks):
    """R123a's instrument: what each threshold would cost, from one run that gates on none of them."""
    margins = [0.0, 0.005, 0.01, 0.03, 0.07, 0.14, 0.5]
    ladder = subject.margin_ladder(margins)
    # Strict, because `buildPack` withholds on `margin < speakMargin`: a margin equal to the rung serves.
    checks.equal(ladder["0.01"], 2, "0.000 and 0.005 fall below the first rung, and 0.010 does not")
    checks.equal(ladder["0.05"], 4, "the rung at five points withholds four of seven")
    checks.equal(ladder["0.30"], 6, "everything but the leader at half a point")
    checks.equal(list(ladder), ["0.01", "0.02", "0.05", "0.10", "0.15", "0.20", "0.30"], "the ladder is fixed")
    checks.equal(
        subject.margin_ladder([]),
        {"0.01": 0, "0.02": 0, "0.05": 0, "0.10": 0, "0.15": 0, "0.20": 0, "0.30": 0},
        "an empty population prices every rung at zero rather than being absent",
    )


@case
def a_margin_is_read_only_when_the_facade_measured_one(checks):
    """`None` is three facts, and a `0.0` standing in for them would report the run as contested."""
    checks.equal(subject.decision_margin({"decision": {"margin": 0.25}}), 0.25, "a measured margin is read")
    checks.equal(subject.decision_margin({"decision": {"margin": 0}}), 0.0, "a measured tie is a zero, not a None")
    checks.equal(subject.decision_margin({"decision": {"margin": None}}), None, "no rival is not a tie")
    checks.equal(subject.decision_margin({"decision": {"margin": True}}), None, "a bool is not a margin")
    checks.equal(subject.decision_margin({"decision": {"margin": "0.2"}}), None, "a string is not a margin")
    checks.equal(subject.decision_margin({"decision": None}), None, "a null census measured nothing")
    checks.equal(subject.decision_margin({}), None, "a response without a census measured nothing")


@case
def a_quantile_names_an_observed_request(checks):
    """Nearest-rank, because a margin the store never produced is not a margin."""
    checks.equal(subject.quantile_of([], 0.5), None, "an empty population has no quantile")
    checks.equal(subject.quantile_of([0.4], 0.9), 0.4, "one value is every quantile of itself")
    values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    checks.equal(subject.quantile_of(values, 0.10), 0.1, "the tenth percentile of ten is the first value")
    checks.equal(subject.quantile_of(values, 0.50), 0.5, "the median of ten is the fifth, not a fit between two")
    checks.equal(subject.quantile_of(values, 0.90), 0.9, "the ninetieth is the ninth")


@case
def an_empty_response_is_attributed_to_the_gate_that_withheld_it(checks):
    """R123's readback, as a pure function: the reason travels on the response or it is not stated."""
    checks.equal(subject.empty_bucket({"suppressed": "no-leader"}), "no-leader", "a withheld pack names its gate")
    checks.equal(
        subject.empty_bucket({"suppressed": "uncorroborated-store"}),
        "uncorroborated-store",
        "the corroboration floor keeps its own word",
    )
    checks.equal(subject.empty_bucket({}), "unattributed", "no reason is a state, not a zero")
    checks.equal(subject.empty_bucket({"suppressed": ""}), "unattributed", "an empty string is no reason")
    checks.equal(subject.empty_bucket({"suppressed": 7}), "unattributed", "and neither is a non-string")


@case
def the_boundary_records_the_task_it_opened_for(checks):
    """R136. A boundary index with no task is what made R135's 41-versus-40 a refusal.

    The two lists are positional against each other — same length, same order — because both are appended on
    the same branch: a new agent instance, which is the only episode signal this side of the socket has.
    """
    agent, _, original = fresh("PACK")
    try:
        before = subject.memory_stats()
        state = LLMAgentState()
        state = episode_step(agent, state, "where is my order 1234")
        after = subject.memory_stats()
    finally:
        subject.recall = original
    grown = after["boundaryTexts"][len(before["boundaryTexts"]) :]
    checks.equal(grown, ["where is my order 1234"], "the text the recall was built from")
    checks.equal(
        len(after["boundaryTexts"]),
        len(after["episodeStarts"]),
        "one task name per boundary, in the same order",
    )


@case
def a_boundary_text_is_recorded_at_the_length_the_recall_used(checks):
    """Truncated to `MAX_QUERY_CHARS`, because the text names the request that was made rather than the
    instruction the benchmark holds, and the runner matches the two by prefix."""
    agent, _, original = fresh("PACK")
    long_text = "q" * (subject.MAX_QUERY_CHARS + 200)
    try:
        before = subject.memory_stats()
        state = LLMAgentState()
        state = episode_step(agent, state, long_text)
        after = subject.memory_stats()
    finally:
        subject.recall = original
    grown = after["boundaryTexts"][len(before["boundaryTexts"]) :]
    checks.equal(len(grown[0]), subject.MAX_QUERY_CHARS, "the same slice the recall sends")


@case
def the_injected_message_is_measured_where_it_is_injected(checks):
    """R136's second instrument: the length of the message, not of the pack.

    The element `injected_message` adds is part of the bill, and a census that only knew the pack's length
    would price the pack and leave the wrapper unattributed — which is how a 725-character pack became a
    559-token system column nobody could decompose.
    """
    pack = "y" * 40
    agent, _, original = fresh(pack)
    expected = len(subject.injected_message(pack).content)
    try:
        before = subject.memory_stats()
        state = LLMAgentState()
        state = episode_step(agent, state, "t1")
        state = episode_step(agent, state, "t2")
        after = subject.memory_stats()
    finally:
        subject.recall = original
    checks.equal(
        after["injectedCharsTotal"] - before["injectedCharsTotal"],
        2 * expected,
        "two turns, two injections of the same message",
    )
    checks.equal(after["injectedMessages"] - before["injectedMessages"], 2, "and two messages counted")
    checks.equal(after["calls"] - before["calls"], 2, "over two generated messages, which is the denominator")
    checks.equal(after["packChars"] is not None, True, "the pack as served is recorded beside it")


@case
def an_episode_with_no_pack_injects_nothing_and_says_so(checks):
    """Every field stays absent rather than becoming a zero: a pack that was never served is not a pack of
    length zero, and a mean taken over it would report the wrapper as free."""
    agent, _, original = fresh("")
    try:
        before = subject.memory_stats()
        state = LLMAgentState()
        state = episode_step(agent, state, "t1")
        after = subject.memory_stats()
    finally:
        subject.recall = original
    checks.equal(after["injectedCharsTotal"], before["injectedCharsTotal"], "nothing was injected")
    checks.equal(after["injectedMessages"], before["injectedMessages"], "and nothing was counted")
    checks.equal(after["packChars"], before["packChars"], "no pack length was recorded either")
    checks.equal(after["calls"] - before["calls"], 1, "the call still happened")


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


@case
def the_census_denominator_separates_an_absent_measurement_from_a_zero(checks):
    """R127, from the run that made it necessary.

    R123a printed `0 rivaled request(s)` for 164 requests, and the truth was that no decision had crossed
    the facade's socket at all: the response was `{ rendered }`, `_margins` stayed empty, and an empty list
    printed as a fact about the store. The counter below is what lets the payload say `None` — no census —
    instead of `0`, and the two produce different sentences in a run's log.
    """
    saved_census = subject._census  # noqa: SLF001 - the counter is the thing under test
    saved_margins = list(subject._margins)  # noqa: SLF001
    try:
        subject._census = 0  # noqa: SLF001
        subject._margins.clear()  # noqa: SLF001
        stats = subject.memory_stats()
        checks.equal(stats["census"], 0, "a module that received nothing says so")
        checks.equal(
            stats["rivaled"],
            None,
            "and claims nothing about the store: `None` is not `0`, which is the whole repair",
        )
        # Three requests: one with no decision (the R123a wire), one with a decision and no rival, one with
        # a rival. Only the last can be withheld at any rung.
        subject._record_margin({"rendered": "x"})
        subject._record_margin({"rendered": "x", "decision": {"margin": None}})
        subject._record_margin({"rendered": "x", "decision": {"margin": 0.4}})
        stats = subject.memory_stats()
        checks.equal(stats["census"], 2, "two of the three carried a decision")
        checks.equal(stats["rivaled"], 1, "one of those had a rival")
        checks.equal(stats["margin_ladder"]["0.30"], 0, "a margin of 0.4 is above every rung")
    finally:
        subject._census = saved_census  # noqa: SLF001
        subject._margins[:] = saved_margins  # noqa: SLF001


@case
def an_episode_boundary_is_recorded_where_a_join_can_use_it(checks):
    """R128, from the gap R123a's transfer ledger exposed.

    `pack.ledger` says which ids each request served and `per_trial` says how each trial scored, and the two
    could not be joined: nothing marked where one episode's requests end. `recall` fires once per episode, so
    the counts are nearly equal -- **164 requests over 160 episodes** -- and "nearly" is what makes a
    positional join wrong at exactly the four episodes that recalled twice. The boundary is recorded on the
    episode, not on the request, because the request does not know which trial it belongs to and the episode
    is the only thing this side can see.
    """
    agent, _, original = fresh()
    saved = list(subject._episode_starts)  # noqa: SLF001
    saved_repeats = subject._recall_repeats  # noqa: SLF001
    try:
        subject._episode_starts.clear()  # noqa: SLF001
        state = LLMAgentState()
        state = episode_step(agent, state, "first turn")
        checks.equal(len(subject._episode_starts), 1, "one episode, one boundary")  # noqa: SLF001
        state = episode_step(agent, state, "second turn")
        checks.equal(
            len(subject._episode_starts),
            1,
            "a second turn of the same episode is not a new boundary, which is the whole difference "
            "between a request count and an episode count",
        )
        # A fresh *state* on the same instance is not a new episode: τ² builds one agent per task and trial
        # (`build_orchestrator` runs inside `run_single_task`, once per unit), so the instance is the episode.
        # R123's writer appended on this branch too, which is how 160 episodes were recorded as 162 boundaries.
        episode_step(agent, LLMAgentState(), "retry inside the episode")
        checks.equal(
            len(subject._episode_starts),  # noqa: SLF001
            1,
            "a reset conversation on the same instance is a repeat, not a boundary",
        )
        checks.equal(
            subject._recall_repeats - saved_repeats,  # noqa: SLF001
            1,
            "and it is counted, so the identity below can be checked",
        )
        # A new instance is what a new episode looks like to an agent that is never told it is new.
        second, _, _ = fresh()
        episode_step(second, LLMAgentState(), "next episode")
        # Absolute indices, because `_recalls` is a module counter other cases have advanced. What the
        # boundary means is the gap: two requests after the first episode opened, the second one did.
        boundaries = subject._episode_starts  # noqa: SLF001
        checks.equal(len(boundaries), 2, "two instances, two boundaries")
        checks.equal(boundaries[1] - boundaries[0], 2, "the second opened two requests after the first")
        checks.equal(
            sorted(subject.memory_stats()["episodeStarts"]),
            subject.memory_stats()["episodeStarts"],
            "the boundaries are a list the artefact can carry, not an opaque counter",
        )
    finally:
        subject._episode_starts[:] = saved  # noqa: SLF001
        subject.recall = original


@case
def a_repeated_call_needs_a_readable_payload(checks):
    """R125: the census may not manufacture the behaviour it counts.

    Two calls with no arguments are two calls, not a repeat — a reader that keyed on the name alone would
    report `retail` as an agent that calls `get_order_details` twice on every episode, and the resulting
    number would be large, stable, and about this reader rather than about the memory.
    """
    sys.path.insert(0, HERE)
    from turns import turn_census

    row = turn_census(
        [
            {
                "task_id": "5",
                "trial": 0,
                "messages": [
                    {"role": "assistant", "tool_calls": [{"name": "lookup"}, {"name": "lookup"}]},
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {"name": "lookup", "arguments": {"id": 1}},
                            {"name": "lookup", "arguments": {"id": 1}},
                            {"name": "lookup", "arguments": {"id": 2}},
                        ],
                    },
                ],
            }
        ]
    )
    checks.equal(row["toolCalls"], 5, "five calls were made")
    checks.equal(row["callsWithoutArguments"], 2, "the two without a payload are counted, not called repeats")
    checks.equal(row["repeatCalls"], 1, "one of the three readable calls repeats the first")


@case
def an_unreadable_episode_is_not_a_quiet_one(checks):
    """R125: the denominator that keeps `toolErrors: 0` from meaning two things."""
    sys.path.insert(0, HERE)
    from turns import turn_census

    quiet = turn_census([{"task_id": "5", "trial": 0, "messages": [{"role": "tool", "error": False}]}])
    checks.equal(quiet["toolErrors"], 0, "a result that carried the flag and did not fail is a measured zero")
    checks.equal(quiet["toolResultsWithFlag"], 1, "and it is the denominator")
    blind = turn_census([{"task_id": "5", "trial": 0, "messages": [{"role": "tool", "content": "ok"}]}])
    checks.equal(blind["toolErrors"], None, "a result without the flag leaves the count unmeasured")
    empty = turn_census([{"task_id": "5", "trial": 0}])
    checks.equal(empty["measurable"], 0, "an episode with no messages was not measured")
    checks.equal(empty["episodes"], 1, "and it still counts as an episode that ran")


@case
def a_boundary_is_an_episode_and_not_a_request(checks):
    """R130: the field named `episodeStarts` has to be a boundary, and R123's was a position.

    R123's phase recorded one entry per *recall* -- 162 recalls over 160 episodes produced `[0..161]`, one
    entry per request, strictly increasing -- so a reader could not tell it from a phase that really ran 162
    episodes, and both the serve split and R128's attribution read it. The repair is that only a fresh agent
    instance opens a boundary; a recall inside an episode is a repeat and is counted as one.
    """
    sys.path.insert(0, HERE)
    import microglia_agent as ma

    def fake_recall(text):
        ma._recalls += 1
        return "pack" if text else ""

    original = ma.recall
    starts_before = len(ma._episode_starts)
    repeats_before = ma._recall_repeats
    ma.recall = fake_recall
    try:
        # One episode, three turns: the pack is settled on the first and held for the rest, so this is one
        # recall and therefore one boundary.
        agent = object.__new__(ma.MicrogliaAgent)
        state = type("State", (), {"messages": []})()
        for turn in (1, 2, 3):
            state.messages = [None] * turn
            agent.pack_for(state, "hello")
        # A retry that resets the conversation, on the same instance: a recall, and NOT a boundary.
        state.messages = [None]
        agent.pack_for(state, "hello")
        # A second episode is a second instance, which is the one signal this side of the socket can read.
        second = object.__new__(ma.MicrogliaAgent)
        fresh = type("State", (), {"messages": [None]})()
        second.pack_for(fresh, "hello")
    finally:
        ma.recall = original

    checks.equal(len(ma._episode_starts) - starts_before, 2, "two episodes opened two boundaries")
    checks.equal(ma._recall_repeats - repeats_before, 1, "the retry inside the episode is a repeat")
    boundaries = ma._episode_starts[starts_before:]
    checks.equal(len(boundaries), 2, "two boundaries for two episodes")
    checks.equal(
        boundaries[1] - boundaries[0],
        2,
        "the second episode opened two requests after the first: one turn, one retry",
    )
    # The identity the artefact's reader relies on: every recall is either a boundary or a repeat, so a
    # boundary list that is short by more than the repeat count means a recall went uncounted.
    checks.equal(len(boundaries) + (ma._recall_repeats - repeats_before), 3, "three recalls, two of them starts")



def dump_stats() -> int:
    """Print `memory_stats()` as JSON, for the TypeScript side to read back.

    The counter that had no caller (AUDIT 34.154) is the reason this exists. A self-check certifies the
    function; it never certifies that the shape the function returns is the shape the reader expects. The
    lane's reader is `speakLineOf`, which lives in TypeScript, so the only honest contract test is one that
    hands the real payload across the language boundary and asserts the real line prints it.
    """
    print(json.dumps(subject.memory_stats(), sort_keys=True))
    return 0


def parse_decision() -> int:
    """Read one recall response and report what the lane's own reader makes of it.

    R127. The ladder is priced by `decision_margin`, and the payload it is handed is written by a
    TypeScript facade in another process. `--dump-stats` pins the shape of what this half *reports*; this
    pins what it *reads*, from bytes the other half produced. R123a is the run that made it necessary:
    the facade's response was `{ rendered }` by an explicit design note, the census stayed in-process,
    and the ladder printed seven zeros on a store serving 4.05 items per pack. Nothing failed. A missing
    field and a measured zero were the same reading, which is the defect class this record keeps finding
    and can only close where the two languages meet.
    """
    payload = json.load(sys.stdin)
    margin = subject.decision_margin(payload)
    print(
        json.dumps(
            {
                "margin": margin,
                "bucket": subject.empty_bucket(payload),
                # A `null` margin is not a rung reading: `margin_ladder` counts a population, and the
                # population of contested requests is what a rung costs.
                "ladder": subject.margin_ladder([] if margin is None else [margin]),
                "rungs": list(subject.MARGIN_RUNGS),
            },
            sort_keys=True,
        )
    )
    return 0


def parse_turns() -> int:
    """Read a phase's episodes as JSON and report the census the driver writes for it.

    R125. `turn_census` runs inside `run_split.py`, which imports the provider client and the harness, so a
    contract test that reached it through that module would be skipped on every machine without a 400 MB
    benchmark installed — and a skipped contract test is not a contract. The reader was therefore moved into
    `turns.py`, which imports nothing, and this entry point feeds it the same JSON the TypeScript side will
    read back: whatever is asserted here is asserted about the payload that ships.
    """
    sys.path.insert(0, HERE)
    from turns import turn_census  # noqa: PLC0415 - the module this entry point exists to exercise

    episodes = json.load(sys.stdin)
    print(json.dumps(turn_census(episodes), sort_keys=True))
    return 0


def main(argv: list[str]) -> int:
    if "--dump-stats" in argv:
        return dump_stats()
    if "--parse-decision" in argv:
        return parse_decision()
    if "--parse-turns" in argv:
        return parse_turns()
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
