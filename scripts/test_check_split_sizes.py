#!/usr/bin/env python3
"""The split-size checker's own edges, on corpora this file builds.

The checker exists because `SPLIT_SIZES` is a hand-written table that every `--expect` and every tiling check
reads. A checker that has only ever seen a corpus that agrees has not been shown to reject anything, so these
cases are the three ways it can disagree: a section that is short, a section that is missing, and a corpus that
matches. `--self-test` covers the same three from inside the script; this suite is what puts the code under the
coverage gate, because a self-test nobody measures is a self-test that can rot to `return 0`.

Run: python3 scripts/test_check_split_sizes.py
"""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# The module under test sits beside this file. Inserted rather than relied on: `python3 scripts/x.py` puts it on
# the path and `coverage run scripts/x.py` on 3.10 does not (AUDIT 34.235).
sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_split_sizes as checker  # noqa: E402  (the module beside this file)
import agent  # noqa: E402  (its table, which the suite replaces with a small one)

# A table small enough to build in a test and shaped exactly like the real one: one section, one directory, four
# games. The checker reads the table rather than a constant of its own, so replacing it is a legitimate fixture.
SMALL_SIZES = {"eval_out_of_distribution": 4}
SMALL_DIRS = {"eval_out_of_distribution": "valid_unseen"}


class TableTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.original = (dict(agent.SPLIT_SIZES), dict(agent.SPLIT_DIRS))
        agent.SPLIT_SIZES.clear()
        agent.SPLIT_SIZES.update(SMALL_SIZES)
        agent.SPLIT_DIRS.clear()
        agent.SPLIT_DIRS.update(SMALL_DIRS)

    def tearDown(self):
        agent.SPLIT_SIZES.clear()
        agent.SPLIT_SIZES.update(self.original[0])
        agent.SPLIT_DIRS.clear()
        agent.SPLIT_DIRS.update(self.original[1])

    def corpus(self, count: int) -> Path:
        """`count` games, one per task directory, which is the layout the counter walks.

        The file is always named `game.tw-pddl` and lives under a task directory: the real corpus has 47 task
        directories and 134 games, so the directory name varies and the file name does not.
        """
        for index in range(count):
            task = self.root / "valid_unseen" / f"trial_{index}"
            task.mkdir(parents=True, exist_ok=True)
            (task / "game.tw-pddl").write_text("x", encoding="utf-8")
        return self.root


class CountTest(TableTest):
    def test_a_missing_section_is_unknown_rather_than_empty(self):
        # Zero would read as "the section is empty" and send a reader to the corpus; None sends them to the
        # fetch, which is the actual repair.
        self.assertIsNone(checker.counted(self.root, "valid_unseen"))

    def test_games_are_counted_recursively_under_task_directories(self):
        self.assertEqual(checker.counted(self.corpus(3), "valid_unseen"), 3)

    def test_directories_are_not_games(self):
        # `valid_unseen` holds 47 task directories and 134 games, so a checker that counted directories would be
        # wrong by a factor of three and read plausibly — which is why the count is `rglob("game.tw-pddl")`.
        self.assertEqual(checker.counted(self.corpus(2), "valid_unseen"), 2)


class DisagreementTest(TableTest):
    def test_a_corpus_that_matches_reports_nothing(self):
        self.assertEqual(checker.disagreements(self.corpus(4)), [])

    def test_a_short_section_is_named_with_both_numbers(self):
        problems = checker.disagreements(self.corpus(3))
        self.assertEqual(len(problems), 1)
        self.assertIn("SPLIT_SIZES says 4", problems[0])
        self.assertIn("holds 3", problems[0])

    def test_a_long_section_is_refused_too(self):
        # The direction that would silently raise a denominator: a newer corpus with more games makes every
        # `--expect 134` wrong by the difference, and the reading would print a rate over the wrong split.
        problems = checker.disagreements(self.corpus(5))
        self.assertEqual(len(problems), 1)
        self.assertIn("holds 5", problems[0])

    def test_a_missing_section_is_its_own_sentence(self):
        self.corpus(4)
        shutil.rmtree(self.root / "valid_unseen")
        problems = checker.disagreements(self.root)
        self.assertEqual(len(problems), 1)
        self.assertIn("no valid_unseen/", problems[0])


class LocateTest(TableTest):
    """Where the corpus is, which the download decides and this file must not."""

    def test_the_corpus_is_found_at_the_bottom_of_whatever_layout_the_download_produced(self):
        # The first green tree that ran this check had every section reported missing: `alfworld-download` put the
        # sections somewhere other than `<data>/data/json_2.1.1`, and the checker had hard-coded that path. The
        # download's layout is the download's business; finding the sections is this file's (AUDIT 34.252).
        bottom = self.root / "data" / "json_2.1.1"
        (bottom / "valid_unseen" / "trial_one").mkdir(parents=True)
        self.assertEqual(checker.locate(self.root), bottom)

    def test_a_home_without_a_section_is_unknown_rather_than_empty(self):
        (self.root / "logs").mkdir()
        self.assertIsNone(checker.locate(self.root))

    def test_a_missing_home_is_unknown_rather_than_a_crash(self):
        self.assertIsNone(checker.locate(self.root / "not-here"))

    def test_the_shallowest_copy_wins(self):
        # A repository that carries a fixture with the same directory names must not outrank the installed corpus:
        # the shallow answer is the one the download wrote at the top of its tree.
        deep = self.root / "a" / "b"
        (deep / "valid_unseen").mkdir(parents=True)
        (self.root / "valid_unseen").mkdir()
        self.assertEqual(checker.locate(self.root), self.root)


class MainTest(TableTest):
    def run_main(self, argv):
        original = sys.argv
        sys.argv = ["check_split_sizes.py"] + argv
        try:
            return checker.main()
        finally:
            sys.argv = original

    def test_a_matching_corpus_passes_and_names_the_root(self):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(self.run_main(["--data", str(self.corpus(4))]), 0)
        self.assertIn("OK", printed.getvalue())
        self.assertIn(str(self.root), printed.getvalue())

    def test_a_short_corpus_fails_with_one_line_per_section(self):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(self.run_main(["--data", str(self.corpus(2))]), 1)
        self.assertIn("FAIL", printed.getvalue())
        self.assertIn("holds 2", printed.getvalue())

    def test_a_home_that_holds_no_corpus_fails_and_says_so(self):
        import os

        original = os.environ.get("ALFWORLD_DATA")
        os.environ["ALFWORLD_DATA"] = str(self.root)
        try:
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                self.assertEqual(self.run_main([]), 1)
            self.assertIn("not installed", printed.getvalue())
        finally:
            if original is None:
                os.environ.pop("ALFWORLD_DATA", None)
            else:
                os.environ["ALFWORLD_DATA"] = original

    def test_the_default_root_is_the_environment_variable_the_jobs_set(self):
        # The published corpus lives at `$ALFWORLD_DATA/data/json_2.1.1`, and the jobs set that variable. A
        # checker that guessed a path would pass on the machine it was written on and fail on every runner.
        import os

        corpus = self.root
        data = corpus / "data" / "json_2.1.1"
        for index in range(4):
            task = data / "valid_unseen" / f"trial_{index}"
            task.mkdir(parents=True)
            (task / "game.tw-pddl").write_text("x", encoding="utf-8")
        original = os.environ.get("ALFWORLD_DATA")
        os.environ["ALFWORLD_DATA"] = str(corpus)
        try:
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                self.assertEqual(self.run_main([]), 0)
            self.assertIn("json_2.1.1", printed.getvalue())
        finally:
            if original is None:
                os.environ.pop("ALFWORLD_DATA", None)
            else:
                os.environ["ALFWORLD_DATA"] = original

    def test_the_self_test_passes_on_this_interpreter(self):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(self.run_main(["--self-test"]), 0)
        self.assertIn("OK", printed.getvalue())


class SelfTestTest(unittest.TestCase):
    """The self-test's own two failure branches, reached by handing it a case whose expectation is wrong.

    This is not a mock: `self_test` runs the real check over a real corpus and the expectation is the only thing
    that is wrong, which is exactly the failure it exists to report — a case whose sentence no longer matches the
    code. Excluding those branches from measurement would be the arrangement in which a self-test silently turns
    into `return 0`.
    """

    def test_the_shipped_cases_pass(self):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(checker.self_test(), 0)
        self.assertIn("OK", printed.getvalue())
        self.assertEqual(printed.getvalue().count("ok   "), len(checker.SELF_CASES))

    def test_a_case_that_expects_no_problem_and_finds_one_fails(self):
        wrong = (("a matching corpus that is not", {"alpha": 4}, {"alpha": "seen"}, {"seen": 1}, ""),)
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(checker.self_test(wrong), 1)
        self.assertIn("expected no problem", printed.getvalue())

    def test_a_case_that_expects_a_sentence_and_gets_none_fails(self):
        wrong = (("a sentence nobody writes", {"alpha": 1}, {"alpha": "seen"}, {"seen": 1}, "holds 99"),)
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(checker.self_test(wrong), 1)
        self.assertIn("expected 'holds 99'", printed.getvalue())

    def test_the_script_runs_as_a_process_and_not_only_as_an_import(self):
        # The `__main__` guard is code: a script whose entry point is never executed is a script whose exit code
        # nothing has read, and the exit code is the whole report of a command a workflow runs.
        import runpy

        original = sys.argv
        sys.argv = ["check_split_sizes.py", "--self-test"]
        try:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as caught:
                runpy.run_path(str(Path(checker.__file__).resolve()), run_name="__main__")
            self.assertEqual(caught.exception.code, 0)
        finally:
            sys.argv = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
