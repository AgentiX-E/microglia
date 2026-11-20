"""The off-peak wait, driven as a process rather than reasoned about in a comment.

`wait-for-window.sh` is eleven lines of `date` arithmetic and it decides whether a 402-episode sweep costs
¥5.71 or ¥11.42, because DeepSeek's card doubles inside its peak windows and the bill is read at the end of
the run. A shell script has no coverage instrument here, so what it has instead is these cases: the two
answers that matter (`start now`, `wait N`), the refusal (a target that is not a time), and the property that
no wait can exceed a day.

Nothing is mocked: the script is executed with `subprocess` and its stdout is what a reader of the workflow
log would see.
"""

from __future__ import annotations

import datetime
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "wait-for-window.sh"


def run(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(SCRIPT), *arguments], capture_output=True, text=True, timeout=30, check=False
    )


class WaitTest(unittest.TestCase):
    def test_no_target_starts_immediately(self):
        result = run()
        self.assertEqual(result.returncode, 0)
        self.assertIn("starting now", result.stdout)

    def test_a_target_already_past_starts_now_rather_than_waiting_a_day(self):
        # The property a machine that wakes late depends on. 00:00 UTC is in the past for every moment after
        # midnight, and a script that waited for the next occurrence would sleep twenty-four hours.
        result = run("00:00")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(
            "has passed; starting now" in result.stdout or "would wait" in result.stdout,
            result.stdout,
        )
        if "has passed" not in result.stdout:
            self.skipTest("this host is at 00:00 UTC, where the target is the current instant")

    def test_a_future_target_within_the_day_reports_a_wait_bounded_by_a_day(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        ahead = (now + datetime.timedelta(hours=1)).strftime("%H:%M")
        result = run(ahead, "--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        if "would wait" not in result.stdout:
            self.assertIn("has passed; starting now", result.stdout)
            return
        seconds = int(result.stdout.split("would wait ")[1].split("s")[0])
        self.assertGreater(seconds, 0)
        self.assertLessEqual(seconds, 86_400)
        # An hour ahead, to the minute: the wait is within a minute of 3600 s unless the clock crossed an hour
        # boundary between the two `date` calls.
        self.assertGreater(seconds, 3_500)
        self.assertLessEqual(seconds, 3_660)

    def test_a_target_that_is_not_a_time_is_refused(self):
        result = run("half past three")
        self.assertEqual(result.returncode, 2)
        self.assertIn("is not an HH:MM", result.stderr)

    def test_the_script_can_be_run_directly_and_fails_fast(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("#!/usr/bin/env bash"))
        self.assertIn("set -euo pipefail", text)
        # A step that detaches itself escapes the job's own timeout and its cancellation, which is the one way
        # a runner keeps billing after the run it belongs to has been stopped.
        self.assertNotIn("nohup", text)
        self.assertNotIn("&\n", text)
        self.assertTrue(SCRIPT.stat().st_mode & 0o111)


if __name__ == "__main__":
    unittest.main(verbosity=1)
