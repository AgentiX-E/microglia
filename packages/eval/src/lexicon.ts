/**
 * R37 — the grain of a memory write: a term and what it denotes, not advice about a query.
 *
 * Six routes have been closed while the corpus stayed fixed: which rules are stored (§145), how
 * many reach the prompt (§146, §151), whether a filter can drop the harmful ones (§147–§148),
 * which questions they are shown to (§149), whether an item carries a value that travels (§150).
 * What none of them changed is what a memory *is*: every item in this lane is a sentence of advice
 * about how to build a query, and advice has no referent — a reader cannot check it, so it is
 * applied wherever it is read.
 *
 * The corpus answers a different grain on the same questions, for free, and the record already
 * quotes the price: **the benchmark's own `evidence` field is 142 characters, mean, of "what this
 * term means here", and removing it costs 19–20pp** (R23, recomputed in `pnpm eval:lexicon`),
 * against the −0.71pp the distilled rule costs on the same split. A definition and a rule are not
 * two wordings of one thing:
 *
 * ```
 *   rule        "A query that asks only for a computed rate returns the rate, not the name."
 *               applies to      any question that resembles the one that taught it
 *               can introduce any name, in a query the question never licensed
 *   definition  "eligible free rate" = `Free Meal Count (K-12)` / `Enrollment (K-12)`
 *               applies to      a question that contains the term
 *               can introduce only the thing the term denotes
 * ```
 *
 * So this module is the definitional grain, and the only part of it that is a design decision is
 * the **action radius**: an entry may be stored only if its term occurs in the question it was
 * learned from, and it may be shown only on a question that still contains that term. Both are
 * mechanical predicates over text, both are enforced here rather than left to the model, and both
 * are falsifiable in the artefact — `V64` re-checks the second one against the prompt that was
 * actually sent.
 *
 * **What this module does not decide.** Whether a learned definition is worth anything. The corpus
 * says a *hand-written* one is worth 19–20pp; it says nothing about one distilled from a
 * correction, and the difference is the whole experiment. That is the R37 arm's job.
 *
 * Registered in `prereg/R37-lexicon-grain.md`.
 */
import type { DistillCandidate, Json } from '@agentix-e/microglia-core';

/** A learned definition: the surface form, and the sentence that says what it denotes. */
export type LexiconEntry = {
  readonly term: string;
  readonly statement: string;
};

/** Why a stored candidate was refused at the door, or a recalled entry at the prompt. */
export type LexiconRefusal = 'no-term' | 'term-not-in-question' | 'term-too-short' | 'looks-like-query';

/** The verdict for one candidate, with the reason kept for the artefact's drop counter. */
export type LexiconVerdict =
  | { readonly admitted: true; readonly entry: LexiconEntry }
  | { readonly admitted: false; readonly reason: LexiconRefusal };

/**
 * A term is a phrase copied from the question, not a sentence.
 *
 * The bounds are deliberately wide enough to admit three-word domain phrases (`eligible free
 * rate`) and narrow enough to refuse the two failure modes a model produces when it is asked for
 * a dictionary entry: a one-letter term that matches every question, and a clause that matches
 * this one. A term is also refused when it carries a sentence break, because a definition whose
 * subject is half a question cannot be looked up again.
 */
export const MIN_TERM = 3;
export const MAX_TERM = 80;

/** The term a payload declares, when it declares a usable one. */
export function termOf(payload: Json | undefined): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, Json | undefined>)['term'];
  if (typeof value !== 'string') return undefined;
  const term = value.trim().replace(/\s+/g, ' ');
  if (term.length < MIN_TERM || term.length > MAX_TERM) return undefined;
  if (/[.;!?]{1}\s/.test(term)) return undefined;
  return term;
}

/**
 * Whether a term occurs in a text, as a word sequence rather than as a substring.
 *
 * Substring matching would fire `rate` inside `separate`, which is the exact failure the whole
 * grain is meant to avoid: a definition that speaks where its term was never used. The boundaries
 * are `\b` on both ends, whitespace inside the term is flexible, and case is ignored because a
 * question and a distiller never agree on it.
 *
 * The plural is admitted on a word that ends in a letter: `schools` is `school` plus an `s`, and a
 * definition of the plural is a definition of the singular for the purpose of what the question
 * denotes. Nothing else is stemmed — `rate`/`rates` is the only decoration measured in this
 * corpus, and a stemmer would make the predicate unreadable for the sake of a case it never meets.
 */
export function occursIn(term: string, text: string): boolean {
  const pattern = term
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  if (pattern === '') return false;
  const exact = new RegExp(`(^|[^\\p{L}\\p{N}_])${pattern}(s?)(?=$|[^\\p{L}\\p{N}_])`, 'iu');
  return exact.test(text);
}

/**
 * A statement that contains a query is a demonstration wearing a definition's clothes.
 *
 * The gate exists because the failure is one the record has already paid for: an item that quotes
 * SQL is copied, and copying is what `full-raw` measured at −0.86pp. A definition may name an
 * expression (`Free Meal Count / Enrollment`), and may not contain a statement that runs.
 */
export function looksLikeQuery(statement: string): boolean {
  if (/```/.test(statement)) return true;
  return /\bselect\b[\s\S]{0,400}\bfrom\b/i.test(statement);
}

/**
 * The write-time invariant: a definition is stored only if its term is in the question that taught
 * it.
 *
 * This is the grain's whole claim made operational. An entry that cannot be looked up from the text
 * of the question it came from is a rule with a dictionary's layout — unfalsifiable at read time,
 * and therefore exactly the object this round is trying to replace. Refusing it at the door keeps
 * the store's contents checkable from the corpus alone, which is what makes `V64` a fact about the
 * store rather than a hope about retrieval.
 */
export function admitLexicon(candidate: DistillCandidate, question: string): LexiconVerdict {
  const term = termOf(candidate.payload);
  if (term === undefined) return { admitted: false, reason: 'no-term' };
  if (!occursIn(term, question)) return { admitted: false, reason: 'term-not-in-question' };
  if (looksLikeQuery(candidate.statement)) return { admitted: false, reason: 'looks-like-query' };
  return { admitted: true, entry: { term, statement: candidate.statement } };
}

/**
 * The write-time screen over a whole reply, with its refusals counted by reason.
 *
 * Separated from the interpreter wrapper so it can be tested without a model: the wrapper's only job
 * is to hold the event, and the arithmetic — which candidates survive, and why the others do not — is
 * the part that decides what the store contains. A store whose refusals are not counted looks exactly
 * like a model that had nothing to say, which is the failure this project has already paid for once
 * (`distill_drops` exists because a 640-character cap was silently discarding a whole content form).
 */
export function screenLexicon(
  candidates: readonly DistillCandidate[],
  question: string,
): { readonly kept: readonly DistillCandidate[]; readonly refused: Readonly<Record<string, number>> } {
  const kept: DistillCandidate[] = [];
  const refused: Record<string, number> = {};
  for (const candidate of candidates) {
    const verdict = admitLexicon(candidate, question);
    if (verdict.admitted) {
      kept.push(candidate);
      continue;
    }
    const key = `lexicon-${verdict.reason}`;
    refused[key] = (refused[key] ?? 0) + 1;
  }
  return { kept, refused };
}

/**
 * The read-time selection: the definitions whose term the question actually uses.
 *
 * Longest term first, then alphabetical, and every ordering that is not a design decision is fixed
 * so two runs over the same store produce the same prompt. Length sorts first because a longer term
 * is a more specific one — `eligible free rate` before `rate` — and a budget that runs out should
 * run out on the general entry rather than on the specific one.
 *
 * `budget` counts the rendered characters including the newline separators, because that is what
 * the pack's character budget has always meant. An entry that does not fit is dropped and counted,
 * never truncated: half a definition is a claim nobody wrote.
 */
export type LexiconPack = {
  readonly lines: readonly string[];
  readonly terms: readonly string[];
  readonly chars: number;
  /** Entries the budget refused, and entries the question did not licence. */
  readonly dropped: number;
  readonly unlicensed: number;
};

export function lexiconPackOf(
  entries: readonly LexiconEntry[],
  question: string,
  budget: number,
): LexiconPack {
  const licensed = entries.filter((entry) => occursIn(entry.term, question));
  const ordered = [...licensed].sort(
    (left, right) => right.term.length - left.term.length || left.term.localeCompare(right.term),
  );
  const lines: string[] = [];
  const terms: string[] = [];
  let chars = 0;
  let dropped = 0;
  for (const entry of ordered) {
    const line = `- "${entry.term}": ${entry.statement}`;
    const cost = line.length + (lines.length === 0 ? 0 : 1);
    if (chars + cost > budget) {
      dropped += 1;
      continue;
    }
    lines.push(line);
    terms.push(entry.term);
    chars += cost;
  }
  return {
    lines,
    terms,
    chars,
    dropped,
    unlicensed: entries.length - licensed.length,
  };
}

/**
 * The question text a feedback event carries.
 *
 * Two shapes reach this lane: the chart study's input is an object, the SQL lane's is the question
 * string itself. A helper rather than a cast in three call sites, because a silent `undefined` here
 * would refuse every lexicon candidate and report the store as empty — the failure mode that would
 * look like "the model had nothing to say".
 */
export function questionTextOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === null || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['question', 'text', 'prompt']) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

/**
 * The term a rendered line declares, read back out of the line the model actually saw.
 *
 * The renderer writes `- "term": statement`, and this is the only reader of that shape, shared by the
 * gate and by any later reading, because two regexes over one format drift: a line the gate cannot
 * read is a line whose licence nobody checked, and a second implementation that reads it differently
 * would let a term through that the gate rejected.
 */
export function termOfLine(line: string): string | undefined {
  const match = /^- "([^"]+)":/.exec(line);
  return match === null ? undefined : (match[1] as string);
}

/**
 * The gate: every term shown to the model occurs in the question it was shown for.
 *
 * `V64` reads the rendered lines rather than the entries, because the claim is about the prompt:
 * a store that is licensed and a renderer that ignores the licence produce the same store and a
 * different prompt, and only one of them is what the arm measured.
 */
export function licensedLines(lines: readonly string[], question: string): {
  readonly checked: number;
  readonly unlicensed: readonly string[];
} {
  const unlicensed: string[] = [];
  let checked = 0;
  for (const line of lines) {
    const term = termOfLine(line);
    if (term === undefined) continue;
    checked += 1;
    if (!occursIn(term, question)) unlicensed.push(term);
  }
  return { checked, unlicensed };
}

/** What one fold's lexicon arm did, in the four numbers the gate reads. */
export type LexiconRun = {
  /** Active entries the fold's store held after distillation. */
  readonly entries: number;
  /** Lines rendered into held-out prompts, across the fold. */
  readonly lines: number;
  /** Rendered lines whose term this module could read back out of the line. */
  readonly checked: number;
  /** Rendered lines whose term does not occur in the question they were rendered for. */
  readonly unlicensed: number;
  /** Candidates the write-time invariant refused, by reason. */
  readonly refused: Readonly<Record<string, number>>;
};

/**
 * `V64` — the definitional grain is licensed, and the arm is not `none` under a second name.
 *
 * Three ways this arm could publish a clean null without measuring anything, and each is a clause:
 * an empty store (nothing was learned), an arm that rendered no line (the pack was empty, so the
 * cell is `none`), and a renderer that showed a term the question never used (the grain was not
 * applied, whatever the store holds). The fourth clause is the invariant itself.
 *
 * Blocking, for the reason every instrument gate is: a run where a third of the lines spoke about
 * a term the question never used did not measure a definitional grain, and its delta belongs to
 * the rule grain with different words.
 */
export function lexiconGate(run: LexiconRun): {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
} {
  const refused = Object.entries(run.refused)
    .map(([reason, count]) => `${reason}=${String(count)}`)
    .sort()
    .join(', ');
  const pass =
    run.entries > 0 && run.lines > 0 && run.checked === run.lines && run.unlicensed === 0;
  return {
    id: 'V64-lexicon-is-licensed',
    criterion:
      'the store holds at least one entry, the arm rendered at least one line, every rendered line ' +
      'carries a readable term, and every term occurs in the question it was rendered for',
    actual:
      `entries=${String(run.entries)} lines=${String(run.lines)} checked=${String(run.checked)} ` +
      `unlicensed=${String(run.unlicensed)} refused(${refused === '' ? 'none' : refused})`,
    pass,
    blocking: true,
  };
}

