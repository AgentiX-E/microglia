"""The parts of `agent.py` that decide something, tested without a model and without an environment.

`agent.py` has two halves. One drives ALFWorld and spends money, and its correctness is the floor
agreement between the two policies on the same games (`--assert-floor`, run in CI). The other decides
what the prompt says, what a reply means, which rules an observation admits, and what the tokens cost —
and every one of those decisions is a function that can be wrong in a way no run would reveal, because
a run would just score lower.

So the tests are the parser's four branches, the transcript split, the shard arithmetic, and the bill.
The bill matters most: the peak guard is worth 2×, and a bill that is wrong in the cheap direction is a
dispatch nobody cancels.
"""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import socket
import sys
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANKS = HERE / "banks"


def payload_of(name: str) -> dict:
    return json.loads((BANKS / name).read_text(encoding="utf-8"))
sys.path.insert(0, str(HERE))

import agent  # noqa: E402
import floor  # noqa: E402


class ExamplesTest(unittest.TestCase):
    def test_carries_six_task_types_with_two_transcripts_each(self):
        payload = agent.load_examples()
        self.assertEqual(len(payload["examples"]), 6)
        for kind, pair in payload["examples"].items():
            self.assertEqual(len(pair), 2, kind)
            self.assertTrue(all(transcript.startswith("You are in the middle of a room.") for transcript in pair))

    def test_records_where_it_came_from(self):
        # The registration quotes character counts as a cost input, so the file they are counted from has
        # to name its own revision. A prompt read at `main` is a prompt that changes under the quote.
        source = agent.load_examples()["_source"]
        self.assertEqual(source["repository"], "LeapLabTHU/ExpeL")
        self.assertEqual(source["path"], "prompts/alfworld.py")
        self.assertEqual(len(source["blob_sha"]), 40)
        self.assertIn("two examples", source["extraction"])

    def test_the_character_counts_the_registration_quotes(self):
        # These six numbers are in `REGISTRATION.md` and in the price. They were wrong once: four of the
        # six had been counted from the wrong pair of keys, and the mean prefix was quoted 11% low.
        # Pinned here so the table and the file cannot drift apart again.
        expected = {"put": 3199, "clean": 4328, "heat": 3837, "cool": 4403, "puttwo": 4286, "examine": 3738}
        examples = agent.load_examples()["examples"]
        measured = {kind: sum(len(transcript) for transcript in pair) for kind, pair in examples.items()}
        self.assertEqual(measured, expected)

    def test_a_file_missing_a_task_type_raises(self):
        path = HERE / "prompts" / "not-a-file.json"
        try:
            path.write_text(json.dumps({"examples": {"put": ["a", "b"]}}), encoding="utf-8")
            with self.assertRaises(agent.LaneError):
                agent.load_examples(path)
        finally:
            path.unlink(missing_ok=True)

    def test_a_task_type_with_one_transcript_raises(self):
        payload = json.loads((HERE / "prompts" / "alfworld-examples.json").read_text(encoding="utf-8"))
        payload["examples"]["put"] = ["only one"]
        path = HERE / "prompts" / "one-short.json"
        try:
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(agent.LaneError):
                agent.load_examples(path)
        finally:
            path.unlink(missing_ok=True)


class TaskKindTest(unittest.TestCase):
    def test_maps_every_prefix_the_split_publishes(self):
        cases = {
            "json_2.1.1/valid_unseen/pick_and_place_simple-Plate-None-CounterTop-1/trial_x/game.tw-pddl": "put",
            "json_2.1.1/valid_unseen/pick_clean_then_place_in_recep-Cup-None-Cabinet-10/trial_x/game.tw-pddl": "clean",
            "json_2.1.1/valid_unseen/pick_heat_then_place_in_recep-Mug-None-CoffeeMachine-1/trial_x/game.tw-pddl": "heat",
            "json_2.1.1/valid_unseen/pick_cool_then_place_in_recep-Lettuce-None-Fridge-1/trial_x/game.tw-pddl": "cool",
            "json_2.1.1/valid_unseen/look_at_obj_in_light-Bowl-None-DeskLamp-1/trial_x/game.tw-pddl": "examine",
            "json_2.1.1/valid_unseen/pick_two_obj_and_place-CreditCard-None-Dresser-1/trial_x/game.tw-pddl": "puttwo",
        }
        for path, kind in cases.items():
            self.assertEqual(agent.task_kind_of(path), kind, path)

    def test_reads_a_directory_when_it_is_handed_one(self):
        self.assertEqual(agent.task_kind_of("pick_two_obj_and_place-KeyChain-None-Sofa-2"), "puttwo")

    def test_an_unknown_task_type_raises_rather_than_defaulting(self):
        # A default would silently give one task type another type's examples, which changes the prompt
        # of an entire class of games and shows up only as a lower score.
        with self.assertRaises(agent.LaneError):
            agent.task_kind_of("look_at_something_else-Bowl-None-DeskLamp-1/trial_x/game.tw-pddl")


class TranscriptTest(unittest.TestCase):
    def test_splits_on_role_and_merges_runs_of_the_same_role(self):
        text = "You are in a room.\nYour task is to: look.\n> think: one\nOK.\n> go to desk 1\nOn the desk 1, you see a mug 1."
        turns = agent.split_transcript(text)
        self.assertEqual(
            turns,
            [
                ("user", "You are in a room.\nYour task is to: look."),
                ("assistant", "> think: one"),
                ("user", "OK."),
                ("assistant", "> go to desk 1"),
                ("user", "On the desk 1, you see a mug 1."),
            ],
        )

    def test_ignores_blank_lines(self):
        self.assertEqual(agent.split_transcript("a\n\n\n> b\n"), [("user", "a"), ("assistant", "> b")])

    def test_a_real_example_alternates(self):
        # The format is the point of a few-shot block: if two consecutive turns share a role, the model is
        # being shown a conversation shape the environment never produces.
        for kind, pair in agent.load_examples()["examples"].items():
            for transcript in pair:
                turns = agent.split_transcript(transcript)
                roles = [role for role, _ in turns]
                self.assertEqual(roles[0], "user", kind)
                for before, after in zip(roles, roles[1:]):
                    self.assertNotEqual(before, after, kind)


class PackTest(unittest.TestCase):
    def test_empty_is_empty_not_a_sentence_about_being_empty(self):
        self.assertEqual(agent.render_pack([]), "")

    def test_numbers_the_entries_and_closes_with_a_blank_line(self):
        self.assertEqual(
            agent.render_pack(["a rule", "another"]),
            agent.PACK_HEADER + "\n1. a rule\n2. another\n\n",
        )

    def test_a_transcript_entry_keeps_one_number_and_indents_its_own_lines(self):
        # A bank may hold one verbatim trajectory segment rather than advice, and the block has to read as one item
        # rather than as a numbered line followed by unnumbered prose — otherwise the numbering counts one thing and
        # the text says five.
        segment = "Nothing happens.\n> move toiletpaper 1 to toiletpaperhanger 1\nYou move the toiletpaper 1."
        self.assertEqual(
            agent.render_pack([segment]),
            agent.PACK_HEADER
            + "\n1. Nothing happens.\n   > move toiletpaper 1 to toiletpaperhanger 1\n   You move the toiletpaper 1.\n\n",
        )

    def test_a_single_line_entry_renders_exactly_as_it_always_has(self):
        # The multi-line branch must not change one byte of every arm bought before this round: their rendered
        # lengths are quoted in the register and their prices were computed from them.
        for text in ("a rule", "a rule with  double  spaces", "a rule with a trailing period."):
            with self.subTest(text=text):
                self.assertEqual(agent.render_pack([text]), agent.PACK_HEADER + f"\n1. {text}\n\n")

    def test_the_header_is_the_competitors_rule_template_verbatim(self):
        # `RULE_TEMPLATE['alfworld']` in `prompts/templates/human.py@LeapLabTHU/ExpeL`, at the blob this
        # lane's examples come from (`2b2093ef`). Pinned as a string rather than described, because the
        # arm is offered as the competitor's mechanism and a paraphrase would make the always-in arm
        # this repository's prompt wearing the paper's name. The competitor's grammar is kept too.
        self.assertEqual(
            agent.PACK_HEADER,
            "The following are some experience you gather on a similar task of completing a household task "
            "by interacting in a household environment. Use these as references to help you perform this task:",
        )

    def test_the_opening_carries_no_pack_and_starts_with_the_instruction(self):
        # The pack is prepended to the first observation instead (see the loop tests), which is where the
        # competitor puts it and is what keeps the control's prompt byte-identical to the one the 20-game
        # calibration measured.
        examples = agent.load_examples()
        opening = agent.build_opening(examples, "put", "Your task is to: x\n", 50)
        self.assertEqual(opening[0], {"role": "system", "content": agent.SYSTEM_INSTRUCTION})
        self.assertTrue(opening[1]["content"].startswith("Your task is to: x\n"))
        self.assertIn("You may take maximum of 50 steps.", opening[1]["content"])
        self.assertIn("Here are two examples:", opening[1]["content"])
        expected_turns = sum(len(agent.split_transcript(t)) for t in examples["examples"]["put"])
        self.assertEqual(len(opening) - 2, expected_turns)
        for message in opening:
            self.assertNotIn(agent.PACK_HEADER, message["content"])

    def test_the_opening_is_a_function_of_the_episode_and_nothing_else(self):
        # Two calls with the same arguments produce the same prompt, so the arms cannot differ in the
        # opening by accident and a recorded prefix means something.
        examples = agent.load_examples()
        first = agent.build_opening(examples, "put", "Your task is to: x\n", 50)
        second = agent.build_opening(examples, "put", "Your task is to: x\n", 50)
        self.assertEqual(first, second)


class ShamTest(unittest.TestCase):
    """The placebo arm: the bank's own words, in an order that means nothing.

    `arXiv:2601.22436` finds that agents respond to a condensed-memory block's **existence and shape** more than
    its semantic content — corrupt, irrelevant and filler summaries often leave the score where it was, while
    emptying a raw trajectory collapses it. If that holds here, the bank's delta is a formatting effect, and the
    only way to find out is an arm whose surface form is the bank and whose meaning is not.

    Word permutation inside each rule is the construction that matches the surface most tightly: every token,
    every punctuation mark and the entry count are preserved exactly, and only the order is destroyed. It is
    deterministic, so the prefix is stable across episodes and the cache behaves as it does for `always-in`.
    """

    def test_the_words_and_their_number_survive_the_permutation(self):
        text = "Always check the countertop before opening the cabinet to look for a mug."
        shuffled = agent.permute_words(text, 3)
        self.assertEqual(sorted(shuffled.split()), sorted(text.split()))
        self.assertEqual(len(shuffled.split()), len(text.split()))

    def test_the_same_seed_gives_the_same_sham(self):
        text = "Always check the countertop before opening the cabinet to look for a mug."
        self.assertEqual(agent.permute_words(text, 5), agent.permute_words(text, 5))

    def test_two_seeds_usually_disagree_which_is_all_a_permutation_can_promise(self):
        text = "Always check the countertop before opening the cabinet to look for a mug and a cloth."
        variants = {agent.permute_words(text, seed) for seed in range(6)}
        self.assertGreater(len(variants), 1)

    def test_a_one_word_rule_is_returned_unchanged(self):
        self.assertEqual(agent.permute_words("Search.", 1), "Search.")

    def test_the_seed_is_the_text_so_the_sham_is_a_function_of_the_bank(self):
        # Not a counter: a bank loaded twice must produce the same sham, and two runs that reordered the
        # bank file must still produce the same sham for the same rule.
        rules = ["Check the countertop first.", "The fridge holds cold things."]
        self.assertEqual(agent.sham_entries(rules), agent.sham_entries(list(rules)))
        self.assertEqual(agent.sham_entries(rules)[0][:1] != "", True)

    def test_the_sham_keeps_one_output_per_rule(self):
        rules = ["Check the countertop first.", "The fridge holds cold things.", "Search."]
        self.assertEqual(len(agent.sham_entries(rules)), 3)

    def test_the_sham_is_not_the_bank(self):
        # Length-preserving by construction, so character counts cannot tell the two arms apart; the text
        # can. A sham that rendered identically would be `always-in` wearing a second name.
        rules = ["Always check the countertop before opening the cabinet to look for a mug."]
        self.assertNotEqual(agent.render_pack(agent.sham_entries(rules)), agent.render_pack(rules))

    def test_the_sham_carries_the_same_header_and_the_same_entry_count(self):
        rules = ["Check the countertop first.", "The fridge holds cold things."]
        sham = agent.render_pack(agent.sham_entries(rules))
        self.assertTrue(sham.startswith(agent.PACK_HEADER))
        self.assertIn("\n1. ", sham)
        self.assertIn("\n2. ", sham)

    def test_the_sham_is_an_arm_so_a_slice_of_it_can_be_joined(self):
        self.assertIn("sham", agent.ARMS)


class ParseTest(unittest.TestCase):
    def test_a_caret_think_is_a_thought(self):
        self.assertEqual(agent.parse_reply("> think: I should open it."), ("thought", "I should open it."))

    def test_a_bare_think_is_a_thought(self):
        self.assertEqual(agent.parse_reply("think: I should open it."), ("thought", "I should open it."))

    def test_a_caret_action_is_lowercased(self):
        self.assertEqual(agent.parse_reply("> Go To Cabinet 1"), ("action", "go to cabinet 1"))

    def test_an_unprefixed_verb_is_an_action(self):
        self.assertEqual(agent.parse_reply("Take Apple 3 From Garbagecan 1"), ("action", "take apple 3 from garbagecan 1"))

    def test_free_text_is_a_thought_rather_than_being_discarded(self):
        # The competitor wraps an unrecognised reply as a thought and asks again. Discarding it would make
        # the arm's invalid-action count a property of the parser instead of the model.
        self.assertEqual(agent.parse_reply("I wonder what is in the fridge."), ("thought", "I wonder what is in the fridge."))

    def test_every_example_action_line_parses_as_an_action(self):
        # The examples are the format the model is told to follow, so each of their agent lines has to be
        # one the parser accepts — otherwise the prompt teaches a syntax the lane cannot read.
        for kind, pair in agent.load_examples()["examples"].items():
            for transcript in pair:
                for role, content in agent.split_transcript(transcript):
                    if role != "assistant" or content.lower().startswith("> think"):
                        continue
                    parsed_kind, parsed = agent.parse_reply(content)
                    self.assertEqual(parsed_kind, "action", f"{kind}: {content!r}")
                    self.assertTrue(parsed)

    def test_the_first_line_rule_drops_the_command_under_a_thought(self):
        # The competitor's rule, restated as a test so that a later "improvement" cannot quietly start
        # executing it: `react_put_0` writes a thought and a command in one turn, our parser reads the
        # thought, and `refused_command` is how the lane says so out loud instead of answering `OK.`.
        reply = "> think: Now I find a spraybottle (2). Next, I need to take it.\n> take spraybottle 2 from cabinet 2"
        self.assertEqual(agent.parse_reply(reply)[0], "thought")
        self.assertEqual(agent.refused_command(reply), "take spraybottle 2 from cabinet 2")

    def test_a_command_on_the_first_line_is_not_refused_because_it_was_executed(self):
        self.assertIsNone(agent.refused_command("> take spraybottle 2 from cabinet 2"))

    def test_a_pure_thought_refuses_nothing(self):
        self.assertIsNone(agent.refused_command("> think: I need an apple"))

    def test_prose_after_a_thought_refuses_nothing(self):
        self.assertIsNone(agent.refused_command("> think: I need an apple\nOK.\nIt is on the counter."))


class ParserChannelTest(unittest.TestCase):
    """A second harness, named, so that executing the dropped command can never read as a memory effect.

    R180 moved the format by 0.00 pp with a neutral 197-character tail; R182 moved the refusal count by 15% with a
    format entry at the same length. The remaining lever is not text: the command *is* in the reply, and the
    reference parser throws it away because `re.match` anchors at the first line (AUDIT 34.259). Executing it changes
    every arm's harness, so the lane carries it as a **channel** — a field in every episode, a token in every label,
    a join that refuses to pool two channels until it is told it is comparing them — rather than as an arm somebody
    could later mistake for a prompt.

    The two counters are the design. `refused_actions` counts a command the first-line rule dropped; `recovered_
    actions` counts one it would have dropped and the channel executed instead. One reply is one event, counted on
    whichever side of the parser it fell, so the two channels can be shown to have driven the same model behaviour.
    """

    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()
        self.original = agent.chat

    def tearDown(self):
        agent.chat = self.original

    def drive(self, replies, parser="reference", world=None, max_steps=50):
        seen = []
        script = list(replies)

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return script.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        episode = agent.run_episode(
            world or self.world, "none", "model", self.examples, [], agent.Draw(1), max_steps, 3,
            "deepseek-flash", "k", 1.0, parser=parser,
        )
        return episode, seen

    def test_the_reference_channel_records_itself_in_every_episode(self):
        episode, _seen = self.drive(
            ["> think: I need the apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        )
        self.assertEqual(episode["parser"], "reference")
        self.assertEqual(episode["recovered_actions"], 0)

    def test_the_any_line_channel_executes_the_command_the_first_line_refused(self):
        # The whole point: `> think: ...` then a command on the next line. The reference channel drops it and tells
        # the model nothing happened; this channel hands it to the environment, so the next turn's `put` has an
        # apple to put.
        episode, _seen = self.drive(
            ["> think: I need the apple\n> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            parser="any-line",
        )
        self.assertEqual(episode["parser"], "any-line")
        self.assertTrue(episode["won"])
        self.assertEqual(self.world.steps, 2)
        self.assertEqual(episode["recovered_actions"], 1)
        self.assertEqual(episode["refused_actions"], 0)

    def test_the_recovered_turn_is_answered_with_an_observation_rather_than_a_no_op(self):
        # A turn that moved the world must not be answered with `Nothing happens.`: the answer is the environment's,
        # which is what makes the next reply a reply to the world rather than to the driver.
        _episode, seen = self.drive(
            ["> think: I need the apple\n> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            parser="any-line",
        )
        self.assertNotEqual(seen[1][-1], agent.NO_OP)
        self.assertNotEqual(seen[1][-1], "OK.")

    def test_the_two_channels_count_the_same_reply_on_opposite_sides(self):
        # One format event, two channels: the reference drops it and the counter says so; the any-line channel
        # executes it and the other counter says so. If this pair ever stops summing to one, the channels are no
        # longer driving the same model behaviour and R183's cross-channel reading is not about the parser.
        dropped, _ = self.drive(
            ["> think: I need the apple\n> take apple 1 from countertop 1", "> take apple 1 from countertop 1",
             "> put apple 1 in/on cabinet 1"],
            parser="reference",
            world=FakeWorld(),
        )
        recovered, _ = self.drive(
            ["> think: I need the apple\n> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            parser="any-line",
            world=FakeWorld(),
        )
        self.assertEqual(dropped["refused_actions"] + dropped["recovered_actions"], 1)
        self.assertEqual(recovered["refused_actions"] + recovered["recovered_actions"], 1)
        self.assertTrue(dropped["won"])
        self.assertTrue(recovered["won"])

    def test_the_any_line_channel_leaves_a_pure_thought_alone(self):
        # The channel changes what happens to a command under a thought, not what happens to a thought. `OK.` is the
        # examples' answer to a thought that was only a thought, and an any-line channel that started inventing
        # world events for those would be a different defect, not a fix.
        episode, seen = self.drive(
            ["> think: I need the apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            parser="any-line",
        )
        self.assertEqual(seen[1][-1], "OK.")
        self.assertEqual(episode["recovered_actions"], 0)

    def test_a_command_on_the_first_line_is_never_recovered(self):
        episode, _seen = self.drive(
            ["> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"], parser="any-line"
        )
        self.assertEqual(episode["recovered_actions"], 0)
        self.assertEqual(episode["refused_actions"], 0)

    def test_the_recovered_commands_are_quoted_back_up_to_the_same_cap(self):
        # The count says how often, the sample says what, and both channels cap at three because a 274-game pass
        # must not become a transcript.
        episode, _seen = self.drive(
            ["> think: a\n> go to countertop 1", "> think: b\n> inventory", "> think: c\n> look",
             "> think: d\n> inventory"],
            parser="any-line",
            max_steps=4,
        )
        self.assertEqual(episode["recovered_actions"], 4)
        self.assertEqual(len(episode["recovered_samples"]), agent.REFUSED_SAMPLES)
        self.assertEqual(episode["recovered_samples"][0], "go to countertop 1")

    def test_an_unknown_channel_is_refused_rather_than_defaulted(self):
        # `any_line` is one character from `any-line`, and a dispatcher that accepted it would either drive the
        # default channel under a name nobody reads or drive a channel nobody wrote. The cost is a full 274-game
        # pass, so the spelling is checked before the first call rather than after the bill.
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            self.drive(["> think: a"], parser="any_line")
        self.assertIn("is not one of", printed.getvalue())

    def test_the_channel_is_one_constant_rather_than_a_literal_in_two_places(self):
        self.assertEqual(agent.PARSERS, ("reference", "any-line"))
        self.assertEqual(agent.REFERENCE_PARSER, "reference")


class AnchorTest(unittest.TestCase):
    def test_orders_by_overlap(self):
        entries = ["the fridge is cold", "fridge door opens outward", "nothing relevant"]
        self.assertEqual(agent.anchor("you see a fridge door", entries, 2)[0], "fridge door opens outward")

    def test_ties_keep_bank_order(self):
        entries = ["fridge one", "fridge two"]
        self.assertEqual(agent.anchor("fridge", entries, 2), ["fridge one", "fridge two"])

    def test_no_overlap_returns_nothing(self):
        self.assertEqual(agent.anchor("you see a mug", ["fridge door opens outward"], 3), [])

    def test_truncates_at_top_k(self):
        entries = [f"fridge item {index}" for index in range(10)]
        self.assertEqual(len(agent.anchor("fridge", entries, 3)), 3)

    def test_empty_inputs_are_empty(self):
        self.assertEqual(agent.anchor("", ["fridge"], 3), [])
        self.assertEqual(agent.anchor("fridge", [], 3), [])


class BillTest(unittest.TestCase):
    def setUp(self):
        self.card = agent.load_rate_card()
        self.monday_02 = datetime(2026, 11, 16, 2, 0, tzinfo=timezone.utc)  # peak
        self.monday_12 = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)  # off-peak
        self.saturday_02 = datetime(2026, 11, 21, 2, 0, tzinfo=timezone.utc)  # weekend

    def test_peak_is_the_two_windows_on_weekdays(self):
        self.assertTrue(agent.is_peak(self.card, self.monday_02))
        self.assertFalse(agent.is_peak(self.card, self.monday_12))
        self.assertFalse(agent.is_peak(self.card, self.saturday_02))

    def test_peak_costs_exactly_twice(self):
        peak = agent.bill_of(self.card, 1_000_000, 0, 0, self.monday_02)
        off = agent.bill_of(self.card, 1_000_000, 0, 0, self.monday_12)
        self.assertEqual(peak["usd"], 0.3)
        self.assertEqual(off["usd"], 0.15)
        self.assertEqual(peak["band"], "peak")
        self.assertEqual(off["band"], "off_peak")

    def test_each_band_quotes_the_other(self):
        bill = agent.bill_of(self.card, 1_000_000, 0, 0, self.monday_02)
        self.assertEqual(bill["usd_in_other_band"], 0.15)

    def test_a_cached_prefix_is_paid_at_the_hit_rate(self):
        cached = agent.bill_of(self.card, 1_000_000, 1_000_000, 0, self.monday_12)
        uncached = agent.bill_of(self.card, 1_000_000, 0, 0, self.monday_12)
        self.assertEqual(cached["usd"], 0.003)
        self.assertEqual(uncached["usd"], 0.15)
        self.assertLess(cached["usd"] * 40, uncached["usd"])

    def test_output_tokens_are_paid_at_the_output_rate(self):
        self.assertEqual(agent.bill_of(self.card, 0, 0, 1_000_000, self.monday_12)["usd"], 0.6)

    def test_a_cache_count_above_the_prompt_is_clamped_rather_than_billing_negatively(self):
        bill = agent.bill_of(self.card, 10, 999, 0, self.monday_12)
        self.assertGreaterEqual(bill["usd"], 0)

    def test_a_malformed_card_raises(self):
        path = HERE / "not-a-card.json"
        try:
            path.write_text(json.dumps({"prices": {}, "defaultModel": "deepseek-flash"}), encoding="utf-8")
            with self.assertRaises(ValueError):
                agent.load_rate_card(path)
        finally:
            path.unlink(missing_ok=True)

    def test_a_card_without_a_default_model_raises(self):
        # A card that names no default is a card whose bill would have to guess which row to read.
        path = HERE / "no-default.json"
        try:
            path.write_text(json.dumps({"prices": {"deepseek-flash": {}}}), encoding="utf-8")
            with self.assertRaises(ValueError) as caught:
                agent.load_rate_card(path)
            self.assertIn("defaultModel", str(caught.exception))
        finally:
            path.unlink(missing_ok=True)

    def test_a_card_without_peak_windows_raises(self):
        # The guard is the difference between a run that costs $3 and one that costs $6; a card that
        # cannot say when peak is cannot price a dispatch, so it is refused rather than assumed off-peak.
        path = HERE / "no-windows.json"
        band = {"miss": 0.15, "hit": 0.003, "out": 0.6}
        try:
            path.write_text(
                json.dumps({"prices": {"deepseek-flash": {"peak": band, "off_peak": band}}, "defaultModel": "deepseek-flash"}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as caught:
                agent.load_rate_card(path)
            self.assertIn("peakWindows", str(caught.exception))
        finally:
            path.unlink(missing_ok=True)


class UsageTest(unittest.TestCase):
    def test_reads_the_four_counts(self):
        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 7,
            "prompt_cache_hit_tokens": 80,
            "prompt_cache_miss_tokens": 20,
        }
        self.assertEqual(agent.usage_numbers(usage)["cache_hit_tokens"], 80)

    def test_missing_counts_are_zero_only_when_absent(self):
        self.assertEqual(agent.usage_numbers({"prompt_tokens": 5})["completion_tokens"], 0)

    def test_a_non_integer_raises(self):
        with self.assertRaises(agent.LaneError):
            agent.usage_numbers({"prompt_tokens": "many"})


class ShardTest(unittest.TestCase):
    def test_slices_cover_the_split_once(self):
        covered = []
        for index in range(4):
            start, stop = agent.shard_bounds(f"{index}/4", 134)
            covered.extend(range(start, stop))
        self.assertEqual(covered, list(range(134)))

    def test_a_slice_is_contiguous_and_bounded(self):
        self.assertEqual(agent.shard_bounds("0/4", 134), (0, 34))
        self.assertEqual(agent.shard_bounds("3/4", 134), (102, 134))

    def test_more_shards_than_games_leaves_empty_slices_rather_than_negative_ones(self):
        self.assertEqual(agent.shard_bounds("9/10", 5), (5, 5))

    def test_malformed_forms_raise(self):
        for shard in ("0", "1/0", "4/4", "-1/2", "a/b"):
            with self.assertRaises(agent.LaneError, msg=shard):
                agent.shard_bounds(shard, 134)


class FloorAgreementTest(unittest.TestCase):
    def episode(self, **overrides):
        base = {
            "gamefile": "game-1",
            "won": True,
            "steps": 7,
            "digest": "abc",
            "observe_fingerprint": "def",
        }
        base.update(overrides)
        return base

    def write(self, payload):
        path = HERE / "floor-under-test.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_agreement_is_zero_mismatches(self):
        path = self.write({"episodes": [self.episode()]})
        try:
            report = agent.compare_with_floor([self.episode()], path)
            self.assertEqual(report["mismatches"], 0)
            self.assertIsNone(report["first"])
        finally:
            path.unlink(missing_ok=True)

    def test_a_different_digest_is_a_mismatch_on_the_digest(self):
        path = self.write({"episodes": [self.episode()]})
        try:
            report = agent.compare_with_floor([self.episode(digest="xyz")], path)
            self.assertEqual(report["mismatches"], 1)
            self.assertEqual(report["first"]["field"], "digest")
        finally:
            path.unlink(missing_ok=True)

    def test_a_game_the_floor_never_drove_is_a_mismatch_of_its_own_kind(self):
        path = self.write({"episodes": [self.episode()]})
        try:
            report = agent.compare_with_floor([self.episode(gamefile="game-2")], path)
            self.assertEqual(report["first"]["field"], "missing")
        finally:
            path.unlink(missing_ok=True)




class FakeWorld:
    """A world small enough to read: two rooms, one apple, and a cabinet to put it in.

    This is a fake, not a mock. It has state, it advances it, it publishes the commands it admits, and
    it refuses what it does not — the loop cannot tell it from textworld except by how fast it answers.
    A mock would have asserted that `step` was called; this asserts that an episode reaching `won` is a
    transcript the loop actually walked, which is the thing that can be wrong.

    The first admissible command is the one that makes progress, so `--policy first` wins in two steps
    and a test that expects a win is a test of the loop rather than of a scripted policy.
    """

    def __init__(
        self,
        gamefile="json_2.1.1/valid_unseen/pick_and_place_simple-Apple-None-Cabinet-1/trial_t/game.tw-pddl",
        never_ends=False,
        nothing_happens=False,
    ):
        self.gamefile = gamefile
        self.never_ends = never_ends
        # Textworld answers a command it will not perform with `Nothing happens.`, and an action can be admitted and
        # still change nothing (`look` always is). The switch is off by default so that every test written before R191
        # drives the world it was written against; the ledger tests turn it on because a driver that is asked to answer
        # a no-op needs a world that produces one.
        self.nothing_happens = nothing_happens
        self.holding = None
        self.over = False
        self.won = False
        self.opened = False
        self.steps = 0

    def admissible(self):
        commands = []
        if self.holding is None:
            commands.append("take apple 1 from countertop 1")
        else:
            commands.append("put apple 1 in/on cabinet 1")
        if not self.opened:
            commands.append("open cabinet 1")
        commands.extend(["look", "inventory"])
        return commands

    def observation(self):
        if self.over:
            return "You put the apple 1 in/on the cabinet 1.\n"
        if self.holding:
            return f"You are carrying the apple 1.\nThe cabinet 1 is {'' if self.opened else 'closed and '}in front of you.\n"
        return "You are in the middle of a room. You see a countertop 1, and a cabinet 1.\nYour task is to: put apple 1 in/on cabinet 1.\n"

    def reset(self):
        # Every episode starts from the same state, because the real environment does: a fake that kept
        # its apple in hand across `reset` would have let a second episode start mid-task and made the
        # reproducibility test pass for the wrong reason.
        self.holding = None
        self.over = False
        self.won = False
        self.opened = False
        self.steps = 0
        # `extra.gamefile` is one flat key, not a nested map: that is the shape textworld's batch wrapper
        # produces and the shape `floor.py` reads on every game of the split. A fake that nested it would
        # have made this file pass while the real lane raised a KeyError on its first episode.
        return [self.observation()], {
            "extra.gamefile": [self.gamefile],
            "admissible_commands": [self.admissible()],
        }

    def step(self, actions):
        action = actions[0].strip().lower()
        self.steps += 1
        before = (self.holding, self.opened, self.won)
        # Only the apple that is actually here can be taken. A world that took anything would let an
        # invalid action succeed and make the invalid-action count a count of something else.
        if action.startswith("take") and "apple 1" in action:
            self.holding = "apple 1"
        elif action.startswith("open"):
            self.opened = True
        elif action.startswith("put") and self.holding and not self.never_ends:
            self.won = True
            self.over = True
        # The world's own no-op answer, with the trajectory's rule holding: the environment's text is what the model
        # hears, so a world that answered `Nothing happens.` and then reported a different observation would make the
        # ledger's test a test of the fake rather than of the driver.
        if self.nothing_happens and (self.holding, self.opened, self.won) == before and not self.over:
            return [agent.NO_OP + "\n"], [0.0], [False], {
                "won": [False],
                "admissible_commands": [self.admissible()],
            }
        return [self.observation()], [1.0 if self.won else 0.0], [self.over], {
            "won": [self.won],
            "admissible_commands": [self.admissible()],
        }


class LoopTest(unittest.TestCase):
    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()

    def drive(self, **overrides):
        arguments = {
            "arm": "none",
            "policy": "first",
            "examples": self.examples,
            "rules": [],
            "draw": agent.Draw(7),
            "max_steps": 50,
            "top_k": 3,
            "model": "deepseek-flash",
            "api_key": "",
            "timeout": 1.0,
        }
        arguments.update(overrides)
        return agent.run_episode(self.world, **arguments)

    def test_the_first_arm_wins_and_says_how(self):
        episode = self.drive()
        self.assertTrue(episode["won"])
        self.assertEqual(episode["steps"], 2)
        self.assertEqual(episode["task_kind"], "put")
        self.assertEqual(episode["calls"], 0)
        self.assertEqual(episode["invalid_actions"], 0)
        self.assertFalse(episode["truncated"])

    def test_the_prefix_is_measured_once_the_opening_is_built(self):
        episode = self.drive()
        self.assertGreater(episode["prefix_chars"], 3000)
        self.assertGreater(episode["prompt_chars"], episode["prefix_chars"])

    def test_the_pack_arm_carries_nothing_when_the_bank_is_empty(self):
        empty = self.drive(arm="always-in", rules=[])
        self.assertEqual(empty["pack_entries"], 0)
        self.assertEqual(empty["prefix_chars"], self.drive()["prefix_chars"])

    def test_the_pack_arm_carries_the_bank_and_the_prefix_grows(self):
        packed = self.drive(arm="always-in", rules=["always open the cabinet before taking"])
        self.assertEqual(packed["pack_entries"], 1)
        self.assertGreater(packed["prefix_chars"], self.drive()["prefix_chars"])

    def test_the_pack_length_is_recorded_apart_from_the_prefix(self):
        # The two differ by the few-shot examples, which are the same in every arm: only `pack_chars` answers the
        # question a length-matched experiment asks -- did this arm render the block it was registered with
        # (R176's void condition, AUDIT 34.249).
        rule = "always open the cabinet before taking"
        packed = self.drive(arm="always-in", rules=[rule])
        bare = self.drive()
        self.assertEqual(packed["pack_chars"], len(agent.render_pack([rule])))
        self.assertEqual(packed["prefix_chars"] - bare["prefix_chars"], packed["pack_chars"])
        self.assertEqual(bare["pack_chars"], 0)

    def test_the_retrieved_arm_carries_only_what_the_observation_admits(self):
        rules = ["the cabinet is closed", "the fridge is cold", "an apple is a fruit"]
        retrieved = self.drive(arm="retrieved", rules=rules, top_k=2)
        self.assertEqual(retrieved["pack_entries"], 2)

    def test_the_retrieved_arm_carries_nothing_when_nothing_matches(self):
        retrieved = self.drive(arm="retrieved", rules=["the fridge is cold"], top_k=2)
        self.assertEqual(retrieved["pack_entries"], 0)

    def test_the_sham_arm_carries_every_entry_the_way_always_in_does(self):
        # Same count, same header, same characters: the two arms differ in the order of the words inside
        # each rule and in nothing else. That is what makes a sham's delta attributable to meaning.
        rules = ["the cabinet is closed", "the fridge is cold"]
        sham = self.drive(arm="sham", rules=rules)
        self.assertEqual(sham["pack_entries"], 2)
        self.assertGreater(sham["prefix_chars"], self.drive()["prefix_chars"])

    def test_the_seed_policy_is_reproducible(self):
        first = self.drive(policy="seed", draw=agent.Draw(11))
        second = self.drive(policy="seed", draw=agent.Draw(11))
        self.assertEqual(first["digest"], second["digest"])

    def test_a_game_without_a_task_line_raises(self):
        world = FakeWorld()
        world.observation = lambda: "You are in the middle of a room.\n"
        with self.assertRaises(agent.LaneError):
            agent.run_episode(
                world, "none", "first", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "", 1.0
            )

    def test_a_game_with_no_admissible_command_ends_without_a_step(self):
        world = FakeWorld()
        world.admissible = lambda: []
        episode = agent.run_episode(
            world, "none", "first", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "", 1.0
        )
        self.assertEqual(episode["steps"], 0)
        self.assertTrue(episode["truncated"])

    def test_a_capped_episode_is_budget_exhausted_rather_than_truncated(self):
        # The two unfinished endings are different findings: one is the pass's own cap doing its job, the
        # other is the driver losing a game. The second dispatch failed because this file could not tell
        # them apart, and reported a 20-turn diagnostic as an infrastructure error.
        world = FakeWorld()
        world.step = lambda actions: (["nothing happens"], [0.0], [False], {"won": [False], "admissible_commands": [world.admissible()]})
        episode = agent.run_episode(
            world, "none", "first", self.examples, [], agent.Draw(1), 3, 3, "deepseek-flash", "", 1.0
        )
        self.assertFalse(episode["truncated"])
        self.assertTrue(episode["budget_exhausted"])
        self.assertEqual(episode["steps"], 3)


class TrajectoryTest(unittest.TestCase):
    """What a rule bank is distilled from: the episode as the competitor's critique prompt reads it.

    Assertions are made on the flat text rather than on lines, because an observation is two lines long
    in this world (`room description`, then `Your task is to: …`) and a line-indexed test would be a test
    about the fixture's line count.
    """

    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()

    def drive(self, **overrides):
        arguments = {
            "arm": "none",
            "policy": "first",
            "examples": self.examples,
            "rules": [],
            "draw": agent.Draw(7),
            "max_steps": 50,
            "top_k": 3,
            "model": "deepseek-flash",
            "api_key": "",
            "timeout": 1.0,
            "record_transcripts": True,
        }
        arguments.update(overrides)
        return agent.run_episode(self.world, **arguments)

    def test_the_trajectory_is_the_episode_in_the_competitors_rendering(self):
        opening = self.world.observation()
        episode = self.drive()
        text = episode["trajectory"]
        self.assertTrue(episode["won"])
        self.assertTrue(text.startswith(opening))
        self.assertIn("\n> take apple 1 from countertop 1\n", text)
        self.assertIn("\n> put apple 1 in/on cabinet 1\n", text)
        self.assertEqual(text.count("\n> "), 2)
        self.assertTrue(text.endswith("You put the apple 1 in/on the cabinet 1."))

    def test_a_thought_is_answered_with_ok_exactly_as_the_examples_are(self):
        original = agent.chat
        replies = ["> think: I need an apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        agent.chat = lambda messages, model, api_key, timeout: (
            replies.pop(0),
            {"prompt_tokens": 10, "completion_tokens": 1, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 10},
            0,
        )
        try:
            episode = self.drive(policy="model")
        finally:
            agent.chat = original
        self.assertIn("\n> think: I need an apple\nOK.\n> take apple 1 from countertop 1\n", episode["trajectory"])

    def test_free_text_is_recorded_as_the_thought_the_parser_read_it_as(self):
        original = agent.chat
        replies = ["I cannot find the apple.", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        agent.chat = lambda messages, model, api_key, timeout: (
            replies.pop(0),
            {"prompt_tokens": 10, "completion_tokens": 1, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 10},
            0,
        )
        try:
            episode = self.drive(policy="model")
        finally:
            agent.chat = original
        self.assertIn("\n> think: I cannot find the apple.\nOK.\n", episode["trajectory"])

    def test_a_trajectory_is_absent_unless_it_was_asked_for(self):
        # 134 transcripts are about 700 KB of artefact that a scored run has no use for.
        episode = self.drive(record_transcripts=False)
        self.assertNotIn("trajectory", episode)

    def test_a_lost_game_still_records_its_trajectory(self):
        # The bank is distilled from successes, but a trajectory that only existed for wins would make the
        # artefact unable to answer why the other half failed.
        self.world.step = lambda actions: (
            ["nothing happens"],
            [0.0],
            [False],
            {"won": [False], "admissible_commands": [self.world.admissible()]},
        )
        episode = self.drive(max_steps=4)
        self.assertFalse(episode["won"])
        self.assertEqual(episode["trajectory"].count("\n> "), 4)
        self.assertTrue(episode["trajectory"].endswith("nothing happens"))


class ModelPolicyTest(unittest.TestCase):
    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()
        self.original = agent.chat

    def tearDown(self):
        agent.chat = self.original

    def script(self, replies, usage=None):
        remaining = list(replies)

        def chat(messages, model, api_key, timeout):
            self.assertIsInstance(messages, list)
            self.assertEqual(messages[0]["role"], "system")
            return (
                remaining.pop(0),
                usage
                or {
                    "prompt_tokens": 100,
                    "completion_tokens": 5,
                    "prompt_cache_hit_tokens": 60,
                    "prompt_cache_miss_tokens": 40,
                },
                0,
            )

        agent.chat = chat

    def test_a_thought_does_not_move_the_world_but_does_spend_a_turn(self):
        # `steps` counts model turns. A thought that were free would let an episode call the model forever
        # without ever reaching the environment's verdict -- and the first dispatch found out what that
        # costs when a model gave up and started narrating.
        self.script(["> think: I need an apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        episode = agent.run_episode(
            self.world, "none", "model", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "k", 1.0
        )
        self.assertTrue(episode["won"])
        self.assertEqual(episode["steps"], 3)
        self.assertEqual(episode["actions"], 2)
        self.assertEqual(episode["thoughts"], 1)
        self.assertEqual(episode["calls"], 3)
        self.assertEqual(episode["usage"]["prompt_tokens"], 300)
        self.assertEqual(episode["usage"]["cache_hit_tokens"], 180)

    def test_a_run_of_thoughts_spends_the_budget_and_ends_the_episode(self):
        self.script(["> think: one", "> think: two", "> think: three"])
        episode = agent.run_episode(
            self.world, "none", "model", self.examples, [], agent.Draw(1), 3, 3, "deepseek-flash", "k", 1.0
        )
        self.assertFalse(episode["won"])
        self.assertTrue(episode["budget_exhausted"])
        self.assertFalse(episode["truncated"])
        self.assertEqual(episode["steps"], 3)
        self.assertEqual(episode["actions"], 0)
        self.assertEqual(episode["thoughts"], 3)
        self.assertEqual(episode["stalls"], 1)
        self.assertEqual(self.world.steps, 0)

    def test_free_text_narration_is_a_thought_and_does_not_raise(self):
        # The first dispatch died here: a model that has given up narrates instead of acting, and that is a
        # failure the arm is supposed to record rather than an infrastructure error that hides the run.
        self.script(["I was unable to complete the task.", "I cannot find the bread.", "I give up."])
        episode = agent.run_episode(
            self.world, "none", "model", self.examples, [], agent.Draw(1), 3, 3, "deepseek-flash", "k", 1.0
        )
        self.assertEqual(episode["actions"], 0)
        self.assertEqual(episode["thoughts"], 3)

    def test_an_action_outside_the_admissible_set_is_counted_and_still_steps(self):
        self.script(["> take pear 9 from fridge 2", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        episode = agent.run_episode(
            self.world, "none", "model", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "k", 1.0
        )
        self.assertEqual(episode["invalid_actions"], 1)
        self.assertEqual(episode["off_space_actions"], 0)

    def test_a_command_under_a_thought_is_refused_counted_and_answered_with_the_no_op_string(self):
        # 1,070 commands in 72 `put` games of the train pass never reached the world (AUDIT 34.259). The
        # parser reads the first line -- that is the competitor's rule and it is not changed here -- so a
        # reply that opens with `> think` drops the command under it. What was wrong is the answer: `OK.` is
        # the examples' token for a thought that was only a thought, and giving it to a turn whose command was
        # refused told the model its `put` had worked. It then wrote "The task is complete" until the budget
        # ran out, which is why `put` -- the one kind whose model hedges before acting -- is the only kind
        # destroyed by this defect.
        seen = []
        original = agent.chat
        replies = [
            "> think: I need the apple\n> take apple 1 from countertop 1",
            "> take apple 1 from countertop 1",
            "> put apple 1 in/on cabinet 1",
        ]

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return replies.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        try:
            episode = agent.run_episode(
                self.world, "none", "model", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "k", 1.0
            )
        finally:
            agent.chat = original
        self.assertEqual(episode["refused_actions"], 1)
        self.assertEqual(episode["thoughts"], 1)
        self.assertEqual(episode["actions"], 2)
        self.assertEqual(episode["steps"], 3)
        self.assertEqual(episode["invalid_actions"], 0)
        self.assertTrue(episode["won"])
        # The refused turn never reached the world: the first environment step is the second reply's, not the
        # command that was written under the thought.
        self.assertEqual(self.world.steps, 2)
        # What the model was told, read from the prompt it was given next rather than from a field.
        self.assertEqual(seen[1][-1], agent.NO_OP)
        self.assertEqual(agent.NO_OP, "Nothing happens.")

    def test_a_thought_that_carries_no_command_is_still_answered_with_the_examples_oh_kay(self):
        # The repair must not turn every thought into a no-op: `OK.` is the correct answer to a turn that was
        # only a thought, the examples answer four of them that way, and a driver that answered `Nothing
        # happens.` to a thought would be inventing a world event.
        seen = []
        original = agent.chat
        replies = ["> think: I need the apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return replies.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        try:
            episode = agent.run_episode(
                self.world, "none", "model", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "k", 1.0
            )
        finally:
            agent.chat = original
        self.assertEqual(episode["refused_actions"], 0)
        self.assertEqual(seen[1][-1], "OK.")
        self.assertTrue(episode["won"])

    def test_prose_under_a_thought_names_no_command_and_is_not_a_refusal(self):
        # A model that narrates rather than acting writes paragraphs, and a paragraph that mentions `put` in
        # the middle of a sentence is not a command the parser dropped. Only a line the parser would have
        # read as an action counts, which is what keeps this field from becoming a count of English.
        original = agent.chat

        def chat(messages, model, api_key, timeout):
            return (
                "> think: I should put the apple somewhere.\nIt is probably fine.\nJust keep going.",
                {"prompt_tokens": 10, "completion_tokens": 1},
                0,
            )

        agent.chat = chat
        try:
            episode = agent.run_episode(
                self.world, "none", "model", self.examples, [], agent.Draw(1), 2, 3, "deepseek-flash", "k", 1.0
            )
        finally:
            agent.chat = original
        self.assertEqual(episode["refused_actions"], 0)
        self.assertEqual(episode["actions"], 0)

    def test_the_refused_commands_are_quoted_back_up_to_the_cap(self):
        # The count says how often; the sample says what. Three is the cap because the shape of the mistake is
        # what a reader needs and a 274-game pass must not become a transcript.
        original = agent.chat
        replies = [
            "> think: a\n> go to countertop 1",
            "> think: b\n> take apple 1 from countertop 1",
            "> think: c\n> put apple 1 in/on cabinet 1",
            "> think: d\n> inventory",
        ]

        def chat(messages, model, api_key, timeout):
            return replies.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        try:
            episode = agent.run_episode(
                self.world, "none", "model", self.examples, [], agent.Draw(1), 4, 3, "deepseek-flash", "k", 1.0
            )
        finally:
            agent.chat = original
        self.assertEqual(episode["refused_actions"], 4)
        self.assertEqual(len(episode["refused_samples"]), agent.REFUSED_SAMPLES)
        self.assertEqual(episode["refused_samples"][0], "go to countertop 1")
        self.assertEqual(episode["refused_samples"][2], "put apple 1 in/on cabinet 1")

    def test_the_pack_is_prepended_to_the_first_observation_and_absent_from_the_instruction(self):
        # The placement is the competitor's: `insert_before_task_prompt` puts the rule block after the
        # few-shot block and before the task. Here the task line is hoisted to the top of the first human
        # turn, so the block sits immediately before the room description instead.
        seen = []
        original = agent.chat

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return (
                "> take apple 1 from countertop 1",
                {
                    "prompt_tokens": 10,
                    "completion_tokens": 1,
                    "prompt_cache_hit_tokens": 0,
                    "prompt_cache_miss_tokens": 10,
                },
                0,
            )

        agent.chat = chat
        try:
            agent.run_episode(
                self.world, "always-in", "model", self.examples,
                ["always open the cabinet before taking anything."],
                agent.Draw(1), 1, 3, "deepseek-flash", "k", 1.0,
            )
        finally:
            agent.chat = original
        first = seen[0]
        for message in first[:-1]:
            self.assertNotIn(agent.PACK_HEADER, message)
        self.assertTrue(first[-1].startswith(agent.PACK_HEADER))
        self.assertIn("1. always open the cabinet before taking anything.", first[-1])
        self.assertIn("You are in the middle of a room.", first[-1])

    def test_the_control_arm_carries_no_pack_whatsoever(self):
        # `none` is the corpus's own difficulty, so its first observation is the environment's string and
        # nothing else. A prefix byte here would make every arm's absolute score incomparable to a
        # published ReAct row without saying so.
        seen = []
        original = agent.chat

        def chat(messages, model, api_key, timeout):
            seen.append(messages[-1]["content"])
            return (
                "> take apple 1 from countertop 1",
                {
                    "prompt_tokens": 10,
                    "completion_tokens": 1,
                    "prompt_cache_hit_tokens": 0,
                    "prompt_cache_miss_tokens": 10,
                },
                0,
            )

        opening = self.world.observation()
        agent.chat = chat
        try:
            agent.run_episode(self.world, "none", "model", self.examples, [], agent.Draw(1), 1, 3, "deepseek-flash", "k", 1.0)
        finally:
            agent.chat = original
        self.assertEqual(seen[0], opening)

    def test_a_reply_that_is_not_a_command_at_all_is_counted_as_off_space(self):
        self.script(["I would rather not.", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        # Free text parses as a thought, so the loop retries; the count that matters is the thought.
        episode = agent.run_episode(
            self.world, "none", "model", self.examples, [], agent.Draw(1), 50, 3, "deepseek-flash", "k", 1.0
        )
        self.assertEqual(episode["thoughts"], 1)


class MainTest(unittest.TestCase):
    """The pass, end to end, against the fake world — arguments, accounting and the artefact."""

    def setUp(self):
        self.original_build = agent.build_env
        self.original_chat = agent.chat
        self.world = FakeWorld()
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (self.world, 1)
        self.out = HERE / "agent-under-test.json"
        self.floor = HERE / "floor-under-test.json"

    def tearDown(self):
        agent.build_env = self.original_build
        agent.chat = self.original_chat
        for path in (self.out, self.floor):
            path.unlink(missing_ok=True)

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["agent.py"] + argv
        try:
            return agent.main()
        finally:
            sys.argv = original

    def test_games_beyond_the_split_are_refused_rather_than_shortened(self):
        # The pass used to answer `--games 140` on the 134-game split with 134 games, and the artefact then said
        # 134/134 — a full-looking rate for a budget the caller never received. A ceiling is a refusal.
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "140", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)
        self.assertFalse(self.out.exists(), "a refused pass must not leave an artefact behind")

    def test_games_beyond_the_installed_corpus_are_refused_too(self):
        # The stub world holds one game while the table publishes 134, so this is the corpus ceiling rather than
        # the table's; both are refusals, and neither is a silent `min`.
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_channel_pass_prints_the_commands_it_executed_from_a_later_line(self):
        # The line only exists on a channel that can recover something, which is why it is a branch in `main` and why
        # it needs a pass to cover it: a `reference` run printing it would print a structural zero and teach a reader
        # to skip the line that matters on the other channel.
        script = ["> think: I need the apple\n> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]

        def chat(messages, model, api_key, timeout):
            return script.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        original_key = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        printed = io.StringIO()
        try:
            with contextlib.redirect_stdout(printed):
                self.assertEqual(
                    self.run_main(
                        [
                            "--arm", "none", "--policy", "model", "--games", "1",
                            "--parser", "any-line", "--out", str(self.out),
                        ]
                    ),
                    0,
                )
        finally:
            if original_key is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original_key
        self.assertIn("recovered       1 commands executed from a later line (any-line)", printed.getvalue())

    def test_the_artefact_records_the_section_and_the_size_it_publishes(self):
        # A join across two sections is refused by `aggregate.py`, and it can only be refused if every slice says
        # which section it drove. `split_size` is the denominator a tiling check holds to.
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
        self.assertEqual(summary["split"], "eval_out_of_distribution")
        self.assertEqual(summary["split_size"], agent.SPLIT_SIZES["eval_out_of_distribution"])

    def test_a_pass_writes_a_summary_whose_accounting_closes(self):
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        summary = payload["summary"]
        self.assertEqual(summary["wins"], 1)
        self.assertEqual(summary["games_driven"], 1)
        self.assertEqual(summary["calls"], 0)
        self.assertEqual(summary["bill"]["usd"], 0.0)
        self.assertEqual(summary["arm"], "none")

    def test_a_seed_pass_reproduces_a_floor_that_agrees(self):
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        first = json.loads(self.out.read_text(encoding="utf-8"))
        self.floor.write_text(json.dumps({"episodes": first["episodes"]}), encoding="utf-8")
        self.assertEqual(
            self.run_main(["--policy", "first", "--games", "1", "--assert-floor", str(self.floor), "--out", str(self.out)]),
            0,
        )
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["floor_agreement"]["mismatches"], 0)

    def test_a_floor_that_disagrees_fails_the_pass(self):
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        first = json.loads(self.out.read_text(encoding="utf-8"))
        first["episodes"][0]["digest"] = "not-the-same"
        self.floor.write_text(json.dumps({"episodes": first["episodes"]}), encoding="utf-8")
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "1", "--assert-floor", str(self.floor), "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_model_pass_without_a_key_fails_instead_of_falling_back(self):
        original = os.environ.pop("DEEPSEEK_API_KEY", None)
        try:
            with self.assertRaises(SystemExit) as caught:
                self.run_main(["--policy", "model", "--games", "1", "--out", str(self.out)])
            self.assertEqual(caught.exception.code, 1)
        finally:
            if original is not None:
                os.environ["DEEPSEEK_API_KEY"] = original

    def test_an_arm_without_rules_fails_instead_of_running_as_none(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_the_sham_arm_without_rules_is_refused_too(self):
        # The sham is a permutation *of a bank*: with no bank there is nothing to permute, and an arm that
        # silently rendered an empty block would be `none` with a third name.
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--arm", "sham", "--policy", "first", "--games", "1", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_kind_gate_over_an_untagged_bank_is_refused(self):
        # A gate with nothing to gate on is `always-in` wearing a different label and paying a second time to
        # answer a question it never asked. The bank the lane's earlier arms carry has no tags, so this is the
        # mistake that is easiest to make by pointing `--gate-kind` at the old file.
        bank = HERE / "bank-untagged.json"
        bank.write_text(json.dumps({"entries": [{"text": "Check the countertop first."}]}), encoding="utf-8")
        try:
            with self.assertRaises(SystemExit) as caught:
                self.run_main(
                    ["--arm", "always-in", "--gate-kind", "--rules", str(bank), "--policy", "first", "--games", "1",
                     "--out", str(self.out)]
                )
            self.assertEqual(caught.exception.code, 1)
        finally:
            bank.unlink(missing_ok=True)

    def test_a_kind_gate_on_the_control_runs_and_records_that_it_moved_nothing(self):
        # The workflow hands every input to every arm in the matrix, so a flag that is only meaningful for a
        # treatment must not be an error on the control: the refusal ran once and took the control arm of a gated
        # sweep down with it, four shards, leaving the treatment with nothing to pair against (AUDIT 34.246).
        # What it must not do either is rename the control: `none@kind` would be a second control family, and the
        # one arm every reading is compared against has to keep the name it has had for six sweeps.
        self.assertEqual(
            self.run_main(["--arm", "none", "--gate-kind", "--policy", "first", "--games", "1", "--out", str(self.out)]),
            0,
        )
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        summary = payload["summary"]
        self.assertIsNone(summary["gate_kind"])
        self.assertEqual(summary["arm_label"], "none")
        self.assertEqual(payload["episodes"][0]["pack_entries"], 0)

    def test_the_label_never_says_kind_for_the_arm_that_carries_no_bank(self):
        # The same rule as a function, so the call site and the docstring cannot drift: a knob that selects from
        # an empty set has not been moved.
        self.assertEqual(agent.arm_label("none", agent.DEFAULT_TOP_K, 0.0, gate_kind=True), "none")
        self.assertEqual(agent.arm_label("always-in", agent.DEFAULT_TOP_K, 0.0, gate_kind=True), "always-in@kind")
        self.assertEqual(agent.arm_label("retrieved", 1, 0.0, gate_kind=True), "retrieved@k1+kind")

    def test_a_kind_gate_over_a_tagged_bank_names_itself_in_the_artefact(self):
        bank = HERE / "bank-tagged.json"
        bank.write_text(
            json.dumps(
                {
                    "entries": [
                        {"text": "Check inventory after take.", "kinds": ["put"]},
                        {"text": "Heat things in the microwave.", "kinds": ["heat"]},
                    ]
                }
            ),
            encoding="utf-8",
        )
        try:
            self.assertEqual(
                self.run_main(
                    ["--arm", "always-in", "--gate-kind", "--rules", str(bank), "--policy", "first", "--games", "1",
                     "--out", str(self.out)]
                ),
                0,
            )
            payload = json.loads(self.out.read_text(encoding="utf-8"))
            summary = payload["summary"]
            self.assertEqual(summary["arm"], "always-in")
            self.assertEqual(summary["arm_label"], "always-in@kind")
            self.assertEqual(summary["gate_kind"], True)
            self.assertEqual(summary["rules_in_bank"], 2)
            self.assertEqual(payload["episodes"][0]["pack_entries"], 1)
        finally:
            bank.unlink(missing_ok=True)

    def test_the_sham_arm_records_the_bank_it_permuted(self):
        bank = HERE / "bank-sham.json"
        bank.write_text(
            json.dumps({"entries": [{"text": "Check the countertop first."}, {"text": "Cold things are in the fridge."}]}),
            encoding="utf-8",
        )
        try:
            self.assertEqual(
                self.run_main(
                    ["--arm", "sham", "--rules", str(bank), "--policy", "first", "--games", "1", "--out", str(self.out)]
                ),
                0,
            )
            summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
            self.assertEqual(summary["arm"], "sham")
            # The bank is recorded so a reader can see the sham came from twenty rules rather than four,
            # even though the text in the prefix is not the text of those rules.
            self.assertEqual(summary["rules_in_bank"], 2)
        finally:
            bank.unlink(missing_ok=True)

    def test_a_sharded_seed_pass_is_refused(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "seed", "--shard", "0/2", "--games", "1", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_rules_are_read_from_a_bank_and_capped(self):
        bank = HERE / "bank-under-test.json"
        bank.write_text(
            json.dumps({"entries": [{"text": "one"}, {"text": "two"}, {"text": "three"}], "cap": 2}),
            encoding="utf-8",
        )
        try:
            self.assertEqual(
                self.run_main(
                    ["--arm", "always-in", "--rules", str(bank), "--policy", "first", "--games", "1", "--out", str(self.out)]
                ),
                0,
            )
            summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
            self.assertEqual(summary["rules_in_bank"], 2)
        finally:
            bank.unlink(missing_ok=True)

    def test_a_model_pass_that_drove_nothing_fails_instead_of_billing_zero(self):
        # An empty slice is the shape a mis-sized dispatch takes, and a pass that drove nothing would
        # otherwise report 0 wins, 0 calls and a bill of 0 -- three numbers that read like a result and
        # are a job that never ran.
        original = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        try:
            with self.assertRaises(SystemExit) as caught:
                self.run_main(["--policy", "model", "--games", "1", "--shard", "9/10", "--out", str(self.out)])
            self.assertEqual(caught.exception.code, 1)
        finally:
            if original is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original

    def test_trace_prints_the_first_replies_of_the_arm(self):
        # The first reading of a calibration is not the score: it is the first few replies, because a rate
        # computed over a format the model ignored is a rate about the format.
        original = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        replies = ["> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        agent.chat = lambda messages, model, api_key, timeout: (
            replies.pop(0),
            {"prompt_tokens": 10, "completion_tokens": 1, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 10},
            0,
        )
        printed = io.StringIO()
        try:
            with contextlib.redirect_stdout(printed):
                self.assertEqual(
                    self.run_main(["--policy", "model", "--games", "1", "--trace", "2", "--out", str(self.out)]), 0
                )
        finally:
            if original is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original
        self.assertIn("turn 1 action: '> take apple 1 from countertop 1'", printed.getvalue())
        self.assertIn("turn 2 action: '> put apple 1 in/on cabinet 1'", printed.getvalue())

    def test_a_model_pass_that_never_acted_fails_rather_than_reporting_zero(self):
        # A pass where every reply parsed as a thought is not a low score; it is a prompt the model did not
        # read as a prompt, and a rate over it would be a rate about the skeleton's syntax.
        original = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        agent.chat = lambda messages, model, api_key, timeout: (
            "I would rather not.",
            {"prompt_tokens": 10, "completion_tokens": 1, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 10},
            0,
        )
        printed = io.StringIO()
        try:
            with contextlib.redirect_stdout(printed):
                with self.assertRaises(SystemExit) as caught:
                    self.run_main(["--policy", "model", "--games", "1", "--max-steps", "2", "--out", str(self.out)])
        finally:
            if original is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original
        self.assertEqual(caught.exception.code, 1)
        self.assertIn("no episode produced an action", printed.getvalue())

    def test_the_split_reaches_the_environment_builder(self):
        # `valid_seen` is training data for the rule bank and `valid_unseen` is the measurement. A dispatch
        # that named one and drove the other would distil rules from the held-out games and then report a
        # score on them, which is a leak that looks like a result.
        seen = {}

        def build(batch_size=1, train_eval="eval_out_of_distribution"):
            seen["train_eval"] = train_eval
            return self.world, 1

        agent.build_env = build
        try:
            self.assertEqual(
                self.run_main(["--split", "eval_in_distribution", "--policy", "first", "--games", "1", "--out", str(self.out)]),
                0,
            )
        finally:
            agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (self.world, 1)
        self.assertEqual(seen["train_eval"], "eval_in_distribution")
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["split"], "eval_in_distribution")

    def test_the_default_split_is_the_held_out_one(self):
        seen = {}

        def build(batch_size=1, train_eval="unset"):
            seen["train_eval"] = train_eval
            return self.world, 1

        agent.build_env = build
        try:
            self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        finally:
            agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (self.world, 1)
        self.assertEqual(seen["train_eval"], "eval_out_of_distribution")

    def test_recorded_transcripts_reach_the_artefact(self):
        self.assertEqual(
            self.run_main(["--policy", "first", "--games", "1", "--record-transcripts", "--out", str(self.out)]), 0
        )
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertTrue(payload["summary"]["transcripts"])
        self.assertIn("> take apple 1 from countertop 1", payload["episodes"][0]["trajectory"])

    def test_transcripts_are_off_by_default(self):
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertFalse(payload["summary"]["transcripts"])
        self.assertNotIn("trajectory", payload["episodes"][0])

    def test_a_model_pass_bills_what_it_used(self):
        original = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        replies = ["> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        agent.chat = lambda messages, model, api_key, timeout: (
            replies.pop(0),
            {
                "prompt_tokens": 20_000,
                "completion_tokens": 10,
                "prompt_cache_hit_tokens": 18_000,
                "prompt_cache_miss_tokens": 2_000,
            },
            0,
        )
        try:
            self.assertEqual(self.run_main(["--policy", "model", "--games", "1", "--out", str(self.out)]), 0)
            summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
            self.assertEqual(summary["wins"], 1)
            self.assertEqual(summary["calls"], 2)
            self.assertEqual(summary["usage"]["prompt_tokens"], 40_000)
            self.assertGreater(summary["bill"]["usd"], 0)
            self.assertEqual(summary["cache_hit_rate"], 0.9)
        finally:
            if original is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original


class EndpointHandler(BaseHTTPRequestHandler):
    """A real HTTP endpoint that answers the four ways the provider can answer."""

    seen: "list[dict]" = []

    def do_POST(self):  # noqa: N802 - the name is the protocol
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        EndpointHandler.seen.append({"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        if self.path == "/refuse":
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": {"message": "bad key"}}')
            return
        if self.path == "/empty-choices":
            payload = {"choices": []}
        elif self.path == "/no-choices-key":
            payload = {"id": "x"}
        elif self.path == "/no-text":
            payload = {"choices": [{"message": {"content": ""}}], "usage": {}}
        else:
            payload = {
                "choices": [{"message": {"content": "> go to cabinet 1"}}],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 3,
                    "prompt_cache_hit_tokens": 10,
                    "prompt_cache_miss_tokens": 2,
                },
            }
        encoded = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args):  # silence the default stderr line
        return


class ChatTest(unittest.TestCase):
    """`chat` against a socket, because the exception it raises is the one a run is cancelled on."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), EndpointHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def messages(self):
        return [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]

    def test_a_normal_answer_returns_text_and_usage(self):
        reply, usage, retries = agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/ok"))
        self.assertEqual(reply, "> go to cabinet 1")
        self.assertEqual(retries, 0)
        self.assertEqual(agent.usage_numbers(usage)["cache_hit_tokens"], 10)

    def test_the_request_carries_the_key_the_mode_and_no_sampling(self):
        EndpointHandler.seen.clear()
        agent.chat(self.messages(), "deepseek-flash", "secret", 5.0, url=self.url("/ok"))
        sent = EndpointHandler.seen[-1]
        self.assertEqual(sent["auth"], "Bearer secret")
        self.assertEqual(sent["body"]["model"], "deepseek-flash")
        self.assertEqual(sent["body"]["temperature"], 0)
        self.assertEqual(sent["body"]["thinking"], {"type": "disabled"})

    def test_a_refusal_is_an_error_naming_the_status(self):
        with self.assertRaises(agent.LaneError) as caught:
            agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/refuse"))
        self.assertIn("400", str(caught.exception))

    def test_an_empty_choice_list_is_an_error(self):
        with self.assertRaises(agent.LaneError):
            agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/empty-choices"))

    def test_a_response_without_choices_is_an_error(self):
        with self.assertRaises(agent.LaneError):
            agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/no-choices-key"))

    def test_a_response_without_text_is_an_error(self):
        with self.assertRaises(agent.LaneError):
            agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/no-text"))

    def test_an_unreachable_endpoint_is_an_error_rather_than_a_retry(self):
        # Bind a port, learn its number, close it: the connection is refused by the kernel rather than by
        # a firewall, which is the difference between a fast refusal and a timeout in the test suite.
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        closed = probe.getsockname()[1]
        probe.close()
        with self.assertRaises(agent.LaneError):
            agent.chat(self.messages(), "deepseek-flash", "k", 2.0, url=f"http://127.0.0.1:{closed}/ok")


class AttemptTest(unittest.TestCase):
    """The two functions `chat` is built from, tested as values rather than as sockets."""

    def test_a_response_without_choices_is_refused_by_name(self):
        with self.assertRaises(agent.LaneError) as caught:
            agent.parse_completion({"id": "x"})
        self.assertIn("no choices", str(caught.exception))

    def test_a_response_with_an_empty_choice_list_is_refused(self):
        with self.assertRaises(agent.LaneError):
            agent.parse_completion({"choices": []})

    def test_a_response_without_text_is_refused_by_name(self):
        with self.assertRaises(agent.LaneError) as caught:
            agent.parse_completion({"choices": [{"message": {"content": "  "}}]})
        self.assertIn("no text", str(caught.exception))

    def test_a_response_without_a_usage_object_reads_as_an_empty_one(self):
        # The provider omitting `usage` is not a lane defect -- it is a bill this lane cannot compute, and
        # `usage_numbers` is the function that refuses to read a missing count as zero, not this one.
        content, usage = agent.parse_completion({"choices": [{"message": {"content": "> look"}}]})
        self.assertEqual((content, usage), ("> look", {}))

    def test_an_error_that_is_neither_the_network_s_nor_the_endpoint_s_is_not_swallowed(self):
        # A `ValueError` from the JSON decoder is a defect in this file, and a retry would turn it into four
        # defects that took fifteen seconds. It is re-raised as itself rather than as a LaneError, so that the
        # traceback still points at the line.
        original = agent.attempt_once
        agent.attempt_once = lambda *arguments, **options: (_ for _ in ()).throw(ValueError("not json"))
        try:
            with self.assertRaises(ValueError):
                agent.chat([{"role": "user", "content": "u"}], "deepseek-flash", "k", 5.0, sleep=lambda s: None)
        finally:
            agent.attempt_once = original


class RefusalTest(unittest.TestCase):
    """The two paths through `main` that refuse a record rather than writing one."""

    def setUp(self):
        self.original_build = agent.build_env
        self.out = HERE / "agent-refusal.json"
        self.floor = HERE / "floor-refusal.json"

    def tearDown(self):
        agent.build_env = self.original_build
        for path in (self.out, self.floor):
            path.unlink(missing_ok=True)

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["agent.py"] + argv
        try:
            return agent.main()
        finally:
            sys.argv = original

    def test_a_game_driven_twice_fails_the_pass(self):
        agent.build_env = lambda batch_size=1, train_eval="": (FakeWorld(), 2)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_pass_that_spends_its_budget_is_a_result_rather_than_a_failure(self):
        agent.build_env = lambda batch_size=1, train_eval="": (FakeWorld(never_ends=True), 1)
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--max-steps", "3", "--out", str(self.out)]), 0)
        summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
        self.assertEqual(summary["budget_exhausted"], 1)
        self.assertEqual(summary["wins"], 0)

    def test_an_episode_that_ends_with_turns_to_spare_fails_the_pass(self):
        # An environment that admits no command while the budget is untouched is neither a win nor a
        # budget ending: it is the pass losing the game, and it must not be written up as a rate.
        world = FakeWorld()
        world.admissible = lambda: []
        agent.build_env = lambda batch_size=1, train_eval="": (world, 1)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "1", "--max-steps", "50", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_two_game_pass_reports_its_progress_once_at_the_end(self):
        # `% 10` and `index + 1 == stop`: with two games neither line fires on the first and only the
        # second prints, which is the branch a one-game pass never reaches. The two games are told apart
        # by their trial directory because the duplicate check is real and would refuse them otherwise.
        class RotatingWorld(FakeWorld):
            turn = 0

            def reset(self):
                RotatingWorld.turn += 1
                self.gamefile = self.gamefile.split("/trial_")[0] + f"/trial_{RotatingWorld.turn}/game.tw-pddl"
                return super().reset()

        agent.build_env = lambda batch_size=1, train_eval="": (RotatingWorld(), 2)
        self.assertEqual(self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)]), 0)
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["wins"], 2)

    def test_a_bank_without_a_cap_is_read_whole(self):
        bank = HERE / "bank-no-cap.json"
        bank.write_text(json.dumps({"entries": ["one", "two"]}), encoding="utf-8")
        agent.build_env = lambda batch_size=1, train_eval="": (FakeWorld(), 1)
        try:
            self.assertEqual(
                self.run_main(
                    ["--arm", "always-in", "--rules", str(bank), "--policy", "first", "--games", "1", "--out", str(self.out)]
                ),
                0,
            )
            self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["rules_in_bank"], 2)
        finally:
            bank.unlink(missing_ok=True)

    def test_an_off_space_action_is_counted_separately_from_an_invalid_one(self):
        original = os.environ.get("DEEPSEEK_API_KEY")
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        original_chat = agent.chat
        replies = ["> wibble", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        agent.chat = lambda messages, model, api_key, timeout, url=None: (
            replies.pop(0),
            {"prompt_tokens": 1, "completion_tokens": 1, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 1},
            0,
        )
        agent.build_env = lambda batch_size=1, train_eval="": (FakeWorld(), 1)
        try:
            self.assertEqual(self.run_main(["--policy", "model", "--games", "1", "--out", str(self.out)]), 0)
            summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
            self.assertEqual(summary["invalid_actions"], 1)
            self.assertEqual(summary["off_space_actions"], 1)
        finally:
            agent.chat = original_chat
            if original is None:
                os.environ.pop("DEEPSEEK_API_KEY", None)
            else:
                os.environ["DEEPSEEK_API_KEY"] = original


class PartitionTest(unittest.TestCase):
    """The invariant the whole sweep rests on: `--shard i/n` partitions the split instead of sampling it.

    Run `44685314225` produced 105 episodes over 82 distinct games, with 11 games shared between shard 0 and
    shard 2. The cause was one call: `AlfredTWEnv.collect_game_files` walks the split with
    `os.walk(data_dir, topdown=False)`, so the game order is the filesystem's, and two jobs on two runners
    sliced two different orderings of the same 140 games. Every sharded number this lane has produced before
    this test rests on an ordering that was never the same twice.
    """

    class Shell:
        """A stand-in for `AlfredTWEnv`, injected rather than imported: the package is not installed here."""

        def __init__(self, config, train_eval=""):
            self.game_files = ["/c/game.tw-pddl", "/a/game.tw-pddl", "/b/game.tw-pddl"]
            self.num_games = len(self.game_files)
            self.batch_size = None

        def init_env(self, batch_size=1):
            self.batch_size = batch_size
            return self

    def test_the_game_order_is_the_sorts_and_not_the_filesystems(self):
        shell = self.Shell(None)
        env, num_games = floor.build_env(shell_factory=lambda config, train_eval="": shell)
        self.assertEqual(shell.game_files, ["/a/game.tw-pddl", "/b/game.tw-pddl", "/c/game.tw-pddl"])
        self.assertEqual(num_games, 3)
        self.assertIs(env, shell)

    def test_an_injected_shell_needs_neither_the_config_nor_the_yaml_parser(self):
        # This test exists because its absence was a CI failure: `build_env` read `config.yaml` for every caller,
        # so a test that only wants the sort needed `pyyaml`, which the workflow's unit job does not install. It
        # passed here and failed there -- in the file whose job is to describe the environment.
        shell = self.Shell(None)
        original = sys.modules.get("yaml", "missing")
        sys.modules["yaml"] = None
        try:
            env, _num_games = floor.build_env(shell_factory=lambda config, train_eval="": shell)
        finally:
            if original == "missing":
                sys.modules.pop("yaml", None)
            else:
                sys.modules["yaml"] = original
        self.assertIs(env, shell)

    def test_four_shards_tile_the_split_without_overlapping(self):
        games = [f"/g{index:03d}/game.tw-pddl" for index in range(134)]
        slices = [games[slice(*agent.shard_bounds(f"{index}/4", len(games)))] for index in range(4)]
        self.assertEqual(sum(len(part) for part in slices), len(games))
        for first in range(4):
            for second in range(first + 1, 4):
                with self.subTest(first=first, second=second):
                    self.assertEqual(set(slices[first]) & set(slices[second]), set())
        self.assertEqual(sorted(game for part in slices for game in part), games)


class GateTest(unittest.TestCase):
    """The read-time overlap gate, which is the one repair a 2026 paper names rather than implies.

    `arXiv:2610.07311` (Appendix R166) finds that memory which is correctly stored and correctly retrieved still
    distorts inference when only *part* of its evidence transfers, and that the harm peaks at **intermediate**
    query-memory overlap. A lexical anchor has no notion of intermediate: it ranks by the count of shared content
    words and keeps the top `k`, so a rule sharing one word with a long observation is admitted exactly as a rule
    sharing five. The gate is the missing half of that decision — a floor on the share of the observation's own
    words that the rule must account for.
    """

    def setUp(self):
        # Four content words, so a share is quartiles: one word is 25%, two are 50%.
        self.observation = "You are in the middle of a kitchen. You see a fridge 1 and a countertop 1."
        self.words = agent.words_of(self.observation) - agent.STOPWORDS

    def test_a_floor_of_zero_is_the_registered_arm_and_admits_a_single_word(self):
        self.assertEqual(agent.anchor(self.observation, ["the fridge is cold"], 3, 0.0), ["the fridge is cold"])

    def test_a_floor_above_the_overlap_drops_the_rule(self):
        # `cold` is not in the observation at all, and `fridge` is one word: 1/len(words) is below half.
        self.assertEqual(agent.anchor(self.observation, ["the fridge is cold"], 3, 1.0), [])

    def test_the_floor_is_a_share_of_the_observation_and_not_a_count(self):
        # A long observation divided by a fixed count makes every rule look irrelevant; a share does not, because
        # it is the observation's own length that sets the denominator.
        long_observation = " ".join([self.observation, "There is also a table 1, a chair 1, a sink 1, a mug 1."])
        rule = "put the mug in the sink"
        self.assertTrue(agent.anchor(long_observation, [rule], 3, 0.0))
        # Two of the long observation's words against a share of 1.0 is still short of the whole observation.
        self.assertEqual(agent.anchor(long_observation, [rule], 3, 1.0), [])

    def test_the_gate_runs_before_the_budget_so_a_gated_arm_may_carry_fewer_entries(self):
        # This is the property that makes a gated arm a treatment rather than a filter on the output: `pack_entries`
        # drops and the prefix shortens, which is visible in the bill.
        #
        # The observation has six content words -- and `1` is one of them, twice, which is a real weakness of a
        # lexical anchor on numbered objects and is left visible rather than papered over: a rule mentioning
        # `countertop 1` scores two words for free. The floor here is 2/6, so a single shared word fails and a
        # shared word plus a number passes.
        entries = ["the fridge is cold", "open the fridge 1", "the countertop 1 is here"]
        self.assertEqual(len(agent.anchor(self.observation, entries, 3, 0.0)), 3)
        self.assertEqual(
            agent.anchor(self.observation, entries, 3, 0.2),
            ["open the fridge 1", "the countertop 1 is here"],
        )
        # And the budget is still the budget: one entry means the best of the admitted ones.
        self.assertEqual(agent.anchor(self.observation, entries, 1, 0.2), ["open the fridge 1"])

    def test_a_gated_arm_whose_gate_admits_nothing_carries_nothing(self):
        self.assertEqual(agent.anchor(self.observation, ["a rule about gardens"], 3, 0.5), [])

    def test_an_empty_observation_or_an_empty_bank_is_still_empty(self):
        self.assertEqual(agent.anchor("", ["the fridge is cold"], 3, 0.5), [])
        self.assertEqual(agent.anchor(self.observation, [], 3, 0.5), [])

    def test_a_real_room_description_cannot_clear_the_registered_floor_at_all(self):
        """R174.2's void, stated as arithmetic rather than as a story about a gate that did not help.

        The registered gate asks for a rule that accounts for 0.2 of the observation's own content words. A
        real first observation is a list of objects — 22 content words, every one of them a noun in the room —
        and the bank's rules are about actions. The largest overlap available against this observation is
        **one word**, and one of the three matches is `task`, from the prompt's own `Your task is to:` line.
        So the floor is 5 words and the corpus's ceiling is 1: the gated arm carried zero entries in 134 of 134
        games, and its 81/134 is an empty pack's score rather than a gate's.

        The unit tests above did not see this because their observation is four words long, where 0.2 is a
        single shared word. That is the hazard of a fixture that decides the finding: a threshold whose
        reachability depends on the length of the text it is measured against is a threshold that has to be
        tested against the corpus's own text, not against a sentence written to make it reachable.
        """
        observation = (
            "You are in the middle of a room. Looking quickly around you, you see a cabinet 4, a cabinet 3, "
            "a cabinet 2, a cabinet 1, a countertop 1, a garbagecan 1, a handtowelholder 2, a handtowelholder 1, "
            "a sinkbasin 2, a sinkbasin 1, a toilet 1, a toiletpaperhanger 1, and a towelholder 1.\n"
            "Your task is to: put some spraybottle on toilet."
        )
        bank = [
            "If you encounter a desklamp before finding the target object, you may turn it on first.",
            "After taking an object, verify it is actually in your inventory before placing it.",
            'If a "put" action repeatedly fails, try the alternative phrasing "move <object> to <receptacle>".',
        ]
        tokens = agent.words_of(observation) - agent.STOPWORDS
        ceiling = max(len(tokens & (agent.words_of(rule) - agent.STOPWORDS)) for rule in bank)
        self.assertEqual(ceiling, 1)
        self.assertGreater(0.2 * len(tokens), ceiling)
        # Ungated admits on any overlap at all — here exactly one rule, the one whose text contains `put`, the
        # word the task line supplied — so the arm looks like a working retriever. The floor admits nothing, so
        # the arm it labels is `none` with a longer prompt.
        self.assertEqual(len(agent.anchor(observation, bank, 3, 0.0)), 1)
        self.assertEqual(agent.anchor(observation, bank, 3, 0.2), [])


class KindGateTest(unittest.TestCase):
    """The gate that replaces the overlap floor: select by what the game asks for, not by what the room holds.

    R174.2 measured the overlap gate admitting nothing on this corpus, and the reason is structural rather
    than a matter of a threshold — an observation names objects and the task line names a verb, so no rule
    can account for a fifth of it. What the harness *does* know, before the first call and for free, is the
    game's own task kind (`task_kind_of` reads it out of the gamefile's directory). A bank that tags each
    sentence with the kinds it was written for can then carry one sentence per game, which is the product
    shape: a store wide enough to cover the corpus and a pack narrow enough to be worth carrying.
    """

    RULES = ["check inventory after take", "open the container first", "turn the lamp on"]
    KINDS = [["put", "puttwo"], ["heat", "cool"], []]

    def test_an_entry_without_a_kind_is_carried_everywhere(self):
        self.assertIn("turn the lamp on", agent.applicable(self.RULES, self.KINDS, "cool"))

    def test_only_the_games_own_kind_is_carried(self):
        self.assertEqual(
            agent.applicable(self.RULES, self.KINDS, "put"),
            ["check inventory after take", "turn the lamp on"],
        )

    def test_the_bank_order_is_kept_rather_than_the_kinds_order(self):
        # The pack is rendered in bank order, and a selection that reordered it would change the block's text
        # while claiming to change only which entries are in it.
        self.assertEqual(agent.applicable(self.RULES, self.KINDS, "heat")[0], "open the container first")

    def test_a_bank_without_kinds_is_every_entry_everywhere(self):
        # Every artefact before this one carries an untagged bank, so the knob has to be inert without tags:
        # a filter that read a missing field as "matches nothing" would turn every earlier arm into `none`.
        self.assertEqual(agent.applicable(self.RULES, None, "put"), self.RULES)

    def test_a_kinds_list_that_does_not_match_the_bank_is_refused(self):
        # The failure this guards is the cap: `rules[:cap]` without `kinds[:cap]` leaves every tag one rule
        # out of place, and the arm then carries the sentence it believes it dropped. Silently zipping a
        # short list would do the same thing more quietly.
        with self.assertRaises(SystemExit) as caught:
            agent.applicable(self.RULES, self.KINDS[:2], "put")
        self.assertEqual(caught.exception.code, 1)

    def test_a_kind_no_rule_claims_carries_only_the_untagged_ones(self):
        self.assertEqual(agent.applicable(self.RULES, self.KINDS, "examine"), ["turn the lamp on"])

    def test_an_empty_bank_is_empty(self):
        self.assertEqual(agent.applicable([], [], "put"), [])


class BankLoadTest(unittest.TestCase):
    """Reading a bank as rules *and* tags, because the two have to be cut by the cap together."""

    def write(self, payload: dict) -> Path:
        path = HERE / "bank-kinds-under-test.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_an_untagged_bank_loads_with_an_empty_tag_for_every_rule(self):
        path = self.write({"entries": [{"text": "one"}, {"text": "two"}]})
        self.assertEqual(agent.load_bank(path), (["one", "two"], [[], []]))

    def test_the_cap_cuts_the_tags_with_the_rules(self):
        path = self.write(
            {"cap": 2, "entries": [{"text": "one", "kinds": ["put"]}, {"text": "two"}, {"text": "three", "kinds": ["heat"]}]}
        )
        rules, kinds = agent.load_bank(path)
        self.assertEqual(rules, ["one", "two"])
        self.assertEqual(kinds, [["put"], []])

    def test_a_plain_string_entry_is_a_rule_with_no_tags(self):
        path = self.write({"entries": ["one", {"text": "two", "kinds": ["cool"]}]})
        self.assertEqual(agent.load_bank(path), (["one", "two"], [[], ["cool"]]))


class KindGatePackTest(unittest.TestCase):
    """The knob as the pass uses it: which entries reach the prompt, and what the label says afterwards."""

    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()  # the fake game is a `put` task

    def drive(self, **overrides):
        arguments = {
            "arm": "always-in",
            "policy": "first",
            "examples": self.examples,
            "rules": ["check inventory after take", "open the container first"],
            "rule_kinds": [["put"], ["heat"]],
            "draw": agent.Draw(7),
            "max_steps": 50,
            "top_k": 3,
            "model": "deepseek-flash",
            "api_key": "",
            "timeout": 1.0,
        }
        arguments.update(overrides)
        return agent.run_episode(self.world, **arguments)

    def test_the_kind_gate_carries_only_the_games_own_sentence(self):
        self.assertEqual(self.drive()["pack_entries"], 2)
        gated = self.drive(gate_kind=True)
        self.assertEqual(gated["pack_entries"], 1)
        self.assertEqual(gated["task_kind"], "put")

    def test_the_kind_gate_shortens_the_prefix_it_carries(self):
        # The bill is the second witness: a gate that changed `pack_entries` and not the prompt would be a
        # counter that stopped describing the block.
        self.assertLess(self.drive(gate_kind=True)["prefix_chars"], self.drive()["prefix_chars"])

    def test_the_kind_gate_also_filters_what_retrieval_may_choose_from(self):
        # Retrieval anchored on the observation admitted three rules in R173; a kind gate in front of it makes
        # the pool the game's own sentences, which is the composition the product needs.
        retrieved = self.drive(
            arm="retrieved",
            gate_kind=True,
            rules=["check inventory after take", "open the container first"],
            rule_kinds=[[], []],
        )
        self.assertEqual(retrieved["pack_entries"], 0)
        mixed = self.drive(
            arm="retrieved",
            gate_kind=True,
            rules=["check inventory after take", "open the container first"],
            rule_kinds=[["put"], ["heat"]],
        )
        self.assertLessEqual(mixed["pack_entries"], 1)

    def test_the_kind_gate_is_off_by_default(self):
        self.assertEqual(self.drive()["pack_entries"], 2)


class LabelTest(unittest.TestCase):
    """Two treatments must not share a name, or the reading cannot pair them.

    `retrieved` at the registered k=3 and `retrieved` at AMD's k=1 are different arms; so are the ungated and the
    gated one. Their artefacts carry `arm=retrieved` either way, and a sweep that dispatched both would leave
    `aggregate.py` grouping two treatments into one -- which it refuses as doubled games, after the money is spent.
    """

    def test_the_registered_arms_keep_the_names_they_have_always_had(self):
        self.assertEqual(agent.arm_label("none", 3, 0.0), "none")
        self.assertEqual(agent.arm_label("always-in", 3, 0.0), "always-in")
        self.assertEqual(agent.arm_label("sham", 3, 0.0), "sham")
        self.assertEqual(agent.arm_label("retrieved", 3, 0.0), "retrieved")

    def test_a_moved_budget_is_in_the_name(self):
        self.assertEqual(agent.arm_label("retrieved", 1, 0.0), "retrieved@k1")
        self.assertEqual(agent.arm_label("retrieved", 5, 0.0), "retrieved@k5")

    def test_a_moved_gate_is_in_the_name(self):
        self.assertEqual(agent.arm_label("retrieved", 3, 0.2), "retrieved@g0.2")

    def test_both_moved_are_both_in_the_name_in_a_fixed_order(self):
        self.assertEqual(agent.arm_label("retrieved", 1, 0.2), "retrieved@k1+g0.2")

    def test_the_defaults_are_one_constant_rather_than_three_literals(self):
        # The label and the argument's default have to agree, or the registered arm stops being registered.
        self.assertEqual(agent.DEFAULT_TOP_K, 3)

    def test_a_second_parser_channel_has_a_label_of_its_own(self):
        # The channel is a knob the same way the retrieval budget is, and for the same reason: two channels of one
        # arm are two harnesses, and `aggregate.py` would refuse the join as doubled games after both were paid for.
        # `any-line` is spelled `anyline` inside the label because the label is a token, not a sentence.
        self.assertEqual(agent.arm_label("always-in", 3, 0.0, False, "any-line"), "always-in@anyline")
        self.assertEqual(agent.arm_label("none", 3, 0.0, False, "any-line"), "none@anyline")
        self.assertEqual(agent.arm_label("retrieved", 1, 0.2, True, "any-line"), "retrieved@k1+g0.2+kind+anyline")

    def test_the_reference_channel_leaves_every_registered_label_alone(self):
        # Every artefact before R183 drove the reference channel, so a label that appeared only when a knob moved is
        # what keeps them comparable to the ones that come after it.
        self.assertEqual(agent.arm_label("always-in", 3, 0.0, False, agent.REFERENCE_PARSER), "always-in")
        self.assertEqual(agent.arm_label("none", 3, 0.0, False, agent.REFERENCE_PARSER), "none")

    def test_a_kind_gated_pack_arm_has_a_label_of_its_own(self):
        # Without this the six-sentence gated arm and the six-sentence ungated one are both `always-in`, and
        # `aggregate.py` would refuse the join as doubled games after both were paid for.
        self.assertEqual(agent.arm_label("always-in", 3, 0.0, True), "always-in@kind")
        self.assertEqual(agent.arm_label("sham", 3, 0.0, True), "sham@kind")
        self.assertEqual(agent.arm_label("retrieved", 3, 0.0, True), "retrieved@kind")
        self.assertEqual(agent.arm_label("retrieved", 1, 0.0, True), "retrieved@k1+kind")
        self.assertEqual(agent.arm_label("retrieved", 1, 0.2, True), "retrieved@k1+g0.2+kind")

    def test_the_kind_knob_does_not_rename_the_registered_arms(self):
        for arm in ("none", "always-in", "sham", "retrieved"):
            with self.subTest(arm=arm):
                self.assertEqual(agent.arm_label(arm, 3, 0.0, False), arm)


class TransientTest(unittest.TestCase):
    """The classification table the retry policy is: an error is retried iff it can plausibly be the network.

    Tested directly rather than through sockets, because the table is the whole decision and a socket can only
    exercise one row of it per test. The two rows that matter are the ones the failed run fell through:
    `RemoteDisconnected` is an `OSError`, not a `URLError`, so an `except urllib.error.URLError` clause never saw
    it -- the driver's own handler was bypassed and a traceback ended a four-hour job.
    """

    def test_a_connection_closed_before_a_response_is_transient(self):
        self.assertTrue(agent.transient(http.client.RemoteDisconnected("Remote end closed connection without response")))

    def test_a_body_cut_short_is_transient(self):
        self.assertTrue(agent.transient(http.client.IncompleteRead(b"{\"choices\":", 40)))

    def test_a_refused_connection_is_transient(self):
        self.assertTrue(agent.transient(urllib.error.URLError(ConnectionRefusedError(111, "Connection refused"))))

    def test_a_timeout_is_transient(self):
        self.assertTrue(agent.transient(TimeoutError("timed out")))

    def test_a_server_side_status_is_transient(self):
        for status in (408, 429, 500, 502, 503, 504):
            with self.subTest(status=status):
                self.assertTrue(agent.transient(urllib.error.HTTPError("http://x", status, "no", {}, None)))

    def test_a_client_side_status_is_not_transient(self):
        # 400 is the endpoint telling this driver its request is wrong. Retrying it spends four attempts on a
        # fact that will not change, and a lane that retried it would report a broken key as a broken network.
        for status in (400, 401, 403, 404, 422):
            with self.subTest(status=status):
                self.assertFalse(agent.transient(urllib.error.HTTPError("http://x", status, "no", {}, None)))

    def test_a_reply_that_is_not_a_reply_is_not_transient(self):
        # The payload shapes are lane defects: a model returning no text will return no text again.
        self.assertFalse(agent.transient(agent.LaneError("the response carried no text")))


class DroppingHandler(BaseHTTPRequestHandler):
    """An endpoint that hangs up without answering, `drops` times, and then behaves.

    A real socket rather than a stub, because the exception being classified is raised by `http.client` on a
    closed connection and a stub would have raised the exception the test author expected instead of the one
    the runtime produces.
    """

    drops = 0
    busy = 0
    seen = 0

    def do_POST(self):
        DroppingHandler.seen += 1
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/refuse":
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if DroppingHandler.busy > 0:
            DroppingHandler.busy -= 1
            self.send_response(429)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if DroppingHandler.drops > 0:
            DroppingHandler.drops -= 1
            self.close_connection = True
            return
        encoded = json.dumps(
            {
                "choices": [{"message": {"content": "> go to cabinet 1"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3, "prompt_cache_hit_tokens": 10, "prompt_cache_miss_tokens": 2},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args):
        return


class RetryTest(unittest.TestCase):
    """A dropped connection is retried, and the retries are counted rather than swallowed."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), DroppingHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        DroppingHandler.drops = 0
        DroppingHandler.busy = 0
        DroppingHandler.seen = 0
        self.slept = []

    def url(self):
        return f"http://127.0.0.1:{self.port}/ok"

    def messages(self):
        return [{"role": "user", "content": "u"}]

    def call(self, **overrides):
        options = {
            "attempts": 5,
            "sleep": lambda seconds: self.slept.append(seconds),
        }
        options.update(overrides)
        return agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url(), **options)

    def test_a_dropped_connection_costs_one_retry_and_the_pass_continues(self):
        DroppingHandler.drops = 1
        reply, usage, retries = self.call()
        self.assertEqual(reply, "> go to cabinet 1")
        self.assertEqual(retries, 1)
        self.assertEqual(DroppingHandler.seen, 2)
        self.assertEqual(self.slept, [agent.RETRY_SECONDS[0]])
        # The usage is the answering response's, not a sum over attempts: a dropped attempt returned nothing
        # and a run that counted it would bill a request the provider never served.
        self.assertEqual(agent.usage_numbers(usage)["prompt_tokens"], 12)

    def test_an_endpoint_that_never_answers_fails_on_the_last_attempt_and_names_the_cause(self):
        DroppingHandler.drops = 99
        with self.assertRaises(agent.LaneError) as caught:
            self.call()
        self.assertIn("5 attempts", str(caught.exception))
        self.assertIn("RemoteDisconnected", str(caught.exception))
        self.assertEqual(DroppingHandler.seen, 5)
        self.assertEqual(self.slept, list(agent.RETRY_SECONDS[:4]))

    def test_a_rate_limit_is_retried_rather_than_reported_as_a_lane_defect(self):
        DroppingHandler.busy = 2
        reply, _usage, retries = self.call()
        self.assertEqual(reply, "> go to cabinet 1")
        self.assertEqual(retries, 2)

    def test_a_bad_request_is_not_retried(self):
        # 400 from the endpoint: one attempt, no sleep, and the status in the message.
        with self.assertRaises(agent.LaneError) as caught:
            agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=f"http://127.0.0.1:{self.port}/refuse", sleep=lambda s: None)
        self.assertEqual(self.slept, [])

    def test_the_backoff_is_the_documented_one(self):
        # Written as a test because it is a cost: five attempts at 1+2+4+8 seconds is 15 seconds of a four-hour
        # job, and a backoff that grew to minutes would have been a different decision, not an implementation
        # detail.
        self.assertEqual(agent.RETRY_SECONDS, (1.0, 2.0, 4.0, 8.0))


class CheckpointTest(unittest.TestCase):
    """A game that has been paid for is never lost to a process that stopped mid-pass.

    The failed run `44685314225` proved the cost of not having this: shard 1 died at game 20 of 35 on a single
    dropped connection, and the twenty games it had already bought -- roughly 1,078 calls -- left no artefact
    behind, because `--out` was written once, at the end.
    """

    def setUp(self):
        self.original_build = agent.build_env
        self.original_chat = agent.chat
        self.out = HERE / "checkpoint.json"
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.served = []
        self.fail_at_call = 0

    def tearDown(self):
        agent.build_env = self.original_build
        agent.chat = self.original_chat
        for path in (self.out, HERE / "checkpoint.json.part"):
            path.unlink(missing_ok=True)

    def world(self, games: int, offset: int = 0):
        """A world whose games are numbered, so that resuming can be asked for the right ones.

        `offset` is the environment's position, not the driver's: the real environment is asked for its next
        game and answers with the one after the last it gave, so a resumed pass that skipped indices must
        still be handed the games those indices name.
        """

        class Counting(FakeWorld):
            resets = []

            def reset(inner):
                Counting.resets.append(inner.gamefile)
                inner.gamefile = (
                    f"json_2.1.1/valid_unseen/pick_and_place_simple-Apple-None-Cabinet-{offset + len(Counting.resets)}"
                    f"/trial_0/game.tw-pddl"
                )
                return FakeWorld.reset(inner)

        Counting.resets = []
        agent.build_env = lambda batch_size=1, train_eval="": (Counting(), games)
        return Counting

    def reply_once(self, messages, model, api_key, timeout, **options):
        """Two calls per episode, and a failure scheduled by call number.

        The replies alternate because a stub that always says `take` is an episode that never ends: the fake
        world keeps accepting the command, refuses it as out of space, and the episode runs to the budget. The
        first draft of this test made exactly that mistake and measured zero completed episodes against a
        schedule that assumed two.
        """
        self.served.append(1)
        if self.fail_at_call and len(self.served) == self.fail_at_call:
            raise agent.LaneError("the model endpoint was unreachable: RemoteDisconnected")
        reply = "> take apple 1 from countertop 1" if len(self.served) % 2 else "> put apple 1 in/on cabinet 1"
        return (
            reply,
            {"prompt_tokens": 100, "completion_tokens": 5, "prompt_cache_hit_tokens": 80, "prompt_cache_miss_tokens": 20},
            0,
        )

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["agent.py"] + argv
        try:
            return agent.main()
        finally:
            sys.argv = original

    def base(self, games=4):
        return ["--policy", "model", "--games", str(games), "--out", str(self.out)]

    def test_a_pass_that_dies_leaves_the_games_it_paid_for(self):
        world = self.world(4)
        agent.chat = self.reply_once
        self.fail_at_call = 5
        with self.assertRaises(agent.LaneError):
            self.run_main(self.base())
        written = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(len(written["episodes"]), 2)
        self.assertTrue(written["summary"]["partial"])
        self.assertEqual(written["summary"]["games_driven"], 2)
        self.assertFalse((HERE / "checkpoint.json.part").exists())

    def test_a_retry_inside_an_episode_is_printed_and_counted(self):
        world = self.world(1)

        def flaky(messages, model, api_key, timeout, **options):
            self.served.append(1)
            reply = "> take apple 1 from countertop 1" if len(self.served) == 1 else "> put apple 1 in/on cabinet 1"
            return reply, {"prompt_tokens": 100, "completion_tokens": 5, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 100}, 1

        agent.chat = flaky
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(self.run_main(self.base(1)), 0)
        # One line per call that needed retrying, and the summary carries the total: the log is the narrative,
        # the artefact is the count.
        self.assertEqual(printed.getvalue().count("the endpoint failed and then answered"), 2)
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["retries"], 2)

    def test_a_sharded_pass_drives_the_games_its_slice_names(self):
        # The batch environment always starts at the first game of its own order, so a slice has to be advanced
        # to rather than handed. Without the advance every shard drove the first 35 games: run `44685314225`
        # produced 105 episodes over 82 distinct games, and the run after it produced four identical slices.
        world = self.world(8)
        agent.chat = self.reply_once
        self.assertEqual(self.run_main(["--policy", "model", "--games", "8", "--shard", "1/4", "--out", str(self.out)]), 0)
        summary = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(summary["summary"]["games_driven"], 2)
        self.assertEqual(
            [episode["gamefile"].split("/")[-3] for episode in summary["episodes"]],
            ["pick_and_place_simple-Apple-None-Cabinet-3", "pick_and_place_simple-Apple-None-Cabinet-4"],
        )

    def test_the_advance_costs_no_calls(self):
        # Advancing resets the environment, and a reset is free: it initialises a world and asks it nothing. An
        # advance that stepped would be 139 games of money spent on games nobody wanted.
        world = self.world(8)
        agent.chat = self.reply_once
        self.assertEqual(self.run_main(["--policy", "model", "--games", "8", "--shard", "3/4", "--out", str(self.out)]), 0)
        # Two games of two calls each, whatever the slice's start.
        self.assertEqual(len(self.served), 4)

    def test_a_resumed_pass_advances_past_the_slice_and_the_checkpoint(self):
        world = self.world(8)
        agent.chat = self.reply_once
        self.fail_at_call = 3
        with self.assertRaises(agent.LaneError):
            self.run_main(["--policy", "model", "--games", "8", "--shard", "2/4", "--out", str(self.out)])
        world = self.world(8, offset=0)
        agent.chat = self.reply_once
        self.fail_at_call = 0
        self.assertEqual(self.run_main(["--policy", "model", "--games", "8", "--shard", "2/4", "--out", str(self.out), "--resume"]), 0)
        summary = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(summary["summary"]["resumed"], 1)
        self.assertEqual(
            [episode["gamefile"].split("/")[-3] for episode in summary["episodes"]],
            [
                "pick_and_place_simple-Apple-None-Cabinet-5",
                "pick_and_place_simple-Apple-None-Cabinet-6",
            ],
        )

    def test_a_resumed_pass_drives_only_what_is_missing_and_bills_the_whole_slice(self):
        world = self.world(4)
        agent.chat = self.reply_once
        self.fail_at_call = 5
        with self.assertRaises(agent.LaneError):
            self.run_main(self.base())
        paid_before = len(self.served)

        world = self.world(4, offset=2)
        agent.chat = self.reply_once
        self.fail_at_call = 0
        self.served = []
        self.assertEqual(self.run_main(self.base() + ["--resume"]), 0)

        written = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(written["summary"]["games_driven"], 4)
        self.assertEqual(written["summary"]["resumed"], 2)
        # The two games already bought are not bought again: the world was reset four times in total, and the
        # resumed pass was the one that reset the last two.
        self.assertEqual(len(written["episodes"]), 4)
        # The bill is the slice's, not the resumption's: 4 games x 2 calls x 100 prompt tokens, and the two
        # games paid for before the failure are counted once each.
        self.assertEqual(written["summary"]["calls"], 8)
        self.assertEqual(written["summary"]["usage"]["prompt_tokens"], 8 * 100)

    def test_a_resume_against_a_different_arm_is_refused(self):
        world = self.world(4)
        agent.chat = self.reply_once
        self.fail_at_call = 5
        with self.assertRaises(agent.LaneError):
            self.run_main(self.base())
        bank = HERE / "checkpoint-bank.json"
        bank.write_text(json.dumps({"entries": ["close the fridge"]}), encoding="utf-8")
        world = self.world(4)
        try:
            with self.assertRaises(SystemExit) as caught:
                self.run_main(self.base() + ["--resume", "--arm", "always-in", "--rules", str(bank)])
            self.assertEqual(caught.exception.code, 1)
        finally:
            bank.unlink(missing_ok=True)

    def test_a_resume_of_a_seed_pass_is_refused(self):
        # The seed policy draws from one stream for the whole slice; resuming would restart the stream at the
        # wrong position, and the games it drove would not be the games the seed names.
        world = self.world(4)
        agent.build_env = lambda batch_size=1, train_eval="": (world(), 4)
        self.assertEqual(self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)]), 0)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out), "--resume"])
        self.assertEqual(caught.exception.code, 1)

    def test_a_resume_against_a_file_with_no_summary_is_refused(self):
        # A bare list of episodes is not a pass: without a header there is nothing to compare the dispatch
        # against, and appending to it would be inventing the half of the file that says what it is.
        self.out.write_text(json.dumps({"episodes": []}), encoding="utf-8")
        self.world(4)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base() + ["--resume"])
        self.assertEqual(caught.exception.code, 1)

    def test_a_resume_against_a_file_longer_than_the_slice_is_refused(self):
        # A hand-edited or concatenated file: the header says two games and the body holds four. The header is
        # what a dispatch is compared against, so this is the check that stops a body from outvoting its own
        # summary when someone has merged two artefacts by hand.
        world = self.world(2)
        agent.chat = self.reply_once
        self.assertEqual(self.run_main(self.base(2)), 0)
        written = json.loads(self.out.read_text(encoding="utf-8"))
        written["episodes"] = written["episodes"] * 2
        self.out.write_text(json.dumps(written), encoding="utf-8")
        world = self.world(2, offset=2)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base(2) + ["--resume"])
        self.assertEqual(caught.exception.code, 1)

    def test_a_resume_without_a_file_is_refused(self):
        self.out.unlink(missing_ok=True)
        self.world(4)
        agent.chat = self.reply_once
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base() + ["--resume"])
        self.assertEqual(caught.exception.code, 1)

    def test_a_completed_pass_resumes_into_nothing_rather_than_into_a_second_pass(self):
        world = self.world(2)
        agent.chat = self.reply_once
        self.assertEqual(self.run_main(["--policy", "model", "--games", "2", "--out", str(self.out)]), 0)
        world = self.world(2)
        self.served = []
        self.assertEqual(self.run_main(self.base(2) + ["--resume"]), 0)
        self.assertEqual(self.served, [])
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["resumed"], 2)

    def test_a_resume_that_asks_for_a_different_slice_is_refused(self):
        # The header is part of what the file means: appending games the original did not ask for while
        # reporting its shard is two passes described as one.
        world = self.world(2)
        agent.chat = self.reply_once
        self.assertEqual(self.run_main(["--policy", "model", "--games", "2", "--out", str(self.out)]), 0)
        world = self.world(4)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base(4) + ["--resume"])
        self.assertEqual(caught.exception.code, 1)

    def test_a_checkpoint_whose_games_are_not_the_prefix_is_refused(self):
        # The advance means a restarted environment is handed the right games, so the old failure -- an environment
        # that began at the beginning -- can no longer produce a duplicate. What can still produce one is a
        # checkpoint whose episode list is not the prefix the environment will produce: a hand-edited file, or a
        # pass whose ordering changed between the two halves because the split was re-downloaded. The guard is kept
        # for that, and reached here by relabelling a real checkpoint's games to the ones the advance will land on.
        world = self.world(4)
        agent.chat = self.reply_once
        self.fail_at_call = 5
        with self.assertRaises(agent.LaneError):
            self.run_main(self.base(4))
        written = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(len(written["episodes"]), 2)
        # Relabelled to the games the *resumption* will produce: the resumed world starts at game 3, its advance
        # consumes two resets, so the first game it drives is the fifth. A checkpoint claiming those is a
        # checkpoint that is not the prefix.
        for offset, episode in enumerate(written["episodes"]):
            # Rebuilt from the recorded path rather than written as a literal: `game_key` resolves the path and
            # keeps whatever of it is not under the data root, so a hand-written relative path names a different
            # game than the one the environment will produce. The first draft of this test passed nothing because
            # of exactly that.
            recorded = Path(episode["gamefile"])
            episode["gamefile"] = str(
                recorded.parent.parent.parent
                / f"pick_and_place_simple-Apple-None-Cabinet-{5 + offset}"
                / recorded.parent.name
                / recorded.name
            )
        self.out.write_text(json.dumps(written), encoding="utf-8")
        world = self.world(4, offset=2)
        agent.chat = self.reply_once
        self.fail_at_call = 0
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base(4) + ["--resume"])
        self.assertEqual(caught.exception.code, 1)



class BankProvenanceTest(unittest.TestCase):
    """An artefact says which pack it rendered, because its length does not.

    R185 swaps the last 197 characters of a 551-character pack and holds the label still. Nothing in the record
    distinguished the two banks: `rules_in_bank` is 1 for both, `pack_chars` is 551 for both, `arm_label` is
    `always-in` for both — so a join of the two runs would have averaged two prompts into one rate and printed it
    under one name, which is the defect R183 found for the reader and R184 for the budget, one harness further in.
    The digest is content, not a filename: the same sentence loaded twice is the same bank, and two banks that
    render to the same length are not.
    """

    def setUp(self):
        self.original_build = agent.build_env
        self.world = FakeWorld()
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (self.world, 1)
        self.out = HERE / "bank-provenance.json"
        self.banks = []

    def tearDown(self):
        agent.build_env = self.original_build
        self.out.unlink(missing_ok=True)
        for path in self.banks:
            path.unlink(missing_ok=True)

    def bank(self, name: str, text: str) -> Path:
        path = HERE / name
        path.write_text(json.dumps({"entries": [{"text": text}]}), encoding="utf-8")
        self.banks.append(path)
        return path

    def bank_with_kinds(self, name: str, entries: "list[tuple[str, list[str]]]") -> Path:
        path = HERE / name
        payload = {"entries": [{"text": text, "kinds": kinds} for text, kinds in entries]}
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.banks.append(path)
        return path

    def digest_of_bank(self, path: Path) -> str:
        self.assertEqual(
            self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(path), "--out", str(self.out)]),
            0,
        )
        return self.artefact()["summary"]["bank_digest"]

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["agent.py"] + argv
        try:
            return agent.main()
        finally:
            sys.argv = original

    def artefact(self):
        return json.loads(self.out.read_text(encoding="utf-8"))

    def test_the_pass_records_the_pack_it_rendered(self):
        text = "Open the fridge before taking anything out of it."
        bank = self.bank("bank-provenance-a.json", text)
        self.assertEqual(self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(bank), "--out", str(self.out)]), 0)
        payload = self.artefact()
        self.assertEqual(payload["summary"]["bank_digest"], agent.bank_digest_of([text], [[]]))
        self.assertEqual(payload["episodes"][0]["pack_digest"], agent.digest_of([text]))

    def test_two_banks_that_render_to_the_same_length_are_two_banks(self):
        # The exact pair R185 uses: 157 characters held, 197 swapped. Same price, different prompt.
        source = payload_of("bank-putmove-line-1.json")["entries"][0]["text"]
        swapped = source[:157] + source[157:].replace("own line", "own rows", 1)
        self.assertNotEqual(source, swapped)
        self.assertEqual(len(source), len(swapped))
        first = self.bank("bank-provenance-b.json", source)
        second = self.bank("bank-provenance-c.json", swapped)
        self.assertEqual(self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(first), "--out", str(self.out)]), 0)
        left = self.artefact()["summary"]["bank_digest"]
        self.assertEqual(self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(second), "--out", str(self.out)]), 0)
        right = self.artefact()["summary"]["bank_digest"]
        self.assertNotEqual(left, right)

    def test_the_same_sentence_loaded_twice_is_one_bank(self):
        text = "Open the drawer before taking the pencil."
        first = self.bank("bank-provenance-d.json", text)
        second = self.bank("bank-provenance-e.json", text)
        self.assertEqual(self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(first), "--out", str(self.out)]), 0)
        left = self.artefact()["summary"]["bank_digest"]
        self.assertEqual(self.run_main(["--arm", "always-in", "--policy", "first", "--games", "1", "--rules", str(second), "--out", str(self.out)]), 0)
        self.assertEqual(left, self.artefact()["summary"]["bank_digest"])

    def test_two_banks_with_the_same_sentences_and_different_tags_are_two_banks(self):
        # R187's pair, and the one case the digest could not see: `bank-putscope-2` and `bank-putscope-3` hold the
        # same two 354-character sentences and differ only in which kinds each is tagged for. The digest hashed the
        # text, so the round that moved the boundary recorded the same `bank_digest` as the round it was measured
        # against, and the guard that refuses a label spanning two banks could not have noticed (AUDIT 34.269).
        source = payload_of("bank-putmove-line-1.json")["entries"][0]["text"]
        precondition = payload_of("bank-putprecond-1.json")["entries"][0]["text"]
        wide = self.bank_with_kinds(
            "bank-provenance-k1.json",
            [(source, ["clean", "cool", "examine", "heat", "puttwo"]), (precondition, ["put"])],
        )
        narrow = self.bank_with_kinds(
            "bank-provenance-k2.json",
            [(source, ["clean", "examine"]), (precondition, ["put", "cool", "heat", "puttwo"])],
        )
        self.assertNotEqual(self.digest_of_bank(wide), self.digest_of_bank(narrow))

    def test_the_same_tags_are_one_bank_whatever_order_they_are_written_in(self):
        # A tag list is a set. Two banks that select the same entries for the same kinds are one treatment, and a
        # digest that changed when somebody re-ordered a list would report a re-registration as a new arm.
        text = payload_of("bank-putprecond-1.json")["entries"][0]["text"]
        first = self.bank_with_kinds("bank-provenance-k3.json", [(text, ["put", "cool"])])
        second = self.bank_with_kinds("bank-provenance-k4.json", [(text, ["cool", "put"])])
        self.assertEqual(self.digest_of_bank(first), self.digest_of_bank(second))

    def test_a_tagged_sentence_is_not_the_same_bank_as_an_untagged_one(self):
        # The other half of the same distinction, and the one a reader is most likely to meet: the same sentence
        # carried everywhere and carried only by `put` are two treatments with one text.
        text = payload_of("bank-putprecond-1.json")["entries"][0]["text"]
        untagged = self.bank("bank-provenance-k5.json", text)
        tagged = self.bank_with_kinds("bank-provenance-k6.json", [(text, ["put"])])
        self.assertNotEqual(self.digest_of_bank(untagged), self.digest_of_bank(tagged))

    def test_the_control_records_no_bank_because_it_renders_none(self):
        # The empty pack is not a bank, and a control that carried a digest would make every treatment-versus-control
        # join look like a comparison of two prompts.
        self.assertEqual(self.run_main(["--arm", "none", "--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        payload = self.artefact()
        self.assertEqual(payload["summary"]["bank_digest"], "")
        self.assertEqual(payload["episodes"][0]["pack_digest"], "")

    def test_a_tag_list_that_does_not_line_up_with_the_rules_is_refused(self):
        # The digest pairs each rule with its tags, so a list that is one short would silently digest the last rule with
        # no tags at all -- a bank whose `put` entry had lost its claim and whose digest still looked like a bank's.
        with self.assertRaises(SystemExit):
            agent.bank_digest_of(["take the apple", "put it in the cabinet"], [["put"]])


class CommandGuardTest(unittest.TestCase):
    """The guard at the state: one changed answer for the turn that carried no command.

    R188 spent 3.03 CNY to show that a bank entry can only be a constant in front of every turn, and that the loop it
    was aimed at is a rare *state* inside one: the five games that lost to rumination in R186 were won 4 of 5 and 5 of
    5 when re-run. A constant cannot reach a state, so the next lever is the one the driver already owns -- the string
    it answers a commandless reply with. The guard changes that string and nothing else, which is what makes it
    measurable: it is a function of the state the episode is in, so it cannot fire in a game that never enters it, and
    `guard_fires` is in every episode so a join can prove engagement rather than assume it.

    Three counters and one flag, because a guard arm with zero fires is a no-op wearing a treatment's name (R174.2):
    `guard_fires` counts the line sent, `guard_checked` counts the fires a later reply answered, and `guard_relapsed`
    counts the ones where that reply carried no command either -- a model that re-enters the loop at once is a guard
    that slowed the loss rather than a recovered turn.
    """

    def setUp(self):
        self.examples = agent.load_examples()
        self.world = FakeWorld()
        self.original = agent.chat

    def tearDown(self):
        agent.chat = self.original

    def drive(self, replies, guard=False, parser="any-line", world=None, max_steps=50):
        seen = []
        script = list(replies)

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return script.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        episode = agent.run_episode(
            world or FakeWorld(), "none", "model", self.examples, [], agent.Draw(1),
            max_steps if max_steps is not None else len(replies), 3,
            "deepseek-flash", "k", 1.0, parser=parser, guard_commandless=guard,
        )
        return episode, seen

    def test_the_guard_s_line_asks_for_one_command_and_is_one_line(self):
        # A string a model can count on: one line, so it is answered the way `OK.` was answered, and it names the
        # requirement rather than describing it. A two-line answer would have been a second observation's worth of
        # prompt on every loop turn, which is the cost the round is trying not to pay.
        self.assertEqual(agent.COMMAND_GUARD, "OK. Reply with one command only.")
        self.assertNotIn("\n", agent.COMMAND_GUARD)
        self.assertTrue(agent.COMMAND_GUARD.startswith("OK."))

    def test_the_guard_answers_a_commandless_turn_and_the_unguarded_arm_does_not(self):
        replies = ["> think: I need the apple", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        guarded, guarded_seen = self.drive(replies, guard=True)
        plain, plain_seen = self.drive(replies, guard=False)
        self.assertEqual(guarded_seen[1][-1], agent.COMMAND_GUARD)
        self.assertEqual(plain_seen[1][-1], "OK.")
        # The only difference the guard is allowed to make to the turn count, the score or the pack: none.
        self.assertTrue(guarded["won"])
        self.assertTrue(plain["won"])
        self.assertEqual(guarded["steps"], plain["steps"])
        self.assertEqual(guarded["calls"], plain["calls"])
        self.assertEqual(guarded["pack_entries"], plain["pack_entries"])

    def test_the_guard_does_not_answer_a_refused_command_because_the_command_did_reach_the_driver(self):
        # AUDIT 34.259: a reply whose first line is a thought and whose later line is a command is refused on the
        # reference channel, and the answer has to say the world did not move. The guard is about the turn that carried
        # *no* command, so it must leave that answer alone -- otherwise the repair for rumination would undo the repair
        # for the format, on the same string.
        episode, seen = self.drive(
            [
                "> think: I need the apple\n> take apple 1 from countertop 1",
                "> take apple 1 from countertop 1",
                "> put apple 1 in/on cabinet 1",
            ],
            guard=True,
            parser="reference",
        )
        self.assertEqual(seen[1][-1], agent.NO_OP)
        self.assertEqual(episode["guard_fires"], 0)
        self.assertEqual(episode["refused_actions"], 1)

    def test_every_fire_and_every_immediate_relapse_is_counted(self):
        # Two fires, one relapse: the second thought answered a firing, and it carried no command either. The third
        # reply is the action, so the second fire was answered. A count that only had `fires` could not tell this game
        # from one where the guard recovered the model at once.
        episode, _seen = self.drive(
            ["> think: one", "> think: two", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            guard=True,
        )
        self.assertEqual(episode["guard_fires"], 2)
        self.assertEqual(episode["guard_checked"], 2)
        self.assertEqual(episode["guard_relapsed"], 1)
        self.assertTrue(episode["guard"])
        self.assertTrue(episode["won"])

    def test_the_unguarded_arm_records_the_guard_as_off_rather_than_absent(self):
        # A field that is missing from one arm and zero in the other is a join that cannot tell "did not fire" from
        # "was never armed" -- which is the ambiguity `refused_actions` had to be read with for two rounds.
        episode, seen = self.drive(["> think: one", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        self.assertFalse(episode["guard"])
        self.assertEqual(episode["guard_fires"], 0)
        self.assertEqual(episode["guard_checked"], 0)
        self.assertEqual(episode["guard_relapsed"], 0)
        self.assertEqual(seen[1][-1], "OK.")

    def test_the_guard_costs_under_two_percent_of_the_prompt_per_turn(self):
        # Registered reading 5, as arithmetic rather than as a hope: the line is 25 characters longer than `OK.`, it is
        # repeated once per loop turn, and every repeat also lengthens the transcript the next call carries. The
        # comparison is per turn, because the two arms' prompts differ in length by construction.
        replies = ["> think: a", "> think: b", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        guarded, _ = self.drive(replies, guard=True)
        plain, _ = self.drive(replies, guard=False)
        guarded_turn = guarded["prompt_chars"] / guarded["steps"]
        plain_turn = plain["prompt_chars"] / plain["steps"]
        self.assertGreater(guarded_turn, plain_turn)
        self.assertLess((guarded_turn - plain_turn) / plain_turn, 0.02)
        self.assertEqual(guarded["steps"], 4)

    def test_a_fire_on_the_last_turn_is_not_counted_as_checked(self):
        # The budget can run out on the turn the guard answered. There is no later reply to read, so the fire is
        # unchecked rather than relapsed: counting it either way would invent an outcome for a turn that never came.
        episode, _seen = self.drive(["> think: one", "> think: two"], guard=True, max_steps=2)
        self.assertEqual(episode["guard_fires"], 2)
        self.assertEqual(episode["guard_checked"], 1)
        self.assertEqual(episode["guard_relapsed"], 1)
        self.assertTrue(episode["budget_exhausted"])

    def test_the_label_carries_the_guard_so_two_states_cannot_be_pooled(self):
        # Same family, same bank, same channel: the two arms of R189 differ by this token and by nothing else. Without
        # it, `aggregate.py` would group both dispatches under the same label and refuse the doubled games only after
        # both were paid for -- the failure the label exists to prevent.
        self.assertEqual(agent.arm_label("always-in", 3, 0.0, True, "any-line", True), "always-in@kind+anyline+guard")
        self.assertEqual(agent.arm_label("always-in", 3, 0.0, True, "any-line", False), "always-in@kind+anyline")
        self.assertEqual(agent.arm_label("none", 3, 0.0, False, "reference", True), "none@guard")

    def test_a_pass_records_the_guard_in_its_header_its_label_and_its_ledger(self):
        # The three places a reader looks before an episode: the label the join groups on, the header field the file
        # is identified by, and the ledger the round's first reading is computed from. A flag that reached only the
        # driver would leave the artefact indistinguishable from an unguarded pass with the same score.
        original_build = agent.build_env
        original_argv = sys.argv
        out = HERE / "guard-under-test.json"
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (FakeWorld(), 1)
        try:
            sys.argv = [
                "agent.py", "--arm", "none", "--policy", "first", "--games", "1",
                "--guard-commandless", "--out", str(out),
            ]
            self.assertEqual(agent.main(), 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
        finally:
            agent.build_env = original_build
            sys.argv = original_argv
            out.unlink(missing_ok=True)
        summary = payload["summary"]
        self.assertTrue(summary["guard_commandless"])
        self.assertEqual(summary["arm_label"], "none@guard")
        # The first policy acts every turn, so the guard had nothing to answer -- and says so, rather than reporting a
        # fire it never sent.
        self.assertEqual(summary["guard_fires"], 0)
        self.assertEqual(summary["guard_relapsed"], 0)
        self.assertFalse(payload["episodes"][0]["guard"] is None)


class StateLedgerTest(unittest.TestCase):
    """The ledger at the state: the turn that moved nothing is answered with what has already been tried.

    R189 removed the narration and lost four games its own control won, all four at the 50-step cap. Those are search
    failures -- the model is at the environment and not finding the object -- and no sentence about the task reaches
    them. What the driver already holds is the episode's own history, so R191's treatment is a renderer: one line, on
    the turns whose command moved nothing, naming the last three commands tried.

    The tests below hold the treatment to three things at once. It has to *fire* (a renderer nobody triggers is a bank
    wearing a flag's name, R174.2); it has to fire only on that state (a line on every turn is R188's inert constant
    with a new name); and it has to leave the world's own measurements alone (an instrument that counted the driver's
    hint as an observation would make two arms' environments differ when the environments are identical).
    """

    def setUp(self):
        self.examples = agent.load_examples()
        self.original = agent.chat

    def tearDown(self):
        agent.chat = self.original

    def drive(self, replies, ledger=True, world=None, parser="any-line", max_steps=50, counts=False):
        seen = []
        script = list(replies)

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return script.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        episode = agent.run_episode(
            world or FakeWorld(nothing_happens=True), "none", "model", self.examples, [], agent.Draw(1), max_steps, 3,
            "deepseek-flash", "k", 1.0, parser=parser, state_ledger=ledger, ledger_counts=counts,
        )
        return episode, seen

    def test_the_line_names_the_last_three_commands_in_the_order_they_were_tried(self):
        # Order is the content: a set of three commands says what has been tried, a sequence says what the episode has
        # just been doing, which is the thing a model stuck on an object needs to see.
        line = agent.ledger_line(
            ["look", "take apple 1 from countertop 1", "go to cabinet 1", "open cabinet 1"]
        )
        self.assertEqual(
            line,
            "Already tried this episode: take apple 1 from countertop 1; go to cabinet 1; open cabinet 1.",
        )
        self.assertNotIn("\n", line)

    def test_a_command_tried_three_times_is_named_once(self):
        # The window is three commands, and three copies of one command is one fact about the state. Collapsing is what
        # makes the line worth its characters on exactly the turns it fires: a model looping on one object writes the
        # same `take`, and the useful answer is that it is the same `take`.
        self.assertEqual(agent.ledger_line(["look", "look", "look", "look"]), "Already tried this episode: look.")
        self.assertEqual(
            agent.ledger_line(["take apple 1", "look", "take apple 1"]),
            "Already tried this episode: look; take apple 1.",
        )

    def test_a_history_with_nothing_in_it_has_no_line(self):
        # A header with nothing after it is prompt paid for a claim with no referent, and the caller then sends the
        # observation alone -- which is the control's turn, exactly.
        self.assertEqual(agent.ledger_line([]), "")
        self.assertEqual(agent.ledger_line(["  ", ""]), "")

    def test_moved_nothing_reads_the_last_line_rather_than_the_whole_observation(self):
        # Textworld sometimes prefixes the answer with the room it happened in. A test for equality would miss every one
        # of those turns and quietly under-count the treatment, which is the failure mode a `fires` counter exists to
        # make impossible.
        self.assertTrue(agent.moved_nothing("Nothing happens."))
        self.assertTrue(agent.moved_nothing("Nothing happens.\n"))
        self.assertTrue(agent.moved_nothing("You are in the kitchen.\nNothing happens."))
        self.assertFalse(agent.moved_nothing("You put the apple 1 in/on the cabinet 1.\n"))
        self.assertFalse(agent.moved_nothing(""))

    def test_a_turn_that_moved_nothing_is_answered_with_the_observation_and_then_the_line(self):
        # `look` is admitted by the world and moves nothing, so this is the admitted-but-inert path. The model hears the
        # world's own text first and the line second: the observation is the fact and the line is the hint, and a hint
        # that came first would read as the world having said it.
        episode, seen = self.drive(["> look", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        self.assertEqual(
            seen[1][-1], "Nothing happens.\nAlready tried this episode: look."
        )
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertEqual(episode["ledger_chars"], len("Already tried this episode: look.") + 1)
        self.assertTrue(episode["won"])

    def test_a_command_the_world_refuses_is_the_same_event(self):
        # The other path: the action is not in this turn's admissible set. It is refused before it moves anything, which
        # is a fact about the action rather than about the observation, and the treatment has to read both or it would
        # fire on `look` and stay silent on the mistake that actually costs a game.
        episode, seen = self.drive(
            ["> take apple 1 from countertop 1", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        )
        self.assertEqual(
            seen[2][-1],
            "Nothing happens.\nAlready tried this episode: take apple 1 from countertop 1.",
        )
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertEqual(episode["invalid_actions"], 1)

    def test_both_paths_in_one_episode_named_once_each(self):
        # A game can walk both: `look` (admitted, inert) and then a second `take` (refused). The window is the last three
        # commands *tried*, so the second line names both -- deduplicated, because the two `take`s are one command.
        episode, seen = self.drive(
            [
                "> look",
                "> take apple 1 from countertop 1",
                "> take apple 1 from countertop 1",
                "> put apple 1 in/on cabinet 1",
            ]
        )
        self.assertEqual(episode["ledger_fires"], 2)
        self.assertEqual(
            seen[3][-1],
            "Nothing happens.\nAlready tried this episode: look; take apple 1 from countertop 1.",
        )

    def test_a_turn_that_moved_something_carries_no_line(self):
        # The control's turn, byte for byte. A treatment that also widened a winning turn would be two changes, and the
        # round could not say which of them the delta was about.
        replies = ["> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        treated, treated_seen = self.drive(replies, ledger=True)
        control, control_seen = self.drive(replies, ledger=False)
        self.assertEqual(treated["ledger_fires"], 0)
        self.assertEqual(treated_seen, control_seen)
        self.assertEqual(treated["prompt_chars"], control["prompt_chars"])

    def test_the_world_s_own_measurements_are_the_same_on_both_arms(self):
        # `observe_chars`, its fingerprint and the action digest are the instrument every earlier round was read with.
        # A ledger that changed them would make the two arms' environments look different when the environments are the
        # same, and the next round's readback would be a readback of the renderer.
        replies = ["> look", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        treated, _ = self.drive(replies, ledger=True)
        control, _ = self.drive(replies, ledger=False)
        for field in ("observe_chars", "observe_fingerprint", "digest", "actions", "invalid_actions", "steps"):
            self.assertEqual(treated[field], control[field], field)
        self.assertEqual(treated["won"], control["won"])

    def test_a_refused_command_is_a_command_that_moved_nothing(self):
        # The reference channel drops the command under a thought and answers `Nothing happens.`. That turn is the same
        # event the ledger exists for, so it gets the same line -- and the refused command joins the history without
        # joining `actions`, because the action digest is a published field that must keep meaning what it meant.
        replies = [
            "> think: I need the apple\n> take apple 1 from countertop 1",
            "> take apple 1 from countertop 1",
            "> put apple 1 in/on cabinet 1",
        ]
        treated, treated_seen = self.drive(replies, ledger=True, parser="reference")
        control, control_seen = self.drive(replies, ledger=False, parser="reference")
        self.assertEqual(
            treated_seen[1][-1],
            "Nothing happens.\nAlready tried this episode: take apple 1 from countertop 1.",
        )
        self.assertEqual(control_seen[1][-1], agent.NO_OP)
        self.assertEqual(treated["refused_actions"], 1)
        self.assertEqual(treated["ledger_fires"], 1)
        self.assertEqual(treated["digest"], control["digest"])
        self.assertEqual(treated["actions"], control["actions"])

    def test_a_line_the_episode_never_reads_is_not_a_fire(self):
        # The `not done` condition. An environment that ends on a no-op answer -- which this fake can produce and
        # textworld cannot -- would otherwise buy a line after the last turn, and a `fires` counter that counted prompt
        # nobody read would report engagement the model never saw.
        class EndsOnNoOp(FakeWorld):
            def step(self, actions):
                observation, scores, _dones, info = super().step(actions)
                return [agent.NO_OP + "\n"], scores, [True], info

        episode, seen = self.drive(["> look"], world=EndsOnNoOp(nothing_happens=True))
        self.assertEqual(episode["ledger_fires"], 0)
        self.assertFalse(any("Already tried" in content for turn in seen for content in turn))

    def test_the_control_records_the_flag_off_and_the_treatment_on(self):
        # Recorded on both arms, for the reason the guard's flag is: a field that is absent from the control cannot be
        # told apart from a control that was never armed (AUDIT 34.259).
        replies = ["> look", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"]
        treated, _ = self.drive(replies)
        control, _ = self.drive(replies, ledger=False)
        self.assertTrue(treated["ledger"])
        self.assertFalse(control["ledger"])
        self.assertEqual(control["ledger_fires"], 0)

    def test_the_label_carries_the_ledger_token_and_nothing_else_moves(self):
        # The label is the join's unit. R191's two arms are one family, one bank, one channel, one cap and one guard, so
        # this token is the whole difference between them and a join that could not read it would pool two treatments.
        self.assertEqual(
            agent.arm_label("always-in", 3, 0.0, False, agent.ANY_LINE_PARSER, True, True),
            "always-in@anyline+guard+ledger",
        )
        self.assertEqual(
            agent.arm_label("always-in", 3, 0.0, False, agent.ANY_LINE_PARSER, True, False),
            "always-in@anyline+guard",
        )
        self.assertEqual(agent.arm_label("none", 3, 0.0), "none")

    def test_the_counted_renderer_names_the_fact_the_collapse_throws_away(self):
        # R193's first half. Three copies of one command is one fact about the state, and the count is the fact: "four
        # times" is shorter than four copies and says what the fourth copy cannot.
        self.assertEqual(
            agent.ledger_line(["look", "look", "look", "look"], counts=True),
            "Already tried this episode: look (4 times).",
        )
        self.assertEqual(
            agent.ledger_line(["take apple 1", "look", "take apple 1"], counts=True),
            "Already tried this episode: look; take apple 1 (2 times).",
        )
        # A command tried once carries no count: `(1 times)` is characters that say nothing.
        self.assertEqual(
            agent.ledger_line(["look", "take apple 1"], counts=True),
            "Already tried this episode: look; take apple 1.",
        )
        # And the list renderer is unchanged, because R191's arm has to stay reproducible from its own flag.
        self.assertEqual(
            agent.ledger_line(["look", "look", "look", "look"]),
            "Already tried this episode: look.",
        )

    def test_the_counted_renderer_is_a_label_of_its_own(self):
        # Two renderers under one token would be two treatments pooled by the join -- the defect every other harness knob
        # is labelled for, one knob later.
        self.assertEqual(
            agent.arm_label("always-in", 3, 0.0, False, agent.ANY_LINE_PARSER, True, True, True),
            "always-in@anyline+guard+ledger-counts",
        )
        self.assertEqual(
            agent.arm_label("always-in", 3, 0.0, False, agent.ANY_LINE_PARSER, True, True, False),
            "always-in@anyline+guard+ledger",
        )

    def test_a_line_whose_window_did_not_change_is_not_sent_again(self):
        # R193's second half, and the repair for the round's own tail (AUDIT 34.279). `look` fails three times in a row,
        # so the window is `("look",)` on all three turns: the first line names it, the next two are answered the way the
        # control answers them. A line that repeats without a change is a constant.
        episode, seen = self.drive(
            ["> look", "> look", "> look", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            counts=True,
        )
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertEqual(episode["ledger_suppressed"], 2)
        # The first line names `look` with no count, because at that moment it had been tried once.
        self.assertEqual(seen[1][-1], "Nothing happens.\nAlready tried this episode: look.")
        # The next two turns carry the observation alone: the window was already reported.
        self.assertEqual(seen[2][-1], agent.NO_OP + "\n")
        self.assertEqual(seen[3][-1], agent.NO_OP + "\n")
        self.assertTrue(episode["won"])

    def test_a_changed_window_earns_a_new_line(self):
        # The gate is about the *window*, not about the fire count: a second, different failure is news and is sent, and
        # the same failure twice more is not. `seen[k]` is the message list before call k+1, so the answer to turn k is
        # the last message of `seen[k + 1]`.
        episode, seen = self.drive(
            ["> look", "> take apple 1 from countertop 1", "> take apple 1 from countertop 1",
             "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
            counts=True,
        )
        self.assertEqual(episode["ledger_fires"], 2)
        self.assertEqual(episode["ledger_suppressed"], 1)
        self.assertEqual(seen[1][-1], "Nothing happens.\nAlready tried this episode: look.")
        # Turn 2 is the second `take`: it moved nothing, the window changed, and the count is on the line.
        self.assertEqual(seen[3][-1],
                         "Nothing happens.\nAlready tried this episode: look; take apple 1 from countertop 1 (2 times).")
        # Turn 3 is the same failure again: no line.
        self.assertEqual(seen[4][-1], agent.NO_OP + "\n")

    def test_the_list_renderer_keeps_sending_every_time(self):
        # The gate belongs to the counted renderer. R191's arm sent a line on every failed turn and its record is read
        # from that behaviour, so the old flag cannot silently start behaving like the new one.
        episode, _seen = self.drive(
            ["> look", "> look", "> look", "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
        )
        self.assertEqual(episode["ledger_fires"], 3)
        self.assertEqual(episode["ledger_suppressed"], 0)
        self.assertFalse(episode["ledger_counts"])

    def test_the_window_is_capped_at_three_however_long_the_history(self):
        # The cap in `ledger_window`. Four distinct failing commands are tried, so the window has to stop at three and the
        # line names the last three in order -- the state, not the log.
        episode, seen = self.drive(
            ["> look", "> inventory", "> go to countertop 1",
             "> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"],
        )
        self.assertEqual(episode["ledger_fires"], 3)
        self.assertEqual(
            seen[3][-1],
            "Nothing happens.\nAlready tried this episode: look; inventory; go to countertop 1.",
        )
        self.assertTrue(episode["won"])

    def test_the_change_gate_also_silences_a_repeated_refusal(self):
        # The same gate on the other side of the parser. A refused command is appended to the history without joining
        # `actions`, so a second identical refusal leaves the window unchanged and earns no line.
        episode, seen = self.drive(
            [
                "> think: I need the apple\n> take apple 1 from countertop 1",
                "> think: I need the apple\n> take apple 1 from countertop 1",
                "> take apple 1 from countertop 1",
                "> put apple 1 in/on cabinet 1",
            ],
            parser="reference",
            counts=True,
        )
        self.assertEqual(episode["refused_actions"], 2)
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertEqual(episode["ledger_suppressed"], 1)
        self.assertEqual(seen[1][-1],
                         "Nothing happens.\nAlready tried this episode: take apple 1 from countertop 1.")
        self.assertEqual(seen[2][-1], agent.NO_OP)

    def test_the_counted_flag_reaches_the_summary_and_the_episodes(self):
        # End to end, and the header's claim held to the episodes by the same field: a pass that recorded the mode in one
        # place and not the other is a file a join cannot grade.
        class StandsStill(FakeWorld):
            def admissible(self):
                return ["look", "inventory"]

        original_build = agent.build_env
        original_argv = sys.argv
        out = HERE / "ledger-counts-under-test.json"
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (
            StandsStill(nothing_happens=True), 1
        )
        try:
            sys.argv = [
                "agent.py", "--arm", "none", "--policy", "first", "--games", "1",
                "--state-ledger-counts", "--out", str(out),
            ]
            self.assertEqual(agent.main(), 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
        finally:
            agent.build_env = original_build
            sys.argv = original_argv
            out.unlink(missing_ok=True)
        summary = payload["summary"]
        self.assertTrue(summary["state_ledger"])
        self.assertTrue(summary["state_ledger_counts"])
        self.assertEqual(summary["arm_label"], "none@ledger-counts")
        # Fifty turns of the same `look`: one line, forty-nine silenced. That is the tail R191 could not close, closed.
        self.assertEqual(summary["ledger_fires"], 1)
        self.assertEqual(summary["ledger_suppressed"], 49)
        self.assertTrue(payload["episodes"][0]["ledger_counts"])

    def test_the_flag_reaches_the_summary_and_the_episodes(self):
        # The same end-to-end shape the guard's test takes: a flag that reached only the driver would leave the artefact
        # indistinguishable from an unarmed pass with the same score. The world here admits only `look`, so the `first`
        # policy stands still for the whole budget and the line is sent on every turn -- which is what makes the
        # summary's count a sum of real fires rather than a zero that would read the same if the field were dropped.
        class StandsStill(FakeWorld):
            def admissible(self):
                return ["look", "inventory"]

        original_build = agent.build_env
        original_argv = sys.argv
        out = HERE / "ledger-under-test.json"
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (
            StandsStill(nothing_happens=True), 1
        )
        try:
            sys.argv = [
                "agent.py", "--arm", "none", "--policy", "first", "--games", "1",
                "--state-ledger", "--out", str(out),
            ]
            self.assertEqual(agent.main(), 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
        finally:
            agent.build_env = original_build
            sys.argv = original_argv
            out.unlink(missing_ok=True)
        summary = payload["summary"]
        self.assertTrue(summary["state_ledger"])
        self.assertEqual(summary["arm_label"], "none@ledger")
        self.assertEqual(summary["ledger_fires"], 50)
        self.assertEqual(summary["ledger_fires"], payload["episodes"][0]["ledger_fires"])
        self.assertGreater(summary["ledger_chars"], 0)
        self.assertTrue(payload["episodes"][0]["ledger"])
        self.assertFalse(payload["episodes"][0]["won"])

class AdmissibleHintTest(unittest.TestCase):
    """R194's instrument and renderer: on a refused command, the world names what *is* admissible.

    AUDIT 34.284 read the two state arms together and found `ledger_fires` equal to `invalid_actions` in all 822 games:
    every line the family ever sent answered a command the world had refused, and the tail games are 42, 35 and 27
    consecutive refused commands. The list of what has been tried is one remove from what would help, so the renderer
    under test names the size of the admissible set and one command in it.

    These tests are written before the renderer exists, and they hold four things: the line's arithmetic (count and
    singular), its selection rule (deterministic, verb first, then the world's own order), its condition (a refused turn
    and nothing else), and the instrument that prices the round (`admissible_mean`, `admissible_max`, `admissible_sample`)
    because the round cannot be registered until the size of the set is known from a pass that cost nothing.
    """

    def setUp(self):
        self.examples = agent.load_examples()
        self.original = agent.chat

    def tearDown(self):
        agent.chat = self.original

    def drive(self, replies, admissible=True, world=None, max_steps=None, parser="any-line"):
        seen = []
        script = list(replies)

        def chat(messages, model, api_key, timeout):
            seen.append([message["content"] for message in messages])
            return script.pop(0), {"prompt_tokens": 10, "completion_tokens": 1}, 0

        agent.chat = chat
        episode = agent.run_episode(
            world or FakeWorld(), "none", "model", self.examples, [], agent.Draw(1),
            len(replies) if max_steps is None else max_steps, 3,
            "deepseek-flash", "k", 1.0, parser=parser, state_admissible=admissible,
        )
        return episode, seen

    def test_the_line_counts_the_set_and_names_one_command(self):
        self.assertEqual(
            agent.admissible_line(7, "take apple 1 from countertop 1"),
            "Admissible here: 7 commands, e.g. `take apple 1 from countertop 1`.",
        )

    def test_one_command_is_singular_and_zero_names_none(self):
        self.assertEqual(agent.admissible_line(1, "look"), "Admissible here: 1 command, e.g. `look`.")
        self.assertEqual(agent.admissible_line(0, ""), "Admissible here: 0 commands.")

    def test_the_example_prefers_the_shortest_command_sharing_the_refused_verb(self):
        # The selection rule has to be deterministic and legible: the model named a verb it wanted, so the example keeps
        # that verb, and among the candidates the shortest is the one that costs least prompt for the same information.
        commands = ["open cabinet 1", "take apple 1 from countertop 1", "take apple 1", "look"]
        self.assertEqual(agent.admissible_example(commands, "take apple 9 from countertop 1"), "take apple 1")

    def test_without_a_shared_verb_the_first_command_in_the_world_order_is_named(self):
        commands = ["look", "inventory", "open cabinet 1"]
        self.assertEqual(agent.admissible_example(commands, "go to shelf 2"), "look")
        self.assertEqual(agent.admissible_example([], "go to shelf 2"), "")

    def test_the_line_reaches_the_model_on_a_refused_turn_and_not_on_an_admitted_one(self):
        # The refusal is scripted: `take apple 9` is not in this world's admissible set, so the turn moves nothing and the
        # line answers it. The second turn is admissible and carries no line, which is what keeps the treatment
        # conditional rather than a constant (R188's finding, restated as a test).
        episode, seen = self.drive([
            "> take apple 9 from countertop 1",
            "> take apple 1 from countertop 1",
            "> put apple 1 in/on cabinet 1",
        ])
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertIn("Admissible here: 4 commands", seen[1][-1])
        self.assertNotIn("Admissible here", seen[2][-1])

    def test_the_instrument_records_the_size_of_the_set_it_answered_with(self):
        episode, _ = self.drive(["> take apple 9 from countertop 1", "> go to shelf 2", "> take apple 1 from countertop 1"])
        self.assertTrue(episode["state_admissible"])
        # Two turns moved nothing, and the set is the same four commands both times: the instrument is a measurement of
        # the world, so a mean that moved between two identical states would be a measurement of the driver.
        self.assertEqual(episode["admissible_max"], 4)
        self.assertEqual(episode["admissible_mean"], 4)
        self.assertEqual(episode["ledger_fires"], 2)

    def test_an_episode_with_no_refusal_records_zeroes_and_an_empty_sample(self):
        episode, _ = self.drive(["> take apple 1 from countertop 1", "> put apple 1 in/on cabinet 1"])
        self.assertTrue(episode["won"])
        self.assertEqual(episode["ledger_fires"], 0)
        self.assertEqual(episode["admissible_max"], 0)
        self.assertEqual(episode["admissible_sample"], "")

    def test_the_flag_sets_its_own_label_token(self):
        self.assertIn("ledger-admissible", agent.arm_label(
            "always-in", agent.DEFAULT_TOP_K, 0.0, gate_kind=True, parser="any-line",
            guard_commandless=True, state_admissible=True))
        self.assertEqual(
            agent.arm_label("always-in", agent.DEFAULT_TOP_K, 0.0, parser="any-line", state_admissible=True),
            "always-in@anyline+ledger-admissible",
        )
        # And it is not the list's token: three renderers, three labels, or a join pools a treatment with its ablation.
        self.assertEqual(
            agent.arm_label("always-in", agent.DEFAULT_TOP_K, 0.0, parser="any-line", state_ledger=True),
            "always-in@anyline+ledger",
        )

    def test_the_reference_reader_gets_the_same_line_on_its_own_refusal(self):
        # The ledger answers on both sides of the parser, so this renderer does too: under the first-line rule the
        # command under a thought is refused and never executed, and the turn still gets the admissible line. Two
        # channels, one treatment -- otherwise an arm's effect would be a fact about the reader (AUDIT 34.262).
        episode, seen = self.drive(
            ["> think: take the apple\n> take apple 9 from countertop 1", "> take apple 1 from countertop 1"],
            parser="reference",
        )
        self.assertEqual(episode["ledger_fires"], 1)
        self.assertIn("Admissible here: 4 commands", seen[1][-1])
        self.assertEqual(episode["admissible_max"], 4)

    def test_the_instrument_reaches_the_summary_and_the_episodes(self):
        class RefusesEverything(FakeWorld):
            def step(self, actions):
                self.steps += 1
                return [agent.NO_OP + "\n"], [0.0], [False], {
                    "won": [False],
                    "admissible_commands": [["look", "inventory"]],
                }

        original_build = agent.build_env
        original_argv = sys.argv
        out = HERE / "admissible-under-test.json"
        agent.build_env = lambda batch_size=1, train_eval="eval_out_of_distribution": (RefusesEverything(), 1)
        try:
            sys.argv = ["agent.py", "--arm", "none", "--policy", "first", "--games", "1",
                        "--state-admissible", "--out", str(out)]
            self.assertEqual(agent.main(), 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
        finally:
            agent.build_env = original_build
            sys.argv = original_argv
            out.unlink(missing_ok=True)
        summary = payload["summary"]
        self.assertTrue(summary["state_admissible"])
        self.assertEqual(summary["arm_label"], "none@ledger-admissible")
        self.assertGreater(summary["ledger_fires"], 0)
        # The first turn's set is the world's opening one (four commands); every later turn's is the two the fake
        # reports after a step. Max sees the first, the mean sees the rest -- and both are the world's numbers.
        self.assertEqual(summary["admissible_max"], 4)
        self.assertEqual(summary["admissible_mean"], 2)
        self.assertTrue(payload["episodes"][0]["state_admissible"])

    def test_the_flag_cannot_be_stacked_on_the_ledger_it_replaces(self):
        # Two renderers on one turn would send two lines for one event and make the arm unreadable against either. The
        # refusal is at the argument, not in the loop, so a dispatch that tries it fails before it spends a call.
        original_argv = sys.argv
        try:
            sys.argv = ["agent.py", "--arm", "none", "--policy", "first", "--games", "1",
                        "--state-ledger", "--state-admissible", "--out", str(HERE / "never.json")]
            with self.assertRaises(SystemExit):
                agent.main()
        finally:
            sys.argv = original_argv


if __name__ == "__main__":
    unittest.main(verbosity=2)
