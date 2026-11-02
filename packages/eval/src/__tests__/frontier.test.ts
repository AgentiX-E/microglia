import { describe, expect, it } from 'vitest';
import {
  bridgesOf,
  databaseShares,
  frontierGate,
  keyStats,
  keysForShare,
  keysOf,
  orderedKeys,
  reachCurve,
  reachOf,
  vocabularyKeys,
  type BridgeCase,
  type KeyStat,
} from '../frontier.js';

const entry = (question: string, evidence: string | undefined, database = 'db'): BridgeCase => ({
  question,
  evidence,
  database,
});

const stat = (key: string, questions: number, taught = 1): KeyStat => ({
  key,
  questions,
  taught,
  density: questions === 0 ? 0 : taught / questions,
  databases: ['db'],
});

describe('the shape of an annotation', () => {
  it('reads the three forms the corpus uses, separating them on `;` and newlines', () => {
    const read = bridgesOf(
      'driver reference name refers to driverRef; race number = raceId\nthe label means the class of the molecule',
    );
    expect(read).toEqual([
      { key: 'driver reference name', value: 'driverRef' },
      { key: 'race number', value: 'raceId' },
      { key: 'the label', value: 'the class of the molecule' },
    ]);
  });

  it('reads `refers to` before `=`, because one block mixes the two', () => {
    expect(bridgesOf('alpha and beta refers to X = Y')).toEqual([{ key: 'alpha and beta', value: 'X = Y' }]);
  });

  it('drops a segment that matches no shape rather than inventing a key for it', () => {
    // Ten per cent of the corpus's blocks are prose, and a guessed key would enter the frontier as
    // a mapping the corpus never made.
    const read = bridgesOf('the ratio of the two counts; element = the chemical element');
    expect(read).toEqual([{ key: 'element', value: 'the chemical element' }]);
  });

  it('drops a mapping whose key or value is too short to be one', () => {
    expect(bridgesOf('ab = something')).toEqual([]);
    expect(bridgesOf('something = x')).toEqual([]);
  });

  it('reads nothing from a case the corpus left unannotated', () => {
    expect(bridgesOf(undefined)).toEqual([]);
    expect(bridgesOf('')).toEqual([]);
    expect(bridgesOf('   ;  \n ')).toEqual([]);
  });

  it('keeps both mappings when one block carries two of the same kind', () => {
    expect(bridgesOf('alpha refers to alphaId; beta refers to betaId')).toHaveLength(2);
  });
});

describe('the keys of a set of annotations', () => {
  it('lowercases and deduplicates, because the licence is case-insensitive', () => {
    const keys = keysOf(bridgesOf('Driver refers to driverRef; driver = driverId'));
    expect(keys).toEqual(['driver']);
  });

  it('keeps first-seen order so a reading is reproducible from its input', () => {
    expect(keysOf(bridgesOf('beta refers to betaId; alpha refers to alphaId; beta = betaKey'))).toEqual(['beta', 'alpha']);
  });

  it('is empty when there is nothing to read', () => {
    expect(keysOf([])).toEqual([]);
  });
});

describe('what a key reaches', () => {
  const cases = [
    entry('How many cards are there', 'cards = the table of cards', 'card_games'),
    entry('Which cards are banned', 'cards = the table of cards', 'card_games'),
    entry('List the drivers', 'driver refers to driverRef', 'formula_1'),
    entry('How many users', undefined, 'codebase'),
  ];

  it('counts the questions that contain the key, not the blocks that taught it', () => {
    // `cards` was taught twice and reaches two; a count of teaching would agree here and diverge on
    // the corpus, where a key is often taught once and reaches eighty questions.
    const stats = keyStats(cases);
    const cards = stats.find((stat) => stat.key === 'cards');
    expect(cards?.questions).toBe(2);
    expect(cards?.databases).toEqual(['card_games']);
  });

  it('records every database a key was taught in', () => {
    const stats = keyStats([
      entry('the label of the molecule', 'label = the class', 'toxicology'),
      entry('the label of the movie', 'label = the class', 'movies'),
    ]);
    expect(stats.find((stat) => stat.key === 'label')?.databases).toEqual(['movies', 'toxicology']);
  });

  it('ranks by reach and breaks ties alphabetically, so a diff is stable', () => {
    const stats = [
      stat('zebra', 1),
      stat('alpha', 3),
      stat('beta', 1),
    ];
    expect(orderedKeys(stats)).toEqual(['alpha', 'beta', 'zebra']);
  });

  it('counts a question once however many keys it contains', () => {
    expect(reachOf(['cards', 'drivers'], cases.map((one) => one.question))).toBe(3);
  });

  it('reaches nothing with no keys, and counts nothing with no questions', () => {
    expect(reachOf([], cases.map((one) => one.question))).toBe(0);
    expect(reachOf(['cards'], [])).toBe(0);
  });
});

describe('the curve a store of a given size reaches', () => {
  const questions = ['alpha one', 'alpha two', 'beta three', 'gamma four'];
  const ordered = ['alpha', 'beta', 'gamma'];

  it('reports each stop as a point, with the share it buys', () => {
    expect(reachCurve(ordered, questions, [1, 2, 3])).toEqual([
      { keys: 1, covered: 2, share: 0.5 },
      { keys: 2, covered: 3, share: 0.75 },
      { keys: 3, covered: 4, share: 1 },
    ]);
  });

  it('treats a stop past the end as the whole store, because the ceiling is a legitimate question', () => {
    expect(reachCurve(ordered, questions, [99])).toEqual([{ keys: 3, covered: 4, share: 1 }]);
  });

  it('reports a share of zero rather than NaN when there are no questions', () => {
    expect(reachCurve(ordered, [], [2])).toEqual([{ keys: 2, covered: 0, share: 0 }]);
  });

  it('finds the fewest keys that reach a share', () => {
    expect(keysForShare(ordered, questions, 0.5)).toBe(1);
    expect(keysForShare(ordered, questions, 0.75)).toBe(2);
    expect(keysForShare(ordered, questions, 1)).toBe(3);
  });

  it('returns null when no prefix reaches the share, rather than the last one tried', () => {
    expect(keysForShare(['alpha'], questions, 0.9)).toBeNull();
    expect(keysForShare([], questions, 0.1)).toBeNull();
    expect(keysForShare(ordered, [], 0.1)).toBeNull();
  });

  it('agrees with reachCurve at the crossing it reports', () => {
    const crossing = keysForShare(ordered, questions, 0.75) as number;
    const point = reachCurve(ordered, questions, [crossing])[0];
    expect(point?.share).toBeGreaterThanOrEqual(0.75);
    const before = reachCurve(ordered, questions, [crossing - 1])[0];
    expect(before?.share).toBeLessThan(0.75);
  });
});

describe('how a store spreads over the databases', () => {
  const cases = [
    entry('How many cards are there', 'cards = the table', 'card_games'),
    entry('Which cards are banned', 'cards = the table', 'card_games'),
    entry('List the drivers', 'driver refers to driverRef', 'formula_1'),
    entry('How many users', undefined, 'codebase'),
  ];

  it('reads a concentrated store as concentrated', () => {
    const shares = databaseShares(['cards'], cases);
    expect(shares[0]).toEqual({ database: 'card_games', keys: 1, covered: 2, questions: 2 });
    expect(shares.filter((share) => share.covered === 0).map((share) => share.database))
      .toEqual(['codebase', 'formula_1']);
  });

  it('reports a database the store never fires in rather than leaving it out', () => {
    // A store that covers 7 of 11 databases is a different object from one that covers 11, and a
    // reading that omits the empty ones cannot tell them apart.
    expect(databaseShares(['cards'], cases)).toHaveLength(3);
  });

  it('counts a key once per database however many of its questions contain it', () => {
    const shares = databaseShares(['cards', 'driver'], cases);
    expect(shares.find((share) => share.database === 'card_games')?.keys).toBe(1);
    expect(shares.find((share) => share.database === 'formula_1')?.keys).toBe(1);
  });
});

describe('the gate over the reading', () => {
  const point = (keys: number, covered: number) => ({ keys, covered, share: covered / 10 });

  it('passes a curve that rises and ends at the union of every key', () => {
    const gate = frontierGate({ curve: [point(1, 3), point(2, 7)], distinctKeys: 2, questions: 10 });
    expect(gate.pass).toBe(true);
    expect(gate.id).toBe('V66-frontier-is-a-curve');
  });

  it('refuses an empty key set, an empty split, and an empty curve, each by name', () => {
    expect(frontierGate({ curve: [point(1, 1)], distinctKeys: 0, questions: 10 }).detail)
      .toContain('no keys were read');
    expect(frontierGate({ curve: [point(1, 1)], distinctKeys: 1, questions: 0 }).detail)
      .toContain('no questions to reach');
    expect(frontierGate({ curve: [], distinctKeys: 1, questions: 10 }).detail)
      .toContain('no curve was computed');
  });

  it('refuses a curve that falls as keys are added', () => {
    const gate = frontierGate({ curve: [point(1, 7), point(2, 6)], distinctKeys: 2, questions: 10 });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('reach fell from 7 to 6');
  });

  it('refuses a whole key set that reaches nothing, which is a matcher that disagrees with the corpus', () => {
    const gate = frontierGate({ curve: [point(3, 0)], distinctKeys: 3, questions: 10 });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('reaches nothing');
  });
});

describe('the vocabulary a frontier is built from', () => {
  it('keeps a key the corpus defines wherever it appears, and drops one it wrote about once', () => {
    // The shape this separates: `single bond` is annotated in every question that mentions it, while
    // `list` is annotated once and occurs in hundreds. Both reach; only one is a term.
    const cases = [
      entry('single bond count one', 'single bond = a bond of order one', 'chem'),
      entry('single bond count two', 'single bond = a bond of order one', 'chem'),
      entry('list the single bond count', 'single bond = a bond of order one; list = a listing', 'chem'),
      entry('list every row', 'list = a listing', 'chem'),
    ];
    const stats = keyStats(cases);
    const bond = stats.find((one) => one.key === 'single bond');
    const list = stats.find((one) => one.key === 'list');
    expect(bond).toMatchObject({ questions: 3, taught: 3 });
    expect(bond?.density).toBe(1);
    expect(list).toMatchObject({ questions: 2, taught: 2 });
    // `single bond` reaches three questions and `list` two, so reach orders them even at equal density.
    expect(vocabularyKeys(stats, 1)).toEqual(['single bond', 'list']);
    expect(vocabularyKeys(stats, 1).length).toBeLessThanOrEqual(stats.length);
  });

  it('reports a density of zero for a key no question contains, rather than dividing by it', () => {
    const stats = keyStats([entry('something else entirely', 'absent phrase = a thing', 'db')]);
    expect(stats[0]).toMatchObject({ key: 'absent phrase', questions: 0, density: 0 });
  });

  it('drops every key when the threshold is above one, which is how the band gets its floor', () => {
    const stats = keyStats([entry('single bond', 'single bond = a bond', 'db')]);
    expect(vocabularyKeys(stats, 1.5)).toEqual([]);
  });

  it('orders the kept keys by reach, so a frontier over vocabulary is ranked like any other', () => {
    const stats = [stat('rare', 1, 1), stat('common', 9, 9), stat('generic', 90, 1)];
    expect(vocabularyKeys(stats, 0.5)).toEqual(['common', 'rare']);
  });
});
