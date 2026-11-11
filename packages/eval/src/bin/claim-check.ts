/**
 * Refuse a committed artefact that records the hour or the host rather than a claim.
 *
 * The gate that needs this is `pnpm check`: it runs every lane, every lane writes its artefact, and
 * six of those files used to carry `ranAt` or a per-arm latency. The result was a working tree that
 * was dirty after every run, a "local green / CI red" that nobody could explain, and one commit that
 * carried 279 lines of a sandbox's p50/p95 beside two experiment outcomes.
 *
 * It is a check rather than a formatter on purpose. `writeJson` strips these keys, so the corpus is
 * clean by construction — until a lane writes its own file, or a hand-edited artefact arrives, or a
 * new field is invented in the shape of the old ones. A formatter would absorb that silently, which is
 * exactly how the original six got in.
 *
 * Usage: pnpm eval:claim-check
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { volatileKeysIn } from '../claim.js';

const ROOTS = ['eval/results', 'bench/results'] as const;

function main(): void {
  const offenders: string[] = [];
  let scanned = 0;
  for (const root of ROOTS) {
    let names: string[];
    try {
      names = readdirSync(root).filter((name) => name.endsWith('.json'));
    } catch {
      // A lane that has never run in this checkout is not a failure; the check is about the files
      // that exist, and the corpus assertion in `claim.test.ts` is what keeps the paths honest.
      continue;
    }
    for (const name of names) {
      scanned += 1;
      const file = join(root, name);
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      for (const path of volatileKeysIn(parsed)) offenders.push(`${file}: ${path}`);
    }
  }

  if (offenders.length === 0) {
    process.stdout.write(`[claim-check] ${scanned} artefact(s), no clock and no host timing\n`);
    return;
  }
  for (const line of offenders) process.stderr.write(`[claim-check] ${line}\n`);
  process.stderr.write(
    '[claim-check] an artefact records a claim about the code; the hour and the machine belong in ' +
      'eval/results/.volatile/, which is not committed. Re-run the lane rather than editing the file.\n',
  );
  process.exitCode = 1;
}

main();
