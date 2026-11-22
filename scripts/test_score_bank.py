"""The tests for `score_bank.py`: every definitional choice in the scorer, pinned.

The scorer exists because the admission family in the literature scores an entry *before* any rollout
(`arXiv:2608.20274`: utility = specificity x abstractness) and this lane has never tried it. A score that
is not pinned at its edges is a number nobody can argue with, so each test below fixes one choice:

1. what counts as specific (quoted command notation, as a share of the text, so length cannot buy it),
2. what counts as abstract (frame words, as a share of the words),
3. that the score is order-free -- which is a *design constraint*, not an accident: R188 bought the
   distinction between a sentence and its word-shuffled placebo for 3.03 CNY and read it as null, so a
   scorer that separated them would be reading a signal the corpus says is not there,
4. that the placebo really is a permutation of the sentence, so (3) is not vacuous,
5. that the pack scored is the pack the driver renders, because a score over a text nobody was shown is
   a score of nothing.

Run: python3 scripts/test_score_bank.py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import score_bank  # noqa: E402

LANE = HERE.parent / "eval" / "drivers" / "alfworld"
BANKS = LANE / "banks"

PUTSCOPE = BANKS / "bank-putscope-2.json"
TURNBUDGET = BANKS / "bank-turnbudget-1.json"
PLACEBO = BANKS / "bank-turnbudget-1-placebo.json"
FILLER = BANKS / "bank-filler-4.json"
PERKIND = BANKS / "bank-perkind-6.json"

KINDS = ("put", "puttwo", "clean", "heat", "cool", "examine")


def entries_of(path: Path) -> "list[dict]":
    return json.loads(path.read_text(encoding="utf-8"))["entries"]


def texts_of(path: Path) -> "list[str]":
    return [entry["text"] for entry in entries_of(path)]


class SpecificityTest(unittest.TestCase):
    """Specificity: the share of a sentence that is command notation rather than prose about commands."""

    def test_a_quoted_command_is_specific_and_a_generic_instruction_is_not(self):
        # The whole claim of the admission family in one assertion. The published entry names an admissible
        # command in the environment's own notation; the turn-budget sentence names no command at all, which
        # is why R188 measured it as inert and why it must score zero here rather than low-but-nonzero.
        named = texts_of(PUTSCOPE)[1]
        generic = texts_of(TURNBUDGET)[2]
        self.assertGreater(score_bank.specificity(named), 0.10)
        self.assertEqual(score_bank.specificity(generic), 0.0)

    def test_a_placeholder_is_specific_because_it_is_the_environment_s_own_grammar(self):
        # `<object>` and `<receptacle>` are how the corpus writes an action, so they count with the quotes.
        # Without this the scorer would reward a sentence for naming `"put"` and not for showing the grammar
        # that makes the naming usable. A placeholder alone is the whole text, so it is fully specific.
        self.assertEqual(score_bank.specificity("<object>"), 1.0)
        self.assertGreater(score_bank.specificity('try "move <object> to <receptacle>".'), 0.8)

    def test_specificity_is_a_share_so_padding_a_sentence_lowers_it(self):
        # Length must not buy specificity: two sentences with the same notation and different amounts of prose
        # are the same specificity only if the score is a *rate*. This is what lets reading 2 compare a
        # 551-character pack against an 814-character one without the longer one winning by size.
        short = "Try \"move <object> to <receptacle>\" when \"put\" fails."
        padded = short + " " + "Remember this carefully and consider it on every turn of the episode. " * 6
        self.assertGreater(score_bank.specificity(short), score_bank.specificity(padded))
        self.assertLess(score_bank.specificity(padded), score_bank.specificity(short) / 2)

    def test_a_sentence_with_unclosed_quotes_is_not_a_half_literal(self):
        # An unterminated quote is a typo, and reading it as a literal would reward the typo with specificity.
        # It is also the shape a markdown renderer leaves behind, so it is refused rather than parsed.
        self.assertEqual(score_bank.specificity("try \"move the apple to the fridge"), 0.0)

    def test_an_empty_sentence_scores_zero_rather_than_dividing_by_zero(self):
        self.assertEqual(score_bank.specificity(""), 0.0)
        self.assertEqual(score_bank.specificity("   "), 0.0)
        self.assertEqual(score_bank.utility(""), 0.0)


class AbstractnessTest(unittest.TestCase):
    """Abstractness: how much of the sentence states a rule rather than an incident."""

    def test_a_bare_imperative_has_no_frame_and_a_conditional_has_one(self):
        # "Open the cabinet." is an incident: it says what to do here. "Before taking anything out of a closed
        # cabinet, open it." is a rule: it names a class of situations and an order. The difference is carried
        # by the frame words and by nothing else, which is what makes it measurable without a parser.
        incident = "Open the cabinet."
        rule = "Before taking anything out of a closed cabinet, open it first."
        self.assertEqual(score_bank.abstractness(incident), 0.0)
        self.assertGreater(score_bank.abstractness(rule), 0.05)

    def test_abstractness_is_a_share_of_the_words_so_padding_does_not_raise_it(self):
        rule = "If a \"put\" action fails, try \"move <object> to <receptacle>\"."
        padded = rule + " " + "cabinet fridge drawer shelf countertop table sink stove " * 4
        self.assertGreater(score_bank.abstractness(rule), score_bank.abstractness(padded))

    def test_both_published_entries_carry_a_frame_because_both_are_conditional(self):
        for text in texts_of(PUTSCOPE):
            self.assertGreater(score_bank.abstractness(text), 0.05, text[:60])


class UtilityTest(unittest.TestCase):
    def test_utility_is_the_product_so_either_factor_can_zero_it(self):
        # A generic instruction has no specificity and a bare command has no frame; both must score zero, and
        # for different reasons. A sum would let the first buy points with prose.
        generic = "Every reply must end with a command."
        self.assertEqual(score_bank.specificity(generic), 0.0)
        bare = "Open the fridge."
        self.assertEqual(score_bank.abstractness(bare), 0.0)
        self.assertEqual(score_bank.utility(generic), 0.0)
        self.assertEqual(score_bank.utility(bare), 0.0)

    def test_the_published_entry_scores_above_every_filler_sentence(self):
        published = max(score_bank.utility(text) for text in texts_of(PUTSCOPE))
        self.assertGreater(published, 0.0)
        for text in texts_of(FILLER):
            self.assertLess(score_bank.utility(text), published, text[:60])


class OrderFreeTest(unittest.TestCase):
    """R188 bought the null on word order; the scorer must not claim a signal the corpus denies."""

    def test_the_placebo_really_is_a_permutation_of_the_sentence(self):
        # Without this the next test passes because the two texts are unrelated, which would prove nothing.
        # The placebo was produced by `agent.permute_words`, so the bags have to be equal and the strings not.
        sentence = texts_of(TURNBUDGET)[2]
        placebo = texts_of(PLACEBO)[2]
        self.assertNotEqual(sentence, placebo)
        self.assertEqual(sorted(sentence.split()), sorted(placebo.split()))

    def test_permuting_the_words_moves_the_score_by_less_than_the_registered_band(self):
        # Registered reading 3. Specificity is lexical and abstractness is a share of the words, so both are
        # permutation-invariant by construction -- the band is met exactly, and the point of the test is that
        # it *stays* met if either definition is later made positional.
        sentence = texts_of(TURNBUDGET)[2]
        placebo = texts_of(PLACEBO)[2]
        self.assertLess(abs(score_bank.utility(sentence) - score_bank.utility(placebo)), 0.05)
        self.assertAlmostEqual(score_bank.specificity(sentence), score_bank.specificity(placebo), places=9)
        self.assertAlmostEqual(score_bank.abstractness(sentence), score_bank.abstractness(placebo), places=9)

    def test_the_two_packs_of_r188_score_the_same_because_they_are_the_same_bag(self):
        # The unit R188 bought is the bank, and the two banks hold two identical entries plus the pair above.
        first = score_bank.score_bank(TURNBUDGET)
        second = score_bank.score_bank(PLACEBO)
        self.assertAlmostEqual(first["pack_utility"], second["pack_utility"], places=9)


class CoverageTest(unittest.TestCase):
    """Coverage: does the entry name the operation the kind ends on? This is the scope half, not the score."""

    def test_the_published_entry_covers_the_kinds_whose_step_it_names(self):
        text = texts_of(PUTSCOPE)[1]
        self.assertTrue(score_bank.covers(text, "put"))
        self.assertTrue(score_bank.covers(text, "puttwo"))

    def test_the_published_entry_does_not_cover_examine_because_it_names_no_look(self):
        # R177 measured this entry at -12.9 pp on `examine`, on both sections, in two dispatches. Coverage
        # predicts the sign of that cell without a rollout -- the entry names `put` and `move`, and an
        # `examine` game has no placement step for either to repair.
        text = texts_of(PUTSCOPE)[1]
        self.assertFalse(score_bank.covers(text, "examine"))

    def test_a_kind_local_entry_covers_only_its_own_kind(self):
        # `bank-perkind-6` is one sentence per kind, written from the corpus's own task descriptions, so its
        # coverage table is the identity matrix. A scorer that could not reproduce that is not reading the
        # entry at all.
        rows = score_bank.score_bank(PERKIND)["entries"]
        covered = {row["kinds"][0]: [kind for kind in KINDS if row["covers"][kind]] for row in rows}
        self.assertEqual(covered["put"], ["put", "puttwo"])
        self.assertEqual(covered["examine"], ["examine"])

    def test_coverage_is_lexical_and_a_homonym_fools_it(self):
        # The limit, pinned rather than argued: the typewriter filler says "spread a clean white cloth", and a
        # substring test reads that as covering `clean`. R181 paid for this lesson on the other side -- an
        # entry's referent is not its vocabulary -- so the test records the false positive instead of hiding it.
        text = texts_of(FILLER)[0]
        self.assertTrue(score_bank.covers(text, "clean"))
        self.assertFalse(score_bank.covers(text, "heat"))


class PackTest(unittest.TestCase):
    """The pack, not the bank: a score over a text nobody was shown is a score of nothing."""

    def test_the_scored_pack_is_the_pack_the_driver_renders(self):
        # The two rendered lengths this lane has published, reproduced from the driver's own `render_pack`
        # and `applicable`: 551 for the scoped bank (one 354-character entry per game) and 814 for the
        # turn-budget bank (the same entry plus one untagged 259-character sentence on every game).
        scoped = score_bank.score_bank(PUTSCOPE)
        budget = score_bank.score_bank(TURNBUDGET)
        self.assertEqual({pack["chars"] for pack in scoped["packs"].values()}, {551})
        self.assertEqual({pack["entries"] for pack in scoped["packs"].values()}, {1})
        self.assertEqual({pack["chars"] for pack in budget["packs"].values()}, {814})
        self.assertEqual({pack["entries"] for pack in budget["packs"].values()}, {2})

    def test_reading_two_holds_the_scoped_pack_scores_above_the_longer_one(self):
        # Registered reading 2: the 551-character pack scores above the 814-character one on specificity,
        # because the extra sentence is a general instruction with no task-naming content.
        scoped = score_bank.score_bank(PUTSCOPE)["pack_specificity"]
        budget = score_bank.score_bank(TURNBUDGET)["pack_specificity"]
        self.assertGreater(scoped, budget)
        self.assertAlmostEqual((scoped - budget) / scoped, (259) / 814, places=2)

    def test_two_banks_of_identical_sentences_differ_only_where_the_tags_decide(self):
        # R186 and R187 hold the same two sentences byte for byte and differ only in which kinds each entry
        # is tagged to. Their *entry* scores are therefore identical to the digit -- and their pack means are
        # not, because a pack is a selection and the tag set is what selects. So the score's only view of
        # reach is the one the mean accidentally carries, and here it points the wrong way: R187 scores
        # higher (0.0871 against 0.0708) and measured 3.65 pp lower. That is an ordering the score cannot
        # claim, not evidence against it: 3.65 pp is inside the noise band this lane has measured.
        from_r186 = score_bank.score_bank(PUTSCOPE)
        from_r187 = score_bank.score_bank(BANKS / "bank-putscope-3.json")
        self.assertEqual(
            [entry["utility"] for entry in from_r186["entries"]],
            [entry["utility"] for entry in from_r187["entries"]],
        )
        self.assertGreater(from_r187["pack_specificity"], from_r186["pack_specificity"])
        self.assertEqual(
            {pack["chars"] for pack in from_r186["packs"].values()},
            {pack["chars"] for pack in from_r187["packs"].values()},
        )

    def test_a_kind_the_bank_does_not_tag_reads_only_the_untagged_entries(self):
        # The pack is selected the way the driver selects it, so a gated bank gives an untagged kind nothing
        # but the framing -- and its score is the framing's, which is zero.
        scoped = score_bank.score_bank(PUTSCOPE)
        self.assertEqual(scoped["packs"]["put"]["chars"], 551)
        self.assertEqual(scoped["packs"]["put"]["entries"], 1)
        self.assertEqual(len({pack["chars"] for pack in scoped["packs"].values()}), 1)


class BlindTest(unittest.TestCase):
    """The score may not see the effect. The registration's void clause is a property of the interface."""

    def setUp(self):
        self.temporary = []

    def tearDown(self):
        for path in self.temporary:
            Path(path).unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        handle, path = tempfile.mkstemp(suffix=".json", prefix=name)
        os.close(handle)
        Path(path).write_text(json.dumps(payload), encoding="utf-8")
        self.temporary.append(path)
        return Path(path)

    def test_the_score_is_the_same_for_a_bank_with_its_provenance_removed(self):
        # A bank that carried its measured effect in `source` would score differently from the same entries
        # with that paragraph deleted, if the scorer read anything but `text` and `kinds`. This is the void
        # clause as an executable check.
        full = json.loads(PUTSCOPE.read_text(encoding="utf-8"))
        bare = {"entries": [{"text": entry["text"], "kinds": entry["kinds"]} for entry in full["entries"]]}
        self.assertEqual(
            score_bank.score_bank(PUTSCOPE)["pack_utility"], score_bank.score_bank(self.write("bare", bare))["pack_utility"]
        )

    def test_a_bank_with_no_entries_is_refused(self):
        path = self.write("empty", {"entries": []})
        with self.assertRaises(SystemExit):
            score_bank.score_bank(path)

    def test_an_entry_with_no_text_is_refused_rather_than_scored_as_empty(self):
        # An empty string scores zero, which is a *reading*. An entry that has no text is a broken file, and
        # the difference between "scores zero" and "was not read" is the difference this record keeps finding.
        path = self.write("broken", {"entries": [{"votes": 3}]})
        with self.assertRaises(SystemExit):
            score_bank.score_bank(path)


class CorrelationTest(unittest.TestCase):
    """Reading 1's statistic, with its sample size as part of the function's contract."""

    def test_a_perfect_order_is_one_and_a_perfect_reverse_is_minus_one(self):
        self.assertAlmostEqual(score_bank.spearman([(1, 1), (2, 2), (3, 3)]), 1.0)
        self.assertAlmostEqual(score_bank.spearman([(1, 3), (2, 2), (3, 1)]), -1.0)

    def test_ties_are_averaged_rather_than_broken_by_position(self):
        # Two banks with the same score are the same rank. Breaking the tie by file order would let the order
        # of the command line decide a correlation, which is the defect `--relabel` had to be written around.
        self.assertAlmostEqual(score_bank.spearman([(1, 2), (1, 3), (2, 1)]), -0.8660254037844387, places=9)

    def test_fewer_than_three_points_is_refused_rather_than_reported(self):
        # Two points give +-1 for any pair, which reads as a finding. It is arithmetic, not evidence.
        with self.assertRaises(SystemExit):
            score_bank.spearman([(1, 1), (2, 2)])


class MainTest(unittest.TestCase):
    def setUp(self):
        self.original = sys.argv

    def tearDown(self):
        sys.argv = self.original

    def run_main(self, argv):
        sys.argv = ["score_bank.py"] + argv
        return score_bank.main()

    def test_the_table_prints_one_row_per_bank_with_both_factors_and_the_reach(self):
        import contextlib
        import io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(self.run_main([str(PUTSCOPE), str(TURNBUDGET)]), 0)
        printed = buffer.getvalue().splitlines()
        rows = [line for line in printed if line.startswith("bank ")]
        self.assertEqual(len(rows), 2, printed)
        self.assertTrue(all("specificity" in line and "utility" in line for line in rows), rows)
        # Reach is printed beside the score and not folded into it: which kinds a bank's packs exist for is
        # scope, and scope is the half of the question the score does not answer.
        self.assertTrue(all("reaches" in line for line in rows), rows)
        self.assertIn("551", rows[0])
        self.assertIn("814", rows[1])

    def test_the_json_form_carries_the_packs_so_a_reader_can_see_what_was_scored(self):
        import io
        import contextlib

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertEqual(self.run_main(["--json", str(PUTSCOPE)]), 0)
        payload = json.loads(buffer.getvalue())
        self.assertEqual(len(payload), 1)
        self.assertEqual(set(payload[0]["packs"]), set(KINDS))
        self.assertEqual(payload[0]["packs"]["put"]["chars"], 551)

    def test_an_effect_table_that_does_not_name_its_delta_is_refused(self):
        # Reading 1 as registered compared four rows whose deltas were three different quantities and one
        # artefact of a run that drove no games. The fix is structural: an effect row must name the
        # comparison it is, and a row without that name is refused rather than correlated.
        import io
        import contextlib

        handle, path = tempfile.mkstemp(suffix=".json")
        os.close(handle)
        Path(path).write_text(
            json.dumps({"banks": [{"bank": str(PUTSCOPE), "delta_pp": 24.45}]}), encoding="utf-8"
        )
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer), self.assertRaises(SystemExit):
                self.run_main(["--effects", path, str(PUTSCOPE)])
        finally:
            Path(path).unlink(missing_ok=True)
        self.assertIn("names the comparison", buffer.getvalue())



class ReadbackTest(unittest.TestCase):
    """The effect table and the per-kind cells: the round's two readings, as executed output."""

    def setUp(self):
        self.temporary = []

    def tearDown(self):
        for path in self.temporary:
            Path(path).unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        handle, path = tempfile.mkstemp(suffix=".json", prefix=name)
        os.close(handle)
        Path(path).write_text(json.dumps(payload), encoding="utf-8")
        self.temporary.append(path)
        return Path(path)

    def row(self, bank, delta, quantity="bank vs no bank, one dispatch"):
        return {
            "bank": str(bank),
            "delta_pp": delta,
            "quantity": quantity,
            "comparison": "a control drawn in the same dispatch",
            "round": "Rn",
            "games": 274,
        }

    def read(self, payload, banks):
        import contextlib
        import io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            score_bank.readback(payload, {name: score_bank.score_bank(path) for name, path in banks.items()})
        return buffer.getvalue().splitlines()

    def test_three_points_in_one_quantity_is_a_correlation_and_says_how_small_it_is(self):
        # Reading 1 as it can actually be computed: three banks measured against a control in their own
        # dispatch. The second line is the part that matters, because three points is a sample in which one
        # inversion moves rho by a whole unit -- so the sign is readable and the magnitude is not.
        lines = self.read(
            {"banks": [self.row(PUTSCOPE, 24.45), self.row(PERKIND, 6.72), self.row(FILLER, 0.0)]},
            {"bank-putscope-2": PUTSCOPE, "bank-perkind-6": PERKIND, "bank-filler-4": FILLER},
        )
        correlation = [line for line in lines if line.strip().startswith("rank correlation")]
        self.assertEqual(len(correlation), 1, lines)
        self.assertIn("+1.000", correlation[0])
        self.assertIn("one inversion moves rho by 1.00", lines[lines.index(correlation[0]) + 1])

    def test_a_quantity_with_one_point_is_reported_rather_than_correlated(self):
        # The placebo row is one experiment, not a population. A correlation needs three, and the honest
        # output names the count instead of computing +-1 over a pair.
        lines = self.read(
            {"banks": [self.row(TURNBUDGET, -0.73, "bank vs its word-permuted placebo, one dispatch")]},
            {"bank-turnbudget-1": TURNBUDGET},
        )
        self.assertTrue(any("not computable -- 1 point" in line for line in lines), lines)

    def test_a_measured_bank_that_was_not_scored_says_so_rather_than_dropping_out(self):
        # A row silently missing from the correlation is a sample size nobody counts. The row prints with
        # its delta and the reason it contributes nothing.
        lines = self.read({"banks": [self.row(PUTSCOPE, 24.45)]}, {"bank-filler-4": FILLER})
        self.assertTrue(any("not scored in this run" in line for line in lines), lines)

    def test_the_per_kind_cells_are_graded_against_the_entry_s_own_vocabulary(self):
        # R177's six cells and the 489-character sentence: three of six, and the three that disagree are the
        # round's finding rather than a defect in the printer. `heat` and `clean` gained 28.2 and 22.4 pp
        # while the entry names neither, because the mechanism it carries (open the container first) is not
        # the vocabulary it uses.
        payload = json.loads((LANE / "measured-effects.json").read_text(encoding="utf-8"))
        lines = self.read(payload, {"bank-putmove-1": BANKS / "bank-putmove-1.json"})
        cells = [line for line in lines if line.strip().startswith(("put", "puttwo", "clean", "heat", "cool", "examine"))]
        self.assertEqual(len(cells), 6, lines)
        self.assertEqual(sum(1 for line in cells if "DISAGREES" in line), 3, cells)
        self.assertTrue(any("reproduces the sign on 3 of 6 kinds" in line for line in lines), lines)

    def test_an_effect_table_with_no_rows_is_refused(self):
        path = self.write("rows", {"banks": []})
        with self.assertRaises(SystemExit):
            score_bank.load_effects(path)

    def test_a_row_with_an_empty_comparison_is_refused(self):
        row = self.row(PUTSCOPE, 1.0)
        row["comparison"] = "  "
        path = self.write("empty-comparison", {"banks": [row]})
        with self.assertRaises(SystemExit):
            score_bank.load_effects(path)

    def test_the_committed_table_loads_and_names_a_quantity_for_every_row(self):
        # The file the round ships. A table that stopped loading is a report that silently stopped being
        # able to check itself.
        payload = score_bank.load_effects(LANE / "measured-effects.json")
        self.assertGreaterEqual(len(payload["banks"]), 3)
        self.assertTrue(all(str(row["quantity"]).strip() for row in payload["banks"]))
        self.assertEqual(len(payload["kinds"]["cells"]), 6)



class EdgeTest(unittest.TestCase):
    """The remaining edges: an empty entry, six points, the verbose table and the script entry point."""

    def setUp(self):
        self.temporary = []

    def tearDown(self):
        for path in self.temporary:
            Path(path).unlink(missing_ok=True)

    def write(self, name: str, payload: dict) -> Path:
        handle, path = tempfile.mkstemp(suffix=".json", prefix=name)
        os.close(handle)
        Path(path).write_text(json.dumps(payload), encoding="utf-8")
        self.temporary.append(path)
        return Path(path)

    def test_an_entry_that_is_whitespace_is_refused_rather_than_scored_as_zero(self):
        # The distinction the whole record keeps: an entry that scores zero was read and says nothing, an
        # entry that is blank was not written. The second one is a broken file and it is refused as one.
        path = self.write("blank", {"entries": [{"text": "   "}]})
        with self.assertRaises(SystemExit):
            score_bank.score_bank(path)

    def test_six_points_do_not_carry_the_small_sample_warning(self):
        # The warning is about a sample that one inversion can reorder. At six points it stops being printed,
        # which is the only thing separating a sign from a magnitude in this file's vocabulary.
        banks, rows = {}, []
        for index in range(6):
            path = self.write(f"six-{index}", {"entries": [{"text": '"put" ' * (index + 1) + "if it fails"}]})
            banks[path.stem] = path
            rows.append(
                {
                    "bank": str(path),
                    "delta_pp": float(index),
                    "quantity": "bank vs no bank, one dispatch",
                    "comparison": "a control drawn in the same dispatch",
                    "round": "Rn",
                    "games": 274,
                }
            )
        import contextlib
        import io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            score_bank.readback({"banks": rows}, {name: score_bank.score_bank(path) for name, path in banks.items()})
        printed = buffer.getvalue().splitlines()
        self.assertTrue(any("rho = " in line for line in printed), printed)
        self.assertFalse(any("one inversion" in line for line in printed), printed)

    def test_the_verbose_table_prints_one_line_per_entry(self):
        import contextlib
        import io

        buffer = io.StringIO()
        original = sys.argv
        sys.argv = ["score_bank.py", "--verbose", str(TURNBUDGET)]
        try:
            with contextlib.redirect_stdout(buffer):
                self.assertEqual(score_bank.main(), 0)
        finally:
            sys.argv = original
        printed = buffer.getvalue().splitlines()
        self.assertEqual(len([line for line in printed if line.startswith("  entry ")]), 3, printed)
        self.assertTrue(any("tags none" in line for line in printed), printed)

    def test_the_script_runs_under_main_with_the_lane_already_importable(self):
        # The `if str(LANE) not in sys.path` branch, and the entry point under it. Both are one line and both
        # are the kind of line that only ever fails in a job: this runs the file the way the workflow does.
        import contextlib
        import io
        import runpy

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
            with self.assertRaises(SystemExit) as caught:
                runpy.run_path(str(HERE / "score_bank.py"), run_name="__main__")
        self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
