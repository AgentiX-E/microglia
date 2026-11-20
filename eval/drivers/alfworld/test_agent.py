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

import json
import os
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import agent  # noqa: E402


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
        self.assertEqual(agent.render_pack(["a rule", "another"]), "Rules from earlier attempts:\n1. a rule\n2. another\n\n")

    def test_the_opening_puts_the_pack_above_the_examples(self):
        examples = agent.load_examples()
        opening = agent.build_opening(examples, "put", "Your task is to: x\n", 50, agent.render_pack(["r"]))
        self.assertEqual(opening[0], {"role": "system", "content": agent.SYSTEM_INSTRUCTION})
        self.assertTrue(opening[1]["content"].startswith("Rules from earlier attempts:"))
        self.assertIn("You may take maximum of 50 steps.", opening[1]["content"])
        self.assertIn("Here are two examples:", opening[1]["content"])
        expected_turns = sum(len(agent.split_transcript(t)) for t in examples["examples"]["put"])
        self.assertEqual(len(opening) - 2, expected_turns)

    def test_without_a_pack_the_opening_starts_with_the_instruction(self):
        examples = agent.load_examples()
        opening = agent.build_opening(examples, "put", "Your task is to: x\n", 50, "")
        self.assertTrue(opening[1]["content"].startswith("Your task is to: x\n"))

    def test_the_two_arms_differ_in_exactly_one_block(self):
        # The registration's claim is that the arms differ in what sits above the transcript and in
        # nothing else. This is that claim as an assertion.
        examples = agent.load_examples()
        bare = agent.build_opening(examples, "put", "Your task is to: x\n", 50, "")
        packed = agent.build_opening(examples, "put", "Your task is to: x\n", 50, agent.render_pack(["r"]))
        self.assertEqual(len(bare), len(packed))
        differing = [index for index in range(len(bare)) if bare[index] != packed[index]]
        self.assertEqual(differing, [1])


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
            return remaining.pop(0), usage or {
                "prompt_tokens": 100,
                "completion_tokens": 5,
                "prompt_cache_hit_tokens": 60,
                "prompt_cache_miss_tokens": 40,
            }

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
        agent.build_env = lambda batch_size=1: (self.world, 1)
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
        reply, usage = agent.chat(self.messages(), "deepseek-flash", "k", 5.0, url=self.url("/ok"))
        self.assertEqual(reply, "> go to cabinet 1")
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
        agent.build_env = lambda batch_size=1: (FakeWorld(), 2)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_pass_that_spends_its_budget_is_a_result_rather_than_a_failure(self):
        agent.build_env = lambda batch_size=1: (FakeWorld(never_ends=True), 1)
        self.assertEqual(self.run_main(["--policy", "first", "--games", "1", "--max-steps", "3", "--out", str(self.out)]), 0)
        summary = json.loads(self.out.read_text(encoding="utf-8"))["summary"]
        self.assertEqual(summary["budget_exhausted"], 1)
        self.assertEqual(summary["wins"], 0)

    def test_an_episode_that_ends_with_turns_to_spare_fails_the_pass(self):
        # An environment that admits no command while the budget is untouched is neither a win nor a
        # budget ending: it is the pass losing the game, and it must not be written up as a rate.
        world = FakeWorld()
        world.admissible = lambda: []
        agent.build_env = lambda batch_size=1: (world, 1)
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

        agent.build_env = lambda batch_size=1: (RotatingWorld(), 2)
        self.assertEqual(self.run_main(["--policy", "first", "--games", "2", "--out", str(self.out)]), 0)
        self.assertEqual(json.loads(self.out.read_text(encoding="utf-8"))["summary"]["wins"], 2)

    def test_a_bank_without_a_cap_is_read_whole(self):
        bank = HERE / "bank-no-cap.json"
        bank.write_text(json.dumps({"entries": ["one", "two"]}), encoding="utf-8")
        agent.build_env = lambda batch_size=1: (FakeWorld(), 1)
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
        )
        agent.build_env = lambda batch_size=1: (FakeWorld(), 1)
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
