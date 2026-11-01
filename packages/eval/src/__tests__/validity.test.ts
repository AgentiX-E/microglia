/**
 * Whether the validity check survives without a baseline to anchor on.
 *
 * Every measurement of the read-time filter so far has been of the *difference* between two queries,
 * so what §140–§147 showed is that the diff carries the signal. R33 stage 0 asks the narrower
 * question a deployment without rules would ask: does the query alone carry it? That turns on one
 * rule, and the rule is the thing under test — so the tests here are built to make the rule fail:
 * a name the question implies morphologically but not literally, a name it never implies under any
 * rule, and a corpus where the flag fires on everything and therefore separates nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  MEMORY_FILTER_YOUDEN,
  addedByPackOf,
  adjudicateR33,
  flagOf,
  importedNamesOf,
  validityReadingOf,
  type ValidityCase,
  type ValidityReading,
  type ValiditySplit,
} from '../validity.js';

/** A case whose query names `race` (implied by *races*) and `prize` (implied by nothing). */
function importing(id: string, dbId: string, correct: boolean): ValidityCase {
  return {
    id,
    dbId,
    question: 'how many races were there',
    evidence: '',
    sql: 'SELECT count(*) FROM race WHERE prize > 1',
    correct,
  };
}

/** A case whose query names only what the question names, literally. */
function clean(id: string, dbId: string, correct: boolean): ValidityCase {
  return {
    id,
    dbId,
    question: 'how many races were there',
    evidence: '',
    sql: 'SELECT count(*) FROM races',
    correct,
  };
}

describe('importedNamesOf', () => {
  it('names a column the question never implies, and not one it does', () => {
    expect(importedNamesOf('SELECT count(*) FROM races', 'how many races', '', 'strict')).toEqual([]);
    expect(importedNamesOf('SELECT count(*) FROM race WHERE prize > 1', 'how many races', '', 'strict')).toEqual([
      'prize',
      'race',
    ]);
  });

  it('grounds an inflected identifier morphologically and not literally', () => {
    // `prizes` is *prize* written the way a schema writes it. The strict rule has to reject it —
    // that is what strict means — and the loose one has to accept it, because a flag that fires on
    // every plural is a flag that fires on every query.
    const sql = 'SELECT count(*) FROM races WHERE prizes > 1';
    expect(importedNamesOf(sql, 'how many races awarded a prize', '', 'strict')).toEqual(['prizes']);
    expect(importedNamesOf(sql, 'how many races awarded a prize', '', 'morphological')).toEqual([]);
  });

  it('lets the evidence block ground a name, because a solver may read it', () => {
    const sql = 'SELECT count(*) FROM races WHERE prize > 1';
    expect(importedNamesOf(sql, 'how many races', '', 'strict')).toEqual(['prize']);
    expect(importedNamesOf(sql, 'how many races', 'prize money is awarded per race', 'strict')).toEqual([]);
  });

  it('reports nothing for a query with no names rather than flagging an empty list', () => {
    expect(importedNamesOf('SELECT 1', 'how many races', '', 'strict')).toEqual([]);
    expect(importedNamesOf('', 'how many races', '', 'strict')).toEqual([]);
  });
});

describe('flagOf', () => {
  it('flags exactly when something is imported', () => {
    expect(flagOf(importing('a', 'db', true), 'strict')).toBe(true);
    expect(flagOf(clean('a', 'db', true), 'strict')).toBe(false);
  });
});

describe('validityReadingOf', () => {
  it('counts both groups and divides each by its own base', () => {
    const cases = [
      importing('f1', 'db_a', false),
      importing('f2', 'db_a', true),
      clean('c1', 'db_b', true),
      clean('c2', 'db_b', true),
    ];
    const reading = validityReadingOf(cases);
    expect(reading.flagged).toMatchObject({ n: 2, share: 0.5, wrong: 1, accuracyPp: 50 });
    expect(reading.clean).toMatchObject({ n: 2, share: 0.5, wrong: 0, accuracyPp: 100 });
    // Present minus absent, the sign convention every other reading in this package uses: negative
    // means the flagged cohort is the worse one.
    expect(reading.gapPp).toBeCloseTo(-50, 8);
    expect(reading.accuracyPp).toBeCloseTo(75, 8);
  });

  it('computes Youden from the two conditional rates, not from the marginals', () => {
    // 30 of 50 wrong answers flagged (sensitivity 0.6); 40 of 50 right answers left alone
    // (specificity 0.8). J = 0.4. A reading that used the flag rate instead would report 0.4 by
    // coincidence here and something else on every other corpus, which is why the two are separated.
    const cases = [
      ...Array.from({ length: 30 }, (_, at) => importing(`w-flag-${at}`, 'db_a', false)),
      ...Array.from({ length: 10 }, (_, at) => importing(`r-flag-${at}`, 'db_a', true)),
      ...Array.from({ length: 20 }, (_, at) => clean(`w-clean-${at}`, 'db_b', false)),
      ...Array.from({ length: 40 }, (_, at) => clean(`r-clean-${at}`, 'db_b', true)),
    ];
    const reading = validityReadingOf(cases);
    expect(reading.sensitivity).toBeCloseTo(0.6, 10);
    expect(reading.specificity).toBeCloseTo(0.8, 10);
    expect(reading.youdenJ).toBeCloseTo(0.4, 10);
    expect(reading.flagged.share).toBeCloseTo(0.4, 10);
  });

  it('reports a null accuracy and a null gap when one side is empty', () => {
    // Every attempt is flagged, so there is no clean group to compare against. Note that
    // specificity is *not* null here: there is one right answer and the flag took it, which is a
    // measured 0 rather than an absence, and the difference matters — a rule that flags everything
    // has J = 0, not J = unknown.
    const reading = validityReadingOf([importing('a', 'db', true), importing('b', 'db', false)]);
    expect(reading.clean.n).toBe(0);
    expect(reading.clean.share).toBe(0);
    expect(reading.clean.accuracyPp).toBeNull();
    expect(reading.gapPp).toBeNull();
    expect(reading.sensitivity).toBe(1);
    expect(reading.specificity).toBe(0);
    expect(reading.youdenJ).toBe(0);
  });

  it('reports a null specificity when there was nothing correct to leave alone', () => {
    // All three attempts failed, so `P(no flag | right)` has no base at all — the same distinction
    // as above, in the other direction.
    const reading = validityReadingOf([importing('a', 'db', false), importing('b', 'db', false), clean('c', 'db', false)]);
    expect(reading.sensitivity).toBeCloseTo(2 / 3, 10);
    expect(reading.specificity).toBeNull();
    expect(reading.youdenJ).toBeNull();
    expect(reading.clean.accuracyPp).toBe(0);
  });

  it('reports a null sensitivity when nothing was wrong, and a specific rule still clears', () => {
    const reading = validityReadingOf([importing('a', 'db', true), clean('b', 'db', true)]);
    expect(reading.sensitivity).toBeNull();
    // One of the two right answers was still flagged, so the rule's specificity is a measured 0.5.
    expect(reading.specificity).toBe(0.5);
    expect(reading.youdenJ).toBeNull();
  });

  it('reports an empty corpus as unmeasured rather than as a perfect check', () => {
    const reading = validityReadingOf([]);
    expect(reading.n).toBe(0);
    expect(reading.flagged.accuracyPp).toBeNull();
    expect(reading.clean.accuracyPp).toBeNull();
    expect(reading.accuracyPp).toBeNull();
    expect(reading.gapPp).toBeNull();
    expect(reading.youdenJ).toBeNull();
    expect(reading.fisherP).toBe(1);
  });

  it('resamples databases, so one database carrying the flag does not resolve', () => {
    // Nine flagged-and-wrong questions in one database, and a clean group split across two — one
    // right, one wrong. The point estimate is −50pp and a question-level bootstrap would call that
    // resolved; resampling databases lets the draw land on the clean database that holds the
    // failure, which puts the upper bound at zero.
    const cases = [
      ...Array.from({ length: 9 }, (_, at) => importing(`big-${at}`, 'big', false)),
      clean('right', 'big', true),
      clean('wrong', 'small', false),
    ];
    const reading = validityReadingOf(cases, { resamples: 4_000 });
    expect(reading.databases).toBe(2);
    expect(reading.gapPp).toBeCloseTo(-50, 8);
    expect(reading.clusterLowPp as number).toBeLessThan(0);
    expect(reading.resolves).toBe(false);
  });

  it('refuses an interval for a single database instead of reporting zero width', () => {
    const reading = validityReadingOf([importing('a', 'only', false), clean('b', 'only', true)]);
    expect(reading.databases).toBe(1);
    expect(reading.clusterLowPp).toBeNull();
    expect(reading.clusterHighPp).toBeNull();
    expect(reading.resolves).toBe(false);
  });

  it('keeps the rule it read so two readings cannot be compared under different rules', () => {
    const strict = validityReadingOf([importing('a', 'db', false), clean('b', 'db', true)], { rule: 'strict' });
    const loose = validityReadingOf([importing('a', 'db', false), clean('b', 'db', true)], {
      rule: 'morphological',
    });
    expect(strict.rule).toBe('strict');
    expect(loose.rule).toBe('morphological');
    // Both rules still catch `prize`, so the flag rate is the same on this corpus. The rule is
    // recorded anyway because the corpus that matters has joined columns in every query.
    expect(loose.flagged.n).toBe(strict.flagged.n);
  });
});

describe('the bar R33 is registered against', () => {
  it('computes the memory filter Youden the registration quotes', () => {
    // 76 of 237 breaks caught, 40 of 187 repairs given up: J = 76/237 + 147/187 − 1 = 0.1066….
    // The prereg turns this into a threshold for the question-only check, so the arithmetic that
    // produces the threshold is pinned here rather than in a paragraph.
    const sensitivity = 76 / 237;
    const specificity = (187 - 40) / 187;
    expect(sensitivity + specificity - 1).toBeCloseTo(0.1068, 4);

    // And the reading reproduces that arithmetic from a corpus built to those counts.
    const cases: ValidityCase[] = [
      ...Array.from({ length: 76 }, (_, at) => importing(`b-flag-${at}`, 'db_a', false)),
      ...Array.from({ length: 161 }, (_, at) => clean(`b-clean-${at}`, 'db_b', false)),
      ...Array.from({ length: 40 }, (_, at) => importing(`r-flag-${at}`, 'db_a', true)),
      ...Array.from({ length: 147 }, (_, at) => clean(`r-clean-${at}`, 'db_b', true)),
    ];
    const reading: ValidityReading = validityReadingOf(cases, { resamples: 200 });
    expect(reading.sensitivity).toBeCloseTo(sensitivity, 10);
    expect(reading.specificity).toBeCloseTo(specificity, 10);
    expect(reading.youdenJ as number).toBeCloseTo(0.1068, 4);
  });
});

describe('the exclusion of a case with no query', () => {
  it('drops a case the rule cannot be asked about and says how many', () => {
    // An artifact that stores no query for a row is not evidence about the rule. Counting the row as
    // unflagged would put a failure into the clean group and pull the gap toward zero, which is the
    // direction that hides a finding.
    const reading = validityReadingOf([
      importing('a', 'db_a', false),
      clean('b', 'db_b', true),
      { id: 'empty', dbId: 'db_b', question: 'how many races', evidence: '', sql: '', correct: false },
    ]);
    expect(reading.n).toBe(2);
    expect(reading.excluded).toBe(1);
    expect(reading.clean.n).toBe(1);
  });

  it('reports an all-empty corpus as excluded rather than as an empty reading', () => {
    const reading = validityReadingOf([
      { id: 'a', dbId: 'db_a', question: 'q', evidence: '', sql: '   ', correct: true },
    ]);
    expect(reading.n).toBe(0);
    expect(reading.excluded).toBe(1);
    expect(reading.accuracyPp).toBeNull();
  });
});

describe('adjudicateR33', () => {
  const cases = (flaggedWrong: number, flaggedRight: number, cleanWrong: number, cleanRight: number): ValidityCase[] => [
    ...Array.from({ length: flaggedWrong }, (_, at) => importing(`fw-${at}`, 'db_a', false)),
    ...Array.from({ length: flaggedRight }, (_, at) => importing(`fr-${at}`, 'db_a', true)),
    ...Array.from({ length: cleanWrong }, (_, at) => clean(`cw-${at}`, 'db_b', false)),
    ...Array.from({ length: cleanRight }, (_, at) => clean(`cr-${at}`, 'db_b', true)),
  ];

  function splitOf(input: {
    cases: ValidityCase[];
    n?: number;
    bareMissing?: number;
    servedMissing?: number;
    complete?: boolean;
    rule?: 'strict' | 'morphological';
  }): ValiditySplit {
    const reading = validityReadingOf(input.cases, { rule: input.rule ?? 'strict', resamples: 300 });
    return {
      n: input.n ?? 7000,
      bareMissing: input.bareMissing ?? 0,
      servedMissing: input.servedMissing ?? 0,
      complete: input.complete ?? true,
      bare: reading,
      served: reading,
      bareLoose: { ...reading, rule: 'morphological' },
      servedLoose: { ...reading, rule: 'morphological' },
    };
  }

  /** A split whose flag fires on 95% of the corpus and whose J is far under the bar. */
  const weak = (): ValiditySplit => splitOf({ cases: cases(50, 500, 0, 40) });

  it('refutes P5 when the question-only check cannot clear the memory filter bar', () => {
    const verdicts = adjudicateR33({ train: weak(), dev: weak() });
    const p5 = verdicts.find((verdict) => verdict.id === 'P5');
    expect(p5?.holds).toBe(false);
    // The bar itself is computed from the filter's own counts, so it cannot drift from them.
    expect(MEMORY_FILTER_YOUDEN).toBeCloseTo(0.1068, 4);
    expect(p5?.claim).toContain('0.1068');
  });

  it('holds P5 when the check does clear the bar, so the bar is not unreachable', () => {
    // 60 of 65 failures caught and 30 of 35 passes left alone: J = 0.78. A registration whose
    // positive branch is never exercised is a registration that could only ever be refuted.
    const strong = splitOf({ cases: cases(60, 5, 5, 30) });
    const p5 = adjudicateR33({ train: strong, dev: strong }).find((verdict) => verdict.id === 'P5');
    expect(p5?.holds).toBe(true);
  });

  it('holds P2 when both rules fire on most of the corpus', () => {
    const verdicts = adjudicateR33({ train: weak(), dev: weak() });
    expect(verdicts.find((verdict) => verdict.id === 'P2')?.holds).toBe(true);
    expect(verdicts.find((verdict) => verdict.id === 'P2')?.observed).toContain('%');
  });

  it('refutes P2 when the rule barely fires, which is the abandonment branch', () => {
    // A rule that flags almost nothing cannot cost anything and cannot be worth anything, and the
    // registration says so rather than asking for a bigger corpus.
    const quiet = splitOf({ cases: cases(1, 1, 40, 40) });
    const verdicts = adjudicateR33({ train: quiet, dev: quiet });
    expect(verdicts.find((verdict) => verdict.id === 'P2')?.holds).toBe(false);
  });

  it('refutes P3 when the gap is small or the interval covers zero', () => {
    const flat = splitOf({ cases: cases(10, 10, 10, 10) });
    const verdicts = adjudicateR33({ train: flat, dev: flat });
    expect(verdicts.find((verdict) => verdict.id === 'P3')?.holds).toBe(false);
  });

  it('holds P1 only when the sizes are the registered ones and the missing queries are accounted for', () => {
    const good = adjudicateR33({ train: weak(), dev: { ...weak(), n: 1534 } });
    expect(good.find((verdict) => verdict.id === 'P1')?.holds).toBe(true);
    const bad = adjudicateR33({ train: weak(), dev: { ...weak(), n: 1534, complete: false } });
    expect(bad.find((verdict) => verdict.id === 'P1')?.holds).toBe(false);
  });

  it('reports every verdict with the number it was decided on', () => {
    const verdicts = adjudicateR33({ train: weak(), dev: weak() });
    expect(verdicts.map((verdict) => verdict.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    for (const verdict of verdicts) {
      expect(verdict.claim.length).toBeGreaterThan(20);
      expect(verdict.observed.length).toBeGreaterThan(0);
    }
  });

  it('says n/a rather than zero when Youden has no base to stand on', () => {
    // A corpus with nothing correct and nothing wrong cannot be built, but one with nothing wrong
    // can: then sensitivity has no base and P5 is undecidable rather than failed with a number.
    const noFailures = splitOf({ cases: cases(0, 40, 0, 40) });
    const both = adjudicateR33({ train: noFailures, dev: noFailures }).find((verdict) => verdict.id === 'P5');
    expect(both?.holds).toBe(false);
    expect(both?.observed).toContain('n/a');
    // And one at a time, because a reading that only formats the case where both sides are missing
    // would print n/a for a split that has a perfectly good index.
    const oneSide = adjudicateR33({ train: weak(), dev: noFailures }).find((verdict) => verdict.id === 'P5');
    expect(oneSide?.observed).toMatch(/^\d\.\d{4} train, n\/a dev$/);
    const otherSide = adjudicateR33({ train: noFailures, dev: weak() }).find((verdict) => verdict.id === 'P5');
    expect(otherSide?.observed).toMatch(/^n\/a train, \d\.\d{4} dev$/);
  });

  it('refutes P4 and P6 rather than assuming agreement when one side is degenerate', () => {
    // The two verdicts that compare across corpus properties have to fail closed: a null gap on dev
    // is not agreement, and a saturated flag rate cannot show what the pack added.
    const degenerate = splitOf({ cases: [importing('a', 'db', false), importing('b', 'db', true)] });
    const verdicts = adjudicateR33({ train: weak(), dev: degenerate });
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.observed).toContain('n/a');
    expect(verdicts.find((verdict) => verdict.id === 'P6')?.holds).toBe(false);
  });
});

describe('addedByPackOf', () => {
  const bareOf = (id: string, dbId: string, correct: boolean): ValidityCase => clean(id, dbId, correct);
  const servedOf = (id: string, dbId: string, correct: boolean, importing: boolean): ValidityCase =>
    importing
      ? { ...importingCase(id, dbId, correct) }
      : clean(id, dbId, correct);

  /** The `importing` fixture under another name, so the two helpers read apart. */
  function importingCase(id: string, dbId: string, correct: boolean): ValidityCase {
    return { id, dbId, question: 'how many races were there', evidence: '', sql: 'SELECT count(*) FROM race WHERE prize > 1', correct };
  }

  it('divides by the questions the bare query passed, not by the corpus', () => {
    // Three of the four bare queries pass the rule; the pack spoils one of those three. The corpus
    // rate would be 25%, and the number that answers "what did the pack add" is 33.3%.
    const bare = [
      bareOf('a', 'db', true),
      bareOf('b', 'db', true),
      bareOf('c', 'db', false),
      importingCase('d', 'db', false),
    ];
    const served = [
      servedOf('a', 'db', true, true),
      servedOf('b', 'db', true, false),
      servedOf('c', 'db', false, false),
      servedOf('d', 'db', false, false),
    ];
    const added = addedByPackOf(bare, served);
    expect(added.clean).toBe(3);
    expect(added.flaggedAfter).toBe(1);
    expect(added.share).toBeCloseTo(1 / 3, 10);
  });

  it('reports a null share when the bare rule already flags everything', () => {
    const bare = [importingCase('a', 'db', false), importingCase('b', 'db', false)];
    const added = addedByPackOf(bare, bare);
    expect(added.clean).toBe(0);
    expect(added.share).toBeNull();
  });

  it('ignores a served case whose query is missing rather than counting it as flag-free', () => {
    // The partner exists but has no text: the rule cannot be asked, and counting it as not flagged
    // would credit the pack with an import it was never shown to make.
    const bare = [bareOf('a', 'db', true)];
    const served = [{ ...bareOf('a', 'db', true), sql: '' }];
    const added = addedByPackOf(bare, served);
    expect(added.clean).toBe(1);
    expect(added.flaggedAfter).toBe(0);
  });

  it('ignores a bare case with no query, because it was never clean', () => {
    const bare = [{ ...bareOf('a', 'db', true), sql: '' }];
    const added = addedByPackOf(bare, bare);
    expect(added.clean).toBe(0);
  });

  it('matches on id rather than on position, so a reordered artefact changes nothing', () => {
    const bare = [bareOf('a', 'db', true), bareOf('b', 'db', true)];
    const forward = addedByPackOf(bare, [servedOf('a', 'db', true, true), servedOf('b', 'db', true, false)]);
    const backward = addedByPackOf(bare, [servedOf('b', 'db', true, false), servedOf('a', 'db', true, true)]);
    expect(forward).toEqual(backward);
  });
});
