/**
 * Where the imported name came from.
 *
 * Every test here is written against a pack text and a query written by hand, because the whole
 * reading is a substring test between two strings: if the test corpora were realistic rather than
 * minimal, a failure would be a debugging session instead of a sentence. The cases that matter are
 * the three buckets and the two detectors' disagreement — a name spelled `raceid` that the pack
 * wrote as "race id" is exactly the gap `flattened` exists to close, and a name that appears inside
 * a longer word is exactly the gap it opens.
 */
import { describe, expect, it } from 'vitest';
import {
  importSourceOf,
  mediationOf,
  mentionsOf,
  PACK_SHARE_FLOOR,
  type MediationReading,
} from '../pack-mediation.js';
import { diffQueries } from '@agentix-e/microglia-sql';
import type { MediationEntry } from '../corpus.js';

/** One question, with the query the pack produced and the text the prompt carried. */
function entry(
  id: string,
  options: {
    readonly baseline?: string;
    readonly predicted?: string;
    readonly pack?: string;
    readonly executed?: boolean;
    readonly correct?: boolean;
    readonly baselineOk?: boolean;
    readonly dbId?: string;
    readonly question?: string;
  } = {},
): MediationEntry {
  const baselineSql = options.baseline ?? 'SELECT count(*) FROM race';
  // One imported name and one only: `rival` is a table the question never mentions, and the
  // question's own table is dropped, so `ungrounded` is a single element and every denominator in
  // the tests below is a question count rather than a name count.
  const predictedSql = options.predicted ?? 'SELECT count(*) FROM rival';
  return {
    id,
    dbId: options.dbId ?? 'db',
    delta: diffQueries(baselineSql, predictedSql, options.question ?? 'how many races', null),
    correct: options.correct ?? true,
    withoutMemoryCorrect: options.baselineOk ?? false,
    packText: options.pack ?? '',
    packTextSource: options.pack === undefined ? 'none' : 'injected',
    executed: options.executed ?? true,
  };
}

const codes = (reading: MediationReading): string[] =>
  reading.criteria.map((entry) => `${entry.code}:${entry.ok ? 'ok' : 'no'}`);

describe('mentionsOf', () => {
  it('finds a whole-word match and nothing else', () => {
    expect(mentionsOf('rival', 'join the rival table')).toEqual({ exact: true, flattened: true });
    // `rival` inside `rivalry` is not the pack naming the column, and the exact detector is the one
    // that decides the headline share — so this is the case that keeps the lower bound honest.
    expect(mentionsOf('rival', 'a rivalry between two teams').exact).toBe(false);
    expect(mentionsOf('rival', 'a rivalry between two teams').flattened).toBe(true);
  });

  it('bridges spelling differences the exact detector refuses', () => {
    expect(mentionsOf('raceid', 'the race id is a foreign key')).toEqual({ exact: false, flattened: true });
    expect(mentionsOf('atom_id', 'the atom id column')).toEqual({ exact: false, flattened: true });
    expect(mentionsOf('atomid', 'join on atom_id')).toEqual({ exact: false, flattened: true });
  });

  it('is case-insensitive in both directions', () => {
    expect(mentionsOf('countyname', 'The County Name column')).toEqual({ exact: false, flattened: true });
    expect(mentionsOf('county name', 'The County Name column')).toEqual({ exact: true, flattened: true });
  });

  it('escapes a name that would otherwise be a pattern', () => {
    // BIRD has columns like `Free Meal Count (K-12)`; unescaped, the parentheses are a capture group
    // and the `-` would be a range in a character class.
    expect(mentionsOf('free meal count (k-12)', 'compared with `Free Meal Count (K-12)`').exact).toBe(true);
    expect(mentionsOf('a.c', 'abc').exact).toBe(false);
  });

  it('refuses an empty name instead of matching everything', () => {
    // `''.includes('')` is true, so the generous detector would credit the pack with every empty
    // name and, through it, with every question.
    expect(mentionsOf('', 'any text at all')).toEqual({ exact: false, flattened: false });
    expect(mentionsOf('---', 'any text at all')).toEqual({ exact: false, flattened: false });
  });
});

describe('importSourceOf', () => {
  it('returns null when the query imported nothing', () => {
    expect(importSourceOf([], 'anything', true)).toBeNull();
  });

  it('attributes to the pack when one name is in its text', () => {
    expect(importSourceOf(['rival', 'zzz'], 'join the rival table', true)).toBe('pack');
  });

  it('attributes to the schema when the query ran and the pack said nothing', () => {
    expect(importSourceOf(['rival'], 'a rule about dates', true)).toBe('schema');
  });

  it('refuses to call an unexecuted query invented', () => {
    expect(importSourceOf(['rival'], 'a rule about dates', false)).toBe('unverifiable');
  });

  it('reads the same question differently under the two detectors', () => {
    expect(importSourceOf(['raceid'], 'the race id column', true, 'exact')).toBe('schema');
    expect(importSourceOf(['raceid'], 'the race id column', true, 'flattened')).toBe('pack');
  });
});

describe('mediationOf', () => {
  /**
   * A corpus where the two buckets are deliberately identical: two destroyed and one repaired in
   * each. If the criteria pass on this, they would pass on anything, which is the property a
   * criterion written after the result would have had.
   */
  const mirrored = (): readonly MediationEntry[] => [
    entry('a#0', { pack: 'the rule names rival', correct: false, baselineOk: true }),
    entry('a#1', { pack: 'the rule names rival', correct: false, baselineOk: true }),
    entry('a#2', { pack: 'the rule names rival', correct: true, baselineOk: false }),
    entry('b#0', { pack: 'a rule about dates', correct: false, baselineOk: true }),
    entry('b#1', { pack: 'a rule about dates', correct: false, baselineOk: true }),
    entry('b#2', { pack: 'a rule about dates', correct: true, baselineOk: false }),
    // And questions the pack left alone, which carry no name and belong to no bucket.
    entry('c#0', { baseline: 'SELECT count(*) FROM race', predicted: 'SELECT count(*) FROM race', correct: true, baselineOk: true }),
  ];

  it('splits the corpus into the three buckets and states the shares', () => {
    const reading = mediationOf(mirrored(), 'exact', 200);
    expect(reading.corpus).toBe(7);
    expect(reading.importing).toBe(6);
    expect(reading.notImporting).toBe(1);
    const share = Object.fromEntries(reading.strata.map((row) => [row.source, row.cell.n]));
    expect(share).toEqual({ pack: 3, schema: 3, unverifiable: 0 });
    expect(reading.strata.find((row) => row.source === 'pack')?.share).toBeCloseTo(0.5, 10);
  });

  it('finds no mechanism where the buckets are identical', () => {
    // The point of the round: identical damage in the two buckets must not be reported as a
    // mechanism, and the resolution clause in M3 is what makes that true rather than rhetorical.
    const reading = mediationOf(mirrored(), 'exact', 200);
    expect(reading.split.gapPp).toBeCloseTo(0, 10);
    expect(reading.split.resolves).toBe(false);
    // M1 holds — half the flagged questions are pack-named, above the 30% floor — while M2 misses
    // its 60% bar, the mechanism cannot resolve a zero gap, and M4 lands exactly on its own floor.
    expect(codes(reading)).toEqual(['M1:ok', 'M2:no', 'M3:no', 'M4:ok']);
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('withdraws the statement when the pack can be seen in too few questions', () => {
    // One pack-named question out of eight: the mechanism is as strong as the data allows and the
    // filter still cannot see the name often enough to be worth running before generation.
    const thin: MediationEntry[] = [
      entry('a#0', { pack: 'the rule names rival', correct: false, baselineOk: true }),
      ...Array.from({ length: 7 }, (_, at) =>
        entry(`b#${at}`, { pack: 'a rule about dates', correct: at < 4, baselineOk: at >= 4 }),
      ),
    ];
    const reading = mediationOf(thin, 'exact', 200);
    expect(reading.criteria.find((c) => c.code === 'M1')?.ok).toBe(false);
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('cannot confirm a mechanism when there is no comparison bucket', () => {
    // Every flagged question is pack-named, and every one of them destroys a correct query.
    const strong: readonly MediationEntry[] = Array.from({ length: 8 }, (_, at) =>
      entry(`a#${at}`, { pack: 'the rule names rival', correct: false, baselineOk: true }),
    );
    const reading = mediationOf(strong, 'exact', 200);
    // M1 and M2 hold; M3 cannot resolve because there is no schema bucket to compare against, so
    // the mechanism is unmeasured rather than confirmed — and an unmeasured mechanism is not a
    // licence, which is why the statement is still withdrawn.
    expect(reading.criteria.find((c) => c.code === 'M1')?.ok).toBe(true);
    expect(reading.split.gapPp).toBeNull();
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('decomposes the gate improvement by bucket, and the parts add up', () => {
    const reading = mediationOf(mirrored(), 'exact', 200);
    expect(reading.contribution.pack).toBeCloseTo(reading.contribution.pack, 10);
    const parts = reading.contribution.pack + reading.contribution.schema + reading.contribution.unverifiable;
    expect(parts).toBeCloseTo(reading.contribution.total, 10);
    // The pack bucket destroys two correct queries and repairs one, so it contributes a net +1 over
    // seven cases; the schema bucket does the same, and the two together are the whole +2.
    expect(reading.contribution.pack).toBeCloseTo((1 / 7) * 100, 10);
    expect(reading.contribution.total).toBeCloseTo((2 / 7) * 100, 10);
  });

  it('counts names separately from questions', () => {
    const reading = mediationOf(mirrored(), 'exact', 200);
    // One name per question in this corpus, so the two denominators coincide — which is the point
    // of reporting both: a corpus where they diverge is a corpus where a question imported three
    // names at once, and the test above would not see it.
    expect(reading.byName.total).toBe(6);
    expect(reading.byName.exact).toBe(3);
    expect(reading.byName.flattened).toBe(3);
  });

  it('reads the same corpus under the generous detector without changing the failure', () => {
    const reading = mediationOf(mirrored(), 'flattened', 200);
    expect(reading.detector).toBe('flattened');
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('reports a corpus that imports nothing as unmeasured rather than as a pass', () => {
    const clean = [entry('a#0', { baseline: 'SELECT count(*) FROM race', predicted: 'SELECT count(*) FROM race' })];
    const reading = mediationOf(clean, 'exact', 100);
    expect(reading.importing).toBe(0);
    expect(reading.strata.every((row) => row.cell.n === 0 && row.share === 0)).toBe(true);
    expect(reading.contribution.total).toBeCloseTo(0, 10);
    expect(reading.criteria.find((c) => c.code === 'M3')?.actual).toContain('unmeasured');
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('reports an empty corpus as no contribution and a withdrawn statement', () => {
    const reading = mediationOf([], 'exact', 100);
    expect(reading.corpus).toBe(0);
    expect(reading.contribution).toEqual({ pack: 0, schema: 0, unverifiable: 0, total: 0 });
    expect(reading.statementWithdrawn).toBe(true);
  });

  it('reports an unmeasured damage rate rather than zero when a bucket had nothing correct to destroy', () => {
    // Forty repairs in one bucket and forty destructions in the other, which is the shape where the
    // gap resolves and one side still has no already-correct query to quote a destruction rate
    // over. A zero there would read as "the pack destroys nothing", which is the opposite of what
    // forty repairs are evidence for.
    const rows: MediationEntry[] = [
      ...Array.from({ length: 40 }, (_, at) => entry(`a#${at}`, { pack: 'the rule names rival', correct: true, baselineOk: false })),
      ...Array.from({ length: 40 }, (_, at) => entry(`b#${at}`, { pack: 'a rule about dates', correct: false, baselineOk: true })),
    ];
    const reading = mediationOf(rows, 'exact', 200);
    // The pack bucket repairs everything and the schema bucket destroys everything, so the gap runs
    // the other way and both sides of it resolve.
    expect(reading.split.gapPp).toBeCloseTo(200, 6);
    expect(reading.split.resolves).toBe(true);
    expect(reading.split.present.harmedPerCorrectPp).toBeNull();
    expect(reading.criteria.find((c) => c.code === 'M3')?.actual).toContain('unmeasured');
    expect(reading.criteria.find((c) => c.code === 'M3')?.ok).toBe(false);
  });

  it('keeps the statement when the pack is both visible and uniquely damaging', () => {
    // The world §140 wanted: every pack-named question destroys a correct query, the questions the
    // pack never named are repaired, and the pack is visible in half of the flagged ones. This is
    // the corpus on which the product statement would have stood, and it is here so that the
    // withdrawal on the real corpus is a result rather than a property of how the reading is coded.
    // The pack bucket destroys all forty already-correct queries; the schema bucket destroys four
    // of forty; both buckets therefore have a destruction rate to compare, which is what M3 needs
    // and what the real corpus has.
    const rows: MediationEntry[] = [
      ...Array.from({ length: 40 }, (_, at) => entry(`a#${at}`, { pack: 'the rule names rival', correct: false, baselineOk: true })),
      ...Array.from({ length: 40 }, (_, at) => entry(`b#${at}`, { pack: 'a rule about dates', correct: at >= 4, baselineOk: true })),
    ];
    const reading = mediationOf(rows, 'exact', 200);
    expect(reading.split.gapPp).toBeCloseTo(-90, 6);
    expect(reading.criteria.find((c) => c.code === 'M3')?.ok).toBe(true);
    expect(reading.criteria.find((c) => c.code === 'M4')?.ok).toBe(true);
    expect(reading.statementWithdrawn).toBe(false);
  });

  it('publishes the floor it applies, so the criterion cannot be quietly changed', () => {
    expect(PACK_SHARE_FLOOR).toBe(0.3);
    const reading = mediationOf(mirrored(), 'exact', 100);
    expect(reading.criteria.find((c) => c.code === 'M1')?.criterion).toContain('30%');
  });
});
