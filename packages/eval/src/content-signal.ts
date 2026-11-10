/**
 * The signals that *read* a candidate, beside the ones that measure its shape.
 *
 * R67 priced seven shape signals on 350 questions and every one of their AUC intervals straddled
 * 0.5. That is not a defect of the signals; it is a property of what they are. A signature is
 * `{rows, columns, nulls, duplicates, scalar}` — it says how big an answer is, never whether it is
 * the answer to *this* question. Two queries that return one row in one column are one signature
 * whether the column is named `County` or `count`.
 *
 * The competitor's selection step does the opposite. CHESS writes assertions from the question
 * itself — "the result must have a column named `County`", "the answer must be one row" — and
 * executes them per candidate. The first kind is content-aware and costs nothing to approximate
 * deterministically; the second kind is shape and this lane already knows it does not rank.
 *
 * So this module asks the cheap half of the competitor's question, offline, on a pool that has
 * already been bought: **does the result name something the question names, and does the query carry
 * a literal the question carries.** Two signals, each with the same question-clustered interval the
 * shape signals get, computed by the same function, so the comparison between reading and measuring
 * is a comparison and not an analogy.
 *
 * What it is not: a model. CHESS's assertions are written by an LLM per question, which is where its
 * 8.2 points live and what a call per candidate would buy. If these two free signals cannot order a
 * pool, the honest conclusion is that the gap is the *price of reading* rather than a missing
 * cheap signal — and that is a decision, not a shrug, because it says exactly what to spend on next.
 */

import {
  aucReading,
  type AucReading,
  type PoolCandidate,
  type PoolQuestion,
} from './pool.js';

/** The content signals, fixed here so a table cannot quietly omit one. */
export const CONTENT_SIGNALS = ['column-mention', 'literal-match', 'content-mean'] as const;

export type ContentSignalName = (typeof CONTENT_SIGNALS)[number];

/**
 * Words that carry no answer.
 *
 * A question is mostly grammar with a few nouns in it, and a column called `name` will match the
 * word "name" in half of BIRD's questions for no reason at all. The list is deliberately blunt —
 * only function words and the vocabulary every BIRD question shares ("many", "list", "give") — and
 * it costs recall to buy the only thing a gate needs, which is a signal that is never right by
 * accident.
 */
const STOPWORDS = new Set([
  'about', 'after', 'all', 'also', 'and', 'any', 'are', 'been', 'before', 'between', 'both', 'but',
  'can', 'count', 'each', 'every', 'find', 'for', 'from', 'give', 'had', 'has', 'have', 'how', 'into',
  'its', 'least', 'less', 'list', 'many', 'more', 'most', 'much', 'name', 'not', 'number', 'only',
  'other', 'over', 'per', 'return', 'same', 'show', 'some', 'such', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'total', 'under', 'value', 'was', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would', 'year',
]);

/** Lowercase alphanumeric tokens, which is the only normalisation both a question and a column share. */
function tokensOf(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/**
 * The words a question is *about*: four characters or more, not grammar, and not a number.
 *
 * Numbers are excluded here and read by `literalTokensOf` instead. A year is a thing the query has
 * to *write*, not a thing the result has to be *named*, and counting `2016` as a content word splits
 * one question's evidence across two signals and halves the column score of a perfectly good answer.
 * The first version of this function did exactly that, and a test written against a question with a
 * year in it caught the arithmetic rather than the idea.
 */
export function contentWordsOf(text: string): readonly string[] {
  const seen = new Set<string>();
  for (const token of tokensOf(text)) {
    if (token.length < 4 || STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    seen.add(token);
  }
  return [...seen].sort();
}

/**
 * Literals a question states: numbers, and single-quoted strings.
 *
 * These are the values a query has to carry to answer the question, so their presence is evidence
 * in a way that shape is not. `2015/2016`, `2016` and `'Rock'` are all found here; `the` is not.
 */
export function literalTokensOf(text: string): readonly string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/'[^']+'|\d[\d./:-]*/g)) {
    found.add(match[0].toLowerCase());
  }
  return [...found].sort();
}

/**
 * Share of the question's content words that a column name accounts for.
 *
 * Exact token containment rather than substring: `player` and `players` are the same answer to a
 * reader and two different tokens to this function, and the loss is deliberate — a substring rule
 * would match `id` inside `player_id` for every question in the corpus and score every candidate
 * equally, which reads as an inert signal when it is a broken one.
 */
function columnMentionScore(candidate: PoolCandidate, words: readonly string[]): number {
  if (words.length === 0) return 0;
  const columns = candidate.columns ?? [];
  if (columns.length === 0) return 0;
  const columnTokens = new Set(columns.flatMap((column) => tokensOf(column)));
  let matched = 0;
  for (const word of words) {
    if (columnTokens.has(word) || columnTokens.has(`${word}s`) || columnTokens.has(word.replace(/s$/, ''))) {
      matched += 1;
    }
  }
  return matched / words.length;
}

/** Share of the literals the question states that the query actually writes. */
function literalMatchScore(candidate: PoolCandidate, literals: readonly string[]): number {
  if (literals.length === 0) return 0;
  const text = (candidate.sql ?? '').toLowerCase();
  if (text === '') return 0;
  let matched = 0;
  for (const literal of literals) {
    if (text.includes(literal)) matched += 1;
  }
  return matched / literals.length;
}

/**
 * One content signal's score for one candidate.
 *
 * `content-mean` is the mean of the two that have something to say, so a question with no literal
 * in it is not scored as if it had failed one. A candidate with no recorded query scores zero on
 * every signal rather than abstaining: the pool records the empty string for a draw that produced no
 * SQL, and a draw that produced no query is a candidate a selector cannot pick, which is a fact
 * about it rather than a gap in the measurement.
 */
export function contentScoreOf(
  candidate: PoolCandidate,
  words: readonly string[],
  literals: readonly string[],
  signal: ContentSignalName,
): number {
  const column = columnMentionScore(candidate, words);
  const literal = literalMatchScore(candidate, literals);
  if (signal === 'column-mention') return column;
  if (signal === 'literal-match') return literal;
  const stated = (words.length > 0 ? 1 : 0) + (literals.length > 0 ? 1 : 0);
  return stated === 0 ? 0 : (column + literal) / stated;
}

/** A question a content reading can actually read: text recorded, and every candidate carrying a query. */
type ReadableQuestion = PoolQuestion & { readonly question: string };

/**
 * The population a content reading is defined on, as a type and not as a filter that is applied twice.
 *
 * The first version filtered inline in two places and then wrote `question.question ?? ''` at the
 * point of use, which is a branch that can never be false and therefore never covered — a dead line
 * that reads like a guard. Narrowing once means the reading below cannot see an unrecorded question,
 * and there is no expression left that pretends to handle one.
 */
function readable(questions: readonly PoolQuestion[]): readonly ReadableQuestion[] {
  return questions.filter(
    (question): question is ReadableQuestion =>
      typeof question.question === 'string' &&
      question.question !== '' &&
      question.candidates.length > 0 &&
      question.candidates.every((candidate) => typeof candidate.sql === 'string'),
  );
}

/** The question's own words, prepared once per question rather than once per candidate. */
function prepared(question: ReadableQuestion): {
  readonly words: readonly string[];
  readonly literals: readonly string[];
} {
  return {
    words: contentWordsOf(question.question),
    literals: literalTokensOf(question.question),
  };
}

/**
 * Every content signal, read on the same axis as the shape signals.
 *
 * The population is narrowed to questions where **every** candidate carries its query, and the
 * narrowing is reported: a run that recorded half its pool would otherwise produce an AUC over a
 * biased half and read as a reading of the whole. When nothing carries a query — every artefact
 * written before R69's successor — the result is empty, which is the honest answer and the one a
 * caller must be able to tell apart from "the signals were at chance".
 */
export function contentReadings(
  questions: readonly PoolQuestion[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly AucReading<ContentSignalName>[] {
  const complete = readable(questions);
  if (complete.length === 0) return [];
  return CONTENT_SIGNALS.map((signal) =>
    aucReading(
      complete,
      signal,
      (candidate, question) => {
        const ready = prepared(question);
        return contentScoreOf(candidate, ready.words, ready.literals, signal);
      },
      options,
    ),
  );
}

/** Questions whose every candidate carries its query: the population `contentReadings` reads. */
export function contentPopulation(questions: readonly PoolQuestion[]): number {
  return readable(questions).length;
}
