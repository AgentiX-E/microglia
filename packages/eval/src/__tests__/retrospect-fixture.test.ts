import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAIN_COHESION_FLOOR,
  clusterCensusOf,
  clusterSources,
  DEFAULT_CLUSTER_OPTIONS,
  deterministicProposal,
} from '@agentix-e/microglia-core/retrospect';
import { readStoreDump, reconcileSides, refusalOf, storeDumpItems } from '../retrospect-store.js';

/**
 * The committed store, and what the pipeline is allowed to read out of it.
 *
 * `pnpm eval:retrospect-fixture` runs the real program on this file on every push, and a program that
 * only exits 0 teaches nothing: the numbers below are the ones the fixture was written to produce.
 * They are asserted here so that editing a statement, a side or the census — the three ways this file
 * can stop meaning what it says — fails a test rather than quietly changing what the gate exercises.
 */
const path = resolve(process.cwd(), 'eval/fixtures/retrospect-store.json');

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('the retrospection fixture', () => {
  it('is a store dump the reader accepts, with every record classified', () => {
    const dump = storeDumpItems(fixture(), 'retrospect-store.json');
    expect(dump.omitted).toBe(0);
    const reading = readStoreDump(dump.items, 'unknown');
    expect(reading.total).toBe(6);
    expect(reading.repairs).toBe(4);
    expect(reading.passes).toBe(2);
    expect(reading.unclassified).toBe(0);
    expect(reading.skipped).toBe(0);
    expect(refusalOf(reading, 'retrospect-store.json')).toBeUndefined();
  });

  it('reconciles against its own provenance census, which is what the program refuses on', () => {
    const raw = fixture();
    const reading = readStoreDump(storeDumpItems(raw, 'x').items, 'unknown');
    const census = (raw['tau2'] as { provenance: Parameters<typeof reconcileSides>[1]['census'] }).provenance;
    expect(reconcileSides(reading, { census, omitted: 0 }).state).toBe('agree');
  });

  it('clusters its three order/item corrections into one reviewable guideline', () => {
    const reading = readStoreDump(storeDumpItems(fixture(), 'x').items, 'unknown');
    const repairs = reading.sources.filter((source) => source.outcome === 'repair');
    const clusters = clusterSources(repairs, DEFAULT_CLUSTER_OPTIONS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toHaveLength(3);
    // Two distinct tasks behind the shared trigger, which is the quantity retrospection exists to
    // raise: the corpus is six records and the guideline is taught by two of them.
    expect(deterministicProposal(clusters[0]!).when.length).toBeGreaterThan(0);
    const census = clusterCensusOf(reading.sources, clusters, CHAIN_COHESION_FLOOR);
    // The refund correction shares no condition with the join corrections, and that orphan is the
    // fragmentation the fixture was built to produce.
    expect(census.orphans).toBe(1);
    expect(census.fragmentation).toBeCloseTo(0.25, 4);
    expect(census.chained).toBe(0);
  });

  it('keeps the successes out of the corpus a guideline is written from', () => {
    const reading = readStoreDump(storeDumpItems(fixture(), 'x').items, 'unknown');
    expect(reading.sources.filter((source) => source.outcome === 'pass')).toHaveLength(2);
    expect(
      reading.sources.some((source) => source.outcome === 'pass' && source.taskId === 'order.items'),
    ).toBe(false);
  });
});
