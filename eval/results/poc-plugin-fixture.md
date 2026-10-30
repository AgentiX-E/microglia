# Run offline-fixture

Generator **keyword-router** 1.0.0, loaded from `eval/plugins/keyword-router.mjs` under contract `candidate-generator/1`.

6 cases, multiset comparison, concurrency 1, pre-registration `R8.1-offline-fixture`.

| Metric | Value |
|---|---|
| answered | 6 of 6 |
| correct | 2 |
| accuracy | 33.33% (95% CI 9.68%–70.00%) |
| generated | 2026-10-30T04:00:00.000Z |

## Per database

| Database | Cases | Correct | Accuracy |
|---|---|---|---|
| shop | 3 | 1 | 33.33% |
| library | 3 | 1 | 33.33% |

## Cases

| Case | Database | Verdict | Answer |
|---|---|---|---|
| shop#1 | shop | wrong | SELECT count(*) FROM customer |
| shop#2 | shop | wrong | SELECT * FROM customer |
| shop#3 | shop | correct | SELECT count(*) FROM orders |
| library#1 | library | correct | SELECT count(*) FROM book |
| library#2 | library | wrong | SELECT * FROM book |
| library#3 | library | wrong | SELECT count(*) FROM loan |

## Gates

| Gate | Name | Verdict | Detail |
|---|---|---|---|
| V27 | third-party-module | pass | loaded from eval/plugins/keyword-router.mjs, outside packages/eval |
| V30 | preregistration | pass | executes prereg/R8.1-offline-fixture.md |
| V29 | answer-rate | pass | 6/6 answered = 100.00%, floor 99.00% |
