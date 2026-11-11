/**
 * Read a τ² artefact and print what the store it produced actually contains, by support.
 *
 * R55.0's question — "does any claim recur?" — is a property of the store, and the store is already
 * paid for: every τ² dispatch since R58 writes `tau2.storeItems` with one `supportTasks` count per
 * item. Until this command existed the only way to ask was `store-sweep`, which answers a different
 * question (what a consolidation floor would do) and prints a group count rather than a distribution.
 *
 * Prints `whole` beside the histogram because a sample that omitted items cannot answer the question
 * under the store's name: `atLeastThree: 0` over 64 of 400 items is a fact about 64 items.
 *
 * Usage: recurrence <poc-l4.json>
 */
import { readFileSync } from 'node:fs';
import { recurrenceCensus } from '../recurrence.js';
import type { StoreItemSample } from '../store-items.js';

type Artefact = {
  readonly tau2?: {
    readonly storeItems?: StoreItemSample;
    readonly distillUnit?: { readonly unit?: string; readonly traces?: number };
    readonly distillForm?: { readonly form?: string; readonly refused?: number };
    readonly learning?: { readonly rows?: number; readonly distilled?: number; readonly distillFailed?: number };
    readonly tasks?: number;
    readonly meanPackIds?: number;
  };
};

function main(argv: readonly string[]): number {
  const path = argv[0];
  if (path === undefined) {
    process.stderr.write('usage: recurrence <poc-l4.json>\n');
    return 2;
  }
  const document = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  const store = document.tau2?.storeItems;
  if (store === undefined) {
    // A pre-R58 artefact cannot answer this, and saying so beats printing a zero that reads like a
    // store with no recurrence.
    process.stderr.write(
      `${path} carries no sampled store: it predates the field, so this is not a reading of zero recurrence\n`,
    );
    return 2;
  }
  const census = recurrenceCensus(store);
  const unit = document.tau2?.distillUnit?.unit ?? 'not recorded';
  const form = document.tau2?.distillForm?.form ?? 'not recorded';
  const learning = document.tau2?.learning;
  process.stdout.write(
    [
      `store: ${String(census.sampled)} item(s) sampled, ${String(census.omitted)} omitted, whole=${String(census.whole)}`,
      `support: ${Object.entries(census.histogram)
        .map(([support, count]) => `${support}×${String(count)}`)
        .join(' ')} (max ${String(census.max)})`,
      `corroborated: ${String(census.atLeastTwo)} at ≥2 task(s), ${String(census.atLeastThree)} at ≥3`,
      `items per learning row: ${
        learning?.distilled === undefined || learning?.rows === undefined || learning.rows === 0
          ? 'unknown'
          : (learning.distilled / learning.rows).toFixed(3)
      } (${String(learning?.distilled ?? 0)} distilled of ${String(learning?.rows ?? 0)} row(s), ${String(
        learning?.distillFailed ?? 0,
      )} failed)`,
      `served: mean ${String(document.tau2?.meanPackIds ?? 0)} item(s) per request over ${String(
        document.tau2?.tasks ?? 0,
      )} task(s)`,
      `distiller: ${unit}/${form}`,
    ].join('\n') + '\n',
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
