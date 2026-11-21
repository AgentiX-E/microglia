# R162 — the shape of a memory, not its presence

**Registered** 2026-11-20, before any arm on this corpus has been driven.

**Why this registration is not in `prereg/`.** That directory is the dispatch schema: `gates` must be a
`V`-code, `split` must be one of `minidev`/`dev`/`train`, and `sample` is checked against what a dispatch
draws. None of the three describes an ALFWorld arm, and writing a `V`-code that nothing will grade would be
a registration that lies in its own header — which is the failure `prereg-pack.test.ts` exists to catch, and
it caught this file's first version. The file therefore lives beside the driver it registers, and the
schema gap is recorded in `AUDIT.md` 34.210 rather than papered over.

# R162 — the shape of a memory, not its presence

**Registered** 2026-11-20, before any arm on this corpus has been driven, and before the floor finish
line was known. This is the first registration in this record whose treatment is a *form* rather than a
*dose*.

## What twelve rounds on text-to-SQL established, and what they could not

R159 found that the harm a pack does is **prescription** rather than contradiction: a lesson that tells
the reader how to build an answer is wrong on any question it was not written for, and it stays wrong
without ever being false. R160 then asked whether anything in the corpus predicts which questions a
lesson is right for, and answered no — the band that reads best on dev reads worst on train, and every
band on the corpus that can see is negative or inside noise.

Both readings are about a pack that is **injected**: selected per question, written into the prompt of
that question, and absent from every other. The strongest published system in this line does not do
that. ExpeL's memory is a numbered list capped at twenty, rendered **whole into every prompt**, and its
retrieval runs over *trajectories*, not rules (`fewshot_strategy: task_similarity`, `retriever_type: knn`
in `configs/agent/expel.yaml@LeapLabTHU/ExpeL`). A rule that is always present cannot be present for the
wrong question — the failure R159 measured is structurally unavailable to it.

So the question this record has been asking is not the only question. **The axis is form**: a short
always-present list against a long selectively-injected pack. `rule-bank.ts` ports the competitor's
maintenance arithmetic so the always-in arm is the competitor's mechanism rather than an impression of
it, including the four places that arithmetic leaks (one-directional substring identity, a substring
banned-word filter, a cap nothing enforces, and a reply that is not deduplicated against itself).

## The three arms

| arm | what it carries | what it is a control for |
| --- | --- | --- |
| `none` | the task and the transcript | the corpus's own difficulty at this model |
| `always-in` | the same, plus up to 20 rules rendered whole on every turn | the competitor's mechanism |
| `retrieved` | the same, plus the entries a lexical anchor admits, per turn | this record's mechanism, on the same corpus |

All three run the same 134 held-out games, the same prompt skeleton, the same model, the same step cap,
and the same decoding. The only difference between arms is what the prompt carries above the transcript.

### The arm exists, and it is asserted before it is paid for

`eval/drivers/alfworld/agent.py` is that loop. Its skeleton is the competitor's, transliterated from the same
file the examples come from: the system line, `{instruction}You may take maximum of {max_steps} steps.` followed
by `Here are two examples:`, the two transcripts split into alternating turns, and the parser's four branches. A
pack — when the arm has one — is rendered once and placed **above** the examples, so that the whole prefix is
stable for the episode and the provider's cache can hold it. That placement is a decision, not a layout: a pack
re-anchored per turn moves the prefix and makes every turn a miss, which is the 3.7× the τ² lane already paid.

Three readings are asserted at zero cost before any call is dispatched.

1. **The loop reproduces the floor.** `--policy seed` picks uniformly among the commands the environment
   publishes, using `floor.Draw`; `--policy first` takes the first. Both drive the environment through
   `run_episode`, the function the model arms use, so agreement is a statement about the loop rather than about
   a policy: same games, same wins, same step counts, same action digests, same observation fingerprints. The
   `agreement` job in `alfworld.yml` runs `floor.py` over eight games and then `agent.py --policy seed` over the
   same eight with `--assert-floor`, and fails on a single field. Eight, not 134: a loop does not become more
   correct with ninety more games, and `floor.py` already drives the whole split in its own job.
2. **The decisions are covered.** `test_agent.py` carries 81 cases over the transcript split, the parser, the
   shard arithmetic, the bill, and the loop itself against a fake world that has state. Statement coverage of
   `agent.py` is 99%, and the one uncovered line is the `sys.exit(main())` every script ends with.
3. **The arms differ in one block.** A test asserts that the opening of `none` and of `always-in` is identical
   except at index 1, where the pack sits. Without it, "the only difference is the memory" is a sentence.

**Run `44670148442`, job `136068894878`, 03:48:07 to 03:51:14 UTC — eight games, both readings, zero calls.**

| reading | value |
| --- | --- |
| games | 8 of 8, five sites each |
| floor agreement | **8 games, 0 mismatches** on win, steps, action digest and observation fingerprint |
| floor wins in those eight | 0, same as the walker |
| opening size | **4,108.5 characters**, measured per episode |
| model calls | **0**, by construction |

That 4,108.5 is a different quantity from the 3,965 above and the difference is worth stating once: 3,965 counts
the two example transcripts, and 4,108.5 counts the whole opening — system line, instructional paragraph, the
`You may take maximum of 50 steps.` clause and `Here are two examples:` — which is what the model actually
receives before the first observation. Two numbers for one prefix is how a price gets computed twice and disagrees
with itself; when the calibration reports `prefix_chars` per episode, that field is this larger quantity.

What none of that certifies: whether the model follows the format at all. A reply with no action parses as a
thought, and `invalid_actions` counts what the environment refused. Those counters are the first thing to read in
the calibration's output, because a high invalid rate means the arm measured the prompt's syntax rather than its
content.

### The first dispatch, and what it corrected before it spent anything

Run `44671462382`, 04:00:36 to 04:03:24 UTC. It drove **zero games** and failed on the first one, and the failure
is worth recording because it was a defect in this design rather than in the code it ran.

On `pick_cool_then_place_in_recep-Bread-None-CounterTop-10` the model reached the end of its patience inside the
50-step cap and began narrating: *"I was unable to complete the task. I found bread 1 on countertop 3, picked it up,
and cooled it using the fridge. However, when I attempted to put it on the cou…"*. The parser read that as a
thought — correctly, it is not a command — and the loop, which had been written to raise when three thoughts
arrived in a row, raised.

**That rule was wrong in the direction that matters.** A model giving up is a failure this arm exists to record; an
arm whose question is *how often does the memory help* cannot have a skeleton that refuses to represent the model
failing. The repair is not a tolerance, it is a change of what a turn is: **a thought now spends one of the
`max_steps` turns exactly as an action does**, so an episode ends when its budget does rather than when a model
stops emitting commands. `steps` therefore counts model turns, `actions` and `thoughts` sit beside it, a run of
three thoughts is a counted `stall` rather than a crash, and a pass in which **no** episode produced an action still
fails — because that is a skeleton nobody read, not a low score.

Two things follow for the price, and both are corrections in the conservative direction. The worst case per episode
is now `max_steps` calls rather than `max_steps` actions plus an unbounded number of thoughts, so the quote stops
having a tail it could not bound. And the first reading of a calibration is no longer the score: it is the three
replies printed by `--trace`, because a rate computed over a format the model ignored is a rate about the format.

## Three predictions, and what refutes each

1. **`always-in` beats `none`.** Refuted if the paired interval for `always-in − none` contains zero. A
   null here would say this corpus is not the object either, and the direction of the whole programme
   changes rather than its parameters.
2. **`always-in` beats `retrieved`.** Refuted if that interval contains zero *or* is too wide to have
   excluded a 5-point effect. This is the prediction that carries the record's actual claim: that the
   harm was in the *form*, not in the idea of reuse.
3. **`retrieved` is not worse than `none` by more than the dev band.** Refuted if it is, which would
   reproduce R159's prescription reading on a second corpus and make it a property of packs rather than
   of text-to-SQL.

## What 134 games can and cannot settle, in arithmetic

Paired design, two-sided 5%, 80% power: `mde = 2.802·√(b+c)/n`, where `b+c` is the number of games the
two arms disagree on. At the discordance two arms of this shape usually show (30%), the split's own size
buys:

| games | MDE at 30% discordance | what it settles |
| --- | --- | --- |
| **134** | **13.3pp** | `always-in − none`, if the effect is the 19pp the literature reports |
| 268 | 9.4pp | the same, with room for a weaker effect |
| 536 | 6.6pp | `always-in − retrieved`, if the form difference is 7pp or more |
| 942 | 5.0pp | `always-in − retrieved` at a 5pp effect |
| 2,617 | 3.0pp | the same at 3pp, which is where a two-arm difference stops being worth a dispatch |

**Read the first row honestly: the split can see prediction 1 and cannot see prediction 2.** 134 games
resolve 13.3 points; a form difference worth 5 points needs 942 episodes, which is seven passes of a
split that has 134 games in it. Prediction 2 is therefore registered as *unresolvable at one pass*, and
the only ways to resolve it are stated below rather than assumed away.

### The two ways to buy power, and what each costs in validity

- **Repeat the split.** `R` passes over 134 games gives `134R` observations, but they are not
  independent: two passes of the same game share the game. The effective sample sits between 134 and
  `134R` and the honest interval is a **cluster bootstrap over games**, never a binomial over episodes.
  At `R = 4` the naive reading is 6.6pp and the clustered one is worse; the amount by which it is worse
  is measured, not assumed, because `rule-bank`'s votes are deterministic but the model's decoding is
  not.
- **Pool a second split.** `valid_seen` has 140 games, but ExpeL trains on it, so it is not held out for
  a comparison against ExpeL — only for an internal one. Using it would make arms comparable to each
  other and not to any published number, which is a trade this registration does not take silently.

## The gate before any money is spent: both readings are now in hand

Nothing here runs until two zero-cost readings are in hand, and both are assertions rather than estimates.

**1. The floor pass is green — run `44644387139`, job `135983146374`, 00:15:33 to 00:47:05 UTC.**

| reading | value | what it settles |
| --- | --- | --- |
| games covered | **134 of 134**, no duplicate | the split is the split |
| episodes terminated | **134 of 134** at the environment's own 50-step cap | no walk was cut off by the driver |
| floor | **0 wins, Wilson 95% [0.0%, 2.8%]** | the task family is not navigable by accident, so the headroom above chance is the whole board |
| replay | **134 of 134 identical**, 0 mismatches on gamefile, win, steps, action digest, observation fingerprint | the paired power arithmetic applies |
| commands at reset | 25.05 on average | the action space is closed and small, which is what makes a scored candidate set possible |
| transcript | **mean 5,367 chars, median 5,217, p90 6,846, max 8,405** | the cost model's only measured input |
| environment time | 852 s for the first pass, 884 s for the second, 6,360 / 6,596 ms per game | two passes of the split cost 29 minutes of runner time and no calls |

The floor being **exactly zero** is the important row and it is the one that cannot be inferred from the
literature. A random walker that scored even five percent would have meant part of the split is reachable
without understanding it, which would have compressed the headroom the treatment is measured against.

**2. The price is measured, not modelled, and the last assumption in it was checked too.** The transcript is
5,367 characters for a 50-turn episode (measured, above). The fixed prefix was the one remaining guess, so it was
read out of the competitor's own prompt file — `prompts/alfworld.py@LeapLabTHU/ExpeL`, which carries two complete
ReAct trajectories per task type, selected by task type:

| task type | the two examples, in characters |
| --- | --- |
| `pick_and_place` | 3,199 |
| `look_at_object` (the `examine` prefix) | 3,738 |
| `pick_clean_then_place` | 4,328 |
| `pick_heat_then_place` | 3,837 |
| `pick_cool_then_place` | 4,403 |
| `pick_two_obj_and_place` | 4,286 |
| **mean over the six** | **3,965** |

**Four of the six rows above were wrong, and the file they are counted from is now in this repository.** The
first version of this table counted the wrong pair of keys for four task types: the competitor's file carries
three transcripts per type (`react_<kind>_0..2`) and its own template says *"Here are two examples"*, so the
pair is `_0` and `_1` — that much was right — but the counts had drifted from the strings they claim to
describe. Only `pick_and_place` and `pick_two_obj_and_place` matched. The corrected mean is **3,965**, which is
**11% above** the 3,574 this file quoted, and the two arm prices below move with it by about the same factor.

The transcripts are now committed as `eval/drivers/alfworld/prompts/alfworld-examples.json` with the blob they
came from (`2b2093ef`) beside them, and `test_agent.py` pins all six counts. A prompt read at `main` is a prompt
that changes under a quote; a count typed by hand is a count that has already drifted once.

With a prefix and DeepSeek's published rate card (`eval/manifests/model-rates.json`, off-peak, USD per million
tokens), one episode costs about:

| layout | input tokens | bill per episode | 134 games × 3 arms |
| --- | --- | --- | --- |
| no prompt cache | 82,717 in, 750 out | $0.01286 = **¥0.091** | ¥36.7 |
| prefix held by the cache | 2,385 miss + 80,331 hit | $0.00105 = **¥0.0074** | **¥2.99** |

**Those two rows were computed at 3,574 characters and are therefore about 11% low in the prefix's share.** They
are left as they were computed rather than quietly rescaled: the same 11% applied to a `chars/token` ratio nobody
measured is a third guess stacked on the two that produced these numbers. What replaces them is not a better
estimate but a measurement — `agent.py` reports `usage` and `prefix_chars` per episode from the provider's own
response, so the 20-game calibration below settles both rows and the per-arm cache-hit rate with it. Until then
the honest reading is: the uncached layout is a few tens of yuan, the cached one is a few, and the ratio between
them is the thing a design decision should be made on.

The twelve-fold difference is not an optimisation detail; it is the difference between a ¥37 experiment and
a ¥3 one, and it is decided by a property of the arm rather than of the provider: a turn-based transcript
that is *appended to* keeps a stable prefix and hits, while a pack re-injected per turn moves the prefix and
misses. This record has paid for that lesson once already on τ², where the memory arm was billed 3.7× the
control's uncached tokens on the same sixteen calls.

**So the calibration dispatch is 20 games, one arm**, and its purpose is not the unit price — that is now
arithmetic over a measured distribution. Its purpose is the **headroom**: 134 games resolve 13.3pp, so an
`always-in` effect is measurable only if the `none` arm lands far enough above the floor to leave 13.3pp of room.
ExpeL reports its control at 40.0 with a different model; this project had never run any arm on this corpus with
this model. If `none` lands near 8%, prediction 1 is unmeasurable at one pass and the answer is a stronger
backbone, not a bigger sample.

### The answer: 11 of 20, and the price measured rather than extrapolated

Run `44673057091`, job `136078308716`, 04:26:34 to 04:39:15 UTC. Arm `none`, model `deepseek-flash`, 50-step cap,
`--trace 3`.

| reading | value | what it settles |
| --- | --- | --- |
| wins | **11 of 20 = 55.0%**, Wilson 95% **[34.2%, 74.2%]** | headroom is **55pp above the floor**, so 13.3pp of it exists: prediction 1 is measurable at one pass |
| calls | 728 over 20 episodes = **36.4 turns per game** | the per-episode call count, measured rather than assumed |
| thoughts | 257 = 35.3% of turns | a third of the bill is deliberation, not action |
| invalid actions | **149 = 20.5% of calls** | the model names objects that are not in the room; see `AUDIT` 34.220 |
| off-space actions | 11 = 1.5% | 138 of the 149 refusals were well-formed commands for the wrong world |
| cache hit rate | **90.43%** of 1,800,595 prompt tokens | the prefix is held, and the miss is 172,312 tokens |
| tokens | 1,800,595 in / 15,553 out | measured, per 20 games |
| bill | **$0.040063 = ¥0.28** at off-peak | against **$0.2794 = ¥1.98** for the same tokens uncached: **7.0×** |
| wall clock | 846 s = 42 s per game | 134 games on one runner is **94 minutes**; four slices is about 24 |
| budget exhausted | 9 of 20 | half the split reaches the 50-turn cap, which is what makes 50 the right cap |

**Three things follow, and the first one changes the design's premise.** The `none` arm at 55.0% is **15 points
above the 40.0 ExpeL reports for its own control**, on a different model. The literature's 19pp was measured from a
lower baseline, so the same intervention here has less room above it; the registered prediction stays as written —
it is a prediction, and this is the reading it will be judged against — but the round that reads the first arm
should expect a smaller delta than the paper's, and that expectation is now on the record before the money is spent.

Second, **the price is ¥5.71 for three arms over 134 games**, not the ¥2.99 this file estimated: the prefix is
4,062 characters rather than 3,574, the cache hit rate is 90% rather than the assumed 96%, and the extrapolation is
from 728 measured calls rather than from a token model. Both numbers are the same order, and the measured one is the
number that will be quoted.

Third, **a fifth of the model's actions are refused by the environment.** That is not a defect in the arm — it is
the arm's measurement, and it is what a memory that carries *where objects live* would be for. It is registered as a
separate arm (`AUDIT` 34.220) rather than repaired by handing the model the admissible list, because handing it the
list is a different mechanism and would make `none` no longer the corpus's own difficulty.

## What would make this registration void

- The floor pass failing to cover or to replay, which would mean the 134 is not 134. **Satisfied as of run
  `44644387139`: 134 of 134 covered, 134 of 134 replayed identically.**
- The `always-in` arm not actually rendering whole: a rule list that is truncated by the prompt budget
  rather than by its own cap is a fourth arm nobody registered, and it must be counted and reported.
- A model whose cache-hit rate on the fixed prefix is near zero, which would make the arms differ in
  cost by more than they differ in content — the per-arm bill is reported beside the per-arm rate for
  exactly this reason.
- A `none` arm landing so close to the floor that 13.3pp of headroom does not exist. That is not a defect
  in the design; it is the design telling the truth about which model this question needs.

## R164 — the arm is rendered in the competitor's voice, and the bank is built by a ported extractor

**Registered 2026-11-20, before the rule bank exists and before any arm has carried one.** Two changes and no
measurement: the `always-in` arm's block was rendered in this repository's words rather than the paper's, and the
bank it carries now has a producer.

### The block was ours, and the arm is offered as theirs

The pack's header was `Rules from earlier attempts:` — a sentence this project wrote. The competitor's is
`RULE_TEMPLATE['alfworld']` in `prompts/templates/human.py@LeapLabTHU/ExpeL`:

> The following are some experience you gather on a similar task of completing a household task by interacting in a
> household environment. Use these as references to help you perform this task:

Two differences followed from that, and both are now the competitor's:

| what | before | now |
| --- | --- | --- |
| the header | this project's sentence | the competitor's, verbatim, grammar included |
| the position | above the instruction and the examples | prepended to the first observation — after the examples, immediately before the game's text |

The position is where `insert_before_task_prompt` puts it: the rule message is appended **after** the few-shot block
and **before** the task line. This skeleton carries the task line at the top of the first human turn, so the block
lands between the examples and the room description, which is the same relative place.

**It cost nothing and it invalidated nothing.** `none` carries no pack, so its prompt is byte-identical to the one the
20-game calibration measured, and a test now asserts exactly that (`test_the_control_arm_carries_no_pack_whatsoever`):
the first observation the control sends is the environment's string and nothing else. The two treatment arms have
never been run, so moving their block cannot invalidate a reading that does not exist.

### What is still not the competitor's, and why it stays

| difference | effect on this lane | effect on a published comparison |
| --- | --- | --- |
| the two example transcripts are split into alternating turns; the competitor sends them as one human block | none: identical in all three arms | the prompt is a different rendering of the same examples |
| the task line sits at the top of the first human turn; the competitor writes `Now it's your turn!` after the rules | none: identical in all three arms | same |
| `max_steps` counts model turns here, environment steps there (at 20) | 50 turns at the measured 35.3% thought rate is about 32 actions, against the competitor's 20 | the caps are of comparable size but not the same size |

Every row in that table is a reason a **paired** delta remains the claim and an **absolute** number against a
published row does not. They are repaired by rebuilding the skeleton, not by a paragraph, and rebuilding it after
the control was measured would mean re-measuring the control to say anything — so the limitation is registered
rather than quietly closed.

### The bank: who writes it, and with what

`distill.py` builds it, in the competitor's chain: chunk the won trajectories by `success_critique_num` (8), call the
`all_success_existing_rules` critique once per chunk, feed the list back in so later chunks can agree with or edit
earlier rules, and apply the vote arithmetic. The arithmetic is `rule-bank.ts`'s, in Python, because this lane runs
where `textworld` is installed and `node` is not guaranteed. **The two ports are checked against one file**,
`rule-op-vectors.json`, read by `test_distill.py` and by `rule-bank-vectors.test.ts`: a drift is a red build on both
sides rather than a bank that differs from what the TypeScript package says it would build.

**The path the competitor uses that this lane cannot.** ExpeL's first criticism compares a successful trial against
*failed trials of the same task*. That needs repeated attempts per task and both splits give one (AM.24), so this
bank is the competitor's extraction **minus its contrast** — the `compare_existing_rules` half is absent, and the
report says so where the score is reported.

### What this round registers as a prediction, if the bank arrives

Unchanged from R162: `always-in − none` is the registered contrast. What is added is the arithmetic of the bank
itself, which is reported before the score is read:

| reading | why it is read first |
| --- | --- |
| rules in the bank, and rules rendered within the cap | a bank of 4 rules and a bank of 20 are different treatments with the same name |
| operations applied / rejected / culled | a bank built almost entirely from `ADD`s is a list nobody edited, which is a weaker treatment than the competitor's |
| peak size, and whether it passed `cap + 5` | the cap is soft in the competitor; a bank that drifted is a fourth arm |

**Cost, before it is spent.** The training pass is 140 `valid_seen` games at the measured ¥0.014 each = **¥1.96**;
the critique calls are ten at ~12k input tokens each, about **¥0.10**; so the bank is **≈ ¥2.1**. The three arms over
134 held-out games are **¥5.71** measured. **Total ≈ ¥7.8.**

### What would make this registration void

- A bank distilled from the held-out split. `--split eval_in_distribution` is named in the workflow rather than
  defaulted, because a leak here would look exactly like a result.
- A bank that the arm cannot read, or reads truncated without saying so: the arm reports `pack_entries` and
  `rules_in_bank` separately for that reason.
- A training pass whose transcripts are missing: `distill.py` refuses rather than distilling from whatever is left.

## R165 — Two predictions from the 2026 literature, registered before the first delta exists

The three-arm chain (run `44685314225`) will produce `always-in − none` and `retrieved − none` at 134 games. Before
that number exists, two published results make predictions about *where* the delta should and should not appear,
and both are computed by `aggregate.py` from the same artefacts at no extra cost. Registering them now is the only
way they can be checks rather than narratives: after a delta arrives, every stratification is a story that fits.

| source | the claim | the prediction registered here | what refutes it |
| --- | --- | --- | --- |
| **`arXiv:2604.27003`**, *When Continual Learning Moves to Memory* (2026-05) | negative transfer from reused experience concentrates on **the cases the agent cannot solve unaided**; cases it already handles are comparatively robust | `strata.hard.delta > strata.easy.delta`, and any harm shows up in `hard` first. The hard stratum is defined by the **control's** verdict, because "hard" has to mean hard for this skeleton | a harm share concentrated in `easy` (games `none` won and the bank lost), or `hard.delta ≤ easy.delta` |
| **`arXiv:2610.07311`**, *Understanding and Mitigating Inference-Time Overreliance* (2026-10) | harm is largest at **intermediate** query-memory overlap: memory helps when the experience transfers and hurts when only part of it does | `retrieved − none` is expected to be *larger* than `always-in − none` if the lexical anchor is selecting on partial overlap well, and *smaller* if the anchor is admitting near-misses. The test is `divergence_rate`: a `retrieved` arm that diverges on few games is selecting what `none` would have done anyway | a `retrieved` arm with the same divergence as `always-in` and the same delta — then the anchor is not selecting, and the arm is `always-in` with extra steps (the defect 34.219 already found once) |

**The quantity both are read against is `harm_share`**, defined exactly as `COMPETITIVE.md` Appendix AS defines it
for the τ² lane — of the uses that changed anything, the share that made the outcome worse — with the episode as the
unit here and the served item as the unit there. It is the only column this record has ever been able to compare
across lanes, and this is the second lane that can report it.

**One further control is registered as a decision, not as a dispatch.** `arXiv:2601.22436` (*Are Not Always Faithful
Self-Evolvers*, 2026-01) finds that agents respond to the **existence and shape** of a condensed-memory block more
than to its semantic content: corrupting or replacing a summary often leaves the score where it was, while removing
a raw trajectory collapses it. If that is what is happening here, `always-in − none` will be positive and a
**placebo** arm — the same header, the same entry count, each rule's words permuted within itself so that the
surface form is preserved and the meaning is not — would earn the same delta.

The placebo is therefore **not dispatched this round**: its price is ≈ ¥1.9 and it only answers a question that
exists once the primary delta is non-zero. The rule, written before the number: dispatch it if
`|always-in − none| > mde`, because below that there is no effect for a sham to imitate and the money is better
spent on the sample. If the primary delta clears the MDE and the placebo matches it, the finding is that this
lane's gain is formatting, and the mechanism needs replacing rather than tuning.

**Cost of this registration.** ¥0. Both predictions are computed from artefacts the chain already pays for.

### R165, amendment 1 — the placebo is built, and what would make its result uninterpretable

The arm registered above (§ R165, last paragraph) now exists: `--arm sham` permutes each rule's words within itself,
seeded by the rule's own text, after the cap and before the pass. The construction preserves the entry count, the
token count, the punctuation and the header exactly, so `sham` and `always-in` carry prefixes of the same length and
the only difference between them is the order of the words inside each rule. `agent.py`'s eleven tests pin the
properties that make that true, including the one that would silently destroy the control: the permutation happens
**once in `main`**, not per episode, because a block that re-permuted every turn would be a moving prefix and the two
arms would stop sharing a cache behaviour.

**What the sham cannot tell you, stated before it runs.** A permutation destroys meaning *and* it destroys syntax.
If the sham scores below `always-in`, the difference is "word order carries information" and not "these twenty rules
are right", because a scrambled rule is also a badly-formed sentence. The arm is therefore one-sided: it can show
that the bank's content is doing **nothing** (sham ≈ bank), which is the interesting failure; it cannot show that the
bank's content is doing the *right* thing. The two sided version — the paper's "irrelevant" intervention, twenty real
rules from an unrelated task type — is a different arm and a different bank, and it is not registered here.

**Dispatch rule (unchanged, restated with the arm in existence).** Run `arms: ["sham"]` with `top_k` at its default
and the same bank, **iff** `|always-in − none| > mde` from the sweep. Four slices, 134 games, ≈ ¥1.9. The bank must
be committed first: a standalone sweep that names no bank downloads this run's artefact, which a later run does not
have.

**The contrast is read in one direction.** `harm_share(sham vs none)` against `harm_share(always-in vs none)`. If the
sham's help share is within the interval of the bank's, the finding is that the mechanism this lane has spent four
rounds building is formatting, and the next row is not a better bank — it is a different layer.

### R165, amendment 2 — the k=1 direction, registered before either arm runs

AMD (Appendix AY of `COMPETITIVE.md`) measured retrieval `k=1` as the **global optimum** on AppWorld, with k=3 and
k=5 degrading monotonically (49.40% → 33.34% at k=5 on a 4B agent). Both arms of the contrast this lane now supports
(`arms: ["retrieved"]` with `top_k: 3` and `top_k: 1`, ≈ ¥1.9 each) are dispatched against the same bank, so the
contrast is paired on all 134 games.

**The prediction: `retrieved(k=1) − retrieved(k=3) > 0`.** Stated with its refutation: a k=3 arm that beats k=1 says
this corpus's packs need more than one entry to be actionable, which would be a difference from AppWorld rather than
a defect in either arm. Both outcomes are informative, which is why the contrast is worth ¥3.8 rather than the
bank's own delta being read twice.

**What would make it uninterpretable.** If the divergence rate of the two arms is near zero — the same games, the
same digests — then the third entry never mattered, and the contrast is measuring the prefix's length rather than
its content. `aggregate.py` reports `divergence_rate` for exactly this reason, and it is read before the delta.

## R168 — Four defects from one dead shard, and the one they exposed that no earlier run could have

Run `44685314225` dispatched the chain at 05:59 UTC and held it until 10:00 for the off-peak window. Three of the
four training shards finished. Shard 1 made 722 successful calls, then one connection was closed before its
response, and a four-hour job ended at game 20 of 35. The bank job was skipped, so twelve sweep jobs failed forty
seconds later on `Unable to download artifact(s)`, and the run's red X pointed at twelve jobs that never ran.

The three defects that produced that, and the fourth that reading the artefacts produced.

| # | defect | what it cost | the fix |
| --- | --- | --- | --- |
| **D1** | `chat()` treated every socket error as fatal: `http.client.RemoteDisconnected` derives from `ConnectionResetError`, not from `urllib.error.URLError`, so the `except URLError` clause never saw it and the traceback escaped | one dropped connection in 722 calls ended a four-hour job | a classification table (`transient`), five attempts at 1+2+4+8 s, and 400/401/403/404 still failing on the first |
| **D2** | `--out` was written once, at the end | 20 paid games, ~1,078 calls, left a 330-byte artefact | written after **every episode** through a temporary file and a rename, with `--resume` continuing it |
| **D3** | the bank job was skipped when a slice failed | twelve jobs failed on an absence, and the diagnosis was four layers away | `always()`, plus `--expect-games`, so the job that runs says *"the artefacts cover 82 games but the slice is 140"* |
| **D4** | `--shard i/n` was a **sample, not a partition** | 105 episodes over **82** distinct games; 11 games shared between shard 0 and shard 2 | `build_env` sorts `game_files` before `init_env` |

**D4 is the one worth the round, and it was found by D3's guard rather than by any run.** `AlfredTWEnv.collect_game_files`
walks the split with `os.walk(data_path, topdown=False)`, so `game_files` is in the **filesystem's** order. Two jobs
on two runners therefore sliced two different orderings of the same 140 games: three quarters of a split, sampled
three times from three orderings. Nothing in the lane could have seen this before — a single-shard run is unaffected
(the `floor` job drives the whole split in one process and its determinism check replays there), and the sweep's
`aggregate.py` would only have refused *after* paying for 402 games on twelve different orderings. The completeness
check that was built to refuse a partial union is what refused it, at ¥0, before a bank existed.

**What this means for every sharded number this lane has produced before today.** Each one was computed on a
partition that was not a partition. The 20-game calibration (55.0%) was single-shard and is unaffected; the
pre-flight and floor readings are single-process and are unaffected; every *sliced* reading is retired by this entry
rather than repaired, because there is no way to recover which games a past slice actually drove.

**The resume path, and why it is two mechanisms rather than one.** `--resume` continues a checkpointed pass; the
workflow's `train_run_ids` joins this dispatch's slices to an earlier run's. The first is for a process that stopped;
the second is for a *dispatch* that stopped, which is what happened here. Both are checked: the checkpoint's header
must equal the dispatch's field by field (`arm`, `split`, `shard`, `model`, `seed`, `games_requested`, `rules_in_bank`,
`top_k`), and the union must tile the slice. A resume whose environment restarted from the beginning re-drives a paid
game and is refused before the write, not after the bill.

**The registration this round buys, stated before the dispatch.** With the sort in place:

1. four training slices of 35 games each tile the 140 of `val_seen` with no overlap, and `--expect-games 140` passes;
2. four sweep slices of 34/34/34/32 tile the 134 of `val_unseen`, and `aggregate.py`'s `tile()` finds both arms on
   every one of the 134 games;
3. `retries` is a column in every artefact. **A pass that reports zero retries over four hours is itself a claim**,
   and after this round it is one the lane can check rather than assume.

**Cost.** ¥1.54 spent on the training attempt that produced D4 (105 episodes, 3,915 calls, $0.2156 by the provider's
own `usage`), of which the 82 distinct games are unusable: they are not a partition and cannot be joined into one.
The re-dispatch is four slices at ≈ ¥1.96, a bank at ≈ ¥0.10 and a sweep of 402 games at ≈ ¥5.63 = **≈ ¥7.69**,
which is the same figure the failed run committed. The difference is that this one has a reason to complete.

### R168, amendment 1 — the read-time overlap gate, built and gated on the delta it would explain

`arXiv:2610.07311` (*Understanding and Mitigating Inference-Time Overreliance*, 2026-10) is the one 2026 paper that
names a **repair** rather than a symptom: memory that is correctly stored and correctly retrieved still distorts
inference when only part of its evidence transfers, harm peaks at **intermediate** query-memory overlap, and removing
repeated or conflicting evidence at read time recovers most of the lost accuracy while task-aligned cases stay whole.

This lane's `retrieved` arm has no notion of intermediate. `anchor()` ranks by the count of shared content words and
keeps the top `k`, so a rule sharing one word with a long observation is admitted exactly as a rule sharing five. The
gate is the missing half of that decision — `--gate-share`, a floor on the share of the **observation's own** content
words that a rule must account for, applied before the budget so a gated arm carries fewer entries and a shorter
prefix.

**The prediction, registered before either arm runs.** `retrieved(gate 0.2) − retrieved(gate 0) > 0` on 134 paired
games, ≈ ¥1.9. Refuted by a gated arm at or below the ungated one, which would say that on this corpus the anchor's
near-misses are not what costs the money — and that would make the bank's *content* the suspect rather than its
retrieval, which is a different next step.

**What would make the contrast uninterpretable.** A gated arm that carries **zero** entries on most games is not a
gated arm, it is `none` with extra steps: `pack_entries` is recorded per episode, and the readback must report its
mean before the delta is quoted. `0.2` is chosen because the observation's content words number about six and a rule
that shares one of them has accounted for a sixth; an arm whose mean entry count is near zero says the threshold was
wrong, not the mechanism.

**One weakness of the anchor this makes visible, and does not fix.** `1` is a content word. `words_of` keeps
numerals, and every ALFWorld object is numbered, so a rule mentioning `countertop 1` collects a shared word for
free — 2/6 rather than 1/6 in the test's own observation. Removing numerals from the anchor's vocabulary is a
separate change to the *treatment*, not to the gate, and it is not made here because it would move the arm this
gate is measured against.

### R168, amendment 2 — what each outcome of the sweep will mean, written before the number exists

The sweep in flight (`44743739868`) produces three readings per pair: the paired delta, the share of games the pack
changed, and the harm share among those. Twelve outcomes are arithmetically possible and four are worth naming, so
the decision is registered now rather than chosen afterwards from whatever the interval happens to contain.

| the reading | what it means | the next dispatch it licenses |
| --- | --- | --- |
| `\|delta\| ≤ mde` and `divergence > 0.5` | the pack reached most games and moved the score by less than the split can see. **This is not "memory does not work"** — it is "at 134 games this pack's effect is smaller than the instrument's resolution" | the sample, not the mechanism: R165's placeholder "duplicate split" row, ≈ ¥5.71 for a second 134 games at a different seed, which halves the interval |
| `\|delta\| ≤ mde` and `divergence < 0.1` | the pack reached almost nothing: the rules were admitted rarely or the model ignored them | the *door*, not the rule: a change to where the block sits or how it is addressed, and `engagement` is the metric, not the delta |
| `delta > mde` | the pack helped by more than the split can resolve | the placebo (R165 amendment 1) at ≈ ¥1.9, because a positive delta and a positive delta from formatting are the same reading until the sham separates them |
| `delta < −mde` | the pack hurt | the gate (R168 amendment 1) at ≈ ¥1.9, and `harm_share` against the published 52% is the number that says whether this lane is worse than the field at the same failure |

**Why the first row is the one that will be misread.** A null at 134 games is the most likely outcome in this
literature — MemScope reports DynamicCheatsheet at 50.75 against ALMA's re-run baseline at 67.16 on the same corpus,
and the ALMA paper reports 87.1 for a method the other harness puts at 67.16. A lane that reports "memory does not
help" from one null is quoting a 40-point spread's worth of harness uncertainty as a fact about memory. The
`divergence` column exists to keep that from happening: a null over 5% of games and a null over 60% of games are
different statements, and only one of them is about memory.

**The number this row cannot produce, stated so it is not claimed later.** 134 games at a 55% base rate resolves
about 17 points at 80% power. Nothing in this sweep can detect a 3-point effect, and if the literature's effects are
3 points, this lane will report a null and be right about what it measured and wrong about what it concluded. The
only honest output of the first row is a *bounds* statement: "the pack's effect lies within ±mde" is a result; "the
pack does not work" is not.

## R169 — The bank this reading was taken with, committed so the next contrasts cannot silently use another

The reading in PROGRESS 200 has a treatment that is four sentences long, and the four contrasts it licenses all need
*that* bank. `banks/bank-44754440122.json` is it: 4 entries, cap 20, distilled from 76 won episodes of 140 by
`all_success_existing_rules@LeapLabTHU/ExpeL:e41ec9a2`, at $0.0134, with the census recorded beside it (ADD 4,
AGREE 28, EDIT 6, REMOVE 0, rejected 2, peak 4).

**Why it goes in the tree rather than staying an artefact.** A `workflow_dispatch` sweep that names no bank downloads
the bank of *its own* run, which does not exist when the run is a contrast against a bank built yesterday. A path in
the repository is the only way to say "this bank" across runs, and an input that accepts a path is an input that can
name a different one. The file is committed with its provenance in `source` and its bill, so a future contrast that
names it can be checked against this line rather than trusted.

**What makes two banks the same bank.** Not the entry count: 4 rules can be 4 different rules. The identity of a
contrast is the file, and the file carries the prompt hash it was distilled with. A re-distillation — even from the
same 140 games — produces a second file with a second name, and a reading that mixes them refuses in `aggregate.py`
because the games would not tile under one label.

**The prediction this bank already refuted, kept beside it.** R164 registered that the bank should be nearly add-only;
the census says otherwise (28 agreements to 4 additions). The measurement is in the file's own `stats`, so the next
reader sees the refutation in the artefact rather than having to find this paragraph.

## R171 — A bank distilled from two task kinds and scored on all six, registered before it is distilled

The placebo answered "does a block help" with **+17.91 pp** on a block whose words had been permuted (105 of 134
games, run `44763220821`), which is *higher* than the intact bank's +14.18 pp. That reading retires the attribution
the programme had been carrying, and it leaves one question that no arm in the lane can answer:

> **Does any of the 15–18 points depend on what the block says?**

`sham` keeps every word and destroys the order, so it tests order. It does not test vocabulary. The one control that
changes the words while holding everything else is a bank distilled from a subset of the six task kinds: `cool` and
`heat` are 28 of the 82 won training episodes (`cool` 18, `heat` 10), and the rules they yield are about cooling and
heating an object before placing it — sentences that are true of the world and inapplicable to the 62 `put`, `clean`
and `puttwo` games that make up most of the held-out split.

**What this dispatch holds fixed.** The distillation prompt (`all_success_existing_rules@LeapLabTHU/ExpeL:e41ec9a2`),
the model, the critique budget, the cap (20), the identity substring, the injection site, the arm, the 134 held-out
games. `--kinds "cool,heat"` is the only input that differs from the registration that produced the bank this lane
already has. The slices are the ones already paid for (`44744658304` shards 0–2 and `44738148591` shard 3), read
through `--bank-only`, so the dispatch buys no games.

**What is not held fixed, and the bound it puts on the claim.** A filter over 28 episodes can yield fewer rules than
a filter over 82, and a shorter block is a weaker treatment if the mechanism is length rather than content. The
registration therefore binds the *name* of the reading to the artefact that arrives:

| measured on the bank that arrives | what the reading may be called |
| --- | --- |
| ≥ 4 entries **and** ≥ 80% of the registered bank's rendered tokens | a **content** control: same shape, different words |
| 3 entries, or 60–80% of the tokens | a content control **at a shorter length**; the delta is bounded by both differences and may not be attributed to one of them |
| ≤ 2 entries, or < 60% of the tokens | **not a content control**: it is a shorter block, and the only question it can answer is whether *any* short block moves the score |

**The four readings, and the dispatch each licenses.** Every delta is paired on the same 134 games against a `none`
arm bought in the same run, because the control moved 6.0 pp between two dispatches of identical code (AUDIT 34.232)
and a cross-run comparison would be measuring that.

| the reading | what it means | the next dispatch it licenses |
| --- | --- | --- |
| delta within ±mde of +14…+18 pp | the **existence and shape** of the block is the mechanism and its vocabulary is not. This is the placebo's conclusion confirmed a third time, and by the arm that removes the words rather than their order | nothing in the memory queue: the lane is measuring preamble engineering, and the honest product is the preamble. The `floor.py` coverage row becomes the only work left (¥0), and the object-location *facts* pack (R170 row 4) becomes the only remaining test of whether content can matter at all |
| delta positive but **below** the placebo's interval | content contributes part of the effect and shape the rest; the decomposition is not resolvable in one dispatch | a length-matched *neutral* block (R170 rows 1–2, ≈ ¥1.5 each), which separates shape from grammar within the same length |
| delta within ±mde of zero | the effect **needs** rules that apply where they are scored, and the placebo's +17.9 is then a property of a block that is *about* the right things with its words shuffled — which would make R165 amendment 1's result uninterpretable rather than refuted | a re-read of the sham's bank: if its permuted rules still name the objects and receptacles of the scored games, the sham was never a content-free control, and the placebo reading has to be withdrawn before anything else is dispatched |
| delta significantly **negative** | inapplicable instructions cost more than no instructions | the read-time gate (R168 amendment 1, ≈ ¥1.9), now as the mechanism that keeps a bank from firing where it does not apply |

**The sub-split is where this reading can be stronger than the placebo.** The 134 held-out games publish their kinds
(the same six prefixes `agent.py` classifies), so the delta is reported three ways: over all games, over the 28-episode
*kinds the bank came from* (`cool`, `heat`), and over the games where its rules do not apply (`put`, `clean`,
`puttwo`). A block that moves `put` games while its sentences are about `heat` is a block whose words are inert, and
that is a sharper statement than "+17.9 from a shuffle".

**What would make this reading void, stated before it exists.**

  * A bank of ≤ 2 entries or < 60% of the registered token count — the first table governs, and the reading is renamed.
  * Rules in the arriving bank that are *general* rather than kind-specific: the ExpeL prompt asks for rules over the
    whole trajectory, and a distilled "search systematically before manipulating" would apply to every kind. The bank's
    own text is read and quoted in the report before the delta is interpreted, so that a vocabulary-specific control is
    not claimed for a bank that turned out to be generic.
  * A `none` arm whose rate moves more than `mde` away from the 81/134 this lane has measured twice — that is a
    different control or a different corpus, and the pairing, not the delta, is what would be at fault.

**Price, before it is paid.** Distillation over 28 episodes at 10 critique calls ≈ **¥0.03** (the 76-episode bank cost
$0.0134); the sweep is 134 games × 2 arms ≈ **¥2.0** (the 536-game four-arm sweep cost $0.596). Total **≈ ¥2.03**, and
the first half of it can fail at ¥0.03 without buying any games.

### R171, amendment 1 — the bank arrived, four of its five rules are about the task, and the control is void before it was paid for

Run `44774801298` distilled the filtered bank at **$0.004887** (¥0.035) in four critique calls over 28 won episodes
of the 140 already paid for: 5 entries, 16 operations (ADD 5, AGREE 10, EDIT 0, REMOVE 1, rejected 0), cap 20. The
dispatch drove no games. `banks/bank-crosskind-44774801298.json` is the artefact.

**The two conditions this registration named, answered from the artefact rather than from the reading.**

| condition | measured | verdict |
| --- | --- | --- |
| ≥ 4 entries and ≥ 80% of the registered bank's tokens | 5 entries; 1,166 rendered characters against 1,312 (88.9%), 188 words against 218 (86.2%) | the **shape** condition passes |
| rules that are kind-specific rather than general | 4 of the 5 rules are general: two are the `put` → `move <object> to <receptacle>` workaround, one is "open the closed receptacle first", one is "search the likely locations one by one". Only rule 3 is about cooling | the **content** condition fails, and this registration says a failed content condition voids the reading |

The rules, quoted because this is the paragraph a reader will check:

> 1. When the "put" action fails to place an object on a surface or in a receptacle, try the alternative phrasing
> "move <object> to <target>" as it often succeeds.
> 2. Before placing an object into a closed receptacle (e.g., microwave, fridge), open it first; if "put" still
> fails after opening, switch to "move <object> to <receptacle>".
> 3. Systematically search likely locations for the target object (countertop, diningtable, fridge, cabinets,
> drawers, shelves) one by one, and once found, take it before proceeding to the cooling step.
> 4. To cool an object, go to the fridge and use "cool <object> with fridge 1" even if the fridge is closed.
> 5. When a "put" action repeatedly fails despite the receptacle being open and the object being in inventory,
> do not waste turns retrying the same phrasing; immediately switch to "move <object> to <receptacle>".

Rule 1 and rule 5 are the same rule at two votes, rule 2 is a special case of it, and rule 3 is the registered
bank's own rule 2 with the cooling step appended. A bank distilled from `cool` and `heat` trajectories is a bank
about **placing objects**, because that is the last thing every trajectory does regardless of how the object was
prepared. The distillation prompt asked for rules over the trajectory, and the trajectories share their ending.

**Why the sweep is not bought, and what the ¥0.035 bought instead.** Scored, this bank would answer: *does a
five-entry, 88.9%-length bank of general rules move 134 games as much as a four-entry bank of general rules?* That
is a length-and-count comparison wearing a vocabulary comparison's clothes. Both readings are consistent with the
placebo's conclusion and neither separates content from form, so the ¥2.0 would buy a number that cannot be
attributed. The registration exists so that this is decided **before** the money rather than after the number:
¥0.035 has now bought the fact that the ¥2.0 is not worth spending, and the finding that ExpeL-style distillation
abstracts a kind-specific trajectory set into general procedures — which is a statement about the prompt, not
about this lane's mechanism.

**What is dispatched instead, and why it is the same question asked cheaply.** The placebo permuted the words and
kept the vocabulary; it showed that order is inert (+17.91 pp against the intact bank's +14.18). The remaining
separation is whether the words themselves matter at all, and it does not need distillation: a block of text with
the same header, the same length and the same imperative form, and **no word of it about the task**, is written by
hand at zero model cost. `banks/bank-filler-4.json` is that block — four entries on servicing a mechanical
typewriter, 1,107 characters against the registered bank's 1,103, 1,316 rendered against 1,312 (100.3%), written to
the per-entry lengths of the registered bank (255/245/306/301 against 254/248/309/292) so that neither the count nor
the length nor the grammar differs.

| the reading (always-in − none over 134 paired games) | what it means | the next dispatch it licenses |
| --- | --- | --- |
| filler ≥ the placebo's interval (+9…+27 pp) | **form is sufficient**: a preamble that says nothing about the task buys the whole effect. The mechanism is not memory, not vocabulary, and not relevance — it is the presence of a block that reads as instructions | no further memory work in this lane. The product is a preamble, and the remaining engineering is *where and when* it is injected — the read-time gate (R168 amendment 1, ≈ ¥1.9), now as a cost control rather than a rescue |
| filler within ±mde of zero while `always-in` stays at +14…+18 pp | the block must **read as relevant to the task**; irrelevant instructions do nothing. The placebo's +17.9 then needs a second explanation, because permuted ALFWorld words still read as relevant | the neutral declarative block (R170 row 1, ≈ ¥1.5): is it relevance, or imperative grammar? |
| filler between zero and the placebo, outside both intervals | two effects add: form contributes and content contributes | a 2×2 of form × relevance, four blocks, ≈ ¥8; and this row is the only one where the memory queue survives |
| filler significantly negative | irrelevant instructions distract, which is the harm mechanism AUDIT 34.230 measured at 9.85% arriving from the other direction | the gate, then the rule that a bank is injected only where its own words appear in the observation |

**The bound on this reading, stated before it exists.** Character length is not token length: the filler's vocabulary
is technical prose and the registered bank's is household instruction, and a tokenizer may value them differently.
Both counts are reported; if the rendered token counts differ by more than 20%, the row is renamed as a
*shorter-or-longer* block and the delta is bounded by that difference, not by content. The `none` arm is bought in
the same run, so the control's own 6-win run-to-run swing (AUDIT 34.232) cannot reach the comparison.

**Price.** Filler bank: **¥0** (hand-written, no model call). Sweep: 134 games × 2 arms ≈ **¥2.0**, with its own
control. The cross-kind bank cost ¥0.035 and is committed beside this text so that the decision not to score it is
checkable against the artefact rather than trusted from this paragraph.

### R171, amendment 2 — the filler block was scored, and relevance came back into the mechanism

Run `44782732761` drove the filler block over all 134 held-out games with its own control: 8,974 calls, **$0.4584**
(¥3.28), 268 episodes. The reading, from `aggregate.py` over the eight slices:

| arm | wins | rate | paired delta | 95% interval | p |
| --- | --- | --- | --- | --- | --- |
| `none` (control) | 89/134 | 66.42% | — | — | — |
| `always-in` (filler block) | 80/134 | 59.70% | **−6.72 pp** | [−14.93, +1.49] | 0.134 |

**Which row of the amendment-1 table this is.** The table named four readings. The point estimate falls in the fourth
(filler < 0: irrelevant instructions distract), the interval crosses zero, and it excludes the first row's floor
(+9 pp) by 7.5 points. So the claim this reading supports is narrower than either extreme:

> A block of instruction-shaped text that says nothing about the task does **not** buy the 14–18 points. The gain
> needs text that is *about the task*.

**And the two blocks that are about the task are still indistinguishable from each other.** Permuted-rule `sham`
(+17.91 pp) and intact rules (+14.18 pp) differ by 3.7 pp with overlapping intervals, so the ordering and the specific
content of the rules remain unattributed. What the three blocks together separate is three layers, not two:

| layer | the contrast that isolates it | measured |
| --- | --- | --- |
| the existence of a block | filler − none | **−6.72 pp** — no gain, slight and unresolvable harm |
| the block being *about the task* | sham − filler | **+24.63 pp** [z −3.97, p 0.0001; with the 8-win run swing, p 0.004] |
| the block's rules being intact and ordered | sham − always-in | **−3.73 pp**, intervals overlap — not resolvable |

**The shape all three share, which the registration did not predict.** Split by what the control did unaided, every
block helps the games the control lost and hurts the games it won:

| block | hard games (control 0/45…53) | easy games (control 100%) |
| --- | --- | --- |
| filler | +24.44 pp (11/45) | −22.47 pp (69/89) |
| always-in | +59.26 pp (32/45) | −16.25 pp (67/89) |
| sham | +62.26 pp (33/53) | −11.11 pp (72/81) |

That is the same trade in all three, at different strengths: a block makes the model behave differently on games it
was losing, and it breaks games it was already winning. The net is positive only when the block names the task.

**The mechanism the numbers now point at, stated as a hypothesis rather than a finding.** A block raises effort — the
`filler` arm diverged from the control on 88.8% of games and produced **32.7% invalid actions against 28.4%**, with
off-space actions up from 25 to 41 — and the task's vocabulary supplies direction. Effort without direction is a net
loss. Read this way, the placebo's +17.91 is not "form is sufficient"; it is "ALFWorld vocabulary is sufficient, in
any order", which is a weaker and more useful claim.

**What would have made this void, and did not.** The bank met the length condition of the first table (100.3% of the
rendered characters, per-entry matched to 255/245/306/301 against 254/248/309/292) and the rules were checked to be
about a different task before dispatch. One condition the registration **should** have named and did not: the control's
own rate. This run's `none` arm scored 89/134 where the two earlier dispatches scored 80 and 81, and because the easy
stratum is defined by the control's wins, that difference put **89 of 89** easy games in the stratum — a ceiling the
treatment can only fall from. The −6.72 point estimate therefore carries the ceiling effect as well as the treatment
effect, which is why the interval, and not the point, is what licenses the statement above.

**Price against the estimate.** ¥3.28 against the ¥2.0 registered: the filler arm spent 4,492 calls against the
placebo's 3,964 for the same 134 games, because it produced more turns. The under-estimate is the same one this lane
has now made three times — a per-episode price is a model of a run, and a treatment that changes the number of turns
changes the price.

## R172 — Half a block about the task, registered before it is scored

Amendment 2 left the mechanism as "a block that changes behaviour, pointed by the task's own vocabulary", with three
layers separated: existence (−6.72 pp), being about the task (+24.63 pp), and the rules being intact (−3.73 pp, not
resolvable). Both endpoints of the vocabulary axis are now measured on the same 134 games:

| block | entries about the task | delta |
| --- | --- | --- |
| `banks/bank-filler-4.json` | 0 of 4 | −6.72 pp |
| `banks/bank-44754440122.json` | 4 of 4 | +14.18 pp |

**The question this registers is what happens in between**, because the three answers mean three different products.

**The block, and what is held fixed.** `banks/bank-dose-2of4.json` is four entries: the two highest-voting rules of
the registered bank, then the two typewriter entries of the filler bank. Per-entry lengths are 254/248/306/301
against the registered bank's 254/248/309/292 — the total renders to **1,318 characters against 1,312 (100.5%)** —
with the same header, the same identity, the same cap, the same injection site, the same model and the same 134
held-out games. The real rules stay in the positions they occupy in the registered bank, so position is not a
difference either.

| the reading (always-in − none, 134 paired games) | what it means | the dispatch it licenses |
| --- | --- | --- |
| ≈ **+4 pp** (roughly halfway between −6.7 and +14.2) | **linear priming**: the effect scales with the share of the block that is about the task. Then the product is a preamble sized to a budget, and knowledge is not involved at any point on the curve | the `--gate-share` arm (R168 amendment 1), repurposed from a rescue to a cost control, and the programme stops claiming memory |
| ≈ **+14 pp** or more | **threshold**: two real rules buy everything four buy, so the remaining half of the block is decoration | a one-rule block (≈ ¥2–3) to find the smallest sufficient block, which is the cheapest product this lane could ship |
| ≈ **−7 pp** (back at the filler's value) | **no priming at all**: the gain needs the specific procedural advice in all four entries, which revives the claim the placebo was thought to have retired | the object-location **facts** pack (R170 row 4) at once, and the dismissal of every "domain priming" reading of this lane's own numbers |
| between the endpoints but outside all three intervals | two effects adding unevenly, which is the only outcome that does not decide anything | a second dose point at 1 of 4 and 3 of 4, ≈ ¥6, and no conclusion this round |

**The counters that decide whether this is a dose at all.** If `engagement` falls below 50% of games diverged, the
model is ignoring part of the block rather than being moved by half of it, and the reading is "a block with
irrelevant sentences is partly discarded" — a different statement, and one that a by-entry ablation would be needed
to support. `by_kind` and the hard/easy strata are reported beside the pooled delta for the same reason they were
last time: every block so far helps the games the control lost and hurts the ones it won, and a dose point that
breaks that shape is a warning about the artefact rather than a finding.

**The condition the last registration should have written.** The `none` arm's own rate is stated as a verbatim
condition: if this dispatch's control lands **above 85/134**, the easy stratum is a ceiling and the reading is
reported by stratum only, with no pooled number quoted. The last run's control scored 89/134 against 80 and 81 in
the two before it, which is the largest swing this lane has measured and is now the working noise floor.

**Price.** 134 games × 2 arms, at the filler arm's measured ¥3.28 for this shape rather than the ¥2.0 that was
quoted three times and missed three times.

**What would void this reading, stated before it exists.**

  * A control above 85/134, per the condition above.
  * A dose bank whose rendered length differs from the registered bank by more than 5% — it is 0.5% by construction,
    and the number is checked against the artefact rather than trusted from this paragraph.
  * An `engagement` below 50%, which makes the reading about partial discard rather than about dose.

### R172, amendment 1 — the dose point was scored, the control crossed its own ceiling, and the half that was dropped is the half that names the failing operation

Run `44789662558` drove the two-real-two-filler block over all 134 held-out games with its own control: 8,804
calls, **$0.4495** (¥3.21), 268 episodes, four shards per arm. Rendered length 1,318 against the registered
block's 1,312 (100.5%), 218 words against 218, the real rules in the positions they occupy in the registered
bank.

**The condition this registration wrote for itself fired.** Its control landed at **90/134 (67.16%)**, above the
verbatim 85/134 threshold, so per that paragraph no pooled number is quoted as the reading. The strata, which
is what the condition asks for:

| stratum | the dose block | `none` | delta |
| --- | --- | --- | --- |
| hard — the games the control lost | 13/44 | 0/44 | **+29.55 pp** |
| easy — the games the control won | 67/90 | 90/90 | **−25.56 pp** |

Engagement **129/134 (96.3%)** — the block was read, so the counters that void the reading did not fire — harm
23/129 (17.8%), help 13/129 (10.1%). By kind: `clean` −12.9, `put` −12.5, `heat` −8.7, `examine` −5.6,
`cool` 0.0, `puttwo` 0.0. For the record and not as a claim, the pooled paired delta was −7.46 pp
[−15.67, +1.49], p = 0.105, discordance 13 + 23 = 36, mde 12.6 pp.

**Which of the four registered rows this is, and why the row's own interpretation is not yet available.** The
estimate sits on the filler's value (−7.46 against −6.72), which is row 3, whose text reads "the gain needs the
specific procedural advice in all four entries". That sentence attributes the reading to *how much* of the block
was about the task, and the artefact does not licence the attribution: the dose kept entries 1–2 (the desklamp
note, the search order) and dropped entries 3–4 (verify the object is in the inventory before placing; if `put`
fails try `move <object> to <receptacle>`). Entries 3–4 are the only entries in the block that name the operation
this corpus actually fails — and the dose arm's two largest losses are on `clean` (−12.9) and `put` (−12.5), the
two kinds whose failures are placement failures. "Half the content" and "the half that does not address the
failing operation" are the same half in this artefact, and one more dose at the other half separates them for the
price already quoted.

**What the four dispatches say without using any control at all.** Every block was scored on the same 134 games
by the same model through the same harness, so their absolute win counts are comparable to each other even though
their controls' are not:

| block | entries about the task | wins / 134 | dispatch |
| --- | --- | --- | --- |
| four distilled rules | 4 of 4 | **99** (73.9%) | `44754440122` |
| the same four, order permuted | 4 of 4 | **105** (78.4%) | `44763220821` |
| four typewriter entries | 0 of 4 | **80** (59.7%) | `44782732761` |
| two distilled rules + two typewriter entries | 2 of 4 | **80** (59.7%) | `44789662558` |
| `none` | — | 80, 81, 89, 90 | four dispatches |

The blocks repeat (80 and 80; 99 and 105) while the control does not (80, 81, 89, 90). Whatever produces the
seven-point spread lives in the arm that has no block, not in the arms that have one, and a delta quoted against
a single `none` therefore carries an uncertainty this lane cannot shrink by buying more treatments. Two treatments
paired against each other do not carry it: both drove every game, and the difference between them is the
difference between two blocks. `aggregate.py --relabel` now exists so that this pairing is a command, with the
rename printed in the report because a cross-dispatch reading whose provenance is silent reads like a within-run
one.

## R173 — The other half, and the padding, registered before either is scored

Two treatments, two dispatches, bought in parallel because neither one's reading depends on the other's.

**R173.1 — the complementary half, at the registered length and in the registered positions.**
`banks/bank-dose-complement-2of4.json` is four entries: the two filler entries at positions 1–2 (trimmed from 255
and 245 characters to the registered 254 and 248 so that the per-entry profile matches), then entries 3 and 4 of
the registered bank at 309 and 292. Rendered **1,312 characters against 1,312 (100.0%)**, 219 words against 218,
same header, same identity, same cap, same injection site, same model, same 134 games. The only difference from
the R172 dose point is *which* two entries are about the task.

**R173.2 — the same two rules with nothing around them.** `banks/bank-putpair-2.json` is entries 3 and 4 alone:
**802 rendered characters (61.1%)**, 135 words. It is not length-matched and it is not meant to be. It answers the
question the dose point raised and could not settle: the dose was 2 real + 2 filler and scored exactly what 4
filler scored, which is either "two rules are worth nothing" or "the filler cancels them". A block with no filler
in it reads those two apart — if it lands near 99 the padding is not inert but harmful, and if it lands near 80
the count of rules that address the failing operation is what the block is worth.

| the reading, treatment against treatment on the same 134 games | what it means | the dispatch it licenses |
| --- | --- | --- |
| complement ≈ 99 and pair ≈ 99 | the **placement rules are the whole effect**, and the padding is inert: 802 characters buy what 1,312 buy. The mechanism is advice that names the failing operation | a block written *for* `put`-family failures alone (the lane's worst kind, 3–4 of 24 unaided), ≈ ¥3; and the distillation line resumes with the target changed from "a rule bank" to "a workaround for the operation that fails" |
| complement ≈ 99 and pair ≈ 80 | placement rules carry the effect **only when the block is long enough**, so length is a second factor after all, and the placebo's "order is inert" does not extend to "quantity is inert" | a length ladder at 1,312 with 1, 2, 3 and 4 real entries, ≈ ¥12, and no product claim until it is read |
| complement ≈ 80 and pair ≈ 80 | neither half alone moves the score: the effect needs the block to carry **both** a general search rule and a placement rule, which is a composition claim and the first one this lane has had that a competitor's bank could fail | the 3-of-4 dose (entries 1, 3, 4), ≈ ¥3, to find whether the composition is a pair or the whole set |
| pair ≈ 80 and complement between the endpoints | the filler is actively cancelling a real effect, which reconciles the R172 dose point with the 4-rule block | a re-score of the registered block with its own entries in the reverse order (the placebo already permuted; this reverses), ≈ ¥3 |

**What would void either reading, stated before they exist.**

 * Engagement below 50% of games diverged — a block that was not read cannot be a block that did not help.
 * A control above 85/134 in either dispatch: reported by stratum only, and the cross-treatment pairing becomes
   the only number quoted. The condition is now permanent rather than per-registration, because it has fired once
   in five dispatches and the ceiling it describes is a property of the split rather than of a run.
 * A rendered length difference above 5% for R173.1 (it is 0.0% by construction, and the number is checked from
   the artefact's own `render_pack` rather than trusted from this paragraph).
 * R173.2's reading may not be attributed to content alone: it differs from the registered block in both content
   and length, and it is quoted only beside R173.1, which holds length fixed.

**Price, before it is paid.** Two dispatches, each 134 games × 2 arms: **¥3.3 each, ≈ ¥6.6 together**, priced at
the arm's measured cost for this shape rather than at the ¥2.0 that has now been quoted three times and missed
three times. Each dispatch buys its own `none` arm, so no control is compared across dispatches.

### R173, amendment 1 — the bare pair is the best arm in the lane, and every sentence after it costs

Run `44833963032` drove entries 3–4 of the registered bank with nothing around them: **802 characters, 61.1% of the
registered block's length**, 135 words. 7,605 calls, **$0.3776 (¥2.70)**.

| arm | rendered | wins / 134 | its own control | delta vs its own control |
| --- | --- | --- | --- | --- |
| **the bare pair** | **802** | **109 (81.34%)** | 91 | +13.43 pp [+5.22, +21.64], p 0.002 |
| the placement half, padded to length | 1,312 | 100 | 88 | +8.96 pp |
| four distilled rules | 1,312 | 99 | 80 | +14.18 pp |
| the search half, padded to length | 1,318 | 80 | 90 | −7.46 pp |

Paired against each other across dispatches, with no control in the comparison:

| contrast | delta | 95% interval | p | engagement |
| --- | --- | --- | --- | --- |
| bare pair − padded placement half | **+6.72 pp** | [+0.75, +12.69] | 0.034 | 87/134 (64.9%) |
| bare pair − four distilled rules | **+7.46 pp** | [+0.75, +14.18] | 0.045 | 92/134 (68.7%) |

**Two sentences beat four, and two sentences beat two-plus-padding, at 61% of the length.** By kind the bare pair is
also the only arm that leaves `examine` unharmed (18/18, against 14/18 for the four-rule block and 16/18 for the padded
half) and the only arm that moves `put` (6/24 against 3, and against 1–2 in every longer block).

**What this does to R173's four readings: it takes the second one and then overrules its framing.** The registered
second row said "placement rules carry the effect only when the block is long enough, so length is a second factor".
The direction is the opposite: the block does not need the length, it *pays* for it. Two independent contrasts put the
price at **−6.7 to −7.5 pp for two extra entries**, which is −3.4 to −3.7 pp per entry, and the two extra entries were
task-relevant in one case (the four-rule block) and irrelevant in the other (typewriter entries). So the cost is not
"poison from filler": **it is the quantity of text in front of the question** — which is the same sign and the same
order of magnitude as the BIRD lane's measured −1.7 pp per injected rule (W8), on a different corpus, in a different
prompt shape, with a different unit of reasoning.

**What it does not separate, stated before it is claimed.** Two entries against zero entries is a length difference as
well as a content difference, and this design cannot tell "each sentence costs attention" from "the block crosses a
length the model handles worse". The clean test is a third point at the same content and half the length — one
sentence, 489 characters — which is R174 row 1. Until it is read, the product sentence is "two sentences and nothing
else", not "shorter is better".

## R174 — One sentence, and a gate that has to reproduce a narrow pack out of a broad one

Two arms, both licensed by R173 amendment 1, bought in parallel.

**R174.1 — one sentence.** `banks/bank-putmove-1.json` is entry 4 alone: the `put`→`move` workaround, **489
characters (37.3% of the registered block)**, 82 words. If it scores with the bare pair, the pack is one sentence and
the product is a single line; if it falls to the padded half's level, the pair is a composition — the inventory check
and the workaround together — and the price per sentence is not the mechanism.

**R174.2 — the gate, on the registered bank.** `--arms '["none","retrieved"]' --rules
eval/drivers/alfworld/banks/bank-44754440122.json --top-k 3 --gate-share 0.2`: the four-entry bank, retrieved at k=3,
admitted only where the observation overlaps the rule's words by 0.2. The archived *ungated* reading is 99/134 for
`retrieved@k3` in `44754440122`, so a gated arm is compared treatment-to-treatment against it. The registered bank is
four entries rather than six because the earlier six-rule bank was the one R170 retired; the gate's question does not
need a large store, it needs a store in which some entries apply to a game and some do not, and this one has both. The question is the product question: **can a gate make a broad store behave like a narrow pack** — fire on
the games whose observation names the failing step, stay silent on the rest.

| the reading | what it means | the dispatch it licenses |
| --- | --- | --- |
| one sentence ≈ 109 | the pack is **one line**, and the lane's product is a single sentence per failing step | write one sentence per kind (six, ¥3.2) and measure the pack a user would actually ship |
| one sentence ≈ 100 (the padded level) | the two sentences compose, and the per-sentence cost theory is wrong at n = 1 | a 3-of-4 and a 1-of-4 ladder at matched length, ¥6.4 |
| gated retrieved ≈ 109 | **the gate reproduces a narrow pack from a broad store**, which is the only form in which memory scales | measure the gate's firing rate against the kinds it fires on, and promote it from cost control to product |
| gated retrieved ≈ 99 (the ungated reading) | the gate changes nothing at k=3, so the six-rule bank's damage is not about which rules fire | drop the gate and re-ask why a broad bank of relevant rules is worth less than a narrow one |

**What would void either reading.** Engagement below 50%; a control above 85/134 in either dispatch (strata only, and
the cross-treatment pairing becomes the only number quoted); and for R174.1, any claim about length alone — it differs
from the bare pair in both content and length, and is quoted only beside it.

**Price.** 134 games × 2 arms each: **≈ ¥3.2 + ¥3.2 = ¥6.4**, priced at the measured cost of the last four dispatches
($0.3776 to $0.4495 per run).

## R174, amendment 1 — one sentence is the best arm in the lane, and the gate carried nothing at all

Both arms were bought together, each with its own control, and each read against the four readings the register
said it would be read against.

**R174.1 — one sentence.** `banks/bank-putmove-1.json`, entry 4 alone: **489 characters, 37.3% of the registered
block**, driven as `always-in` over the held-out 134. Run `44841962248`, 7,459 calls, **$0.3708 (¥2.65)**.

| arm | rendered | wins / 134 | its own control | delta vs its own control |
| --- | --- | --- | --- | --- |
| **one sentence** | **489** | **112 (83.58%)** | 88 | **+17.91 pp [+8.96, +26.87], p 0.0000** |
| the bare pair | 802 | 109 (81.34%) | 91 | +13.43 pp |
| the placement half, padded | 1,312 | 100 | 88 | +8.96 pp |
| four distilled rules | 1,312 | 99 | 80 | +14.18 pp |

By stratum the sentence does what the register predicted a sentence about the failing step would do, and more of
it: **hard 35/46 against 0/46 (+76.1 pp)**, easy 77/88 against 88/88 (−12.5 pp). By kind it moves `put` to 10/24
(from 5), `cool` 20/21 (from 13), `heat` 22/23 (from 17), `clean` 28/31 (from 21), `puttwo` 16/17 (from 14) — five
of the six kinds improve on one sentence, and it is the one sentence that names the two operations most games
fail at. `examine` is the exception at 16/18 against 18/18, and it is the kind whose task line names no `put`.

**What this settles and what it does not.** The registered decision table said: one sentence ≈ 109 means the pack is
one line and the product is a single sentence per failing step. It read **112**, which is three wins above the pair
and inside the noise of it — so the honest statement is that **a second sentence about the same failing step is
worth nothing measurable**, not that it is worth less. The four readings now form a ladder over content at two
lengths: 112 (489, one sentence) ≥ 109 (802, two) > 100 (1,312, two padded) ≈ 99 (1,312, four). Every step down the
ladder is a step away from *naming the failing operation*.

**R174.2 — the gate, void, and the defect that hid it.** `retrieved` at k=3 with `--gate-share 0.2` over the
registered four-entry bank. Run `44841993038`, 9,089 calls, **$0.4535 (¥3.24)**. The arm scored 81/134 against a
control of 90, and the report had every appearance of a measurement: engagement 88.1%, six by-kind rows, a paired
delta of −6.72 pp, a bill.

**It carried zero entries in 134 of 134 games.** `pack_entries` is 0 in every episode of all four slices while
`rules_in_bank` is 4. The reading is an empty prompt's, not a gate's, and the −6.72 pp is the control's own noise.

Why the gate admitted nothing is arithmetic rather than tuning. The floor asks a rule to account for 0.2 of the
observation's content words. A real first observation carries **22 content words, all of them furniture**: `cabinet
4, countertop 1, garbagecan 1, sinkbasin 2, toilet 1 …` plus the task line. The largest overlap any of the four
rules can reach is **one word** — and one of the three matches is `task`, from the prompt's own `Your task is to:`
line. The floor is therefore 4.4 words against a corpus ceiling of 1. The gate was not too strict; it was a filter
on the wrong object: an observation names the room, and the failing step is in the action.

**What that costs the instrument, and what was changed because of it.** Engagement was 88.1% and the pack was
empty, so engagement is not an admission test: an empty prompt changes the trajectory, which is why it looked
engaged. Two changes were made before either arm above was quoted:

1. `aggregate.py` now reports `carried` per arm — the distribution of `pack_entries` — and refuses a pack arm that
   carried nothing in every game, and a `none` arm that carried anything. The refusal is printed above the delta,
   because the first question about a pack reading is whether the pack was there (AUDIT 34.243).
2. `agent.py` grows `--gate-kind`, which selects entries by the **task the game names** (`task_kind_of`, read from
   the gamefile before the first call) instead of by lexical overlap with the room. On this corpus that is the only
   signal that exists at decision time, and it costs nothing.

**Price.** ¥2.65 + ¥3.24 = **¥5.89** for both arms, against the ¥6.4 quoted.

## R175 — A six-sentence store, selected by the task, and the same store without the gate

The product question R174 leaves: a store has to cover the corpus, and a pack has to be one line. R174.1 says one
line is the best arm; R174.2 says the selection signal cannot be the room. R175 asks whether the two can be had
together, and it asks it as an ablation of one module: **the same six sentences, with the kind gate and without it.**

`banks/bank-perkind-6.json` is six entries, one per published kind, each tagged with the kinds it was written for.
The `put` entry is `bank-putmove-1.json` **verbatim**, so the gated arm's `put` games render the exact 489-character
block that scored 112 — the store reproduces the winning arm byte for byte on a quarter of the split, and the other
five kinds are what it adds.

| # | experiment | the question | state | price |
| --- | --- | --- | --- | --- |
| **1** | `always-in@kind` over the six-entry tagged bank | can a store cover six kinds and still be worth one line per game — does selection make a wide bank behave like a narrow pack | **in flight** | ≈ ¥3.2 |
| **2** | `always-in` over the same six-entry bank, ungated | the control for row 1 and a reading of its own: six sentences with no selection, which the per-sentence price predicts at ≈ 94 | **in flight** | ≈ ¥3.2 |
| 3 | the `examine` sentence alone | the one kind one sentence does not move (16/18 against 18/18), and the only sentence written without a `put` step in it | licensed by row 1 | ≈ ¥3.2 |
| 4 | `retrieved@kind` over the same bank | does the anchor still help once the pool is the game's own sentence, or is a one-entry pool already the whole answer | contingent on row 1 | ≈ ¥3.2 |
| 5 | a retrieved **raw trajectory** | the literature's claim that abstraction is where a memory loses its value (arXiv:2605.12978) | needs a second bank schema, ~3 h | ≈ ¥3.2 + 3 h |
| 6 | the bare pair **compressed** to 508 characters (`banks/bank-putpair-terse-2.json`), same two operations, imperative register | is the per-sentence price paid in characters or in statements | **built, not bought**: R174.1 put one statement at 112 and two at 109, so this lane's instrument cannot resolve the 3–4 pp a compression of this size could buy (mde 12–14 pp) | ≈ ¥3.2, unspent |

**The pre-registered reading of rows 1–2, before either is bought.**

| row 1 | row 2 | what it means |
| --- | --- | --- |
| ≈ 112 | ≈ 94 | **the store scales**: selection makes six sentences cost what one costs, and the per-sentence price is a price paid by *carrying*, not by *storing* |
| ≈ 112 | ≈ 112 | the six sentences are worth what one is worth, ungated too — the per-sentence price is not linear and R173.1's slope was about the two task-relevant entries, not about counting |
| ≈ 94 | ≈ 94 | selection by kind does not help, so a wide store cannot be made narrow by the signal the harness has — the product is one hand-written sentence until a better signal exists |
| row 1 < row 2 | — | the gate hurts, and the mechanism is the one R174.2 found in a different form: a tag that fires is not a rule that applies |

**What would void either reading.** The empty-pack refusal `aggregate.py` now performs (row 1 must carry one entry
in at least 90% of games, since every kind is tagged); engagement below 50%; and a control above 85/134, which is
now the third time this split has produced one — a level claim from this dispatch would be quoted by stratum only,
and the row-1-versus-row-2 contrast is treatment against treatment and needs no control at all.

**Price.** 134 games × 2 arms each: **≈ ¥3.2 + ¥3.2 = ¥6.4**.
