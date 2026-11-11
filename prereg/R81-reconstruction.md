---
id: R81-reconstruction
step: R81
opened: 2026-11-11
arms: full-reconstructed,full-reconstructed-shuffled
sample: 1534
gates: V18,V19,V80
---

# R81 — persist nothing: rebuild the advice for this question and throw it away

**Registered** 2026-11-11 **before dispatch**. It is the first arm in this project that injects advice
the store did not store, and the first one aimed at a *mechanism* for the negative effect rather than at
its size.

## Why this file exists

Eleven iterations have measured every property of the pack except the one three recent papers say is the
problem: **it is persisted**. The readings, in the order they were taken:

| experiment | arm | reading |
| --- | --- | --- |
| R22 | `full-raw` — the case instead of the rule | **−0.86pp** against `full`, p = 0.76, and 1.43pp below its own shuffled control |
| iteration 96 | `full-shuffled` — another question's pack, same database | **−1.71pp**; against `full` **+1.14pp** [−2.00, 4.29], p = 0.60 |
| iteration 96 | `wrong-scope` — foreign database | **−0.29pp**, inert |
| R79 | `pruned` — a fifth of the pack withheld | **+0.05pp** [−0.79, +0.84]; one question in 1,900 |
| R78/R79 | `full` against `none` on the same slice | **−0.11pp**, so the whole component is inside its own noise |
| published dev cell | `full` against `none`, 1,534 questions | **−1.37pp** [−2.74, 0.00], p = 0.062 |

Every one of those arms varies **what was stored** or **how much of it is shown**. None of them varies
**whether the thing shown was ever stored**. Three papers published within a month of each other say that
is the variable that matters:

- **Wang, Panaganti and Zhou, *More Memory, Worse Agents: Error Reproduction and Anti-Persistence in LLM
  Agents* (arXiv:2610.27406).** An error inside a stored abstraction propagates through retrieval, shapes
  the trajectory, and is then re-abstracted into the store — the error is *regenerated*, not merely
  reused. Their design, *Anti-Persistence*, keeps trajectories and outcomes and reconstructs
  task-specific guidance on demand, discarding it after execution, and reports the highest held-out
  success **and the lowest average call cost** of the memory designs they compare.
- **Wu et al., *MemHarness: Memory Is Reconstructed, Not Replayed* (arXiv:2607.28272).** Injecting a
  retrieved experience verbatim, regardless of the present state, is what causes negative transfer; the
  remedy is reconstruction conditioned on the current situation.
- **Zhu et al., *STRATA* (arXiv:2610.19386).** A single-level pool of concrete memories degrades sharply
  as the task set grows and suffers catastrophic negative transfer; their repair is contrast edges that
  flag direction-opposite experience.

R79 is consistent with all three and could not have distinguished them: it removed 19.8% of the injected
text and moved one question, which says the *stored* content is inert, not that memory is.

## The design, exactly

- **Population:** BIRD `dev`, all 1,534 questions, 5 folds, `learn_sample = 64` — the configuration of
  `eval/results/poc-sota-bird-dev.json` and of R80. `none` and `full` are re-bought inside the run, so
  every contrast below is paired within the dispatch rather than compared against another day's file.
- **Arms, four:**

| arm | what it injects | extra calls/question |
| --- | --- | --- |
| `none` | nothing | 0 |
| `full` | the retrieved pack, as every published number measured it | 0 |
| `full-reconstructed` | **one call's advice**, ≤240 characters, written from this question's own retrieved notes and never written back | 1 |
| `full-reconstructed-shuffled` | the same call with the same budget, written from **another question's** notes in the same database | 1 |

- **Why the shuffled control is not optional.** The treatment adds a call, and a call is an extra
  attempt: an arm that improved could be buying a second chance rather than better guidance. Holding the
  call, the prompt shape, the budget and the parser fixed and changing only *whose* notes the writer
  reads makes `reconstructed − shuffled` the content and `shuffled − none` the cost of asking at all.
  The donor rule is the one `full-shuffled` already uses (`shuffledSource`: same database, item count
  matched), so this experiment differs from iteration 96 in exactly one dimension — persistence.
- **The writer is told what not to do**, in the prompt: not to restate the notes (that is the persisted
  pack under another name), not to describe tables or columns (that is the arm's own input), and not to
  write SQL (that would make the arm a second answer). `NONE` is a first-class answer.
- **The 240-character budget** is a fifth of the pack's 1,090 average, so a win cannot be a length
  effect in the treatment's favour: the arm injects *less* than the arm it is compared against.
- **Nothing is written back.** The store is the same object `full` reads, and the digest guard that fails
  a run whose store changed during scoring stays in force.

## Prediction

- **P1 — the instrument.** `none` re-buys the published cell within 1.5pp (56.1–59.1%), parse rate
  ≥ 98%, and the guidance writer produces advice on **at least 40%** of questions: a store of 1.86 rules
  per question that has something to say about two thirds of them should not decline more than that, and
  a writer that declines everything is a broken prompt rather than a finding.
- **P2 — the content contrast.** `full-reconstructed − full-reconstructed-shuffled` lies in
  **−1.0 … +2.5pp** and does **not** exclude zero. I expect the writer to use its own notes slightly
  better than someone else's, and I expect the difference to be small because `full-shuffled` showed the
  pack's own content is worth +1.14pp against a same-size foreign pack.
- **P3 — the persistence contrast.** `full-reconstructed − full` is **positive but under 1.5pp**, i.e.
  the reconstruction recovers part of the −1.37pp the pack costs at this population without becoming a
  memory *gain*. This is the prediction I am least sure of, and it is the one the file exists for.
- **P4 — the cost.** The extra call is not free: `shuffled − none` is within ±1.0pp, so an arm that wins
  is winning on guidance rather than on having been called twice.

## Refutation

- **`Void`** if the guidance writer produced advice on fewer than 5% of questions (gate `V80`), the parse
  rate is under 95%, or fewer than 1,400 questions scored.
- **`Persistence is the problem`** — P3 holds with an interval excluding zero: a bespoke note beats the
  stored pack by at least 1.5pp. The memory line then has a mechanism and a direction, and the next
  registration is a cheaper reconstruction (one call per *fold*, or a cached per-domain note) rather than
  anything about the pack.
- **`Reconstruction is not the problem either`** — both `reconstructed − full` and
  `reconstructed-shuffled − full` straddle zero and land within ±1.5pp. **The memory line closes for
  good**, and it closes with four independent mechanisms measured null at this population (content,
  quantity, persistence, and the foreign control), which is a result rather than a failure: the SDK's
  memory component is worth nothing on BIRD dev at 57.6%, and saying so is worth more than a fifth
  tuning knob.
- **`The call is the treatment`** — `reconstructed ≈ shuffled` **and** both sit ≥1.5pp above `full`
  with an interval excluding zero. Then the gain is a second attempt, not memory, and it is priced as
  such: the honest product statement becomes "one extra call with a different prompt is worth X" and the
  memory component is retired from the leaderboard claim.
- **`Worse`** — `reconstructed` below `full` by ≥1.5pp with an interval excluding zero. Then writing
  advice from this store is actively harmful, which points at the store's *content* rather than at its
  persistence, and the next experiment is the distillation prompt (R74's `broke` class, 3.4%).

## Cost, forecast before dispatch

| item | calls |
| --- | --- |
| answering, four arms × 1,534 | 6,136 |
| guidance, two writers × 1,534 | 3,068 |
| distillation, 64 × 5 folds | 320 |
| **total** | **≈ 9,600** |

Cap **12,000**, ceiling **13,500**, deadline **300 minutes**, dispatched inside the off-peak window.
Guidance is cached by prompt hash (`SOTA_GUIDANCE_CACHE`), so a re-run of this split pays only for what
the writer has not already answered.

## Acceptance

| # | criterion |
| --- | --- |
| 1 | four arms present on every scored question, and `none` within 1.5pp of the published dev cell |
| 2 | `reconstruct` block reports questions, written, declined, shuffled and cache reuse per fold |
| 3 | gate `V80` passes, and the advice rate is reported both overall and per fold |
| 4 | both contrasts reported with paired 95% intervals and a sign test |
| 5 | the artefact records the guidance budget and the donor rule, so the arm is reproducible from the file |
| 6 | no call failure is charged to the treatment alone: failures reported per arm |
