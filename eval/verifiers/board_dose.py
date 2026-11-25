#!/usr/bin/env python3
"""R218d — the dose, inside the task: does more memory material help the attempt that received it?

Every round this lane has run compares two **arms**, and every one of its flat readings has had the same shape: the
board is served, the bill goes up, the reward does not move. That shape has three possible causes and an arm-level
comparison cannot separate them:

  * the material is inert — what it says does not change what the model does;
  * the material is *harmful*, and the mean hides a large effect on a few tasks;
  * the material is useful on the tasks that receive it and useless on the tasks that do not, so the average of a
    real effect over a population where it rarely applies is zero.

The third is testable from documents this lane **already has**, and for free. R218b ran four attempts at each of 114
tasks in one arm. The board is recomputed from each episode's own conversation, so the four attempts at a task did
not receive the same amount of material — the episode that took nine turns saw nine blocks, the one that ended in
three saw three. **Within a task** the difficulty, the domain, the opening and the seeded world are held fixed by
construction, so comparing the attempts of one task by how much material they received is a comparison the
between-arm design cannot make.

## What the first reading found, before a single pair was formed

Run against R218b's own documents — 456 episodes an arm, four attempts at each of 114 tasks — this reader answers
`NO_DOSE` for **both** arms, including the treated one whose log counts 4,341 renders and 146.3 characters a render.
The reason is not the reader: **a front-placement arm's material is not in its own transcript.** The block goes into
`state.system_messages`, which is composed into the request, and τ² saves the conversation; `grep -c microglia-board`
over 32 MB of `front.json` is **0**.

Two repairs were tried against that, and both are reported rather than hidden because the second is the one that
would have produced a plausible number:

  * read the tag — exact, and it works on a **tail** arm, where the design appends the block into `state.messages`
    and the transcript therefore carries it. That is the placement this product ships, so the instrument has an
    arm to read: the first one is R219's.
  * **reconstruct** the block from each turn's messages (`render(board_of(messages[:i]))`) — the τ² document has no
    tag to read, so this was the tempting path. It disagrees with the arm's own counter: 7,813 turn boundaries
    against 4,341 renders, and 121.0 characters a boundary against 146.3 a render. The disagreement is structural —
    a tool loop re-renders inside one user turn — and the ordering the reconstruction produces is dominated by the
    **turn count**, which is the same variable that makes a retail episode fail. A within-task sign test on it would
    have found "more material, fewer passes" and it would have been a finding about episode length wearing the
    memory's name. It is not implemented.

So the round this instrument needed is a **recording** one, not an analysis one: the dose has to be written down at
the source, per episode, where it is known. That is registered as R218e, and until it lands this reader's honest
answer on every arm whose transcript carries no block is `NO_DOSE`.

## What this is not

It is **not** a randomised contrast, and the difference matters. Dose is endogenous: a longer conversation both
receives more blocks and has more chances to go wrong, so a *between*-task dose regression would report the
difficulty of hard tasks and call it the effect of memory. The within-task pairing removes the task, and it does not
remove the turn count — the attempt that ran longer is also the attempt that struggled. So the reading is reported
with its confound named, and the quantity that decides whether it is worth a registered round is the **sign** of the
effect on the pairs whose dose differs while their turn counts are close.

## The instrument's own falsification

A `control` arm carries no board at all, so every one of its episodes has a dose of exactly zero. Run this reader on
one and it must answer `NO_DOSE`: no variation, nothing to compare. An instrument that reports a dose effect where
the dose is identically zero is an instrument that reads the clock. The self-test builds that case, and the round
that reads R218b's documents runs it on the control first.

## Usage

  python3 eval/verifiers/board_dose.py --document eval/results/working-memory/front.json --json
  python3 eval/verifiers/board_dose.py --self-test
"""

from __future__ import annotations

import argparse
import io
import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# `eval/verifiers` sits one directory beside `eval/tools`, and the parser, the tag and the message walker all live
# there. Imported rather than copied: a second definition of what a board message looks like is a second answer to
# the question this reader asks.
TOOLS = HERE.parent / "tools"


def _tools_on_path() -> None:
    """Put `eval/tools` on the path once. A function rather than a bare `if`, because the branch that skips the
    insert is a branch, and a module imported twice under two names is the case that takes it."""
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))


_tools_on_path()

from goal_board import BOARD_TAG, messages_of, role_of  # noqa: E402  — the tag and the walker, not copies of them


def _text(message) -> str:
    """One message's text, in whichever of the shapes a document carries it."""
    content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, (list, tuple)):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(parts)
    return ""


def dose_of(simulation) -> int:
    """How many characters of board this episode was served.

    Counted from the episode's own messages rather than from a counter, because a counter is per process and the
    document is per episode: the whole point of this reader is to compare episodes *inside* one run, so its unit has
    to be one episode. The tag is `goal_board`'s, not a literal here — a second copy of `<microglia-board>` is a
    second definition of what the board is, and the agent already writes the first.
    """
    total = 0
    for message in messages_of(simulation):
        if role_of(message) != "system":
            continue
        text = _text(message)
        if BOARD_TAG in text:
            total += len(text)
    return total


def reward_of(simulation) -> "float | None":
    """The evaluator's verdict, or `None` when the episode was never scored.

    `None` rather than 0.0: an episode that died before the evaluator reached it is not a failure of the material,
    and counting it as one is the absence-as-zero defect that has cost this lane two rounds.
    """
    if not isinstance(simulation, dict):
        return None
    info = simulation.get("reward_info")
    if isinstance(info, dict):
        value = info.get("reward")
    else:
        value = getattr(info, "reward", None)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def by_task(document) -> dict:
    """Every episode, keyed by task, as `(dose, reward, turns)`."""
    simulations = document.get("simulations") if isinstance(document, dict) else document
    grouped: "dict[str, list]" = {}
    for simulation in simulations or []:
        if not isinstance(simulation, dict):
            continue
        reward = reward_of(simulation)
        if reward is None:
            continue
        task = str(simulation.get("task_id"))
        grouped.setdefault(task, []).append((dose_of(simulation), reward, len(messages_of(simulation))))
    return grouped


def _sign_test(positive: int, negative: int) -> "float | None":
    """The two-sided exact sign test, which is McNemar without the pairing's name.

    `goal_board.mcnemar_exact` is the same arithmetic on the same quantity; it is not imported because its
    parameters are named `moved` and `broke` and this reader's are "the higher dose" and "the lower" — a shared
    function would make a reader think the two tests differ in something other than their story.
    """
    total = positive + negative
    if total == 0:
        return None
    tail = sum(math.comb(total, index) for index in range(0, min(positive, negative) + 1)) / (2**total)
    return min(1.0, 2 * tail)


def within_task(grouped: dict) -> dict:
    """The pairs a task's own attempts make, split by dose, with the turn count reported beside them.

    The split is at the task's **median dose**, and an attempt exactly on the median joins neither side: with four
    attempts the median is the average of the middle two, so a tie is common and assigning it to a side would decide
    the reading by a rounding rule. `pairs` counts the tasks that produced at least one attempt on each side.
    """
    pairs = high_pass = low_pass = 0
    turn_gap = []
    dose_gap = []
    for task in sorted(grouped):
        attempts = grouped[task]
        if len(attempts) < 2:
            continue
        median = statistics.median([dose for dose, _, _ in attempts])
        higher = [entry for entry in attempts if entry[0] > median]
        lower = [entry for entry in attempts if entry[0] < median]
        if not higher or not lower:
            continue
        pairs += 1
        high_pass += sum(1 for _, reward, _ in higher if reward >= 1.0)
        low_pass += sum(1 for _, reward, _ in lower if reward >= 1.0)
        dose_gap.append(statistics.mean([dose for dose, _, _ in higher]) - statistics.mean(
            [dose for dose, _, _ in lower]))
        turn_gap.append(statistics.mean([turns for _, _, turns in higher]) - statistics.mean(
            [turns for _, _, turns in lower]))
    return {
        "tasks": len(grouped),
        "pairs": pairs,
        "higherDosePassed": high_pass,
        "lowerDosePassed": low_pass,
        "higherDoseRate": (high_pass / (high_pass + low_pass)) if (high_pass + low_pass) else None,
        "doseGapMedianChars": round(statistics.median(dose_gap), 1) if dose_gap else None,
        # The confound, quantified rather than named: if the higher-dose attempts also ran longer by the same order
        # of magnitude, the pair is "the longer attempt" as much as it is "the more material".
        "turnGapMedian": round(statistics.median(turn_gap), 1) if turn_gap else None,
        "p": _sign_test(high_pass, low_pass),
    }


def read(document) -> dict:
    """The whole reading: how much material the arm served, and what the pairs say about it."""
    grouped = by_task(document)
    doses = [dose for attempts in grouped.values() for dose, _, _ in attempts]
    rewards = [reward for attempts in grouped.values() for _, reward, _ in attempts]
    served = [dose for dose in doses if dose > 0]
    pairs = within_task(grouped)
    state = "NO_DOSE" if not served else ("NO_PAIRS" if not pairs["pairs"] else "DOSE_READ")
    return {
        "state": state,
        "episodes": len(doses),
        "tasks": len(grouped),
        "passRate": (sum(1 for reward in rewards if reward >= 1.0) / len(rewards)) if rewards else None,
        "episodesWithDose": len(served),
        "doseCharsMean": round(statistics.mean(served), 1) if served else 0.0,
        "doseCharsMedian": statistics.median(served) if served else 0.0,
        "doseCharsMax": max(served) if served else 0,
        # Characters over tokens at the four a token this lane measured in R135 is close enough to price the
        # material, and the number is quoted as characters because that is what the block is counted in.
        "doseCharsTotal": sum(served),
        **pairs,
    }


def render(reading: dict) -> str:
    """One sentence, and the state that decides whether it is a sentence about the material at all."""
    if reading["state"] == "NO_DOSE":
        return (
            f"NO_DOSE: {reading['episodes']} episode(s) over {reading['tasks']} task(s), and not one carried a "
            "block — this arm served no material, so there is no dose to read"
        )
    if reading["state"] == "NO_PAIRS":
        return (
            f"NO_PAIRS: {reading['episodesWithDose']} of {reading['episodes']} episode(s) carried a block, at "
            f"{reading['doseCharsMean']:.0f} characters an episode, but no task split into a higher and a lower "
            "dose — every attempt at a task received the same amount, so the task cannot be held fixed"
        )
    rate = reading["higherDoseRate"]
    return (
        f"DOSE_READ: {reading['episodesWithDose']} of {reading['episodes']} episode(s) carried a block, "
        f"{reading['doseCharsMean']:.0f} characters an episode; of the {reading['pairs']} task(s) whose attempts "
        f"received different amounts, the higher-dose side passed {rate:.1%} of {reading['higherDosePassed'] + reading['lowerDosePassed']} "
        f"attempt-pairs ({reading['higherDosePassed']} against {reading['lowerDosePassed']}), sign test p = "
        f"{reading['p'] if reading['p'] is None else format(reading['p'], '.4f')}, the higher-dose side running "
        f"{reading['turnGapMedian']:+} turns longer on the median task and receiving "
        f"{reading['doseGapMedianChars']:.0f} more characters — and because dose and turn count move together, "
        "this is a decomposition of the arm's episodes and not a randomised contrast"
    )


def self_test() -> int:
    """The reader on documents whose answer is known, including the one where the answer is "no dose"."""
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + str(detail) if detail else ''}")

    def episode(task, reward, blocks, turns=None, tag=BOARD_TAG):
        messages = [{"role": "user", "content": "where is my order"}]
        for index in range(blocks):
            messages.append({"role": "system", "content": f"<{tag}>\n[ ] return: item {index}\n</{tag}>"})
        for index in range((turns or 0) - len(messages)):
            messages.append({"role": "assistant", "content": "x"})
        return {"task_id": task, "messages": messages, "reward_info": {"reward": reward}}

    # --- the dose is counted from the episode, not from a counter -------------------------------------
    check("one block, one body", dose_of(episode("t", 1.0, 1)) == len(f"<{BOARD_TAG}>\n[ ] return: item 0\n</{BOARD_TAG}>"))
    check("two blocks are two", dose_of(episode("t", 1.0, 2)) == 2 * len(f"<{BOARD_TAG}>\n[ ] return: item 0\n</{BOARD_TAG}>"))
    check("no block is zero", dose_of(episode("t", 1.0, 0)) == 0)
    check("a block from another tag is not this board", dose_of(episode("t", 1.0, 1, tag="microglia-knowledge")) == 0)
    check(
        "a block outside a system message is not served material",
        dose_of({"messages": [{"role": "user", "content": f"<{BOARD_TAG}>x</{BOARD_TAG}>"}]}) == 0,
    )
    check("parts-shaped content is read", dose_of({"messages": [{"role": "system", "content": [
        {"type": "text", "text": f"<{BOARD_TAG}>abc"}, "raw"]}]}) > 0)
    check("content that is neither is zero", dose_of({"messages": [{"role": "system", "content": 7}]}) == 0)

    # --- the reward, and the absence of one ------------------------------------------------------------
    check("a reward is read", reward_of({"reward_info": {"reward": 0.0}}) == 0.0)
    check("no reward info is no reward", reward_of({"messages": []}) is None)
    check("a reward object is read", reward_of({"reward_info": type("I", (), {"reward": 1.0})()}) == 1.0)
    check("a string reward is not a reward", reward_of({"reward_info": {"reward": "1"}}) is None)
    check("a bool reward is not a reward", reward_of({"reward_info": {"reward": True}}) is None)

    # --- the pairs --------------------------------------------------------------------------------------
    grouped = by_task({"simulations": [
        episode("a", 1.0, 1), episode("a", 0.0, 5),
        episode("b", 0.0, 1), episode("b", 1.0, 5),
    ]})
    pairs = within_task(grouped)
    check("two tasks, two pairs", pairs["pairs"] == 2)
    check("one each way", pairs["higherDosePassed"] == 1 and pairs["lowerDosePassed"] == 1)
    check("a one-one split is p = 1", pairs["p"] == 1.0)
    check("the turn gap is reported", pairs["turnGapMedian"] > 0, pairs["turnGapMedian"])
    check("the dose gap is reported", pairs["doseGapMedianChars"] > 0)
    flat = within_task(by_task({"simulations": [episode("a", 1.0, 2), episode("a", 0.0, 2)]}))
    check("a task whose attempts all got the same dose makes no pair", flat["pairs"] == 0)
    check("a task with one attempt makes no pair", within_task(by_task({"simulations": [episode("a", 1.0, 1)]}))["pairs"] == 0)
    check("a task's attempts at the median join neither side", within_task(by_task({"simulations": [
        episode("a", 1.0, 1), episode("a", 1.0, 2), episode("a", 0.0, 3), episode("a", 0.0, 4),
    ]}))["pairs"] == 1)

    # --- the three states ------------------------------------------------------------------------------
    no_dose = read({"simulations": [episode("a", 1.0, 0), episode("b", 0.0, 0)]})
    check("an arm with no board is no dose", no_dose["state"] == "NO_DOSE", no_dose["state"])
    check("its mean is zero rather than absent", no_dose["doseCharsMean"] == 0.0)
    check("and it says so", render(no_dose).startswith("NO_DOSE:"))
    served = read({"simulations": [episode("a", 1.0, 2), episode("a", 0.0, 2)]})
    check("a uniform dose has no pairs", served["state"] == "NO_PAIRS", served["state"])
    check("and it says so", "cannot be held fixed" in render(served))
    measured = read({"simulations": [episode("a", 1.0, 1), episode("a", 0.0, 6), episode("b", 0.0, 1),
                                     episode("b", 1.0, 6)]})
    check("a split dose is read", measured["state"] == "DOSE_READ", measured["state"])
    check("the sentence carries the confound", "not a randomised contrast" in render(measured))
    check("an empty document is no dose", read({"simulations": []})["state"] == "NO_DOSE")
    check("no episodes is no rate", read({"simulations": []})["passRate"] is None)
    check("a simulation without a reward leaves the count", read({"simulations": [
        {"task_id": "a", "messages": []}]})["episodes"] == 0)
    check("a document that is a bare list works", read([episode("a", 1.0, 1)])["episodes"] == 1)
    check("a junk simulation is skipped", by_task({"simulations": ["junk"]}) == {})

    # --- the command line --------------------------------------------------------------------------------
    # The paths the fixture helpers leave untaken, and the reader's own refusal, exercised directly.
    _tools_on_path()
    check("the path is put on twice without duplicating it", sys.path.count(str(TOOLS)) == 1, sys.path.count(str(TOOLS)))
    check("a part that is neither text nor a typed block is skipped", dose_of({"messages": [
        {"role": "system", "content": [7, {"text": f"<{BOARD_TAG}>x"}]}]}) > 0)
    check("an episode that pads to more turns is longer", len(episode("a", 1.0, 1, turns=6)["messages"]) == 6)
    check("a simulation that is not a dict has no reward", reward_of("junk") is None)

    import tempfile

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        path = root / "arm.json"
        path.write_text(json.dumps({"simulations": [episode("a", 1.0, 1), episode("a", 0.0, 4)]}), encoding="utf-8")
        check("the reader answers zero on a document", main(["--document", str(path), "--json"]) == 0)
        refused = None
        try:
            main(["--document", str(root / "missing.json")])
        except SystemExit as error:
            refused = str(error)
        check(
            "a missing document is refused by name",
            refused == f"board-dose-no-document:{root / 'missing.json'}",
            refused,
        )

        # The suite's own failure paths and the report's two answers, diverted into a buffer: a check whose failing
        # branch has never run is a check that cannot fail visibly.
        planted_at = len(failures)
        check("a check that must fail", False, "deliberate")
        check("a check that must fail without a detail", False)
        planted = failures[planted_at:]
        del failures[planted_at:]
        cases -= 2
        check("the suite can say no", len(planted) == 2, planted)
        buffer = io.StringIO()
        check("the report answers one for a failure", _report(["planted"], 2, buffer) == 1 and "planted" in buffer.getvalue())
        buffer = io.StringIO()
        check("the report answers zero for none", _report([], 2, buffer) == 0 and "2 check(s) passed" in buffer.getvalue())

    return _report(failures, cases)


def _report(failures: "list[str]", cases: int, stream=None) -> int:
    """Print the failures and the count, and answer with the exit code the workflow reads.

    A function so the branch that reports a failure can be run without failing the build: `stream` lets the
    self-test send the report into a buffer rather than into the log of a green run.
    """
    out = stream or sys.stderr
    if failures:
        for failure in failures:
            print(f"[dose] FAIL {failure}", file=out)
        print(f"[dose] {len(failures)} of {cases} check(s) failed", file=out)
        return 1
    print(f"[dose] {cases} check(s) passed", file=out)
    return 0


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(description="the dose inside the task: does more material help the attempt that got it")
    parser.add_argument("--document", default="", help="one `results.json`")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)
    if arguments.self_test:
        return self_test()
    path = Path(arguments.document)
    if not path.is_file():
        raise SystemExit(f"board-dose-no-document:{path}")
    with open(path, encoding="utf-8") as stream:
        document = json.load(stream)
    reading = read(document)
    print(json.dumps(reading, indent=1) if arguments.json else render(reading))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
