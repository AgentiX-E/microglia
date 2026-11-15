/**
 * Pool repeated dispatches of **one arm** into one estimate.
 *
 * `l4-pool` pools two *domains* of one treatment on one dispatch; this pools one domain across several
 * dispatches, which is the other way a lane's sample grows. They are different questions and neither guard set
 * works for the other: a domain pool refuses a task that appears in both arms because the arms are meant to be
 * disjoint, while a dispatch pool *requires* the same tasks to appear again.
 *
 * Why it exists: R131 read `pass^4` 0.625 on the arm that read 0.775 in R123a and 0.750 in R124, and the record
 * had been quoting the largest of the three as the arm's score. Three numbers of one arm are an estimate with an
 * interval, and until this reader existed the interval was the thing nobody printed.
 *
 * Usage:
 *   L4_DISPATCHES="R123a=eval/results/history/l4-arm-memory-c2.json,R124=eval/results/history/l4-arm-memory-67.json" \
 *     pnpm eval:dispatch-pool
 *
 * The arm documents are the per-arm `poc-l4.json` files this lane already writes. A document that does not say
 * which `k` it ran is refused rather than guessed: `pass4` has been the field name since before `k` existed, and
 * R132 published `pass4: 0.825` at `k: 2`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dispatchRowOf, poolDispatches, dispatchPoolLine, type DispatchRow } from '../dispatch-pool.js';
import { writeJson } from './lib.js';

const SPEC = process.env['L4_DISPATCHES'] ?? '';
if (SPEC.trim() === '') {
  process.stderr.write(
    '[dispatch-pool] L4_DISPATCHES is empty; it names the arm documents as label=path,label=path\n',
  );
  process.exit(2);
}

const rows: DispatchRow[] = [];
for (const entry of SPEC.split(',')) {
  const at = entry.indexOf('=');
  if (at <= 0) {
    process.stderr.write(`[dispatch-pool] '${entry}' is not label=path\n`);
    process.exit(2);
  }
  const label = entry.slice(0, at).trim();
  const path = entry.slice(at + 1).trim();
  if (!existsSync(path)) {
    process.stderr.write(`[dispatch-pool] ${label} names ${path}, which does not exist\n`);
    process.exit(2);
  }
  const row = dispatchRowOf(label, JSON.parse(readFileSync(path, 'utf8')));
  if (row === undefined) {
    // The refusal names the field, because a dropped dispatch is a selection and this record has paid for
    // silent selections (AUDIT 34.164).
    process.stderr.write(
      `[dispatch-pool] ${label} (${path}) carries no readable metrics.pass4 / metrics.tasks / metrics.k, so it ` +
        'cannot be pooled; an artefact without `k` predates the field and its k cannot be inferred from a name\n',
    );
    process.exit(2);
  }
  rows.push(row);
}

const reading = poolDispatches(rows);
for (const row of rows) {
  process.stdout.write(
    `[dispatch-pool]   ${row.dispatch}: pass^${String(row.k)} ${(row.passAtK * 100).toFixed(2)}% over ` +
      `${String(row.tasks)} task(s)` +
      (row.episodeRate === undefined ? '' : `, episode rate ${(row.episodeRate * 100).toFixed(2)}%`) +
      '\n',
  );
}
process.stdout.write(`[dispatch-pool] ${dispatchPoolLine(reading)}\n`);
writeJson('poc-dispatch-pool', {
  id: 'poc-dispatch-pool',
  title: 'One arm across several dispatches: the estimate and the interval nobody printed',
  notes: [
    'The pool is random-effects (DerSimonian-Laird) when the dispatches disagree by more than their own sampling',
    'error, and fixed-effect otherwise; the interval uses t(dispatches-1) in the first case and the normal',
    'quantile in the second, because the uncertainty then comes from the episodes rather than from the spread',
    'between dispatches.',
    'A pass^k whose k differs between dispatches is refused: averaging a pass^2 with a pass^4 under one name is',
    'the defect this record has already paid for in a field name.',
  ],
  rows,
  ...(reading === undefined ? {} : { reading }),
});
