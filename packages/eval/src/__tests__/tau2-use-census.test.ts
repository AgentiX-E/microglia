/**
 * TDD for the use-side census (TECH-DESIGN §17.89, AUDIT §34.23).
 *
 * R45 (run 42131391874) was the first dispatch to deliver a pack: 1480 of 1480
 * recall requests carried an item, from a store of 21 active items. But the arm
 * record counted only *how many* items were served (`meanPackIds`) and the
 * rewards they preceded. It never recorded *what* was injected or whether any
 * injected statement shared a content term with the question it was served to.
 * `V1-pack-not-empty` grades the first number and is silent on the second, so a
 * `+6.00pp [-6, +20] p=0.5488` reading cannot distinguish "the experiment is
 * underpowered" from "the delivered rules were mostly unrelated to the task".
 *
 * This test is written BEFORE the instrument. It implements the UseCensus type
 * shape registered in §17.89 verbatim (seven fields), plus a derived coverage
 * profile for the finer diagnosis. It uses the pinned 32-task retail fixture,
 * the real tau2 corpora, and the real `queryCoverage` / `tokenize` kernel
 * functions. No mocks, no model call, no new threshold. Two structural proxies
 * bracket the (unavailable offline) LLM statements; the census measures lexical
 * reachability, which is exactly what `buildPack`'s default floor of 0 uses.
 * Only the direction is claimed, never an accuracy effect.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queryCoverage, tokenize } from '@agentix-e/microglia-core/kernel';
import {
  coverageProfile,
  useCensus,
  zeroCoverageShare,
  type UseCensus as UseCensusShape,
  type UseObservation,
} from '../tau2-use-census.js';

type Action = { name: string; arguments: Record<string, unknown> };
type Task = {
  id: string;
  user_scenario: { instructions: { reason_for_call?: string } };
};

const FIXTURE = 'eval/fixtures/tau2-retail-learn-actions.json';
const RETAIL = '/tmp/tau2/retail.json';
const AIRLINE = '/tmp/tau2/airline.json';

const fixtureBytes = readFileSync(FIXTURE);
const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex');
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as {
  tasks: { id: string; actions: Action[] }[];
};
const retail = JSON.parse(readFileSync(RETAIL, 'utf8')) as Task[];
const airline = JSON.parse(readFileSync(AIRLINE, 'utf8')) as Task[];

const reasonFor = (t: Task): string => t.user_scenario.instructions.reason_for_call ?? '';
const structural = (t: { actions: Action[] }): string =>
  t.actions
    .map((a) => [a.name, ...Object.keys(a.arguments ?? {})].join(' '))
    .join(' ')
    .replace(/_/g, ' ');

const learnIds = new Set(fixture.tasks.map((t) => t.id));
const statements = fixture.tasks.map((t) => structural(t));
const heldOutRetail = retail.filter((t) => !learnIds.has(t.id)).map(reasonFor);
const airlineQueries = airline.map(reasonFor);

/**
 * One recall request as the facade saw it: a question, and the statements of
 * the items in the pack it served (an empty pack has an empty array). Each
 * question is paired with every statement in the store, which is the population
 * `buildPack` selects from when `minCoverage` is 0.
 */
function observations(queries: readonly string[], docs: readonly string[]): UseObservation[] {
  return queries.map((query) => ({ query, statements: docs }));
}

describe('useCensus — the population V1 cannot see', () => {
  it('is pinned to the exact R45 learn split', () => {
    expect(fixtureHash).toBe('b5e49bb793731ec107754452e70e608c54b309c54f3be2ad049c82ffb40c87a0');
    expect(fixture.tasks).toHaveLength(32);
    expect(statements).toHaveLength(32);
  });

  it('returns a zeroed census that says which zero it is, not undefined', () => {
    const empty = useCensus([], 'as-is', 0);
    expect(empty.arm).toBe('as-is');
    expect(empty.recallRequests).toBe(0);
    expect(empty.recallServed).toBe(0);
    expect(empty.meanPackIds).toBe(0);
    expect(empty.injectedPairs).toBe(0);
    expect(empty.zeroCoveragePairs).toBe(0);
    expect(empty.widenedItems).toBe(0);
    expect(zeroCoverageShare(empty)).toBe(0);
    const profile = coverageProfile([]);
    expect(profile).toEqual({
      measuredPairs: 0,
      unmeasurablePairs: 0,
      meanCoverage: 0,
      buckets: { zero: 0, partial: 0, full: 0 },
    });
  });

  it('counts requests, served packs, and the mean pack size from the observations', () => {
    const obs: UseObservation[] = [
      { query: 'cancel my reservation', statements: ['cancel reservation'] },
      { query: 'refund my order', statements: [] }, // an empty pack
      { query: 'change my seat', statements: ['change seat', 'verify identity'] },
    ];
    const c = useCensus(obs, 'as-is', 0);
    expect(c.recallRequests).toBe(3);
    expect(c.recallServed).toBe(2);
    expect(c.meanPackIds).toBeCloseTo(1, 10); // (1 + 0 + 2) / 3
    expect(c.injectedPairs).toBe(3);
  });

  it('measures only query pairs with content terms, and reports the rest', () => {
    // Real kernel values, not guessed: 'my' is a stopword, so
    // 'cancel my reservation' vs 'cancel reservation' is full coverage (1),
    // 'cancel my reservation refund' is partial (2/3), and 'refund order' is 0.
    const obs: UseObservation[] = [
      { query: 'cancel my reservation', statements: ['cancel reservation'] }, // coverage 1
      { query: 'cancel my reservation refund', statements: ['cancel reservation'] }, // coverage 2/3
      { query: 'refund order', statements: ['cancel reservation'] }, // coverage 0
      { query: 'the and of', statements: ['cancel reservation'] }, // no content terms
    ];
    const c = useCensus(obs, 'as-is', 0);
    const profile = coverageProfile(obs);
    expect(c.injectedPairs).toBe(4);
    expect(profile.measuredPairs).toBe(3);
    expect(profile.unmeasurablePairs).toBe(1);
    // useCensus counts every kernel-zero pair, including the content-free query;
    // coverageProfile buckets measured pairs only, so it sees one zero, not two.
    expect(c.zeroCoveragePairs).toBe(2);
    expect(profile.buckets.zero).toBe(1);
    expect(profile.buckets.partial).toBe(1);
    expect(profile.buckets.full).toBe(1);
  });

  it('agrees with the real kernel on a hand-computable pair', () => {
    const query = 'cancel my reservation refund';
    const statement = 'cancel reservation';
    const expected = queryCoverage(query, statement);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    const profile = coverageProfile([{ query, statements: [statement] }]);
    expect(profile.meanCoverage).toBeCloseTo(expected, 10);
    expect(profile.buckets.partial).toBe(1);
    expect(useCensus([{ query, statements: [statement] }], 'as-is', 0).zeroCoveragePairs).toBe(0);
  });

  it('counts widened items from the store, not from the pairs', () => {
    const c = useCensus([{ query: 'cancel', statements: ['cancel'] }], 'widening-enabled', 7);
    expect(c.arm).toBe('widening-enabled');
    expect(c.widenedItems).toBe(7);
    expect(c.injectedPairs).toBe(1);
  });

  it('reproduces the transfer penalty in the pinned corpus, both proxies', () => {
    const cross = useCensus(observations(airlineQueries, statements), 'as-is', 0);
    const within = useCensus(observations(heldOutRetail, statements), 'as-is', 0);
    expect(cross.injectedPairs).toBe(1600); // 50 airline questions x 32 rules
    expect(within.injectedPairs).toBe(2624); // 82 held-out retail questions x 32 rules
    expect(zeroCoverageShare(cross)).toBeGreaterThan(0.7);
    expect(zeroCoverageShare(cross)).toBeLessThan(0.8);
    expect(zeroCoverageShare(within)).toBeLessThan(0.25);
    expect(zeroCoverageShare(cross)).toBeGreaterThan(zeroCoverageShare(within) + 0.5);
  });

  it('a floor of 0 excludes nothing: default buildPack makes every pair a candidate', () => {
    const cross = observations(airlineQueries, statements);
    const pairs = cross.flatMap((o) => o.statements.map((s) => queryCoverage(o.query, s)));
    expect(pairs.filter((c) => c >= 0).length).toBe(pairs.length);
    expect(useCensus(cross, 'as-is', 0).injectedPairs).toBe(pairs.length);
  });

  it('the registered shape is exactly the seven fields and survives a JSON round trip', () => {
    const c: UseCensusShape = useCensus(
      observations(airlineQueries.slice(0, 3), statements),
      'coverage-floored',
      2,
    );
    const round = JSON.parse(JSON.stringify(c)) as UseCensusShape;
    expect(round).toEqual(c);
    expect(Object.keys(round).sort()).toEqual(
      [
        'arm',
        'injectedPairs',
        'meanPackIds',
        'recallRequests',
        'recallServed',
        'widenedItems',
        'zeroCoveragePairs',
      ].sort(),
    );
  });
});
