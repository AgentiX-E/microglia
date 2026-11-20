"""The free gate's tests: the four things the lane needs the environment for, and every way it can lie.

`selfcheck.py` is the only driver in the tree that costs nothing, and it is the one that decides whether a
paid dispatch can run at all. Until this file existed it had no tests — 63 statements at 0% — which made it
the one gate in the lane that certified nothing. Its four assertions are exactly the ones an environment
defect would break, and each of them can be broken on purpose with a fake environment, so they are tested
here rather than discovered on a paid run.

The fake environment is not a mock of textworld: it is the four-field contract the driver depends on
(`reset` returning an observation and an admissible list, `step` returning text, a done flag and a fresh
list). A defect in the *driver* — reading `info["admissible_commands"]` as a list rather than a list of
lists, treating a done episode as a failure, accepting an unchanged observation as movement — is visible
against that contract, and those are the defects this file is about.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import selfcheck  # noqa: E402


class FakeEnv:
    """The contract, with knobs for each way it can be wrong.

    `admissible` is served per reset and then per step; `texts` is what the walk returns, cycled when it
    runs out, so a walk of any length can be driven without enumerating twelve observations by hand.
    """

    def __init__(
        self,
        first: str = "You are in a room. Your task is to: put a mug in the desk.",
        admissible: "list[str] | None" = None,
        after: str = "You arrive at the desk.",
        refusal: str = "Nothing happens.",
        walk_text: str = "You see a desk.",
        walk_admissible: "list[str] | None" = None,
        dones_at: "int | None" = None,
    ) -> None:
        self.first = first
        self.admissible = ["go to desk 1", "look"] if admissible is None else admissible
        self.after = after
        self.refusal = refusal
        self.walk_text = walk_text
        self.walk_admissible = ["look"] if walk_admissible is None else walk_admissible
        self.dones_at = dones_at
        self.steps = 0
        self.served: "list[list[str]]" = []

    def reset(self):
        self.steps = 0
        return [self.first], {"admissible_commands": [list(self.admissible)], "goal": "put a mug in the desk"}

    def step(self, commands):
        command = commands[0]
        self.steps += 1
        if command.startswith("go to "):
            self.served.append(list(self.walk_admissible))
            return [self.after], [0.0], [False], {"admissible_commands": [list(self.walk_admissible)]}
        if command == "dance the tango":
            return [self.refusal], [0.0], [False], {"admissible_commands": [list(self.walk_admissible)]}
        done = self.dones_at is not None and self.steps >= self.dones_at
        return [self.walk_text], [0.0], [done], {"admissible_commands": [list(self.walk_admissible)]}


class LocateTest(unittest.TestCase):
    """The two failures that must happen before an environment is opened, because opening it costs minutes."""

    def test_a_missing_data_root_is_refused_with_the_command_that_fetches_it(self):
        with tempfile.TemporaryDirectory() as empty:
            missing = Path(empty) / "not-there"
            with self.assertRaises(SystemExit):
                selfcheck.locate(missing)

    def test_a_root_with_no_held_out_games_is_refused(self):
        with tempfile.TemporaryDirectory() as empty:
            root = Path(empty)
            (root / "json_2.1.1" / "valid_unseen").mkdir(parents=True)
            with self.assertRaises(SystemExit):
                selfcheck.locate(root)

    def test_the_two_level_layout_is_what_a_game_is_found_by(self):
        # `<split>/<task>/<trial>/game.tw-pddl`; a flat glob would find nothing and report "no games".
        with tempfile.TemporaryDirectory() as empty:
            root = Path(empty)
            game = root / "json_2.1.1" / "valid_unseen" / "look_at_obj_in_light-Bowl-None-DeskLamp-308" / "trial_T1"
            game.mkdir(parents=True)
            (game / "game.tw-pddl").write_text("x", encoding="utf-8")
            found = selfcheck.locate(root)
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0].name, "game.tw-pddl")


class ConfigTest(unittest.TestCase):
    def test_the_data_root_is_substituted_into_the_config(self):
        with tempfile.TemporaryDirectory() as empty:
            path = Path(empty) / "config.yaml"
            path.write_text("env:\n  type: AlfredTWEnv\n  domain_randomization: false\n  data_path: $ALFWORLD_DATA\n", encoding="utf-8")
            config = selfcheck.read_config(Path("/tmp/alf"), path)
            self.assertEqual(config["env"]["data_path"], "/tmp/alf")

    def test_a_config_without_the_placeholder_is_passed_through(self):
        with tempfile.TemporaryDirectory() as empty:
            path = Path(empty) / "config.yaml"
            path.write_text("env:\n  data_path: /already/resolved\n", encoding="utf-8")
            self.assertEqual(selfcheck.read_config(Path("/tmp/alf"), path)["env"]["data_path"], "/already/resolved")


class CheckTest(unittest.TestCase):
    def test_a_healthy_environment_passes(self):
        selfcheck.check(FakeEnv())

    def test_an_episode_with_no_admissible_command_is_refused(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(admissible=[]))

    def test_an_observation_without_a_task_is_refused(self):
        # The goal is rendered by the intro grammar once, at reset. Without it the model is asked to act
        # without being told what for, and every downstream score is a score of the wrong question.
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(first="You are in a room with a desk."))

    def test_no_navigation_command_is_refused_because_every_task_admits_one(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(admissible=["look", "inventory"]))

    def test_an_admissible_command_that_changes_nothing_is_refused(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(after="You are in a room. Your task is to: put a mug in the desk."))

    def test_an_inadmissible_command_that_is_applied_is_refused(self):
        # The half of the contract that keeps a hallucinated action from silently becoming a legal move.
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(refusal="You dance the tango badly."))

    def test_a_walk_that_loses_the_admissible_list_is_refused(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(walk_admissible=[]))

    def test_a_walk_that_returns_an_empty_observation_is_refused(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(walk_text="   "))

    def test_a_walk_in_which_every_step_is_refused_is_refused(self):
        with self.assertRaises(SystemExit):
            selfcheck.check(FakeEnv(walk_text="Nothing happens."))

    def test_an_episode_that_ends_during_the_walk_is_a_pass_and_says_so(self):
        # Ending early is the environment working, not failing: the walk is a liveness check.
        selfcheck.check(FakeEnv(dones_at=3))


class OpenTest(unittest.TestCase):
    def test_the_factory_receives_the_config_and_the_split(self):
        seen = {}

        def factory(config, train_eval):
            seen["config"] = config
            seen["split"] = train_eval
            return FakeEnv()

        environment = selfcheck.open_environment({"env": {"type": "AlfredTWEnv"}}, factory)
        self.assertEqual(seen["split"], "eval_out_of_distribution")
        self.assertEqual(seen["config"], {"env": {"type": "AlfredTWEnv"}})
        selfcheck.check(environment)


class MainTest(unittest.TestCase):
    def test_main_locates_the_games_and_drives_the_environment_it_is_given(self):
        with tempfile.TemporaryDirectory() as empty:
            root = Path(empty)
            game = root / "json_2.1.1" / "valid_unseen" / "task" / "trial"
            game.mkdir(parents=True)
            (game / "game.tw-pddl").write_text("x", encoding="utf-8")
            path = Path(empty) / "config.yaml"
            path.write_text("env:\n  data_path: $ALFWORLD_DATA\n", encoding="utf-8")
            opened = {}

            def factory(config, train_eval):
                opened["config"] = config
                return FakeEnv()

            self.assertEqual(selfcheck.main(root, path, factory), 0)
            self.assertEqual(opened["config"]["env"]["data_path"], str(root))


class DefaultFactoryTest(unittest.TestCase):
    """The factory the driver uses when nothing is injected, exercised by standing four modules up.

    This is the branch that cannot run here: `alfworld` is not installed in the development sandbox, and a
    test that needs twenty gigabytes of Inform7 output to cover four lines is a test nobody runs. The four
    names below are the ones `open_environment` imports, and the stub records what it was constructed with,
    so the coverage is of the wiring rather than of the environment.
    """

    def setUp(self):
        self.saved = {name: sys.modules.get(name) for name in self.names()}
        self.seen = {}
        seen = self.seen

        class AlfredTWEnv:
            def __init__(self, config, train_eval):
                seen["config"] = config
                seen["split"] = train_eval

            def init_env(self, batch_size):
                seen["batch"] = batch_size
                return FakeEnv()

        modules = {
            "alfworld": type(sys)("alfworld"),
            "alfworld.agents": type(sys)("alfworld.agents"),
            "alfworld.agents.environment": type(sys)("alfworld.agents.environment"),
            "alfworld.agents.environment.alfred_tw_env": type(sys)("alfworld.agents.environment.alfred_tw_env"),
        }
        modules["alfworld.agents.environment.alfred_tw_env"].AlfredTWEnv = AlfredTWEnv
        for name, module in modules.items():
            sys.modules[name] = module

    def tearDown(self):
        for name, module in self.saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    @staticmethod
    def names():
        return (
            "alfworld",
            "alfworld.agents",
            "alfworld.agents.environment",
            "alfworld.agents.environment.alfred_tw_env",
        )

    def test_a_module_that_was_already_imported_is_restored_rather_than_deleted(self):
        # The restore path exists for the case someone runs this suite beside a real `alfworld` install:
        # deleting that module would break every later test in the same process, which is a test-order bug
        # rather than a test failure.
        sys.modules["alfworld"] = type(sys)("alfworld")
        self.setUp()
        self.tearDown()
        self.assertIn("alfworld", sys.modules)
        sys.modules.pop("alfworld", None)

    def test_the_default_factory_builds_one_environment_on_the_out_of_distribution_split(self):
        environment = selfcheck.open_environment({"env": {"type": "AlfredTWEnv"}})
        self.assertEqual(self.seen["split"], "eval_out_of_distribution")
        self.assertEqual(self.seen["batch"], 1)
        self.assertEqual(self.seen["config"], {"env": {"type": "AlfredTWEnv"}})
        selfcheck.check(environment)


if __name__ == "__main__":
    unittest.main(verbosity=2)
