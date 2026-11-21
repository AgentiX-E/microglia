"""The decisions in `distill.py`, against the competitor's arithmetic and the vectors both sides share.

`rule-op-vectors.json` is a contract, not a fixture: `packages/eval/src/__tests__/rule-bank-vectors.test.ts`
reads the same file and checks the TypeScript port against it. Two ports of one algorithm that are only tested
against themselves will agree with each other and not with the paper; this file and that one are the smallest
arrangement in which a drift between them is a red build on both sides instead of a silent divergence between
the bank the Python lane builds and the bank the TypeScript package says it would build.

No model is called. The critique calls are made through a scripted function that answers with real replies —
a scripted reply list is a stateful stand-in, not a mock: it returns what a provider would return and the code
under test treats it exactly as it treats the provider.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import unittest
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import distill  # noqa: E402
import agent as driver  # noqa: E402

VECTORS = json.loads((HERE / "rule-op-vectors.json").read_text(encoding="utf-8"))


class VectorTest(unittest.TestCase):
    """Every case in the shared contract, for both the parser and the merge."""

    def test_the_contract_has_cases_and_a_source(self):
        self.assertGreaterEqual(len(VECTORS["cases"]), 12)
        self.assertIn("LeapLabTHU/ExpeL", VECTORS["source"])

    def test_every_case_parses_and_merges_as_the_contract_says(self):
        for case in VECTORS["cases"]:
            with self.subTest(case=case["name"]):
                parsed = distill.parse_operations(case["reply"])
                self.assertEqual(parsed, case["parsed"])
                report = distill.merge_operations(
                    case["bank"], parsed, identity=case["identity"], cap=case["cap"]
                )
                expected = case["expect"]
                for key in ("applied", "rejected", "culled", "peak"):
                    self.assertEqual(report[key], expected[key], f"{case['name']}: {key}")
                if "bank" in expected:
                    self.assertEqual(report["bank"], expected["bank"], case["name"])
                else:
                    # One case is 25 entries long, and it asserts the arithmetic rather than the whole
                    # list: a removal past the cap's margin costs three votes, not one. The entry is
                    # found by text because the list is sorted by votes after the merge, so an index
                    # would be an assertion about the sort rather than about the penalty.
                    entry = next(item for item in report["bank"] if item["text"] == expected["bank_entry_text"])
                    self.assertEqual(entry["votes"], expected["bank_entry_votes"], case["name"])

    def test_no_case_is_unreachable_through_the_parser(self):
        # A contract whose expectations can only be reached by calling the merge directly is a contract
        # about a function no run uses.
        for case in VECTORS["cases"]:
            with self.subTest(case=case["name"]):
                merged = distill.merge_operations(
                    case["bank"], distill.parse_operations(case["reply"]), identity=case["identity"], cap=case["cap"]
                )
                self.assertIsInstance(merged["bank"], list)

    def test_an_operation_without_a_number_parses_with_none(self):
        # The competitor's reply format always numbers an operation, and a model that omits the number is
        # the commonest deviation. The parser keeps the operation and records the absence rather than
        # dropping a rule, and a `None` number is what the merge reads as "nothing to address".
        parsed = distill.parse_operations("ADD: Open the cabinet first.")
        self.assertEqual(parsed, [{"kind": "ADD", "number": None, "text": "Open the cabinet first."}])


class IdentityTest(unittest.TestCase):
    """The three identity modes, which is where a port silently becomes a different algorithm."""

    def test_tokens_ignores_order_case_and_repetition(self):
        self.assertEqual(
            distill.normalize_tokens("Check the lamp first, check the lamp."),
            distill.normalize_tokens("first CHECK the lamp"),
        )

    def test_exact_is_the_strictest_and_substring_the_loosest(self):
        existing = "Always check the lamp."
        incoming = "Always check the lamp. Leave the room afterwards."
        self.assertFalse(distill.same_rule(existing, incoming, "exact"))
        self.assertTrue(distill.same_rule(existing, incoming, "substring"))
        self.assertFalse(distill.same_rule(existing, incoming, "tokens"))

    def test_find_rule_takes_the_first_match(self):
        # A rule ends in a period, so an extension that keeps the period is what the substring test can
        # see: both entries below are contained in the incoming text, and the first one wins.
        bank = [{"text": "Take the apple.", "votes": 2}, {"text": "Take the apple from the countertop.", "votes": 2}]
        self.assertEqual(distill.find_rule(bank, "Take the apple. Take the apple from the countertop.", "substring"), 0)


class PromptTest(unittest.TestCase):
    """The critique prompt, pinned where a paraphrase would change the treatment."""

    def test_the_system_line_is_the_competitors(self):
        self.assertEqual(
            distill.SYSTEM_CRITIQUE,
            "You will be given successful tasks trials in which you were placed in a household environment "
            "and tasks to complete.",
        )

    def test_the_human_message_carries_the_trials_the_rules_and_the_format(self):
        messages = distill.critique_messages(
            [{"text": "Open the cabinet.", "votes": 2}], "You are in a room.", 20
        )
        self.assertEqual(messages[0], {"role": "system", "content": distill.SYSTEM_CRITIQUE})
        human = messages[1]["content"]
        self.assertTrue(human.startswith("\nHere are the trials:\nYou are in a room.\n"))
        self.assertIn("\nHere are the EXISTING RULES:\n1. Open the cabinet.\n", human)
        self.assertIn("<OPERATION> <RULE NUMBER>: <RULE>", human)
        self.assertTrue(human.endswith(distill.CRITIQUE_SUFFIX_NOT_FULL))

    def test_an_empty_bank_renders_an_empty_list_rather_than_a_placeholder(self):
        human = distill.critique_messages([], "trial", 20)[1]["content"]
        self.assertIn("\nHere are the EXISTING RULES:\n\n", human)

    def test_a_full_bank_changes_the_suffix_and_asks_for_removals_first(self):
        bank = [{"text": f"Rule {index}.", "votes": 2} for index in range(20)]
        human = distill.critique_messages(bank, "trial", 20)[1]["content"]
        self.assertTrue(human.endswith(distill.CRITIQUE_SUFFIX_FULL))
        self.assertIn("Focus on REMOVE rules first", human)

    def test_the_numbered_list_is_what_the_prompt_shows(self):
        self.assertEqual(
            distill.numbered([{"text": "a.", "votes": 2}, {"text": "b.", "votes": 1}]), "1. a.\n2. b."
        )
        self.assertEqual(distill.numbered([]), "")


class ChunkTest(unittest.TestCase):
    """Where the trajectories come from, and what is refused."""

    def write(self, name: str, payload: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_only_won_episodes_are_distilled_from(self):
        path = self.write(
            "distill-under-test-a.json",
            {
                "episodes": [
                    {"gamefile": "b/game.tw-pddl", "won": True, "trajectory": "trial b"},
                    {"gamefile": "a/game.tw-pddl", "won": False, "trajectory": "trial a"},
                ]
            },
        )
        try:
            won = distill.successes([path])
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual([episode["gamefile"] for episode in won], ["b/game.tw-pddl"])

    def test_a_game_driven_in_two_shards_appears_once(self):
        payload = {"episodes": [{"gamefile": "a/game.tw-pddl", "won": True, "trajectory": "trial"}]}
        first = self.write("distill-under-test-b.json", payload)
        second = self.write("distill-under-test-c.json", payload)
        try:
            self.assertEqual(len(distill.successes([first, second])), 1)
        finally:
            first.unlink(missing_ok=True)
            second.unlink(missing_ok=True)

    def test_the_order_is_the_splits_order_rather_than_the_shards(self):
        # Grouping decides what each critique sees, so it must not depend on which artifact happened to be
        # listed first: the competitor divides its successes at random under a seed, and this lane divides
        # them by name so that a bank is reproducible from the artifacts alone.
        first = self.write(
            "distill-under-test-d.json",
            {"episodes": [{"gamefile": "z/game.tw-pddl", "won": True, "trajectory": "z"}]},
        )
        second = self.write(
            "distill-under-test-e.json",
            {"episodes": [{"gamefile": "a/game.tw-pddl", "won": True, "trajectory": "a"}]},
        )
        try:
            games = [episode["gamefile"] for episode in distill.successes([first, second])]
        finally:
            first.unlink(missing_ok=True)
            second.unlink(missing_ok=True)
        self.assertEqual(games, ["a/game.tw-pddl", "z/game.tw-pddl"])

    def test_a_won_episode_without_a_trajectory_is_refused(self):
        # The pass was driven without `--record-transcripts`. Silently distilling from the remaining games
        # would produce a bank from a subset nobody chose.
        path = self.write(
            "distill-under-test-f.json", {"episodes": [{"gamefile": "a/game.tw-pddl", "won": True}]}
        )
        try:
            with self.assertRaises(SystemExit) as caught:
                distill.successes([path])
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(caught.exception.code, 1)

    def test_chunks_are_consecutive_and_the_last_one_may_be_short(self):
        items = [{"i": index} for index in range(10)]
        self.assertEqual([len(chunk) for chunk in distill.chunks_of(items, 8)], [8, 2])

    def test_a_chunk_size_of_zero_is_refused(self):
        with self.assertRaises(SystemExit):
            distill.chunks_of([{"i": 0}], 0)

    def test_trials_are_separated_by_a_blank_line(self):
        self.assertEqual(
            distill.trials_text([{"trajectory": "a\nb"}, {"trajectory": "c"}]), "a\nb\n\nc"
        )


class KindCensusTest(unittest.TestCase):
    """Which operation did the work, because R164 registered a prediction about the ratio.

    A rule ends with a full stop, so the substring identity test almost only fires on a verbatim restatement. That
    makes the bank nearly add-only, and `applied` -- one number over four operations -- cannot show it.
    """

    def bank(self):
        return [{"text": "close the fridge.", "votes": 3}, {"text": "open the drawer.", "votes": 2}]

    def test_each_applied_operation_is_counted_under_its_own_kind(self):
        report = distill.merge_operations(
            self.bank(),
            [
                {"kind": "ADD", "text": "check the sink first.", "number": None},
                {"kind": "AGREE", "text": "close the fridge.", "number": None},
                {"kind": "REMOVE", "text": "open the drawer.", "number": None},
            ],
            cap=None,
        )
        self.assertEqual(report["by_kind"], {"ADD": 1, "EDIT": 0, "AGREE": 1, "REMOVE": 1})
        self.assertEqual(report["applied"], 3)

    def test_a_rejected_operation_is_not_counted_as_a_kind(self):
        report = distill.merge_operations(
            self.bank(), [{"kind": "AGREE", "text": "a rule nobody wrote.", "number": None}], cap=None
        )
        self.assertEqual(report["by_kind"], {"ADD": 0, "EDIT": 0, "AGREE": 0, "REMOVE": 0})
        self.assertEqual(report["rejected"], 1)


class TilingTest(unittest.TestCase):
    """A bank is a function of the games it was distilled from, so a partial slice is a different treatment."""

    def write(self, name: str, games: "list[str]") -> Path:
        path = HERE / name
        path.write_text(
            json.dumps(
                {
                    "episodes": [
                        {"gamefile": game, "won": True, "trajectory": "trial"} for game in games
                    ]
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_a_union_that_tiles_the_slice_is_accepted_and_counted(self):
        first = self.write("tile-a.json", ["g1", "g2"])
        second = self.write("tile-b.json", ["g2", "g3"])
        try:
            self.assertEqual(distill.tiled([first, second], 3), 3)
        finally:
            for path in (first, second):
                path.unlink(missing_ok=True)

    def test_a_game_appearing_in_two_artefacts_counts_once(self):
        # The union of a later run with a surviving one is exactly the case where a game could be counted twice,
        # and counting it twice would make a partial slice look complete.
        first = self.write("tile-c.json", ["g1", "g2"])
        second = self.write("tile-d.json", ["g1", "g2"])
        try:
            self.assertEqual(distill.tiled([first, second], 2), 2)
        finally:
            for path in (first, second):
                path.unlink(missing_ok=True)

    def test_a_slice_that_falls_short_is_refused(self):
        path = self.write("tile-e.json", ["g1", "g2"])
        try:
            with self.assertRaises(SystemExit) as caught:
                distill.tiled([path], 4)
            self.assertEqual(caught.exception.code, 1)
        finally:
            path.unlink(missing_ok=True)

    def test_an_episode_without_a_game_name_is_not_counted(self):
        # An artefact written before `gamefile` was recorded, or one whose field arrived as null, would
        # otherwise be counted as a game named `None` and could make a slice look covered when it is not.
        # It is skipped so that the shortfall surfaces as a refusal rather than as a bank built from
        # fewer games than the register says.
        path = HERE / "tile-g.json"
        path.write_text(
            json.dumps({"episodes": [{"gamefile": None, "won": True}, {"gamefile": "g1", "won": True}]}),
            encoding="utf-8",
        )
        try:
            self.assertEqual(distill.tiled([path], 1), 1)
            with self.assertRaises(SystemExit) as caught:
                distill.tiled([path], 2)
            self.assertEqual(caught.exception.code, 1)
        finally:
            path.unlink(missing_ok=True)

    def test_zero_expected_games_skips_the_check(self):
        path = self.write("tile-f.json", ["g1"])
        try:
            self.assertEqual(distill.tiled([path], 0), 1)
        finally:
            path.unlink(missing_ok=True)


class BuildTest(unittest.TestCase):
    """The pass itself, against a scripted provider."""

    def script(self, replies, usage=None):
        remaining = list(replies)
        seen = []

        def chat(messages, model, api_key, timeout):
            seen.append(messages)
            return (
                remaining.pop(0),
                usage
                or {
                    "prompt_tokens": 1_000,
                    "completion_tokens": 50,
                    "prompt_cache_hit_tokens": 800,
                    "prompt_cache_miss_tokens": 200,
                },
                0,
            )

        return chat, seen

    def chunks(self, count: int, size: int = 1) -> "list[list[dict]]":
        return distill.chunks_of(
            [{"gamefile": f"g{index}/game.tw-pddl", "trajectory": f"trial {index}"} for index in range(count)], size
        )

    def test_the_second_critique_sees_the_first_replys_rules(self):
        # This is the whole point of feeding the list back: a later chunk can agree with or edit an earlier
        # rule instead of restating it as a new one.
        chat, seen = self.script(
            [
                "ADD 1: Open the cabinet before taking anything out of it.",
                "AGREE 1: Open the cabinet before taking anything out of it.",
            ]
        )
        result = distill.build_bank(self.chunks(2), 20, "deepseek-flash", "k", 1.0, chat_fn=chat)
        self.assertEqual(len(result["bank"]), 1)
        self.assertEqual(result["bank"][0]["votes"], 3)
        self.assertIn("1. Open the cabinet before taking anything out of it.", seen[1][1]["content"])

    def test_the_bill_and_the_counters_are_the_ones_the_calls_reported(self):
        chat, _ = self.script(["ADD 1: Open the fridge first."])
        result = distill.build_bank(self.chunks(1), 20, "deepseek-flash", "k", 1.0, chat_fn=chat)
        self.assertEqual(result["calls"], 1)
        self.assertEqual(result["usage"]["prompt_tokens"], 1_000)
        self.assertEqual(result["usage"]["cache_hit_tokens"], 800)
        self.assertEqual(result["stats"]["applied"], 1)
        self.assertEqual(result["stats"]["operations"], 1)

    def test_the_retries_of_every_critique_are_summed_into_the_bank(self):
        # `driver.chat` returns the retry count beside the reply, and the bank is the only artefact that knows a
        # distillation survived a provider incident. The first version of this file unpacked two values and died on
        # the first critique of a paid run at 13:50 -- the unit tests agreed with it because their stubs returned
        # two as well.
        replies = ["ADD 1: Open the cabinet first.", "ADD 2: Close the fridge after use."]
        remaining = list(replies)

        def chat(messages, model, api_key, timeout):
            return remaining.pop(0), {"prompt_tokens": 10, "completion_tokens": 2, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 10}, 2

        result = distill.build_bank(self.chunks(2), 20, "m", "k", 1.0, "substring", 0, chat)
        self.assertEqual(result["stats"]["retries"], 4)

    def test_a_reply_with_no_operation_is_counted_rather_than_crashing(self):
        chat, _ = self.script(["The rules are complete.", "ADD 1: Open the fridge first."])
        result = distill.build_bank(self.chunks(2), 20, "deepseek-flash", "k", 1.0, chat_fn=chat)
        self.assertEqual(result["stats"]["empty_replies"], 1)
        self.assertEqual(len(result["bank"]), 1)

    def test_a_trace_prints_the_operations_of_the_first_replies(self):
        chat, _ = self.script(["ADD 1: Open the fridge first."])
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            distill.build_bank(self.chunks(1), 20, "deepseek-flash", "k", 1.0, trace=1, chat_fn=chat)
        self.assertIn("[critique 1/1] 1 operation(s)", printed.getvalue())


class MainTest(unittest.TestCase):
    """The command line: what it writes, and what it refuses to write."""

    def setUp(self):
        self.out = HERE / "bank-under-test.json"
        self.episodes = HERE / "episodes-under-test.json"
        self.original_chat = driver.chat
        self.key = os.environ.get("DEEPSEEK_API_KEY")

    def tearDown(self):
        driver.chat = self.original_chat
        for path in (self.out, self.episodes):
            path.unlink(missing_ok=True)
        if self.key is None:
            os.environ.pop("DEEPSEEK_API_KEY", None)
        else:
            os.environ["DEEPSEEK_API_KEY"] = self.key

    def episodes_with(self, count: int, won: bool = True) -> Path:
        self.episodes.write_text(
            json.dumps(
                {
                    "episodes": [
                        {
                            "gamefile": f"valid_seen/task-{index}/trial_t/game.tw-pddl",
                            "won": won,
                            "trajectory": f"You are in the middle of a room.\n> look\nNothing happens.",
                        }
                        for index in range(count)
                    ]
                }
            ),
            encoding="utf-8",
        )
        return self.episodes

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["distill.py"] + argv
        try:
            return distill.main()
        finally:
            sys.argv = original

    def stub(self, replies):
        remaining = list(replies)
        driver.chat = lambda messages, model, api_key, timeout: (
            remaining.pop(0),
            {"prompt_tokens": 1_000, "completion_tokens": 50, "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 1_000},
            0,
        )

    def test_a_bank_is_written_with_the_source_it_came_from(self):
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.stub(["ADD 1: Open the cabinet before taking anything out of it."])
        self.assertEqual(
            self.run_main(
                ["--episodes", str(self.episodes_with(8)), "--critique-num", "8", "--out", str(self.out)]
            ),
            0,
        )
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["schema"], distill.SCHEMA)
        self.assertEqual(len(payload["entries"]), 1)
        self.assertEqual(payload["cap"], 20)
        self.assertEqual(payload["source"]["episodes"], 8)
        self.assertEqual(payload["source"]["chunks"], 1)
        self.assertGreater(payload["bill"]["usd"], 0)

    def test_the_bank_is_readable_by_the_arm_that_carries_it(self):
        # The one interface between the two files. A bank this file writes and `agent.py` cannot read is a
        # bank nothing carries, and the failure would surface on the paid run rather than here.
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.stub(["ADD 1: Open the cabinet before taking anything out of it."])
        self.assertEqual(
            self.run_main(["--episodes", str(self.episodes_with(2)), "--out", str(self.out)]), 0
        )
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        rules = [entry["text"] for entry in payload["entries"]][: payload["cap"]]
        rendered = driver.render_pack(rules)
        self.assertTrue(rendered.startswith(driver.PACK_HEADER))
        self.assertIn("1. Open the cabinet before taking anything out of it.", rendered)

    def test_no_key_is_a_refusal_rather_than_an_offline_bank(self):
        os.environ.pop("DEEPSEEK_API_KEY", None)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--episodes", str(self.episodes_with(2)), "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_no_win_is_a_refusal_rather_than_an_empty_bank(self):
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--episodes", str(self.episodes_with(2, won=False)), "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_replies_the_parser_rejects_everywhere_fail_the_run(self):
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.stub(["I cannot help with that.", "No operations today."])
        with self.assertRaises(SystemExit) as caught:
            self.run_main(
                ["--episodes", str(self.episodes_with(2)), "--critique-num", "1", "--out", str(self.out)]
            )
        self.assertEqual(caught.exception.code, 1)

    def test_a_bank_that_drifts_past_the_caps_margin_fails(self):
        # The cap is soft in the competitor, so a bank that exceeds it is not a bug in the reply; it is the
        # fourth weakness the port exists to expose. A run that produced one is reported rather than written.
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.stub(
            [
                "\n".join(
                    f"ADD {index + 1}: Always do thing number {index} before anything else."
                    for index in range(26)
                )
            ]
        )
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--episodes", str(self.episodes_with(1)), "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)

    def test_a_reply_that_adds_one_rule_twice_is_refused_rather_than_written(self):
        # ExpeL's arithmetic lets both ADDs land — neither has arrived when the other is checked — and that
        # is the right port of a streaming merge. The *bank* is the artefact a dispatch pays for, though, and
        # a bank carrying one rule twice renders it twice and charges the pack for both. So the merge keeps
        # the competitor's behaviour and the writer refuses the result, which is the only place the two
        # rules can disagree without changing what the arm does.
        os.environ["DEEPSEEK_API_KEY"] = "test-key"
        self.stub(
            [
                "ADD 1: Open the cabinet before taking anything out of it.\n"
                "ADD 2: Open the cabinet before taking anything out of it."
            ]
        )
        with self.assertRaises(SystemExit) as caught:
            self.run_main(["--episodes", str(self.episodes_with(1)), "--out", str(self.out)])
        self.assertEqual(caught.exception.code, 1)
        self.assertFalse(self.out.exists(), "a bank that failed its own check was written anyway")


class KindsTest(unittest.TestCase):
    """The subset filter, which is the only control this lane can build for a bank's *content*.

    A bank distilled from two task kinds and scored on all six carries the same shape as the registered bank and a
    different vocabulary. That is the experiment `44763220821` says is owed: its placebo was a permutation of the
    registered bank, which keeps every noun the bank had.
    """

    def episode(self, kind: str, index: int = 1) -> dict:
        """A won episode whose path is the shape the split actually publishes."""
        prefix = {
            "put": "pick_and_place_simple-Cup-None-Cabinet",
            "clean": "pick_clean_then_place_in_recep-Cup-None-Sink",
            "heat": "pick_heat_then_place_in_recep-Cup-None-Microwave",
            "cool": "pick_cool_then_place_in_recep-Apple-None-Fridge",
            "examine": "look_at_obj_in_light-Book-None-DeskLamp",
            "puttwo": "pick_two_obj_and_place-Cup-None-Shelf",
        }[kind]
        return {"gamefile": f"json_2.1.1/valid_seen/{prefix}-{index}/trial_T/game.tw-pddl", "trajectory": "t"}

    def test_two_kinds_keep_only_those_two(self):
        episodes = [self.episode(kind, index) for kind in ("put", "clean", "heat", "cool") for index in (1, 2)]
        kept = distill.kept(episodes, "cool,heat")
        self.assertEqual(len(kept), 4)
        self.assertEqual({distill.driver.task_kind_of(e["gamefile"]) for e in kept}, {"cool", "heat"})

    def test_no_filter_keeps_everything(self):
        episodes = [self.episode("put", 1), self.episode("cool", 1)]
        self.assertEqual(distill.kept(episodes, ""), episodes)

    def test_whitespace_is_not_a_kind(self):
        episodes = [self.episode("put", 1)]
        self.assertEqual(len(distill.kept(episodes, " put , ")), 1)

    def refused(self, kinds, episodes):
        """The one sentence a refused filter prints, which is the whole of what an operator sees."""
        printed = io.StringIO()
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stdout(printed):
            distill.kept(episodes, kinds)
        self.assertNotEqual(caught.exception.code, 0)
        return printed.getvalue()

    def test_a_kind_the_split_does_not_publish_is_refused_with_the_list_it_does(self):
        message = self.refused("put,oracle", [self.episode("put", 1)])
        self.assertIn("oracle", message)
        self.assertIn("puttwo", message)

    def test_a_filter_that_keeps_none_is_refused_rather_than_distilling_from_nothing(self):
        self.assertIn("nothing", self.refused("cool", [self.episode("put", 1)]))


class CallerContractTest(unittest.TestCase):
    """The seam between this module and the driver it calls, which is the one thing a scripted caller cannot check.

    Run `44743739868` drove 140 training games, joined two runs to cover them, and then died at
    `reply, reported = caller(...)` with `ValueError: too many values to unpack (expected 2)`: `agent.chat` had
    grown a third element when the retry table was added, and this caller was not updated with it. Every test
    above passes a scripted chat function, so every test above kept answering with the shape of a driver that no
    longer existed — a scripted caller is a stand-in for a provider, and it cannot stand in for the signature.

    So this class passes the driver itself and replaces only the socket, which is the boundary the driver already
    treats as data.
    """

    def chunks(self, count: int, size: int = 1) -> "list[list[dict]]":
        return distill.chunks_of(
            [{"gamefile": f"g{index}/game.tw-pddl", "trajectory": f"trial {index}"} for index in range(count)], size
        )

    def completion(self, text, prompt_tokens=900):
        return {
            "choices": [{"message": {"content": text}}],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": 40,
                "prompt_cache_hit_tokens": prompt_tokens // 2,
                "prompt_cache_miss_tokens": prompt_tokens // 2,
            },
        }

    def with_socket(self, answers):
        """The driver's own `chat`, with `attempt_once` answering from a list; each answer is a payload or an error."""
        remaining = list(answers)
        original = driver.attempt_once

        def attempt_once(body, url, api_key, timeout):
            answer = remaining.pop(0)
            if isinstance(answer, BaseException):
                raise answer
            return answer

        driver.attempt_once = attempt_once
        self.addCleanup(setattr, driver, "attempt_once", original)
        return lambda *args: driver.chat(*args, sleep=lambda _: None)

    def test_the_real_driver_satisfies_the_caller_this_module_calls(self):
        caller = self.with_socket([self.completion("ADD 1: Open the fridge before taking the lettuce.")])
        result = distill.build_bank(self.chunks(1), 20, "deepseek-flash", "k", 1.0, chat_fn=caller)
        self.assertEqual(len(result["bank"]), 1)
        self.assertEqual(result["bank"][0]["text"], "Open the fridge before taking the lettuce.")
        self.assertEqual(result["usage"]["prompt_tokens"], 900)
        self.assertEqual(result["calls"], 1)

    def test_a_answer_that_needed_the_retry_table_is_counted_rather_than_lost(self):
        refusal = urllib.error.HTTPError("https://api.deepseek.com", 429, "slow down", {}, io.BytesIO(b"{}"))
        caller = self.with_socket(
            [refusal, self.completion("ADD 1: Open the fridge before taking the lettuce.")]
        )
        result = distill.build_bank(self.chunks(1), 20, "deepseek-flash", "k", 1.0, chat_fn=caller)
        self.assertEqual(result["stats"]["retries"], 1)
        self.assertEqual(result["calls"], 1)
        self.assertEqual(result["usage"]["prompt_tokens"], 900)


if __name__ == "__main__":
    unittest.main(verbosity=1)
