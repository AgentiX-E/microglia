"""The joining step's tests: what it refuses, and what the paired reading is made of.

The failures this file guards are the ones that produce a number rather than an error. A game counted
twice, an arm missing a slice, a control whose games do not coincide with the treatment's — each of those
still yields a delta if it is averaged, and the delta is wrong in a direction nobody can see. So the tests
are mostly about refusals, and the arithmetic tests exist to pin the two definitions that are easy to get
backwards: the discordance counts games where the arms *disagree*, and the interval resamples games.
"""

from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
