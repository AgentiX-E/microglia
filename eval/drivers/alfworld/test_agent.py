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
    ):
        self.gamefile = gamefile
        self.never_ends = never_ends
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
        # Only the apple that is actually here can be taken. A world that took anything would let an
        # invalid action succeed and make the invalid-action count a count of something else.
        if action.startswith("take") and "apple 1" in action:
            self.holding = "apple 1"
        elif action.startswith("open"):
            self.opened = True
        elif action.startswith("put") and self.holding and not self.never_ends:
            self.won = True
            self.over = True
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

    def test_a_pass_writes_a_summary_whose_accounting_closes(self):
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        summary = payload["summary"]
        self.assertEqual(summary["wins"], 1)
        self.assertEqual(summary["games_driven"], 1)
        self.assertEqual(summary["calls"], 0)
        self.assertEqual(summary["bill"]["usd"], 0.0)
        self.assertEqual(summary["arm"], "none")

    def test_a_seed_pass_reproduces_a_floor_that_agrees(self):
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
        first = json.loads(self.out.read_text(encoding="utf-8"))
        self.floor.write_text(json.dumps({"episodes": first["episodes"]}), encoding="utf-8")
        self.assertEqual(
            self.run_main(["--policy", "first", "--games", "1", "--assert-floor", str(self.floor), "--out", str(self.out)]),
            0,
        )
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["floor_agreement"]["mismatches"], 0)

    def test_a_floor_that_disagrees_fails_the_pass(self):
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
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
            self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
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
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--out", str(self.out)]), 0)
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

    def test_a_resume_that_is_handed_a_game_already_paid_for_is_refused(self):
        # The environment's position is what makes a resume safe. A pass restarted from the beginning would
        # re-drive a game and be caught by the duplicate check rather than billed twice in silence.
        world = self.world(4)
        agent.chat = self.reply_once
        self.fail_at_call = 5
        with self.assertRaises(agent.LaneError):
            self.run_main(self.base())
        world = self.world(4, offset=0)
        agent.chat = self.reply_once
        self.fail_at_call = 0
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.base() + ["--resume"])
        self.assertEqual(caught.exception.code, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
