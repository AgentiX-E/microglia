/**
 * What folding by shape would do to a store, measured on a committed corpus and costing nothing.
 *
 * R109's mechanism is a pure function over a pack, so the question "how many units would there be, and
 * what support would they carry" can be answered before any episode is paid for. This is the same move
 * `tau2-merge.ts` made for the census and `maxStatementChars` made for capacity: size the treatment
 * first, and register the arm only if the number says there is one.
 *
 * The corpus is `eval/fixtures/tau2-retail-learn-actions.json` — the first 32 retail tasks in lexical
 * order with their reference actions, pinned by sha256 — because it is committed, reproducible, and the
 * same list the earlier supply censuses used. What this prints is therefore a statement about a
 * *corpus*, not about a run's store: a run's store holds the tasks its model failed, and the population
 * is a subset of this one. The artefact says so in its own field rather than in a comment nobody reads.
 *
 * Usage: pnpm eval:pack-shape [budget] -> one JSON document on stdout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createKnowledgeItem, defaultPolicy } from '@agentix-e/microglia-core';
import type { KnowledgeItem } from '@agentix-e/microglia-core';
import type { TauAction } from '../tau2.js';
import { foldByShape } from '@agentix-e/microglia-core/apply';
import { renderPack } from '@agentix-e/microglia-core/apply';
import { actionSentence } from '../tau2.js';
import { tau2ShapeOf } from '../tau2-shape.js';

const AT = 1_700_000_000_000;

/** The default budget is R101's pack: the arm this mechanism is registered against. */
const DEFAULT_BUDGET = 2400;

/**
 * The ceiling the prefix arm renders under, from `pack-mode-plan.ts`.
 *
 * Present so the store's *whole* text can be measured in both modes: the fold's claim is that the same
 * knowledge costs fewer characters, and a number taken at a 2,400-character budget measures which five
 * records happen to fit rather than how much the store weighs.
 */
const CEILING = 200_000;

type Fixture = {
  readonly source: { readonly corpus: string; readonly sha256: string; readonly split: string };
  readonly tasks: readonly { readonly id: string; readonly actions: readonly TauAction[] }[];
};

/**
 * The corpus, resolved the way every other bin in this directory resolves one: from the repository root.
 *
 * `pnpm eval:*` runs at the root, and a path derived from `import.meta.url` would be a path inside
 * `dist/` once the package is built — the same file, addressed differently by the two ways this lane
 * runs its own scripts.
 */
function fixturePath(): string {
  return join(process.cwd(), 'eval/fixtures/tau2-retail-learn-actions.json');
}

/**
 * One record per task, in the shape the raw-log arm writes.
 *
 * The question line is the task id because the fixture carries actions and not instructions, and a
 * record with no question is a record a lexical retriever cannot find. That matters to retrieval and
 * not to this census: what is being counted is the routine, which is the answer line.
 */
function recordOf(task: Fixture['tasks'][number]): KnowledgeItem {
  const statement = [
    `Q: task ${task.id}`,
    `A: ${task.actions.map(actionSentence).join('; ')}`,
  ].join('\n');
  return createKnowledgeItem(
    {
      namespace: 'tau2',
      kind: 'exemplar',
      scope: { task: 'tau2.act' },
      statement,
      payload: { calls: task.actions.length },
      evidence: {
        feedbackId: `f_${task.id}`,
        runId: `r_${task.id}`,
        at: AT,
        taskId: task.id,
        weight: 0.9,
      },
      trust: 0.9,
      dedupeKey: `rawlog|${task.id}`,
    },
    defaultPolicy,
    AT,
    `k_${task.id}`,
  );
}

function main(): void {
  const raw = (process.argv[2] ?? '').trim();
  const budget = raw === '' ? DEFAULT_BUDGET : Number(raw);
  if (!Number.isInteger(budget) || budget < 1) {
    process.stderr.write(`[pack-shape] budget must be a positive integer of characters, not '${raw}'\n`);
    process.exitCode = 1;
    return;
  }
  const fixture = JSON.parse(readFileSync(fixturePath(), 'utf8')) as Fixture;
  const items = fixture.tasks.map(recordOf);

  const before = foldByShape(items, { mode: 'per-failure', shapeOf: tau2ShapeOf });
  const after = foldByShape(items, { mode: 'collapse', shapeOf: tau2ShapeOf });

  // What each mode's store renders when the whole of it is offered at one budget. The prefix arm is the
  // one place that happens, and it is the arrangement the fold is supposed to pay for: fewer lines of
  // more support inside the same block.
  const served = (
    units: readonly KnowledgeItem[],
    at: number = budget,
  ): { ids: number; truncated: number; chars: number } => {
    const rendered = renderPack(units, { budget: at });
    return {
      ids: rendered.ids.length,
      truncated: rendered.truncated,
      chars: rendered.rendered.length,
    };
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        corpus: fixture.source,
        budget,
        tasks: fixture.tasks.length,
        records: items.length,
        perFailure: {
          units: before.items.length,
          shapes: before.items.length - before.folded,
          support: before.support,
          atBudget: served(before.items),
          wholeStore: served(before.items, CEILING),
        },
        collapse: {
          units: after.items.length,
          folded: after.folded,
          groups: after.groups.length,
          refused: after.refused,
          support: after.support,
          atBudget: served(after.items),
          wholeStore: served(after.items, CEILING),
        },
        // The shape of the result, stated so a reader does not have to derive it: this is what the
        // collapse does to the same 32 tasks, and the number the arm is registered to move.
        foldedShare: items.length === 0 ? 0 : Number((after.folded / items.length).toFixed(4)),
        // The compression the fold claims, over the whole store rather than over what fits a pack.
        charsRatio:
          before.items.length === 0
            ? 0
            : Number(
                (
                  served(after.items, CEILING).chars / served(before.items, CEILING).chars
                ).toFixed(4),
              ),
        supportRows: after.groups
          .slice()
          .sort((left, right) => right.support - left.support || left.shape.localeCompare(right.shape))
          .map((group) => ({ shape: group.shape, members: group.members.length, support: group.support })),
      },
      null,
      2,
    )}\n`,
  );
}

main();
