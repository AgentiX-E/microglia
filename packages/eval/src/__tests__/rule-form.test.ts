/**
 * Whether the procedural/declarative axis can exist in this corpus, and what it shows if it can.
 *
 * The tests below are in three groups. The classifier's tests pin the four classes and, more
 * importantly, pin the markers that are *absent* — `when` and `which` are what made the first
 * attempt overcount, so a test that only checked the positive cases would let them back in. The
 * census and coverage tests pin the arithmetic that decides the verdict. The split's tests pin two
 * things a two-group contrast gets wrong easily: that a disjoint pair cannot be compared by
 * subtracting intervals, and that one empty group is `null` rather than zero.
 */
import { describe, expect, it } from 'vitest';
import {
  RELAXED_MARKERS,
  SEPARATION_BAR,
  STRICT_MARKERS,
  censusOf,
  coverageOf,
  formSplitOf,
  packFormOf,
  ruleFormOf,
  rulePoolOf,
  type RuleForm,
} from '../rule-form.js';
import type { DiffCase } from '../query-diff.js';

const rule = (id: string, statement: string): { id: string; statement: string } => ({ id, statement });

describe('ruleFormOf', () => {
  it('reads a construction instruction as procedural', () => {
    expect(ruleFormOf('A query must deduplicate the projected entity column after joining.')).toBe('procedural');
    expect(ruleFormOf('Filter the yearmonth table on Date rather than the transaction column.')).toBe('procedural');
  });

  it('reads a statement of consequence as declarative', () => {
    expect(ruleFormOf('Applying strftime to a Date column yields no rows.')).toBe('declarative');
    expect(ruleFormOf('The expense table carries its own description and date columns.')).toBe('declarative');
  });

  it('reads a sentence that does both as both, rather than letting a marker count decide', () => {
    expect(
      ruleFormOf('A query that joins a one-to-many table must deduplicate the entity column, because each child row produces a duplicate.'),
    ).toBe('both');
  });

  it('reads a sentence carrying neither as unmarked', () => {
    expect(ruleFormOf('Percentage calculations over gas stations divide by COUNT(GasStationID).')).toBe('unmarked');
  });

  it('does not count a conditional clause as declarative', () => {
    // The three words this guards are the ones that moved the census by 4.8 points. Each sentence
    // below holds a construction and one of the three, and nothing that asserts a state.
    expect(ruleFormOf('A query must join the child table when the parent has fewer rows.')).toBe('procedural');
    expect(ruleFormOf('A query must join the child table which the teacher owns.')).toBe('procedural');
    expect(ruleFormOf('A query must join the child table so the rows match.')).toBe('procedural');
  });

  it('counts them when the relaxed markers are asked for', () => {
    expect(ruleFormOf('A query must join the child table when the parent has fewer rows.', RELAXED_MARKERS)).toBe('both');
  });

  it('matches across case and whitespace, because rule text is not normalised upstream', () => {
    expect(ruleFormOf('A QUERY   MUST join\nthe child table.')).toBe('procedural');
  });
});

describe('rulePoolOf', () => {
  it('separates rows from sentences, because they differ by a factor of the fold count', () => {
    const items = [rule('a', 'One sentence.'), rule('a', 'One sentence.'), rule('b', 'Another sentence.')];
    const pool = rulePoolOf(items, new Set(['a', 'b']));
    expect(pool).toEqual({ rows: 3, sentences: 2, slots: 2, cited: 2 });
  });

  it('counts a cited slot once however many folds carry it', () => {
    // The id is reused across folds, so counting rows would answer a different question about a
    // different population.
    const items = [rule('a', 'One.'), rule('a', 'Two.'), rule('a', 'Three.')];
    expect(rulePoolOf(items, new Set(['a'])).cited).toBe(1);
    expect(rulePoolOf(items, new Set()).cited).toBe(0);
  });

  it('reports an empty pool as empty rather than dividing by it', () => {
    expect(rulePoolOf([], new Set())).toEqual({ rows: 0, sentences: 0, slots: 0, cited: 0 });
  });
});

describe('censusOf', () => {
  it('counts each form and derives both shares from one denominator', () => {
    const forms: RuleForm[] = ['both', 'both', 'procedural', 'declarative', 'unmarked'];
    const census = censusOf(forms, 'strict');
    expect(census).toMatchObject({
      markers: 'strict',
      n: 5,
      both: 2,
      procedural: 1,
      declarative: 1,
      unmarked: 1,
    });
    expect(census.bothShare).toBeCloseTo(0.4, 10);
    expect(census.pureShare).toBeCloseTo(0.4, 10);
  });

  it('reports an empty census as zero shares', () => {
    const census = censusOf([], 'strict');
    expect(census.n).toBe(0);
    expect(census.bothShare).toBe(0);
    expect(census.pureShare).toBe(0);
  });

  it('decides the axis against the bar R32 prediction 2 registered', () => {
    // The verdict is `bothShare` against the bar, and this pins the direction: a corpus half of
    // whose rules do both things cannot be split by form.
    const atBar = censusOf(['both', 'procedural'], 'strict');
    expect(atBar.bothShare).toBe(SEPARATION_BAR);
    expect(atBar.bothShare < SEPARATION_BAR).toBe(false);
    const underBar = censusOf(['both', 'procedural', 'declarative'], 'strict');
    expect(underBar.bothShare < SEPARATION_BAR).toBe(true);
  });
});

describe('packFormOf', () => {
  const formById = new Map<string, RuleForm>([
    ['p', 'procedural'],
    ['d', 'declarative'],
    ['b', 'both'],
    ['u', 'unmarked'],
  ]);

  it('names a pack after the only pure class it holds', () => {
    expect(packFormOf(['p', 'b', 'u'], formById)).toBe('procedural');
    expect(packFormOf(['d', 'b'], formById)).toBe('declarative');
  });

  it('calls a pack holding both classes mixed rather than letting pack size vote', () => {
    expect(packFormOf(['p', 'd'], formById)).toBe('mixed');
    expect(packFormOf(['p', 'p', 'p', 'd'], formById)).toBe('mixed');
  });

  it('calls a pack with no pure rule none, including an empty pack', () => {
    expect(packFormOf(['b', 'u'], formById)).toBe('none');
    expect(packFormOf([], formById)).toBe('none');
  });

  it('ignores an id the pool does not hold', () => {
    expect(packFormOf(['missing', 'p'], formById)).toBe('procedural');
  });
});

describe('coverageOf', () => {
  it('counts the four pack forms and the share the axis cannot speak about', () => {
    const coverage = coverageOf(['procedural', 'procedural', 'declarative', 'mixed', 'none']);
    expect(coverage).toEqual({
      cases: 5,
      procedural: 2,
      declarative: 1,
      mixed: 1,
      none: 1,
      unclassifiedShare: 0.2,
    });
  });

  it('reports an empty corpus as zero rather than dividing by it', () => {
    expect(coverageOf([])).toEqual({
      cases: 0,
      procedural: 0,
      declarative: 0,
      mixed: 0,
      none: 0,
      unclassifiedShare: 0,
    });
  });
});

describe('formSplitOf', () => {
  const formById = new Map<string, RuleForm>([
    ['p', 'procedural'],
    ['d', 'declarative'],
  ]);
  const entry = (
    id: string,
    pack: readonly string[],
    correct: boolean,
    baseline: boolean,
    dbId = 'db_one',
  ): DiffCase => ({ id, dbId, delta: { ungrounded: [], addedConjunctions: 0 } as never, correct, withoutMemoryCorrect: baseline, packIdList: pack });

  it('takes the interval on the difference rather than on either group', () => {
    // Procedural helps on every question and declarative harms on every question, each in its own
    // database, so the gap is as far from zero as a corpus of this size can put it.
    const cases = [
      entry('a', ['p'], true, false, 'db_one'),
      entry('b', ['p'], true, false, 'db_two'),
      entry('c', ['d'], false, true, 'db_one'),
      entry('d', ['d'], false, true, 'db_two'),
    ];
    const split = formSplitOf(cases, formById, 2_000);
    expect(split.procedural.deltaPp).toBeCloseTo(100, 6);
    expect(split.declarative.deltaPp).toBeCloseTo(-100, 6);
    expect(split.gapPp).toBeCloseTo(200, 6);
    expect(split.proceduralClusters).toBe(2);
    expect(split.declarativeClusters).toBe(2);
    expect(split.resolved).toBe(true);
    expect(split.gapLowPp).not.toBeNull();
    expect(split.gapLowPp as number).toBeGreaterThan(0);
  });

  it('refuses to resolve a group drawn from a single database, however wide the gap looks', () => {
    // One database per group means every redraw returns the group unchanged, so the interval
    // collapses to a point and a 200pp gap would read as certain. It is not: there is one
    // database behind it. This is the failure the cluster count exists to catch.
    const cases = [
      entry('a', ['p'], true, false, 'db_one'),
      entry('b', ['p'], true, false, 'db_one'),
      entry('c', ['d'], false, true, 'db_two'),
      entry('d', ['d'], false, true, 'db_two'),
    ];
    const split = formSplitOf(cases, formById, 2_000);
    expect(split.gapPp).toBeCloseTo(200, 6);
    expect(split.gapLowPp as number).toBeGreaterThan(0);
    expect(split.proceduralClusters).toBe(1);
    expect(split.declarativeClusters).toBe(1);
    expect(split.resolved).toBe(false);
  });

  it('resolves a gap of zero as unresolved', () => {
    const cases = [
      entry('a', ['p'], true, false, 'db_one'),
      entry('b', ['p'], false, true, 'db_two'),
      entry('c', ['d'], true, false, 'db_one'),
      entry('d', ['d'], false, true, 'db_two'),
    ];
    const split = formSplitOf(cases, formById, 2_000);
    expect(split.gapPp).toBeCloseTo(0, 6);
    expect(split.resolved).toBe(false);
  });

  it('leaves the gap null when one group holds nothing, rather than calling it zero', () => {
    const only = [entry('a', ['p'], true, false)];
    const split = formSplitOf(only, formById, 500);
    expect(split.declarative.n).toBe(0);
    expect(split.declarative.deltaPp).toBeNull();
    expect(split.gapPp).toBeNull();
    expect(split.gapLowPp).toBeNull();
    expect(split.gapHighPp).toBeNull();
    expect(split.resolved).toBe(false);
  });

  it('leaves the gap null when neither group holds anything', () => {
    const split = formSplitOf([entry('a', [], true, false)], formById, 500);
    expect(split.procedural.n).toBe(0);
    expect(split.declarative.n).toBe(0);
    expect(split.gapPp).toBeNull();
  });

  it('draws whole databases, so a question is never counted without its own database', () => {
    // Two databases that disagree inside both groups. A question-level draw would mix them on
    // every resample and report a narrow interval; a database-level draw can pull one database
    // twice and has to report the spread between them.
    const cases = [
      entry('a', ['p'], true, false, 'db_left'),
      entry('b', ['p'], true, false, 'db_left'),
      entry('c', ['p'], false, true, 'db_right'),
      entry('d', ['p'], false, true, 'db_right'),
      entry('e', ['d'], true, false, 'db_left'),
      entry('f', ['d'], false, true, 'db_right'),
    ];
    const split = formSplitOf(cases, formById, 5_000);
    expect(split.procedural.n).toBe(4);
    expect(split.declarative.n).toBe(2);
    expect(split.procedural.deltaPp).toBeCloseTo(0, 6);
    expect(split.declarative.deltaPp).toBeCloseTo(0, 6);
    // Both groups sit at zero on average and both are split down the middle by database, so the
    // interval has to span the databases' own spread rather than the questions' average.
    expect(split.proceduralClusters).toBe(2);
    expect(split.declarativeClusters).toBe(2);
    expect(split.gapLowPp as number).toBeLessThan(0);
    expect(split.gapHighPp as number).toBeGreaterThan(0);
    expect(split.resolved).toBe(false);
  });

  it('brackets its own point estimate, which is the check a resampling change breaks', () => {
    // The interval estimates the same quantity the point estimate reports, so a resample weighting
    // databases differently from the point estimate drifts off it. This file once averaged each
    // drawn database's own mean instead of pooling their questions, which reverses the sign here:
    // one database of 100 harmed questions outweighs eight databases of one helped question each
    // under the point estimate (−85pp) and loses to them under a per-database average (+78pp).
    const group = (want: string, dbId: string, count: number, helped: boolean): DiffCase[] =>
      Array.from({ length: count }, (_, at) => entry(`${want}-${dbId}-${at}`, [want], helped, !helped, dbId));
    const cases = [
      ...group('p', 'db_big', 100, false),
      ...Array.from({ length: 8 }, (_, at) => group('p', `db_small_${at}`, 1, true)).flat(),
      ...group('d', 'db_one', 1, false),
      ...group('d', 'db_two', 1, true),
    ];
    const split = formSplitOf(cases, formById, 5_000);
    expect(split.procedural.deltaPp).toBeCloseTo(-85.19, 1);
    const point = split.gapPp as number;
    const low = split.gapLowPp as number;
    const high = split.gapHighPp as number;
    expect(point).toBeLessThan(-80);
    expect(low).toBeLessThanOrEqual(point);
    expect(high).toBeGreaterThanOrEqual(point);
  });

  it('treats a case with no pack list as no pure rule rather than as a crash', () => {
    const bare: DiffCase = {
      id: 'x',
      dbId: 'db_one',
      delta: { ungrounded: [], addedConjunctions: 0 } as never,
      correct: true,
      withoutMemoryCorrect: false,
    };
    const split = formSplitOf([bare, entry('a', ['p'], true, false)], formById, 500);
    expect(split.procedural.n).toBe(1);
    expect(split.declarative.n).toBe(0);
    expect(split.gapPp).toBeNull();
  });

  it('sends a mixed pack to neither group, so a tie cannot be counted twice', () => {
    const cases = [entry('a', ['p', 'd'], true, false), entry('b', ['d'], false, true)];
    const split = formSplitOf(cases, formById, 500);
    expect(split.procedural.n).toBe(0);
    expect(split.declarative.n).toBe(1);
    expect(split.gapPp).toBeNull();
  });
});

describe('the marker sets', () => {
  it('differ only on the three relation words, so the sensitivity read isolates them', () => {
    const added = RELAXED_MARKERS.declarative.filter(
      (pattern) => !STRICT_MARKERS.declarative.some((strict) => strict.source === pattern.source),
    );
    expect(added.map((pattern) => pattern.source)).toEqual(['\\bwhen\\b', '\\bwhich\\b', '\\bso\\b']);
    expect(RELAXED_MARKERS.procedural).toBe(STRICT_MARKERS.procedural);
  });

  it('are named, so a reading can say which one produced it', () => {
    expect(STRICT_MARKERS.name).toBe('strict');
    expect(RELAXED_MARKERS.name).toBe('relaxed');
  });
});
