"""The cycle reader's tests: the arithmetic, and every way a slice can pretend to support it.

The reader decides whether the next dispatch is worth buying, which makes two failures expensive in opposite
directions: a count that is too high buys a treatment with no purchase on the corpus, and a count that is too
low closes a mechanism that was never tried. So the fixtures here are records whose repeats a reader can check
by eye, and the refusal tests are the ones where a wrong answer would still look like an answer -- a slice
whose fires are not its refusals, a record that predates the field, a game counted in two shards.

Run: python3 eval/drivers/alfworld/test_cycles.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cycles  # noqa: E402


def corrupt(record: dict, **fields) -> dict:
    """One field of an otherwise consistent record replaced, which is how a lying slice is described."""
    record = dict(record)
    record.update(fields)
    return record


def episode(game: str = "g", won: bool = False, commands=(), refused=(), **overrides) -> dict:
    """One episode whose counters agree with its record, because that is what a real episode does.

    `refused` names the turns a line answered. Every field the reader cross-checks is derived from the record
    rather than passed, so a test that wants a *broken* record has to say which field it is breaking.
    """
    commands = list(commands)
    refused = list(refused)
    record = {
        "gamefile": game,
        "won": won,
        "commands": commands,
        "fire_turns": refused,
        "ledger_fires": len(refused),
        "invalid_actions": len(refused),
        "refused_actions": len(refused),
        "actions": len(commands) - len(refused),
        "steps": len(commands) + 2,
    }
    record.update(overrides)
    return record


class OrdinalTest(unittest.TestCase):
    def test_the_digit_suffixes(self):
        self.assertEqual(cycles.ordinal(2), "2nd")
        self.assertEqual(cycles.ordinal(3), "3rd")
        self.assertEqual(cycles.ordinal(4), "4th")

    def test_the_teens_are_not_firsts_or_thirds(self):
        # The case a suffix table keyed on the last digit alone gets wrong, which is why it is checked first.
        for count in (11, 12, 13, 111, 112, 113):
            self.assertEqual(cycles.ordinal(count), f"{count}th")

    def test_the_line_is_the_whole_cost_model(self):
        self.assertEqual(cycles.line_for("look", 2), 'Again: "look" (2nd time).')
        self.assertEqual(len(cycles.line_for("look", 2)), 25)


class AcceptedRepeatTest(unittest.TestCase):
    def test_a_second_accepted_command_is_one_loop(self):
        self.assertEqual(cycles.accepted_repeats(["a", "b", "a"], set()), [(2, 2, "loop")])

    def test_a_repeat_the_world_refused_is_not_seen_by_a_refusal_trigger(self):
        # The turn was answered, so a refusal-triggered line already fired on it and it is not new information.
        self.assertEqual(cycles.accepted_repeats(["a", "b", "a"], {2}), [])

    def test_each_occurrence_carries_its_own_number(self):
        self.assertEqual(cycles.accepted_repeats(["a", "a", "a"], set()), [(1, 2, "loop"), (2, 3, "loop")])

    def test_a_refused_repeat_stays_refused(self):
        # A command the world refuses once is refused again; excluding the first occurrence excludes the chain.
        self.assertEqual(cycles.accepted_repeats(["a", "a"], {0, 1}), [])

    def test_two_different_commands_are_two_loops(self):
        self.assertEqual(cycles.accepted_repeats(["a", "b", "a", "b"], set()), [(2, 2, "loop"), (3, 2, "loop")])

    def test_a_repeat_after_a_refusal_is_a_retry_and_not_a_loop(self):
        # Admissibility is state-dependent: a `take` refused at a distance is accepted after walking over, so
        # the second attempt is progress and a line that called it a repetition would be wrong about the turn.
        self.assertEqual(cycles.accepted_repeats(["a", "a"], {0}), [(1, 2, "retry")])

    def test_a_retry_then_a_loop_are_counted_separately(self):
        self.assertEqual(cycles.accepted_repeats(["a", "a", "a"], {0}), [(1, 2, "retry"), (2, 3, "loop")])


class ChainTest(unittest.TestCase):
    def test_a_two_turn_chain_counts_its_confirmations(self):
        # `a b a b` is three commands long: two turns repeat the one two back, and neither is a stall.
        self.assertEqual(cycles.longest_run(["a", "b", "a", "b"], 2), 2)

    def test_a_stall_is_not_a_chain(self):
        self.assertEqual(cycles.longest_run(["a", "a", "a"], 2), 0)

    def test_a_three_turn_chain_needs_all_three_to_differ(self):
        self.assertEqual(cycles.longest_run(["a", "b", "c", "a", "b", "c"], 3), 3)
        # A command that repeats three back but is identical to its two neighbours is a stall, not a cycle.
        self.assertEqual(cycles.longest_run(["a", "a", "a", "a", "a", "a"], 3), 0)

    def test_a_chain_ends_when_the_pattern_does(self):
        self.assertEqual(cycles.longest_run(["a", "b", "a", "b", "c", "d"], 2), 2)
        self.assertEqual(cycles.longest_run(["a", "b"], 2), 0)

    def test_a_record_shorter_than_the_period_has_no_chain(self):
        self.assertEqual(cycles.longest_run([], 2), 0)
        self.assertEqual(cycles.longest_run(["a"], 3), 0)


class ReadTest(unittest.TestCase):
    def reading(self, *episodes):
        return cycles.read(list(episodes))

    def test_the_counts_are_the_episodes_own(self):
        reading = self.reading(
            episode("won", won=True, commands=["a", "b"], refused=[]),
            episode("lost", commands=["a", "b", "a", "x"], refused=[3]),
        )
        self.assertEqual(reading["episodes"], 2)
        self.assertEqual(reading["won"], 1)
        self.assertEqual(reading["lost"], 1)
        self.assertEqual(reading["commands"], 6)
        self.assertEqual(reading["refused"], 1)
        self.assertEqual(reading["accepted_repeats"], 1)
        self.assertEqual(reading["games_with_repeat"], 1)
        self.assertEqual(reading["lost_with_repeat"], 1)
        self.assertEqual(reading["headroom"], 100.0)
        self.assertEqual(reading["repeat_share"], 100.0 / 6)

    def test_the_price_is_the_rendered_line(self):
        reading = self.reading(episode(commands=["a", "b", "a"]))
        self.assertEqual(reading["chars"], len('Again: "a" (2nd time).') + 1)
        self.assertEqual(reading["sample"], 'Again: "a" (2nd time).')
        self.assertEqual(reading["chars_per_line"], reading["chars"])

    def test_a_slice_with_no_losses_has_no_headroom_to_report(self):
        reading = self.reading(episode(won=True, commands=["a", "b", "a"]))
        self.assertEqual(reading["lost"], 0)
        self.assertEqual(reading["headroom"], 0.0)

    def test_a_slice_with_no_repeats_divides_by_nothing(self):
        reading = self.reading(episode(commands=["a", "b"]))
        self.assertEqual(reading["accepted_repeats"], 0)
        self.assertEqual(reading["chars_per_line"], 0.0)
        self.assertEqual(reading["sample"], "")
        self.assertEqual(reading["most_repeated"], 1)

    def test_a_retry_is_not_headroom_and_is_not_priced(self):
        reading = self.reading(episode(commands=["a", "a"], refused=[0]))
        self.assertEqual(reading["accepted_repeats"], 1)
        self.assertEqual(reading["looped"], 0)
        self.assertEqual(reading["retried"], 1)
        self.assertEqual(reading["headroom"], 0.0)
        self.assertEqual(reading["chars"], 0.0)
        self.assertEqual(reading["sample"], "")

    def test_a_loop_is_headroom_and_is_priced(self):
        reading = self.reading(episode(commands=["a", "a"], refused=[]))
        self.assertEqual(reading["looped"], 1)
        self.assertEqual(reading["retried"], 0)
        self.assertEqual(reading["headroom"], 100.0)
        self.assertEqual(reading["chars"], len('Again: "a" (2nd time).') + 1)

    def test_the_worst_game_is_the_most_repeated(self):
        reading = self.reading(
            episode("quiet", commands=["a", "b", "a"]),
            episode("loud", commands=["a", "b", "a", "b", "a", "b"]),
        )
        self.assertEqual(reading["longest_period_two"], 4)
        self.assertEqual(reading["most_repeated"], 3)
        self.assertEqual(reading["looped"], 5)  # four in `loud`, one in `quiet`
        self.assertEqual(len(reading["rows"]), 2)

    def test_the_report_states_every_number_once(self):
        lines = cycles.report(self.reading(episode("g", commands=["a", "b", "a"])))
        joined = "\n".join(lines)
        for fragment in ("episodes 1", "headroom 1 of 1", "chars/line", "chains", "sample line"):
            self.assertIn(fragment, joined)

    def test_a_slice_without_repeats_prints_no_sample(self):
        lines = cycles.report(self.reading(episode(commands=["a", "b"])))
        self.assertFalse([line for line in lines if line.startswith("sample line")])

    def test_the_detail_is_shortest_first_by_evidence(self):
        reading = self.reading(
            episode("small", commands=["a", "b", "a"]),
            episode("large", commands=["a", "b", "a", "b", "a"]),
            episode("none", commands=["a", "b"]),
        )
        rows = cycles.detail(reading)
        self.assertEqual(len(rows), 3)  # the header and the two games that repeated something
        self.assertIn("large", rows[1])
        self.assertNotIn("none", "\n".join(rows))


class RefusalTest(unittest.TestCase):
    def refused(self, *episodes):
        with self.assertRaises(cycles.Refused) as caught:
            cycles.read(list(episodes))
        return str(caught.exception)

    def test_an_empty_slice_is_not_a_reading_of_zero(self):
        self.assertIn("nothing to read", self.refused())

    def test_a_record_without_commands_predates_the_field(self):
        message = self.refused(corrupt(episode(commands=["a"]), commands=None))
        self.assertIn("no command record", message)

    def test_a_record_whose_entries_are_not_commands_is_malformed(self):
        self.assertIn("malformed", self.refused(episode(commands=["a", ""])))
        self.assertIn("malformed", self.refused(corrupt(episode(commands=["a"]), commands="a b")))

    def test_a_record_without_fires_cannot_call_a_turn_accepted(self):
        self.assertIn("no fire record", self.refused(corrupt(episode(commands=["a"]), fire_turns=None)))
        self.assertIn("no fire record", self.refused(corrupt(episode(commands=["a"]), fire_turns=["0"], ledger_fires=1)))

    def test_fires_that_disagree_with_their_own_counter_are_refused(self):
        message = self.refused(corrupt(episode(commands=["a", "b"], refused=[1]), ledger_fires=2))
        self.assertIn("the two counts of the same event disagree", message)

    def test_fires_that_are_not_refusals_are_refused(self):
        # The identity R191 and R193 measured on 822 games: a fire answered a refusal. Where it does not hold,
        # the reader cannot tell an accepted turn from a refused one, and a repeat count would be a guess.
        message = self.refused(corrupt(episode(commands=["a", "b"], refused=[1]), invalid_actions=0))
        self.assertIn("a fire is not a refusal here", message)

    def test_a_record_that_disagrees_with_its_actions_and_refusals_is_refused(self):
        message = self.refused(corrupt(episode(commands=["a", "b"], refused=[1]), actions=5))
        self.assertIn("commands against", message)

    def test_fire_turns_out_of_order_or_out_of_range_are_refused(self):
        self.assertIn("increasing", self.refused(episode(commands=["a", "b", "c"], refused=[2, 1])))
        self.assertIn("increasing", self.refused(episode(commands=["a"], refused=[3])))

    def test_a_game_in_two_slices_is_counted_once_or_not_at_all(self):
        message = self.refused(episode("same", commands=["a"]), episode("same", commands=["b"]))
        self.assertIn("more than one slice", message)


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp()

    def tearDown(self):
        for path in Path(self.directory).iterdir():
            path.unlink()
        Path(self.directory).rmdir()

    def write(self, name: str, payload) -> str:
        path = Path(self.directory) / name
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
        return str(path)

    def test_two_slices_are_one_reading(self):
        first = self.write("a.json", {"episodes": [episode("one", commands=["a", "b", "a"])]})
        second = self.write("b.json", {"episodes": [episode("two", commands=["a"])]})
        self.assertEqual(len(cycles.load([first, second])), 2)

    def test_a_file_that_is_not_json_is_refused(self):
        path = self.write("bad.json", "{")
        with self.assertRaises(cycles.Refused) as caught:
            cycles.load([path])
        self.assertIn("not an arm artefact", str(caught.exception))

    def test_a_file_without_episodes_is_refused(self):
        path = self.write("empty.json", {"summary": {}})
        with self.assertRaises(cycles.Refused) as caught:
            cycles.load([path])
        self.assertIn("no episodes list", str(caught.exception))

    def test_a_missing_file_is_refused_rather_than_crashing(self):
        with self.assertRaises(cycles.Refused) as caught:
            cycles.load([str(Path(self.directory) / "absent.json")])
        self.assertIn("not an arm artefact", str(caught.exception))


class CliTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp()

    def tearDown(self):
        for path in Path(self.directory).iterdir():
            path.unlink()
        Path(self.directory).rmdir()

    def write(self, name: str, episodes) -> str:
        path = Path(self.directory) / name
        path.write_text(json.dumps({"episodes": episodes}), encoding="utf-8")
        return str(path)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cycles.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_the_reading_is_what_the_command_prints(self):
        path = self.write("arm.json", [episode("look_at_obj-1", commands=["a", "b", "a"])])
        code, out, err = self.run_cli(path)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertIn("accepted repeats 1", out)
        self.assertNotIn("look_at_obj-1", out)  # the detail is opt-in

    def test_the_detail_adds_the_games(self):
        path = self.write("arm.json", [episode("look_at_obj-1", commands=["a", "b", "a"])])
        code, out, _ = self.run_cli(path, "--detail")
        self.assertEqual(code, 0)
        self.assertIn("look_at_obj-1", out)

    def test_the_json_form_carries_the_numbers_and_not_the_rows(self):
        path = self.write("arm.json", [episode("g", commands=["a", "b", "a"])])
        code, out, _ = self.run_cli(path, "--json")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["accepted_repeats"], 1)
        self.assertNotIn("rows", payload)

    def test_a_slice_that_cannot_support_a_reading_exits_two(self):
        path = self.write("arm.json", [corrupt(episode("g", commands=["a"]), commands=None)])
        code, out, err = self.run_cli(path)
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("no command record", err)


if __name__ == "__main__":
    unittest.main()
