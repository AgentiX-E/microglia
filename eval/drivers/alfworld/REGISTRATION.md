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
