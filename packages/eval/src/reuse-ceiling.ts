/**
 * Does the corpus carry a lesson at all?
 *
 * Twelve content axes have come back null on BIRD — coverage, imported identifiers, denial,
 * procedural vs declarative form, grounding, size-matched controls, anchoring, conditional
 * execution, deletion, recall order, and the two the previous round added. Each null was explained
 * afterwards by saying that axis does not carry the effect, and twelve explanations of the same
 * shape is a hypothesis about the corpus rather than twelve facts about twelve axes. This module
 * tests the hypothesis directly.
 *
 * **The hypothesis.** A memory cannot transfer a lesson to a question whose answer shares no
 * column with the case the lesson came from: a rule about `County` says nothing about a query that
 * needs `Free Meal Count`. So the ceiling on any memory is not the quality of its sentences but the
 * **reuse** the corpus admits — how much of a nearby case's answer applies to this one. If a corpus
 * of questions each written against a fresh column set admits little reuse, then every content axis
 * built on it will read null, and no amount of distillation or ranking will change that.
 *
 * **How reuse is measured.** For every case, the nearest other case **inside its own database** is
 * found from the question text alone, and reuse is the Jaccard overlap of the two gold queries'
 * column sets. The question text is the only input, because that is all a deployed system has; the
 * gold queries are the measurement, not the retrieval.
 *
 * **Columns come from the tokenizer, not from backticks.** The obvious extractor — everything
 * between backticks — sees a column in 8% of this corpus's gold queries, because BIRD writes
 * `SELECT player_api_id` without quoting. A first pass with that extractor reported a median
 * overlap of exactly zero, which is not a fact about BIRD but a fact about the extractor. The
 * numbers here use `sqlShapeOf`, whose `columns` field excludes keywords, tables, aliases, output
 * labels, CTEs and function names.
 *
 * **The unit of evidence is a replication, not a bin.** One corpus's highest band is allowed to be
 * anything. The reading that decides is whether the same band keeps its sign on a corpus that
 * shares no database with it, because that is the only thing that separates a mechanism from a
 * sorting accident. The module therefore publishes both corpora side by side and a verdict whose
 * only job is to say whether the sign survived.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import { sqlShapeOf } from '@agentix-e/microglia-sql';
import type { ResampledInterval } from './stats.js';

/** One case, as this reading needs it: the question, the answer, and what each arm did. */
export type ReuseRow = {
  readonly cluster: string;
  readonly question: string;
  readonly goldSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

/**
 * Lower edges of the reuse bands. Fixed here rather than chosen per run, because a band edge chosen
 * after seeing the gain is a threshold fitted to noise — and the whole point of this module is to
 * stop producing those.
 *
 * `0.75` is the interesting edge: it means three of four columns are shared, which is the closest
 * thing this corpus has to "the same question twice".
 */
export const REUSE_EDGES: readonly number[] = [0, 0.25, 0.5, 0.75];

/**
 * Content words of a question. Words shorter than three letters and a short list of interrogatives
 * are dropped because they are shared by every question in the corpus and would make every pair
 * look similar. The list is deliberately short: a longer stop list is a knob, and this reading must
 * not depend on a knob.
 */
const STOP = new Set([
  'the', 'and', 'for', 'what', 'which', 'that', 'are', 'was', 'how', 'many', 'all', 'from', 'with',
  'list', 'give', 'show', 'find', 'name', 'names', 'there', 'their', 'has', 'have', 'can', 'does',
]);

export function contentWordsOf(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z]{3,}/g)) {
    const word = match[0];
    if (!STOP.has(word)) words.add(word);
  }
  return words;
}

/** Jaccard overlap of two sets, with the empty-vs-anything case defined as no overlap. */
export function overlapOf(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * How much of two answers is the same answer, in [0, 1].
 *
 * The denominator is the union of the two column sets, so a short query that is wholly contained in
 * a long one scores 0.5 rather than 1.0: reuse means the whole answer transfers, and a fragment is
 * not the whole answer.
 */
export function columnReuseOf(left: string, right: string): number {
  const a = sqlShapeOf(left).columns;
  const b = sqlShapeOf(right).columns;
  return overlapOf(new Set(a), new Set(b));
}

/** A case paired with the nearest case in its own database, and how much of its answer applies. */
export type ReusePair = {
  readonly cluster: string;
  readonly index: number;
  readonly source: number;
  readonly reuse: number;
  readonly gain: number;
};

/**
 * Pairs every case with its nearest neighbour inside the same database.
 *
 * Ties are broken on the source's gold query text, which is arbitrary but **stable**: a reading that
 * changes when the file is re-ordered is a reading that cannot gate anything. A database with one
 * case contributes no pair, because there is nothing to retrieve from it, and that absence is
 * counted in `unpaired` rather than scored as zero reuse.
 */
export function reusePairsOf(rows: readonly ReuseRow[]): { readonly pairs: readonly ReusePair[]; readonly unpaired: number } {
  const byCluster = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    const bucket = byCluster.get(row.cluster) ?? [];
    bucket.push(index);
    byCluster.set(row.cluster, bucket);
  }
  const words = rows.map((row) => contentWordsOf(row.question));
  const pairs: ReusePair[] = [];
  let unpaired = 0;
  for (const [, members] of byCluster) {
    if (members.length < 2) {
      unpaired += members.length;
      continue;
    }
    for (const index of members) {
      const target = rows[index] as ReuseRow;
      const targetWords = words[index] as ReadonlySet<string>;
      let best = -1;
      let bestScore = -1;
      for (const candidate of members) {
        if (candidate === index) continue;
        const score = overlapOf(targetWords, words[candidate] as ReadonlySet<string>);
        const rival = best === -1 ? undefined : (rows[best] as ReuseRow);
        if (score > bestScore || (score === bestScore && rival !== undefined && (rows[candidate] as ReuseRow).goldSql < rival.goldSql)) {
          bestScore = score;
          best = candidate;
        }
      }
      const source = rows[best] as ReuseRow;
      pairs.push({
        cluster: target.cluster,
        index,
        source: best,
        reuse: columnReuseOf(target.goldSql, source.goldSql),
        gain: (target.correct ? 1 : 0) - (target.withoutMemoryCorrect ? 1 : 0),
      });
    }
  }
  return { pairs, unpaired };
}

/** Which band a reuse value falls in. The last band is closed at 1, so a perfect match is included. */
export function bandOf(reuse: number): number {
  let band = 0;
  for (const [index, edge] of REUSE_EDGES.entries()) if (reuse >= edge) band = index;
  return band;
}

/** One band's reading: how many pairs, what the pack was worth on them, and the interval. */
export type ReuseBand = {
  readonly low: number;
  readonly high: number;
  readonly pairs: number;
  readonly clusters: number;
  readonly gainPp: number;
  readonly interval: ResampledInterval;
};

/**
 * The banded reading, with a cluster bootstrap over databases.
 *
 * The bootstrap resamples **databases**, not pairs, because two questions in one database share a
 * schema and are not independent draws of the corpus. The sufficient statistics are accumulated per
 * database and per band before the resampling, so every replicate is a sum over at most a few dozen
 * cells rather than a pass over seven thousand rows, and the five bands share one set of replicates —
 * which is what makes them comparable to each other rather than five separate experiments.
 *
 * A band containing no pair is reported with an interval of zero width at zero and `pairs: 0`; it is
 * not omitted, because a missing row reads as "not measured" when the truth is "nothing landed here".
 */
export function reuseBandsOf(
  pairs: readonly ReusePair[],
  resamples = 2_000,
  seed = 12345,
): readonly ReuseBand[] {
  const bands = REUSE_EDGES.length;
  const cells = new Map<string, { sums: number[]; counts: number[] }>();
  for (const pair of pairs) {
    const band = bandOf(pair.reuse);
    const cell = cells.get(pair.cluster) ?? { sums: Array<number>(bands).fill(0), counts: Array<number>(bands).fill(0) };
    (cell.sums[band] as number) += pair.gain;
    (cell.counts[band] as number) += 1;
    cells.set(pair.cluster, cell);
  }
  const labels = [...cells.keys()].sort();
  const random = mulberry32(seed);
  const draws: number[][] = Array.from({ length: bands }, () => []);
  for (let round = 0; round < resamples; round += 1) {
    const sums = Array<number>(bands).fill(0);
    const counts = Array<number>(bands).fill(0);
    for (let pick = 0; pick < labels.length; pick += 1) {
      const label = labels[Math.floor(random() * labels.length)] as string;
      const cell = cells.get(label) as { sums: number[]; counts: number[] };
      for (let band = 0; band < bands; band += 1) {
        sums[band] = (sums[band] as number) + (cell.sums[band] as number);
        counts[band] = (counts[band] as number) + (cell.counts[band] as number);
      }
    }
    for (let band = 0; band < bands; band += 1) {
      const count = counts[band] as number;
      if (count > 0) (draws[band] as number[]).push(((sums[band] as number) / count) * 100);
    }
  }
  return REUSE_EDGES.map((low, band) => {
    const members = pairs.filter((pair) => bandOf(pair.reuse) === band);
    const clusters = new Set(members.map((pair) => pair.cluster)).size;
    const total = members.reduce((sum, pair) => sum + pair.gain, 0);
    const gainPp = members.length === 0 ? 0 : (total / members.length) * 100;
    const sorted = (draws[band] as number[]).sort((a, b) => a - b);
    const interval: ResampledInterval =
      sorted.length === 0
        ? { low: 0, high: 0, point: 0, dropped: 0 }
        : {
            low: sorted[Math.floor(0.025 * (sorted.length - 1))] as number,
            high: sorted[Math.ceil(0.975 * (sorted.length - 1))] as number,
            point: gainPp,
            dropped: resamples - sorted.length,
          };
    return { low, high: low + 0.25, pairs: members.length, clusters, gainPp, interval };
  });
}

/** How the top band reads on one corpus, which is the only number a replication compares. */
export type TopBand = {
  readonly corpus: string;
  readonly cases: number;
  readonly databases: number;
  /** Cases that found a neighbour, and cases in a database with nobody else to retrieve. */
  readonly paired: number;
  readonly unpaired: number;
  readonly gainPp: number;
  readonly interval: ResampledInterval;
  /** Every band's count and point estimate, lowest reuse first: the shape, not just the top. */
  readonly bands: readonly { readonly low: number; readonly high: number; readonly pairs: number; readonly gainPp: number }[];
};

export type ReuseCensus = {
  readonly id: 'reuse';
  readonly floor: number;
  readonly corpora: readonly TopBand[];
  readonly verdict: ReuseVerdict;
};

/**
 * The decision rule, fixed before the numbers were read.
 *
 * `replicates` is true when the top band keeps its sign and clears zero on **both** corpora. The
 * other two readings are the ones the record has to carry: `contradicted` when the top band is
 * positive on one corpus and negative on the other, and `null` when neither clears zero. A verdict
 * of `contradicted` is stronger evidence than `null`: it says the band ordering is an artefact of
 * the corpus it was computed on.
 */
export type ReuseVerdict = {
  readonly label: 'replicates' | 'contradicted' | 'null';
  readonly reason: string;
};

export const REUSE_FLOOR = 5;

export function verdictOf(corpora: readonly TopBand[]): ReuseVerdict {
  if (corpora.length === 0) {
    return { label: 'null', reason: 'no corpus was read' };
  }
  const signs = corpora.map((corpus) => Math.sign(corpus.gainPp));
  const cleared = corpora.filter(
    (corpus) => !(corpus.interval.low <= 0 && corpus.interval.high >= 0),
  );
  const positive = signs.every((sign) => sign > 0) && cleared.length === corpora.length;
  const negative = signs.every((sign) => sign < 0) && cleared.length === corpora.length;
  if (positive || negative) {
    return {
      label: 'replicates',
      reason: `the top band keeps its sign and clears zero on ${String(corpora.length)} of ${String(corpora.length)} corpora`,
    };
  }
  const split = signs.some((sign) => sign > 0) && signs.some((sign) => sign < 0);
  if (split) {
    return {
      label: 'contradicted',
      reason: 'the top band is positive on one corpus and negative on another, so the ordering is a property of the corpus',
    };
  }
  return {
    label: 'null',
    reason: 'the top band does not clear zero on every corpus',
  };
}

/** Pads a label so a table can be read down a column rather than across a line. */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function ppText(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}pp`;
}

/** The bands of one corpus, one line each. */
export function bandLines(top: TopBand): readonly string[] {
  return top.bands.map((band) => {
    return `${pad(top.corpus, 10)} ${pad(`${band.low.toFixed(2)}–${band.high.toFixed(2)}`, 10)} ${pad(String(band.pairs), 5)} ${ppText(band.gainPp)}`;
  });
}

/** The headline: one line per corpus, then the verdict. */
export function reuseLines(census: ReuseCensus): readonly string[] {
  const header = `${pad('corpus', 10)} ${pad('cases', 6)} ${pad('db', 4)} ${pad('paired', 6)} ${pad('top band', 10)} ${pad('interval', 20)} up/down`;
  const rows = census.corpora.map((corpus) => {
    const interval = `[${corpus.interval.low.toFixed(2)}, ${corpus.interval.high.toFixed(2)}]`;
    const above = corpus.bands.filter((band) => band.gainPp > 0).length;
    const below = corpus.bands.filter((band) => band.gainPp < 0).length;
    return `${pad(corpus.corpus, 10)} ${pad(String(corpus.cases), 6)} ${pad(String(corpus.databases), 4)} ${pad(String(corpus.paired), 6)} ${pad(ppText(corpus.gainPp), 10)} ${pad(interval, 20)} ${above}/${below}`;
  });
  return [header, ...rows, `verdict: ${census.verdict.label} — ${census.verdict.reason}`];
}

function arrayAt(artefact: unknown, source: string): readonly unknown[] {
  if (typeof artefact !== 'object' || artefact === null) {
    throw new Error(`${source} is not an object, so it has no per_case rows`);
  }
  const rows = (artefact as { per_case?: unknown }).per_case;
  if (!Array.isArray(rows)) {
    throw new Error(`${source} carries no per_case array`);
  }
  return rows;
}

/**
 * Reads the cases this reading needs out of a committed artefact.
 *
 * The parser throws on a missing field rather than filling one in. A defaulted question would pair
 * the case with an arbitrary neighbour and a defaulted outcome would score it as unchanged, and both
 * of those produce a number that looks like a measurement.
 */
export function reuseRowsOf(artefact: unknown, source: string): ReuseRow[] {
  return arrayAt(artefact, source).map((row, at) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`${source}.per_case[${String(at)}] is not an object`);
    }
    const entry = row as Record<string, unknown>;
    const cluster = entry['dbId'];
    const question = entry['question'];
    const goldSql = entry['goldSql'];
    const correct = entry['correct'];
    const without = entry['withoutMemoryCorrect'];
    if (typeof cluster !== 'string' || cluster === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no dbId`);
    }
    if (typeof question !== 'string' || question === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no question, so there is nothing to retrieve from`);
    }
    if (typeof goldSql !== 'string' || goldSql === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no goldSql, so reuse cannot be measured`);
    }
    if (typeof correct !== 'boolean' || typeof without !== 'boolean') {
      throw new Error(`${source}.per_case[${String(at)}] does not carry both arms' outcomes`);
    }
    return { cluster, question, goldSql, correct, withoutMemoryCorrect: without };
  });
}

/**
 * The census: two corpora, one set of bands, one verdict.
 *
 * Both corpora are read with the same edges and the same seed, so the only thing that differs
 * between the two rows of the table is the corpus. `floor` is published beside them because a band
 * with four databases in it is a number, not an estimate, and the reader has to be able to see that.
 */
export function censusOf(
  inputs: readonly { readonly source: string; readonly rows: readonly ReuseRow[] }[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): ReuseCensus {
  const resamples = options.resamples ?? 2_000;
  const seed = options.seed ?? 12345;
  const corpora = inputs.map((input) => {
    const { pairs, unpaired } = reusePairsOf(input.rows);
    const bands = reuseBandsOf(pairs, resamples, seed);
    const top = bands[bands.length - 1] as ReuseBand;
    return {
      corpus: input.source,
      cases: input.rows.length,
      databases: new Set(input.rows.map((row) => row.cluster)).size,
      paired: pairs.length,
      unpaired,
      gainPp: top.gainPp,
      interval: top.interval,
      bands: bands.map((band) => ({ low: band.low, high: band.high, pairs: band.pairs, gainPp: band.gainPp })),
    };
  });
  return { id: 'reuse', floor: REUSE_FLOOR, corpora, verdict: verdictOf(corpora) };
}
