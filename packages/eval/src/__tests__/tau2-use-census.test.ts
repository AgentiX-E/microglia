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
 * profile for the finer diagnosis. It uses a fingerprinted, repository-local
 * fixture (see `tau2-use-census-queries.json`) and the real `queryCoverage` /
 * `tokenize` kernel functions. No mocks, no model call, no new threshold, and
 * no dependency on a scratchpad corpus: the first version read `/tmp/tau2/*.json`
 * and passed locally while failing CI with ENOENT (AUDIT §34.25). Two structural
 * proxies bracket the (unavailable offline) LLM statements; the census measures
 * lexical reachability, which is exactly what `buildPack`'s default floor of 0
 * uses. Only the direction is claimed, never an accuracy effect.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryCoverage, tokenize } from '@agentix-e/microglia-core/kernel';
import {
  coverageProfile,
  useCensus,
  zeroCoverageShare,
  type UseCensus as UseCensusShape,
  type UseObservation,
} from '../tau2-use-census.js';

const QUERIES = join(process.cwd(), 'eval/fixtures/tau2-use-census-queries.json');
const LEARN = join(process.cwd(), 'eval/fixtures/tau2-retail-learn-actions.json');

const queriesBytes = readFileSync(QUERIES);
const learnBytes = readFileSync(LEARN);
const queries = JSON.parse(queriesBytes.toString('utf8')) as {
  readonly source: {
    readonly corpora: readonly { readonly name: string; readonly sha256: string; readonly bytes: number }[];
  };
  readonly learnStatements: readonly string[];
  readonly airlineQueries: readonly string[];
  readonly heldOutRetailQueries: readonly string[];
};
const learn = JSON.parse(learnBytes.toString('utf8')) as {
  readonly tasks: readonly { readonly id: string; readonly actions: unknown[] }[];
};

const statements = queries.learnStatements;
const airlineQueries = queries.airlineQueries;
const heldOutRetail = queries.heldOutRetailQueries;

/**
 * One recall request as the facade saw it: a question, and the statements of
 * the items in the pack it served (an empty pack has an empty array). Each
 * question is paired with every statement in the store, which is the population
 * `buildPack` selects from when `minCoverage` is 0.
 */
function observations(qs: readonly string[], docs: readonly string[]): UseObservation[] {
  return qs.map((query) => ({ query, statements: docs }));
}

describe('useCensus — the population V1 cannot see', () => {
  it('is pinned to the exact R45 learn split and the two real corpora', () => {
    // Self-contained: both fixtures are fingerprinted and live in the repository,
    // so CI reproduces exactly the population the offline census measured.
    expect(createHash('sha256').update(learnBytes).digest('hex')).toBe(
      'b5e49bb793731ec107754452e70e608c54b309c54f3be2ad049c82ffb40c87a0',
    );
    expect(createHash('sha256').update(queriesBytes).digest('hex')).toBe(
      '54f79dbf5994bb898e9ca7c9ab7ce5e4dbf32c588c0b0a69edc126e866ca5e75',
    );
    expect(learn.tasks).toHaveLength(32);
    expect(statements).toHaveLength(32);
    expect(airlineQueries).toHaveLength(50);
    expect(heldOutRetail).toHaveLength(82);
    const retail = queries.source.corpora.find((c) => c.name.includes('retail'));
    const airline = queries.source.corpora.find((c) => c.name.includes('airline'));
    expect(retail?.sha256).toBe('76e1fa649a359bef2d2fd30eae834b99d261d84e2e5d364856f6632fdf778dfd');
    expect(retail?.bytes).toBe(328166);
    expect(airline?.sha256).toBe('40d692b3fca780f46b56d48b447fd8db79a653f216667b8ed7c1a88380544532');
    expect(airline?.bytes).toBe(149096);
    // No content-free query: this is why the paired populations are exactly
    // 50 x 32 and 82 x 32, with no silently skipped questions.
    expect([...airlineQueries, ...heldOutRetail].filter((q) => tokenize(q).length === 0)).toHaveLength(0);
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
