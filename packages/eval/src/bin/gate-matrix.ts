/**
 * Write `docs/GATE-COVERAGE-MATRIX.md` from the tables.
 *
 * The projection lives in `../gate-matrix.ts` so that it is covered by the suite; this file is the
 * command, and it does two things the module must not: read an artefact off disk and write a file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gateRows, renderMatrix } from '../gate-matrix.js';

export function main(argv: readonly string[]): number {
  const arg = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const artefactPath = arg('bird', 'eval/results/poc-sota-bird-dev.json');
  const out = arg('out', '');
  const artefact = JSON.parse(readFileSync(artefactPath, 'utf8')) as {
    readonly gates?: readonly { readonly id: string }[];
  };
  const birdIds = (artefact.gates ?? []).map((entry) => entry.id);
  const markdown = renderMatrix(gateRows(birdIds), `\`${artefactPath}\``);
  if (out === '') {
    process.stdout.write(markdown);
    return 0;
  }
  writeFileSync(out, markdown, 'utf8');
  process.stdout.write(`[gate-matrix] ${String(birdIds.length)} gate(s) in ${artefactPath} -> ${out}\n`);
  return 0;
}

main(process.argv.slice(2));
