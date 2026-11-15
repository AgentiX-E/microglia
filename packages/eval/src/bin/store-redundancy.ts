#!/usr/bin/env node
/**
 * Read a store's redundancy out of an artefact, at no cost and with no model call.
 *
 *   pnpm tsx packages/eval/src/bin/store-redundancy.ts eval/results/arms/memory/poc-l4.json
 *
 * The artefact's `tau2.storeItems` is a bounded sample of the store — the first N items, each clipped at a
 * fixed width — so this prints the sample's size against the store's and passes each clipped row through as
 * clipped. A reading over a sample with clipped inputs is an upper bound, and the line says so rather than
 * letting the number travel without it.
 *
 * Nothing here decides anything: the census and its sentence both come from `store-redundancy.ts`, which is
 * where the key is, so the number a reader quotes and the number a test asserts are the same function of the
 * same statements.
 */
import { readFileSync } from 'node:fs';
import { redundancyLine, storeRedundancy } from '../store-redundancy.js';

type Artefact = {
  readonly tau2?: {
    readonly storeItems?: {
      readonly items?: readonly { readonly statement?: string }[];
      readonly omitted?: number;
      readonly truncated?: number;
    };
  };
};

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('[redundancy] usage: store-redundancy.ts <artefact.json>\n');
  process.exit(2);
}

let document: Artefact;
try {
  document = JSON.parse(readFileSync(file, 'utf8')) as Artefact;
} catch {
  process.stderr.write(`[redundancy] ${file} is not readable JSON\n`);
  process.exit(2);
}

const sample = document.tau2?.storeItems;
const items = sample?.items ?? [];
if (items.length === 0) {
  // An absence, not a zero: an artefact written before `storeItems` existed cannot report redundancy.
  process.stdout.write(`redundancy: absent (${file} carries no storeItems)\n`);
  process.exit(0);
}

// A clipped row is one the projection cut. The sample's own `truncated` count is over statement *and*
// condition, so the two need not be equal; the sample's number is the one that governs the caveat.
const statements = items.map((item) => ({
  statement: item.statement ?? '',
  clipped: (sample?.truncated ?? 0) > 0,
}));
const census = storeRedundancy(statements);
const omitted = sample?.omitted ?? 0;
process.stdout.write(`${redundancyLine(census)}\n`);
process.stdout.write(
  `redundancy: sample ${String(census.statements)} of ${String(census.statements + omitted)} item(s)` +
    `${omitted === 0 ? ', which is the whole store' : ''}\n`,
);
