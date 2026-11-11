---
id: R56-register
step: R56
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
lane: product
distillForm: procedure
distillUnit: correction
---

# R56 — the distiller is asked for the shape of a query, in a lane that has no tables

**Registered** 2026-11-08, dispatchable. R54 is read (ABANDONED on its instrument refutation, its
coverage prediction failed); this is the registration R54's own text names as the next one.

## What R54 measured

| Reading | R51 | R54 | The bar |
| --- | --- | --- | --- |
| store items | 16 | 20 | — |
| items carrying a condition | 16 / 16 | **20 / 20** | 4 or more |
| requests served a pack | 1,527 / 1,527 | **1,951 / 1,951** | ≥ 75% |
| mean items per request | 1.222 | **1.417** | 1.4–2.4 |
| median rule/query coverage | 4.88% | **8.33%** | **12%** |
| paired `pass^4` | −2.00pp | **+5.26pp** [−8.77, +19.30], p = 0.63 | resolution 20.27pp |

Every prediction about the write path held and the coverage bar did not: the conditions exist, they
are delivered, and they share 8.33% of the request's terms — two thirds of the way to the bar from
4.88%, and short of it. The paired delta is the largest positive point estimate this lane has
produced, and it is the second non-negative one: the pre-R50 pair recorded +1.47pp over 68 pairs and
failed on `p`, not on sign. By R50's rule neither claims anything — 57 pairs resolve 20.27pp, so
`UNRESOLVED` is the whole of it.

R54's second refutation therefore fired on its own terms — *the conditions exist and do not name the
situation* — and its registration says what that means: **the next registration is about the prompt,
not about retrieval.**

## What is actually written

`tau2-driver.ts` builds its interpreter as `createLlmInterpreter({ llm })` — no `form`, no
`taxonomy` — and the constructor defaults `form` to `'lesson'`. That form's `when` guidance is:

> `when` names a property the reader can check on a *different* input: what the question asks for,
> which tables or columns it involves, what the answer must be comparable to.

with BIRD's worked example beside it (*"questions that name a race join results to races on
raceId"*). Nothing in that is wrong for a database. In a lane whose input is a customer asking to
cancel an order there is no column to name, so a model following the sentence names the tools it
called — which is the procedure's register, and which is what R49's store contains: *"A request of
this shape is resolved by calling `find_user`, then `cancel_pending_order`, in that order."*

The `procedure` form is the opposite instruction and it already exists: *"the statement names no
table, no column, no alias, no literal and no database… `when` is the trigger, in the question's own
terms: what is being counted, compared, filtered or ordered."* Its enforcement is host-side, because
a prompt cannot enforce itself: `DistillOptions.accept` refuses a candidate whose text names one of
the nouns it was learned from.

## The one variable

`form` changes from `lesson` to `procedure`, and `accept` on the τ² distiller refuses a candidate
whose `statement` or `when` contains a name from the domain's own tool inventory. Everything else is
held: same corrections, same learning tasks (32 of 58), same recall, same note level, same order,
`minCoverage` 0.

One variable, because the alternative — a τ²-specific prompt written for conversations — is a new
document with its own defects, and the existing form already says the thing that is missing. If the
register moves and the coverage still falls short, the τ² form is the follow-up and it will be
written against a measurement rather than against a guess.

## Prediction

- **The coverage bar is met, or the register claim dies.** Median rule/query coverage at or above
  **12%**, the same bar R54 failed, on the same instrument and the same fold. Below 12% with the
  conditions still present, the form is not what decides the trigger and the axis closes.
- **The tool-name share falls.** Among admitted items, the share whose `when` contains a tool name
  is at least 20pp lower than R54's store. The test is mechanical: substring match against the
  domain's tool inventory, no judge.
- **The store does not empty.** At least 12 items are admitted. A form change that halves the store
  replaces one defect with another, and the count is the guard.
- **`pass^4` is reported and not claimed.** 57 pairs resolve 20.27pp; a `HARM` verdict reverts under
  R45, and `UNRESOLVED` is expected and stated in advance.
- **No tool name reaches the pack.** Every rendered pack's text is checked for the tool inventory;
  one occurrence means `accept` did not run and the run measured nothing.

## Refutation

- If the accepted store is empty, `accept` is too strict: the noun ban was applied to a lane whose
  every useful sentence names an action. That is a finding about the mechanism, not a reason to
  loosen the ban mid-run.
- If coverage stays under 12% while the tool-name share falls, the trigger is not a vocabulary
  problem at all and the next question is about the *object* being distilled — one correction rather
  than one task trace — which is R55's subject.
- If coverage rises but `pass^4` moves down by more than the resolution, the more topical trigger is
  buying relevance at the cost of the answer, and the revert rule fires.
- If the artefact cannot say which form ran, two runs of one form would read as one experiment of
  two, and the run is `NO_MEASUREMENT`.

## What would make this round worthless

- Changing the note level or the admission rule in the same dispatch. R53 and R55 are registered
  and both are downstream of what the store contains.
- Reading the coverage reading off a different population than R54's. The delivered-pair median is
  the named field now; the non-zero median is the one the 12% bar has always meant, and the artefact
  carries both.
- Quoting the paired delta. It is `UNRESOLVED` by construction and will be again.

## Cost

One dispatch: 32 distillation calls, 57 tasks × 4 trials × 2 arms, about two hours. No new
instrument beyond one `accept` predicate and a tool-inventory constant.

## Sequencing

R55 (material: support counted per distinct task) stays registered behind this one, and its
measurement stage rides on this dispatch's artefact — `storeItems` gains `supportTasks` here, with no
treatment, so the distribution is read for free. R53 (note levels) follows whichever of the two moves
the store, because its question is what a reader does with a pack that is worth reading.
