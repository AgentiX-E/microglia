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
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import aggregate  # noqa: E402


def episode(game: str, won: bool) -> dict:
    return {"gamefile": game, "won": won, "steps": 7, "usage": {}, "calls": 3}


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
        reading = json.loads(out.read_text(encoding="utf-8"))["reading"]
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
