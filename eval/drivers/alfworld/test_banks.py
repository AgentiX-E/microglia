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


class RawTrajectoryTest(unittest.TestCase):
    """The bank that is evidence rather than advice, at the length of the advice it is compared to.

    `arXiv:2605.12978` finds that repeated abstraction degrades a useful memory and that raw trajectories stay
    competitive. This lane has spent five rounds distilling advice and never once offered the model the evidence
    the advice was distilled from, so the claim has never been testable here. It is testable in one arm: the
    verbatim segment of a won training game that shows a failed `put`, the model's own reasoning about phrasing,
    and the `move` that succeeded — 505 rendered characters against the one-sentence arm's 489.
    """

    def payload(self) -> dict:
        return payload_of("bank-rawput-1.json")

    def test_the_segment_is_verbatim_evidence_and_names_both_operations(self):
        text = self.payload()["entries"][0]["text"]
        for phrase in ("Nothing happens.", "> move toiletpaper 1 to toiletpaperhanger 1", "You move the toiletpaper 1"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        # Multi-line is what makes it evidence rather than a sentence, and the bank has to declare it for the
        # validator to accept it and for `render_pack` to indent it under one number.
        self.assertIn("\n", text)
        self.assertEqual(self.payload()["render"], "transcript")

    def test_it_is_matched_in_length_to_the_one_sentence_arm(self):
        rendered = len(driver.render_pack([self.payload()["entries"][0]["text"]]))
        self.assertAlmostEqual(rendered / 489, 1.0, delta=0.05)

    def test_it_carries_the_run_and_the_game_it_came_from(self):
        # A trajectory without provenance is a story. The register quotes the run id and the gamefile so the
        # segment can be re-read out of the artefact rather than trusted.
        source = self.payload()["source"]
        self.assertIn("44731175801", source["provenance"])
        self.assertIn("game.tw-pddl", source["provenance"])
        self.assertIn("verbatim", source["construction"])

    def test_a_multiline_bank_without_the_declaration_is_refused(self):
        payload = self.payload()
        payload.pop("render")
        self.assertIn("entry 1 spans more than one line", distill.validate_bank(payload))


class ProvenancePairTest(unittest.TestCase):
    """The two R178 banks: one sentence, two clauses, exactly the same rendered length.

    The round's claim is that `1a − 1b` is **provenance and nothing else**. That claim is only as good as the
    two files: if the clauses differ in length, the reading is provenance *plus* length, and this lane has
    already measured that a longer pack is paid for at the entry count (R174.2: −3.4 to −3.7 pp per sentence in
    a padded block). So this pair is held to **equality**, not to the 5% tolerance the earlier length claims
    used — a pair four characters apart cannot be read as a one-clause difference at any sample size.

    The second guard is the one that keeps the treatment honest. The clause has to name a run, and the other
    clause has to name nothing a reader could mistake for evidence, which is checked structurally: the control
    carries no digit at all. That is what makes "the difference between the arms is the source line" a property
    of the files rather than a sentence in a registration.
    """

    BASE = "bank-putmove-1.json"
    TREATMENT = "bank-putmove-source-1.json"
    CONTROL = "bank-putmove-note-1.json"
    CLAUSE = 62

    def text(self, name: str) -> str:
        return payload_of(name)["entries"][0]["text"]

    def rendered(self, name: str) -> int:
        return len(driver.render_pack([self.text(name)]))

    def clause(self, name: str) -> str:
        return self.text(name)[len(self.text(self.BASE)):]

    def test_both_arms_carry_the_sentence_byte_for_byte(self):
        base = self.text(self.BASE)
        for name in (self.TREATMENT, self.CONTROL):
            with self.subTest(bank=name):
                self.assertTrue(self.text(name).startswith(base))
                self.assertEqual(self.text(name)[: len(base)], base)

    def test_the_two_arms_render_the_same_length(self):
        # Equality rather than a tolerance: this is the pair whose whole reading is one clause.
        self.assertEqual(self.rendered(self.TREATMENT), self.rendered(self.CONTROL))
        self.assertEqual(self.rendered(self.TREATMENT), self.rendered(self.BASE) + self.CLAUSE)

    def test_the_clauses_are_the_same_length_and_in_the_same_position(self):
        # Same position is a separate claim from same length: a clause prepended to the control and appended to
        # the treatment would pass the length check and fail the design.
        self.assertEqual(len(self.clause(self.TREATMENT)), len(self.clause(self.CONTROL)))
        self.assertTrue(self.clause(self.TREATMENT).startswith(" ["))

    def test_the_treatment_names_a_run_and_the_control_names_no_number(self):
        treatment = self.clause(self.TREATMENT)
        control = self.clause(self.CONTROL)
        self.assertRegex(treatment, r"^ \[source: one won pick_and_place_simple game, run \d{11}\]$")
        self.assertNotRegex(control, r"[0-9]")

    def test_the_citation_is_the_run_the_metadata_names(self):
        # AUDIT 34.254: the clause cites a run in which the entry **won**, and the sentence was distilled from a
        # different run. Both are in the file now, so the next reader does not have to reconstruct which is which
        # from two run ids in two documents.
        source = payload_of(self.TREATMENT)["source"]
        self.assertIn(source["cited_run"], self.clause(self.TREATMENT))
        self.assertNotEqual(source["cited_run"], source["distilled_from_run"])
        self.assertIn(source["distilled_from_run"], source["note"])
        self.assertIn("won", source["kind"])


class GhostCitationTest(unittest.TestCase):
    """R179's arm: the same 551 characters, citing a run that does not exist.

    A bank in this tree that looks like a mistake is a bank somebody will fix. This one is a mistake on
    purpose — the arm is the claim, not the content — so the file has to say so in a field a test can read,
    and the clause has to differ from R178's true citation **only** in the run id, or the arm would be
    provenance plus a second difference.
    """

    GHOST = "bank-putmove-ghost-1.json"
    SOURCE = "bank-putmove-source-1.json"

    def payload(self) -> dict:
        return payload_of(self.GHOST)

    def clause(self, name: str) -> str:
        base = payload_of("bank-putmove-1.json")["entries"][0]["text"]
        return payload_of(name)["entries"][0]["text"][len(base):]

    def test_it_is_the_same_length_as_the_arm_it_is_read_against(self):
        rendered = len(driver.render_pack([self.payload()["entries"][0]["text"]]))
        self.assertEqual(rendered, 551)
        self.assertEqual(self.clause(self.GHOST), self.clause(self.SOURCE).replace("44841962248", "44800000000"))

    def test_it_declares_that_its_citation_is_false(self):
        source = self.payload()["source"]
        self.assertIs(source["false_by_construction"], True)
        self.assertEqual(source["cited_run"], "44800000000")
        self.assertIn("FALSE BY CONSTRUCTION", source["note"])


class PhraseAblationTest(unittest.TestCase):
    """R180's arm: the sentence with its second operation removed, at the length it is read against.

    The sentence states two operations — swap `put` for `move`, then try another receptacle of the same type
    and open it if it is a container — and the lane has never known which of them carries the +21.90 pp. The
    ablation keeps the first byte for byte, drops the second, and pads to the same 551 rendered characters, so
    the comparison with `bank-putmove-note-1.json` is one clause.

    The guard matters more than usual here: an ablation that also changed the length would be readable as
    "shorter" rather than as "less instruction", and every arm in this lane has been the wrong length at least
    once before it was checked.
    """

    ABLATED = "bank-putmove-phrase-1.json"
    FULL = "bank-putmove-note-1.json"
    HEAD = (
        'If a "put" action repeatedly fails despite being at the correct location and holding the object, '
        'try the alternative phrasing "move <object> to <receptacle>"'
    )

    def text(self, name: str) -> str:
        return payload_of(name)["entries"][0]["text"]

    def test_it_keeps_the_first_operation_byte_for_byte(self):
        self.assertTrue(self.text(self.ABLATED).startswith(self.HEAD))
        self.assertTrue(self.text(self.FULL).startswith(self.HEAD))

    def test_the_second_operation_is_gone(self):
        text = self.text(self.ABLATED).lower()
        for phrase in ("different valid receptacle", "ensure it is open", "if that also fails"):
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)
        self.assertIn("different valid receptacle", self.text(self.FULL).lower())

    def test_it_is_the_same_length_as_the_arm_it_is_read_against(self):
        ablated = len(driver.render_pack([self.text(self.ABLATED)]))
        full = len(driver.render_pack([self.text(self.FULL)]))
        self.assertEqual(ablated, full)
        self.assertEqual(ablated, 551)

    def test_the_filler_carries_no_digit_and_names_no_step(self):
        filler = self.text(self.ABLATED)[len(self.HEAD):]
        self.assertNotRegex(filler, r"[0-9]")
        self.assertNotIn("receptacle", filler.lower())
        self.assertIn("no operation", filler)


class RepairAnchorTest(unittest.TestCase):
    """R181 re-reads an arm R178 already bought, so the bank has to be the same bytes.

    The round's whole claim is a comparison *across* a driver change: the same bank, the same 274 games, a
    driver that no longer answers a refused command with `OK.`. If the anchor bank were edited afterwards — a
    word tightened, a clause added — the "before" column and the "after" column would no longer be the same
    treatment, and nothing in the arm files would say so: `pack chars` would still be 551, `carried` would
    still be 1.0, and the delta would be read as the repair.
    """

    def section(self) -> str:
        text = (HERE / "REGISTRATION.md").read_text(encoding="utf-8")
        start = text.index("## R181 —")
        end = text.find("\n## ", start + 1)
        return text[start:] if end == -1 else text[start:end]

    def test_the_registration_names_the_bank_it_re_reads(self):
        self.assertIn("bank-putmove-note-1.json", self.section())

    def test_the_hash_the_registration_records_is_the_hash_on_disk(self):
        import hashlib
        import re

        recorded = re.search(r"sha256 ([0-9a-f]{64})", self.section())
        self.assertIsNotNone(recorded, "R181 records no sha256, so a later edit is undetectable")
        actual = hashlib.sha256((BANKS / "bank-putmove-note-1.json").read_bytes()).hexdigest()
        self.assertEqual(recorded.group(1), actual, "the bank R181 re-reads is not the bank it recorded")

    def test_the_repair_answers_a_refused_command_with_the_corpus_own_word(self):
        # The defect is one string. `OK.` is the examples' answer to a thought that was only a thought; the
        # corpus answers a command that changed nothing with `Nothing happens.`, so that is the string a turn
        # whose command was refused has to get, and a later "nicer" wording would be a second invented token.
        self.assertEqual(driver.NO_OP, "Nothing happens.")
        self.assertNotEqual(driver.NO_OP, "OK.")


class FormatOperatorTest(unittest.TestCase):
    """R182's arm: the dead operation's slot, at the same length, carrying the operation the failures point at.

    R180 measured operation (2) as −0.73 pp at an identical 551 characters and R181 measured 16.5 refused commands
    per lost `put` game with `put` unmoved after the false acknowledgement was repaired. So the arm is R180's ablated
    entry with its **197-character tail** replaced — nothing else may differ, or the reading is a length effect or a
    head effect rather than the tail's.
    """

    LINE = "bank-putmove-line-1.json"
    ABLATED = "bank-putmove-phrase-1.json"
    HEAD = (
        'If a "put" action repeatedly fails despite being at the correct location and holding the object, '
        'try the alternative phrasing "move <object> to <receptacle>"'
    )

    def text(self, name: str) -> str:
        return payload_of(name)["entries"][0]["text"]

    def test_it_keeps_the_first_operation_byte_for_byte(self):
        self.assertTrue(self.text(self.LINE).startswith(self.HEAD))
        self.assertEqual(self.text(self.LINE)[: len(self.HEAD)], self.text(self.ABLATED)[: len(self.HEAD)])

    def test_it_is_the_same_length_as_the_arm_it_is_read_against(self):
        rendered = len(driver.render_pack([self.text(self.LINE)]))
        self.assertEqual(rendered, len(driver.render_pack([self.text(self.ABLATED)])))
        self.assertEqual(rendered, 551)

    def test_the_only_difference_is_the_tail(self):
        tail = self.text(self.LINE)[len(self.HEAD):]
        other = self.text(self.ABLATED)[len(self.HEAD):]
        self.assertNotEqual(tail, other)
        self.assertEqual(len(tail), len(other))
        self.assertEqual(len(tail), 197)

    def test_the_tail_names_the_format_and_nothing_else(self):
        tail = self.text(self.LINE)[len(self.HEAD):].lower()
        self.assertIn("alone on its own line", tail)
        self.assertIn("shares a line with a thought", tail)
        # The registry's void condition: a digit or an object name would make the tail a second task hint rather
        # than a statement about how to write the turn.
        self.assertNotRegex(tail, r"[0-9]")
        for word in ("receptacle", "cabinet", "countertop", "shelf", "drawer"):
            with self.subTest(word=word):
                self.assertNotIn(word, tail)

    def test_the_earlier_operations_are_not_restated(self):
        # R180 measured the container check dead. A tail that quietly restored it would make this arm a
        # re-measurement of R178 rather than of the format.
        tail = self.text(self.LINE)[len(self.HEAD):].lower()
        for phrase in ("different valid receptacle", "ensure it is open", "if that also fails"):
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, tail)


if __name__ == "__main__":
    unittest.main(verbosity=2)
