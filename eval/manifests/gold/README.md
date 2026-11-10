# Corrected labels, vendored

`bird-minidev-arcwise-sql-only.json` is the `sql_only` configuration of **Arcwise-Plat**, the corrected
label set published with:

> Jin, Choi, Zhu and Kang. *Pervasive Annotation Errors Break Text-to-SQL Benchmarks and Leaderboards.*
> PVLDB 19(5):931–944, 2026.

- **Upstream** `https://huggingface.co/datasets/uiuc-kang-lab/arcwise-plat`, file
  `arcwise_plat_sql_only_with_diff.json`; source repository
  `https://github.com/uiuc-kang-lab/text_to_sql_benchmarks`.
- **Licence** CC BY-SA 4.0, the same as the corpus it corrects.
- **SHA-256** `e7bf76408f99266506ea558d84982c69422e5db3dfecab5f08a3a8d3900e8395`, recorded in
  `eval/manifests/bird-minidev.json` and verified before use.
- **498 rows**, one per Mini-Dev SQLite question, with unique `question_id` values.

## Why it is vendored rather than fetched

Because it is read by the *re-scoring* path, which exists to be run offline against artefacts that are
already committed (`pnpm eval:relabel`). A correction that needs the network to read is a correction that
cannot be applied in the one situation it is most needed — a laptop, an hour after a run, with the
artefact and nothing else.

## The check that identifies it

The file's own dataset card states that `evidence` is null for question ids **1507** and **1528**, and
those are exactly the two null rows in this file. A file built by a different pipeline would not
reproduce that pair, so the check distinguishes this revision from a lookalike without trusting a
filename:

```sh
python3 -c "import json;print([r['question_id'] for r in json.load(open('eval/manifests/gold/bird-minidev-arcwise-sql-only.json')) if r.get('evidence') is None])"
# ['1507', '1528']
```

## What it does not agree with

The `sql_only` variant says it kept the questions and replaced only the gold. It kept *its* questions,
which are not the ones `bird-minidev.json` pins: **67 of the 350 questions in this repository's transfer
slice have different text in it**, because BIRD released further Mini-Dev revisions after 2024-06-20
(its 2026 update realigned the ids to 0–499 and revised the questions again). On 44 of those 67 the gold
moved too.

Those rows are the reason `reviseGold` drops rather than relabels: an answer to the pinned question
graded against the corrected question's label is a corpus revision being reported as an annotation fix.
