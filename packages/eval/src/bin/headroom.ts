/**
 * Read the headroom of pair artefacts: what each fold could have shown against the finest thing it could see.
 *
 * R154's table is computed by this command rather than assembled by hand, because the table is the argument
 * — four folds, four ceilings, all below their own resolutions — and an argument copied from a terminal by a
 * human is an argument nobody can re-run. It reads the numbers the pair already carries: the control's
 * `pass^4`, the paired count, and the resolution the protocol block recorded.
 *
 * Exits non-zero when a fold in the list could not express an effect, because that is the finding and a
 * command that returned success for every input would be a command whose verdict nobody reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldHeadroom } from '../headroom.js';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write('usage: headroom <pair-artefact.json ...>\n');
  process.exit(2);
}

type PairShape = {
  readonly first?: { readonly pass4?: number };
  readonly comparison?: { readonly paired?: number };
  readonly protocol?: { readonly detectablePp?: number };
};

let silent = 0;
process.stdout.write('| fold | n | control pass^4 | ceiling | minimum detectable | verdict |\n');
process.stdout.write('| --- | --- | --- | --- | --- | --- |\n');
for (const path of paths) {
  const absolute = path.startsWith('/') ? path : join(process.cwd(), path);
  const pair = JSON.parse(readFileSync(absolute, 'utf8')) as PairShape;
  const paired = pair.comparison?.paired;
  const controlPass4 = pair.first?.pass4;
  if (typeof paired !== 'number' || typeof controlPass4 !== 'number') {
    process.stderr.write(`headroom: ${path} carries no paired count or no control pass^4\n`);
    process.exit(2);
  }
  const headroom = foldHeadroom({ paired, controlPass4, detectablePp: pair.protocol?.detectablePp });
  const resolution =
    headroom.detectablePp === undefined ? 'not estimated' : `${headroom.detectablePp.toFixed(2)}pp`;
  const name = path.replace(`${process.cwd()}/`, '').replace('eval/results/', '').replace('.json', '');
  process.stdout.write(
    `| \`${name}\` | ${String(paired)} | ${controlPass4.toFixed(4)} | **${headroom.ceilingPp.toFixed(2)}pp** | ` +
      `${resolution} | ${headroom.verdict} |\n`,
  );
  if (headroom.verdict !== 'expressible') silent += 1;
}

process.stdout.write(
  `\n${String(silent)} of ${String(paths.length)} fold(s) could not express an effect even with a perfect store\n`,
);
if (silent > 0) process.exit(1);
