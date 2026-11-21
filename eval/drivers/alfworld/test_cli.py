"""The two contracts the lane cannot test from inside a test: the process, and the workflow that starts it.

Every driver here is used as a **command line** before it is used as a module. The workflow starts
`python eval/drivers/alfworld/agent.py --arm none --rules bank.json …`, and that invocation is the only
surface the register actually exercises, so a flag renamed in `argparse` and not in the YAML is a typo
whose first symptom is a paid job failing — or worse, a job that succeeds because an unknown flag was
silently a different arm.

Three contracts, in the order they cost money:

* **the process answers `--help`** for each driver, which is the cheapest proof that the module's
  `__main__` guard, its imports and its parser all survive a fresh interpreter rather than the suite's;
* **every flag the workflow passes is a flag the parser advertises**, read out of `alfworld.yml` rather
  than listed here, so a flag added to the dispatcher and not to the driver fails on the next build;
* **every suite in this directory is a suite the CI runs**, because a new `test_*.py` that nobody added to
  the loop is a test file that has never executed on a runner — which is how the Python drivers spent
  several rounds outside `ci.yml` entirely.

The workflow is read as text and the flags are matched with `--[a-z-]+`, which is enough for a shell block
that only ever spells a long option at the start of a token, and is checked against the parser's own help
rather than against a second hand-written list.
"""

from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
# The drivers that take options, and the one that does not. `selfcheck.py` is a bare script by design: the
# workflow starts it with no arguments at all, and its job is to rehearse the environment rather than to be
# configured. It is listed apart so that a flag appearing in the YAML for it fails here rather than at run time.
OPTION_DRIVERS = ("agent", "floor", "distill")
BARE_DRIVERS = ("selfcheck",)
DRIVERS = OPTION_DRIVERS + BARE_DRIVERS
WORKFLOW = ROOT / ".github" / "workflows" / "alfworld.yml"
CI = ROOT / ".github" / "workflows" / "ci.yml"


def help_text(name: str) -> str:
    """`--help` of one driver, run the way the workflow runs it: as a file, in a fresh interpreter."""
    result = subprocess.run(
        [sys.executable, str(HERE / f"{name}.py"), "--help"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise AssertionError(f"{name}.py --help exited {result.returncode}: {result.stderr[-800:]}")
    return result.stdout


class ProcessTest(unittest.TestCase):
    def test_every_option_taking_driver_answers_help_on_a_fresh_interpreter(self):
        for name in OPTION_DRIVERS:
            with self.subTest(driver=name):
                self.assertIn("usage:", help_text(name))

    def test_the_gate_takes_no_options_and_the_workflow_passes_it_none(self):
        # `selfcheck.py` decides whether a paid dispatch may run at all, and it is the one driver with no
        # model behind it. It has no parser: the workflow starts it bare, and a flag added to that step
        # would be a flag nothing reads.
        source = (HERE / "selfcheck.py").read_text(encoding="utf-8")
        self.assertNotIn("argparse", source)
        self.assertEqual(WorkflowTest.flags_of("selfcheck"), set())


class WorkflowTest(unittest.TestCase):
    @staticmethod
    def flags_of(driver: str) -> "set[str]":
        """Every `--flag` the workflow spells inside a block that starts that driver.

        A block is the span from the line naming the driver to the next blank line, which is how the YAML
        wraps a single shell command; the driver's own name appears inside the span, so the tokens are
        taken from the whole span rather than from the line.
        """
        lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
        flags: "set[str]" = set()
        inside = False
        for line in lines:
            if f"drivers/alfworld/{driver}.py" in line:
                inside = True
                flags |= set(re.findall(r"--[a-z][a-z-]+", line))
                continue
            if inside and line.strip() == "":
                inside = False
                continue
            if inside:
                flags |= set(re.findall(r"--[a-z][a-z-]+", line))
        return flags

    def test_the_workflow_names_every_driver_it_runs(self):
        # A guard against the parser above silently matching nothing: the file has to keep mentioning the
        # drivers for the flags below to mean anything.
        text = WORKFLOW.read_text(encoding="utf-8")
        for name in DRIVERS:
            with self.subTest(driver=name):
                self.assertIn(f"drivers/alfworld/{name}.py", text)

    def test_every_flag_the_workflow_passes_is_one_the_driver_parses(self):
        for name in OPTION_DRIVERS:
            advertised = help_text(name)
            for flag in sorted(self.flags_of(name)):
                with self.subTest(driver=name, flag=flag):
                    self.assertIn(flag, advertised, f"{name}.py does not accept {flag}")

    def test_the_workflow_passes_at_least_one_flag_to_the_arm(self):
        # The reverse guard: a rename in the YAML that this file reads as "no flags" would make the test
        # above vacuous, and the arm's flags are the ones the register varies.
        self.assertIn("--arm", self.flags_of("agent"))


class SuiteTest(unittest.TestCase):
    def test_every_suite_here_is_a_suite_the_ci_runs(self):
        declared = set(re.findall(r"for suite in ([^;]+);", CI.read_text(encoding="utf-8"))[0].split())
        present = {path.stem for path in HERE.glob("test_*.py")}
        self.assertEqual(present - declared, set(), "these suites exist and the CI never runs them")
        self.assertEqual(declared - present, set(), "the CI runs suites that are no longer here")

    def test_the_ci_pins_the_interpreter_the_lane_runs(self):
        # The step exists because a suite that passes on 3.12 and fails on 3.10 is the drift it catches; a step
        # that stopped pinning would keep passing while testing a different interpreter than the lane's floor.
        self.assertIn("python-version: '3.10'", CI.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
