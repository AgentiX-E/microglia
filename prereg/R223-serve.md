---
id: R223-serve
step: R223
opened: 2026-11-26
arms: none
sample: 228
gates: V0
recallFloor: 0
---

# R223 — when nothing should be served, screened before it is armed

Registered 26 November 2026. No dispatch: the round's instrument is a replay over grid R218b, which already holds a
no-memory arm and a treated arm over the same 114 tasks with four attempts each. The round exists because the arm-level
means in this lane have been answering the wrong question. Stratified on the control's own pass rate, the front
placement loses **9.5 points** on the 66 tasks the control solved every attempt and gains **7.5** on the 43 it solved
some of; the two cancel by population, which is why every arm mean has read flat while the mechanism underneath it is
two opposite findings (PROGRESS 249.18). A serving decision is therefore worth more than any rewrite of the block's
text. The instrument is `eval/tools/serve_policy.py` and it has already run, so this document registers the round by
its first result rather than by its expectation.

## What is measured

For a policy that maps an episode's **prefix** to serve or skip, the value over the 228 paired episodes is
`serve(x) · y_treated + skip(x) · y_control`, and the two columns that decide whether it is worth running are the
conditional means over the subsets it creates:

| quantity | what it is |
|---|---|
| `skipDelta` | mean over the skipped pairs of `y_control − y_treated`: what skipping bought, on the pairs that were skipped |
| `serveDelta` | mean over the served pairs of `y_treated − y_control`: what serving bought, on the pairs that were served |
| `skip.p` | the two-sided exact sign test over the skipped pairs that disagreed |
| `servedShare` | how much of the grid the policy still serves, which is what separates a decision from a restatement |
| `expectedByChance` | the number of admissible cuts a screen of this size produces from noise alone, at 2.5% per cut |

Selection is split-half: cuts are chosen on the tasks at even positions in sorted order and judged on the rest, so a
cut that only reads well in sample returns `NOT_CONFIRMED`. `ADMISSIBLE` requires a positive `skipDelta`, `skip.p` below
0.05, `serveDelta` at or above zero, and at least ten discordant pairs on the skip side.

## The screen's result, which is this round's finding

Three hundred and eighty-five cuts, one of them admissible in sample, and the one that survived did not replicate:
`skip openingAsks at least 2` bought **+13.8 points** on 15 discordant pairs (13 up, 2 down, p = 0.0074) on the screen
half and **+3.2 points** on 21 discordant pairs (12 up, 9 down, p = 0.66) on the half it never saw. Against a
multiplicity of roughly **ten** chance discoveries at that many cuts, a yield of one is a family with no signal rather
than a family with a faint one.

Two candidate proxies are now dead at zero cost, both on artefacts that were already on disk: the opening turn's ask
count fires on 110 of 114 openings (96.5%) and the first tool call is the identity lookup in 452 of 456 episodes
(99.1%), so neither separates enough of the grid to be a decision. The first tool call is `find_user_id_by_name_zip`
or `find_user_id_by_email` and the second act is `get_user_details` in 355 of 456, which means the episode's first two
acts carry no task information at all: "serve after the model has acted once" gates on authentication.

## Prediction

- **No prefix observable built from the request or from the identity gate will survive the split-half screen.** The
  screen is the test and the prediction is its yield: at most one admissible cut, and `NOT_CONFIRMED` on the held-out
  half. A second survivor with a positive confirm-half reading would refute the reading above and would be the first
  candidate worth arming.
- **The opening turn is a task-level covariate, not an episode-level one.** It is the user simulator's fixed utterance,
  so it is identical across a task's four attempts on 100% of tasks; any cut on it is an admission rule for a task
  class rather than a serving gate for one attempt, which is why its failure to transfer across task halves is
  evidence about task classes and not about turns.
- **The successor proxy has to read what the episode reveals after the identity gate** — the order, the item, the
  returned attribute row — because that is the first content in the transcript that differs between a task the control
  already solves and one it does not, and it is the only candidate family that can vary inside a task.

## Refutation

- **A prefix cut that passes both halves with a positive `skipDelta` and a serve half that does not lose** refutes the
  reading above and re-opens the dispatch: the round then costs 9 CNY for a two-arm grid at 228 episodes, and the
  prediction becomes the replication of that cut rather than the absence of one.
- **A successor proxy that reads the revealed content and still yields nothing on the screen** refutes the serving
  hypothesis altogether, and the honest consequence is that the harm is a property of the material's *presence* rather
  than of its content or its timing: every later quote of the +7.5 / −9.5 split then has to say that no observable
  decision recovers it, and the design question moves from gating to removing.
- **A screen whose admissible cut carries fewer than ten discordant pairs on the skip side** is refused as
  underpowered rather than accepted as a small effect, because a unanimous sign test over four pairs is p = 0.125 and
  a policy promoted from it would be promoted on arithmetic that cannot distinguish it from noise.
