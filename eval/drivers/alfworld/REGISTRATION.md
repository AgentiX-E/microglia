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
| **1** | `always-in@kind` over the six-entry tagged bank | can a store cover six kinds and still be worth one line per game — does selection make a wide bank behave like a narrow pack | **read: 69/134, carried 1.0 in all games, no control (defect, AUDIT 34.246)** | ¥1.80 |
| **2** | `always-in` over the same six-entry bank, ungated | the control for row 1 and a reading of its own: six sentences with no selection, which the per-sentence price predicts at ≈ 94 | **read: 100/134 against its own control's 91** | ¥2.95 |
| 3 | the `examine` sentence alone | the one kind one sentence does not move (16/18 against 18/18), and the only sentence written without a `put` step in it | licensed by row 1 | ≈ ¥3.2 |
| 4 | `retrieved@kind` over the same bank | does the anchor still help once the pool is the game's own sentence, or is a one-entry pool already the whole answer | **retired by row 1**: the gate is the wrong object, and a one-entry pool leaves an anchor nothing to rank | unspent |
| 5 | a retrieved **raw trajectory** | the literature's claim that abstraction is where a memory loses its value (arXiv:2605.12978) | bank built and validated (`banks/bank-rawput-1.json`, 505 ch); registered as R176 | ≈ ¥3.2 |
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

## R175, amendment 1 — six sentences cost eight wins, and selecting them by task kind costs twenty-three

Both rows bought: run `44850240971` (row 1, gated) and `44850377113` (row 2, ungated, with its control). Row 1 was
bought **without a usable control**, because the dispatch passed its flags to every arm in the matrix and the driver
refused one of them on the arm that carries no bank; the defect and its fix are AUDIT 34.246. Row 1's level is
therefore quoted against row 2's control, and every claim below that matters is treatment against treatment.

| arm | rendered pack | pack entries | won | bill | per win |
| --- | --- | --- | --- | --- | --- |
| `none` (run `44850377113`) | 0 ch | 0 | **91**/134 | $0.2245 (¥1.61) | $0.0025 |
| `none` (run `44841962248`, R174.1) | 0 ch | 0 | 88/134 | $0.2201 (¥1.57) | $0.0025 |
| `always-in@one` (R174.1) | 489 ch | 1 | **112**/134 | $0.1506 (¥1.08) | **$0.00134** |
| `always-in` six, ungated (row 2) | 1,280 ch | 6 | **100**/134 | $0.1879 (¥1.34) | $0.0019 |
| `always-in@kind` (row 1) | 324–489 ch | 1 | **69**/134 | $0.2516 (¥1.80) | $0.0036 |

| pairing | delta | 95% CI | p |
| --- | --- | --- | --- |
| one − six | **+8.96 pp** | [+2.24, +16.42] | 0.014 |
| one − none | +15.67 pp | [+7.46, +23.88] | < 0.001 |
| six − none | +6.72 pp | [−2.24, +15.67] | 0.179 |
| six − kind | **+23.13 pp** | [+12.69, +33.58] | < 0.001 |
| one − kind | +32.09 pp | [+22.39, +41.04] | < 0.001 |
| kind − none | **−16.42 pp** | [−26.87, −5.97] | 0.0024 |

**1. The store does not scale, and the pre-registered table said it might.** Row 2 was registered at ≈ 94 and read
100; row 1 was registered as one of four cells and landed in the fourth — *the gate hurts* — below its own control.
The registered reading, in the register's own words, was "a store of six sentences is worth about what one sentence
is worth". The measurement is harsher: **six sentences are worth eight wins less than the best sentence among
them**, and are not distinguishable from carrying nothing.

**2. The per-sentence price survives where the slope did not.** Five extra sentences, all task-relevant, one per
published kind, cost 8.96 pp = **−1.79 pp per sentence** — the same sign as the −3.4 to −3.7 pp of AUDIT 34.242,
at half the rate and on a different object (a wide store instead of a padded block). AUDIT 34.245 retired the slope
as a mechanism; this puts a number on the only version of it that is still a claim: **a sentence added to a pack
that already names the failing step buys coverage the games do not need.**

**3. The kind gate is the wrong object, not a wrong threshold.** Selecting each game's own sentence should make a
six-entry store behave like a one-entry pack. It made it behave worse than an empty pack: −16.42 pp against the
control, −23.13 pp against the same six sentences ungated. By kind, gated against ungated:

| kind | gated | ungated | delta | control |
| --- | --- | --- | --- | --- |
| `put` | 9/24 | 9/24 | 0.0000 | 2/24 |
| `puttwo` | 13/17 | 17/17 | −0.2353 | 15/17 |
| `clean` | 15/31 | 26/31 | −0.3548 | 22/31 |
| `cool` | 10/21 | 16/21 | −0.2857 | 16/21 |
| `heat` | 6/23 | 15/23 | −0.3913 | 18/23 |
| `examine` | 16/18 | 17/18 | −0.0556 | 18/18 |

The gate only ties on `put`, the one kind whose sentence is the winning arm verbatim. Every other kind loses between
one and nine games to a gate that handed it *its own* sentence and took away the `put` one. The mechanism is now
measured rather than argued: **the sentence that pays is the one about the failing action's phrasing, and it
transfers across kinds; the sentences that describe a kind's objects and stations do not.** The `heat` entry tells
the agent to close the microwave before heating; a `heat` game already has a microwave in the room and an
observation that says so. The `put` entry tells the agent that `put` has a second phrasing — which no observation
ever says, and which is why it survives being carried into games it was not written for.

**3b. The transfer is the placement, and five of the six kinds end with one.** The one-sentence arm read against
the **control**, by kind: `put` 10/24 vs 2 (+8), `clean` 28/31 vs 22 (+6), `heat` 22/23 vs 18 (+4), `cool` 20/21 vs
16 (+4), `puttwo` 16/17 vs 15 (+1), `examine` 16/18 vs 18 (−2). The corpus's own type names say which of these end
with a placement — `pick_and_place_simple`, `pick_clean_then_place_in_recep`, `pick_heat_then_place_in_recep`,
`pick_cool_then_place_in_recep`, `pick_two_obj_and_place` — and those five are exactly the five the sentence helps;
`look_at_obj_in_light` has no placement in it and is the one kind the sentence charges. So the sentence does not
generalise: **it repairs the step every kind ends on**, which is why it transfers and why a description of the
middle of a task does not.

**4. A wrong sentence costs more than a long one.** The gated arm carried one sentence per game — a mean pack of
378 characters against the ungated store's 1,280, and a mean prompt of 4,452 against 5,354, the two differing by
exactly the pack in each case — and cost $0.2516, **34% more than the six-sentence arm** and 2.7× the per-win price
of the single sentence. A pack is billed per call and a losing game is billed for all fifty
steps: the six-sentence arm made 3,758 calls, the gated arm 4,923. Length is the price of the prompt; being wrong
is the price of the trajectory.

**5. The instrument's own noise floor, measured on identical bytes.** The gated arm's `put` games carry the exact
489-character pack that R174.1 scored 112 with — `prefix_chars` and `pack_chars` are equal in all 24 of them — and
they scored **9/24 against R174.1's 10/24**. The same text, bought twice, moved one game in twenty-four (4.2 pp).
That is the first direct reading of this lane's sampling noise, and it is the number the six-arm/one-arm
distinction (24 discordant games) has to clear.

**What this changes in the product.** The lane now has one hand-written sentence, no store, and no gate. R175 was
the test of whether a store could be built from that sentence by writing one more per kind; it cannot, and the
reason is not length or selection but content: **the other five sentences are about the room and the task's
objects, and the one that pays is about the action's second phrasing.** R176 asks the complementary question about
the same sentence — whether it pays because it is *stated* or because it is *evidence* — by showing the verbatim
trajectory it was distilled from at the same length (505 against 489 characters, `banks/bank-rawput-1.json`).

**Price.** ¥1.80 (row 1) + ¥2.95 (row 2 with its control) = **¥4.75**, against ¥6.4 quoted for two arms with two
controls.

## R176 — The same evidence shown instead of stated, at the same length

The one sentence that wins this lane is an **abstraction**: 489 characters distilled from one trajectory. The
literature's claim (`arXiv:2605.12978`) is that abstraction is where a memory loses its value. On this corpus that
claim was untestable until now for a duller reason than theory — nobody had bought the trajectory at the same
length. `banks/bank-rawput-1.json` is that trajectory **verbatim**: the failed `put`, the thought that followed it,
the `move` that worked and the observation confirming it, rendered at **505 characters** against the sentence's
**489**. Two arms, one bank each, 16 characters apart.

| # | experiment | the question | price |
| --- | --- | --- | --- |
| **1** | `always-in` over the verbatim trajectory (505 ch) | at matched length, is the value in the statement or in the evidence | ¥3.2 quoted |
| **2** | `none` in the same dispatch | the control the pair is read against | included above |

**Registered readings.** ≥ 106 (within 6 games of the sentence) — **the form does not matter, the information does**;
below 98 (8 games under the sentence) — **the statement is what transfers**, and shown evidence is not readable at
equal length; between — both forms carry part of it and the next arm is a mixed pack at the same total length.

**Void conditions.** `carried` must be 1.0 in all 134 games; the arm's mean prefix must exceed the control's by
**505 ± 2** characters, which is what makes the pair length-matched rather than length-adjacent; engagement above
50%.

| arm | won | rate | bill | per win | mean prefix |
| --- | --- | --- | --- | --- | --- |
| verbatim trajectory, 505 ch | **108**/134 | 80.60% | $0.1576 (¥1.13) | $0.0015 | 4,579.1 |
| the sentence, 489 ch (R174.1) | **112**/134 | 83.58% | $0.1506 (¥1.08) | $0.0013 | 4,563.1 |
| `none` (this dispatch) | 93/134 | 69.40% | $0.2162 (¥1.55) | $0.0023 | 4,074.1 |

**Read.** The trajectory is worth **+11.19 pp [+3.73, +18.66], p = 0.0038** against its own control — 22 games
repaired, 7 broken — and the sentence is worth **+2.99 pp [−3.73, +9.70], p = 0.445** over the trajectory. The
registered answer is the first: at equal length **the two forms are worth the same**, and whatever the literature's
compression loses, it does not lose it here. The mean prefix differs by **505.0 characters**, exactly the bank's
render, so the pair is length-matched to the byte.

**What the aggregate tie hides, by kind.** The sentence minus the trajectory, paired on the same games:

| kind | sentence | trajectory | delta |
| --- | --- | --- | --- |
| `put` | 10/24 | 1/24 | **+37.5 pp** |
| `cool` | 20/21 | 19/21 | +4.8 pp |
| `heat` | 22/23 | 23/23 | −4.3 pp |
| `puttwo` | 16/17 | 17/17 | −5.9 pp |
| `clean` | 28/31 | 30/31 | −6.5 pp |
| `examine` | 16/18 | 18/18 | −11.1 pp |

Two opposite trades summing to four games. The trajectory is the **best** arm this lane has on `clean` (30/31),
`heat` (23/23), `examine` (18/18) and `puttwo` (17/17) — and the **worst** on `put` (1/24 against a control of 5).
The sentence is the opposite. The mechanism is visible in the counters rather than inferred: on `put` games the
trajectory arm spent **49.5 of its 50 steps** and **33.6 thoughts** per game with **fewer** invalid actions than
either arm (6.8 against 8.8 and 8.1), so it was not fighting the syntax — it was deliberating about an episode whose
objects are not in the room. **A verbatim trace transfers the shape of the solution and carries its nouns with it.**

**Price.** $0.3738 = **¥2.67**, against ¥3.2 quoted.

## R177 — Registered, and deliberately not bought: the lane's resolution floor

R175 and R176 have left this lane with hypotheses in the 3–6 pp band and an instrument that can see **12–13 pp** on
134 paired games. Three rows were written against that arithmetic and none of them is bought:

| # | experiment | predicted effect | why not |
| --- | --- | --- | --- |
| 1 | `always-in` over `banks/bank-repair-2.json` (620 ch: the `put` repair verbatim + the `puttwo` repair verbatim) | +1 to +3 games over the 112 arm | under the mde by 5×; whatever it reads, the answer is "indistinguishable" |
| 2 | the sentence delivered **after the first refusal** instead of before the first call | +7 games at best (the easy stratum's 84/91 against 91/91 is what it would recover) | six games short of the mde |
| 3 | the best-per-kind pack (the five kinds' best arms sum to 118) | +6 games | cherry-picked across arms, and the composition tax eats most of it |

Row 1's bank is committed anyway — `banks/bank-repair-2.json`, validated by `test_banks.py` — because the sentence it
needs has already been written and a bank that has to be written between two dispatches is a bank that is written
twice. It is labelled **built, not bought**, the same way `bank-putpair-terse-2.json` is.

**What is bought instead.** Games. The driver already accepts `--split`, the corpus publishes a second section
(`valid_seen`, 140 games) and a training section, and the three arms of R174.1/R176 on 140 more games cost ≈ ¥3.6 —
the price of one arm on 134. A 274-game join has an mde of ≈ 9 pp, and a 402-game training section would take it to
≈ 6 pp for hand-written banks only (a bank distilled from a training run cannot be evaluated on it, and the guard for
that is not written yet).

**The instrument work this requires, before any dispatch.** `--split` is not an input of `alfworld.yml`; the sweep
hardcodes `GAMES=134`, passes no split, and `aggregate.py --expect` tiles 134. A split input without a size is a
sweep whose jobs drive one section while the join expects another, so the change is one workflow input, one dispatch
flag, `--expect` read from the split's published size, and a refusal when a sweep names a split without its size.
That work is registered here rather than done because it is instrument, not hypothesis, and it must be green before
the ¥3.6 is spent.

## R177, amendment 1 — the second section is plumbed, and the arm that would have been a leak is left out

**What was built before anything is bought.** Three things about a corpus section were assumptions in code:
that `--games` could not exceed it (`min(games, num_games)` answered a request for 140 on the 134-game split
with 134 games and a full-looking rate), that a join could not cross two sections (`aggregate.py` had no
opinion), and that a bank could not be scored on the section that distilled it (nothing recorded which section
that was). All three are now refusals, and the table of sizes is held to the installed corpus by
`scripts/check_split_sizes.py` — 134, 140 and 3,553 games, counted with `find … -name game.tw-pddl` rather than
quoted (AUDIT 34.251).

**Row 1, restated as two arms.** The registered row was three arms on `valid_seen` (140 games) joining the
134 held-out games for a 274-game estimate. One of the three cannot be run there honestly: `banks/bank-rawput-1.json`
is a verbatim trajectory **from a won `valid_seen` game**, so scoring it on `valid_seen` includes the game it came
from — 1 of 140, about 0.7 pp, and inside the noise, which is exactly why it would never be noticed. It is left
out of this section rather than caveated:

| # | arm | section | games | the question | price |
| --- | --- | --- | --- | --- | --- |
| **1a** | `none` | `eval_in_distribution` | 140 | the control the pair is read against, bought in the same dispatch | ≈ ¥1.4 |
| **1b** | `always-in` over `banks/bank-putmove-1.json` (489 ch) | `eval_in_distribution` | 140 | does the one sentence that wins the held-out section also win the seen one | ≈ ¥1.4 |
| — | the verbatim trajectory | — | — | **not bought here**: its evidence is 1 of these 140 games, so the arm would be scored partly on its own source (AUDIT 34.251) | — |

**Total ≈ ¥2.8** against the ¥3.6 the three-arm version was quoted at, and the join is 274 games either way.

**The registered reading.** The sentence's held-out gain is +17.91 pp [+8.96, +26.87] (R174.1). On 274 paired
games the minimum detectable effect falls from 12–13 pp to ≈ 9 pp, so this purchase resolves differences the
134-game design cannot:

| joined reading | what it means |
| --- | --- |
| ≥ +12 pp on 274 games | the sentence's effect is larger than the held-out estimate and is a property of memory rather than of a split |
| +8 to +12 pp | consistent with R174.1 and better resolved; the headline becomes a 274-game estimate with two sections behind it |
| < +5 pp, or a seen-section gain under +8 pp | **the effect is a property of the held-out section**, which is the most important negative result this programme could produce, and it costs ¥2.8 to learn |

**Void conditions.** `carried` must be 1.0 in all 140 games and `pack chars` must be 489 in every one of them
(the field that makes a length claim checkable, AUDIT 34.249); both arms must tile 140; the join must pass
`aggregate.py --expect 274 --expect-splits eval_out_of_distribution,eval_in_distribution`. The join is pooled
**and graded**: a mixture is refused until it is declared, and once declared every episode carries the section its
parent named, so the reading prints a delta per section beside the pooled one. That grading is the pre-registered
question rather than a diagnostic — if the effect is held-out-only, the seen section reads ≈ 0 and the pooled
number is the average of an effect and a null.

## R177, amendment 2 — the sentence wins on both sections, and the two cannot be told apart

Bought as registered in amendment 1: two arms on `eval_in_distribution`, 140 games, one control in the same
dispatch. Joined to R174.1's held-out pair for the 274-game estimate the round was registered for.

| arm | section | won | rate | bill | per win |
| --- | --- | --- | --- | --- | --- |
| `none` | `eval_in_distribution` | 75/140 | 53.57% | $0.2574 (¥1.84) | $0.0034 |
| `always-in`, 489 ch | `eval_in_distribution` | **111/140** | 79.29% | $0.1801 (¥1.29) | $0.0016 |
| `none` | `eval_out_of_distribution` (R174.1) | 88/134 | 65.67% | $0.2201 (¥1.57) | $0.0025 |
| `always-in`, 489 ch (R174.1) | `eval_out_of_distribution` | **112/134** | 83.58% | $0.1506 (¥1.08) | $0.0013 |

| reading | delta | 95% CI | p | mde |
| --- | --- | --- | --- | --- |
| seen section, 140 | **+25.71 pp** | [+17.86, +34.29] | < 0.001 | 13.28 pp |
| held-out section, 134 | +17.91 pp | [+8.96, +26.87] | < 0.001 | 14.18 pp |
| **pooled, 274** | **+21.90 pp** | [+15.69, +28.10] | < 0.001 | **9.70 pp** |
| seen − held-out | +7.80 pp | [−4.63, +20.27] | 0.226 | — |

**1. The registered negative result did not happen, and the registered positive one did.** The row was written
with three outcomes, the second of which was *"< +5 pp, or a seen-section gain under +8 pp → the effect is a
property of the held-out section"*. The seen section read **+25.71 pp**, larger than the held-out section's
+17.91. A memory that only paid in the rooms it was not tuned for would have been a split artefact; this one pays
in both, and the pooled estimate is 21.90 pp against an mde of 9.70.

**2. The two sections are not distinguishable, and that is the honest form of the answer.** The difference is
+7.80 pp with an interval of [−4.63, +20.27] and p = 0.226 — a 274-game design cannot separate a seen-section
gain of 25.7 from a held-out gain of 17.9. Reporting the pooled number as if it were one population would be
wrong, and reporting the two as different would be wrong too; `by section` prints both for that reason.

**3. Why the seen section's control is nine points lower, and why it is not a defect.** `none` reads 75/140
(53.57%) there against 88/134 (65.67%) held out, and the whole difference is composition: `put` is 35 of the 140
seen games and 24 of the 134 held-out ones, and `put` is the kind no arm wins without the sentence (3/35 and
2/24). The per-kind rates agree within a point everywhere else. A pooled *rate* over the two sections is
therefore an average over two mixtures, which is the second reason the reading is graded rather than pooled.

**4. `examine` is negative on both sections, and it is the only entry the sentence does not repair.** Pooled by
kind:

| kind | sentence | control | delta |
| --- | --- | --- | --- |
| `cool` | 43/46 | 29/46 | **+30.4 pp** |
| `heat` | 38/39 | 27/39 | +28.2 pp |
| `put` | 24/59 | 8/59 | +27.1 pp |
| `puttwo` | 38/41 | 28/41 | +24.4 pp |
| `clean` | 53/58 | 40/58 | +22.4 pp |
| `examine` | 27/31 | **31/31** | **−12.9 pp** |

The control wins **every one of the 31 `examine` games** across both sections, and the sentence costs four of
them. That is not a dilution effect and not a variance artefact: it is the same sign in two dispatches on two
sections, and `examine` is the one kind with no placement step — the sentence names a `put`→`move` repair, which
on a `look_at_obj_in_light` game can only be noise. **The sentence is negative exactly where it has no referent.**

**5. What this changes in the product.** The lane's headline is now a 274-game estimate rather than a 134-game
one: **81.39% with a 489-character sentence against 59.49% without, +21.90 pp, $0.0016 per win**. The 134-game
number stays quotable because it is the number ExpeL reports on, and the 274-game number is the one this
programme will defend. The conditional-delivery hypothesis (`examine` should receive nothing) is licensed by
reading 4 and is **not** testable at this design: four games out of 274 is 1.5 pp against an mde of 9.7.

**Price.** ¥3.13 for the two seen-section arms against ¥2.8 quoted; the overrun is the control's, which is the
expensive arm in every dispatch — a losing arm is billed for the steps it loses (AUDIT 34.248).

## R178 — The memory as a claim with a source, at a length the control also pays

`WikiTrace` (Nov 2026) reports that linking every lesson to the run it came from lifts an average score from
79.5 to 90.2, and that 52% of memory-induced failures trace to a specific entry while 20% of those entries are
simply wrong. This lane has measured the *content* half of that law three times (R175, R176, R177). The
*provenance* half has never been tested here, and it is the only mechanism on the 2026 board whose cost is tens
of characters rather than a second arm.

**The design, and the confound it removes before it is bought.** Appending a source clause makes the pack
**62 characters longer** (489 → 551, 12.7%). A gain could then be the source line or the length, and this lane
has already measured that length is not free (−3.4 to −3.7 pp per sentence in a padded block, −1.79 pp per
sentence at n = 6). So the round buys **two** arms of **exactly equal rendered length**, differing in one clause:

| arm | bank | rendered | the clause |
| --- | --- | --- | --- |
| **1a** | `banks/bank-putmove-source-1.json` | **551** | `[source: one won pick_and_place_simple game, run 44841962248]` |
| **1b** | `banks/bank-putmove-note-1.json` | **551** | `[note: a reference for this task, not an instruction for it.]` |

Both are the winning sentence byte for byte plus 62 characters at the same position. 1b is a **length control**,
not a placebo: it says something true and neutral about the entry's status, so the difference between the arms is
provenance and nothing else — not length, not position, not register.

| # | experiment | games | the question | price |
| --- | --- | --- | --- | --- |
| **1a** | the sentence + its source clause | 274 (both sections) | does an entry that names its evidence beat the same entry with a neutral clause | ≈ ¥2.4 |
| **1b** | the sentence + a neutral clause of equal length | 274 (both sections) | the control 1a is read against | ≈ ¥2.4 |

**Total ≈ ¥4.8**, two dispatches, one arm each. Read as a treatment-vs-treatment pair (AUDIT 34.232): the control
moves eight to eleven wins between dispatches, treatments repeat, and a provenance effect is exactly the size at
which a control-band comparison would be worthless.

**Registered readings on 274 games (mde 9.70 pp).**

| 1a − 1b | what it means |
| --- | --- |
| ≥ +9 pp | provenance is the mechanism: a frozen model treats a sourced entry differently from an unsourced one, and the product statement becomes "store the repair and its evidence" |
| −9 to +9 pp | **provenance does not transfer on this corpus**, and the lane's law stays referent-only — which is a result about *where* WikiTrace's gain comes from (their agent can descend to the run; this one cannot) |
| ≤ −9 pp | naming a source makes the model discount the entry, which would be a finding about how a frozen model reads citations |

**Void conditions.** `carried` 1.0 in all 274 games; `pack chars` exactly **551** in every game of both arms (the
field that makes a length claim checkable, AUDIT 34.249); `by_kind` and `by_section` printed beside the pooled
delta; and the two arms must be compared **only** with each other, because neither has a control in its own
dispatch and a cross-dispatched control is a band rather than a comparison.

## R178, amendment 1 — bought, and provenance is the half that does not transfer

Two dispatches per section, one arm each, read against each other and against the sentence arm they extend.
`carried` is 1.0 in all 274 games of both arms and `pack chars` is exactly **551** in every game of both, so the
length claim holds per game rather than on average; the two arms differ in one 62-character clause and in nothing
else, which `test_banks.py::ProvenancePairTest` holds to **equality** rather than the 5% tolerance every earlier
length claim in this lane used.

| arm | bank | rendered | seen, 140 | held out, 134 | pooled, 274 | bill |
| --- | --- | --- | --- | --- | --- | --- |
| the sentence | `bank-putmove-1.json` | 489 | 111 | 112 | **223 (81.39%)** | $0.3308 (¥2.37) |
| **1b** the neutral clause | `bank-putmove-note-1.json` | **551** | 111 | 111 | **222 (81.02%)** | $0.3273 (¥2.34) |
| **1a** the source clause | `bank-putmove-source-1.json` | **551** | 105 | 107 | **212 (77.37%)** | $0.3391 (¥2.43) |

Three pairings, all treatment against treatment on the same 274 games (AUDIT 34.232), each read from one command:

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| 1b − the sentence (the length half) | −0.36 pp | [−4.74, +4.01] | 0.920 | 37 | 6.22 pp |
| 1a − the sentence (length and provenance) | −4.01 pp | [−9.12, +0.73] | 0.127 | 47 | 7.01 pp |
| **1a − 1b (provenance alone)** | **−3.65 pp** | **[−8.39, +1.09]** | 0.151 | 42 | **6.63 pp** |

**The registered reading landed in the second band.** `−9 to +9 pp` was written as *provenance does not transfer on
this corpus, and the lane's law stays referent-only*. That is the reading: an entry that names a run in which it won
is worth **3.65 pp less** than the same entry with a neutral clause of the same length, and the point estimate is
negative in both sections on their own (−4.29 seen, −2.99 held out).

**What the round retires, and it is worth more than the −3.65.** The length half is **free**: +62 characters on one
entry, 12.7% longer prefix, `−0.36 pp [−4.74, +4.01]`. R174.2 measured the tax per *entry* (−3.4 to −3.7 pp per
sentence in a padded block) and three rounds of this lane's budget have been quoted as if the tax were per
character. It is not: an entry can be made 12.7% longer for nothing, and the unit that costs is the entry. That is
also why 1b is the right control rather than a padding arm — the padding arms paid because they added **entries**.

**The clause is read, and this is the difference between a null and a delivery failure.** Engagement was
**152/274 = 55.5%** of games changed course — a 62-character suffix moved the action trajectory in more than half
the corpus, and it hurt 26 of those against 16 helped. So the reading is not "the model ignored the text": a frozen
model does respond to a citation, and the response is *net negative*. That is a sharper statement than the
registered band, and it is the one WikiTrace's 20%-wrong-entries result predicts from the other side.

**Where the loss sits.** On the games the control wins: **196/222 against 222/222 (−11.71 pp)**, while on the 52 the
control loses the source arm wins 16. `put` carries 19 of the 42 discordant pairs, net −5 games on 59, and that kind
alone has an mde of 20.8 pp, so it is reported as a shape rather than a finding — the entry's referent is `put`, and
`put` is where the citation costs most, but the kind cannot carry a claim at 59 games.

**The instrument result, which changes what a round costs.** Pairing two treatments halved the discordance
(90 → 42 pairs) and took the mde from **9.70 pp to 6.63 pp at the same 274 games**, for one arm's price. R177
registered a training-section subset at **¥10–50** to reach ≈ 6 pp. This round reached it for **¥2.4**. The row is
retired: resolution is bought with a matched arm, not with more games.

**Spend: ¥4.77 against ¥4.8 quoted** ($0.3391 + $0.3273, 13,512 model calls).

## R178, amendment 2 — the citation names a run the entry won in, not the run it came from

Nothing about the reading changes; the *bank's own metadata* was wrong and is corrected rather than left as a
sentence somebody would later quote. The sentence is entry 4 of `banks/bank-44754440122.json`, distilled from run
**44754440122**. The clause appended to it cites run **44841962248** — the R174.1 held-out dispatch, where the entry
won 10 of its 24 `pick_and_place_simple` games (which is the entry's `votes`). Both statements are true and they are
not the same statement; the file said "the run it came from", which was false.

The correction is in the bank (`cited_run`, `distilled_from_run`, and a `kind` that says *won*), and it is guarded:
`test_the_citation_is_the_run_the_metadata_names` fails if the clause and `cited_run` ever disagree, and
`test_the_treatment_names_a_run_and_the_control_names_no_number` fails if the control gains a digit. AUDIT 34.254.

What the arm therefore measures is **"an entry that names evidence of its own success"**, which is what WikiTrace
links; the strict reading — an entry that names the run it was distilled from — is a different arm and is registered
below rather than conflated with this one.

## R179 — What a citation that cannot be checked is worth, at the same 551 characters

R178 established two things about a citation in this harness: it is **read** (55.5% of trajectories change) and it
does **not** pay (−3.65 pp). WikiTrace's other half is the failure mode: **20% of memory-induced failures trace to
entries that are simply wrong**. This lane has tested a wrong *referent* (R175: five descriptions cost 8.96 pp) and
has never tested a wrong *citation* — and it is one arm away, at the length the last round already paid for.

| # | arm | bank | rendered | games | the question | price |
| --- | --- | --- | --- | --- | --- | --- |
| **1a** | the sentence + a citation of a run that does not exist | `banks/bank-putmove-ghost-1.json` | **551** | 274 (both sections) | does a claim the model cannot check still move it | ≈ ¥2.4 |
| 1b | *(already bought)* the sentence + a citation of a run in which it won | `bank-putmove-source-1.json` | 551 | 274 | R178 1a | spent |
| 1c | *(already bought)* the sentence + a neutral clause | `bank-putmove-note-1.json` | 551 | 274 | R178 1b | spent |

The clause is `[source: one won pick_and_place_simple game, run 44800000000]` — the same 62 characters, the same
position, and an eleven-digit run id that no artefact carries. The variant a product would actually ship, *a real
run that never carried this entry*, is the **same arm at the model's level**: a frozen model reading a prefix cannot
tell the two apart, so one arm covers both and the second is not bought.

**Registered readings on 274 games (mde ≈ 6.6 pp, from R178's discordance).**

| 1a − 1b | what it means |
| --- | --- |
| ≤ −9 pp | a false citation is *read and penalised*, which would mean the model treats a source line as a claim it evaluates — the first evidence in this lane that a pack's text can be wrong rather than merely irrelevant |
| −9 to +9 pp | **citations are inert as text**: the model neither checks nor acts on them, R178's −3.65 pp is the whole of the effect, and WikiTrace's 79.5 → 90.2 must come from the **descent** (their agent can open the run) rather than from the line |
| ≥ +9 pp | a fabricated source is *better* than a true one — no mechanism predicts it, and it would invalidate the R178 arm's interpretation rather than extend it |

**Void conditions.** `carried` 1.0 in all 274 games; `pack chars` exactly **551** in every game; the arm is compared
**only** with 1b and 1c, both of which are already in the record; `by_kind` and `by_section` printed beside the
pooled delta; and the bank declares in `source.note` that its citation is false by construction, because a bank that
looks like a mistake in the tree is a bank somebody will eventually "fix".

## R179, amendment 1 — a fabricated citation is worth what a true one is worth

One arm, both sections, 274 games, 551 rendered characters: the same 62-character clause with an eleven-digit run
id no artefact carries. Read against the two arms R178 already bought.

| arm | the clause | seen, 140 | held out, 134 | pooled | bill |
| --- | --- | --- | --- | --- | --- |
| the sentence | *(none)* | 111 | 112 | **223 (81.39%)** | $0.3308 |
| the neutral clause | `[note: a reference for this task, not an instruction for it.]` | 111 | 111 | **222 (81.02%)** | $0.3273 |
| **the fabricated citation** | `[source: … run 44800000000]` | 106 | 112 | **218 (79.56%)** | $0.3283 (¥2.35) |
| the true citation | `[source: … run 44841962248]` | 105 | 107 | **212 (77.37%)** | $0.3391 |

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| **the fabricated citation − the true citation** | **+2.19 pp** | **[−1.82, +6.20]** | 0.363 | 34 | **5.96 pp** |
| the fabricated citation − the neutral clause | −1.46 pp | [−5.84, +2.92] | 0.566 | 36 | 6.14 pp |
| the fabricated citation − the sentence | −1.82 pp | [−6.20, +2.55] | 0.458 | 37 | 6.22 pp |

**The registered band is the middle one, and it is the informative one.** `−9 to +9 pp` was written as *citations are
inert as text: the model neither checks nor acts on them, and WikiTrace's 79.5 → 90.2 must come from the descent.* A
citation whose referent **does not exist** is worth **+2.19 pp** against one whose referent does — inside the noise,
with an interval that excludes any effect larger than 6.2 pp in either direction.

**Second reading, which the registration did not ask for and the four arms give for free.** Both citations sit below
the neutral clause (−1.46 and −3.65) and the two are indistinguishable from each other, so what R178 measured is a
**form** effect and not a **truth** effect: a bracketed claim about a run costs a little, and whether the run exists
does not matter to a frozen model. That is the same statement as "inert", read from the other side, and it is why the
product conclusion is that the evidence link belongs in the artefact the lane reads rather than in the prompt the
model reads.

**Void conditions honoured.** `carried` 1.0 in all 274 games; `pack chars` exactly 551 in every game; read only
against the two arms named above; `by_kind` and `by_section` printed (no kind moves beyond its own floor: the largest
is `put` at −8.47 pp on 19 discordant pairs, and `put`'s own mde is 20.8 pp).

**Spend: ¥2.35 against ¥2.4 quoted.** R178 and R179 together bought **three** arms — the neutral clause, the true
citation and the fabricated one — for **¥7.12** against ¥7.2 quoted, over 20,134 model calls across four dispatches;
the sentence arm they are all read against was bought in R174.1 and R177.

## R180 — Which half of the sentence pays: the phrasing swap, or the receptacle and the container check

The one sentence this lane has measured four times is two operations, not one:

> *(1)* try the alternative phrasing `"move <object> to <receptacle>"`; *(2)* if that also fails, try a different
> valid receptacle of the same type, and if the receptacle is a container, ensure it is open first.

The per-kind rows say operation (2) is the plausible carrier — the kinds the sentence helps most are the ones that
end in a container (`clean` +22.4, `cool` +30.4, `heat` +28.2 on 274 games), and the kind it cannot help is `examine`,
which has no placement step at all. That has never been tested as a clause, and it is exactly one arm away: keep (1)
byte for byte, remove (2), pad to the same 551 characters.

| # | arm | bank | rendered | games | the question | price |
| --- | --- | --- | --- | --- | --- | --- |
| **1a** | the sentence with its second operation ablated | `banks/bank-putmove-phrase-1.json` | **551** | 274 (both sections) | is the +21.90 the phrasing swap or the receptacle knowledge | ≈ ¥2.4 |
| 1b | *(spent)* the full sentence + a neutral clause | `bank-putmove-note-1.json` | 551 | 274 | R178 1b | ¥2.34 |

**Registered readings on 274 games (mde ≈ 6.0 pp).**

| 1a − 1b | what it means |
| --- | --- |
| ≤ −9 pp | **the second operation is the mechanism**: the receptacle choice and the container check are what transfers, the phrasing swap is not, and the product statement becomes "store the operation the step is blocked on" |
| −9 to +9 pp | **the phrasing swap carries it**, operation (2) is decoration, and the −8.96 pp R175 measured for five added sentences becomes the cost of stating more than one thing |
| ≥ +9 pp | removing instruction makes the entry *better* — Anti-Persistence's reading arriving through an ablation, and the first positive result that paper would predict here |

**Void conditions.** `carried` 1.0 in all 274 games; `pack chars` exactly **551** in every game of both arms; the
ablated arm keeps the first operation byte for byte and contains neither "different valid receptacle" nor "ensure it
is open"; the filler carries no digit and names no step; `by_kind` printed beside the pooled delta, because the
prediction is a *per-kind* one (`clean`/`cool`/`heat` should fall and `examine` should not) and a pooled number that
lands in the middle band would hide exactly the pattern that matters.


## R180, amendment 1 — bought, and operation (2) is decoration

Two dispatches, one arm each, 274 games, read against R178 1b (`bank-putmove-note-1.json`) — which is the
sentence with a neutral clause in place of the provenance, so the pairing isolates the half of the sentence the
round was registered about.

`carried` is 1.0 in all 274 games of both arms, `pack chars` is exactly **551** in every one of them, the ablated
entry keeps the first operation byte for byte, and neither "different valid receptacle" nor "ensure it is open"
appears in it. The filler carries no digit and names no step. The registered void conditions all hold.

| arm | bank | rendered | seen, 140 | held out, 134 | pooled, 274 | bill |
| --- | --- | --- | --- | --- | --- | --- |
| **1a** operation (1) only | `bank-putmove-phrase-1.json` | **551** | 108 | 112 | **220 (80.29%)** | $0.3224 (¥2.31) |
| 1b *(spent)* the whole sentence + neutral clause | `bank-putmove-note-1.json` | 551 | 111 | 111 | **222 (81.02%)** | R178 |

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| **1a − 1b** | **−0.73 pp** | **[−4.74, +3.28]** | 0.800 | 30 (14 + 16) | **5.60 pp** |

**The registered reading landed in the second band**: `−9 to +9 pp` was written as *the phrasing swap carries it
and operation (2) is decoration*. That is the reading. The receptacle choice and the container check — 135
characters, more than a third of the sentence — are worth **less than one win in 274**.

**The per-kind prediction is refuted, and in the direction that matters.** The round registered that
`clean`/`cool`/`heat` should *fall* when the container check is removed, because they are the kinds whose last
step ends in a container. They did not fall: `clean` +3.4 pp, `cool` +4.3 pp, `heat` 0.0, `puttwo` 0.0, while
`put` itself fell 6.8 pp and `examine` 6.5 pp. Every cell is four games or fewer, so the shape is reported as a
shape; but it is the opposite shape to the one a container-check mechanism predicts, and it is the second
independent reason to read operation (2) as decoration rather than as knowledge.

**The five-arm family, on one command.** R178, R179 and R180 between them bought five renderings of one
sentence at 274 games each. Joined against the same anchor, they are one table:

| arm | rendered | pooled, 274 | vs 1b (note) | 95% CI | p |
| --- | --- | --- | --- | --- | --- |
| the sentence alone | 489 | **223 (81.39%)** | +0.36 pp | [−4.01, +4.74] | 0.920 |
| **1b** + a neutral clause | **551** | **222 (81.02%)** | — | — | — |
| R180 1a operation (1) only | **551** | 220 (80.29%) | −0.73 pp | [−4.74, +3.28] | 0.800 |
| R179 1a a false citation | **551** | 218 (79.56%) | −1.46 pp | [−5.84, +2.92] | 0.566 |
| R178 1a a true citation | **551** | 212 (77.37%) | −3.65 pp | [−8.39, +1.09] | 0.151 |

Eleven games and 4.0 pp separate the best from the worst, every interval covers zero, and no pair in the family
is resolved at this `n`. That is a stronger statement than any single row: **at a fixed 551 characters and a fixed
position, what the entry says beyond its first operation does not move the score**, and the three mechanisms this
lane has spent R177–R179 on — provenance, verification, and the second operation — are all inside that band.

**The engagement instrument is confounded, and this is the round that shows it.** The lane has been reading
`engagement` as the difference between a null and a delivery failure: R178 reported 152/274 = 55.5% of trajectories
changed by the citation and concluded the clause *is read*. R180's single-clause swap at identical length changes
**146/274 = 53.3%**, and R178's own length control changes **154/274 = 56.2%** — a neutral sentence that says the
entry is only a reference moves more trajectories than the citation does. So 55% is not a reading of the citation;
it is what one clause costs in trajectory noise, and the three quantities are within three games of each other.
AUDIT 34.258 records the correction: engagement measures how close these games are to a decision boundary, not
whether the model read the entry.

**Where the eleven games move, and the pattern is the same in all four variants.** Every 551-character arm trades
the easy games for the hard ones: on the 52 games the anchor loses, the sentence wins 19, the citation 16, the
false citation 16, and the ablated arm 14 (+26.9 to +36.5 pp), while on the 222 it wins it loses 8 to 26 (−7.2 to
−11.7 pp). The total is a wash. That is what a cheap reshuffle of a frozen model's trajectory looks like, and it is
the third independent reason to read the whole family as noise around one number rather than as five mechanisms.

**Spend: ¥2.31 against ¥2.4 quoted** ($0.3224, 13,281 calls). R178–R180 together bought **five** arms for
**¥9.43** and 33,324 calls.

## R181 — The 62 characters were not the bug: a command under a thought was refused, and the model was told `OK.`

R178–R180 spent ¥9.43 ablating one clause of one entry and found a 4.0 pp band with nothing in it. The train
transcripts say why the lane could not see anything: **the driver was silently discarding the model's commands.**

`parse_reply` is the competitor's parser, transliterated, and it is `re.match` — anchored at the first line. A reply
that opens with `> think:` is a thought, whatever follows it. The competitor's own few-shot transcripts write
think-then-act in one turn (`react_put_0`: `> think: Now I find a spraybottle (2). Next, I need to take it.` then
`> take spraybottle 2 from cabinet 2`), so the model was taught a format whose second line the driver drops.

What the driver then answered is the defect. The reference implementation steps its environment with `N/A` and hands
the model back the environment's own `Nothing happens.`; this driver appended `OK.` — the examples' token for a
thought that was *only* a thought. The model read its own `> put …` followed by `OK.`, concluded the put had
executed, and wrote "The task is complete" until the budget ran out.

Measured on the 245 train games already in this workspace (transcripts are recorded on the training pass, so this
cost nothing): **1,070 commands were dropped, in 72 of the 72 `put` games** — 14.9 per game — and in 30 of the other
173 games across all five other kinds. `put` is the only kind destroyed because it is the only kind where the model
hedges before acting, and it is the only kind that runs near the 50-turn cap (wins 31.7–35.9 turns, losses 50).
The mean trailing run of `think:` lines in a lost `put` game is **9.7** turns, and 24 of them are pure
"the task is complete" loops.

**What changed.** Three things, none of them the parser:

1. a non-action turn that carried a command is answered with `NO_OP = "Nothing happens."` — the corpus's own
   wording for a command that changed nothing — instead of `OK.`;
2. `refused_actions` and `refused_samples` (up to 3) enter the episode record, so the drop is visible in an arm file
   for the first time;
3. `aggregate.py` prints `dropped <arm> n (x per call)` beside `refusals`, and prints `not counted` for a file
   written before the field existed, because a zero there would mean "never counted" and not "never happened".

| # | arm | bank | rendered | games | the question | price |
| --- | --- | --- | --- | --- | --- | --- |
| **1a** | `none` | — | 0 | 274 | what the corpus does unaided, on a driver that does not lie about a refused turn | ≈ ¥2.35 |
| **1b** | `always-in` | `banks/bank-putmove-note-1.json` | **551** | 274 | the same question for the entry the family is anchored on | ≈ ¥2.35 |

Read **within** the dispatch as a matched pair (the memory effect on a repaired driver), and **across** the
dispatch against the pre-repair pair (R178's 163 and 222) as a band, because a control moves eight to eleven wins
between dispatches and a driver change moves it by design.

**Registered readings on 274 games.**

| quantity | prediction |
| --- | --- |
| `refused_actions` per `put` game, both arms | **8 to 20** — the field has to reproduce the 14.9 the transcripts show, or it is counting something else |
| `refused_actions` on the other five kinds | < 1 per game pooled; a count there would mean the detector is reading prose as commands |
| `put` wins, each arm | **+6 to +22 pp** against the pre-repair arm of the same name (pre-repair: control ≈ 10%, note 35.6%) |
| pooled delta of the repair, `none` | **+4 to +18 pp** (163/274 → 167–212) |
| pooled delta of the repair, `always-in` @ note | **+1 to +12 pp** (222/274 → 225–255) |
| `by_kind` on the repair | the movement is **in `put` and nowhere else**: |Δ| ≤ 5 pp on all five other kinds, which is the mechanism claim — refused turns are concentrated where the model hesitates |
| the memory contrast after the repair (1b − 1a) | **+2 to +18 pp**, i.e. narrower than the +21.90 the pre-repair pair reported, because part of that number was the treatment suppressing this defect |

**Refutation.**

* `put` wins do not move in either arm while `refused_actions` reads 8–20 per game. Then the false acknowledgement
  is not what kept `put` down, the completion-loop reading is wrong, and the `put` deficit is a search-order or
  budget problem — the next round is an entry about order, not about termination.
* `refused_actions` reads 0–2 per `put` game. Then the detector is not seeing what the transcripts show,
  `refused_command` is reading a different string than the model wrote, and every number in this round is about
  a defect that is still there.
* `put` moves on one arm and not the other. Then the repair interacts with the entry, and the reading is a
  treatment-by-driver interaction rather than a repair.
* Any other kind moves by more than 5 pp. Then the repair is not specific to refused turns, and the mechanism claim
  is withdrawn rather than reinterpreted.

**Void conditions.** `pack chars` exactly 551 in every game of 1b and 0 in every game of 1a; `carried` 1.0 in all
274 games of 1b; `refused_actions` present in every episode of both arms; the bank byte-identical to R178 1b's,
`sha256 95f8c634f0604209677afa219cee360c117332200084321c490d69a4c1337050`, so that the anchor this round re-reads
is the anchor R178 bought; both sections tiled to 274 under `--expect 274`.

**Cost.** Two dispatches, two arms each — §4.70, and it is the last round that has to pay for the control: every
round after it can be read against 1a.

## R181, amendment 1 — bought, and the false acknowledgement was not what kept `put` down

Two dispatches, two arms each, 274 games per arm. `pack chars` is exactly 551 in every one of the 274 games of the
treatment and 0 in every one of the control; `carried` is 1.0 versus 0.0; `refused_actions` is present in all 548
episodes. The anchor bank is byte-identical to R178 1b's (`sha256 95f8c634…`), which `test_banks.py::RepairAnchorTest`
holds. Every void condition holds.

| arm | seen, 140 | held out, 134 | pooled, 274 | bill |
| --- | --- | --- | --- | --- |
| `always-in` @ the anchor | 113 | **114** | **227 (82.85%)** | $0.3139 (¥2.24) |
| `none` | 69 | 81 | 150 (54.74%) | $0.5061 (¥3.62) |

**Two readings, and they are different questions.**

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| the anchor − `none`, both post-repair (a matched pair) | **+28.10 pp** | [+22.26, +33.58] | < 0.001 | 85 | 9.43 pp |
| the anchor post − the anchor pre (the repair, same bank) | **+1.82 pp** | [−2.55, +6.20] | 0.453 | 37 | 6.22 pp |

### The registered reading: two of six predictions held and the refusal clause fired

| registered | read | verdict |
| --- | --- | --- |
| `refused_actions` **8–20 per `put` game** | **11.64** (treatment), **10.53** (control) | held — the field reproduces what the transcripts said |
| `< 1 per game` on the other five kinds | 0.00 to 0.07 | held |
| `put` wins **+6 to +22 pp** on each arm | **−1.69 pp** (20/59 against 21/59); control 4/59 | **refuted** |
| repair's pooled delta, `none` **+4 to +18 pp** | **−13 games** (163 → 150) | **refuted** |
| repair's pooled delta, the anchor **+1 to +12 pp** | +5 games, **+1.82 pp** | held, at the bottom of the band |
| movement **in `put` and nowhere else** | `put` −1.69, `cool` +8.70 (four games), the rest within 5 pp | refuted as written; the exception is four games at an mde of 17 pp |

**The pre-registered refutation clause is the reading.** It said: *if `put` does not move while `refused_actions` reads
8–20 per game, the false acknowledgement is not what kept `put` down, the completion-loop reading is wrong, and the
`put` deficit is a search-order or budget problem.* That is exactly what the numbers say. The counter confirms the
drop is happening at the rate the transcripts showed, `put` does not move, and the repair's own delta on the same bank
is +1.82 pp — inside the null band at an mde of 6.22.

**Why, and it is visible in the turn arithmetic rather than in a transcript.** A winning `put` game costs **26.6
turns** with 7.2 thoughts and 2.2 refusals. A losing one costs **50 turns, 32.0 of them thoughts, with 16.5 commands
refused**. So a loss is not a long search: it is thirty turns of alternating *thought, refused command, `Nothing
happens.`* — and the model writes the same shape on the next turn. It does not adapt. Removing the false `OK.` did not
change the format, so it changed nothing; the model's belief was never the binding constraint, the format is.

**What this does not say.** It does not say the acknowledgement should go back to `OK.` — a driver that tells a model
its dropped command succeeded is a driver whose transcripts cannot be trusted, and the counter it bought is what made
this round readable. It does not say the repair helped: +1.82 pp on the same bank is the sample moving, not the
treatment. And it does not touch the family's earlier nulls, which were measured on the pre-repair driver with both
arms paying the same defect.

**Spend: ¥5.86 against ¥4.70 quoted** ($0.8200, 16,071 calls, two dispatches). The estimate assumed four shards an
arm at the single-arm price; a two-arm sweep runs eight per section. The join's own `bill` line reads $1.1473 over
22,769 calls because it includes the pre-repair anchor arm (R178's ¥2.34), which was bought then and is not money
this round spent — and the control is the dearer arm here ($0.5061 against $0.3139) because a lost game bills every
one of its fifty turns: being wrong is what makes calls.

## R182 — The format is the binding constraint, so the dead operation's slot gets the live one

R180 measured operation (2) — the receptacle choice and the container check, 197 characters of the entry's tail — as
**−0.73 pp [−4.74, +3.28]** at an identical 551 characters. R181 measured the refusal counter at **16.5 per lost `put`
game** and `put` at **−1.69 pp** when the false acknowledgement was removed. Together they say the tail is free real
estate and the format is what costs the turn, so this round writes the format into the tail.

The arm is `bank-putmove-line-1.json`: the first operation verbatim (157 characters), then **197 characters** stating
that a command must stand alone on its line, because a command written under a thought is read as part of the thought
and never reaches the world. Rendered, it is **551** — the same length, the same one entry, and character-for-character
identical to R180's ablated arm except in those 197 characters.

| # | arm | bank | rendered | games | the question | price |
| --- | --- | --- | --- | --- | --- | --- |
| **1a** | `always-in` | `banks/bank-putmove-line-1.json` | **551** | 274 (both sections) | does an entry that names the format stop the refusal | **dispatched** ≈ ¥2.35 |
| 1b | *(spent)* operation (1) only, neutral tail | `bank-putmove-phrase-1.json` | 551 | 274 | R180 1a | spent |
| 1c | *(spent)* operation (1) only, the same tail | — | — | — | R181 post-repair `none` is the control for 1a's absolute level | spent |

**Registered readings on 274 games (mde ≈ 6.0 pp).**

| quantity | prediction |
| --- | --- |
| `refused_actions` per `put` game | **below 5**, from 11.64 — the entry has to move the counter, or it did not reach the behaviour |
| `put` wins | **+6 to +20 pp** against R180 1a's 17/59, i.e. 21 to 29 of 59 |
| pooled | **+3 to +12 pp** against R180 1a's 220/274 |
| the other five kinds | \|Δ\| ≤ 5 pp, because the entry's referent is a format and not a task |
| `pack chars` | exactly 551 in every game, and the same 157-character head as R180 1a |

**Refutation.**

* `refused_actions` stays above 8 per `put` game. Then a prompt-level entry cannot change the format the few-shot
  examples teach, and the lane's product claim narrows to *content* lessons — the honest next step is the parser
  question (execute a command the first line refused) registered as a separate channel, not as a memory arm.
* `refused_actions` falls but `put` does not move. Then the refusals were a symptom rather than the cost, the `put`
  deficit is exploration depth, and the next round is an entry about where the object is — which R177's per-kind rows
  already predict will be negative.
* `put` falls. Then the entry's second half is being read as a replacement for the first, and the round is a
  length-within-entry result rather than a format one.

**Void conditions.** `pack chars` exactly **551** in every game; the head is byte-identical to `bank-putmove-phrase-1.json`
for its first 157 characters and the two differ only in the 197-character tail; the tail carries no digit and names no
object; `by_kind` printed beside the pooled delta; both sections tiled to 274; the control for the absolute level is
R181's post-repair `none`, and the comparison for the mechanism is R180 1a.

**Cost.** One dispatch, one arm, both sections — **≈ ¥2.35**, and the last round that can be read against a control it
did not buy.

## R182, amendment 1 — bought, and the format entry pays a little without stopping the format

One dispatch per section, one arm, 274 games; `pack chars` exactly 551 in every game; the entry keeps the first
operation's 157 characters and differs from R180 1a only in its 197-character tail. Every void condition holds.

| arm | seen, 140 | held out, 134 | pooled, 274 | bill |
| --- | --- | --- | --- | --- |
| **1a** operation (1) + the format operation | **115** | **115** | **230 (83.94%)** | $0.3106 (¥2.22) |

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| 1a − R180 1a (the registered comparison) | **+3.65 pp** | [−1.09, +8.39] | 0.146 | 44 | **6.78 pp** |
| 1a − R181's post-repair `none` (the absolute level) | **+29.20 pp** | [+23.36, +35.04] | < 0.001 | 90 | 9.70 pp |
| 1a − R181's post-repair anchor (two 551-character entries) | +1.09 pp | [−3.28, +5.47] | 0.668 | 37 | 6.22 pp |

**Predictions: two held, one failed, and the failure is the informative one.**

| registered | read | verdict |
| --- | --- | --- |
| `refused_actions` below **5** per `put` game | **9.90** | **failed** — the entry did not stop the format |
| `put` **21 to 29 of 59** (+6 to +20 pp) | **24/59, +11.86 pp** | held |
| pooled **+3 to +12 pp** | **+3.65 pp** | held, and inside its own mde |
| \|Δ\| ≤ 5 pp on the other five kinds | `examine` +12.90 (4 games), `heat` −5.13, rest ≤ 3.45 | refuted as written |

**What the failure means.** The entry cut refusals from 11.64 to **9.90** per `put` game — 15% of them — and put
gained seven games. But a model that had *understood* the entry would write no thought-and-command replies at all, and
the count would be near zero. It is not: the format is largely intact, so what moved is the marginal turn rather than
the shape. That is a smaller mechanism than the one registered, and the honest reading of `put`'s +11.86 pp is
**unresolved**: 59 games at this discordance have an mde of 19 pp, so +11.86 is a point estimate inside its own floor.

**The level is a new high, and it is inside the noise.** 230/274 (83.94%) and **115/134 = 85.82%** are the best numbers
this lane has read, three games above R181's 227 on a different entry at the same length. Three games at an mde of 6.22
is nothing, and it is reported as nothing; what the round establishes is a second 274-game observation of the same
neighbourhood, which is what the family now has six of.

**Where the headroom still is.** `put` is 59 of 274 games and reads 24 wins — **40.7%** — while every other kind is
between 88 and 100%. The control's `put` is 4 of 59. So the remaining 15 points of the corpus live almost entirely in
one kind whose failures are, by the counter's own testimony, a format the few-shot examples teach and a prompt-level
entry moves by 15%.

**Spend: ¥2.22 against ¥2.35 quoted** ($0.3106, 6,177 calls), two dispatches, one arm each.

## R183 — The parser channel: the one intervention that is not a prompt

Two rounds tried to reach the turn the model spends on a command that never runs. R180 filled the dead 197 characters
with a neutral sentence and read **−0.73 pp**; R182 filled them with the format operation itself and read **+3.65 pp**
with `refused_actions` falling from **11.64 to 9.90** per `put` game — **15%** of the behaviour. Eleven rounds of
renderings of one sentence now span **212 to 230** games, no adjacent pair resolved, and `put` is still **24 of 59**
against 91 to 100 per cent on the other five kinds.

So the next intervention is not a sentence. **The command is already in the reply.** The reference parser finds it —
`refused_command` returns it, and 618 of them were counted in R182's 274 games — and then throws it away, because
`re.match` anchors at the first line and the corpus's own `react_put_0` example writes *thought, command* in one turn.
R183 executes it instead.

**Why this is a channel and not an arm.** Every number this lane has published was measured on the reference parser,
and the competitor's rows were measured on the same one. Changing the reader changes the harness under both arms at
once, so the round buys **both arms on the second reader** and states the divergence in the same sentence as the
result. What it does *not* do is re-read anything: `parse_reply` is untouched, `refused_command` is untouched, and the
only change is what happens to a command the rule already found and refused.

**The two counters are the instrument.** `refused_actions` counts a command the first-line rule dropped;
`recovered_actions` counts one it would have dropped and the channel executed instead. One reply is one event counted
on whichever side of the parser it fell, so the two channels can be shown to have driven the same model behaviour
rather than a repaired model — which is the difference between measuring the harness and measuring a prompt.

| # | arm | bank | channel | rendered | games | the question | price |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1a** | `always-in` | `banks/bank-putmove-line-1.json` | `any-line` | 551 | 274 (both sections) | what is the memory worth when the format no longer costs the turn | ≈ ¥2.60 |
| **1b** | `none` | — | `any-line` | 0 | 274 (both sections) | the same question with nothing to carry | ≈ ¥3.30 |
| 1c | *(spent)* | `bank-putmove-line-1.json` | `reference` | 551 | 274 | R182: 230/274, `put` 24/59 | spent |
| 1d | *(spent)* | — | `reference` | 0 | 274 | R181: 150/274, `put` 4/59 | spent |

**Registered readings on 274 games.** The primary quantity is the third row: the pair that says whether the memory
effect this lane has been quoting is content or a workaround.

| quantity | prediction |
| --- | --- |
| `refused_actions`, both arms, both sections | **0**, by construction — nothing is dropped on this channel |
| `recovered_actions` per `put` game, `always-in@anyline` | **8 to 15**, i.e. within ±30% of the 11.64 the reference channel dropped: the format is the model's, and a reader that executes it does not change it |
| `recovered_actions` per `put` game, `none@anyline` | **7 to 14**, against the 10.53 R181's control read |
| `put`, `always-in@anyline` − `always-in` reference | **+15 to +35 pp** (24/59 → 33 to 45 of 59) |
| `put`, `none@anyline` − `none` reference | **+20 to +50 pp** (4/59 → 16 to 34 of 59) |
| pooled, `always-in@anyline` − reference 230/274 | **+3 to +8 pp**: `put` is 59 of 274, so +15 to +35 pp on it is +3.2 to +7.5 pooled |
| pooled, `none@anyline` − reference 150/274 | **+8 to +25 pp** |
| **the memory effect on the second channel** | **+10 to +25 pp**, i.e. *below* the +29.20 pp the same pair reads on the reference channel |
| the other five kinds, both arms | \|Δ\| ≤ 5 pp — they carry 0.00 to 0.07 refusals per game, so a move there is a defect |
| `pack chars`, `always-in@anyline` | exactly 551 in every game, head identical to R182's bank |

**The mechanism prediction, stated so it can fail.** R182's format entry recovered 15% of the refusals and bought
+3.65 pp; extrapolated, the +29.20 pp the memory is worth on the reference channel is **at least partly a workaround**
— an entry that tells the model how to write around a reader that drops its command. If that is the mechanism, the
entry's value falls when the format stops costing a turn, and the band above says how far. If the memory effect stays
at +29 pp on a channel where the format costs nothing, then the entry was doing something the format was not, the
workaround reading is refuted, and what the bank carries is procedure rather than syntax.

**Refutation.**

* `recovered_actions` per `put` game reads below 8 on either arm. Then the two channels met different model behaviour —
  a reader that executes a command changes what the model writes next, which is the one thing this round's comparison
  assumes does not happen — and the round is a second experiment rather than a re-read of the first: the cross-channel
  rows become descriptive and the within-channel memory pair (+10 to +25 pp) is the only registered reading that
  survives.
* `put` moves but pooled does not (below +3 pp on `always-in@anyline`). Then the gains are being paid for elsewhere —
  five kinds at 91 to 100 per cent have five points of room between them and `put` has fifty-nine — and the round
  refutes the accounting in R182's "where the headroom is" paragraph rather than the mechanism.
* The memory effect on the second channel reads **at or above +29.20 pp** (i.e. the entry loses nothing when the format
  is fixed). Then the third row is refuted and the product statement is the entry, not the harness: R183 is the last
  round that buys a channel, and the lane's remaining work is content.
* `put` *falls* on the second channel. Then the dropped command was load-bearing — a model whose first intent is
  executed on every turn explores worse than one whose intent is refused — and the direction of the whole diagnosis is
  wrong, which the counter cannot explain and a transcript round would have to.

**Void conditions.** `parser` is `any-line` in the header and in all 274 episodes of both arms; `arm_label` is
`always-in@anyline` and `none@anyline`; `refused_actions` is 0 in every episode of both arms; `pack chars` exactly
**551** in every game of 1a and **0** in every game of 1b; the bank is byte-identical to R182's; both sections tiled to
274; every cross-channel reading is joined with `--expect-parsers reference,any-line` — `aggregate.py` refuses the span
without it, and refuses one label spanning both channels at all.

**What this round cannot say.** It cannot say what the competitor would score on this channel, because no published
row was measured on it: the numbers are this lane's own, on a reader it built. It cannot say whether executing the
command is *better memory* — it is a different harness, and a lane that changed its reader and then compared itself to
rows measured on the old one would be committing the category error `COMPETITIVE.md` spends a section on. And it
cannot say the format is fixed in the model: `recovered_actions` is the count of replies that still write both.

**Cost.** Two arms, two sections, four jobs each — **≈ ¥5.90**. It is the last cheap measurement of the format lock.

## R183, amendment 1 — bought, and the second reader is worth +9.85 pp to the bank arm and +17.15 pp to the control

Two dispatches, two arms each, 274 games per arm across both sections; `parser: any-line` in the header and in all 274
episodes of both arms; `arm_label` `always-in@anyline` and `none@anyline`; `pack chars` exactly **551** in every game of
the bank arm and **0** in every game of the control; `refused_actions` **0** in all 548 episodes. Every void condition
holds except the recovery count, which is the reading rather than a condition (see below).

| arm | seen, 140 | held out, 134 | pooled, 274 | bill |
| --- | --- | --- | --- | --- |
| **1a** `always-in@anyline` | **128** | **129** | **257 (93.80%)**, Wilson [90.3, 96.1] | $0.2246 (¥1.61) |
| **1b** `none@anyline` | **100** | **97** | **197 (71.90%)**, Wilson [66.3, 76.9] | $0.4244 (¥3.03) |

| pairing | delta | 95% CI | p | discordant | mde |
| --- | --- | --- | --- | --- | --- |
| `always-in@anyline` − `always-in` (the same bank, two readers) | **+9.85 pp** | [+5.47, +14.23] | < 0.001 | 41 | 6.55 pp |
| `none@anyline` − `none` (the same empty pack, two readers) | **+17.15 pp** | [+10.22, +24.09] | < 0.001 | 99 | 10.18 pp |
| **`always-in@anyline` − `none@anyline`** (the memory effect on the second reader) | **+21.90 pp** | [+16.06, +27.74] | < 0.001 | 78 | 9.03 pp |

**Predictions: five held, one fired, and the one that fired is the interesting row.**

| registered | read | verdict |
| --- | --- | --- |
| `refused_actions` 0 on both arms, both sections | **0** in all 548 episodes | held by construction |
| `put`, `always-in@anyline` − reference: **+15 to +35 pp** | **50/59 vs 24/59 = +44.07 pp** | **exceeded** |
| `put`, `none@anyline` − reference: **+20 to +50 pp** | **35/59 vs 4/59 = +52.54 pp** | **exceeded**, just outside |
| pooled, `always-in@anyline` − reference 230: **+3 to +8 pp** | **+9.85 pp** | **exceeded** |
| pooled, `none@anyline` − reference 150: **+8 to +25 pp** | **+17.15 pp** | held |
| the other five kinds, `\|Δ\|` ≤ 5 pp | `examine` −9.68 pp (3 games), the rest ≤ 2.56 | refuted as written, on one kind |
| **the memory effect on the second channel: +10 to +25 pp** | **+21.90 pp** | **held** |
| `recovered_actions` per `put` game, `always-in@anyline`: **8 to 15** | **4.17** | **failed** — refutation clause 1 fires |
| `recovered_actions` per `put` game, `none@anyline`: **7 to 14** | **10.42** | held |

**The refutation clause fires, and for a reason it named.** It said: *if `recovered_actions` reads below 8 per `put`
game, the two channels met different model behaviour and the cross-channel rows become descriptive.* It reads **4.17**
on the bank arm. The clause is right about the arithmetic and only half right about the mechanism, and the difference is
worth stating precisely, because it is the same denominator error this lane has caught before:

| quantity | `always-in@anyline` | `none@anyline` |
| --- | --- | --- |
| recovered commands, per `put` game | **4.17** (246 over 59) | **10.42** (615 over 59) |
| recovered commands, per model turn | **0.0554** | **0.0740** |
| mean turns in a *won* `put` | **13.1** | **21.8** |
| mean turns in a *lost* `put` | 50.0 | 50.0 |

The rate per **turn** differs by 25%, the rate per **game** differs by 2.5×, and the reason is that the bank arm's
episodes got short: a `put` game that finishes in 13 turns has a third of the turns in which to write a thought and a
command. So what fell is not the format — it is the number of opportunities the format has — and the registered
quantity was a per-game rate measuring both at once. **The clause fires, the cross-channel rows are quoted as
descriptive, and the within-channel pair (+21.90 pp) is the one registered reading that survives.** The per-turn column
is added here as a post-hoc correction and is not a registered quantity.

**What the round establishes, in the order it matters.**

1. **Executing the refused command is the largest single intervention this lane has measured.** +9.85 pp on the bank arm
   and +17.15 pp on the control, both at p < 0.001, against a family of prompt edits that spent eleven rounds inside
   ±3.65 pp. The format was costing more than every content mechanism the lane has tested.
2. **The memory's lead narrows but does not collapse.** +29.20 pp on the reference channel, **+21.90 pp** on the second
   one: a quarter of the entry's apparent value was a workaround for a reader that dropped its command, and three
   quarters was not. The registered band (+10 to +25) held, and the direction of the workaround reading is confirmed
   while its size is smaller than the band's midpoint.
3. **`put` is no longer the outlier it was, and that is the whole round in one number.** 24/59 → **50/59** on the bank
   arm and 4/59 → **35/59** on the control. The control's `put` — the row `COMPETITIVE.md` calls the one no published
   memory paper reports, a frozen model losing 93% of one task kind before any memory exists — was **a property of the
   harness, not of the task.**
4. **The stratum split moves the same way it always has, only larger.** `hard` 69/77 vs 0/77 (**+89.61 pp**), `easy`
   188/197 vs 197/197 (**−4.57 pp**). Every arm this lane has bought trades a few easy wins for many hard ones; the
   channel trades 9 for 69.

**What is left of the floor, and it is no longer syntax.** Nine `put` games still lose 50 turns each: 17.7 thoughts and
**15.0 recovered commands per game** — 15% of the turns are still written as thought-then-command and now execute, which
is why they are not lost to the format any more, and the games still do not finish. A won `put` is 13.1 turns and 1.4
thoughts. So the residual is **exploration depth**, not the reader: the model has the budget and spends a third of it
thinking. That is the R184 question, and it is the first one this lane can ask that a prompt cannot answer by itself.

**Spend: ¥4.64 against ¥5.90 quoted** ($0.6490, 13,311 calls, four jobs an arm). The bank arm is the *cheaper* of the
two — $0.2246 against $0.4244 — because a model that wins in 13 turns bills 13 turns: on this channel being right is
what makes calls, where on the reference channel being wrong was.

## R184 — The budget sentence, and a cap that is not a neutral knob

The floor after R183 is nine `put` games that spend all fifty turns and end no closer: **17.67 thoughts** and **15.0
recovered commands** each, at `0.3533` thoughts per turn, while a won `put` is **13.1 turns** and **1.38 thoughts**. The
syntax no longer swallows the command, so what remains is what the model does with turns it is no longer forced to
spend on the format. The nine losing games are, in the phrase the roadmap used before the round existed, *narration
that has already executed*.

The cheapest intervention that could change that is one number already in the prompt. `HUMAN_TEMPLATE` is
`"{instruction}You may take maximum of {max_steps} steps.\nHere are two examples:"`, `--max-steps` is already a
dispatch input, and the loop stops at `steps < max_steps`. So a cap of thirty is a one-token change to a sentence the
model reads and a five-line change to where its turns run out: **no new code, no new bank, no new arm.**

### The cap is the first knob in this lane that is not orthogonal to the arm

Every episode record carries the step at which it won, so the score an arm *would* read at a cap of thirty **if the
model did exactly what it did at fifty** is a deterministic function of runs already paid for: `won and steps <= 30`.
It is a floor no behaviour can fall below and a ceiling only behaviour can raise.

| channel | arm | at cap 50 | **same behaviour, cap 30** | the cap's price |
| --- | --- | --- | --- | --- |
| `any-line` | `always-in` | 257 (93.80%) | **242 (88.32%)** | −15 games |
| `any-line` | `none` | 197 (71.90%) | **157 (57.30%)** | −40 games |
| `reference` | `always-in` | 230 (83.94%) | **209 (76.28%)** | −21 games |
| `reference` | `none` | 150 (54.74%) | **116 (42.34%)** | −34 games |

The cap costs the control **2.7× more than it costs the bank arm** on the channel under test, because the bank arm wins
fast — mean 15.6 steps on `clean`, 13.1 on `put`, `examine` 15.9 — and the control wins slow: 28.0, 21.8 and 13.7 on
the same three kinds. So the memory effect at cap thirty would read **+31.02 pp instead of +21.90 pp with no change in
behaviour at all**, and **+33.94 instead of +29.20** on the reference channel. A shrunk cap is not a neutral harness
knob: it is a treatment whose size is *correlated with the arm*, and it flatters memory by 4.7 to 9.1 pp by arithmetic
alone.

**Consequence for this round, fixed before buying.** The primary readings are the two **absolute** scores, each arm
against itself at fifty. Every cross-arm row quoted at cap thirty is quoted with the inflation in the same sentence,
and the within-cap memory delta is **not** registered as a reading: it is a derived quantity whose null value is
+31.02 and whose interpretable part is whatever the absolute scores leave over.

### What the cap costs, per kind, if behaviour does not change

| kind | `always-in` 50 → 30 | `none` 50 → 30 | the shape of the loss |
| --- | --- | --- | --- |
| `clean` | 58 → 56 | **39 → 26** | the control's slowest kind loses a third |
| `cool` | 43 → 40 | 36 → 32 | |
| `examine` | 28 → 25 | 31 → 30 | the bank arm pays most where it is one game from ceiling |
| `heat` | 38 → 37 | **31 → 22** | |
| `put` | **50 → 49** | 35 → 28 | the bank arm loses **one** game of fifty |
| `puttwo` | 40 → 35 | 25 → 19 | |

`put` is the least sensitive kind on the bank arm: **one game in fifty** is lost to a twenty-turn cut, which is the
round's whole premise restated as a number — the nine that still lose cannot be rescued by budget, only by acting
inside it. On the control, `put` loses seven: the same mechanism, opposite sign, because its wins are slow.

### Registered readings

Four jobs an arm, `any-line` channel, `banks/bank-putmove-line-1.json`, 274 games (140 seen, 134 held out),
`--max-steps 30`, both arms in one dispatch so the pairing is by construction:

1. **`always-in@anyline` above 242**, band **246 to 262** (91.4% of the gap to the nine lost `put` games at the top of
   the band). The floor is exact rather than sampled, because it is computed from the same episode records rather than
   estimated from a null: **any excess at all is behaviour, and the round's question is how much.**
2. `none@anyline` above 157, band **162 to 190**.
3. `put`, `always-in`: **48 to 53 of 59** (cap-50 baseline 50, budget-only 49). Above 53 means the sentence made the
   model act on games where the cap alone would not have.
4. `put`, `none`: **26 to 36 of 59** (baseline 35, budget-only 28). The control's band is the wider one on purpose:
   its nine-game drop is arithmetic, and the question is whether the sentence recovers any of it.
5. **Thoughts per turn on a lost `put`, `always-in`: ≤ 0.30** against `0.3533`. Per turn rather than per game, for
   R183's reason: a cap changes the denominator and the numerator together, and only the rate is the same quantity.
6. `budget_exhausted` rises on both arms to at least 32 and 117 respectively, and `truncated` stays 0.
7. The other five kinds stay within the cap's own price — `|Δ| ≤ 5 pp` except where the table above says otherwise,
   and there the registered shape is the table's number, not a surprise.
8. `pack chars` exactly 551 and `parser` `any-line` in all 548 episodes; `max_steps` 30 in all eight summaries.

### Refutation

1. **`always-in@anyline` at or below 242.** The sentence does not discipline narration; its only effect was to shorten
   the budget; the budget shape is closed as an explanation for the nine lost `put` games; the residual floor is a
   knowledge gap and R185 is the belief entry (roadmap candidate 2), not a smaller cap.
2. **Inside band 1 but `none` below 157.** The cap traded the control's slow wins for the bank arm's fast ones. The
   round is then a null with a *measured* inflation, the cross-arm rows are descriptive, and the cap is recorded as a
   harness setting rather than an intervention.
3. **`put` above 53 on either arm.** The nine lost games were not exploration depth, and R183's closing sentence — that
   the floor is depth of search rather than the reader — is retracted in the amendment that reports it.

### Void

Any episode whose `parser` is not `any-line`, any summary whose `max_steps` is not 30, a channel with fewer than 274
games, or an episode the environment refuses past step 30. The cap has to be the only difference from R183 or the
comparison it is for does not exist.

### The confound this round cannot remove, priced

The treatment is two things at once: the loop stops at thirty, and the sentence says thirty. A fourth cell — cap thirty,
sentence fifty — separates them, costs ≈ ¥1.9 (one arm, both sections), and is registered as the follow-up only if
reading 1 is positive: if the cap does nothing there is nothing to attribute, and if it does, the attribution is worth
a fifth of what the attribution of the round itself cost. That asymmetry is why the cell is not bought now.

**Price ≈ ¥3.80**, eight jobs, shorter episodes, off-peak band. At the peak band the same pass is ≈ ¥7.6, which is why
the dispatch holds its paid step until the window opens.

### R184, addendum 1 — written before the dispatch, and it changes no registered number

Two 2025 papers were read after §R184 was written and before it was bought. Neither moves a registered reading; the
second one is the reason the round is worth its price.

**The budget binds hard on an agent with no instance knowledge.** AutoContext (arXiv 2510.2369, Table 2) reports ALFWorld
success against the step budget for four backbones: ReAct **13.1 / 48.3 / 76.5 / 77.5 / 77.5** at 5 / 10 / 40 / 160 /
unlimited steps, IGE **10.4 / 10.6 / 54.6 / 86.9 / 94.3**, AutoManual **3.4 / 28.8 / 94.8 / 97.9 / 97.9**. Between ten
and forty steps ReAct gains **+28.2 pp** and IGE **+44.0 pp** — the cap is a first-order variable for systems that carry
no structured belief about the instance, which is what the control is.

**And it stops binding when the knowledge is there.** The same table with a per-instance context document (a Markdown
entity–relation store whose unobserved attributes are written `Unknown`, built by ~177.9 steps of one-off exploration of
that instance) reads ReAct **26.7 / 97.3 / 98.0 / 98.0 / 98.0** and AutoManual **17.6 / 83.2 / 99.7 / 99.7 / 99.7**:
between ten and forty steps, **+0.7 pp** and **+16.5 pp**, and from forty to unlimited **zero**. The ablation in the same
paper is the part that names the mechanism: removing the TODO forest costs 3.8 pp, the planner 8.9 pp, the extractor
**16.7 pp** (98.5 → 81.8).

**What that does to this round.** It predicts the *shape* the counterfactual already implies and cannot explain away:
the cap's price is 15 games on the bank arm and 40 on the control, a 2.7× asymmetry, because what a bank of distilled
episodes buys is exactly the thing that makes a step budget stop being the binding constraint. A reading in which the
bank arm lands near 242 while the control falls to 157 is then **not a null**: it is the published shape reproduced on a
different mechanism (cross-*task* memory rather than per-*instance* context), and it says the lane's remaining floor is
the nine `put` games specifically rather than the budget generally.

**What it does not license.** AutoContext's 98.0% and AutoManual's 97.9% are not rows this lane can be placed against
without saying what they are: the first explores the test instance itself (~177.9 steps an instance, amortised), the
second distils a manual from experience. The lane's bank is the second kind. Both belong on the board with the
distinction stated, and neither belongs in a claim about this round's 274 games.

## R184, amendment 1 — bought, and the cap is pure budget: the sentence cut narration and narration was not the cost

Eight jobs, 274 games an arm, `any-line` channel, `banks/bank-putmove-line-1.json`, `--max-steps 30`, off-peak band,
runs `44915418516` (134 held out) and `44915531080` (140 seen).

| arm | at cap 50 | **at cap 30** | Wilson | frozen-behaviour prediction | paired delta vs its own cap-50 run | mde |
| --- | --- | --- | --- | --- | --- | --- |
| `always-in@anyline` | 257 (93.80%) | **240 (87.59%)** | [83.2, 91.0] | **242** | **−6.20 pp** (9 new, 26 old) | 6.05 pp |
| `none@anyline` | 197 (71.90%) | **156 (56.93%)** | [51.0, 62.7] | **157** | **−14.96 pp** (25 new, 66 old) | 9.76 pp |

**The predicted artefact arrived to 0.36 pp and the predicted effect did not arrive at all.** The memory effect at cap 30
reads **+30.66 pp** against the frozen-behaviour value of **+31.02 pp** — the inflation the registration computed from the
cap's asymmetry (15 games against 40) is what happened, nearly exactly, and it happened *because nothing else did*.

### The registration said "floor" and the word was wrong

§R184 wrote that the counterfactual is *"a floor no behaviour can fall below and a ceiling only behaviour can raise"*.
Both arms landed **below** it — by 2 games and by 1. The reason is not a defect in the arithmetic but in the word: the
model is **sampled**, so a game that won at step 22 on the fifty-step pass can be lost outright on the thirty-step pass,
and the counterfactual is a *prediction under frozen behaviour with sampling noise around it*, not a bound. What it
still licenses is the reading it was written for, and more sharply than a bound would: **lands within 1–2 games of the
prediction = the model did the same thing**, and both arms did. The correct sentence, which replaces the registered
one, is: *the counterfactual is exact as arithmetic and noisy as a prediction; the residual is the effect.*

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `always-in` above 242, band 246–262 | **240** | **failed** — refutation clause 1 fires |
| 2 | `none` above 157, band 162–190 | **156** | **failed**, 1 game under its prediction |
| 3 | `put`, `always-in`: 48–53 of 59 | **50** | held, exactly at the cap-50 baseline |
| 4 | `put`, `none`: 26–36 of 59 | **32** | held (baseline 35, prediction 28) |
| 5 | thoughts per turn on a lost `put` ≤ 0.30 | **0.2667** | **held** — and it is the round's anomaly |
| 6 | `budget_exhausted` ≥ 32 and ≥ 117, `truncated` 0 | **34, 118, 0** | held |
| 7 | other kinds within the cap's own price, `\|Δ\|` ≤ 5 pp | `always-in` ±3 games; `none` `heat` +4, `put` +4, **`puttwo` −7** | refuted as written on one kind |
| 8 | `pack chars` 551, `parser` `any-line`, `max_steps` 30 | 551 in 274, `any-line` in 548, 30 in all eight summaries | held |

**Per kind, against the cap's own price** (`always-in` then `none`, observed against the frozen prediction):

| kind | `always-in` | `none` |
| --- | --- | --- |
| `clean` | 57/58 (cf 56) **+1** | 27/58 (cf 26) **+1** |
| `cool` | 37/46 (cf 40) −3 | 30/46 (cf 32) −2 |
| `examine` | 26/31 (cf 25) **+1** | 29/31 (cf 30) −1 |
| `heat` | 35/39 (cf 37) −2 | 26/39 (cf 22) **+4** |
| `put` | 50/59 (cf 49) **+1** | 32/59 (cf 28) **+4** |
| `puttwo` | 35/41 (cf 35) 0 | 12/41 (cf 19) **−7** |

Ten of the twelve rows sit within ±3 games of the prediction. The two that do not are both on the control, and both in
the direction of *noise on a sample of 39–41 games*: `puttwo` at 41 games has an mde of ≈ 30 pp, so a 7-game row is not
a mechanism, and it is reported as it fell rather than explained.

### The anomaly that decides the next round

Reading 5 held and reading 3 held, and the pair of them is the finding: on the nine `put` games that still lose, the
model's narration per turn fell from **0.3533 to 0.2667** — a quarter — while `put` stayed at **50 of 59**. So the cap
*did* what the sentence was bought to do, and the losses did not convert:

| quantity, nine lost `put` games | cap 50 | cap 30 |
| --- | --- | --- |
| turns | 50.0 | **30.0** |
| thoughts per game | 17.67 | **8.00** |
| **thoughts per turn** | 0.3533 | **0.2667** |
| recovered commands per game | 15.0 | 3.67 |

**Narration was not what kept those games from finishing.** The budget shape is closed as an explanation, clause 1 fires
on the level, and the residual floor is neither syntax (R183) nor budget (R184).

### What the nine games are actually made of, which is the design of R185

At cap 30 they split into two clusters, and the split is the first diagnosis this lane has of the floor that survived
two repairs:

| cluster | games | invalid actions | stalls | last line | what it is |
| --- | --- | --- | --- | --- | --- |
| **precondition** | **5** | 3, 5, 6, 7, 11 (mean 6.4) | 1–3 | `Nothing happens.` | a command the world rejects, repeatedly |
| **budget** | 4 | 0–2 | 0 | mid-progress (`You open the drawer 15…`, `You arrive at cabinet 8…`) | valid actions, thirty turns ran out |

A won `put` has **1.54** invalid actions in 12.8 turns; a lost one has **4.00** in 30. So five of the nine are not
exploration depth at all — they are **preconditions the model does not hold**: a container must be open before
something is taken out of it, and a receptacle is not a surface. That is a knowledge entry of a specific shape, and it
is the shape AutoContext's schema calls `requirements` (addendum 1) rather than the "where is the object" entry the
roadmap sketched as candidate 2.

**Spend: ¥4.11 against ¥3.80 quoted** ($0.5751, 11,079 calls, off-peak in all eight summaries). Nine per cent over
quote, and the reason is the same one R183 found in the opposite direction: the control runs 24.07 turns an episode
against the bank arm's 16.36, so the arm that fails is the arm that bills.

## R185 — the tail swap: 197 characters of format instruction out, 197 of precondition in

R184 closed the budget and left a floor with a shape. The nine `put` games that still lose spend fifty turns each and
make **12.33 invalid actions** against **1.60** in a won game; at the short cap they split into five that keep issuing
commands the world rejects (ending on `Nothing happens.`) and four that run out of turns mid-progress. The rejections are
one mechanism, and the episodes name it: `take` from a closed container answers `Nothing happens.`, and every `put`
afterwards answers the same, because the model never took the object it thinks it holds.

### The design is a single tail, and that is the whole point

`bank-putmove-line-1.json` is 354 characters in one entry, rendered to **551**: its first **157** characters are the
put-to-move phrasing that R182 measured as the winning sentence's live half, and its last **197** are the format
instruction. On the `any-line` channel that instruction is inert — R183 moved the reader and the reader executes a
command on a later line, so telling the model to write one does not change what the world receives (`refused_actions`
**0** in 274 games, `recovered_actions` **269**). So the tail is the one part of the winning sentence that this channel
does not use, and it is exactly 197 characters of room.

`banks/bank-putprecond-1.json` holds the same 157 characters and a different 197: open the container before taking
anything from it, or the take answers `Nothing happens.` and the put that follows fails the same way. Same entry count,
same rendered length (**551**), same label (`always-in@anyline`), same reader, same cap (**50**), same bank file
position in the dispatch. **One variable: what the 197 characters say.**

### Registered readings

Bank arm only (`--against none`), `any-line`, `banks/bank-putprecond-1.json`, cap 50, 274 games (140 seen, 134 held
out), four jobs, against the control R183 bought (`none@anyline`, 197/274):

1. **`put` 53 to 58 of 59** (from **50**). The band's floor is one converted game above noise for a 59-game row; its
   ceiling leaves room for the four budget-bound games the sentence cannot reach.
2. **`always-in@anyline` 260 to 270** of 274 (from **257**). Small on purpose: the entry is aimed at one kind and the
   other five are registered to sit still, so a pool that moves six games has moved more than `put` did.
3. **Invalid actions per lost `put` at or below 6.0**, against **12.33**; and the number of lost `put` games with more
   than two invalid actions falls from **8** to **≤ 5**. This is the mechanism reading, and it is the one that can pass
   while reading 1 fails.
4. **`recovered_actions` 200 to 340 and `refused_actions` 0.** The tail that left was the format instruction, so if the
   model's format behaviour were being held in place by it, this is where the loss would appear — and if it appears, the
   551-character comparison is confounded by format rather than clean.
5. The other five kinds stay within **|Δ| ≤ 5 pp** of R183's bank arm.
6. `pack_chars` exactly **551**, `pack_entries` **1**, `parser` `any-line`, `max_steps` **50**, and **one**
   `bank_digest` across all 274 episodes — the last of which is now an assertion rather than a hope, because the join
   refuses a label that spans two packs.
7. **Memory effect against R183's control between +23.0 and +30.0 pp** (from **+21.90**). Not a board claim: the board
   row is the 134 unseen games, and this is the pooled 274.

### Refutation

1. **`put` at or below 50 with invalid actions still above 8.** The entry does not reach the decision. The precondition
   is then a fact the model cannot use in a sentence, and the next lever is not a prompt at all — it is instance state
   with the unobserved parts marked, i.e. AutoContext's document rather than its sentence. R186 becomes that document.
2. **`put` inside the band with invalid actions unchanged.** The gain did not come from the precondition, and the only
   other thing that changed is that the format clause left. The round then reports a level and no mechanism, and the
   tail is recorded as unexplained rather than credited.
3. **`recovered_actions` below 200.** The dropped instruction was load-bearing for how the model composes a reply even
   on this channel, and the comparison is a format contrast wearing a knowledge contrast's clothes: the round is void
   for attribution and is reported as a level only.

### Void

Any episode whose `parser` is not `any-line`, any summary whose `max_steps` is not 50 or whose `pack_chars` is not 551,
a bank label spanning two `bank_digest` values, a section with fewer than its published size, or a control that had to be
re-bought — the control is R183's and it is the fixed side of the comparison.

### The confound this round carries, priced

Two things leave together: the format instruction and the put-to-move phrasing's tail position. The second is not a
change (the prefix is byte-identical), but the first is, and the separation is a third bank: the format clause plus the
precondition, with the prefix cut to hold 551 — a tail-for-prefix swap that costs ≈ **¥2.40** and is bought only if
reading 4 fails, because a format clause that is inert on this channel has no effect to separate.

**Price ≈ ¥2.40**, four jobs, one arm, both sections, off-peak band. The control is not re-bought: R183's `none@anyline`
is the fixed side, which is what `--against none` exists for.

## R185, amendment 1 — bought, and the entry is not kind-local: +6 `put`, −18 everywhere else

Two dispatches, **274 games, one arm**, `any-line`, cap 50, off-peak in all eight summaries: run `44955924885` (134
held out) and `44955959473` (140 seen).

| arm | wins | Wilson | held out | seen | paired against R183's own bank arm | mde |
| --- | --- | --- | --- | --- | --- | --- |
| `precond@anyline` | **245/274 (89.42%)** | [85.2, 92.5] | 123/134 (91.79%) | 122/140 (87.14%) | **−4.38 pp** (10 gained, 22 lost) | 5.78 pp |
| `line@anyline` (R183) | 257/274 (93.80%) | [90.3, 96.1] | 129/134 (96.27%) | 128/140 (91.43%) | — | — |
| `none@anyline` (R183) | 197/274 (71.90%) | [66.3, 76.9] | 97/134 (72.39%) | 100/140 (71.43%) | — | — |

**The registered mechanism worked and the registered level did not, and the reason is a place the registration did not
look.** `put` went from **50 to 56 of 59** (+10.2 pp; eight games gained, two lost) — the precondition is real. But
`clean` went from **58 to 45 of 58** (−22.4 pp; thirteen games lost, none gained), `heat` 38 → 35, `examine` 28 → 26. Net
**−12 games**, three kinds damaged by more than their own noise, and the damage sits outside the entry's subject.

| kind | `precond` | `line` | Δ | transitions |
| --- | --- | --- | --- | --- |
| `put` | **56/59 (94.9%)** | 50/59 (84.7%) | **+10.2 pp** | 8 gained, 2 lost |
| `clean` | **45/58 (77.6%)** | 58/58 (100%) | **−22.4 pp** | 0 gained, 13 lost |
| `heat` | 35/39 (89.7%) | 38/39 (97.4%) | −7.7 pp | 0 gained, 3 lost |
| `examine` | 26/31 (83.9%) | 28/31 (90.3%) | −6.5 pp | 0 gained, 2 lost |
| `cool` | 43/46 (93.5%) | 43/46 (93.5%) | 0 | 1 gained, 1 lost |
| `puttwo` | 40/41 (97.6%) | 40/41 (97.6%) | 0 | 1 gained, 1 lost |

### What the damaged kinds look like, which is not what "less deliberation" predicts

| quantity per game | `clean` precond | `clean` line | all precond | all line |
| --- | --- | --- | --- | --- |
| thoughts | **10.8** | 4.4 | 6.49 | 4.68 |
| steps | **23.8** | 15.6 | 20.32 | 17.73 |
| invalid actions | **3.3** | 1.1 | — | — |
| `recovered` | **0** | 5 | **137** | 269 |

`clean` does not act less: it thinks **two and a half times as much** and spends eight more turns doing it, and the eight
seen losses all end at step 50 with `Nothing happens.` and up to twenty invalid actions. The model is not under-thinking;
it is **thrashing on a task the sentence was not about**. In the same direction, `recovered` — the count of replies whose
first line is a thought and whose later line is a command — halved from **269 to 137**, which is the one measurement that
says the tail's *format* content was doing work after all: with the instruction gone the model composes replies
differently, and the change is not local to `put`.

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `put` 53 to 58 of 59 | **56** | **held** |
| 2 | `always-in@anyline` 260 to 270 | **245** | failed, 15 short of the floor |
| 3 | invalid per lost `put` ≤ 6.0, and >2 invalid from 8 to ≤5 | **14.33** and **3** | **failed as written, held in its second half** |
| 4 | `recovered` 200 to 340, `refused` 0 | **137** and 0 | **failed** — clause 3 fires |
| 5 | other five kinds within `\|Δ\| ≤ 5 pp` | `clean` −22.4, `heat` −7.7, `examine` −6.5 | **failed on three kinds** |
| 6 | 551 chars, 1 entry, `any-line`, cap 50, one `bank_digest` | 551, 1, `any-line`, 50, `5fb4c46456d4a497` ×274 | **held** — and it is the new guard's first live use |

**Reading 3 failed in a way worth naming.** It registers a mean over *lost* `put` games, and the treatment's purpose is to
reduce the number of lost games: nine became three, so the mean is now taken over the three hardest survivors (14.33
invalid actions each). The number went up while the count of games with more than two invalid actions went **8 → 3**. A
per-lost-game denominator moves with the treatment, which makes it the third instance of the class R183 caught with a
per-game rate and R184 with a counterfactual: **the denominator has to be fixed by the design, not by the outcome.**

### The finding, stated as the thing this round actually measured

**A 197-character entry is read by every task, so an entry written for one kind is a treatment on all six.** The `put`
gain is +10.2 pp on its own kind and −22.4 pp on the kind that shares its objects (a `clean` task is a `pick_clean_then_place`
task: it takes an object out of a container before cleaning it), for a net **−12 games** — and the net is what a reader
would quote if the round had registered only the pool.

That is the sharpest statement this lane has produced of the thing the project was asked to quantify: **the negative
effect of a memory is not in what it says being false, but in its scope being wider than its subject.** Six hundred
previous rounds wrote entries about the whole task and measured the pool; this one wrote an entry about one kind and
measured the other five, and the other five lost more than the one gained.

### Spend and the confound

**¥1.92 against ¥2.40 quoted** ($0.2678, 5,569 calls, off-peak in all eight summaries — under quote because one arm ran
instead of two and every episode ends inside the same 50-turn cap).

The round's own confound is now the *only* question left in it, and the registered follow-up cell for it was
**arithmetically impossible**: 197 characters out and 197 in was supposed to be separated by a third bank holding *both*
tails at 551 characters, which would need 157 + 197 + 197 = 551 characters of entry inside a 354-character slot. It
cannot be built. The cell that can be built is the next round's and it is a different design: **two entries, each 354
characters, each tagged to a disjoint set of kinds, one entry per game at 551 characters** — the R183 sentence for the
five kinds the entry was not about, the precondition sentence for `put`. That is a scope test rather than a content test,
and it is registered as R186.

## R186 — scope, not content: the same 551 characters with a different tail for `put`

R185's net was **−12 games**: `put` +6, `clean` −13, `heat` −3, `examine` −2. The entry was written about one kind and
read by six, and the five it was not written for lost more than the one gained. The repair is not a better sentence but a
narrower one, and the lane already owns the mechanism: entries carry `kinds` tags and `--gate-kind` selects among them
(`applicable`, R174.2).

### The design has to keep the price fixed per game, or it tests the wrong thing

`banks/bank-putscope-2.json` holds **two entries of 354 characters each**, tagged to **disjoint** sets of task kinds —
the five kinds the precondition was not written for get `bank-putmove-line-1.json`'s text **byte for byte**, and `put`
gets `bank-putprecond-1.json`'s. Because the tags partition the six kinds, every game carries **exactly one entry and
renders 551 characters**, which is what makes this a scope test rather than a length test:

| kind | entry | rendered | digest |
| --- | --- | --- | --- |
| `clean`, `cool`, `examine`, `heat`, `puttwo` | R183's sentence | 551 | `90c0688f` |
| `put` | R185's sentence | 551 | `5fb4c464` |

The five kinds are **held still by construction**, not by hope: their pack is byte-identical to the one R183 measured at
58/58, 43/46, 28/31, 38/39 and 40/41. If they move, the movement is run-to-run variance and it is measurable as such.

### A guard had to change before this round could be bought

The `bank_digest` guard added with R185 refuses one label spanning two banks, and it read the field from the **episodes**.
Under a kind gate one pass hands out several packs, so the guard as first written would have refused **this round** — the
round it exists for. The field is therefore two fields: `bank_digest` in the summary (one bank per run, which is what a
label groups on) and `pack_digest` per episode (what the game actually read). Five tests, one of them the gated shape.

### Registered readings

One arm, gated, `any-line`, cap 50, 274 games, four jobs, against R183's `none@anyline` control:

1. **`put` 54 to 58 of 59** (56 in R185, 50 in R183). The gain has to survive being scoped; a gain that only exists when
   the other kinds are damaged was not a gain.
2. **`clean` at or above 57 of 58**, `heat` at or above 37 of 39, `examine` at or above 27 of 31, `cool` at or above
   42 of 46, `puttwo` at or above 40 of 41. Byte-identical packs, so the bands are one game wide against 1.5 to 2 games
   of sampling noise.
3. **Overall 256 to 266** of 274 (R185 245, R183 257).
4. **`recovered` 250 to 320** (R185 137, R183 269). The format clause is back in five of six packs, so reply composition
   should return with it; this is the reading that says whether `recovered` was measuring the clause or the brevity.
5. `pack_chars` **551** and `pack_entries` **1** in all 274 games, `parser` `any-line`, `max_steps` **50**, **one**
   `bank_digest` per section and **two** `pack_digest` values — the gated shape, recorded.

### Refutation

1. **`put` at or below 53.** The `put` gain in R185 came from the global perturbation — the same 197 characters that
   damaged `clean` were what helped `put` — and the precondition is retired as a prompt-level entry. R187 becomes the
   instance-state document with `Unknown` markers, which is the competitor's mechanism rather than its sentence.
2. **`clean` at or below 56 with byte-identical text.** The loss was not caused by the precondition reaching `clean`, and
   the scope hypothesis is wrong: the cause is then either run-to-run variance (which this round measures directly) or a
   channel-level effect that the R183 bank no longer has. The pool stays where R185 left it and the bank is restored.
3. **`recovered` below 250 while `clean` recovers.** `recovered` was not measuring the format clause at all; it moved with
   the precondition's presence, and the R185 reading that made the round "void for attribution" is itself retracted.

### Void

Any game whose `pack_chars` is not 551 or whose `pack_entries` is not 1 (a gate that returned two entries or none), any
label spanning two `bank_digest` values, `parser` not `any-line`, `max_steps` not 50, a section short of its published
size, or a control that had to be re-bought.

**Price ≈ ¥2.10**, four jobs (one arm, both sections), off-peak band.

## R186, amendment 1 — bought, and scope is the whole mechanism: +19 games over R185, `put` +10.2 pp with the other five kinds moving one game

Two dispatches, **274 games, one gated arm**, `any-line`, cap 50, off-peak in all eight summaries: run `44959956920`
(134 held out) and `44959974666` (140 seen). The control is R183's `none@anyline` and the reference bank R183's
`always-in@anyline`, both reused rather than re-bought and both declared to the join.

| arm | wins | Wilson | held out | seen | paired against `none@anyline` | mde |
| --- | --- | --- | --- | --- | --- | --- |
| **`scope@kind+anyline` (R186)** | **264/274 (96.35%)** | [93.41, 98.01] | **133/134 (99.25%)** | 131/140 (93.57%) | **+24.45 pp** (72 gained, 5 lost) | 8.97 pp |
| `line@anyline` (R183) | 257/274 (93.80%) | [90.3, 96.1] | 129/134 (96.27%) | 128/140 (91.43%) | +21.90 pp (78 gained) | 9.03 pp |
| `none@anyline` (R183) | 197/274 (71.90%) | [66.3, 76.9] | 97/134 (72.39%) | 100/140 (71.43%) | — | — |

**Against the bank it was built from, the round is +7 games and it cannot yet be called a gain.** Paired
`scope@kind+anyline` − `always-in@anyline` = **+2.55 pp** [+0.00, +5.47], bootstrap p = 0.081, exact McNemar on its
11 + 4 discordant games p = 0.119, mde at that pairing **3.96 pp**. The observed difference sits below what 274 games
can resolve, and the honest sentence is the compositional one: the scoped bank is **not worse** than the single-entry
bank on the pool, while the `put` gain that motivated it survives at its full size. The per-kind table below is
therefore the reading and the pool is the summary.

| kind | `scope` (R186) | `line` (R183) | Δ vs R183 | `precond` (R185) | Δ vs R185 | the five kinds' packs |
| --- | --- | --- | --- | --- | --- | --- |
| `put` | **56/59 (94.9%)** | 50/59 (84.7%) | **+10.2 pp** | 56/59 | 0 | R185's sentence |
| `clean` | 58/58 (100%) | 58/58 (100%) | 0 | 45/58 | **+13 games** | byte-identical to R183 |
| `cool` | 43/46 (93.5%) | 43/46 (93.5%) | 0 | 43/46 | 0 | byte-identical to R183 |
| `puttwo` | 41/41 (100%) | 40/41 (97.6%) | +2.4 pp | 40/41 | +1 game | byte-identical to R183 |
| `heat` | 37/39 (94.9%) | 38/39 (97.4%) | −2.6 pp | 35/39 | +2 games | byte-identical to R183 |
| `examine` | 29/31 (93.5%) | 28/31 (90.3%) | +3.2 pp | 26/31 | +3 games | byte-identical to R183 |

### The five kinds moved one game, which is the variance measurement the registration asked for

215 games carried a pack **byte-identical** to the one R183 measured, and they went **207 → 208**. Per kind the largest
movement is one game in either direction (`heat` −1, `examine` +1, `puttwo` +1), which is the 1.5-to-2-game band the
registration named, and it is now measured rather than assumed. So the R185 damage was the entry and not the kind: under
the precondition, `clean` thought **10.8** times a game and spent **23.8** turns doing it; under the R183 sentence it
thinks **4.4** and spends **15.1**, which is R183's own 4.4 and 15.6 to one decimal, and its thirteen budget-exhausted
games go to **zero**. Removing 197 characters from five kinds restored all thirteen games.

| quantity per game | `clean` R186 | `clean` R185 | `clean` R183 |
| --- | --- | --- | --- |
| thoughts | 4.4 | 10.8 | 4.4 |
| steps | 15.1 | 23.8 | 15.6 |
| invalid actions | 1.1 | 3.3 | 1.1 |
| `budget_exhausted` | **0** | **13** | 0 |

### The `put` gain replicates: 8 gained and 2 lost, twice, on two independent samples

R185 and R186 drew 59 `put` games each and both moved **exactly 8 gained and 2 lost** against R183 — two samples that
land on the same transitions, not one sample read twice. Pooled over the 118 `put` games the two rounds drove, the
precondition's gain is **16 gained against 4 lost, exact p = 0.0118**, and it is worth **+10.2 pp** on its own kind
while the five kinds it was withheld from move one game. That is the round's mechanism stated as a mechanism:

> The negative effect of a memory is a **scope** error — a sentence written about one task, read by six — and it is
> repairable without giving up the gain. Delivered to its subject the same 197 characters keep all six `put` games and
> cost nothing measurable outside.

### Reading 4 failed and its refutation fired, and both were the same instrument bug

`recovered` read **168** against the registered band of 250 to 320, so row 4 fails, and refutation clause 3's letter
fires ("`recovered` below 250 while `clean` recovers"). The decomposition every round should have printed is:

| | `put` | the other five | pool |
| --- | --- | --- | --- |
| R183, clause on every pack | **246** | 23 | 269 |
| R185, clause replaced on every pack | 132 | 5 | 137 |
| R186, clause on five packs, precondition on `put` | **133** | **35** | 168 |

`recovered` is **91% `put`** in R183 and **79%** in R186, so the pool is not a population: 168 = 133 + 35 and
269 = 246 + 23. The five kinds that kept the clause went **23 → 35** — they did not fall. The pool fell by 113 inside
the one kind whose clause was removed, and by nothing anywhere else. Therefore:

1. **R185's sentence "the change is not local to `put`" is retracted.** The change was 86% local to `put` (114 of 132).
2. **Refutation clause 3's inference does not follow.** The band was written on a pool that is nine-tenths one kind; the
   only scoped design that could hold the pool above 250 is one that keeps the clause on `put`, which is the design
   this round was registered to test against. A band that a round cannot pass without being a different round is not a
   refutation, and the clause that made it is retired.
3. **What `recovered` measures is the format clause, only on `put`, and only as a channel quantity.** Put beside the
   world's answer: 246 with the clause, 132 and 133 without it, 615 in the control that has no pack and flails for
   23.8 turns a game. On the `any-line` channel the shape the clause forbids is executed anyway, so its 197 characters
   buy no wins (R185, R186) — and on the reference channel the same shape is **dropped**, which is the +9.85 pp R183
   measured. `recovered` is a meter of the reader, not of the memory.

This is the **third instance of one class**, and the class is now named: R183 registered a mean over lost games, R184 a
counterfactual over a sampled policy, R186 a band over a pool that is one kind. The denominator — or the population —
has to be fixed by the design and not by the outcome. The harness repair is in this round rather than in the next one:
`aggregate.py` now prints `recovered` **on the kind's own line**, with that kind's calls as the denominator, and prints
nothing when an arm file predates the field (seven tests, `RecoveredScopeTest`).

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `put` 54 to 58 of 59 | **56** | **held** |
| 2 | `clean` ≥ 57, `heat` ≥ 37, `examine` ≥ 27, `cool` ≥ 42, `puttwo` ≥ 40 | **58, 37, 29, 43, 41** | **held on all five** |
| 3 | overall 256 to 266 | **264** | **held** |
| 4 | `recovered` 250 to 320 | **168** | **failed** — and the failure is the instrument's, see above |
| 5 | 551 chars, 1 entry, `any-line`, cap 50, one `bank_digest`, two `pack_digest` | 551 ×274, 1 ×274, `any-line` ×274, 50 ×8 summaries, `eed9bea6` ×8, `90c0688f` 215 + `5fb4c464` 59 | **held** |

### Void: nothing fired

`pack_chars` 551 in all 274 games, `pack_entries` 1 in all 274, `parser` `any-line` in all 274, `max_steps` 50 in all
eight summaries, one `bank_digest` (`eed9bea6`) across both sections, exactly two `pack_digest` values in the
registered 215/59 proportion, sections tiled 134 + 140, no control re-bought. `refused_actions` 0 and `truncated` 0 in
every episode; `budget_exhausted` 8 (two in each of `heat`, `cool`, `examine`, `put`), against 34 in R185.

### Spend

**¥1.50 against ¥2.10 quoted** ($0.2085, 4,605 calls, off-peak in all eight summaries). Under quote because one arm ran
instead of two and the gated pack cut the turn count: 16.81 steps a game against R183's 17.73, on 4,605 calls against
4,857 for the same 274 games.

### Where this leaves the lane

The published bank is now `banks/bank-putscope-2.json`: **96.35% pooled, 99.25% on the unseen section**, one 551-character
pack per game, 274 games, ¥1.50 a round. The three mechanisms the lane has measured to be worth something are the
put-to-move phrasing (R182), the second reader (R183, +9.85 pp on the same bank) and the container precondition scoped
to `put` (R185 +186, +10.2 pp on its kind, replicated); the one it has measured to be worth **negative** value is the
same precondition **unscoped** (−18 games, R185). What is left in the ten lost games is not the pack: eight of them
exhaust the fifty-turn budget with the grammar and the precondition both correct, which is the case for a document
about the instance rather than a sentence about the kind.

## R187 — the same entry where it is also true: does the precondition generalise past `put`?

R186 settled one direction of the scope question: an entry withheld from five kinds costs those five kinds **one game**
(207 → 208), so the price of scope is nothing. The other direction is unmeasured, and it is not a question about wording.
Three of the six kinds are also `then_place_in_receptacle` tasks — `cool` puts an object in a fridge after changing its
temperature, `heat` in a microwave, `puttwo` two objects in one receptacle — and all three take from a container the same
way `put` does. Two `cool` and two `heat` games are among the eight of R186's ten losses that exhaust the fifty-turn
budget on a take that answers `Nothing happens.`

`banks/bank-putscope-3.json` holds the **same two 354-character sentences** as R186 with the boundary moved by one kind
group, so every game still carries **one entry and 551 rendered characters**:

| kinds | entry | rendered | digest |
| --- | --- | --- | --- |
| `put`, `cool`, `heat`, `puttwo` | R185's precondition sentence | 551 | `5fb4c464` |
| `clean`, `examine` | R183's sentence, byte for byte | 551 | `90c0688f` |

`clean` washes in a sink and `examine` only looks, so neither places anything: they keep R183's sentence unchanged, which
means the round carries its own control inside its own bank. Their packs are frozen, so any movement there is variance
and is readable as variance.

### Registered readings

One gated arm, `any-line`, cap 50, 274 games, four jobs, read against R186's own arm:

1. **`put` 54 to 58 of 59** (56 in both R185 and R186). The entry's own kind must be unmoved by its neighbours carrying
   the same sentence — a gain that only exists in isolation is a gain about a prompt length, not about a rule.
2. **`cool` at or above 45 of 46 and `heat` at or above 38 of 39** (43 and 37 in R186). These are the two kinds whose
   losses are the closed container, and they are the round's hypothesis: if the sentence is about placing into a
   receptacle, they should gain; if it is about `pick_and_place_simple` in particular, they will not.
3. **`puttwo` at or above 41 of 41, `clean` at or above 57 of 58, `examine` at or above 28 of 31.** `puttwo` is
   targeted and already at ceiling; `clean` and `examine` are frozen and their floors are one game under their R186
   values.
4. **Overall 264 to 272** of 274 (R186 264).
5. `pack_chars` **551** and `pack_entries` **1** in all 274 games, `parser` `any-line`, `max_steps` **50**, **one**
   `bank_digest` per section and **two** `pack_digest` values in the 3:2 proportion the tags imply (164 games on
   `5fb4c464`, 110 on `90c0688f`).

### Refutation

**Any of `cool`, `heat`, `puttwo` below R186 by two games or more.** The precondition is then `put`-specific: the
sentence is not about containers but about the one kind it was written for, the entry format stops being the variable,
and R188 becomes the **location prior** — one corpus-wide entry about where object classes live, distilled offline from
the training transcripts — because eight of R186's ten losses are search and not wording, two of them on
`pick_and_place_simple`, the corpus's simplest task.

### Void

Any game whose `pack_chars` is not 551 or whose `pack_entries` is not 1, any label spanning two `bank_digest` values,
`parser` not `any-line`, `max_steps` not 50, a section short of its published size, or a control that had to be re-bought
(R186's arm is the control and it is reused, not bought again).

**Price ≈ ¥2.10**, four jobs (one arm, both sections), off-peak band.

## R187, amendment 1 — bought, and the precondition does not travel: −10 games when three more kinds read it

Two dispatches, **274 games, one gated arm**, `any-line`, cap 50, off-peak in all eight summaries: run `44967271658`
(134 held out) and `44967290361` (140 seen).

| arm | pooled | unseen 134 | seen 140 | paired against R186 | mde |
| --- | --- | --- | --- | --- | --- |
| **`putscope-3@kind+anyline`** | **254/274 (92.70%)** | 125/134 (93.28%) | 129/140 (92.14%) | **−3.65 pp** (4 gained, 14 lost) | 4.34 pp |
| `putscope-2@kind+anyline` (R186) | 264/274 (96.35%) | 133/134 (99.25%) | 131/140 (93.57%) | — | — |

**The refutation clause fired, and it fired for the reason it was written for.** `puttwo` went 41 → **37** and `heat`
37 → **35**, both at or beyond the two-game threshold, with `cool` unchanged at 43. The precondition is **`put`-specific**:
three of the six kinds place into a receptacle, and the sentence helps only the one it was written about.

| kind | R187 | R186 | Δ | which pack | transitions |
| --- | --- | --- | --- | --- | --- |
| `put` | 53/59 (89.8%) | 56/59 (94.9%) | −3 | **identical** (`5fb4c464`) | 1 gained, 4 lost |
| `clean` | 56/58 (96.6%) | 58/58 (100%) | −2 | **identical** (`90c0688f`) | 0 gained, 2 lost |
| `cool` | 43/46 (93.5%) | 43/46 (93.5%) | 0 | changed → precondition | 2 gained, 2 lost |
| `puttwo` | **37/41 (90.2%)** | 41/41 (100%) | **−4** | changed → precondition | 0 gained, 4 lost |
| `heat` | **35/39 (89.7%)** | 37/39 (94.9%) | **−2** | changed → precondition | 0 gained, 2 lost |
| `examine` | 30/31 (96.8%) | 29/31 (93.5%) | +1 | **identical** (`90c0688f`) | 1 gained, 0 lost |

### The three kinds that changed lost six games; the three that did not lost five, and that is the round's real contribution

`put`, `clean` and `examine` carried **byte-identical packs** at **551 characters** — the prompt the model read is the
prompt R186's arm read — and they moved **−3, −2 and +1**: **−4 games over 117**, against **+1 over 215** when R186
measured the same thing for its five frozen packs. Two estimates of one quantity, five games apart:

| comparison | games on a frozen pack | movement |
| --- | --- | --- |
| R183 → R186 | 215 | **+1** |
| R186 → R187 | 117 | **−4** |
| pooled | 332 | **−3 (−0.9%)** |

**So the run-to-run band is not one game.** R186 read its own five frozen packs at +1 and the registration that followed
was written as if that were the noise floor; a second draw, on the same texts and the same length, says four. Any delta
below roughly **±5 games over 274** is indistinguishable on one pass of this harness — which is a bound the lane should
have carried from the start and now carries explicitly.

This does not disturb R186's headline — 264 against a control at 197 is +67 games, and 264 against R183's 257 is +7 with
the `put` gain replicating at identical transitions — but it does retire "the scoped bank is not worse than the
single-entry bank by two games" as a two-game claim. It is a within-five-games claim.

### What the round says about the entry, stated as the thing it measured

> An entry's value decays with the number of kinds that read it, and the decay is not about the sentence being true.
> R185 gave one sentence to six kinds and lost 18 games on the five foreign ones; R187 gave it to four and lost 6 on the
> three foreign ones; R186 gave it to one and lost nothing. Both times the kind that gained was the kind it was written
> about, and every foreign kind that read it lost.

Three rounds now bracket the same quantity: **five foreign kinds −18 lost** (R185), **three foreign kinds −6 lost**
(R187), **zero foreign kinds +1 game** (R186, over 215 frozen-pack games). The scope law of §8.48 is not a metaphor; it
is a slope of **−3.6 and −2.0 games per foreign kind**, measured twice, and the flattest reading of the two is still
larger than the noise band on any single pass.

### A fourth registration cell that was arithmetic, and wrong

Reading 5 registered "two `pack_digest` values in the 3:2 proportion the tags imply (**164** games on `5fb4c464`, **110**
on `90c0688f`)". The corpus's kind sizes are 59, 58, 46, 41, 39 and 31: the four targeted kinds are 59 + 46 + 39 + 41 =
**185**, and the two frozen ones are 58 + 31 = **89**. The correct pair is 185/89, the artefact recorded 185/89, and the
registered cell was wrong by 21 games. Rule 1 of AUDIT 34.267 says every registered cell has to be computable before it
is bought from an artefact that exists — `aggregate.py` prints the per-kind game counts on every reading, and R186's own
reading prints them. The cell was arithmetic, and it was not done.

The shape clause it was attached to held: 551 characters and one entry in all 274 games, one `bank_digest` per section,
two `pack_digest` values, `any-line`, cap 50.

### A provenance field that could not see the variable it was recording

The eight summaries carry `bank_digest` `eed9bea6…` — **the same value R186's eight summaries carry**, for a bank whose
tags are different and whose packs are therefore different for three kinds. `digest_of` hashed the entry **texts**;
`bank-putscope-2` and `bank-putscope-3` hold the same two texts and differ only in `kinds`, so the field that exists to
tell two banks apart reported one bank. The join's one-bank-per-label guard could not have caught it, and the round that
moved the only variable in question was recorded as re-running the previous one.

Fixed in-round: `bank_digest_of(rules, kinds)` hashes each entry's **sorted tag set** with its text, so
`bank-putscope-2` and `bank-putscope-3` now read `349213e8…` and `4efb1eba…`. Three tests: same texts with different tags
are two banks, the same tags in a different order are one, and a tagged sentence is not the untagged one. Historic
`bank_digest` values recorded before this round identify a text and not a bank, and every table that quotes one says so.

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `put` 54 to 58 of 59 | **53** | **failed**, one under the floor |
| 2 | `cool` ≥ 45, `heat` ≥ 38 | **43**, **35** | **failed on both** — the hypothesis |
| 3 | `puttwo` ≥ 41, `clean` ≥ 57, `examine` ≥ 28 | **37**, **56**, **30** | failed on two, held on `examine` |
| 4 | overall 264 to 272 | **254** | **failed** |
| 5 | 551 chars, 1 entry, one `bank_digest`, two `pack_digest` at 164:110 | 551 ✓, 1 ✓, one ✓, **185:89** | **shape held, proportion wrong as registered** |

### Spend

**¥1.70 against ¥2.10 quoted** ($0.2364, 5,130 calls, off-peak in all eight summaries). 18.72 steps a game against R186's
16.81, and **19** games against the fifty-turn budget against 8 — the extra turns are the damage, and they are the
signature R185 showed for `clean`: a kind reading a sentence about another kind does not act less, it thrashes.

### What this leaves: R188 is the location prior

`bank-putscope-2.json` is restored as the published bank — **264/274, 99.25% unseen** — and the scope boundary is now a
measured law rather than a hypothesis. What remains in the ten losses is search: eight of them exhaust the fifty-turn
budget on a take that never finds its object (`pick_and_place_simple` twice, `heat` twice, `cool` twice, `examine` twice),
which no sentence about a kind can reach. R188 banks a **location prior** distilled offline from the training
transcripts — where each object class is found, and how often — because that is the one form of cross-task knowledge the
remaining failures are made of.

## R188 — half the remaining gap is not search: one untagged sentence about the turn budget, and its own placebo

R186 loses ten games and the aggregate now prints what kind of game each one was. Five act every turn and never find
their object — **49 or 50 environment steps, 0 or 1 thoughts** — and five never act at all: **24 to 46 thoughts over 4
to 26 environment steps**. The two families are disjoint, and the winning side says the boundary is sharp: **no won game
in 264 has twenty thoughts**, and none has ten invalid actions.

The pack already moves the mean and does not move this class:

| arm | wins | thoughts a game | thought-heavy (≥20) | steps a game |
| --- | --- | --- | --- | --- |
| `none@anyline` (control) | 197/274 | 9.23 | **19** | 30.9 |
| `line@anyline` (R183) | 257/274 | 4.7 | 8 | 17.7 |
| `scope@kind+anyline` (R186) | **264/274** | **4.2** | **5** | 16.8 |

So the remaining thought-heavy games are **what the pack failed to reach**, not what it caused: memory halves rumination
and the five survivors are the ones the instruction did not land on. A reply that carries no command spends one turn of
the fifty and moves nothing, which is a turn-economy failure rather than a search failure — and it is reachable by one
sentence, not by a corpus.

`banks/bank-turnbudget-1.json` carries the published two entries **byte for byte** and adds one **untagged** sentence:

> Every reply must end with a command, because a reply that only plans still spends one turn of the fifty available and
> leaves the world exactly as it was. Do not describe the next step, take it: issue the command you were about to
> consider and read the answer.

`banks/bank-turnbudget-1-placebo.json` is the same file with that sentence's **own words permuted** — 259 characters,
the same multiset, no instruction — so the two arms differ in content and in nothing else.

| property | treatment | placebo |
| --- | --- | --- |
| rendered characters, every kind | **814** | **814** |
| entries per game, every kind | **2** | **2** |
| entries 1 and 2 | R186's, byte for byte | R186's, byte for byte |
| entry 3 | 259 chars, untagged | 259 chars, permuted |
| `bank_digest` | `22dbe9f7` | `084688d7` |

The sentence is untagged on purpose, and that makes the round a second test of the scope law in the direction R187 could
not run. Every previous measurement gave an entry to kinds it was **not about**; this one gives an entry to six kinds it
**is** about. If scope costs games because content is foreign, this entry costs nothing; if it costs games because any
longer pack perturbs, it costs the same as R185's did.

### Registered readings

Two arms, `--gate-kind true`, `any-line`, cap 50, 274 games each, four jobs, read against R186's own arm:

1. **`thought_heavy` at or below 2 of 274** in the treatment arm (R186 5, control 19). The class is the entry's own
   target and the only reading that is about the mechanism rather than about the score.
2. **The treatment's pool is at or above the placebo's plus 4 games**, paired on the same 274 games. The placebo is the
   length control; a treatment that does not beat it is a treatment whose effect is 259 characters of anything.
3. **Thoughts a game fall by at least 0.5 in the treatment against the placebo** (R186 4.2). Direction, not threshold:
   the entry says one command every turn and the counter is the reply that does not carry one.
4. **The treatment's pool is at or above 264** of 274 — not worse than R186 at 551 characters with 814 — and its
   `invalid_actions` per call stay at or below the placebo's.
5. `pack_chars` **814** and `pack_entries` **2** in all 548 games, `parser` `any-line`, `max_steps` **50**, **one**
   `bank_digest` per arm per section, and **two** `pack_digest` values per arm in the 215:59 proportion the tags imply
   (five kinds carry entry 1, `put` carries entry 2).

### Refutation

**`thought_heavy` stays at 5, or falls while the pool does not move.** The first says the class is a property of the
model that a bank cannot reach, and the lane stops treating rumination as a memory problem; the second says the turn
budget was not the binding constraint in those five games — the environment steps were too few to finish even at a
clean turn economy — and the next round is the **location prior** of §R188-planned, built from the training corpus
offline at zero API cost, because the five search-heavy losses are the other half of the gap and no sentence about
turns reaches them.

### Void

Any game whose `pack_chars` is not 814 or whose `pack_entries` is not 2, a label spanning two `bank_digest` values, an
arm whose `bank_digest` equals the other arm's, `parser` not `any-line`, `max_steps` not 50, or a section short of its
published size (134 held out, 140 seen).

**Price ≈ ¥3.00**, four jobs (two arms, both sections), off-peak band.

## R188, amendment 1 — bought, inert, and the class it targeted was a draw rather than a game

Four dispatches, **548 games, two arms**, `--gate-kind true`, `any-line`, cap 50, off-peak in all eight summaries: run
`44975674858` + `44975691007` (treatment, 134 + 140) and `44975707582` + `44975723871` (placebo, 134 + 140).

| arm | pack | pooled | unseen 134 | seen 140 | thoughts a game | heavy (≥20) | steps a game |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`turn@kind+anyline`** | 814 ch, 2 entries | **264/274 (96.35%)** | 131/134 (97.76%) | 133/140 (95.00%) | **3.54** | **4** | 16.64 |
| `turnplacebo@kind+anyline` | 814 ch, 2 entries | **266/274 (97.08%)** | 131/134 (97.76%) | 135/140 (96.43%) | **3.65** | **2** | 16.15 |
| `scope@kind+anyline` (R186) | 551 ch, 1 entry | 264/274 (96.35%) | 133/134 (99.25%) | 131/140 (93.57%) | 4.20 | 5 | 16.81 |

**The treatment is not better than its own placebo, and the arm that won is the one that says nothing.** Paired
`turn` − `turnplacebo` = **−0.73 pp** [−3.28, +1.82], exact McNemar on 5 + 7 discordant games p = 0.66, mde 3.54 pp.
Against R186 the two arms are a wash in opposite directions: `turn` **7 gained, 7 lost** (p = 1.00), `turnplacebo`
**7 gained, 5 lost** (p = 0.77). 259 characters of instruction and the same 259 characters permuted are the same arm.

### The five games it was written for re-ran, and four of them won

This is the round's actual result, and it is not about the entry.

| game | kind | R186 | `turn` | `turnplacebo` |
| --- | --- | --- | --- | --- |
| 1 | `heat` | 34 thoughts, **lost** | 1 thought, **won** | 5 thoughts, **won** |
| 2 | `heat` | 44 thoughts, **lost** | 4 thoughts, **won** | 4 thoughts, **won** |
| 3 | `examine` | 27 thoughts, **lost** | 2 thoughts, **won** | 10 thoughts, **won** |
| 4 | `put` | 46 thoughts, **lost** | 1 thought, **won** | 1 thought, **won** |
| 5 | `examine` | 24 thoughts, **lost** | 23 thoughts, **lost** | 3 thoughts, **won** |

**Four of five in the treatment and five of five in the placebo, on byte-different prompts and the same corpus.** So the
rumination loop is a **state the model enters on a draw**, not a property of the game and not a gap in the pack's
coverage: the same game, the same kind, the same instruction set, and the loop either happens or it does not. R186's
sentence "the five thought-heavy games are what the pack failed to reach" was a statement about one draw dressed as a
statement about five games.

The same reasoning applies to the other family, which the round also re-ran: R186's five search-heavy losses went
**3 won / 2 lost** in the treatment and **2 won / 3 lost** in the placebo. **Ten losses became eight and ten, and only
three of the twenty game-slots stayed lost.** The pool is stable — 264, 264, 266 across three packs — and the identity
of the lost games is not.

### Reading 3 could not have been read, and the round measured why

The registration asked for "thoughts a game fall by at least 0.5 in the treatment against the placebo". The same-prompt
band is **five times that**:

| comparison | games on byte-identical packs | thoughts a game |
| --- | --- | --- |
| R186 | 148 | **3.68** |
| R187 | 148 | **4.80** |

Two draws of one prompt, **1.12 thoughts a game apart**, against a registered threshold of 0.5 and an observed
treatment–placebo difference of 0.11. The pooled means (4.20 / 3.54 / 3.65) are three samples of one quantity, and the
"drop" from R186 to either R188 arm is inside the band. This is the same defect the round caught in R187 for wins
(±5 games) one level down: **a cell needs a band before it can be a reading**, and a mean over a rare, heavy-tailed
event has a wider band than a count of wins does.

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `thought_heavy` ≤ 2 of 274 in the treatment | **4** (placebo **2**) | **failed** — and the placebo met it, which is the finding |
| 2 | treatment ≥ placebo + 4 games | **264 vs 266** | **failed**, and in the wrong direction |
| 3 | thoughts a game fall ≥ 0.5 against the placebo | **3.54 vs 3.65** (0.11) | **failed** — the band is 1.12, so nothing was readable |
| 4 | treatment ≥ 264; `invalid_actions` per call ≤ placebo | **264** held; **0.1332 vs 0.0988** | **half held** — the pool held and the invalid rate did not |
| 5 | 814 chars, 2 entries, one `bank_digest` per arm, two `pack_digest` at 215:59 | 814 ×274, 2 ×274, `22dbe9f7` / `084688d7`, **215:59 in both arms** | **held** |

### Void: nothing fired

`pack_chars` 814 and `pack_entries` 2 in all 548 games; `parser` `any-line` in all 548; `max_steps` 50 in all eight
summaries; one `bank_digest` per arm (`22dbe9f7`, `084688d7`) and the two arms' digests differ; `pack_digest` 215:59 in
**both** arms, and per section 110:24 and 105:35 in each, which is the partition the tags imply; sections tiled
134 + 140 twice; `refused_actions` 0, `truncated` 0.

### Spend

**¥3.03 against ¥3.00 quoted** ($0.4209, 8,983 calls, off-peak in all eight summaries): treatment $0.2135 on 4,558
calls, placebo $0.2074 on 4,425. The quote was exact because the round moved one entry and no cap.

### What this retires, and what it leaves

1. **The entry does not go into the bank.** `bank-putscope-2.json` remains the published one and `bank-turnbudget-1`
   is kept as a measured inert control, in the same category as the four-rule bank of `44754440122`.
2. **The "8 of 10 losses are search" premise is retired with its parent.** Both families reversed on a redraw (4/5 and
   5/5 for rumination, 3/5 and 2/5 for search), so a plan aimed at *those* games would be a plan aimed at a draw.
   The stable statements are the rates: **11 thought-heavy losses over 822 game-draws = 1.34%**, and roughly the same
   number of search losses, against a pool that reads 264 to 266 whatever the pack says.
3. **The next round is therefore a state, not a game.** A read-time guard that fires only when the previous reply
   carried no command — one injected line, no extra call — targets the loop where it happens, costs nothing on the 98.7%
   of turns that are not loops, and does not need to predict which game will enter one. That is the SEU shape of the
   literature (`COMPETITIVE.md`, the admission family) applied at the only place this lane can apply it: the turn.

## R189 — the guard at the state, not at the game: one changed answer for the turn that carried no command

R188 established two facts that decide this round. The rumination loop is **transient** — the same five games lost to it
in R186 were won 4 of 5 and 5 of 5 when re-run — and it is **expensive**: 11 thought-heavy losses over 822 game-draws,
**1.34%**, each one a game. A bank entry cannot reach it (R188 bought that answer for ¥3.03), because the entry is a
constant in front of every turn and the loop is a rare state inside one.

The driver already answers a commandless reply with a fixed string, `OK.`, which is the competitor's own no-op. The guard
changes **that string and nothing else**:

| | without the guard | with the guard |
| --- | --- | --- |
| reply carries no command | answered `OK.` | answered `OK. Reply with one command only.` |
| reply carries a command | unaffected | **unaffected** |
| turn count, call count, pack | — | unchanged |

That is the whole mechanism, and its shape is what makes it measurable: it is a function of the state the episode is in,
so it **cannot fire in a game that never enters the state**. The round records `guard_fires` per episode, so the join can
prove engagement rather than assume it — a guard arm with zero fires is a no-op wearing a treatment's name (R174.2).

### Registered readings

Two arms on the published bank (`banks/bank-putscope-2.json`), `--gate-kind true`, `any-line`, cap 50, 274 games each,
four jobs, the guard the only variable:

1. **The guard arm's `thought_heavy` count is at most 1 of 274** (three draws of the unguarded pack read 5, 4, 2;
   per-draw rate 1.34%). The mechanism cell, and the one this round is actually powered for: a loop that is interrupted
   cannot recur in the same episode.
2. **The pool is at or above 266 of 274**, paired against the unguarded arm. Stated as a floor and not as a delta
   because the round's power is 3.5 pp: what it can show is "not worse", and the count above is what shows the mechanism.
3. **`guard_fires` is between 20 and 120 over 274 games**, and every firing is followed by a reply that carries a
   command within one turn. A guard that fires on 90% of turns is a different treatment (it would be a permanent
   instruction, which R188 measured as inert); one that never fires did not run.
4. **The pack is unchanged**: `pack_chars` 551 and `pack_entries` 1 in all 274 games, the same `bank_digest` as R186's
   arm, `parser` `any-line`, `max_steps` 50, sections 134 + 140.
5. **The per-turn cost of the guard is under 2% of the arm's prompt**: `prompt_chars` delta against the unguarded arm,
   divided by turns.

### Refutation

**Fewer than 20 fires, or a `thought_heavy` count of 3 or more in the guarded arm.** The first says the loop is not
entered at a rate the guard can see — the 1.34% is an artefact of counting losses rather than turns, and the mechanism is
not a state the driver can interrupt. The second says an interrupted reply is not a recovered turn: the model re-enters
the loop on the next call, and the guard becomes a slower way to lose the same game. Either way the lane stops treating
rumination as reachable and the remaining work is the **utility score** of the admission family — predicting which
entries hurt, which is the project's own question in the form the literature can score.

### Void

Any game whose `pack_chars` is not 551 or `pack_entries` is not 1, a `bank_digest` that differs between the arms, a
guarded episode with no `guard_fires` field, `parser` not `any-line`, `max_steps` not 50, or a section short of its
published size.

**Price ≈ ¥3.00**, four jobs, off-peak band.

## R189, amendment 1 — the guard recovers 8 of the 10 games narration was costing, and it wins the held-out split

Four dispatches, **548 games, two arms on one bank**, `--gate-kind true`, `any-line`, cap 50, off-peak in all sixteen
summaries: run `44984243200` (guard, 134) + `44984376250` (guard, 140) and `44984214371` (plain, 134) + `44984351342`
(plain, 140).

| arm | pack | pooled | unseen 134 | seen 140 | thoughts a game | heavy (≥20) | steps a game | calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`always-in@kind+anyline+guard`** | 551 ch, 1 entry | **265/274 (96.72%)** | **134/134 (100.00%)** | 131/140 (93.57%) | **3.01** | **2** | **15.87** | 4,348 |
| `always-in@kind+anyline` | 551 ch, 1 entry | 258/274 (94.16%) | 131/134 (97.76%) | 127/140 (90.71%) | 4.96 | 10 | 17.28 | 4,736 |
| `scope@kind+anyline` (R186, other draw) | 551 ch, 1 entry | 264/274 (96.35%) | 133/134 (99.25%) | 131/140 (93.57%) | 4.20 | 5 | 16.81 | — |

**Paired +2.55 pp** [+0.00, +5.47], exact McNemar on **11 + 4** discordant games, p = 0.080, mde 3.96 pp; engagement
36.5% of games changed course, and on those the delta is +0.07. **The arm won all 134 held-out games** — the first clean
sweep of that split in this lane, and above the 99.25% R186 published.

### The ten games narration was costing, and what the guard did to them

The mechanism cell is the round's result, and it is not the pooled delta.

| game | kind | plain | guard | verdict |
| --- | --- | --- | --- | --- |
| 1 | `put` | 49 thoughts, lost (50 steps) | **1**, won (13) | recovered |
| 2 | `put` | 45 thoughts, lost | **1**, won (8) | recovered |
| 3 | `put` | 44 thoughts, lost | **1**, won (6) | recovered |
| 4 | `heat` | 43 thoughts, lost | **2**, won (10) | recovered |
| 5 | `heat` | 43 thoughts, lost | **2**, won (11) | recovered |
| 6 | `heat` | 42 thoughts, lost | **2**, won (11) | recovered |
| 7 | `heat` | 34 thoughts, lost | **4**, won (22) | recovered |
| 8 | `cool` | 33 thoughts, lost | **3**, won (39) | recovered |
| 9 | `examine` | 24 thoughts, lost | **2**, won (8) | recovered |
| 10 | `examine` | 38 thoughts, lost | 23, lost | not recovered |

**Eight of ten, at one to four thoughts instead of 33 to 49.** The two exceptions are the informative ones: one game
(`examine`, 38 → 23) keeps narrating and loses, which is the refutation's own shape one game wide; the other
(`cool`, 33 → 39) is a plain win that went heavy under the guard, so it is a line crossed rather than a game lost to
narration.

**And the four games the guard lost were all lost at the world's 50 steps, not to narration**: `cool` (3 thoughts, 50
steps), `examine` (5, 50), `puttwo` (11 → 20, 50), `clean` (5, 50). The guard spends the turn budget on the world
instead of on the transcript, which is what it was built to do, and on those four the world was not found within fifty
steps either way. Steps a game fell **17.28 → 15.87** while thoughts fell **4.96 → 3.01**: the arm is not doing more,
it is narrating less.

### Reading 3's band was drawn on the wrong denominator, and the mechanism clause held exactly

The registration asked for `guard_fires` between **20 and 120 over 274 games**. The arm fired **826 times over 274
games** — once for every thought it wrote, and the plain arm wrote 1,359 of them.

| quantity | registration's implicit value | measured |
| --- | --- | --- |
| rate the band was built from | 1.34% **of turns** (a rate over *games*, applied to turns) | — |
| thoughts a game | 0.07 to 0.44 (implied by 20–120 fires) | **4.96** |
| fires a game | 0.07 to 0.44 | **3.01** |

The 1.34% is a **game** rate (11 thought-heavy games over 822 game-draws). Multiplying it by turns a game produces the
20–120 band; the quantity it actually bounds is thoughts, and a model that wrote 0.07 thoughts a game would be one that
never narrates. **The band was arithmetic about a population that does not exist**, and it is the fifth member of the
family this record keeps: a number computed over the wrong denominator (`34.268`, `34.270`, `34.272`, `34.275`).

What the band was *for* — "a guard that fires on 90% of turns is a different treatment" — is decided by the ratio and
not by the count: **826 fires over ~4,100 turns is 20%**, and the guard is a function of the state (the previous reply
carried no command), not a permanent instruction. **825 of 826 fires were answered, and 0 of 825 were answered with
another commandless reply.** The model does what the line asks, every time it is asked.

### Reading 5, read on the quantity that costs

The registration compared `prompt_chars` per turn against a 2% threshold. The guard arm's **total prompt is lower**:
1,849,028 characters against 1,868,344 over the same 274 games (**−1.03%**), because 533 fewer thought turns cost more
characters than 826 guard lines add. Per turn the ratio rises 420.8 → 457.6 (+8.7%) for the reason the mechanism is
real: the same episode's later turns are now world observations (~200 characters each) rather than `OK.`-answered
thoughts, so an arm that thinks less has a longer average turn. The guard's own characters are 826 × 25 = 20,650,
**1.1% of its arm's prompt** — the reading's number, read on the thing it names.

### Verdicts, one row each

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `thought_heavy` ≤ 1 of 274 | **2** | **failed by one** — 10 → 2 is an 80% reduction, and both survivors are the two the mechanism could not reach |
| 2 | pool ≥ 266 of 274 | **265** | **failed by one**, paired against a control that read 258 |
| 3 | `guard_fires` 20–120 and every fire answered | **826**, 825 checked, **0 relapsed** | **band failed** (impossible as drawn); **mechanism clause held exactly** |
| 4 | pack 551 chars, 1 entry, same `bank_digest`, sections 134 + 140 | 551 ×274, 1 ×274, `349213e8` in both arms, 134 + 140 twice | **held** |
| 5 | guard cost < 2% of the arm's prompt | **1.1%** of the arm's characters, total prompt **−1.03%** | **held** |

**Not refuted.** The registered refutation was "fewer than 20 fires, or `thought_heavy` ≥ 3": the arm fired 826 times and
counted 2. Two of five readings missed their thresholds by one game each, and both misses are inside the ±5 games of
draw-to-draw movement R188 measured for a pool.

### Void: nothing fired

`pack_chars` 551 and `pack_entries` 1 in all 548 games; one `bank_digest` per arm and it is R186's `349213e8` in both;
`parser` `any-line` in all 548; `max_steps` 50 in all sixteen summaries; sections tiled 134 + 140 twice; `refused_actions`
0, `truncated` 0; every guarded episode carries `guard: true` and a ledger, every plain episode `guard: false`.

### Spend

**$0.4098 over 9,084 calls ≈ ¥2.95 against ¥3.00 quoted** (guard **$0.1946** on 4,348 calls, plain **$0.2152** on 4,736),
off-peak in all sixteen summaries. The guard is **cheaper than the control it is compared to**: fewer turns, fewer calls.

### What this establishes, and what it leaves

1. **Rumination is reachable at the turn**, and the reach is large: 8 of 10 games, at one to four thoughts where the
   control spent 33 to 49. This is the strongest mechanism cell this lane has recorded, and it is a *state* cell like
   the ones the literature names (`COMPETITIVE.md`, SEU read-time gating).
2. **The board moves.** Unseen **134/134**, pooled 265/274. The published bank is unchanged, so the level is the bank's
   plus the guard's.
3. **The guard is not a memory.** It carries no knowledge about tasks, and it is the only arm in this record whose gain
   comes from the driver's answer rather than from what the model reads. That is a fact the whitepaper has to state
   plainly: the experience-reuse number this project competes on is 133/134 from the bank **plus** 1 game from a
   turn-economy rule that any harness can adopt.
4. **What is left is the seen section.** 131/140 under the guard, 127/140 without: the low cell of the two, and the
   only one the guard did not move past R186's level. The remaining 9 losses are 4 at the world's step cap and 5
   elsewhere; the read-time channel (`any-line`) and the guard have taken the format and the loop, so what is left is
   search — and search is where a location prior (R190) or a fixed budget rule has to be bought next.

**Next: R190 — the utility score, offline.** No purchase. The admission family's other half: predict *which* entry hurts,
using the four banks this lane has already measured (551 ch with 5 heavy and 10 losses, 814 ch inert, 659 ch, 197 ch).
That is the project's own question — memory that helps and memory that hurts — on data already paid for.

## R190, amendment 1 — the score is undetermined at the resolution this lane can afford, and its reach variant is already refuted

No dispatch. **Twenty-one banks scored offline, 0 model calls, ¥0.00.** `scripts/score_bank.py` implements the
literature's admission score (`arXiv:2608.20274`: utility = specificity x abstractness, no rollout) over the **pack the
driver renders**, importing `applicable` and `render_pack` rather than re-deriving them, and
`eval/drivers/alfworld/measured-effects.json` holds every measured delta with the comparison it is.

**The instrument reproduces the record before it is used.** Rendered lengths come out of the scorer exactly as the lane
published them: 551 characters for `bank-putscope-2` on all six kinds, 814 for `bank-turnbudget-1`, 489 for
`bank-putmove-1`, 1,312–1,318 for the four-entry banks. A score over a text nobody was shown is a score of nothing, so
the test that pins this is the first one in the suite.

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | rho >= 0.6 over four banks, the score computed blind | **rho = +0.500 over three banks**; the fourth row had no measured delta at all | **failed**, on a table that was not four rows |
| 2 | the 551-character bank scores above the 814-character one on specificity | **0.0708 against 0.0479**, a gap of 32.4% where the extra sentence is 31.8% of the pack | **held** |
| 3 | permuting an entry's words moves the score by <= 0.05 | **0.000**, to nine decimals, on a placebo verified to be a permutation of the same bag | **held**, non-vacuously |

**Refutation clause: not triggered.** rho < 0.3 was the clause and rho is +0.500. The reading above it (>= 0.6) also
failed. The round is therefore neither a confirmation nor a refutation, and the reason is arithmetic rather than
rhetorical — see below.

### Reading 1's table was three quantities and one artefact

The registration named four banks. Three of them have a delta that can be compared, and they are **three different
quantities**:

| bank | delta | what the delta is | round |
| --- | --- | --- | --- |
| `bank-putscope-2` | **+24.45 pp** | bank against `none`, one dispatch, 274 games | R186 |
| `bank-putmove-1` | **+21.90 pp** | bank against `none`, one dispatch, 274 games | R177 |
| `bank-perkind-6` | **+6.72 pp** | bank against `none`, one dispatch, **134** games | R175 |
| `bank-turnbudget-1` | **-0.73 pp** | bank against **its own word-permuted placebo**, 274 games | R188 |
| `bank-crosskind-44774801298` | **—** | the file is an **artefact of a run that drove no games**: `calls: 4`, no episodes, and 1,166 rendered characters against the 659 the registration quotes | R177 fixture |

So the correlation runs over the three rows where one quantity varies, and the fourth is reported beside it as the
one-point experiment it is. `measured-effects.json` now carries `quantity` per row and `score_bank.py` refuses a row
without it, because a correlation over a table of mixed deltas is a correlation over nothing (AUDIT 34.276).

### rho = +0.500 and why it cannot be bought up

The inversion is one adjacent pair: `bank-putmove-1` scores **0.00818** and measured +21.90, `bank-putscope-2` scores
**0.00601** and measured +24.45. A 36% higher score and 2.55 pp lower.

That pair also shows why the registration's 0.6 was not reachable at any affordable price. **The score's whole range on
this corpus is 1.62x** — 0.00544 (`bank-putmove-line-1`) to 0.00881 (`bank-putprecond-1`) among the single-entry
551-character banks — while this lane's minimum detectable effect on one dispatch is **9.7 pp**. Two banks a factor of
1.6 apart on the score cannot be ordered by a measurement whose resolution is 9.7 pp, and no bank in the corpus sits
further apart than that, because they all name a command. **The statistic is not refuted; it is unfalsifiable at this
resolution**, and a gate that cannot be validated is not shippable (AUDIT 34.277).

### The reach variant is refuted, and R177's own table does it

The score reads content. The half of admission that decides the sign in this record is **reach**, so the scorer also
computes a lexical reach column — does the entry name the kind's own terminal operation — and R177's per-kind table is
the test:

| kind | the sentence, 274 games | entry names it | |
| --- | --- | --- | --- |
| `cool` | 43/46, **+30.4 pp** | no | **disagrees** |
| `heat` | 38/39, **+28.2 pp** | no | **disagrees** |
| `put` | 24/59, +27.1 pp | yes | agrees |
| `puttwo` | 38/41, +24.4 pp | yes | agrees |
| `clean` | 53/58, **+22.4 pp** | no | **disagrees** |
| `examine` | 27/31, **-12.9 pp** | no | agrees |

**Three of six.** The entry names neither `heat` nor `clean` and gains 28.2 and 22.4 pp on them, because the mechanism
it carries is *open the container before taking anything out of it* — a precondition that `heat` and `clean` games need
and that the entry's vocabulary never mentions. `examine` is the cell where the two agree, and it agrees for the reason
R177 gave: an `examine` game has no placement step for the repair to reach.

So a vocabulary test cannot be the gate. The lesson R181 paid ¥2.24 to learn — *an entry pays where its referent is the
failing step* — is now measured a second way, offline, and it says the same thing: **reach is a mechanism, not a word
list.**

### The counterexample the round found for free

`bank-putscope-2` and `bank-putscope-3` hold the same two sentences **byte for byte** and differ only in which kinds each
is tagged to. Their entry scores are therefore identical to the digit (0.01271 and 0.02141). Their pack means are not:
**0.00601 against 0.00769, +28.0%**, because a pack is a selection and the tags select. The record's two readings of
those banks run 3.65 pp the other way, 264 against 254 — inside the five-game band this lane has measured between draws,
so it is recorded rather than claimed.

That is the finding in one pair of files: the only variation the score can see between two content-identical treatments
is tag-driven, the score has no way to know it, and the reading it does produce is not corroborated by anything the
record measures.

### Cost

**¥0.00.** No dispatch, no model call, no embedding. The round is 41 tests and a table.

**Next: R191 — instance state, the one family the pack cannot reach.** The four games R189's guard lost all ended at the
environment's 50-step cap: search failures with the loop already removed. ¥4.2, registered in `ROADMAP.md`.

## R191 — the state the pack cannot reach: one line on the turn that moved nothing

R189 removed the narration and **lost four games its own control won**, and all four ended at the environment's 50-step
cap with fewer thoughts than the control: `cool` (3 thoughts), `examine` (5), `puttwo` (11 against 20), `clean` (5). They
are not narration failures. They are **search** failures: the model is at the environment, issuing commands, and not
finding the object, and no sentence about the task can help it.

The literature's answer is a per-episode **state** rather than another corpus prior — what has been tried, where, and what
it returned. This driver already holds the first and the third: `actions` is every command the episode handed the world,
in order. So the treatment is a **renderer**, not a component:

| | without the ledger | with the ledger |
| --- | --- | --- |
| a turn whose command moved nothing | the observation alone | the observation, then `Already tried this episode: …` |
| a turn whose command landed | the observation | **unchanged** |
| the pack, the channel, the cap, the guard | — | unchanged |

The line names the last **three** commands tried, in the order they were tried, with repeats collapsed: three copies of
one `take` is one fact about the state, and a window of three copies therefore renders as one command — shorter than the
window it came from, and exactly the message a model looping on one object needs. It fires on both sides of the parser:
an action the world does not admit is refused before it moves anything, and an admitted `look` moves nothing because there
is nothing to move. A turn that ends the episode gets no line, because a line no later turn reads is not engagement.

### Registered readings

Two arms on the published bank (`banks/bank-putscope-2.json`), `--gate-kind true`, `any-line`, cap 50, **274 games each**,
`--guard-commandless` on both, `--state-ledger` on the treatment only, four jobs:

1. **Engagement**: `ledger_fires` is **20 to 200 per arm**, and non-zero in **at least 3 of the 4 named cap-loss games**
   (`cool`, `examine`, `puttwo`, `clean` — named here from the fields R189 recorded, before the round, not selected after
   it). A treatment that never fired on the games it was built for is a bank wearing a flag's name (R174.2).
2. **The cell**: **at least 2 of those 4 games win** under the ledger. Four games cannot reach significance; what they can
   do is show the mechanism reaching the failures it was aimed at.
3. **No harm**: the paired pooled delta over 274 games is **≥ −2.0 pp**. The round's power is 3.5 pp, so this is a
   "not worse" floor rather than a win — the count above is what shows the mechanism.
4. **Instrument**: `pack_chars` 551 and `pack_entries` 1 in all 548 games, one `bank_digest`, `parser` `any-line`,
   `max_steps` 50, `guard` true on both arms, `ledger` true on the treatment and false on the control, and the token
   `ledger` in the treatment's label (`always-in@anyline+guard+ledger` against `always-in@anyline+guard`).
5. **Cost**: total spend **≤ ¥3.4**, and the treatment's `prompt_chars` total **≤ 6% above** the control's. The line is
   conditional on a failed action, and R189's trajectories say that is one to three turns a game.

### Refutation

**Fewer than 20 fires in total, or non-zero in fewer than 2 of the 4 named games.** The state never reached the model, and
the round says nothing about search — the cap-losses are then not a missing-state problem either, and the family closes.

**A pooled delta < −2.0 pp with an interval excluding 0.** The ledger hurts. The search family closes rather than queues,
because the only mechanism the literature offers for a search failure has now been bought and it went the wrong way.

### Void

Any arm whose episodes carry no `ledger_fires`; any pass whose `pack_chars`, `pack_entries`, `max_steps`, `parser`, `guard`
or `bank_digest` differs from the tiling above; any game outside the 274.

**Price ≈ ¥3.00**, four jobs, off-peak band.

**Next after this round: R192 — the release distribution.** 265, 264, 264, 258 on the same 274 games: the published
number is a draw, and four more dispatches (≈ ¥6.0) buy the interval instead of the point.

## R191, amendment 1 — the line reaches all four games it was built for, and the pool does not move

Four dispatches, **548 games, two arms on one bank**, `--gate-kind true`, `any-line`, cap 50, `guard` on both arms,
off-peak in all sixteen summaries: run `44998336698` (ledger, 134) + `44998433515` (ledger, 140) and `44998455032`
(control, 134) + `44998557297` (control, 140).

| arm | pack | pooled | unseen 134 | seen 140 | thoughts a game | heavy (≥20) | steps a game | calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`always-in@kind+anyline+guard+ledger`** | 551 ch, 1 entry | **267/274 (97.45%)** | **134/134** | **133/140 (95.00%)** | **2.65** | **1** | **15.11** | **4,140** |
| `always-in@kind+anyline+guard` | 551 ch, 1 entry | 265/274 (96.72%) | 134/134 | 131/140 (93.57%) | 2.99 | 2 | 15.39 | 4,216 |

**Paired +0.73 pp** [−1.09, +2.92], exact McNemar on **5 + 3** discordant games, p = 0.597, mde 2.89 pp; engagement 35.0%
of games changed course. Every section moves the same way and neither is separable: seen **+1.43 pp**, unseen **+0.00**
(both arms 134/134).

### The four named games, which is the round's actual result

The registration named four games from R189's record — the ones the guard lost and the plain arm won — **before** this
round began. All four carried the line, and all four won:

| game | kind | control (the guard) | ledger | fires |
| --- | --- | --- | --- | --- |
| `pick_cool_then_place_in_recep-Plate-None-CounterTop-1` | `cool` | lost, 50 steps (cap) | **won, 11 steps** | 1 |
| `look_at_obj_in_light-Bowl-None-DeskLamp-301` | `examine` | lost, 50 steps (cap) | **won, 36 steps** | 3 |
| `pick_two_obj_and_place-Box-None-CoffeeTable-213` | `puttwo` | lost, 50 steps (cap) | **won, 40 steps** | 2 |
| `pick_clean_then_place_in_recep-Spatula-None-DiningTable-4` | `clean` | won, 12 steps | **won, 11 steps** | 1 |

Three of the four were cap-losses in the control on this draw and all three flipped; the fourth was won by both arms and
the ledger did not cost it. **4 of 4 named games won, against a registered floor of 2.**

### Reading by reading

| # | registered | read | verdict |
| --- | --- | --- | --- |
| 1 | `ledger_fires` 20 to 200 per arm | **413 per arm**; non-zero in **4 of 4** named games | **failed on the band**, held on the cell |
| 2 | ≥ 2 of the 4 named games win | **4 of 4** | **held** |
| 3 | paired pooled delta ≥ −2.0 pp | **+0.73 pp** [−1.09, +2.92] | **held** |
| 4 | one pack, one channel, one cap, one guard, one bank, `ledger` in the label | 551 ch and 1 entry in all 548 games, `any-line`, 50, `guard: true` on both, one `bank_digest` (349213e8), `always-in@kind+anyline+guard+ledger` against `always-in@kind+anyline+guard` | **held** |
| 5 | spend ≤ ¥3.4, treatment prompt ≤ +6% | **$0.3735 ≈ ¥2.69**, prompt **+2.11%** over 4,140 against 4,216 calls | **held** |

**Reading 1's band was wrong in the same way R189's was, and the registration contradicted itself.** The band said 20 to
200 fires over 274 games — 0.07 to 0.73 a game — while the paragraph justifying it said "the trajectory says that is
**one to three turns a game**", which over 274 games is 274 to 822. The measured 413 sits inside the justification and
outside the band. AUDIT 34.278.

### The line can license the loop it was built to break

The three games the ledger lost are the informative ones, and two of them are `examine`:

| game | fires | ledger | control |
| --- | --- | --- | --- |
| `look_at_obj_in_light-AlarmClock-None-DeskLamp-323` | **40** | lost, 50 steps, 6 thoughts | won, 5 steps |
| `look_at_obj_in_light-Laptop-None-DeskLamp-328` | **16** | lost, 50 steps, 22 thoughts | won, 5 steps |
| `pick_and_place_simple-Box-None-Dresser-224` | 5 | lost, 50 steps | won, 8 steps |

Forty repetitions of `Already tried this episode: …` on one game is forty turns of prompt for a model that kept issuing
the same refused command: by the third repetition the line **is** the loop's constant, and a constant in front of every
turn is what R188 measured as inert. The distribution says this is the tail rather than the shape — 182 games carry
exactly one line, 44 carry two, and 27 carry none — but the tail is where a "state" turns into a "prior". AUDIT 34.279.

### The arm that received no treatment changed its own trajectory in 14 of 27 games

Twenty-seven games carried no line at all, so their prompts are the control's, byte for byte. Fourteen of them still took
a different path, and one of those (`look_at_obj_in_light-Pillow-None-DeskLamp-323`) won under the ledger and lost under
the control at 50 steps. Only **15 of 274** games have identical prompt totals across the two arms.

That is the lane's cross-dispatch control drift (AUDIT 34.232) measured **inside one round**: the model re-samples even
at the prompts it has already answered. Two consequences, both of which shape the next registration: the pool claim is
"not worse" and cannot be more than that at 2.89 pp of resolution, and a mechanism claim has to be made on the games where
the treatment fired — which is why reading 2, not reading 3, is this round's result. AUDIT 34.280.

### Cost, and where it went

| | treatment | control |
| --- | --- | --- |
| calls | 4,140 | 4,216 |
| prompt characters | 1,881,410 | 1,842,583 (**+2.11%**) |
| of which the line | **42,845 (2.28%)**, 103.7 per fire | — |
| bill | **$0.3735 (≈ ¥2.69) for both arms**, 8,356 calls | |

The line is **two per cent of its arm's prompt**, and the treatment makes **76 fewer calls** than the control it beat,
because eight of the control's cap-losses spend their last twenty turns failing. Total spend is **¥2.69**, inside the
registered ¥3.4 ceiling by 21%.

**What it changes about the plan.** The state family is **adopted at the mechanism level and not at the pool level**: four
named games, four wins, for ¥2.69. The next purchase is not another sentence and not another state — it is the
**distribution** (R192), because the published number is now one draw of a pool whose own draws span seven games.


## R193 — the line that stops repeating itself: a count instead of a copy, and a gate on the state

R191's mechanism worked (four named games, four wins) and its tail is the same disease it was built to cure: **a line that
repeats is a constant**, and R188 already bought the answer that a constant in front of every turn is inert (AUDIT
34.279). Two `examine` games received **16** and **40** lines in R191 and both lost at the cap; 182 games received exactly
one.

The treatment is two lines of code, both in the renderer:

| | R191's `--state-ledger` | R193's `--state-ledger-counts` |
| --- | --- | --- |
| a command tried four times | `take apple 1` | `take apple 1 (4 times)` |
| a turn whose window is the one the last line named | a line again | **the observation alone** (silenced, counted) |
| a turn whose window changed | a line | a line |
| everything else — pack, channel, cap, guard, bank | — | unchanged |

**`--state-ledger-counts` is its own label token** (`always-in@kind+anyline+guard+ledger-counts`) and its own episode
field (`ledger_counts`), because R191's list and R193's counted list are two treatments and a label that named both
`ledger` would let a join pool them into one rate — the defect every other harness knob is labelled for.

### Registered readings

Two passes per arm are not bought: the control is **R191's own ledger arm**, already paid for (267/274), which is what
`--against` exists for. One new arm, **274 games, four dispatches, ≈ ¥2.7**:

1. **The tail is closed**: no game receives more than **8** lines, against R191's maximum of **40**, and the arm's total
   `ledger_chars` is **below R191's 42,845**.
2. **The mechanism survives**: all four of R191's named games carry at least one line and **all four win**.
3. **No harm**: the paired pooled delta against R191's arm is **≥ −2.0 pp** over the same 274 games.
4. **The gate engages**: `ledger_suppressed` is **non-zero** (a gate that never fired cannot have closed the tail), and
   the arm's `ledger_fires` is **below** R191's 413.

### Refutation

**A game still receiving more than 8 lines**, or any of the four named games losing → repetition is not the mechanism and
the state family closes at R191's version. **Zero `ledger_suppressed`** → the gate never ran and reading 1 is a claim
about the renderer that was not exercised.

### Void

Any arm whose episodes carry no `ledger_fires` or no `ledger_suppressed`; any pass whose `pack_chars`, `pack_entries`,
`parser`, `max_steps`, `guard` or `bank_digest` differs from R191's tiling; any game outside the 274.

**Price ≈ ¥2.70**, four dispatches, off-peak. **The control is a draw from an earlier commit**, which is the one caveat
this round carries: R191's arm was driven at `43ac25b0` and this one at its own head, so the pool delta is subject to the
re-sampling R191 measured (14 of 27 untreated games took a different path). The mechanism readings are per game and do
not depend on it.
