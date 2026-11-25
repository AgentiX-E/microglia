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
# The sidecar's own format, imported rather than restated: a fixture that hardcoded the schema string would go on
# passing the day the schema moved — and moving it is exactly what R207 did (`microglia.notes/1` -> `/2`).
import notes as notes_module  # noqa: E402 - beside the agent it belongs to


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
            # R205: the population a share is read over, which no field before it could name.
            "episodesWithBody",
            "injectedChars",
            "injectedCharsPerCall",
            "injectedCharsTotal",
            "injectedEpisodes",
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
    # R205: the flag list is positional against the boundary list, so a case that empties one empties both --
    # and the case's own assertions are where the pairing is checked, because a fixture that cleared one and
    # not the other would leave every later case reading a shifted population.
    saved_flags = list(subject._episode_injected)  # noqa: SLF001
    saved_repeats = subject._recall_repeats  # noqa: SLF001
    try:
        subject._episode_starts.clear()  # noqa: SLF001
        subject._episode_injected.clear()  # noqa: SLF001
        state = LLMAgentState()
        state = episode_step(agent, state, "first turn")
        checks.equal(len(subject._episode_starts), 1, "one episode, one boundary")  # noqa: SLF001
        checks.equal(
            len(subject._episode_injected),  # noqa: SLF001
            len(subject._episode_starts),  # noqa: SLF001
            "and one flag, so the join between them stays positional",
        )
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
        subject._episode_injected[:] = saved_flags  # noqa: SLF001
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


@case
def an_empty_answer_clears_a_block_from_the_attempt_before_it(checks):
    """The invariant is not "inject a block" but "at most one block, and it is this episode's".

    A retry can be handed a state that carries the previous attempt's block and recall nothing of its own.
    Leaving that block in the prompt would serve a memory into an episode that asked for none, which is the
    one thing an empty answer must never do.
    """
    agent, _, original = fresh(pack="")
    try:
        stale = SystemMessage(role="system", content="<microglia-knowledge>\nOLD\n</microglia-knowledge>")
        state = LLMAgentState(system_messages=[stale])
        state = episode_step(agent, state, "retry")
    finally:
        subject.recall = original
    checks.equal(len(agent.seen.system_messages), 0, "the attempt before it left nothing behind")
    checks.equal(subject._pack_copies_dropped, 1, "and the removal is counted")  # noqa: SLF001


# ----------------------------------------------------------------- R204: the transient arm
#
# The arm's claim is a shape, not a score: the block the store served is *read* and what the prompt carries
# is one sentence written for that request, with nothing written back. Three of the four ways to get this
# wrong are silent — a call per turn (one per episode is the mechanism), a refusal counted as a provider
# failure (it is the arm's own gate), and a paragraph injected where a sentence was asked for (the pack is
# the durable artefact this arm exists not to write). The fourth, a failed call, must not take the episode
# down with it: the episode is already paid for by the time the sentence is asked for.


class _Reply:
    """The two attributes `guidance_sentence` reads off a provider reply, and nothing else."""

    def __init__(self, content) -> None:
        message = types.SimpleNamespace(content=content)
        self.choices = [types.SimpleNamespace(message=message)]


def fake_litellm(reply, *, raises: BaseException | None = None):
    """A `litellm` module whose one entry point records its arguments and answers `reply`.

    `reply` may be a list, answered in order with the last entry repeated. An arm has to be able to decline
    once and then speak, because that is the shape R204's fold produced on 34 episodes of 40 — and the shape
    the injected flag exists to keep out of the served population.
    """
    calls: list[dict] = []
    module = types.ModuleType("litellm")

    def answer():
        if isinstance(reply, list):
            return reply[min(len(calls) - 1, len(reply) - 1)]
        return reply

    def completion(**kwargs):
        calls.append(kwargs)
        if raises is not None:
            raise raises
        return _Reply(answer())

    module.completion = completion
    return module, calls


class guidance_arm:
    """Run one block with the transient arm on, a stubbed provider, and the counters at zero.

    A context manager rather than a fixture function because three things have to be undone on every exit
    path, and the one that matters is the module table: `litellm` is stubbed into `sys.modules`, and a case
    that left it there would make the *absence* of the package — the branch every machine without τ²
    installed takes — untestable for every case after it.
    """

    def __init__(self, reply: str = "", *, raises: BaseException | None = None, model: str | None = None):
        self.reply = reply
        self.raises = raises
        self.model = model

    def __enter__(self):
        self.saved = {
            key: os.environ.get(key)
            for key in (subject.GUIDANCE_ENV, subject.GUIDANCE_MODEL_ENV, "TAU_MODEL")
        }
        self.saved_module = sys.modules.get("litellm")
        self.calls: list[dict] = []
        if self.model is not None:
            os.environ[subject.GUIDANCE_MODEL_ENV] = self.model
        os.environ[subject.GUIDANCE_ENV] = "guidance"
        if self.raises is not _MISSING_PROVIDER:
            module, self.calls = fake_litellm(self.reply, raises=self.raises)
            sys.modules["litellm"] = module
        else:
            # No stub at all: `import litellm` raises, which is the branch a runner without τ² installed
            # takes and the one every local `pnpm check` run exercises.
            sys.modules.pop("litellm", None)
        subject._guidance_calls = 0  # noqa: SLF001
        subject._guidance_refusals = 0  # noqa: SLF001
        subject._guidance_failures = 0  # noqa: SLF001
        subject._guidance_chars = 0  # noqa: SLF001
        subject._guidance_sentences.clear()  # noqa: SLF001
        subject._guidance_first_failure = None  # noqa: SLF001
        return self

    def __exit__(self, *exc_info):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if self.saved_module is None:
            sys.modules.pop("litellm", None)
        else:
            sys.modules["litellm"] = self.saved_module
        return False


#: A sentinel for "the provider is not installed", which is not the same as "the provider raised".
_MISSING_PROVIDER = object()


@case
def the_transient_arm_writes_one_sentence_an_episode(checks):
    """R204's mechanism in one assertion: two episodes, two calls, and only the sentences in the prompt."""
    agent, recalls, original = fresh(pack="RECORDS-FROM-THE-STORE")
    try:
        with guidance_arm("Ask for the order id before quoting a refund.") as arm:
            state = LLMAgentState()
            for index in range(4):
                state = episode_step(agent, state, f"first{index}")
            first = state.system_messages[-1].content
            second = LLMAgentState()
            for index in range(2):
                second = episode_step(agent, second, f"second{index}")
    finally:
        subject.recall = original
    checks.equal(len(recalls), 2, "the store is asked twice, once per episode")
    checks.equal(len(arm.calls), 2, "and the summariser is asked once per episode, not once per turn")
    checks.substring(first, "Ask for the order id before quoting a refund.", "the sentence is the pack")
    checks.equal(
        first.count("RECORDS-FROM-THE-STORE"),
        0,
        "the records themselves never reach the prompt: they are the summariser's input",
    )
    checks.equal(subject._pack_chars[-1], len("RECORDS-FROM-THE-STORE"), "the block's length is still recorded")


@case
def the_summariser_is_shown_the_records_and_the_request(checks):
    """What the one call is asked, since the arm's whole treatment is that prompt."""
    agent, _, original = fresh(pack="R" * (subject.GUIDANCE_RECORDS_CHARS + 500))
    try:
        with guidance_arm("Do the thing.") as arm:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want a refund for order 42")
    finally:
        subject.recall = original
    call = arm.calls[0]
    system, user = call["messages"][0], call["messages"][1]
    checks.equal(system["role"], "system", "the instruction is a system turn")
    checks.substring(system["content"], "NONE", "the way to say nothing is stated, because it is the gate")
    checks.substring(user["content"], "I want a refund for order 42", "the request the sentence is for")
    checks.substring(user["content"], "RECORDS", "and the records it is written from")
    checks.equal(
        user["content"].count("R" * 100),
        subject.GUIDANCE_RECORDS_CHARS // 100,
        "a block past the bound is clipped rather than billed whole",
    )
    checks.equal(call["temperature"], 0, "the sentence is not a sample: the same records give the same pack")
    checks.equal(call["max_tokens"], subject.GUIDANCE_MAX_TOKENS, "one sentence is a token ceiling, not a hope")
    checks.equal(call["timeout"], subject.GUIDANCE_TIMEOUT_S, "and the call cannot outlast the episode's start")


@case
def a_refusal_is_the_arm_gate_and_not_a_failure(checks):
    """`NONE` is a model doing what it was asked, so counting it as a provider error would misread the arm."""
    agent, _, original = fresh()
    try:
        with guidance_arm("NONE") as arm:
            state = LLMAgentState()
            state = episode_step(agent, state, "anything")
            state = episode_step(agent, state, "anything else")
            # Read inside the block: the census is a function of the switch, and the switch is restored on
            # the way out — an arm that reported its own census after the mode moved would be uninstrumented.
            stats = subject.memory_stats()["guidance"]
    finally:
        subject.recall = original
    checks.equal(len(agent.seen.system_messages), 0, "a refusal serves nothing rather than the block")
    checks.equal(len(arm.calls), 1, "and the refusal is settled for the episode: no retry on the next turn")
    checks.equal(stats["refusals"], 1, "the refusal is counted as itself")
    checks.equal(stats["failures"], 0, "and not as an unreachable provider")
    checks.equal(stats["sentences"], 0, "nothing was served")


@case
def a_failed_call_serves_no_pack_and_does_not_end_the_episode(checks):
    """The episode is already paid for when the sentence is asked for: a provider error must not kill it."""
    agent, _, original = fresh()
    try:
        with guidance_arm(raises=RuntimeError("provider said no")):
            state = LLMAgentState()
            for index in range(3):
                state = episode_step(agent, state, f"t{index}")
            # A second episode fails the same way, which is the branch that keeps the log line to one per
            # phase: a phase whose every request logged the same error would bury its own reading.
            state = episode_step(agent, LLMAgentState(), "second episode")
            stats = subject.memory_stats()["guidance"]
    finally:
        subject.recall = original
    checks.equal(len(agent.seen.system_messages), 0, "no pack is injected")
    checks.equal(agent.seen is not None, True, "and the episode's own call still went through")
    checks.equal(stats["calls"], 2, "one call an episode, not one per turn")
    checks.equal(stats["failures"], 2, "counted as the provider's")
    checks.equal(stats["sentences"], 0, "and nothing is quoted as served")
    checks.substring(stats["firstFailure"] or "", "provider said no", "with the reason, for the run's log")


@case
def a_machine_without_the_provider_counts_a_failure(checks):
    """The branch every local run takes: `litellm` is τ²'s dependency, not this module's."""
    agent, _, original = fresh()
    try:
        with guidance_arm(raises=_MISSING_PROVIDER) as arm:
            state = LLMAgentState()
            state = episode_step(agent, state, "hello")
            stats = subject.memory_stats()["guidance"]
    finally:
        subject.recall = original
    checks.equal(len(arm.calls), 0, "no stub, so no call to record")
    checks.equal(stats["failures"], 1, "the import failure is a failure like any other")
    checks.substring(stats["firstFailure"] or "", "ModuleNotFoundError", "named as the missing package it is")


@case
def a_paragraph_is_clipped_to_a_sentence(checks):
    """The pack is the artefact this arm exists not to write, so its size is bounded where it is built."""
    agent, _, original = fresh()
    try:
        with guidance_arm("word " * 500):
            state = LLMAgentState()
            state = episode_step(agent, state, "t")
    finally:
        subject.recall = original
    injected = agent.seen.system_messages[-1].content
    sentence = subject.guidance_sentence(_Reply("word " * 500))
    checks.equal(len(sentence), subject.GUIDANCE_MAX_CHARS, "the sentence is clipped at the bound")
    checks.equal(
        injected.count("word"),
        subject.GUIDANCE_MAX_CHARS // 5,
        "and what the prompt carries is that clipped sentence, newlines already flattened",
    )


@case
def the_census_names_three_populations(checks):
    """One sentence, one refusal and one failure are three facts, and the run has to be able to say which."""
    agent, _, original = fresh(pack="BLOCK")
    try:
        with guidance_arm("Serve this.") as arm:
            first = LLMAgentState()
            first = episode_step(agent, first, "one")
            # A second and a third episode against replies chosen per call: the arm object is the stub,
            # so the reply list is swapped on the module it installed rather than on a second context.
            replies = iter(["NONE", _Reply("")])
            module = sys.modules["litellm"]

            def next_reply(**_kwargs):
                arm.calls.append(_kwargs)
                return _Reply(next(replies))

            module.completion = next_reply
            second = LLMAgentState()
            second = episode_step(agent, second, "two")
            third = LLMAgentState()
            third = episode_step(agent, third, "three")
            stats = subject.memory_stats()["guidance"]
    finally:
        subject.recall = original
    checks.equal(stats["calls"], 3, "three episodes, three calls")
    checks.equal(stats["sentences"], 1, "one sentence")
    checks.equal(stats["refusals"], 2, "two silences, and an empty reply is a silence rather than a failure")
    checks.equal(stats["failures"], 0, "the provider answered every time")
    checks.substring(stats["model"], "deepseek", "the model that wrote them is recorded beside the counts")
    checks.equal(stats["promptChars"] > 0, True, "and what it was shown is priced")
    checks.equal(stats["sentenceChars"], len("Serve this."), "beside what it wrote")


# ----------------------------------------------------------------- R205: the injected population
#
# R204's fold read its share over 50 facade renders and six sentences. The gate that should have caught it
# named the *cause* -- a failed call -- and the run declined through a different path with the same effect.
# The instrument is therefore the effect itself: one flag per episode, set where the message is built.


@case
def the_population_that_carried_a_body_is_the_one_the_share_is_read_over(checks):
    """R205. `serveYield` counts the packs the facade served; the agent may have read nothing."""
    agent, _, original = fresh(pack="RECORDS-FROM-THE-STORE")
    # The module's lists are the phase's, not the case's: every earlier case in this file appended to them,
    # so the reading is the tail this case added rather than the whole list.
    before = len(subject._episode_starts)  # noqa: SLF001
    try:
        with guidance_arm(["NONE", "Use the order id before quoting a refund."]) as arm:
            first = episode_step(agent, LLMAgentState(), "refund?")
            # τ² constructs one agent per simulation, so a second episode is a second instance: reusing this
            # one would make the second recall a *retry* of the first episode, which is a different case.
            second = episode_step(subject.MicrogliaAgent(), LLMAgentState(), "where is my order?")
            # Read inside the block: the census is a function of the switch, and the switch is restored on
            # the way out, which is how an earlier round read `guidance` after the arm had already ended.
            stats = subject.memory_stats()
    finally:
        subject.recall = original
    checks.equal(len(arm.calls), 2, "one call an episode")
    checks.equal(stats["injectedEpisodes"][before:], [False, True], "one flag per boundary, in request order")
    checks.equal(len(stats["episodeStarts"]) - before, 2, "positional against the boundaries the join uses")
    checks.equal(sum(stats["injectedEpisodes"][before:]), 1, "and the count is the list's own sum")
    checks.equal(stats["episodesWithBody"], sum(stats["injectedEpisodes"]), "which the census states once")
    checks.equal(len(first.system_messages), 0, "the episode that declined carried nothing")
    checks.equal(len(second.system_messages), 1, "the episode that spoke carried one message")


@case
def a_retry_that_finally_speaks_marks_its_episode_once(checks):
    """One episode, two calls: the first declined, the retry spoke. The population is episodes, not calls."""
    agent, recalls, original = fresh(pack="RECORDS-FROM-THE-STORE")
    before = len(subject._episode_starts)  # noqa: SLF001
    try:
        with guidance_arm(["NONE", "Use the order id."]):
            state = LLMAgentState()
            state.messages.append(("user", "refund?"))
            _, once = agent.generate_next_message(Turn("refund?"), state)
            # The host re-asks the same turn: the state did not advance, so the pack is decided again.
            _, twice = agent.generate_next_message(Turn("refund?"), once)
            stats = subject.memory_stats()
    finally:
        subject.recall = original
    checks.equal(len(stats["episodeStarts"]) - before, 1, "the retry opened no boundary of its own")
    checks.equal(len(recalls), 2, "and it did re-decide the pack")
    checks.equal(
        stats["injectedEpisodes"][before:], [True], "while the episode counts once, and as injected"
    )
    checks.equal(len(once.system_messages), 0, "the attempt that declined carried nothing")
    checks.equal(len(twice.system_messages), 1, "the retry carried the sentence")


@case
def a_failed_call_leaves_its_episode_out_of_the_served_population(checks):
    """The effect, not the cause: a provider error ends with no body exactly as a refusal does."""
    agent, _, original = fresh(pack="RECORDS-FROM-THE-STORE")
    before = len(subject._episode_starts)  # noqa: SLF001
    try:
        with guidance_arm(raises=RuntimeError("provider said no")):
            episode_step(agent, LLMAgentState(), "anything")
            stats = subject.memory_stats()
    finally:
        subject.recall = original
    checks.equal(
        stats["injectedEpisodes"][before:], [False], "the arm served nothing, so the episode is not served"
    )
    checks.equal(sum(stats["injectedEpisodes"][before:]), 0, "and the count agrees with the list")
    checks.equal(stats["guidance"]["failures"], 1, "which is the provider's, counted where it happened")


@case
def the_block_arm_makes_no_guidance_call_and_says_nothing_about_one(checks):
    """Absence is the statement: an arm before this one carried the block and had no summariser at all."""
    agent, _, original = fresh(pack="BLOCK")
    saved = os.environ.pop(subject.GUIDANCE_ENV, None)
    saved_model = os.environ.pop(subject.GUIDANCE_MODEL_ENV, None)
    try:
        state = LLMAgentState()
        state = episode_step(agent, state, "t")
        stats = subject.memory_stats()
    finally:
        subject.recall = original
        if saved is not None:
            os.environ[subject.GUIDANCE_ENV] = saved
        if saved_model is not None:
            os.environ[subject.GUIDANCE_MODEL_ENV] = saved_model
    checks.substring(agent.seen.system_messages[-1].content, "BLOCK", "the block is the pack")
    checks.equal("guidance" in stats, False, "and the census carries no guidance block at all")


@case
def the_switch_reads_five_spellings_and_defaults_to_the_arm_model(checks):
    """The switch is read on every call, and its default is the model the run already resolved."""
    saved = {key: os.environ.get(key) for key in (subject.GUIDANCE_ENV, subject.GUIDANCE_MODEL_ENV, "TAU_MODEL")}
    try:
        for spelling in ("1", "true", "yes", "guidance", "on", "ON"):
            os.environ[subject.GUIDANCE_ENV] = spelling
            checks.equal(subject.guidance_mode(), "guidance", f"'{spelling}' turns the arm on")
        for spelling in ("", "0", "rendered", "off", "no"):
            os.environ[subject.GUIDANCE_ENV] = spelling
            checks.equal(subject.guidance_mode(), "rendered", f"'{spelling}' leaves the arm alone")
        os.environ.pop(subject.GUIDANCE_ENV, None)
        checks.equal(subject.guidance_mode(), "rendered", "and unset is every arm before this one")
        os.environ.pop(subject.GUIDANCE_MODEL_ENV, None)
        os.environ["TAU_MODEL"] = "deepseek/deepseek-chat"
        checks.equal(subject.guidance_model(), "deepseek/deepseek-chat", "the arm's own model by default")
        os.environ[subject.GUIDANCE_MODEL_ENV] = "someone/else"
        checks.equal(subject.guidance_model(), "someone/else", "unless a dispatch names another")
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@case
def a_reply_this_module_cannot_read_is_a_silence(checks):
    """Four shapes a provider can answer with, and every one of them has to leave the prompt unchanged."""
    checks.equal(subject.guidance_sentence(_Reply(None)), "", "no content is no sentence")
    checks.equal(subject.guidance_sentence(_Reply("")), "", "an empty reply is no sentence")
    checks.equal(subject.guidance_sentence(_Reply("NONE")), "", "and a refusal is no sentence")
    checks.equal(subject.guidance_sentence(_Reply("  none.  ")), "", "however it is spelled or spaced")
    checks.equal(subject.guidance_sentence(types.SimpleNamespace(choices=[])), "", "no choices is no sentence")
    checks.equal(
        subject.guidance_sentence(types.SimpleNamespace(choices=None)),
        "",
        "and a reply without the attribute at all is the same silence",
    )
    checks.equal(
        subject.guidance_sentence(_Reply("line one\nline two")),
        "line one line two",
        "a sentence that arrived with a newline is flattened, because the prompt has one line a sentence",
    )


@case
def the_timeout_is_a_positive_number_or_the_default(checks):
    """The sidecar's timeout, which had no test because every case stubs `recall` itself.

    Four states, and the three that are not a number all have to land on the same default rather than on
    zero: a timeout of zero is not a patient client, it is every recall failing.
    """
    saved = os.environ.get("MICROGLIA_TIMEOUT_S")
    try:
        os.environ.pop("MICROGLIA_TIMEOUT_S", None)
        checks.equal(subject._timeout(), subject.DEFAULT_TIMEOUT_S, "unset is the default")  # noqa: SLF001
        os.environ["MICROGLIA_TIMEOUT_S"] = "12.5"
        checks.equal(subject._timeout(), 12.5, "a number is honoured")  # noqa: SLF001
        os.environ["MICROGLIA_TIMEOUT_S"] = "soon"
        checks.equal(subject._timeout(), subject.DEFAULT_TIMEOUT_S, "junk is the default")  # noqa: SLF001
        os.environ["MICROGLIA_TIMEOUT_S"] = "-3"
        checks.equal(subject._timeout(), subject.DEFAULT_TIMEOUT_S, "and so is a negative")  # noqa: SLF001
    finally:
        if saved is None:
            os.environ.pop("MICROGLIA_TIMEOUT_S", None)
        else:
            os.environ["MICROGLIA_TIMEOUT_S"] = saved


class fake_urlopen:
    """The one call `recall` makes, replaced: a response object or an exception, recorded."""

    def __init__(self, payload=None, *, raises: BaseException | None = None) -> None:
        self.payload = payload
        self.raises = raises
        self.urls: list[str] = []

    def __call__(self, url, timeout=None):
        del timeout
        self.urls.append(url)
        if self.raises is not None:
            raise self.raises
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


@case
def an_unreachable_facade_is_a_failure_and_not_a_crash(checks):
    """The sidecar's own failure branch, which every paid run reaches and no test did.

    A memory that is slow or absent must not fail the episode: the benchmark is measuring the agent, and the
    right outcome is an empty pack plus a counted failure. The print is once per phase, because a run whose
    every request logged the same socket error would bury its own log.
    """
    saved_url = os.environ.get("MICROGLIA_MEMORY_URL")
    saved_open = __import__("urllib.request", fromlist=["urlopen"]).urlopen
    failures_before, reported_before = subject._failures, subject._reported  # noqa: SLF001
    import urllib.request

    try:
        os.environ["MICROGLIA_MEMORY_URL"] = "http://127.0.0.1:9"
        subject._failures, subject._reported = 0, False  # noqa: SLF001
        urllib.request.urlopen = fake_urlopen(raises=OSError("connection refused"))
        checks.equal(subject.recall("please cancel"), "", "an unreachable sidecar serves no pack")
        checks.equal(subject.recall("please cancel again"), "", "and keeps serving none")
        checks.equal(subject._failures, 2, "both attempts are counted")  # noqa: SLF001
        checks.equal(subject._reported, True, "the log line is printed once")  # noqa: SLF001
        # And the served path through the same function: the block the facade answered with is what it
        # returns, and an empty block is a silence with the facade's own reason attached.
        urllib.request.urlopen = fake_urlopen({"rendered": "BLOCK", "decision": {"margin": 0.3}})
        checks.equal(subject.recall("cancel"), "BLOCK", "a served pack is the rendered block")
        urllib.request.urlopen = fake_urlopen({"rendered": "", "suppressed": "nothing-matched"})
        checks.equal(subject.recall("cancel"), "", "an empty answer stays empty")
        urllib.request.urlopen = fake_urlopen({"rendered": 42})
        checks.equal(subject.recall("cancel"), "", "and a payload whose block is not text is no pack")
        # `bool` is an `int` in Python, so a census answering `true` would enter the ladder as a margin of
        # 1.0 — a rung no request can ever beat, printed as a store that contested nothing.
        checks.equal(subject.decision_margin({"decision": {"margin": True}}), None, "a boolean is not a margin")
        checks.equal(subject.decision_margin({"decision": {"margin": 0.25}}), 0.25, "a number is")
        checks.equal(subject.decision_margin({"rendered": "x"}), None, "and a response with no census is none")
        os.environ["MICROGLIA_MEMORY_URL"] = ""
        checks.equal(subject.recall("cancel"), "", "and no configured sidecar is no request at all")
        checks.equal(
            subject._timeout() > 0,  # noqa: SLF001
            True,
            "the request that was never made carries a timeout when it is",
        )
    finally:
        urllib.request.urlopen = saved_open
        subject._failures, subject._reported = failures_before, reported_before  # noqa: SLF001
        subject._silent_because.clear()  # noqa: SLF001
        if saved_url is None:
            os.environ.pop("MICROGLIA_MEMORY_URL", None)
        else:
            os.environ["MICROGLIA_MEMORY_URL"] = saved_url


# ------------------------------------------------------------------ R206, the notes arm


class notes_arm:
    """A sidecar in a temporary directory, with the environment pointed at it and put back on exit.

    Three things are undone on every exit path: the environment variable, the directory, and the module's
    cached document. The last is the one that would poison the file: the agent caches by `(mtime, size)`, and a
    case that left a document cached would make the *next* case's first read return this case's notes — a
    treatment leaking between tests, in the one test file whose subject is a treatment that must not leak
    between tasks.
    """

    def __init__(self, notes: dict | None = None, *, corrupt: bool = False, scope: dict | None = None):
        self.notes = dict(notes or {})
        self.corrupt = corrupt
        # R207. Every sidecar declares the task it describes — that declaration *is* the identity now — and the
        # default here is one task, because one invocation writes one. `scope` overrides it for the one case whose
        # subject is a file that cannot name a task (a merge of several), where the fallback must not fire.
        self.scope = scope if scope is not None else {"kind": "task", "task": "1"}

    def __enter__(self):
        import tempfile

        self.saved = os.environ.get(subject.NOTES_ENV)
        self.directory = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.directory.name, "notes.json")
        os.environ[subject.NOTES_ENV] = self.path
        subject._note_document = {}  # noqa: SLF001
        subject._note_loaded_at = None  # noqa: SLF001
        if self.corrupt:
            with open(self.path, "w", encoding="utf-8") as stream:
                stream.write("{ not json")
        elif self.notes:
            self.write(self.notes)
        self.lookups = subject._note_lookups  # noqa: SLF001
        self.hits = subject._note_hits  # noqa: SLF001
        return self

    def write(self, notes: dict) -> None:
        """Write the sidecar in the runner's own shape, at a new mtime.

        The entry is `{note, attempt, reward, task, chars}` and not a bare string, because the format is what
        `notes.record` writes and a fixture that spoke a simpler one would test a reader nobody runs.
        """
        import json as _json

        document = {
            "schema": notes_module.SCHEMA,
            "scope": self.scope,
            "notes": {
                key: {"note": value, "attempt": 1, "reward": 0.0, "task": "1", "chars": len(value)}
                for key, value in notes.items()
            },
        }
        with open(self.path, "w", encoding="utf-8") as stream:
            _json.dump(document, stream)

    def write_text(self, text: str) -> None:
        """Write a document verbatim, for the states the entry-map constructor cannot express."""
        with open(self.path, "w", encoding="utf-8") as stream:
            stream.write(text)

    def __exit__(self, *exc_info):
        if self.saved is None:
            os.environ.pop(subject.NOTES_ENV, None)
        else:
            os.environ[subject.NOTES_ENV] = self.saved
        subject._note_document = {}  # noqa: SLF001
        subject._note_loaded_at = None  # noqa: SLF001
        subject._note_problem = None  # noqa: SLF001
        self.directory.cleanup()
        return False


@case
def a_note_from_the_sidecar_is_the_pack_that_episode_reads(checks):
    """R206's mechanism in one assertion: no store, no retrieval, one sentence keyed by the opening message."""
    with notes_arm({"I want a refund for order 42": "Ask for the order id before quoting a refund."}) as arm:
        agent, recalls, original = fresh(pack="")
        try:
            state = LLMAgentState()
            for index in range(3):
                state = episode_step(agent, state, "I want a refund for order 42" if index == 0 else f"t{index}")
        finally:
            subject.recall = original
        contents = [message.content for message in state.system_messages]
        stats = subject.memory_stats()
    checks.equal(len(recalls), 1, "the facade is still asked once per episode")
    checks.equal(len(contents), 1, "and one message reached the prompt")
    checks.substring(contents[0], "Ask for the order id before quoting a refund.", "which is the note")
    checks.equal(arm_hits(arm), 1, "one lookup found the note")
    checks.equal(stats["notes"]["hits"], 1, "and the artefact carries it")
    checks.equal(stats["notes"]["lookups"] - arm.lookups, 1, "one lookup for one episode, not one per turn")
    checks.equal(subject._pack_copies_dropped, 2, "the held note is re-injected by replacement, not appended")


def arm_hits(arm):
    return subject._note_hits - arm.hits  # noqa: SLF001


@case
def a_note_is_served_by_the_file_rather_than_by_the_text(checks):
    """R207's mechanism in one assertion: the opening is paraphrased, and the note arrives anyway.

    R206 keyed the note on the opening message, and R206a measured that key at 0.006 exact reuse over 168
    same-task pairs — so on this corpus the text binding almost never fires. Here the request differs from the
    one the note was written under, the file declares the task, and the sentence is served: `taskHits` moves and
    `keyHits` does not.
    """
    with notes_arm({"I want a refund for order 42": "Ask for the order id before quoting a refund."}) as arm:
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "Hello, could you refund my order 42 please?")
        finally:
            subject.recall = original
        stats = subject.memory_stats()
    checks.equal(len(state.system_messages), 1, "the file's task served the note on a key miss")
    checks.substring(state.system_messages[0].content, "Ask for the order id before quoting a refund.",
                     "which is the note")
    checks.equal(stats["notes"]["hits"] - arm.hits, 1, "one hit")
    checks.equal(stats["notes"]["taskHits"] - 0 >= 1, True, "and it is counted as a task hit")
    checks.equal(stats["notes"]["scope"], {"kind": "task", "task": "1"},
                 "the artefact says which task the file named")


@case
def a_file_carrying_another_tasks_note_serves_nothing(checks):
    """The one state R207 could reintroduce R206's cross-task defect in, refused at the reader.

    A sidecar that declares task 1 while holding an entry for task 9 is either a writer that crossed two tasks or
    a runner that pointed one task at another's file. Serving that sentence is the mechanism R41 and R204
    measured; returning nothing is the only answer that cannot be wrong.
    """
    with notes_arm({}) as arm:
        arm.write_text(
            '{"schema": "microglia.notes/2", "scope": {"kind": "task", "task": "1"},'
            ' "notes": {"I want a refund": {"note": "Nine\'s sentence.", "attempt": 1, "reward": 0.0,'
            ' "task": "9", "chars": 16}}}'
        )
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want a refund")
        finally:
            subject.recall = original
        stats = subject.memory_stats()
    checks.equal(len(state.system_messages), 0, "nothing is served")
    checks.equal(stats["notes"]["hits"] - arm.hits, 0, "and no hit is claimed")


@case
def a_task_without_a_note_serves_nothing_and_says_so(checks):
    """The first round: no sidecar entry exists yet, and that is a lookup with no hit rather than an error.

    The sidecar here declares `many` — a file merged from several tasks — which is the state in which R207's
    single-task fallback must *not* fire: with more than one task in the file the identity is unknown again, and
    serving "the" entry would be serving a neighbour's sentence. A file declaring one task answers differently,
    and `a_note_is_served_by_the_file_rather_than_by_the_text` is that case.
    """
    with notes_arm({"another task": "Ask for the order id."},
                   scope={"kind": "many", "tasks": ["1", "9"]}) as arm:
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want a refund for order 42")
        finally:
            subject.recall = original
        stats = subject.memory_stats()
    checks.equal(len(state.system_messages), 0, "no note means no second system message")
    checks.equal(stats["notes"]["lookups"] - arm.lookups, 1, "the lookup happened")
    checks.equal(arm_hits(arm), 0, "and found nothing")
    checks.equal(stats["notes"]["problem"], None, "which is not a fault")


@case
def an_unreadable_sidecar_is_a_problem_and_not_a_silence(checks):
    """A corrupted file must not read as "the material was tried and had nothing".

    This is the collapse the repository has repaired ten times: `hits: 0` from a sidecar nobody could parse is
    a treatment that never ran, and an artefact that could not tell it from round one would publish a mechanism
    as inert when the mechanism had not been executed.
    """
    with notes_arm(corrupt=True) as arm:
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want a refund for order 42")
        finally:
            subject.recall = original
        stats = subject.memory_stats()
    checks.equal(len(state.system_messages), 0, "nothing is served")
    checks.equal(stats["notes"]["problem"] is not None, True, "and the artefact names the problem")
    checks.substring(str(stats["notes"]["problem"]), "JSONDecodeError", "with the reason a reader can act on")
    checks.equal(arm_hits(arm), 0, "no hit is claimed")


@case
def a_note_written_between_rounds_is_read_by_the_next_episode(checks):
    """The staleness defect, as a case: a document cached at the first read would serve round one forever.

    Rounds share one process — that is what makes the handoff possible at all — so a cache keyed on nothing
    would make the treatment constant and the arm would measure a note the first round could not have had.
    """
    with notes_arm() as arm:
        agent, _, original = fresh(pack="")
        try:
            first = LLMAgentState()
            first = episode_step(agent, first, "I want a refund for order 42")
            arm.write({"I want a refund for order 42": "Ask for the order id first."})
            second = LLMAgentState()
            second = episode_step(agent, second, "I want a refund for order 42")
        finally:
            subject.recall = original
    checks.equal(len(first.system_messages), 0, "round one had nothing to read")
    checks.equal(len(second.system_messages), 1, "round two read what round one wrote")
    checks.substring(second.system_messages[0].content, "Ask for the order id first.", "and it is the note")


@case
def the_board_is_recomputed_and_never_accumulates(checks):
    """R214's two properties in one case: the board is a function of the episode, and there is only ever one.

    Both are the difference between a working memory and a note. A board that were held at the first turn would be
    a note written before the failure; a board that were appended rather than replaced would cost its own length on
    every turn of every episode, which is the defect R137 removed from the pack and this channel would have
    reintroduced under a different tag.
    """
    saved = os.environ.get(subject.BOARD_ENV)
    os.environ[subject.BOARD_ENV] = "1"
    try:
        agent, calls, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want to exchange the mechanical keyboard.")
            first = state.system_messages[0].content
            order = {"order_id": "#W2378156", "items": [{"item_id": "1151293680", "name": "Mechanical Keyboard"}]}
            state.messages.append({"role": "assistant", "content": "", "tool_calls": [
                {"name": "get_order_details", "arguments": {"order_id": "#W2378156"}},
                {"name": "exchange_delivered_order_items", "arguments": {"item_ids": ["1151293680"]}},
            ]})
            state.messages.append({"role": "tool", "content": json.dumps(order)})
            state.messages.append({"role": "tool", "content": json.dumps({"ok": True})})
            state = episode_step(agent, state, "yes please")
            second = state.system_messages[0].content
        finally:
            subject.recall = original
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(len(calls), 0, "the board arm does not consult the store")
    checks.substring(first, subject.BOARD_TAG, "the first turn carries a board")
    checks.substring(first, "[ ] exchange: mechanical keyboard", "and the ask is open")
    checks.substring(second, "[x] exchange: mechanical keyboard", "the receipt settles it on the next turn")
    checks.equal(len(state.system_messages), 1, "one board in the prompt, not one per turn")


@case
def the_contract_does_not_grow_from_the_conversation(checks):
    """R215. The asks come from the request, and the block moves only when a receipt moves it.

    R214 read every user turn, so a simulated user's clarifications ("also the desk lamp") became asks, the block
    changed on nearly every turn, and the provider's prefix cache fell 15 points — 77% more money for a list that
    had grown to eleven lines and closed one of them. Two properties are asserted here, and they are one mechanism:
    a request fixed before the first call, and a block whose text is a function of the receipts since.
    """
    saved = os.environ.get(subject.BOARD_ENV)
    os.environ[subject.BOARD_ENV] = "1"
    before = subject.memory_stats().get("board") or {}
    try:
        agent, calls, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want to exchange the mechanical keyboard.")
            first = state.system_messages[0].content
            state = episode_step(agent, state, "also the desk lamp and the thermostat")
            second = state.system_messages[0].content
            order = {"order_id": "#W2378156", "items": [{"item_id": "1151293680", "name": "Mechanical Keyboard"}]}
            state.messages.append({"role": "assistant", "content": "", "tool_calls": [
                {"name": "get_order_details", "arguments": {"order_id": "#W2378156"}},
                {"name": "exchange_delivered_order_items", "arguments": {"item_ids": ["1151293680"]}},
            ]})
            state.messages.append({"role": "tool", "content": json.dumps(order)})
            state.messages.append({"role": "tool", "content": json.dumps({"ok": True})})
            state = episode_step(agent, state, "thanks")
            third = state.system_messages[0].content
            state = episode_step(agent, state, "and the desk lamp?")
            fourth = state.system_messages[0].content
            after = subject.memory_stats().get("board") or {}
        finally:
            subject.recall = original
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(len(calls), 0, "the board arm does not consult the store")
    checks.substring(first, "[ ] exchange: mechanical keyboard", "the request's ask is open on the first turn")
    checks.equal("lamp" in second, False, "a clarification does not add an ask to the contract")
    checks.equal(second, first, "so the block is byte-identical and the prefix survives")
    checks.substring(third, "[x] exchange: mechanical keyboard", "a receipt ticks the ask it names")
    checks.equal(fourth, third, "and a turn after the change is stable again")
    # The cadence, as the arm counts it: two changes (the contract, then the tick) over four served turns.
    checks.equal(after["changes"] - before["changes"], 2, "the block changed twice in four turns")
    checks.equal(after["stable"] - before["stable"], 2, "and was re-served unchanged twice")
    checks.equal(after["renders"] - before["renders"], 4, "every turn carried a block")


@case
def a_board_with_nothing_to_say_says_nothing(checks):
    """R215. Silence is an answer, and it is the one a board owes a turn that states no ask.

    The other half of the cadence: a request the parser cannot read ("hi") must produce an empty block rather than
    an empty list, because a block that says "no asks" is a block the provider bills for on every turn of an
    episode that has nothing to track.
    """
    saved = os.environ.get(subject.BOARD_ENV)
    os.environ[subject.BOARD_ENV] = "1"
    try:
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            empty = agent.board_for(state, "hi there", "user")
            # A tool result is not a user turn: τ² routes it through the same method, and a board that read the
            # catalogue as a request would list products the user never mentioned.
            tool = agent.board_for(LLMAgentState(), "", "tool")
        finally:
            subject.recall = original
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(empty, "", "a request with no ask renders no block")
    checks.equal(tool, "", "and a tool turn carries no request to read")
    checks.equal(subject.is_pack_message(type("M", (), {"content": None})()), False,
                 "a message with no content is not one of this module's blocks")


@case
def the_block_sits_behind_the_conversation_and_moves_only_on_change(checks):
    """R216. The placement, which is the half of R215's bill that emitting less often could not reach.

    A block in the system message sits in front of every token the episode will send, so a change re-buys the whole
    prompt; R215 measured 247 changes × 4,756 tokens against a control that buys 860 k tokens in total. Behind the
    conversation, a change re-bills only what came after the old position, and a turn whose block is unchanged
    re-bills nothing at all because the block is left where it was written.

    Four properties, each of which a plausible implementation gets wrong: the block goes into the conversation and
    not the system block; there is exactly one of it; an unchanged turn writes nothing; and a turn with nothing to
    say takes the old block away rather than leaving the previous turn's state in front of the model.
    """
    saved = os.environ.get(subject.BOARD_ENV)
    os.environ[subject.BOARD_ENV] = "tail"
    before = subject.memory_stats().get("board") or {}
    try:
        agent, calls, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want to exchange the mechanical keyboard.")
            opened = [m for m in state.messages if subject.is_pack_message(m)]
            # Captured where it is true: the block is written behind the turn it answers, so it is the message after
            # the request and nothing that came before it.
            tail_after_first = state.messages.index(opened[0])
            # A clarification is a new user turn and not a new ask, so the block that answers it is byte-identical
            # — and the point of the placement is that such a turn writes nothing.
            state = episode_step(agent, state, "yes, the clicky ones")
            held = [m for m in state.messages if subject.is_pack_message(m)]
            order = {"order_id": "#W2378156", "items": [{"item_id": "1151293680", "name": "Mechanical Keyboard"}]}
            state.messages.append({"role": "assistant", "content": "", "tool_calls": [
                {"name": "get_order_details", "arguments": {"order_id": "#W2378156"}},
                {"name": "exchange_delivered_order_items", "arguments": {"item_ids": ["1151293680"]}},
            ]})
            state.messages.append({"role": "tool", "content": json.dumps(order)})
            state.messages.append({"role": "tool", "content": json.dumps({"ok": True})})
            state = episode_step(agent, state, "thanks")
            ticked = [m for m in state.messages if subject.is_pack_message(m)]
            after = subject.memory_stats().get("board") or {}
        finally:
            subject.recall = original
        with_nothing_to_say = [("user", "cancel the order"), opened[0]]
        cleared = subject.MicrogliaAgent().serve_tail(LLMAgentState(messages=with_nothing_to_say), "")
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(len(calls), 0, "the board arm does not consult the store")
    checks.equal(len(opened), 1, "the first turn writes one block")
    checks.equal(len(state.system_messages), 0, "and it is not in the system block")
    checks.substring(opened[0].content, subject.BOARD_TAG, "it is tagged as the board")
    checks.substring(opened[0].content, "[ ] exchange: mechanical keyboard", "and it lists the ask open")
    checks.equal(len(held), 1, "an unchanged turn writes no second block")
    checks.equal(held[0].content, opened[0].content, "and leaves the first one in place")
    # The block sits at the tail of the conversation. That is the whole claim of the placement, so it is asserted on
    # the position, and the unchanged turn is asserted on the *message count*: a re-write would have made it four.
    checks.equal(tail_after_first, 1, "the block is written behind the request, at the tail of the conversation")
    # Identity, not equality: an unchanged turn returns the state it was given, so the block the model reads is the
    # same object as last turn's. A re-write would be byte-identical and would still be the defect this case is for.
    checks.equal(held[0] is opened[0], True, "an unchanged turn does not re-create the block")
    checks.equal(len(ticked), 1, "a change replaces the block rather than adding one")
    checks.substring(ticked[0].content, "[x] exchange: mechanical keyboard", "and it carries the tick")
    checks.equal(after["tailAppends"] - before["tailAppends"], 2, "two writes in three turns")
    checks.equal(after["tailHeld"] - before["tailHeld"], 1, "one turn that cost nothing")
    checks.equal(after["placement"], "tail", "and the artefact names the placement")
    checks.equal(any(subject.is_pack_message(m) for m in cleared.messages), False,
                 "a turn with nothing to say takes the old block away")


@case
def the_block_never_splits_a_call_from_its_results(checks):
    """R216's first dispatch lost a whole arm to this, so it is asserted before the second one.

    The provider's rule is exact: an assistant message carrying `tool_calls` must be followed immediately by one tool
    message per call. `serve_tail` appended the block at the end of the conversation on every turn, and on the turn a
    call is made that put a system message between the call and the results about to arrive — every episode failed
    with `An assistant message with 'tool_calls' must be followed by tool messages`, 94 of 114 of them leaving no
    messages at all (PROGRESS 246.6).

    Four shapes, one per branch of `tail_index`, plus the invariant the provider actually enforces checked over the
    result rather than over the index: a fixture that asserted only where the block *goes* would pass on a
    conversation that is still illegal for another reason.
    """
    call = {"role": "assistant", "content": "", "tool_calls": [{"name": "get_order_details",
                                                               "arguments": {"order_id": "#W1"}}]}
    two_calls = {"role": "assistant", "content": "", "tool_calls": [
        {"name": "get_order_details", "arguments": {"order_id": "#W1"}},
        {"name": "get_user_details", "arguments": {"user_id": "u1"}},
    ]}
    body = "<microglia-board>\n[ ] return: lamp\n</microglia-board>"

    def placed(messages):
        agent = subject.MicrogliaAgent()
        state = agent.serve_tail(LLMAgentState(messages=list(messages)), body)
        return [("board" if subject.is_pack_message(m) else (m.get("role") if isinstance(m, dict) else m[0]))
                for m in state.messages]

    checks.equal(subject.tail_index([("user", "hi"), ("assistant", "hello")]), 2,
                 "a conversation with no calls takes the block at its end")
    checks.equal(subject.tail_index([("user", "hi"), call]), 1,
                 "an unanswered call moves the block in front of it")
    checks.equal(subject.tail_index([("user", "hi"), two_calls, {"role": "tool", "content": "ok"}]), 1,
                 "a half-answered pair of calls moves it in front too")
    checks.equal(subject.tail_index([("user", "hi"), two_calls, {"role": "tool", "content": "ok"},
                                     {"role": "tool", "content": "ok"}]), 4,
                 "a fully answered pair takes it at the end")
    checks.equal(placed([("user", "hi"), call]), ["user", "board", "assistant"],
                 "and the block lands in front of the call, not between it and its results")
    checks.equal(placed([("user", "hi")]), ["user", "board"], "a plain turn appends")

    class Carrying:
        """The driver's shape: an object with the field, not a dict."""

        role = "assistant"
        content = ""

        def __init__(self) -> None:
            self.tool_calls = [{"name": "get_order_details", "arguments": {}}]

    checks.equal(subject.tail_index([("user", "hi"), Carrying()]), 1,
                 "the accessor reads an object as well as a dict")

    # The provider's invariant, over the result: between an assistant message with calls and the next non-tool
    # message there must be exactly one tool message per call, and nothing else.
    transcript = [("user", "return the lamp"), call, {"role": "tool", "content": "ok"},
                  ("assistant", "done")]
    order = placed(transcript)
    between = order[order.index("assistant") + 1:order.index("assistant") + 3]
    checks.equal(between, ["tool", "assistant"], "a system block never sits inside the answered run")


@case
def the_placement_is_read_from_the_environment(checks):
    """R216. One variable, three arms, and no arm that is two at once.

    `front` is R214/R215's reading and is kept reachable because a dispatch has to be able to re-run the arm a
    previous reading came from; `tail` is R216's; absent is off. The mapping is asserted rather than assumed because
    a typo here would run the wrong arm and report it as the right one — the defect this lane has counted more often
    than any other.
    """
    saved = os.environ.pop(subject.BOARD_ENV, None)
    try:
        readings = {}
        for value in ("", "0", "off", "1", "true", "yes", "front", "tail", "TAIL"):
            if value:
                os.environ[subject.BOARD_ENV] = value
            else:
                os.environ.pop(subject.BOARD_ENV, None)
            readings[value] = (subject.board_mode(), subject.board_placement())
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(readings[""], (False, "off"), "an unset variable is no arm")
    checks.equal(readings["0"], (False, "off"), "and so is an explicit zero")
    checks.equal(readings["1"], (True, "front"), "one is the front placement R215 measured")
    checks.equal(readings["tail"], (True, "tail"), "and tail is behind the conversation")
    checks.equal(readings["TAIL"], (True, "tail"), "read case-insensitively, like every other switch here")
    checks.equal(readings["front"], (True, "front"), "front stays reachable by name")


@case
def the_admission_is_read_from_the_same_variable(checks):
    """R219. One variable, one placement, one rule — and no value that means two things at once.

    The admission rule rides the placement's own variable because two switches for one arm is how an arm becomes a
    third treatment nobody registered: `policy` is the tail placement with the rule on, `tail` is the same placement
    with it off, and every other value an arm has ever used must read as `all` rather than as the new rule.
    """
    saved = os.environ.pop(subject.BOARD_ENV, None)
    try:
        readings = {}
        for value in ("", "tail", "front", "policy", "POLICY"):
            if value:
                os.environ[subject.BOARD_ENV] = value
            else:
                os.environ.pop(subject.BOARD_ENV, None)
            readings[value] = (subject.board_mode(), subject.board_placement(), subject.board_admission())
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.equal(readings[""], (False, "off", "all"), "an unset variable admits everything and serves nothing")
    checks.equal(readings["tail"], (True, "tail", "all"), "the shipped arm is the block as R218b measured it")
    checks.equal(readings["front"], (True, "front", "all"), "and the front placement is not a rule")
    checks.equal(readings["policy"], (True, "tail", "state"), "the policy is the tail under the rule, not a placement")
    checks.equal(readings["POLICY"], (True, "tail", "state"), "read case-insensitively, like every other switch here")


@case
def the_admission_rule_refuses_to_accuse(checks):
    """R219. The one thing the block said that it could not know, asserted at the entry point the arm uses.

    The fixture is an episode whose request asks for a return and whose agent cancels an order instead: a call of a
    family nobody asked for. The shipped block reports it — `Not asked for by the request` — and the rule refuses to,
    because `false_accusations` reads 92.0% of those lines as naming a family the task requires a write in. What the
    rule may not do is lose the ask, so the same case asserts the ask is still stated.
    """
    state = LLMAgentState()
    state.messages.append({"role": "user", "content": "I want to return the lamp."})
    state.messages.append({"role": "assistant", "tool_calls": [
        {"name": "cancel_pending_order", "arguments": {"order_id": "#W1"}}]})
    state.messages.append({"role": "tool", "content": "ok"})
    saved = os.environ.get(subject.BOARD_ENV)
    try:
        os.environ[subject.BOARD_ENV] = "tail"
        whole = subject.MicrogliaAgent().board_for(state, "")
        os.environ[subject.BOARD_ENV] = "policy"
        admitted = subject.MicrogliaAgent().board_for(state, "")
    finally:
        if saved is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved
    checks.substring(whole, "Not asked for by the request", "the shipped block reports the invented call")
    checks.equal("Not asked for by the request" not in admitted, True,
                 "the admission rule refuses to report it")
    checks.substring(admitted, "[ ] return", "and still states the ask")
    checks.equal(len(admitted) < len(whole), True, "the block it serves is shorter, which is the whole price")


@case
def a_placement_with_nothing_to_say_writes_nothing(checks):
    """R216. The two silent branches of the placement, and the guard that keeps the instrument off the critical path.

    A turn with no board and no board behind it must return the state it was given, untouched: the alternative is a
    copy per turn, which is a copy of the whole conversation per turn in a twenty-five-turn episode. And a block that
    is written when no episode has been opened must not take the run down — the boundary list is the instrument's,
    and an agent driven without a recall has none, which is what a unit fixture and a resumed run both look like.
    """
    saved_env = os.environ.get(subject.BOARD_ENV)
    saved_boundaries = list(subject._episode_injected)  # noqa: SLF001 - the guard is the thing under test
    try:
        os.environ[subject.BOARD_ENV] = "tail"
        quiet = subject.MicrogliaAgent()
        given = LLMAgentState()
        same = quiet.serve_tail(given, "")
        # No episode has been opened by this agent, so the boundary list is emptied to the state a resumed run
        # starts in. Both placements are driven through the real entry point, because the guard is in two places.
        subject._episode_injected.clear()  # noqa: SLF001
        tail_written = quiet.serve_tail(LLMAgentState(), "<microglia-board>\n[ ] return: lamp\n</microglia-board>")
        os.environ[subject.BOARD_ENV] = "front"
        front_agent = subject.MicrogliaAgent()
        front_state = episode_step(front_agent, LLMAgentState(), "return the lamp")
        front_written = len(front_state.system_messages)
        # A resumed run: an episode already under way, so `pack_for` opens no boundary — which is the one state in
        # which the guard's false branch is reachable, and the one a process restarted mid-episode is in.
        resumed = subject.MicrogliaAgent()
        resumed._turn = 0  # noqa: SLF001 - the state a resumed run is in
        subject._episode_injected.clear()  # noqa: SLF001
        resumed_state = episode_step(resumed, LLMAgentState(), "return the lamp")
        resumed_written = len(resumed_state.system_messages)
    finally:
        subject._episode_injected[:] = saved_boundaries  # noqa: SLF001
        if saved_env is None:
            os.environ.pop(subject.BOARD_ENV, None)
        else:
            os.environ[subject.BOARD_ENV] = saved_env
    checks.equal(same.messages, [], "a turn with nothing to say writes nothing")
    checks.equal(same is given, True, "and does not even copy the state")
    checks.equal(len(tail_written.messages), 1, "a block is written when there is one")
    checks.equal(front_written, 1, "and the front placement writes its own without a boundary to raise")
    checks.equal(resumed_written, 1, "a resumed run writes one too, with no boundary to record it against")


@case
def an_arm_with_no_sidecar_reads_no_file(checks):
    """R215. The three early returns that make "no sidecar" a state rather than a fault.

    A process that was never pointed at a file must not stat one, must not report a problem, and must not count a
    lookup: the null this arm reports is then about the arm, and a phase that meant to serve notes and did not is
    told apart from a phase that never meant to. The fourth assertion is the cache's identity — the same stamp
    answers with the same document, which is what keeps a round from re-reading a file it already holds.
    """
    saved = os.environ.pop(subject.NOTES_ENV, None)
    try:
        document = subject._notes_document()  # noqa: SLF001 - the branch is unreachable through the public path
        note = subject.note_for("anything")
        lookups = subject.memory_stats()["notes"] if subject.notes_path() else None
    finally:
        if saved is not None:
            os.environ[subject.NOTES_ENV] = saved
    checks.equal(document, {}, "no path is no document")
    checks.equal(note, "", "and no note")
    checks.equal(lookups, None, "and no notes block to report a lookup over")
    with notes_arm({"I want a refund": "A note."}):
        first = subject._notes_document()  # noqa: SLF001
        second = subject._notes_document()  # noqa: SLF001
    checks.equal(second, first, "a file that has not changed is not read twice")


@case
def a_pack_from_the_facade_wins_over_a_note(checks):
    """One material per arm. An arm carrying both would be a third treatment nobody registered."""
    with notes_arm({"I want a refund": "A note."}):
        agent, _, original = fresh(pack="BLOCK-FROM-THE-STORE")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "I want a refund")
        finally:
            subject.recall = original
    content = state.system_messages[0].content
    checks.substring(content, "BLOCK-FROM-THE-STORE", "the store's block is served")
    checks.equal(content.count("A note."), 0, "and the note is not stacked beside it")


@case
def the_notes_block_is_absent_without_a_sidecar(checks):
    """A phase that never named a notes file must not publish a coverage of zero for a material it never read."""
    saved = os.environ.pop(subject.NOTES_ENV, None)
    try:
        agent, _, original = fresh(pack="")
        try:
            state = LLMAgentState()
            state = episode_step(agent, state, "anything")
        finally:
            subject.recall = original
        stats = subject.memory_stats()
    finally:
        if saved is not None:
            os.environ[subject.NOTES_ENV] = saved
    checks.equal("notes" in stats, False, "no notes block")
    checks.equal(len(state.system_messages), 0, "and nothing served")


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
