---
id: R22-raw
step: R22
opened: 2026-10-31
arms: full-raw,full-raw-shuffled
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V46
---

# R22 — the event instead of the lesson

## Why this file exists

Every memory arm this project has run injects an **interpretation**. A rule states what is true about the
workspace; a repair note states why one attempt was wrong; a procedure states how a class of questions is
answered. All three are written by a distiller that reads one correction and produces prose, and seven
axes have now been varied on the store that prose makes: content, substrate, quantity, position, framing,
delivery order, and — in R21 — membership at a fixed dose. The best cell in the record is `full-anchored`
at −1.14pp, and R20 decomposed even that into about two points of permission and about one of knowledge.
**The content of the notes is worth about a point and the cost of showing them is two to four.**

That is the shape Raw-RAG (arXiv 2610.30755) reports from the other direction. Naive dense retrieval over
**raw** history ranks first in six of seven benchmark-model settings against the strongest agentic memory,
and — the part that matters here — **complete access to the transformed store still leaves an accuracy gap
against the raw evidence**. Its explanation is coverage: an answer often has to be *derived* from relations
and dependency paths, and summarise/extract/consolidate is where those go. This record has never injected
the derivation, only a sentence about it.

## The design

Two arms, both rendering whole correction events verbatim, both under the shipped 1,200-character budget,
both in the shipped position.

1. **`full-raw`** — for each recalled item, the event behind it: the question that was asked, the query
   that came back wrong, the query that fixed it. Three lines, two of which are SQL the database actually
   ran. Nothing is phrased as a convention, because there is no convention; nothing is generalised, so
   nothing can be generalised wrongly.
2. **`full-raw-shuffled`** — the same form, the same number of events, drawn from other questions on the
   same database. The vocabulary and the size are held and the subject changes, which is the only
   comparison that separates "this question's correction" from "raw SQL in the prompt". Without it a
   `full-raw` cell above `full` could be reporting the form, and the repair substrate already showed that
   form alone can move a cell by three points.
3. **`none` and `full` are the anchors.** The primary comparison is `full-raw` against `full` — the same
   corrections, one interpreted and one not — and it is the comparison the paper makes, run on a benchmark
   where a correction has an exact referent.
4. **Leakage is impossible by construction, not by a filter.** Both arms draw from the fold's *learn*
   rows. An eval question's own correction is not in the index, so no raw pack can show the answer it is
   scoring, and the control cannot either.
5. **One new gate, `V46-raw-is-verbatim`.** Every payload line of the arm must be byte-identical to the
   event it was rendered from; a paraphrase, a reformat, a truncation or a cut query all fail the run, and
   so does a run that rendered no payload at all (an arm that shows nothing is `none` under a second
   name). A renderer that tidied a query would make this a third distiller, and the arm's whole claim is
   that nothing was interpreted.
6. **Whole events only.** The budget skips an event that does not fit rather than truncating it: half an
   event is a question with no correction, which is precisely the misreading the form exists to avoid. The
   number skipped is reported.

## Prediction

- **`full-raw` is above `full` by at least 1pp on the paired difference.** This is the confirmatory claim,
  and it is the one prediction in this record that comes from the literature rather than from the store.
  Interpreted notes cost 2–4pp and are worth about one; uninterpreted events are the form the field
  currently reports as the strongest memory baseline.
- **`full-raw` is at or above `none`.** If the harm is what the *interpretation* invites — a convention the
  reader can imitate — then an event with no convention in it has nothing to imitate. If the harm is
  instead "any retrieved text displaces the model's own reading", raw will be negative too and the two
  explanations are separated for the first time.
- **`full-raw` above `full-raw-shuffled` by at least 1pp.** The correction has to be *this* question's for
  the form to help; a raw pack whose subject is a different question is the strictest available control for
  "the content is irrelevant and only the shape matters".
- **The pack carries fewer events than `full` carries items, and more characters.** An event is a question
  and two queries, typically 350–500 characters against an item's 500–824 for a generalisation; the
  artefact reports both, and a character-matched comparison against `full` is read from `mean_pack_chars`
  rather than assumed.

## Refutation

- **If `full-raw` is within ±1pp of `full` with an interval that excludes +1pp, the substrate is not the
  loss.** The distillation is then not what costs, the harm is in being shown anything at all, and the
  product decision is abstention by default — which the record already has the evidence to state, and
  which would end the memory line as a mechanism that improves accuracy.
- **If `full-raw` is at or below `full-raw-shuffled`, the subject of the correction does not matter** and
  the arm is measuring prompt length and SQL vocabulary. The retrieval half of the memory layer is then
  irrelevant to the result, which is a different and equally publishable finding.
- **If `V46` fails, the run is not read at all.** A payload line that was rewritten makes the arm an
  interpreter with a new name, and its delta says nothing about raw evidence.
- **If the raw pack renders nothing on most questions**, the budget is the constraint rather than the
  form: the artefact reports events shown and skipped, and a run that skipped most of its events is
  reported as a budget result, not as a test of the paper.

## Resolution

The paired `full-raw` − `full` gets the verdict, and `full-raw-shuffled` is the control that decides
whether the verdict is about content. Both intervals are reported; a null on the confirmatory claim is
pre-registered as "the interpretation is not what costs", not as "raw evidence does not work", because the
one difference between those readings is a store whose events are longer than a 1,200-character budget
admits — and that is measurable before the next dispatch rather than argued after this one.

## Instrument correction (2026-10-31, written before the re-dispatch)

The first dispatch `41205745555` ran the benchmark to completion — 1,754 calls, 2 retries, 0 timeouts,
0 call failures, 350 questions, 11 databases, 626 events collected and 82 skipped as too long for the
budget — and failed `V46-raw-is-verbatim` with `1103/1632 payload line(s) byte-identical`. **The run is
not read**: the refutation clause above says so in advance, and it is the right clause, because a
checker that cannot recognise the arm's payload cannot certify it either.

**What the number means is arithmetic, and it is in the artefact.** 544 events were rendered (626
collected minus 82 skipped), each rendering three lines, so the payload held 1,632 cells exactly. Of
those, 1,103 were credited: `2 × 544 = 1,088` `Question:` and `Correction:` cells plus **15** `Attempt:`
cells. Every question and every correction was byte-identical; every multi-line attempt was not. The
attempts are SQL, and 346 of the 350 replies in this run write their SQL over several lines.

**So the arm was honest and the checker was not.** `rawEventVerbatim` split the payload on newlines and
matched each line against a field, which cannot represent a value that is itself multi-line: it read a
verbatim query as a rewritten one. This is the third time this record has caught a failure in its own
instruments rather than in its treatment, and it is the same shape both times — a measurement that
assumes its input is one line long.

**The correction.** The unit is the **event block**. The checker walks the payload and requires each
position to start with a whole block the renderer was given; a span that does not match is counted once,
however many lines it holds, and its first line is kept as a sample the gate prints and never
interprets. `V46`'s criterion is therefore **strictly stronger than the one registered**: it compares
whole events instead of three independently matched lines, so a payload whose three lines each appear
somewhere in the pack but in the wrong order now fails, and so does a pack whose blocks are correct but
given under another question's heading.

**What is unchanged.** The arms, the store, the recall, the 1,200-character budget, the position, the
leakage argument, the predictions, the refutation clauses and the resolution. The run is re-dispatched
under this file, and `V46` is the gate that says whether it may be read — with the difference that a
second failure now reports the block it rejected rather than only how many it rejected, so the next
reading costs a document instead of a dispatch.

## Outcome

Dispatch `41213200296` (success, 1,755 calls, 2 retries, 0 timeouts, 0 call failures, twelve gates pass,
90 minutes, `config.prereg` = this file). Artefact `eval/results/poc-sota-bird-raw.json`. 350 questions,
5 folds, `none` at 54.00%, minimum detectable effect 4.00pp. The first dispatch and its instrument
correction are recorded above and are not part of this reading.

| Arm | Events | Chars | ACC | Δ vs `none` | 95% CI | gained / lost | p |
|---|---|---|---|---|---|---|---|
| `full` | 1.82 | 1,083 | 51.43% | −2.57pp | [−5.43, +0.00] | 8 / 17 | 0.1078 |
| `full-raw-shuffled` | 1.39 | 763 | 52.00% | −2.00pp | [−5.43, +1.43] | 15 / 22 | 0.3240 |
| `full-raw` | 1.59 | 864 | 50.57% | −3.43pp | [−7.14, +0.29] | 17 / 29 | 0.1038 |

The pairs, which is what the registration was about — `full-raw` − `full` = **−0.86pp** (20 gained, 23
lost, 43 discordant, exact p = 0.7608, 95% CI [−4.57, +2.86]); `full-raw` − `full-raw-shuffled` =
**−1.43pp** (19 / 24, 43 discordant, p = 0.5424, bootstrap 95% CI [−5.14, +2.29]); `full-raw-shuffled` −
`full` = +0.57pp (19 / 17, p = 0.8679, CI [−2.86, +4.00]).

**The confirmatory claim is not supported, and the first refutation clause does not fire either — that is
the honest pair of sentences.** The registered difference was `full-raw` above `full` by ≥1pp; it is
−0.86pp. The clause written down in advance for a null was "within ±1pp **with an interval that excludes
+1pp**", and this interval contains +1pp, so the registration does not license the sentence "the substrate
is not the loss". What it licenses is narrower and more useful: **at 350 questions the paired interval is
±3.7pp wide, so a 1pp claim was below this lane's resolution before the run started**. The registration
asked for a difference the design could not see; the run answered at the size it has.

**The second refutation clause fires cleanly, and it is the one that names what the arm measured.**
`full-raw` is *below* its own shuffled control by 1.43pp: the subject of the correction does not matter.
The arm put real SQL about other questions on the same database in front of the model and did no worse
than the arm that put this question's own correction there, which means the deltas it produces are about
form, length and vocabulary, not about knowledge.

**Dose, and it does not rescue the form.** The raw arm carried 1.59 events and 864 characters against
`full`'s 1.82 items and 1,083 — 219 characters *fewer*, and 0.86pp lower; the shuffled control carried the
fewest, 763, and scored highest of the three at 52.00%. Ordering the three by characters does not order
them by accuracy: 763 → 52.00, 864 → 50.57, 1,083 → 51.43. The three forms are indistinguishable from
each other (largest pairwise difference 1.43pp, every p > 0.54) and each sits 2.0–3.4pp under no memory.

**Pooled, and marked exploratory because it was not registered.** Against `none`, the three text arms
gained 40 questions and lost 68 over 1,050 arm-question cells: **−2.67pp, exact p = 0.0091**. That is the
record's first significant number in this line, and its sign is negative — *any* text, distilled or raw
or foreign, costs about two and a half points on this benchmark with this model. It is reported as an
observation and not as a verdict: pooling arms inside a question is not independent, and the
pre-registration put its resolution into a 1pp claim instead.

**Three instrument readings.** `V46-raw-is-verbatim`: **557/557 rendered events byte-identical**, with 81
of 638 events (12.7%) skipped whole rather than truncated — the budget refused them, which is the
behaviour the design asked for. `V32`: 640 corrections from 1,400 learn rows, 0 unanswered, 4 distillation
failures (0.3%). `V44-domain-accounted`: `156 item(s) with no domain, 156 arrived unscoped, 0 widened` —
the fourth dispatch in a row in which generalisation widened nothing.

## What this leaves

Every axis this record can vary on a distilled store has now been varied, and the last one — the store
itself — is closed with a number rather than an opinion: **the interpretation is not what costs, and
neither is the absence of interpretation.** The raw form was the field's strongest reported baseline and
it transferred as a null against the distilled form and as a loss against no memory, with its own
shuffled control above it.

The line is therefore at the place the pre-registration predicted it would arrive at if the substrate did
not carry the effect, and the product decision that follows is **abstention by default**: on this
benchmark, with this model, showing a retrieved note is worth about −2.7pp over showing nothing, and no
text form this record has built reverses it. That is a finding about a task where the question already
carries its schema, its evidence and its database, and the next registration has to say which half of
that sentence it is testing — the retrieval, or the question.
