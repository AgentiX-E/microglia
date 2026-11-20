"""`floor.py` measured without the environment it measures.

The floor is the lane's one zero-cost arm, and it is the arm every price in the registration rests on: if the
split is not covered, or an episode does not terminate, or the same seed does not replay, then the paired delta
is arithmetic over a corpus nobody has driven. Those three properties are asserted inside `run`, which means the
assertions themselves are the product -- a floor whose coverage check silently passed on one game driven 134
times would report a rate and a variance figure with no defect anywhere in its own output.

So the tests below supply the environment. `Scripted` is not a mock of `AlfredTWEnv`: it is the four shapes
`drive` reads (`observation[0]`, `info["extra"]["gamefile"]`, `info["admissible_commands"][0]`, `dones[0]`),
written out so that a test can be wrong about them in the same way the driver can. The injection point is the
one `build_env` already had -- `shell_factory` -- because the alternative was patching this module from the
test, which tests the patch.

What is deliberately not covered: the single line `sys.exit(main())` under the `__main__` guard. It is the
process entry point, no import reaches it, and `DefaultShellTest` covers the branch it calls -- including the
`alfworld` import, which is supplied through `sys.modules` because the package is not installed here. The one
line is reported by `coverage` rather than hidden behind a pragma.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import floor  # noqa: E402

try:  # The workflow's unit job installs pyyaml; a developer's machine may not have it.
    import yaml  # noqa: F401

    HAS_YAML = True
except ImportError:  # pragma: no cover - the branch that only a machine without pyyaml takes
    HAS_YAML = False


def captured(function, *args, **kwargs):
    """The call's return value and everything it printed. `run` reports through stdout, so its report is a
    test surface in its own right: the assertions it prints are what a reader of a green job sees."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        result = function(*args, **kwargs)
    return result, buffer.getvalue()


def scripted(gamefile: str = "/d/valid_unseen/a/game.tw-pddl", steps: int = 2, won=True, **overrides) -> dict:
    """One episode's script, in the shapes `drive` reads.

    `won` is tri-state on purpose: `True`/`False` write the `won` key the batch wrapper publishes, and `None`
    leaves it out, which is the case a wrapper that only reports a verdict on some episodes would produce.
    """
    game = {
        "gamefile": gamefile,
        "admissible": [["look", "go north"]] * (steps + 1),
        "observations": ["You are in the middle of a room."] + [f"step {index}" for index in range(1, steps + 1)],
        "dones": [False] * max(0, steps - 1) + [True] * (1 if steps else 0),
        "wins": [won] * steps if won is not None else None,
    }
    game.update(overrides)
    return game


class Scripted:
    """A textworld-shaped environment whose every answer the test wrote.

    It carries `num_games` and `init_env` because that is what `build_env` hands back after calling the shell,
    and it advances one game per `reset` because that is what the batch wrapper does at `batch_size=1`.
    """

    def __init__(self, games: "list[dict]") -> None:
        self.games = games
        self.num_games = len(games)
        self.index = -1
        self.cursor = 0
        self.batch_size = None

    def init_env(self, batch_size: int = 1):
        self.batch_size = batch_size
        return self

    def reset(self):
        self.index += 1
        self.cursor = 0
        game = self.games[self.index]
        gamefile = game["gamefile"]
        # The key is the flat string `extra.gamefile`, not a nested dict: that is the shape the wrapper this
        # repository does not own injects, and it is the reason `drive` reads it as one key.
        info = {
            "extra.gamefile": [gamefile] if game.get("gamefile_as_list", True) else gamefile,
            "admissible_commands": [list(game["admissible"][0])],
        }
        return [game["observations"][0]], info

    def step(self, actions):
        game = self.games[self.index]
        turn = self.cursor
        self.cursor += 1
        info = {"admissible_commands": [list(game["admissible"][self.cursor])]}
        if game.get("wins") is not None:
            info["won"] = [game["wins"][turn]]
        return [game["observations"][self.cursor]], [0.0], [game["dones"][turn]], info


def shell_for(games: "list[dict]"):
    """A stand-in for `AlfredTWEnv`, injected through the parameter `build_env` already has."""

    class Shell:
        def __init__(self, config, train_eval=""):
            self.config = config
            self.train_eval = train_eval
            self.game_files = [game["gamefile"] for game in games]
            self.num_games = len(games)

        def init_env(self, batch_size: int = 1):
            return Scripted(games).init_env(batch_size)

    return Shell


class DrawTest(unittest.TestCase):
    def test_the_sequence_is_fixed_by_this_file_and_not_by_the_runtime(self):
        # Pinned numbers, not properties. `random.Random(seed)` was rejected because `_randbelow`'s rejection
        # loop has changed between minor versions, so a recorded floor would not survive a Python upgrade.
        # These three values are the proof that this generator does.
        draw = floor.Draw(20261120)
        self.assertEqual(
            [draw.u64() for _ in range(3)],
            [6929784689348802184, 16151589174211811617, 3447685174740523722],
        )

    def test_the_seed_is_masked_so_a_negative_one_is_its_twos_complement(self):
        self.assertEqual(floor.Draw(-1).state, floor.MASK)
        self.assertEqual(floor.Draw(floor.MASK + 3).state, 2)  # 2**64 + 2 truncated to 64 bits

    def test_below_stays_inside_the_bound_and_repeats_for_a_seed(self):
        draw = floor.Draw(7)
        self.assertEqual([draw.below(5) for _ in range(6)], [2, 4, 1, 3, 4, 0])
        # A bound of one is the degenerate case the environment produces when a single command is admissible.
        self.assertEqual([draw.below(1) for _ in range(3)], [0, 0, 0])


class WilsonTest(unittest.TestCase):
    def test_zero_trials_is_the_whole_interval_rather_than_a_division(self):
        self.assertEqual(floor.wilson(0, 0), (0.0, 1.0))

    def test_a_floor_of_zero_keeps_its_lower_bound_at_zero(self):
        # The normal approximation puts this bound below zero, which is where a floor usually lives.
        low, high = floor.wilson(0, 134)
        self.assertEqual(low, 0.0)
        self.assertAlmostEqual(high, 0.0279, places=4)

    def test_a_perfect_pass_caps_its_upper_bound_at_one(self):
        low, high = floor.wilson(134, 134)
        self.assertAlmostEqual(low, 0.9721, places=4)
        self.assertEqual(high, 1.0)

    def test_the_interval_brackets_the_proportion(self):
        low, high = floor.wilson(67, 134)
        self.assertLess(low, 0.5)
        self.assertGreater(high, 0.5)
        self.assertAlmostEqual(high - low, 0.1669, places=4)


class DigestTest(unittest.TestCase):
    def test_the_digest_is_sixteen_hex_characters_and_order_sensitive(self):
        self.assertEqual(floor.digest_of([]), "e3b0c44298fc1c14")
        self.assertEqual(floor.digest_of(["a", "b"]), "7e18f737311b2dc3")
        self.assertNotEqual(floor.digest_of(["a", "b"]), floor.digest_of(["b", "a"]))


class DataRootTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.saved = floor.DATA_ROOT
        floor.DATA_ROOT = self.root
        self.addCleanup(setattr, floor, "DATA_ROOT", self.saved)

    def publish(self, name: str) -> Path:
        # The split's own shape is `<split>/<task type>/<game>/game.tw-pddl`, which is why `on_disk` globs two
        # levels: a fixture one level shallow would make the inventory silently empty.
        path = self.root / "json_2.1.1" / floor.SPLIT / name / "game-1" / "game.tw-pddl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
        return path

    def test_a_game_inside_the_root_is_named_relative_to_it(self):
        path = self.publish("a")
        self.assertEqual(floor.game_key(str(path)), f"json_2.1.1/{floor.SPLIT}/a/game-1/game.tw-pddl")

    def test_a_game_outside_the_root_keeps_its_whole_path(self):
        # Falling back to the file name would collapse all 134 games onto the single string `game.tw-pddl`,
        # and the coverage assertion downstream would then pass on a walker that drove one game 134 times.
        outside = self.root.parent / "somewhere-else" / "game.tw-pddl"
        self.assertEqual(floor.game_key(str(outside)), str(outside))

    def test_the_inventory_is_every_held_out_game_on_disk(self):
        self.publish("a")
        self.publish("b")
        self.assertEqual(
            floor.on_disk(),
            {f"json_2.1.1/{floor.SPLIT}/a/game-1/game.tw-pddl", f"json_2.1.1/{floor.SPLIT}/b/game-1/game.tw-pddl"},
        )


@unittest.skipUnless(HAS_YAML, "pyyaml, which the workflow's unit job installs and a laptop may not")
class ConfigTest(unittest.TestCase):
    def test_the_data_root_is_substituted_for_the_placeholder(self):
        saved = floor.DATA_ROOT
        floor.DATA_ROOT = Path("/opt/alfworld")
        self.addCleanup(setattr, floor, "DATA_ROOT", saved)
        config = floor.read_config()
        self.assertEqual(config["dataset"]["data_path"], "/opt/alfworld/json_2.1.1/train")
        # The six task types are the six kinds `agent.py` classifies and `distill.py --kinds` filters by, so a
        # config that dropped one would make a kind unfilterable with no error anywhere.
        self.assertEqual(config["env"]["task_types"], [1, 2, 3, 4, 5, 6])


@unittest.skipUnless(HAS_YAML, "pyyaml, which the workflow's unit job installs and a laptop may not")
class DefaultShellTest(unittest.TestCase):
    """The branch that imports the installed package.

    `alfworld` is not installed in the job that runs this file, so the four modules the import path names are
    supplied under `sys.modules`. This is not a mock of the code under test -- it is the dependency the lane's
    own job installs, written small enough to run here, and the assertion is that `build_env` hands the shell its
    config and the split selector rather than that the shell does anything.
    """

    def test_without_an_injected_shell_it_reads_the_config_and_names_the_split(self):
        import types

        seen = {}

        class AlfredTWEnv:
            def __init__(self, config, train_eval=""):
                seen["config"] = config
                seen["train_eval"] = train_eval
                self.num_games = 0
                self.game_files = []

            def init_env(self, batch_size: int = 1):
                seen["batch_size"] = batch_size
                return self

        names = ["alfworld", "alfworld.agents", "alfworld.agents.environment"]
        saved = {name: sys.modules.get(name) for name in names + ["alfworld.agents.environment.alfred_tw_env"]}
        for name in names:
            sys.modules[name] = types.ModuleType(name)
        leaf = types.ModuleType("alfworld.agents.environment.alfred_tw_env")
        leaf.AlfredTWEnv = AlfredTWEnv
        sys.modules["alfworld.agents.environment.alfred_tw_env"] = leaf

        def restore():
            for name, module in saved.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module

        self.addCleanup(restore)
        env, num_games = floor.build_env()
        self.assertIsInstance(env, AlfredTWEnv)
        self.assertEqual(num_games, 0)
        self.assertEqual(seen["train_eval"], "eval_out_of_distribution")
        self.assertEqual(seen["batch_size"], 1)
        self.assertEqual(seen["config"]["dataset"]["data_path"], str(floor.DATA_ROOT) + "/json_2.1.1/train")


class DriveTest(unittest.TestCase):
    def drive(self, games: "list[dict]", max_steps: int = 10, seed: int = 3) -> dict:
        return floor.drive(Scripted(games), floor.Draw(seed), max_steps)

    def test_a_won_episode_records_the_verdict_the_digest_and_the_transcript_length(self):
        episode = self.drive([scripted(steps=2, won=True)])
        self.assertTrue(episode["won"])
        self.assertEqual(episode["steps"], 2)
        self.assertFalse(episode["truncated"])
        self.assertEqual(len(episode["digest"]), 16)
        self.assertEqual(len(episode["observe_fingerprint"]), 16)
        # One observation at reset plus one per step: the transcript a ReAct prompt would carry by its last turn.
        self.assertEqual(len(episode["observe_chars"]), 3)
        self.assertEqual(episode["admitted_at_reset"], 2)

    def test_a_gamefile_that_arrives_unwrapped_is_accepted(self):
        # The batch wrapper shapes every info value as a one-element list, but `extra.gamefile` is injected by a
        # wrapper this repository does not own. This is a shape tolerance, not a fallback: a missing key raises.
        episode = self.drive([scripted(steps=1, gamefile_as_list=False)])
        self.assertTrue(episode["gamefile"].endswith("game.tw-pddl"))

    def test_an_episode_without_a_won_key_is_not_a_win(self):
        episode = self.drive([scripted(steps=1, won=None)])
        self.assertFalse(episode["won"])
        self.assertEqual(episode["steps"], 1)

    def test_no_admissible_command_ends_the_episode_before_a_step(self):
        # Not a walker defect: an episode with no legal move is a statement about the task, and the only
        # observation recorded is the one the reset produced.
        episode = self.drive([scripted(steps=2, admissible=[[], [], []])])
        self.assertEqual(episode["steps"], 0)
        self.assertTrue(episode["truncated"])
        self.assertEqual(len(episode["observe_chars"]), 1)

    def test_the_step_cap_truncates_rather_than_the_environment(self):
        episode = self.drive([scripted(steps=5, dones=[False] * 5, wins=[False] * 5)], max_steps=2)
        self.assertEqual(episode["steps"], 2)
        self.assertTrue(episode["truncated"])

    def test_the_last_line_is_the_tail_of_the_last_observation_and_is_cut_at_120(self):
        long_line = "x" * 200
        observations = ["start", f"first line\nsecond line {long_line}"]
        episode = self.drive([scripted(steps=1, observations=observations, dones=[True])])
        self.assertTrue(episode["last_line"].endswith("x" * 20))
        self.assertLessEqual(len(episode["last_line"]), 120)

    def test_an_empty_observation_has_no_last_line(self):
        episode = self.drive([scripted(steps=1, observations=["start", "   "], dones=[True])])
        self.assertEqual(episode["last_line"], "")


class PassOverTest(unittest.TestCase):
    def games(self, count: int) -> "list[dict]":
        return [scripted(gamefile=f"/d/g{index:03d}/game.tw-pddl", steps=1) for index in range(count)]

    def test_a_limit_of_zero_drives_the_whole_split(self):
        episodes, output = captured(floor.pass_over, 5, 0, 4, "pass 1", shell_for(self.games(3)))
        self.assertEqual(len(episodes), 3)
        self.assertIn("pass 1: driving 3 games with seed 5", output)
        self.assertIn("pass 1: 3 games in", output)
        self.assertIn("ms/game", output)

    def test_a_limit_below_the_split_drives_only_that_many(self):
        episodes, output = captured(floor.pass_over, 5, 2, 4, "pass 1", shell_for(self.games(3)))
        self.assertEqual(len(episodes), 2)
        self.assertIn("driving 2 games", output)

    def test_a_limit_above_the_split_is_capped_by_the_split(self):
        episodes, _output = captured(floor.pass_over, 5, 10, 4, "pass 1", shell_for(self.games(3)))
        self.assertEqual(len(episodes), 3)

    def test_the_progress_line_is_printed_every_twenty_five_games_and_at_the_end(self):
        # Both branches of `(index + 1) % 25 == 0 or index + 1 == total`: 25 hits the first, and a split that
        # is not a multiple of 25 hits only the second.
        episodes, output = captured(floor.pass_over, 5, 0, 4, "pass 1", shell_for(self.games(25)))
        self.assertEqual(len(episodes), 25)
        self.assertIn("  25/25  wins=", output)


class CompareTest(unittest.TestCase):
    def games(self) -> "list[dict]":
        return [scripted(gamefile=f"/d/g{index}/game.tw-pddl", steps=1, won=index == 0) for index in range(3)]

    def test_the_same_seed_twice_replays_exactly(self):
        first = floor.pass_over(11, 0, 5, "pass 1", shell_for(self.games()))
        second = floor.pass_over(11, 0, 5, "pass 2", shell_for(self.games()))
        comparison = floor.compare(first, second)
        self.assertEqual(comparison["mismatches"], 0)
        self.assertEqual(comparison["shadow_episodes"], 3)
        self.assertIsNone(comparison["first_mismatch"])

    def test_a_diverged_verdict_is_reported_with_the_episode_and_the_field(self):
        first = floor.pass_over(11, 0, 5, "pass 1", shell_for(self.games()))
        second = [dict(episode) for episode in first]
        second[1]["won"] = not second[1]["won"]
        comparison = floor.compare(first, second)
        self.assertEqual(comparison["mismatches"], 1)
        detail = comparison["first_mismatch"]
        self.assertEqual((detail["episode"], detail["field"]), (1, "won"))
        self.assertEqual((detail["first"], detail["second"]), (first[1]["won"], second[1]["won"]))

    def test_a_shorter_second_pass_is_compared_on_what_it_has(self):
        first = floor.pass_over(11, 0, 5, "pass 1", shell_for(self.games()))
        second = floor.pass_over(11, 2, 5, "pass 2", shell_for(self.games()))
        comparison = floor.compare(first, second)
        self.assertEqual(comparison["shadow_episodes"], 2)
        self.assertEqual(comparison["mismatches"], 0)


class RunTest(unittest.TestCase):
    """`run` is the four assertions and the report, so every refusal below is a defect it would otherwise pass.

    Each case is written as the failure a real run would produce once: a split driven twice, a published game
    never driven, an episode the step cap cut off, and a second pass that disagreed with the first.
    """

    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.saved = floor.DATA_ROOT
        floor.DATA_ROOT = self.root
        self.addCleanup(setattr, floor, "DATA_ROOT", self.saved)
        self.out = self.root / "floor.json"

    def publish(self, *names: str) -> "list[dict]":
        games = []
        for name in names:
            path = self.root / "json_2.1.1" / floor.SPLIT / name / "game-1" / "game.tw-pddl"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}", encoding="utf-8")
            games.append(scripted(gamefile=str(path), steps=1, won=True))
        return games

    def arguments(self, **overrides) -> argparse.Namespace:
        base = {"seed": 7, "games": 0, "shadow_games": 0, "max_steps": 6, "out": str(self.out)}
        base.update(overrides)
        return argparse.Namespace(**base)

    def refused(self, function, *args, **kwargs) -> str:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            with self.assertRaises(SystemExit) as caught:
                function(*args, **kwargs)
        self.assertEqual(caught.exception.code, 1)
        return buffer.getvalue()

    def test_no_data_root_is_refused_before_the_download_is_assumed(self):
        floor.DATA_ROOT = self.root / "missing"
        output = self.refused(floor.run, self.arguments(), shell_for([]))
        self.assertIn("no data at", output)

    def test_a_data_root_with_no_games_is_refused(self):
        output = self.refused(floor.run, self.arguments(), shell_for([]))
        self.assertIn("no held-out games under", output)

    def test_a_game_driven_twice_is_refused(self):
        self.publish("a", "b")
        twice = scripted(gamefile=str(self.root / "json_2.1.1" / floor.SPLIT / "a" / "game-1" / "game.tw-pddl"), steps=1)
        output = self.refused(floor.run, self.arguments(games=2), shell_for([twice, twice]))
        self.assertIn("driven more than once", output)

    def test_a_published_game_that_was_never_driven_is_refused(self):
        games = self.publish("a", "b")
        output = self.refused(floor.run, self.arguments(), shell_for(games[:1]))
        self.assertIn("published games were never driven", output)

    def test_an_episode_that_never_terminated_is_refused(self):
        games = self.publish("a")
        # Two legal steps and no terminal verdict anywhere: the step cap, not the environment, ends this episode.
        games[0].update(scripted(gamefile=games[0]["gamefile"], steps=2, dones=[False, False], wins=[False, False]))
        output = self.refused(floor.run, self.arguments(max_steps=2), shell_for(games))
        self.assertIn("never terminated", output)

    def test_a_second_pass_that_differs_is_refused(self):
        games = self.publish("a")
        counter = {"shells": 0}

        class Drifting:
            def __init__(self, config, train_eval=""):
                counter["shells"] += 1
                self.game_files = [game["gamefile"] for game in games]
                self.num_games = len(games)

            def init_env(self, batch_size: int = 1):
                copy = [dict(game) for game in games]
                if counter["shells"] > 1:
                    copy[0]["wins"] = [False]
                return Scripted(copy).init_env(batch_size)

        output = self.refused(floor.run, self.arguments(), Drifting)
        self.assertIn("the same seed did not replay", output)

    def test_a_clean_pass_writes_the_summary_and_reports_it(self):
        games = self.publish("a", "b")
        games[1]["wins"] = [False]
        code, output = captured(floor.run, self.arguments(), shell_for(games))
        self.assertEqual(code, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["episodes"], 2)
        self.assertEqual(payload["summary"]["wins"], 1)
        self.assertEqual(payload["summary"]["rate"], 0.5)
        self.assertEqual(payload["summary"]["games_on_disk"], 2)
        self.assertEqual(payload["determinism"]["mismatches"], 0)
        self.assertEqual(len(payload["episodes"]), 2)
        self.assertIn("split: 2 games on disk", output)
        self.assertIn("floor over 2 games: 1 wins = 50.0%", output)
        self.assertIn("wilson 95%", output)
        self.assertIn("PASS the split is covered, terminates, and replays", output)
        self.assertIn("model calls made by this pass = 0", output)

    def test_games_caps_the_pass_and_the_shadow_uses_the_same_cap(self):
        games = self.publish("a", "b")
        code, _output = captured(floor.run, self.arguments(games=1), shell_for(games))
        self.assertEqual(code, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["episodes"], 1)
        self.assertEqual(payload["determinism"]["shadow_episodes"], 1)
        # With a cap, coverage is a statement about the cap rather than about the split.
        self.assertEqual(payload["summary"]["games_on_disk"], 2)

    def test_shadow_games_overrides_the_shadow_length(self):
        games = self.publish("a", "b")
        code, _output = captured(floor.run, self.arguments(games=2, shadow_games=1), shell_for(games))
        self.assertEqual(code, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["determinism"]["shadow_episodes"], 1)

    def test_the_command_line_reaches_the_same_measurement(self):
        games = self.publish("a")
        code, output = captured(
            floor.main,
            ["--seed", "7", "--games", "1", "--max-steps", "6", "--out", str(self.out)],
            shell_factory=shell_for(games),
        )
        self.assertEqual(code, 0)
        self.assertIn("PASS the split is covered", output)


class SummariseTest(unittest.TestCase):
    def test_a_pass_over_nothing_reports_zeroes_instead_of_dividing_by_it(self):
        # Reachable only from a test: `run` refuses an empty pass before it summarises one. The function is
        # separated from `run` precisely so that the branch exists somewhere a test can see it.
        summary = floor.summarise([], set(), 7)
        self.assertEqual(summary["episodes"], 0)
        self.assertEqual(summary["rate"], 0.0)
        self.assertEqual(summary["steps_mean"], 0.0)
        self.assertEqual(summary["admitted_mean"], 0.0)
        self.assertEqual(summary["context_chars"]["median"], 0)
        self.assertEqual(summary["context_chars"]["per_turn_mean"], 0.0)
        self.assertEqual((summary["wilson_low"], summary["wilson_high"]), (0.0, 1.0))

    def test_the_context_percentiles_are_the_sorted_lengths(self):
        episodes = [
            {"won": True, "steps": 2, "admitted_at_reset": 4, "observe_chars": [10, 20, 30]},
            {"won": False, "steps": 4, "admitted_at_reset": 0, "observe_chars": [1, 1, 1, 1]},
        ]
        summary = floor.summarise(episodes, {"a", "b"}, 9)
        self.assertEqual(summary["wins"], 1)
        self.assertEqual(summary["steps_total"], 6)
        self.assertEqual(summary["steps_mean"], 3.0)
        self.assertEqual(summary["admitted_mean"], 2.0)
        self.assertEqual(summary["empty_admissible"], 1)
        self.assertEqual(summary["context_chars"]["median"], 60)
        # Nearest-rank p90 over two episodes is the larger one. `int(0.9 * (n - 1))` returned the smaller one,
        # which is the direction that under-quotes the tail.
        self.assertEqual(summary["context_chars"]["p90"], 60)
        self.assertEqual(floor.summarise([{"won": True, "steps": 1, "admitted_at_reset": 1, "observe_chars": [1]}], set(), 1)["context_chars"]["p90"], 1)
        self.assertEqual(summary["context_chars"]["max"], 60)
        self.assertEqual(summary["context_chars"]["mean"], 32.0)
        # 64 characters over 6 turns: the mean a per-turn token estimate multiplies by the turn count.
        self.assertEqual(summary["context_chars"]["per_turn_mean"], 10.7)


if __name__ == "__main__":
    unittest.main()
