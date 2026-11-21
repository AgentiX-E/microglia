"""The joining step's tests: what it refuses, and what the paired reading is made of.

The failures this file guards are the ones that produce a number rather than an error. A game counted
twice, an arm missing a slice, a control whose games do not coincide with the treatment's — each of those
still yields a delta if it is averaged, and the delta is wrong in a direction nobody can see. So the tests
are mostly about refusals, and the arithmetic tests exist to pin the two definitions that are easy to get
backwards: the discordance counts games where the arms *disagree*, and the interval resamples games.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import aggregate  # noqa: E402


def episode(game: str, won: bool, digest: str = "", kind: str = "put", **overrides) -> dict:
    """One episode record, with the fields the join reads.

    `digest` defaults to a value that depends on the verdict, so that a fixture built without one still
    says "these two runs took different paths" whenever they disagree — which is the only assumption a
    test that is not about engagement should have to make.
    """
    record = {
        "gamefile": game,
        "won": won,
        "steps": 7,
        "usage": {},
        "calls": 3,
        "digest": digest or f"{game}:{int(won)}",
        "task_kind": kind,
        "actions": 3,
        "invalid_actions": 0,
        "off_space_actions": 0,
    }
    record.update(overrides)
    return record


def summary(arm: str, **overrides) -> dict:
    base = {
        "arm": arm,
        "policy": "model",
        "calls": 10,
        "bill": {"usd": 0.01, "band": "off_peak", "usd_in_other_band": 0.02},
        "usage": {"prompt_tokens": 100, "completion_tokens": 10, "cache_hit_tokens": 90, "cache_miss_tokens": 10},
    }
    base.update(overrides)
    return base


class SliceTest(unittest.TestCase):
    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.paths.append(path)
        return path

    def test_groups_episodes_by_the_arm_that_drove_them(self):
        left = self.write("s-a.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write("s-b.json", {"summary": summary("always-in"), "episodes": [episode("g1", False)]})
        grouped = aggregate.load_slices([left, right])
        self.assertEqual(sorted(grouped), ["always-in", "none"])
        self.assertEqual(len(grouped["none"]), 1)

    def test_a_slice_of_the_placebo_arm_can_be_joined(self):
        # `sham` is a treatment with a bank's shape and no bank's content. A join that did not know the
        # name would refuse the one arm whose whole purpose is to be compared.
        path = self.write("s-f.json", {"summary": summary("sham"), "episodes": [episode("g1", True)]})
        self.assertEqual(sorted(aggregate.load_slices([path])), ["sham"])

    def test_an_unknown_arm_is_refused(self):
        path = self.write("s-c.json", {"summary": summary("placebo"), "episodes": [episode("g1", True)]})
        with self.assertRaises(SystemExit):
            aggregate.load_slices([path])

    def test_a_slice_with_no_episodes_is_refused(self):
        # Otherwise its calls and its bill are summed into a total that no game accounts for.
        path = self.write("s-d.json", {"summary": summary("none"), "episodes": []})
        with self.assertRaises(SystemExit):
            aggregate.load_slices([path])

    def test_an_undeclared_join_across_two_sections_is_refused(self):
        # A pooled rate over two sections is an average over two populations, and both arms tile and print, so
        # nothing about the reading looks wrong except the claim. `eval_in_distribution` is 140 games and the
        # held-out section is 134, which is why `--expect` alone cannot catch it.
        left = self.write("s-seen.json", {"summary": summary("none", split="eval_in_distribution",
                                                             split_size=140), "episodes": [episode("g1", True)]})
        right = self.write("s-held.json", {"summary": summary("always-in", split="eval_out_of_distribution",
                                                              split_size=134), "episodes": [episode("g1", False)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right])
        self.assertIn("mixes corpus sections", printed.getvalue())

    def test_a_declared_join_across_two_sections_is_accepted_and_graded(self):
        # The other half of the rule: R177's whole purpose is a 274-game join over two sections, and a guard that
        # refused it would refuse the purchase. Declaring the sections is what turns a mixture into a design, and
        # every episode then carries the section its parent named so the reading can be graded by it.
        # Two slices per arm — one per section — which is the shape of the real join: both arms drive every game
        # of both sections, so the pairing is still game-for-game and the sections are a grouping inside it.
        left = [
            self.write("s-seen-d1.json", {"summary": summary("none", split="eval_in_distribution"),
                                          "episodes": [episode("g1", True)]}),
            self.write("s-held-d1.json", {"summary": summary("none", split="eval_out_of_distribution"),
                                          "episodes": [episode("h1", True)]}),
        ]
        right = [
            self.write("s-seen-d2.json", {"summary": summary("always-in", split="eval_in_distribution"),
                                          "episodes": [episode("g1", False)]}),
            self.write("s-held-d2.json", {"summary": summary("always-in", split="eval_out_of_distribution"),
                                          "episodes": [episode("h1", False)]}),
        ]
        grouped = aggregate.load_slices(
            left + right, expect_splits=("eval_in_distribution", "eval_out_of_distribution")
        )
        self.assertEqual(sorted(episode["section"] for episode in grouped["none"]),
                         ["eval_in_distribution", "eval_out_of_distribution"])
        graded = aggregate.by_section(
            {episode["gamefile"]: episode for episode in grouped["none"]},
            {episode["gamefile"]: episode for episode in grouped["always-in"]},
        )
        self.assertEqual(sorted(graded), ["eval_in_distribution", "eval_out_of_distribution"])
        # Both sections read +1 game for the treatment, which is what a per-section grade is for: a pooled
        # +2/2 would have hidden a section that carried the whole effect.
        for row in graded.values():
            self.assertEqual(row["delta"], 1.0)

    def test_a_declaration_that_does_not_match_the_slices_is_refused(self):
        # The declaration is a claim about the design and this is the check that it is true: a dispatch that asked
        # for two sections and bought one is a reading whose denominator nobody can name.
        held = self.write("s-held-e.json", {"summary": summary("none", split="eval_out_of_distribution"),
                                            "episodes": [episode("g1", True)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([held], expect_splits=("eval_in_distribution", "eval_out_of_distribution"))
        self.assertIn("but the slices drove", printed.getvalue())

    def test_one_section_may_be_joined_with_itself(self):
        left = self.write("s-h1.json", {"summary": summary("none", split="eval_in_distribution"),
                                        "episodes": [episode("g1", True)]})
        right = self.write("s-h2.json", {"summary": summary("always-in", split="eval_in_distribution"),
                                         "episodes": [episode("g1", False)]})
        self.assertEqual(sorted(aggregate.load_slices([left, right])), ["always-in", "none"])

    def test_a_named_section_refuses_a_slice_that_recorded_none(self):
        # An artefact older than the field cannot prove which section it drove, and "cannot prove" is not
        # "did not": the whole value of naming the section is that the denominator is the section's own size.
        old = self.write("s-old.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([old], expect_splits=("eval_in_distribution",))
        self.assertIn("record no section", printed.getvalue())

    def test_a_named_section_refuses_slices_from_another_section(self):
        held = self.write("s-held2.json", {"summary": summary("none", split="eval_out_of_distribution"),
                                           "episodes": [episode("g1", True)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([held], expect_splits=("eval_in_distribution",))
        self.assertIn("drove ['eval_out_of_distribution']", printed.getvalue())

    def test_a_named_section_passes_when_every_slice_agrees(self):
        seen = self.write("s-seen2.json", {"summary": summary("none", split="eval_in_distribution"),
                                           "episodes": [episode("g1", True)]})
        self.assertEqual(sorted(aggregate.load_slices([seen], expect_splits=("eval_in_distribution",))), ["none"])

    def test_a_model_free_slice_is_refused(self):
        path = self.write("s-e.json", {"summary": summary("none", policy="seed"), "episodes": [episode("g1", True)]})
        with self.assertRaises(SystemExit):
            aggregate.load_slices([path])


class TileTest(unittest.TestCase):
    def test_a_game_driven_twice_is_refused(self):
        with self.assertRaises(SystemExit):
            aggregate.tile([episode("g1", True), episode("g1", False)], 0, "none")

    def test_a_short_tile_is_refused(self):
        with self.assertRaises(SystemExit):
            aggregate.tile([episode("g1", True)], 2, "none")

    def test_an_episode_without_a_gamefile_is_refused(self):
        with self.assertRaises(SystemExit):
            aggregate.tile([{"won": True}], 0, "none")

    def test_a_complete_tile_is_indexed_by_game(self):
        by_game = aggregate.tile([episode("g1", True), episode("g2", False)], 2, "none")
        self.assertEqual(sorted(by_game), ["g1", "g2"])


class EngagementTest(unittest.TestCase):
    """How much of the split the pack actually moved, and what it was worth where it moved it.

    A paired delta answers "did the arm score differently"; it does not answer "did the memory do
    anything". Those come apart in both directions: a pack that never changed an action produces a delta
    of exactly zero for reasons that have nothing to do with the mechanism being wrong, and a pack that
    changed a fifth of the games can produce a delta of zero by helping and hurting in equal measure. The
    decomposition is what separates the two, so its arithmetic is pinned here rather than trusted.
    """

    def test_a_pack_that_changed_no_action_leaves_every_game_identical(self):
        left = {"g1": episode("g1", True, digest="same"), "g2": episode("g2", False, digest="same")}
        right = {"g1": episode("g1", True, digest="same"), "g2": episode("g2", False, digest="same")}
        report = aggregate.engagement(left, right)
        self.assertEqual(report["identical"], 2)
        self.assertEqual(report["diverged"], 0)
        self.assertEqual(report["divergence_rate"], 0.0)
        self.assertIsNone(report["delta_among_diverged"])

    def test_the_diverged_subset_carries_the_whole_effect(self):
        # Four games, and the pack only changed two of them: the unconditional delta is 1/4, the delta
        # among the games it changed is 2/2. Reporting the first as the mechanism's effect understates it
        # by exactly the share of games the mechanism never reached.
        left = {
            "g1": episode("g1", True, digest="a1"),
            "g2": episode("g2", True, digest="a2"),
            "g3": episode("g3", False, digest="a3"),
            "g4": episode("g4", False, digest="a4"),
        }
        right = {
            "g1": episode("g1", False, digest="b1"),
            "g2": episode("g2", False, digest="b2"),
            "g3": episode("g3", False, digest="a3"),
            "g4": episode("g4", False, digest="a4"),
        }
        report = aggregate.engagement(left, right)
        self.assertEqual(report["diverged"], 2)
        self.assertEqual(report["divergence_rate"], 0.5)
        self.assertEqual(report["delta_among_diverged"], 1.0)
        self.assertEqual(report["delta_unconditional"], 0.5)

    def test_a_diverged_game_that_ends_the_same_way_is_diverged_with_no_delta(self):
        left = {"g1": episode("g1", True, digest="a1")}
        right = {"g1": episode("g1", True, digest="b1")}
        report = aggregate.engagement(left, right)
        self.assertEqual(report["diverged"], 1)
        self.assertEqual(report["delta_among_diverged"], 0.0)

    def test_the_same_actions_with_different_verdicts_is_refused(self):
        # The environment is a deterministic simulator: the same action sequence replays to the same
        # verdict. A contradiction here is a defect in the join -- two different games under one key, or a
        # slice written twice -- and it would make "identical" mean "the pack reached it and nothing
        # happened", which is the opposite of what it means.
        left = {"g1": episode("g1", True, digest="same")}
        right = {"g1": episode("g1", False, digest="same")}
        with self.assertRaises(SystemExit):
            aggregate.engagement(left, right)

    def test_a_slice_without_digests_is_refused(self):
        left = {"g1": episode("g1", True, digest="x")}
        right = {"g1": {"gamefile": "g1", "won": True}}
        with self.assertRaises(SystemExit):
            aggregate.engagement(left, right)

    def test_the_harm_share_is_the_same_quantity_the_tau2_lane_already_reports(self):
        # `COMPETITIVE.md` Appendix AS: harm share = the share of *informative* uses that made the outcome
        # worse. At the episode level an informative use is a game the pack changed, so the denominator is
        # `diverged` and not the split. Naming it the same way is what makes the two lanes comparable at all.
        left = {
            "g1": episode("g1", True),
            "g2": episode("g2", False),
            "g3": episode("g3", True),
            "g4": episode("g4", False),
        }
        right = {
            "g1": episode("g1", False),
            "g2": episode("g2", True),
            "g3": episode("g3", True),
            "g4": episode("g4", False),
        }
        report = aggregate.engagement(left, right)
        self.assertEqual(report["diverged"], 2)
        self.assertEqual(report["help_share"], 0.5)
        self.assertEqual(report["harm_share"], 0.5)

    def test_a_pack_that_never_reached_a_game_has_no_harm_share(self):
        left = {"g1": episode("g1", True, digest="same")}
        right = {"g1": episode("g1", True, digest="same")}
        report = aggregate.engagement(left, right)
        self.assertIsNone(report["harm_share"])
        self.assertIsNone(report["help_share"])


class KindTest(unittest.TestCase):
    """The six task types are not one population, so the delta is reported for each of them.

    The strongest prediction the registration can make is about *where* a rule bank should help: the task
    types whose solution is a procedure (heat, cool, clean) against the one that is a search (`puttwo`).
    A single pooled delta cannot confirm or refute that, and pooling six kinds is how a mechanism that
    helps three and hurts three reads as a null.
    """

    def test_deltas_are_reported_per_task_kind(self):
        left = {
            "g1": episode("g1", True, kind="put"),
            "g2": episode("g2", True, kind="puttwo"),
            "g3": episode("g3", False, kind="puttwo"),
        }
        right = {
            "g1": episode("g1", False, kind="put"),
            "g2": episode("g2", False, kind="puttwo"),
            "g3": episode("g3", False, kind="puttwo"),
        }
        report = aggregate.by_kind(left, right)
        self.assertEqual(sorted(report), ["put", "puttwo"])
        self.assertEqual(report["put"]["games"], 1)
        self.assertEqual(report["put"]["delta"], 1.0)
        self.assertEqual(report["puttwo"]["games"], 2)
        self.assertEqual(report["puttwo"]["delta"], 0.5)
        self.assertEqual(report["puttwo"]["discordant"], 1)

    def test_a_kind_is_named_even_when_an_older_slice_omits_it(self):
        left = {"g1": {"gamefile": "g1", "won": True, "digest": "d"}}
        right = {"g1": {"gamefile": "g1", "won": False, "digest": "e"}}
        self.assertIn("unknown", aggregate.by_kind(left, right))


class RefusalTest(unittest.TestCase):
    """The counters the arm is expected to move, kept apart from the score it may or may not move."""

    def test_refusal_rates_are_reported_per_arm(self):
        left = [episode("g1", True, calls=10, actions=5, invalid_actions=2, off_space_actions=1)]
        right = [episode("g1", True, calls=10, actions=5, invalid_actions=4, off_space_actions=0)]
        report = aggregate.refusals(left=left, right=right)
        self.assertEqual(report["left"]["invalid_actions"], 2)
        self.assertEqual(report["left"]["invalid_per_call"], 0.2)
        self.assertEqual(report["right"]["invalid_per_call"], 0.4)
        self.assertEqual(report["right"]["off_space_per_action"], 0.0)

    def test_a_slice_with_no_calls_has_no_rate_rather_than_zero(self):
        report = aggregate.refusals(left=[episode("g1", True, calls=0)], right=[episode("g1", True)])
        self.assertIsNone(report["left"]["invalid_per_call"])

    def test_dropped_commands_are_counted_apart_from_refusals(self):
        # Two ways a turn fails to reach the world, and until AUDIT 34.259 only the first was visible: an
        # invalid action is attempted and counted, a command under a thought is dropped in silence. The
        # report keeps them in different fields because a repair that removes one must not look like a repair
        # that removed the other.
        left = [episode("g1", True, calls=10, actions=5, refused_actions=3)]
        right = [episode("g1", True, calls=10, actions=5, refused_actions=0)]
        report = aggregate.refusals(left=left, right=right)
        self.assertEqual(report["left"]["refused_actions"], 3)
        self.assertEqual(report["left"]["refused_per_call"], 0.3)
        self.assertTrue(report["left"]["refused_counted"])
        self.assertEqual(report["right"]["refused_actions"], 0)

    def test_an_arm_file_from_before_the_field_reports_not_counted_rather_than_zero(self):
        # Every reading in this lane before the repair was taken on files with no `refused_actions`, and a
        # zero there means "the driver never counted" rather than "the model never wrote a command under a
        # thought". A report that printed 0 would make the defect invisible in exactly the comparison that
        # proves it was fixed.
        report = aggregate.refusals(left=[episode("g1", True, calls=10, actions=5)], right=[])
        self.assertFalse(report["left"]["refused_counted"])
        self.assertEqual(report["left"]["refused_actions"], 0)


class ChannelTest(unittest.TestCase):
    """The join refuses to pool two parser channels until it says that is what it is comparing.

    R183 re-runs both arms on a harness that executes the command the first-line rule refuses. That is a channel and
    not an arm: every level measured before it was measured on the reference channel, so a pooled rate over the two
    is an average over two harnesses — the same category error as a pooled rate over two corpus sections, and the
    same answer: refused until named, and reported beside the delta once it is.
    """

    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.paths.append(path)
        return path

    def test_an_artefact_from_before_the_field_is_the_reference_channel(self):
        # Every reading in this lane before R183 was driven by the reference parser. Reading a missing field as
        # "unknown" would make the one comparison R183 exists for impossible; reading it as anything other than the
        # reference would be a guess about a harness that is written down in code.
        old = self.write("c-old.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        grouped = aggregate.load_slices([old])
        self.assertEqual(aggregate.parsers(grouped), {"none": "reference"})
        self.assertEqual(grouped["none"][0]["parser"], "reference")

    def test_a_join_that_spans_two_channels_is_refused_until_it_names_them(self):
        left = self.write("c-ref.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write(
            "c-any.json",
            {"summary": summary("none", parser="any-line", arm_label="none@anyline"),
             "episodes": [episode("g2", True, parser="any-line")]},
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right])
        self.assertIn("--expect-parsers", printed.getvalue())

    def test_a_named_channel_span_is_allowed_and_graded(self):
        left = self.write("c-ref2.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write(
            "c-any2.json",
            {"summary": summary("none", parser="any-line", arm_label="none@anyline"),
             "episodes": [episode("g2", True, parser="any-line")]},
        )
        grouped = aggregate.load_slices([left, right], expect_parsers=("reference", "any-line"))
        self.assertEqual(sorted(grouped), ["none", "none@anyline"])
        self.assertEqual(aggregate.parsers(grouped), {"none": "reference", "none@anyline": "any-line"})

    def test_one_arm_cannot_span_two_channels(self):
        # The same label over two harnesses is the failure the label exists to prevent: the join would average a
        # reference run and an any-line run into one rate and call it an arm.
        first = self.write("c-mix1.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        second = self.write(
            "c-mix2.json",
            {"summary": summary("none", parser="any-line"), "episodes": [episode("g2", True, parser="any-line")]},
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([first, second], expect_parsers=("reference", "any-line"))
        self.assertIn("one arm cannot span two channels", printed.getvalue())

    def test_a_named_channel_that_did_not_drive_a_slice_is_refused(self):
        only = self.write("c-ref3.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([only], expect_parsers=("reference", "any-line"))
        self.assertIn("but the slices drove", printed.getvalue())

    def test_a_channel_name_that_is_not_one_of_the_two_is_refused(self):
        only = self.write(
            "c-bad.json",
            {"summary": summary("none", parser="any_line"), "episodes": [episode("g1", True)]},
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([only])
        self.assertIn("any_line", printed.getvalue())

    def test_recovered_commands_are_reported_beside_dropped_ones(self):
        # The two counters are one event on opposite sides of the parser, so they are printed together: a channel
        # that executes what the rule refused has `refused_actions` 0 and `recovered_actions` equal to what the
        # reference channel's `refused_actions` would have been. Reading only one of them makes the channel look
        # like a cure for the format.
        left = [episode("g1", True, calls=10, actions=5, refused_actions=0, recovered_actions=4)]
        right = [episode("g1", True, calls=10, actions=5, refused_actions=4)]
        report = aggregate.refusals(left=left, right=right)
        self.assertEqual(report["left"]["recovered_actions"], 4)
        self.assertEqual(report["left"]["recovered_per_call"], 0.4)
        self.assertTrue(report["left"]["recovered_counted"])
        self.assertEqual(report["right"]["recovered_actions"], 0)

    def test_a_slice_that_recorded_no_recovered_field_reports_not_counted(self):
        report = aggregate.refusals(left=[episode("g1", True, calls=10, actions=5)], right=[])
        self.assertFalse(report["left"]["recovered_counted"])

    def test_the_pass_prints_the_channel_of_each_arm(self):
        # A reading whose two arms came off two harnesses has to say so above the delta, not in a footnote: the
        # number is the comparison of two channels and nothing else in the output would reveal it.
        original = sys.argv
        treatment = HERE / "c-print-a.json"
        control = HERE / "c-print-b.json"
        treatment.write_text(
            json.dumps({"summary": summary("always-in", parser="any-line", arm_label="always-in@anyline"),
                        "episodes": [episode("g1", True, parser="any-line")]}),
            encoding="utf-8",
        )
        control.write_text(
            json.dumps({"summary": summary("none"), "episodes": [episode("g1", False)]}),
            encoding="utf-8",
        )
        sys.argv = [
            "aggregate.py", "--input", str(treatment), "--input", str(control),
            "--compare", "always-in@anyline,none", "--expect-parsers", "reference,any-line",
        ]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (treatment, control):
                path.unlink(missing_ok=True)
        printed = buffer.getvalue()
        self.assertIn("channel         always-in@anyline any-line", printed)
        self.assertIn("vs none reference", printed)


class StrataTest(unittest.TestCase):
    """The same delta, split by what the control did on its own.

    `arXiv:2604.27003` ("When Continual Learning Moves to Memory") reports that negative transfer from
    reused experience concentrates on the cases the agent cannot solve unaided, and that cases it can
    already solve are comparatively robust. That is a prediction about *this* lane's 134 games, and it is
    worth nothing unless it is computed before the reading arrives: a pooled delta cannot distinguish
    "the pack helped the hard games and hurt the easy ones" from "the pack did nothing".
    """

    def test_the_hard_stratum_is_the_games_the_control_lost(self):
        left = {
            "h1": episode("h1", True),
            "h2": episode("h2", True),
            "h3": episode("h3", False),
            "h4": episode("h4", False),
            "e1": episode("e1", True),
            "e2": episode("e2", True),
        }
        right = {
            "h1": episode("h1", False),
            "h2": episode("h2", False),
            "h3": episode("h3", False),
            "h4": episode("h4", False),
            "e1": episode("e1", True),
            "e2": episode("e2", True),
        }
        report = aggregate.strata(left, right)
        self.assertEqual(report["hard"]["games"], 4)
        self.assertEqual(report["hard"]["delta"], 0.5)
        self.assertEqual(report["easy"]["games"], 2)
        self.assertEqual(report["easy"]["delta"], 0.0)

    def test_a_pack_that_hurts_only_the_easy_cases_says_so(self):
        left = {"h1": episode("h1", True), "e1": episode("e1", False), "e2": episode("e2", False)}
        right = {"h1": episode("h1", False), "e1": episode("e1", True), "e2": episode("e2", True)}
        report = aggregate.strata(left, right)
        self.assertEqual(report["easy"]["delta"], -1.0)
        self.assertEqual(report["hard"]["delta"], 1.0)

    def test_an_empty_stratum_is_reported_as_empty_rather_than_as_zero(self):
        left = {"e1": episode("e1", True)}
        right = {"e1": episode("e1", True)}
        report = aggregate.strata(left, right)
        self.assertEqual(report["hard"]["games"], 0)
        self.assertIsNone(report["hard"]["delta"])


class LabelTest(unittest.TestCase):
    """A configuration is part of an arm's identity, or two treatments are read as one."""

    def setUp(self):
        self.paths = []
        # `mkdtemp` and a `tearDown` rather than `enterContext`: that helper arrived in 3.11 and CI runs 3.10, so
        # the first version of this class passed here and failed there. `scripts/check-python-floor.py` now fails
        # the gate on the version-specific API rather than on its symptom.
        self.directory = Path(tempfile.mkdtemp(prefix="aggregate-label-"))

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, name: str, arm: str, label: str, games: "list[str]") -> Path:
        path = self.directory / name
        path.write_text(
            json.dumps(
                {
                    "summary": summary(arm, arm_label=label),
                    "episodes": [episode(game, True, digest="d") for game in games],
                }
            ),
            encoding="utf-8",
        )
        self.paths.append(path)
        return path

    def test_two_configurations_of_one_family_are_two_groups(self):
        first = self.write("a.json", "retrieved", "retrieved@k1", ["g1"])
        second = self.write("b.json", "retrieved", "retrieved", ["g1"])
        grouped = aggregate.load_slices([first, second])
        self.assertEqual(sorted(grouped), ["retrieved", "retrieved@k1"])
        self.assertEqual(len(grouped["retrieved"]), 1)

    def test_the_label_is_what_is_grouped_and_the_family_is_what_is_validated(self):
        # An artefact written before the field existed groups by its arm, so the reading still works on the
        # artefacts the failed run produced.
        path = self.write("c.json", "none", "none", ["g1"])
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["summary"].pop("arm_label")
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.assertEqual(sorted(aggregate.load_slices([path])), ["none"])

    def test_a_label_that_does_not_belong_to_its_family_is_refused(self):
        # A hand-edited or mis-wired label would otherwise make two arms comparable under one name, which is the
        # defect the label exists to prevent.
        path = self.write("d.json", "none", "always-in@k1", ["g1"])
        with self.assertRaises(SystemExit):
            aggregate.load_slices([path])


class ReadingTest(unittest.TestCase):
    def test_discordance_counts_disagreements_only(self):
        pairs = [(True, False), (False, True), (True, True), (False, False)]
        self.assertEqual(aggregate.discordance(pairs), (1, 1))

    def test_mde_falls_as_games_grow_and_rises_as_the_arms_disagree_more(self):
        self.assertGreater(aggregate.mde_of(40, 134), aggregate.mde_of(40, 268))
        self.assertGreater(aggregate.mde_of(80, 134), aggregate.mde_of(40, 134))

    def test_mde_at_the_registered_discordance_reproduces_13_3pp(self):
        # 40 discordant games over 134 is 30% discordance, which is the figure the registration quotes.
        self.assertAlmostEqual(aggregate.mde_of(40, 134), 0.1323, places=3)

    def test_mde_of_no_games_is_nan_rather_than_zero(self):
        self.assertNotEqual(aggregate.mde_of(0, 0), aggregate.mde_of(0, 0))

    def test_a_unanimous_split_has_a_zero_delta_and_a_zero_width_interval(self):
        report = aggregate.bootstrap_delta([(True, True)] * 5 + [(False, False)] * 5, 200, 1)
        self.assertEqual(report["delta"], 0.0)
        self.assertEqual(report["ci_low"], 0.0)
        self.assertEqual(report["ci_high"], 0.0)

    def test_a_total_separation_has_an_interval_that_excludes_zero(self):
        report = aggregate.bootstrap_delta([(True, False)] * 20, 500, 1)
        self.assertEqual(report["delta"], 1.0)
        self.assertGreater(report["ci_low"], 0.0)
        self.assertLess(report["p_two_sided"], 0.01)

    def test_the_same_seed_gives_the_same_interval(self):
        pairs = [(True, False)] * 6 + [(False, True)] * 4 + [(True, True)] * 5
        first = aggregate.bootstrap_delta(pairs, 300, 7)
        second = aggregate.bootstrap_delta(pairs, 300, 7)
        self.assertEqual(first, second)

    def test_an_interval_that_spans_zero_says_so(self):
        pairs = [(True, False)] * 5 + [(False, True)] * 5
        report = aggregate.bootstrap_delta(pairs, 400, 3)
        self.assertLess(report["ci_low"], 0.0)
        self.assertGreater(report["ci_high"], 0.0)

    def test_no_pairs_is_an_error(self):
        with self.assertRaises(SystemExit):
            aggregate.bootstrap_delta([], 10, 1)


class BillTest(unittest.TestCase):
    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, body: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(body), encoding="utf-8")
        self.paths.append(path)
        return path

    def test_sums_every_slice_and_keeps_the_bands_apart(self):
        first = self.write("b-a.json", {"summary": summary("none", bill={"usd": 0.5, "band": "off_peak", "usd_in_other_band": 1.0})})
        second = self.write("b-b.json", {"summary": summary("none", bill={"usd": 0.25, "band": "peak", "usd_in_other_band": 0.125})})
        bill = aggregate.bill_of_slices([first, second])
        self.assertAlmostEqual(bill["usd"], 0.75)
        self.assertEqual(bill["bands"], ["off_peak", "peak"])
        self.assertEqual(bill["calls"], 20)
        self.assertEqual(bill["usage"]["prompt_tokens"], 200)
        self.assertEqual(bill["cache_hit_rate"], 0.9)


class CarriedTest(unittest.TestCase):
    """The counter that says whether the treatment was in the prompt, and the refusal when it was not.

    R174.2's arm carried an empty pack in 134 of 134 games and reported 81/134 against a control of 90 — a
    number that read as "the gate costs 13 points" and was in fact the control's own score under another name.
    Every other counter was healthy: engagement 88.1%, six by-kind rows, a bill. The lesson is that `pack_entries`
    is not one of the per-kind diagnostics; it is the admission test for the whole reading.
    """

    def test_the_counts_are_the_artefacts_own_numbers(self):
        counts = aggregate.carried([episode("g1", True, pack_entries=2), episode("g2", False, pack_entries=2),
                                    episode("g3", True, pack_entries=1)])
        self.assertEqual(counts["by_entries"], {1: 1, 2: 2})
        self.assertEqual(counts["games"], 3)
        self.assertEqual(counts["mean"], 1.667)

    def test_an_artefact_without_the_field_has_no_counts_rather_than_zero_ones(self):
        # The distinction matters: `games: 0` says "this file cannot answer", and the refusal below passes it
        # over. A zero mean would say "it carried nothing", which is a different and unfounded claim about a
        # file written before the field existed.
        counts = aggregate.carried([episode("g1", True), episode("g2", False)])
        self.assertEqual(counts["games"], 0)
        self.assertIsNone(counts["mean"])
        self.assertIsNone(aggregate.empty_pack_reason("always-in", counts))

    def test_a_pack_arm_that_carried_nothing_is_refused(self):
        counts = aggregate.carried([episode("g1", True, pack_entries=0), episode("g2", False, pack_entries=0)])
        reason = aggregate.empty_pack_reason("always-in", counts)
        self.assertIn("empty pack in 2 of 2 games", reason)

    def test_a_gated_arm_that_carried_some_games_is_readable(self):
        # A gate is *meant* to admit nothing sometimes; what makes an arm void is admitting nothing anywhere.
        counts = aggregate.carried([episode("g1", True, pack_entries=1), episode("g2", False, pack_entries=0)])
        self.assertIsNone(aggregate.empty_pack_reason("retrieved@kind", counts))

    def test_a_control_that_carried_entries_is_refused(self):
        counts = aggregate.carried([episode("g1", True, pack_entries=2)])
        self.assertIn("arm none carried entries", aggregate.empty_pack_reason("none", counts))

    def test_a_renamed_arm_is_judged_by_its_family_and_a_nameless_one_is_not_judged(self):
        # The family is the part of the label before `@`, which is how `arm_label` builds it. A cross-dispatch
        # rename (`--relabel retrieved=retrieved@k3`) keeps a family; an arbitrary target (`bare-pair`) does not,
        # and a check that guessed would refuse the one pairing whose provenance is printed.
        empty = aggregate.carried([episode("g1", True, pack_entries=0)])
        self.assertIn("arm retrieved@g0.2 carried an empty pack", aggregate.empty_pack_reason("retrieved@g0.2", empty))
        self.assertIsNone(aggregate.empty_pack_reason("bare-pair", empty))

    def test_the_pack_length_is_reported_beside_the_entry_count(self):
        # R176 is a length match -- a 505-character trajectory against a 489-character sentence -- so the reading
        # has to be able to say what each arm actually rendered. `prefix_chars` cannot: it contains the few-shot
        # examples as well, and an arm whose pack was the wrong length would still show a plausible prefix.
        counts = aggregate.carried([
            episode("g1", True, pack_entries=1, pack_chars=505),
            episode("g2", False, pack_entries=1, pack_chars=505),
            episode("g3", True, pack_entries=0, pack_chars=0),
        ])
        self.assertEqual(counts["by_chars"], {0: 1, 505: 2})

    def test_an_artefact_without_pack_chars_reports_no_lengths(self):
        # Same rule as `pack_entries`: a file written before the field existed cannot answer, and an answer of
        # zero would be a claim about the prompt that nothing measured.
        counts = aggregate.carried([episode("g1", True, pack_entries=1), episode("g2", False, pack_entries=1)])
        self.assertEqual(counts["by_chars"], {})

    def test_the_length_is_printed_under_the_carried_line(self):
        original = sys.argv
        treatment = HERE / "length-a.json"
        control = HERE / "length-b.json"
        treatment.write_text(
            json.dumps({
                "summary": summary("always-in"),
                "episodes": [episode("g1", True, pack_entries=1, pack_chars=505),
                             episode("g2", False, pack_entries=1, pack_chars=505)],
            }),
            encoding="utf-8",
        )
        control.write_text(
            json.dumps({
                "summary": summary("none"),
                "episodes": [episode("g1", False, pack_entries=0, pack_chars=0),
                             episode("g2", True, pack_entries=0, pack_chars=0)],
            }),
            encoding="utf-8",
        )
        sys.argv = ["aggregate.py", "--input", str(treatment), "--input", str(control), "--compare", "always-in,none"]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (treatment, control):
                path.unlink(missing_ok=True)
        printed = buffer.getvalue()
        self.assertIn("pack chars      always-in 505 ch x2", printed)
        self.assertIn("pack chars      none 0 ch x2", printed)
        # And the line has to sit under `carried`, above the delta: the admission test comes before the effect.
        self.assertLess(printed.index("pack chars      always-in"), printed.index("paired delta"))

    def test_the_pass_refuses_an_empty_pack_treatment_before_it_prints_a_delta(self):
        original = sys.argv
        treatment = HERE / "carry-a.json"
        control = HERE / "carry-b.json"
        treatment.write_text(
            json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", True, pack_entries=0)]}),
            encoding="utf-8",
        )
        control.write_text(
            json.dumps({"summary": summary("none"), "episodes": [episode("g1", False, pack_entries=0)]}),
            encoding="utf-8",
        )
        sys.argv = ["aggregate.py", "--input", str(treatment), "--input", str(control), "--compare", "always-in,none"]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer), self.assertRaises(SystemExit):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (treatment, control):
                path.unlink(missing_ok=True)
        self.assertNotIn("paired delta", buffer.getvalue())

    def test_the_dropped_line_names_the_field_or_says_the_file_predates_it(self):
        # The repair is only visible in a comparison if the print distinguishes "counted, and zero" from
        # "this file has no such field". A reader comparing an arm from before AUDIT 34.259 against one from
        # after needs the difference stated on the line itself, not inferred from a missing number.
        original = sys.argv
        after = HERE / "dropped-after.json"
        before = HERE / "dropped-before.json"
        after.write_text(
            json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", True, refused_actions=2)]}),
            encoding="utf-8",
        )
        before.write_text(
            json.dumps({"summary": summary("none"), "episodes": [episode("g1", False)]}),
            encoding="utf-8",
        )
        sys.argv = ["aggregate.py", "--input", str(after), "--input", str(before), "--compare", "always-in,none"]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (after, before):
                path.unlink(missing_ok=True)
        printed = buffer.getvalue()
        self.assertIn("dropped         always-in 2 (", printed)
        self.assertIn("vs none not counted", printed)


class MainTest(unittest.TestCase):
    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, body: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(body), encoding="utf-8")
        self.paths.append(path)
        return path

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["aggregate.py"] + argv
        try:
            return aggregate.main()
        finally:
            sys.argv = original

    def slices(self, treatment_wins, control_wins):
        games = [f"g{index}" for index in range(len(treatment_wins))]
        treatment = self.write(
            "m-a.json",
            {"summary": summary("always-in"), "episodes": [episode(g, w) for g, w in zip(games, treatment_wins)]},
        )
        control = self.write(
            "m-b.json",
            {"summary": summary("none"), "episodes": [episode(g, w) for g, w in zip(games, control_wins)]},
        )
        return treatment, control

    def test_a_complete_pairing_writes_a_reading(self):
        treatment, control = self.slices([True, True, True, False], [False, False, False, False])
        out = HERE / "pair.json"
        self.paths.append(out)
        self.assertEqual(
            self.run_main(["--input", str(treatment), "--input", str(control), "--compare", "always-in,none", "--expect", "4", "--out", str(out)]),
            0,
        )
        reading = json.loads(out.read_text(encoding="utf-8"))["readings"][0]
        self.assertEqual(reading["games"], 4)
        self.assertEqual(reading["wins"], {"always-in": 3, "none": 0})
        self.assertEqual(reading["discordant"], {"treatment_only": 3, "control_only": 0, "total": 3})

    def test_arms_that_did_not_drive_the_same_games_are_refused(self):
        treatment = self.write("x-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        control = self.write("x-b.json", {"summary": summary("none"), "episodes": [episode("g2", True)]})
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(treatment), "--input", str(control), "--compare", "always-in,none"])

    def test_an_arm_that_no_slice_carries_is_refused(self):
        treatment = self.write("y-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(treatment), "--compare", "retrieved,none"])

    def test_a_pass_can_be_joined_without_writing_a_file(self):
        treatment, control = self.slices([True, False], [False, True])
        self.assertEqual(
            self.run_main(["--input", str(treatment), "--input", str(control), "--compare", "always-in,none", "--rounds", "50"]),
            0,
        )

    def test_one_invocation_reads_every_pair_a_dispatch_produced(self):
        # Three arms in one sweep is two questions -- always-in against none, and retrieved against
        # none -- and reading them in two invocations is two chances to quote one and forget the other.
        games = ["g1", "g2", "g3", "g4"]
        none = self.write(
            "p-none.json",
            {"summary": summary("none"), "episodes": [episode(g, g in ("g1", "g2")) for g in games]},
        )
        always = self.write(
            "p-always.json",
            {"summary": summary("always-in"), "episodes": [episode(g, g in ("g1", "g2", "g3"), digest=f"a{g}") for g in games]},
        )
        retrieved = self.write(
            "p-retrieved.json",
            {"summary": summary("retrieved"), "episodes": [episode(g, False, digest=f"r{g}") for g in games]},
        )
        out = HERE / "pairs.json"
        self.paths.append(out)
        self.assertEqual(
            self.run_main(
                [
                    "--input", str(none), "--input", str(always), "--input", str(retrieved),
                    "--compare", "always-in,none;retrieved,none", "--rounds", "50", "--out", str(out),
                ]
            ),
            0,
        )
        payload = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual([reading["treatment"] for reading in payload["readings"]], ["always-in", "retrieved"])
        self.assertEqual(payload["readings"][0]["wins"]["always-in"], 3)
        self.assertEqual(payload["readings"][1]["wins"]["retrieved"], 0)

    def test_the_reading_carries_the_decomposition_it_was_asked_for(self):
        games = ["g1", "g2", "g3", "g4"]
        treatment = self.write(
            "d-a.json",
            {"summary": summary("always-in"), "episodes": [episode(g, g == "g1", digest=f"a{g}") for g in games]},
        )
        control = self.write(
            "d-b.json",
            {"summary": summary("none"), "episodes": [episode(g, g == "g2", digest=f"b{g}") for g in games]},
        )
        out = HERE / "decomposed.json"
        self.paths.append(out)
        self.run_main(
            ["--input", str(treatment), "--input", str(control), "--compare", "always-in,none", "--rounds", "50", "--out", str(out)]
        )
        payload = json.loads(out.read_text(encoding="utf-8"))
        first = payload["readings"][0]
        self.assertEqual(first["engagement"]["diverged"], 4)
        self.assertEqual(first["engagement"]["identical"], 0)
        self.assertIn("put", first["kinds"])
        # Refusals belong to the arm, not to the pair, so they sit beside the readings rather than inside
        # one of them: the same arm's refusal rate does not change with what it is being compared to.
        self.assertEqual(payload["refusals"]["always-in"]["games"], 4)

    def test_a_pair_naming_an_arm_no_slice_carries_is_refused_even_beside_a_good_one(self):
        treatment, control = self.slices([True], [False])
        with self.assertRaises(SystemExit):
            self.run_main(
                ["--input", str(treatment), "--input", str(control), "--compare", "always-in,none;placebo,none", "--rounds", "50"]
            )

    def test_a_malformed_pair_is_refused_rather_than_unpacked(self):
        # `--compare always-in` names one arm where a pair was wanted. Unpacking it raises a ValueError
        # from three frames down, which reads as a crash; the refusal has to name the flag.
        treatment, control = self.slices([True], [False])
        for spec in ("always-in", "always-in,", ",none"):
            with self.assertRaises(SystemExit):
                self.run_main(["--input", str(treatment), "--input", str(control), "--compare", spec, "--rounds", "50"])

    def test_arms_that_overlap_partially_are_refused(self):
        # Two arms that share one game and disagree elsewhere are the case an innocent-looking join gets
        # wrong: the shared game produces a delta and the other two are silently dropped from both sides.
        treatment = self.write(
            "o-a.json",
            {"summary": summary("always-in"), "episodes": [episode("g1", True), episode("g2", True)]},
        )
        control = self.write(
            "o-b.json",
            {"summary": summary("none"), "episodes": [episode("g1", False), episode("g3", False)]},
        )
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(treatment), "--input", str(control), "--compare", "always-in,none"])


class RelabelTest(unittest.TestCase):
    """Two dispatches' treatments, paired — the reading that does not need a control.

    The control's own rate has moved 80 → 81 → 89 → 90 on the same 134 games, which is a seven-point floor
    under every delta this lane quotes. Two treatments do not have that problem: they both drove every game
    through the same model, and the difference between them is the difference between two blocks. The
    rename is the switch that allows both in one join, and these tests pin what it refuses.
    """

    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, body: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(body), encoding="utf-8")
        self.paths.append(path)
        return path

    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["aggregate.py"] + argv
        try:
            return aggregate.main()
        finally:
            sys.argv = original

    def test_two_dispatches_of_one_family_are_paired_once_renamed(self):
        left = self.write(
            "r-a.json",
            {"summary": summary("always-in", arm_label="always-in@dose-a"), "episodes": [episode("g1", True), episode("g2", True)]},
        )
        right = self.write(
            "r-b.json",
            {"summary": summary("always-in", arm_label="always-in@dose-b"), "episodes": [episode("g1", True), episode("g2", False)]},
        )
        out = HERE / "crossrun.json"
        self.paths.append(out)
        self.assertEqual(
            self.run_main(
                [
                    "--input", str(left), "--input", str(right),
                    "--compare", "left,right",
                    "--relabel", "always-in@dose-a=left",
                    "--relabel", "always-in@dose-b=right",
                    "--expect", "2", "--out", str(out), "--rounds", "50",
                ]
            ),
            0,
        )
        reading = json.loads(out.read_text(encoding="utf-8"))["readings"][0]
        self.assertEqual(reading["wins"], {"left": 2, "right": 1})
        self.assertEqual(reading["discordant"], {"treatment_only": 1, "control_only": 0, "total": 1})

    def test_a_rename_names_the_cross_dispatch_pairing_in_the_report(self):
        # A pairing whose provenance is silent reads as an ordinary within-run reading, and the difference
        # matters: an open interval here cannot be blamed on the control's afternoon.
        left = self.write("rn-a.json", {"summary": summary("always-in", arm_label="always-in@a"), "episodes": [episode("g1", True)]})
        right = self.write("rn-b.json", {"summary": summary("always-in", arm_label="always-in@b"), "episodes": [episode("g1", False)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.run_main(
                [
                    "--input", str(left), "--input", str(right),
                    "--compare", "x,y", "--relabel", "always-in@a=x", "--relabel", "always-in@b=y",
                    "--rounds", "50",
                ]
            )
        self.assertIn("relabelled      always-in@a=x", printed.getvalue())

    def test_two_dispatches_of_one_arm_are_joinable_by_naming_the_slice(self):
        # The case the arm form cannot reach: both runs carry `arm_label: always-in`, so they land in one group
        # and tile refuses the duplicate games. Naming the file is the only way to say which run is which.
        left = self.write("p-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True), episode("g2", True)]})
        right = self.write("p-b.json", {"summary": summary("always-in"), "episodes": [episode("g1", True), episode("g2", False)]})
        out = HERE / "by-path.json"
        self.paths.append(out)
        self.assertEqual(
            self.run_main(
                [
                    "--input", str(left), "--input", str(right),
                    "--compare", "always-in@placement,always-in@search",
                    "--relabel", f"{left.name}=always-in@placement",
                    "--relabel", f"{right.name}=always-in@search",
                    "--expect", "2", "--out", str(out), "--rounds", "50",
                ]
            ),
            0,
        )
        reading = json.loads(out.read_text(encoding="utf-8"))["readings"][0]
        self.assertEqual(reading["wins"], {"always-in@placement": 2, "always-in@search": 1})

    def test_a_path_rename_that_drops_the_family_is_refused(self):
        # The family is what `aggregate` validates a label against; a label without one is an arm nobody can check.
        left = self.write("pq-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(left), "--compare", "placement,none", "--relabel", f"{left.name}=placement"])

    def test_a_path_that_no_input_carries_is_refused(self):
        left = self.write("pr-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        control = self.write("pr-b.json", {"summary": summary("none"), "episodes": [episode("g1", False)]})
        with self.assertRaises(SystemExit):
            self.run_main(
                [
                    "--input", str(left), "--input", str(control), "--compare", "always-in,none",
                    "--relabel", "arm-always-in-9.json=always-in@x",
                ]
            )

    def test_a_basename_that_names_two_inputs_is_refused_rather_than_half_renamed(self):
        # Two runs, the same four shard names: renaming by basename would move one run's shard and leave the
        # other's under the old label, which is a join whose two sides are one run and three quarters of another.
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            left = Path(first) / "arm-always-in-0.json"
            right = Path(second) / "arm-always-in-0.json"
            left.write_text(json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", True)]}), encoding="utf-8")
            right.write_text(json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", False)]}), encoding="utf-8")
            with self.assertRaises(SystemExit):
                self.run_main(
                    ["--input", str(left), "--input", str(right), "--compare", "always-in@a,always-in@b",
                     "--relabel", "arm-always-in-0.json=always-in@a"]
                )

    def test_the_full_path_disambiguates_what_the_basename_could_not(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            left = Path(first) / "arm-always-in-0.json"
            right = Path(second) / "arm-always-in-0.json"
            left.write_text(json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", True)]}), encoding="utf-8")
            right.write_text(json.dumps({"summary": summary("always-in"), "episodes": [episode("g1", False)]}), encoding="utf-8")
            self.assertEqual(
                self.run_main(
                    ["--input", str(left), "--input", str(right), "--compare", "always-in@a,always-in@b",
                     "--relabel", f"{left}=always-in@a", "--relabel", f"{right}=always-in@b", "--rounds", "50"]
                ),
                0,
            )

    def test_a_source_that_no_slice_carries_is_refused(self):
        left = self.write("rs-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(left), "--compare", "always-in,none", "--relabel", "sham=placebo"])

    def test_a_rename_onto_an_arm_already_present_is_refused(self):
        # Merging is the failure this refuses: two groups under one name tile the split twice, and every
        # rate downstream is then over a denominator nobody can check.
        left = self.write("rc-a.json", {"summary": summary("always-in", arm_label="always-in@a"), "episodes": [episode("g1", True)]})
        right = self.write("rc-b.json", {"summary": summary("always-in", arm_label="always-in@b"), "episodes": [episode("g1", False)]})
        with self.assertRaises(SystemExit):
            self.run_main(["--input", str(left), "--input", str(right), "--compare", "always-in@a,always-in@b", "--relabel", "always-in@b=always-in@a"])

    def test_a_spec_that_is_not_old_equals_new_is_refused(self):
        left = self.write("rd-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        for spec in ("always-in", "=x", "always-in=", "always-in=x=y"):
            with self.assertRaises(SystemExit):
                self.run_main(["--input", str(left), "--compare", "always-in,none", "--relabel", spec])

    def test_a_rename_to_itself_leaves_one_group(self):
        left = self.write("re-a.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        control = self.write("re-b.json", {"summary": summary("none"), "episodes": [episode("g1", False)]})
        self.assertEqual(
            self.run_main(
                ["--input", str(left), "--input", str(control), "--compare", "always-in,none", "--relabel", "always-in=always-in", "--rounds", "50"]
            ),
            0,
        )



class CapTest(unittest.TestCase):
    """The join refuses to pool two step caps until it says that is what it is comparing.

    R184 makes the turn budget a variable for the first time, and the budget is a *harness* exactly as the reader is:
    one arm cannot be driven at two caps, and a rate pooled over two caps is a rate about the budget. The strictness is
    the same as the channel's and for a sharper reason: the cap's price is not symmetric between arms (R184 computes 15
    games for the bank and 40 for the control), so an undeclared cap span is not an average of two populations but a
    comparison whose difference is partly arithmetic.
    """

    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.paths.append(path)
        return path

    def test_an_artefact_from_before_the_field_is_fifty_steps(self):
        # Every reading before R184 was driven at the environment's own cap, which is the driver's default. Reading a
        # missing field as "unknown" would make the cap span unreadable; reading it as anything else would be a guess.
        old = self.write("cap-old.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        self.assertEqual(aggregate.caps(aggregate.load_slices([old])), {"none": "50"})

    def test_a_join_that_spans_two_caps_is_refused_until_it_names_them(self):
        left = self.write(
            "cap-50.json", {"summary": summary("none"), "episodes": [episode("g1", True), episode("g2", False)]}
        )
        right = self.write(
            "cap-30.json",
            {"summary": summary("always-in", max_steps=30), "episodes": [episode("g3", True), episode("g4", True)]},
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right])
        self.assertIn("--expect-caps", printed.getvalue())

    def test_one_arm_cannot_span_two_caps(self):
        # The same label driven at two budgets is two treatments, and averaging them prints a rate nobody designed.
        left = self.write("cap-a.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write(
            "cap-b.json", {"summary": summary("none", max_steps=30), "episodes": [episode("g2", True)]}
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right], (), (), (), (50, 30))
        self.assertIn("two budgets", printed.getvalue())

    def test_a_named_cap_span_is_allowed(self):
        left = self.write("cap-c.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write(
            "cap-d.json", {"summary": summary("always-in", max_steps=30), "episodes": [episode("g2", True)]}
        )
        grouped = aggregate.load_slices([left, right], (), (), (), (50, 30))
        self.assertEqual(aggregate.caps(grouped), {"none": "50", "always-in": "30"})

    def test_a_declared_span_the_slices_do_not_have_is_refused(self):
        # A declaration is a claim about the artefacts, so a join that names 30 and drove 20 is refused: the reading's
        # own arithmetic would be about a budget nobody bought.
        left = self.write("cap-e.json", {"summary": summary("none"), "episodes": [episode("g1", True)]})
        right = self.write(
            "cap-f.json", {"summary": summary("always-in", max_steps=20), "episodes": [episode("g2", True)]}
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right], (), (), (), (50, 30))
        self.assertIn("--expect-caps", printed.getvalue())

    def test_a_cap_that_is_not_a_number_is_refused(self):
        # `max_steps` arrives from a JSON artefact, not from this parser, so it is the one field in the header the
        # join cannot assume was validated on the way in.
        odd = self.write("cap-g.json", {"summary": summary("none", max_steps="thirty"), "episodes": [episode("g1", True)]})
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([odd])
        self.assertIn("max_steps", printed.getvalue())


    def test_the_pass_prints_the_budget_of_each_arm(self):
        # R184's whole point is that a cap is not neutral, so a reading whose two arms ran at two caps has to print
        # both above the delta: the number is then partly a statement about the budget, and nothing else in the
        # output would say which budget either arm had.
        original = sys.argv
        treatment = HERE / "cap-print-a.json"
        control = HERE / "cap-print-b.json"
        treatment.write_text(
            json.dumps({"summary": summary("always-in", max_steps=30), "episodes": [episode("g1", True, max_steps=30)]}),
            encoding="utf-8",
        )
        control.write_text(
            json.dumps({"summary": summary("none"), "episodes": [episode("g1", False)]}), encoding="utf-8"
        )
        sys.argv = [
            "aggregate.py", "--input", str(treatment), "--input", str(control),
            "--compare", "always-in,none", "--expect-caps", "50,30",
        ]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (treatment, control):
                path.unlink(missing_ok=True)
        printed = buffer.getvalue()
        self.assertIn("budget          always-in 30", printed)
        self.assertIn("vs none 50", printed)

    def test_a_declared_cap_that_is_not_a_number_is_refused(self):
        # `--expect-caps 3o` would otherwise raise from `int()` three frames down and read as a crash rather than as
        # a dispatch that named a budget that does not exist.
        original = sys.argv
        slice_path = HERE / "cap-print-c.json"
        slice_path.write_text(
            json.dumps({"summary": summary("none"), "episodes": [episode("g1", True)]}), encoding="utf-8"
        )
        sys.argv = ["aggregate.py", "--input", str(slice_path), "--compare", "none,none", "--expect-caps", "3o"]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer), self.assertRaises(SystemExit):
                aggregate.main()
        finally:
            sys.argv = original
            slice_path.unlink(missing_ok=True)
        self.assertIn("--expect-caps '3o' is not a step count", buffer.getvalue())


class BankTest(unittest.TestCase):
    """The pack is the harness's payload, and until R185 the artefact did not say which one produced it.

    R185 swaps 197 characters of a 551-character bank and holds the label, the length and the reader still. The two
    runs therefore agree on every field the join used to read — `arm_label` `always-in`, `pack_chars` 551,
    `pack_entries` 1 — so a join of them would have averaged two prompts into one rate and printed it under one name.
    That is the defect R183 found for the reader and R184 for the budget, one harness component further in, and the
    rule is the same: one label is one pack, and a join across packs says so.
    """

    def setUp(self):
        self.paths = []

    def tearDown(self):
        for path in self.paths:
            path.unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        path = HERE / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.paths.append(path)
        return path

    def test_an_artefact_from_before_the_field_has_no_bank(self):
        # Every reading before R185 predates the digest, and "no bank recorded" is what those files can prove. It is
        # not treated as the empty pack: an unrecorded bank is unknown, which is why it cannot be silently pooled.
        old = self.write("bank-old.json", {"summary": summary("always-in"), "episodes": [episode("g1", True)]})
        self.assertEqual(aggregate.banks(aggregate.load_slices([old])), {"always-in": ""})

    def test_one_arm_cannot_span_two_banks(self):
        # The R185 case exactly: same label, same length, different prompt. Averaging is not an option the join has.
        left = self.write(
            "bank-a.json",
            {"summary": summary("always-in", bank_digest="aaaa1111"), "episodes": [episode("g1", True)]},
        )
        right = self.write(
            "bank-b.json",
            {"summary": summary("always-in", bank_digest="bbbb2222"), "episodes": [episode("g2", True)]},
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([left, right])
        self.assertIn("cannot span two banks", printed.getvalue())

    def test_a_control_is_not_a_bank_and_joins_freely(self):
        # The comparison every round makes: a treatment that renders a pack against a control that renders none. The
        # empty string is not a second bank, or every memory-versus-control delta in the lane would be refused.
        treatment = self.write(
            "bank-c.json",
            {"summary": summary("always-in", bank_digest="aaaa1111"), "episodes": [episode("g1", True)]},
        )
        control = self.write("bank-d.json", {"summary": summary("none"), "episodes": [episode("g2", False)]})
        grouped = aggregate.load_slices([treatment, control])
        self.assertEqual(aggregate.banks(grouped), {"always-in": "aaaa1111", "none": ""})

    def test_two_slices_of_the_same_bank_are_one_bank(self):
        # Four shards of one dispatch carry one digest; a guard that refused them would refuse every normal join.
        left = self.write(
            "bank-e.json",
            {"summary": summary("always-in", bank_digest="aaaa1111"), "episodes": [episode("g1", True)]},
        )
        right = self.write(
            "bank-f.json",
            {"summary": summary("always-in", bank_digest="aaaa1111"), "episodes": [episode("g2", True)]},
        )
        self.assertEqual(aggregate.load_slices([left, right])["always-in"][0]["bank_digest"], "aaaa1111")

    def test_a_bank_that_is_not_a_string_is_refused(self):
        # The digest arrives from JSON and is compared by equality with other strings, so a number would make two
        # different banks look the same the moment both were written as one. Refused where it is read.
        odd = self.write(
            "bank-g.json", {"summary": summary("always-in", bank_digest=7), "episodes": [episode("g1", True)]}
        )
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed), self.assertRaises(SystemExit):
            aggregate.load_slices([odd])
        self.assertIn("bank_digest", printed.getvalue())

    def test_a_gated_run_may_carry_several_packs_and_one_bank(self):
        # R186's shape, and the reason the guard reads the summary rather than the episodes: one bank with two
        # kind-tagged entries hands `put` one sentence and the other five kinds another, so the *packs* differ inside a
        # pass while the *bank* does not. A guard keyed on the pack would refuse the round it was built for.
        run = self.write(
            "bank-gated.json",
            {
                "summary": summary("always-in", bank_digest="cccc3333", gate_kind=True),
                "episodes": [
                    episode("g1", True, pack_digest="aaaa1111"),
                    episode("g2", True, pack_digest="bbbb2222"),
                ],
            },
        )
        grouped = aggregate.load_slices([run])
        self.assertEqual(aggregate.banks(grouped), {"always-in": "cccc3333"})
        self.assertEqual(
            sorted(episode["pack_digest"] for episode in grouped["always-in"]), ["aaaa1111", "bbbb2222"]
        )

    def test_the_pass_prints_the_bank_of_each_arm(self):
        original = sys.argv
        treatment = HERE / "bank-print-a.json"
        control = HERE / "bank-print-b.json"
        treatment.write_text(
            json.dumps(
                {
                    "summary": summary("always-in", bank_digest="abcd1234efgh5678"),
                    "episodes": [episode("g1", True, pack_digest="1111")],
                }
            ),
            encoding="utf-8",
        )
        control.write_text(json.dumps({"summary": summary("none"), "episodes": [episode("g1", False)]}), encoding="utf-8")
        sys.argv = ["aggregate.py", "--input", str(treatment), "--input", str(control), "--compare", "always-in,none"]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                aggregate.main()
        finally:
            sys.argv = original
            for path in (treatment, control):
                path.unlink(missing_ok=True)
        printed = buffer.getvalue()
        self.assertIn("bank            always-in abcd1234 vs none no pack", printed)

if __name__ == "__main__":
    unittest.main(verbosity=2)
