/**
 * The frontier a term store is measured against, and where one particular store sat.
 *
 * R37 built a store of `{term, statement}` pairs, licensed it, and rendered on 132 of 1,534
 * questions — 8.6%, against a floor of 25% the registration fixed before the run. The round closed
 * as *inconclusive by feasibility*, and §153 attributed the reach to the corpus: "a definition is
 * reusable only where a corpus reuses a phrase, and this one does not."
 *
 * That attribution is testable without a model call, because the corpus already contains a store of
 * definitions written by the people who made it. BIRD attaches an `evidence` block to 90% of dev
 * questions, and that block is not prose: it is a mapping from a phrase in the question to the
 * database vocabulary the phrase denotes —
 *
 *     Eligible free rate for K-12 = `Free Meal Count (K-12)` / `Enrollment (K-12)`
 *     driver reference name refers to driverRef
 *
 * Read as a store, those mappings give the key universe a definitional memory could have had. So
 * the question "was 8.6% the corpus's ceiling or the store's?" has an answer: rank the corpus's own
 * keys by how many questions they reach, and ask how many keys are needed to render on a quarter of
 * the split.
 *
 * **What this module is not.** It is not a claim that a distiller could have chosen those keys. The
 * keys come from the benchmark's annotations, which a learner never sees; the point of the frontier
 * is to separate two explanations of one number, and only after that separation is it worth asking
 * how close a learner can get. A frontier computed from an oracle is an upper bound on what a store
 * of that size could reach, and an upper bound is the right instrument for deciding whether a
 * ceiling was geometric or constructed.
 *
 * Three properties are load-bearing, and each has a failure it prevents:
 *
 * **Matching is `occursIn`, not a second regex.** A term memory fires on a question because the
 * question contains the term, and that predicate already exists in `lexicon.ts` with word
 * boundaries, an optional plural and Unicode letters. A frontier computed with a looser matcher
 * would report a reach the lane cannot achieve — which is the failure mode `AUDIT` §34.9 records
 * for a duplicated `exchangeOf`.
 *
 * **A key is counted by the questions it reaches, never by the questions that taught it.** The
 * first version of this reading ranked keys by how many *evidence blocks* contained them, which
 * counts teaching rather than reach, and it put `element` (an evidence key 100 times, in a database
 * whose questions name it 53 times) above `cards` (a term the arm found, which reaches 87). Reach is
 * a property of questions, so the ranking must be measured on questions.
 *
 * **The curve is reported whole, not at the point that flatters it.** Reach is monotone in the
 * number of keys, so any single point is a choice; the reading publishes the curve and derives the
 * two crossings a reader needs (25% and 50%) from it, so a store size can be judged against a target
 * rather than against the store we happen to have.
 */
import { occursIn } from './lexicon.js';

/** One mapping the corpus's own annotation carries: a phrase, and what it denotes. */
export type Bridge = {
  /** The left-hand side, which is the phrase a question uses. */
  readonly key: string;
  /** The right-hand side, which is the database vocabulary it denotes. */
  readonly value: string;
};

/**
 * The three shapes BIRD's annotations use, and nothing else.
 *
 * Deliberately narrow. A fourth shape ("X is the number of Y") can be added when a reading needs it,
 * and until then the narrow set is what makes the parse auditable: three patterns a reader can
 * check against the examples above beat a grammar nobody can. `refers to` is matched before `=` and
 * `means` because the annotations mix them within one block, and the first shape a segment matches
 * is the one that segment is read as.
 */
const SHAPES: readonly RegExp[] = [
  /^(.*?)\s+refers?\s+to\s+(.*)$/i,
  /^(.*?)\s*=\s*(.*)$/i,
  /^(.*?)\s+means?\s+(.*)$/i,
];

/** A key shorter than this is a word fragment rather than a phrase a question could contain. */
const MIN_KEY = 3;

/** A value shorter than this carries no database vocabulary. */
const MIN_VALUE = 2;

/**
 * The mappings one evidence block carries, in the order they appear.
 *
 * Segments are split on `;` and newlines because the annotations separate mappings that way, and a
 * segment that matches no shape is dropped rather than guessed at: 10% of the blocks are prose
 * ("the ratio of ... to ..."), and inventing a key for them would inflate the frontier with
 * mappings the corpus never made.
 */
export function bridgesOf(evidence: string | undefined): readonly Bridge[] {
  if (evidence === undefined) return [];
  const bridges: Bridge[] = [];
  for (const segment of evidence.split(/[;\n]/)) {
    const text = segment.trim();
    if (text === '') continue;
    for (const shape of SHAPES) {
      const match = shape.exec(text);
      if (match === null) continue;
      const key = (match[1] as string).trim();
      const value = (match[2] as string).trim();
      if (key.length < MIN_KEY || value.length < MIN_VALUE) break;
      bridges.push({ key, value });
      break;
    }
  }
  return bridges;
}

/** The distinct keys of a set of mappings, lowercased, in first-seen order. */
export function keysOf(bridges: readonly Bridge[]): readonly string[] {
  const seen = new Set<string>();
  for (const bridge of bridges) seen.add(bridge.key.toLowerCase());
  return [...seen];
}

/** What one case contributes to the frontier: its question, its annotation, and its database. */
export type BridgeCase = {
  readonly question: string;
  readonly evidence: string | undefined;
  readonly database: string;
};

/** One key and the questions it reaches, with the databases it was taught in. */
export type KeyStat = {
  readonly key: string;
  /** Questions whose text contains the key — the only count that is a reach. */
  readonly questions: number;
  /** Annotations that carry this key: how often the corpus judged it worth defining. */
  readonly taught: number;
  /** `taught / questions` — how much of the key's occurrence the corpus treats as needing a definition. */
  readonly density: number;
  /** Databases the key was taught in, sorted; a key spans several when the corpus repeats it. */
  readonly databases: readonly string[];
};

/**
 * Every key the corpus's annotations carry, with the number of questions it reaches.
 *
 * Counting is a full pass per key over every question, which is quadratic and deliberate: the
 * alternative is an inverted index whose correctness is a second implementation of `occursIn`, and
 * 1,536 keys over 1,534 questions is 2.4M matches — a second of work to avoid a class of bug.
 */
export function keyStats(cases: readonly BridgeCase[]): readonly KeyStat[] {
  const seen = new Map<string, { databases: Set<string>; taught: number }>();
  for (const entry of cases) {
    for (const key of keysOf(bridgesOf(entry.evidence))) {
      const row = seen.get(key) ?? { databases: new Set<string>(), taught: 0 };
      row.databases.add(entry.database);
      row.taught += 1;
      seen.set(key, row);
    }
  }
  const stats: KeyStat[] = [];
  for (const [key, row] of seen) {
    let questions = 0;
    for (const entry of cases) if (occursIn(key, entry.question)) questions += 1;
    stats.push({
      key,
      questions,
      taught: row.taught,
      density: questions === 0 ? 0 : row.taught / questions,
      databases: [...row.databases].sort(),
    });
  }
  return stats;
}

/**
 * The keys the corpus treats as vocabulary rather than as scaffolding.
 *
 * The first version of this reading ranked every key the annotations mention, and its frontier was
 * reached in two keys: `list` and `name`. Both are annotated exactly once in 1,534 questions and both
 * occur in hundreds of them, so they are not terms the corpus defines — they are English the corpus
 * happened to write a line about. A frontier built from them measures the frequency of English, not
 * the reach of a definitional store.
 *
 * `density` is the separator, and it is the corpus's own judgement rather than a stopword list: how
 * often a key is annotated, over how often it occurs. `single bond` is annotated every time it
 * appears (density 1.0); `list` is annotated once in 272 (0.004). A term needs defining wherever it
 * is used; a word does not. The threshold is a parameter because the honest reading is the band it
 * produces, and the artefact publishes three.
 */
export function vocabularyKeys(stats: readonly KeyStat[], minDensity: number): readonly string[] {
  return orderedKeys(stats.filter((stat) => stat.density >= minDensity));
}

/**
 * The keys in the order a store of that size would hold them: reach first, then alphabetically.
 *
 * The tie-break is alphabetical rather than insertion order so the ordering is a property of the
 * data and not of the pass that built it — a frontier that moves when a `Map` is reordered is a
 * frontier nobody can diff.
 */
export function orderedKeys(stats: readonly KeyStat[]): readonly string[] {
  return [...stats]
    .sort((left, right) => right.questions - left.questions || left.key.localeCompare(right.key))
    .map((stat) => stat.key);
}

/** How many of these questions contain at least one of these keys. */
export function reachOf(keys: readonly string[], questions: readonly string[]): number {
  let covered = 0;
  for (const question of questions) {
    for (const key of keys) {
      if (occursIn(key, question)) {
        covered += 1;
        break;
      }
    }
  }
  return covered;
}

/** One point of the curve: a store of `keys` distinct terms, and the share of questions it renders on. */
export type CurvePoint = {
  readonly keys: number;
  readonly covered: number;
  readonly share: number;
};

/**
 * The reach of the best `k` keys, for each `k` in `stops`.
 *
 * `ordered` is the ranked key list, so a stop beyond its length is the whole store rather than an
 * error: a caller asking for the reach at 1,536 keys when the corpus has 1,536 is asking for the
 * ceiling, and that is a legitimate question with an answer.
 */
export function reachCurve(
  ordered: readonly string[],
  questions: readonly string[],
  stops: readonly number[],
): readonly CurvePoint[] {
  return stops.map((stop) => {
    const keys = ordered.slice(0, Math.min(stop, ordered.length));
    const covered = reachOf(keys, questions);
    return { keys: keys.length, covered, share: questions.length === 0 ? 0 : covered / questions.length };
  });
}

/**
 * The fewest keys that reach a share of the questions, or null when no prefix does.
 *
 * Linear rather than binary search, because monotonicity is a property the caller should not have to
 * assert: the function walks the ranking and returns the first crossing, so a curve that is not
 * monotone returns the first point that crossed rather than a wrong one from a bisection.
 */
export function keysForShare(
  ordered: readonly string[],
  questions: readonly string[],
  share: number,
): number | null {
  let covered = 0;
  const hit = new Set<number>();
  for (let index = 0; index < ordered.length; index += 1) {
    const key = ordered[index] as string;
    questions.forEach((question, position) => {
      if (hit.has(position)) return;
      if (occursIn(key, question)) {
        hit.add(position);
        covered += 1;
      }
    });
    if (questions.length > 0 && covered / questions.length >= share) return index + 1;
  }
  return null;
}

/** How a store's distinct terms are spread over the split's databases, and how much each reaches. */
export type DatabaseShare = {
  readonly database: string;
  /** Distinct keys of this store that the database's questions contain. */
  readonly keys: number;
  /** Questions of this database the store renders on. */
  readonly covered: number;
  /** Questions the database contributes to the split. */
  readonly questions: number;
};

/**
 * The same store, read database by database.
 *
 * This is the reading that separates "the corpus does not repeat phrases" from "the store drew its
 * terms from two databases out of eleven": a store whose reach is concentrated in one database is
 * not evidence about the corpus, and a store that spreads is not either until the spread is shown.
 */
export function databaseShares(
  keys: readonly string[],
  cases: readonly BridgeCase[],
): readonly DatabaseShare[] {
  const totals = new Map<string, { keys: Set<string>; covered: number; questions: number }>();
  for (const entry of cases) {
    const row = totals.get(entry.database) ?? { keys: new Set<string>(), covered: 0, questions: 0 };
    row.questions += 1;
    let fires = false;
    for (const key of keys) {
      if (!occursIn(key, entry.question)) continue;
      fires = true;
      row.keys.add(key);
    }
    if (fires) row.covered += 1;
    totals.set(entry.database, row);
  }
  return [...totals]
    .map(([database, row]) => ({
      database,
      keys: row.keys.size,
      covered: row.covered,
      questions: row.questions,
    }))
    .sort((left, right) => right.covered - left.covered || left.database.localeCompare(right.database));
}

/**
 * The gate: the curve is a curve.
 *
 * Four ways this reading could publish a number that is not a reach, each refused by name: an empty
 * key set (nothing was read from the annotations), a key set that reaches nothing (the matcher and
 * the corpus disagree), a curve that decreases as keys are added (the ranking and the reach are not
 * the same order, so every point is suspect), and a last point that is not the union of every key
 * (the prefix was truncated).
 */
export type FrontierGate = {
  readonly id: string;
  readonly pass: boolean;
  readonly blocking: boolean;
  readonly detail: string;
};

export function frontierGate(input: {
  readonly curve: readonly CurvePoint[];
  readonly distinctKeys: number;
  readonly questions: number;
}): FrontierGate {
  const reasons: string[] = [];
  if (input.distinctKeys === 0) reasons.push('no keys were read from the annotations');
  if (input.questions === 0) reasons.push('no questions to reach');
  if (input.curve.length === 0) reasons.push('no curve was computed');
  for (let index = 1; index < input.curve.length; index += 1) {
    const previous = input.curve[index - 1] as CurvePoint;
    const current = input.curve[index] as CurvePoint;
    if (current.covered < previous.covered) {
      reasons.push(`reach fell from ${String(previous.covered)} to ${String(current.covered)} at ${String(current.keys)} keys`);
      break;
    }
  }
  const last = input.curve[input.curve.length - 1];
  if (last !== undefined && last.keys === input.distinctKeys && last.covered === 0) {
    reasons.push('the whole key set reaches nothing');
  }
  return {
    id: 'V66-frontier-is-a-curve',
    pass: reasons.length === 0,
    blocking: true,
    detail: reasons.length === 0
      ? `${String(input.curve.length)} points, monotone, last point is the union of ${String(input.distinctKeys)} keys`
      : reasons.join('; '),
  };
}
