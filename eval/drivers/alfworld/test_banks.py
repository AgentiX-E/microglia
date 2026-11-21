"""The banks, checked as files: every one of them is a register entry and none of them is read by a validator.

A bank is the only input to a paid dispatch that a person writes by hand. `agent.py` numbers whatever it
is given, `anchor` scores whatever words it finds, and the pass reports a win rate for the pack it actually
built — so a bank with one rule stored twice is not an error anywhere in the lane. It is a pack that pays
the per-sentence price twice for one sentence and files the reading under the bank's name. That is the
defect class this file exists for, and it is cheap to check because the banks are files.

Three groups of tests, in the order the lane needs them:

* `EveryBankTest` runs `distill.validate_bank` over every file in `banks/`, so a bank that the register
  quotes is a bank that passes the same check `distill.main` refuses to write.
* `ValidatorTest` breaks one property at a time on a clean payload. A validator that has only ever been
  run against valid banks is a validator nobody has seen fail.
* `DesignTest` holds the shape of the current sweep: four banks that are meant to be one grid (long/short
  by full/reduced content), and a compression that must keep every operation its source named. The second
  is the guard that lets a `terse` arm be read at all — if a rewrite drops the inventory check, the arm
  measures a shorter pack rather than a shorter way of saying the same thing.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import agent as driver  # noqa: E402
import distill  # noqa: E402

BANKS = HERE / "banks"


def payload_of(name: str) -> dict:
    return json.loads((BANKS / name).read_text(encoding="utf-8"))


def clean_payload() -> dict:
    return {
        "schema": distill.SCHEMA,
        "cap": 20,
        "identity": "substring",
        "entries": [{"text": "Open the fridge before putting the apple in it.", "votes": 3}],
    }


class EveryBankTest(unittest.TestCase):
    def banks(self) -> "list[Path]":
        return sorted(BANKS.glob("*.json"))

    def test_there_are_banks_to_check(self):
        # A glob that matches nothing makes every assertion below vacuous, and this lane has already
        # published one reading from a split it had not checked was covered.
        self.assertGreaterEqual(len(self.banks()), 8)

    def test_every_bank_is_the_schema_the_arm_reads(self):
        for path in self.banks():
            with self.subTest(bank=path.name):
                payload = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(payload["schema"], distill.SCHEMA)

    def test_no_bank_has_a_defect(self):
        for path in self.banks():
            with self.subTest(bank=path.name):
                self.assertEqual(distill.validate_bank(json.loads(path.read_text(encoding="utf-8"))), [])

    def test_every_bank_says_which_registration_it_belongs_to(self):
        # The provenance is the difference between an arm and a bank someone found in a directory. It is
        # required of every file here for the same reason `pass_header` records the arm's knobs.
        for path in self.banks():
            with self.subTest(bank=path.name):
                source = json.loads(path.read_text(encoding="utf-8")).get("source") or {}
                self.assertTrue(
                    source.get("registration") or source.get("prompt"),
                    f"{path.name} names neither a registration nor a prompt",
                )


class ValidatorTest(unittest.TestCase):
    def test_a_clean_bank_has_no_defects(self):
        self.assertEqual(distill.validate_bank(clean_payload()), [])

    def test_the_wrong_schema_is_reported(self):
        payload = clean_payload()
        payload["schema"] = "microglia.alfworld-bank/0"
        self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_no_entries_is_reported_once_rather_than_per_entry(self):
        payload = clean_payload()
        payload["entries"] = []
        self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_entries_that_are_not_a_list_are_reported(self):
        payload = clean_payload()
        payload["entries"] = {"1": "Open the fridge."}
        self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_an_entry_without_a_text_is_reported(self):
        payload = clean_payload()
        payload["entries"] = [{"votes": 3}]
        self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_an_empty_entry_is_reported(self):
        payload = clean_payload()
        payload["entries"].append({"text": "   ", "votes": 1})
        self.assertIn("entry 2 is empty", distill.validate_bank(payload))

    def test_an_untrimmed_entry_is_reported(self):
        # Untrimmed text changes the rendered length the price is quoted at without changing a word.
        payload = clean_payload()
        payload["entries"].append({"text": " Close it again.", "votes": 1})
        self.assertIn("entry 2 is untrimmed", distill.validate_bank(payload))

    def test_a_second_line_is_reported(self):
        payload = clean_payload()
        payload["entries"].append({"text": "Open it.\nThen close it.", "votes": 1})
        self.assertIn("entry 2 spans more than one line", distill.validate_bank(payload))

    def test_an_entry_that_numbers_itself_is_reported(self):
        # What a bank pasted out of a rendered prompt looks like, and it renders as `2. 2. …`.
        payload = clean_payload()
        payload["entries"].append({"text": "2. Then close it.", "votes": 1})
        self.assertIn("entry 2 carries its own number", distill.validate_bank(payload))

    def test_votes_must_be_a_count(self):
        for bad in (-1, "3", True, 2.5, None):
            with self.subTest(votes=bad):
                payload = clean_payload()
                payload["entries"][0]["votes"] = bad
                self.assertIn(f"entry 1 has votes {bad!r}", distill.validate_bank(payload))

    def test_one_rule_stored_twice_is_reported_in_both_directions(self):
        # ExpeL's merge test is directional because it streams a reply against a growing list. A stored
        # bank has no arrival order, so either containment is the same defect.
        longer = "Open the fridge first, then put the apple in it."
        for first, second in ((longer, "open the fridge first"), ("open the fridge first", longer)):
            with self.subTest(first=first[:20]):
                payload = clean_payload()
                payload["entries"] = [{"text": first, "votes": 1}, {"text": second, "votes": 1}]
                self.assertIn("entries 1 and 2 are one rule stored twice", distill.validate_bank(payload))

    def test_two_rules_that_merely_share_words_are_not_a_repeat(self):
        payload = clean_payload()
        payload["entries"] = [
            {"text": "Open the fridge before putting the apple in it.", "votes": 1},
            {"text": "Open the microwave before putting the bowl in it.", "votes": 1},
        ]
        self.assertEqual(distill.validate_bank(payload), [])

    def test_a_bank_past_its_caps_margin_is_reported(self):
        payload = clean_payload()
        payload["cap"] = 1
        payload["entries"] = [{"text": f"Rule number {index}.", "votes": 1} for index in range(1, 8)]
        self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_a_bank_without_a_cap_is_not_checked_against_one(self):
        payload = clean_payload()
        payload.pop("cap")
        payload["entries"] = [{"text": f"Rule number {index}.", "votes": 1} for index in range(1, 12)]
        self.assertEqual(distill.validate_bank(payload), [])

    def test_a_tag_no_game_can_match_is_reported(self):
        # The failure this guards is silent by construction: `--gate-kind` selects by equality against the kind
        # `task_kind_of` returns, so a tag spelled `washing` is a rule that never fires while the arm reports a
        # pack of one entry — the tag is read, the rule is not.
        payload = clean_payload()
        payload["entries"][0]["kinds"] = ["washing"]
        self.assertIn("is tagged ['washing'], which no game can match", distill.validate_bank(payload)[0])

    def test_a_tag_that_is_not_a_list_of_names_is_reported(self):
        for bad in ("put", [], [3], {"put": True}):
            with self.subTest(kinds=bad):
                payload = clean_payload()
                payload["entries"][0]["kinds"] = bad
                self.assertEqual(len(distill.validate_bank(payload)), 1)

    def test_every_published_kind_is_a_tag_some_bank_uses(self):
        # `KINDS` is read from the driver's prefix table, so a seventh task type would arrive here first and fail
        # as "this kind has no sentence" rather than as an arm that silently carries nothing for those games.
        tags = set()
        for path in sorted(BANKS.glob("*.json")):
            for entry in json.loads(path.read_text(encoding="utf-8")).get("entries") or []:
                tags |= set(entry.get("kinds") or [])
        self.assertEqual(tags, set(distill.KINDS))


class LengthTest(unittest.TestCase):
    def test_the_quoted_length_excludes_the_header(self):
        # The header is a constant of the template, so a figure that included it would make every
        # compression look smaller than it is — the one comparison the current sweep is about.
        payload = clean_payload()
        text = payload["entries"][0]["text"]
        self.assertEqual(distill.bank_length(payload), len(text))
        self.assertEqual(len(driver.render_pack([text])), len(text) + len(driver.PACK_HEADER) + len("\n1. \n\n"))

    def test_an_empty_bank_is_zero_rather_than_an_error(self):
        self.assertEqual(distill.bank_length({"entries": []}), 0)
        self.assertEqual(distill.bank_length({}), 0)


class DesignTest(unittest.TestCase):
    """The four banks that are meant to be one grid, and the guard the compressed one needs.

    The sweep is a 2×2: the registered block (four entries) and the bare pair (two) on the long side, the
    one-sentence arm and the compressed pair on the short side. The compressed bank is what separates
    *characters* from *statements*: it carries the bare pair's operations at the one-sentence arm's length,
    so if that arm wins and this one does not, the cost is in the count of statements rather than in the
    text — and if this one wins too, the cost is in the characters and a store can be made cheap by
    rewriting what it already knows.
    """

    OPERATIONS = ("inventory", "silent", "move <object> to <receptacle>", "container")

    def text_of(self, name: str) -> str:
        return " ".join(entry["text"] for entry in payload_of(name)["entries"])

    def rendered(self, name: str) -> int:
        return len(driver.render_pack([entry["text"] for entry in payload_of(name)["entries"]]))

    def test_the_compressed_pair_keeps_every_operation_it_claims(self):
        terse = self.text_of("bank-putpair-terse-2.json").lower()
        declared = payload_of("bank-putpair-terse-2.json")["source"]["operations_kept"]
        self.assertGreaterEqual(len(declared), 5)
        for operation in self.OPERATIONS:
            with self.subTest(operation=operation):
                self.assertIn(operation, terse)

    def test_the_two_banks_differ_in_register_rather_than_in_what_they_ask_for(self):
        # The one operation whose wording is the point of the compression: the prose names the class of
        # receptacle, the compressed one says "that type". Both ask for a second receptacle; the guard is
        # that the request survives at all, which is what the row above cannot see.
        self.assertIn("another receptacle of that type", self.text_of("bank-putpair-terse-2.json"))
        self.assertIn("a different valid receptacle of the same type", self.text_of("bank-putpair-2.json"))

    def test_the_compressed_pair_is_matched_in_length_to_the_one_sentence_arm(self):
        # R174.1's arm rendered at 489 characters. The tolerance is the one every registration in this
        # lane uses for a length claim: 5%.
        self.assertAlmostEqual(self.rendered("bank-putpair-terse-2.json") / 489, 1.0, delta=0.05)

    def test_the_compressed_pair_is_shorter_than_the_bare_pair_by_a_third(self):
        terse = payload_of("bank-putpair-terse-2.json")
        prose = payload_of("bank-putpair-2.json")
        self.assertEqual(len(terse["entries"]), len(prose["entries"]))
        share = distill.bank_length(terse) / distill.bank_length(prose)
        self.assertLess(share, 0.6)
        self.assertGreater(share, 0.4)

    def test_the_grid_does_not_collapse(self):
        # Four banks, four lengths, in the order the design needs: the block is the longest, then the pair,
        # then the compressed pair, and the compressed pair sits beside the one sentence rather than past
        # it. The block's and the pair's numbers are the ones the register quotes, so a bank edited in
        # place fails here rather than silently re-pricing a paid arm.
        self.assertEqual(self.rendered("bank-44754440122.json"), 1312)
        self.assertEqual(self.rendered("bank-putpair-2.json"), 802)
        self.assertGreater(self.rendered("bank-putpair-2.json"), self.rendered("bank-putpair-terse-2.json"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
