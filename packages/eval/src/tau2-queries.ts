/**
 * R92 — the second draw, and the one the store pin could not reach.
 *
 * R91 pinned the store to the failures R90 read, and the store replayed exactly: fifteen statements,
 * character for character, 172 entity values, one redacted, `pass^4` identical to the digit. The pack did
 * not replay. `meanChars` came back 1,812.1 against R90's 1,825.3 and coverage p50 0.2857 against 0.28,
 * and the registration had promised both as equalities — so its refutation fired on a real defect while
 * naming the wrong mechanism: not a renderer reading a clock, but a *query* nobody had recorded.
 *
 * `buildPack` ranks candidates on BM25 over the query text, and in this lane the query is the user
 * simulator's first turn — `microglia_agent.py` recalls on `message.content` — which τ² samples from
 * `user_scenario.instructions` with a language model. The pack is therefore a function of (store, query,
 * pack options); the store is pinned, and the query was the remaining free variable. Three arms prove it
 * without another episode: R89 1,717.2, R90 1,825.3, R91 1,812.1 mean characters, over stores holding 12,
 * 15 and 15 corrections.
 *
 * ## Keyed by episode position, because nothing upstream names the episode
 *
 * The obvious key is the task id, and the facade cannot have it. `microglia_agent.py` sends
 * `task=tau2.act` — the *memory scope* — on every request, `generate_next_message` receives no task, and
 * the driver's `TASK` is a constant shared by all 228 episodes. Inferring the task from the plan order
 * would be an assumption dressed as data: τ² iterates its own way over `--task-ids`, and a trial-major
 * loop would silently relabel every question in the artefact.
 *
 * So an entry is the episode's **position in the phase**: request 0 is the first episode the agent ran,
 * request 227 the last. That is exactly as stable as τ²'s iteration order is, which is the same thing the
 * lane's per-task counts already rest on, and it is self-checking — a pin replaying into a phase that
 * iterates differently produces a different digest, and the readback compares digests.
 *
 * ## What this module does, and what it deliberately does not
 *
 * It *records* every query, because an artefact that cannot say what was asked cannot explain a pack. It
 * also carries the machinery to *pin* them, because a pack experiment — one store read at two floors, two
 * diversities, two budgets — prices its options only if the question is held fixed.
 *
 * It does not pin by default, and no arm reporting an absolute benchmark number should. A query that
 * varies is what deployment looks like: users phrase one intent differently, and a lane pinned to one
 * phrasing measures retrieval against a sentence no user typed. The distinction is the store pin's, one
 * level down — pin the population, not the stimulus — except that here the stimulus is the treatment.
 *
 * ## The digest
 *
 * `digest` hashes the (position, text) mapping and not the arrival order of the list it was built from, so
 * two arms that asked the same 228 questions compare equal by construction. `askedDigest` is the same hash
 * over what the agent sent rather than what retrieval used, and `replaced` counts the requests where the
 * two differ — which is how an arm proves its pin took effect instead of asserting it. That assertion is
 * precisely what R91's artefact could not support: it carried no field saying whether its store had been
 * replayed, and the readback had to grade its central claim by inference.
 */
import { hashText } from '@agentix-e/microglia-core';
import { L4ParseError } from './l4.js';

/** One recall request: what the agent asked, and what retrieval was given. */
export type RecallInput = {
  /** The episode's position in the phase: 0-based, one query per episode. */
  readonly index: number;
  /** The text the agent sent, verbatim. */
  readonly asked: string;
  /** The text retrieval used. Equal to `asked` unless a pin replaced it. */
  readonly used: string;
};

/** What the queries were, in a form a readback can compare between arms without the texts. */
export type QueryCensus = {
  readonly requests: number;
  /** Distinct texts retrieval was given. A pinned run with four phrasings an episode has 228. */
  readonly distinct: number;
  /** Mean characters of the used text; `null` over no request, because `0` reads as a measurement. */
  readonly meanChars: number | null;
  /** Lower median of the same lengths; `null` over no request. */
  readonly p50Chars: number | null;
  /** Hash of the (position, used) mapping, which is what two arms compare. */
  readonly digest: string;
  /** The same hash over what was asked, so a pinned arm can show its pin moved something. */
  readonly askedDigest: string;
  /** Requests whose used text differs from the asked text. Zero on an unpinned arm. */
  readonly replaced: number;
  /** The pin file this arm replayed, or `null` when the queries were the ones the simulator drew. */
  readonly pin: string | null;
  /** The record itself, ordered by position — the only thing a later pin can be derived from. */
  readonly texts: readonly { readonly index: number; readonly text: string }[];
};

/** A pin: one text per episode, in the order the phase ran them. */
export type QueryPin = {
  readonly source: string;
  readonly texts: readonly string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // The lower median, so an even count has an answer rather than the average of two: the mean of two
  // integer lengths is a number no query has, and a census that reported it would be quotable as if it
  // were one of the questions.
  // Cast rather than `?? null`: the index is inside the array by construction, and a fallback that no
  // input reaches is a branch that exists only to be uncovered.
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

function digestOf(entries: readonly { index: number; text: string }[]): string {
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  return hashText(sorted.map((entry) => `${String(entry.index)}\u0000${entry.text}`).join('\u0001'));
}

/**
 * What the queries were.
 *
 * The texts travel with the counts. R90's store pin was derivable only because that arm's artefact carried
 * `storeItems`; a census of lengths and a digest would have made the same pin impossible.
 */
export function queryCensusOf(
  inputs: readonly RecallInput[],
  options: { readonly pin?: string } = {},
): QueryCensus {
  const used = inputs.map((entry) => ({ index: entry.index, text: entry.used }));
  const asked = inputs.map((entry) => ({ index: entry.index, text: entry.asked }));
  const lengths = inputs.map((entry) => entry.used.length);
  return {
    requests: inputs.length,
    distinct: new Set(used.map((entry) => entry.text)).size,
    meanChars:
      lengths.length === 0 ? null : lengths.reduce((sum, value) => sum + value, 0) / lengths.length,
    p50Chars: median(lengths),
    digest: digestOf(used),
    askedDigest: digestOf(asked),
    replaced: inputs.filter((entry) => entry.used !== entry.asked).length,
    pin: options.pin ?? null,
    texts: [...used].sort((a, b) => a.index - b.index),
  };
}

/**
 * Read a query pin.
 *
 * `{"source": "...", "queries": ["...", "...", ...]}`. Every refusal here is a pin that would have covered
 * *less* than the run asks while the artefact still read as pinned: an empty list, a text that is not a
 * string, a list holding a list (`[[...]]` is what a hand edit that keeps its brackets looks like).
 */
export function parseQueryPin(document: unknown): QueryPin {
  const record = asRecord(document);
  if (record === undefined) {
    throw new L4ParseError('unreadable-json', 'a query pin is not an object');
  }
  const raw = record['queries'];
  if (!Array.isArray(raw)) {
    throw new L4ParseError('missing-tasks', 'a query pin has no `queries` array');
  }
  if (raw.length === 0) {
    throw new L4ParseError('bad-entry', 'a query pin names no episode: it covers nothing');
  }
  const texts: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new L4ParseError('bad-entry', 'a query pin holds an entry that is not a question');
    }
    texts.push(entry);
  }
  const source =
    typeof record['source'] === 'string' && record['source'].length > 0
      ? record['source']
      : 'an arm this pin does not name';
  return { source, texts };
}

/**
 * The text retrieval uses for one episode.
 *
 * Refusals rather than fallbacks. An episode past the end of the list would otherwise fall back to the
 * sampled text, and a run pinned on 200 of 228 requests would report itself as pinned — the same defect as
 * a store pin whose ids silently miss, one layer over.
 */
export function pinnedQueryText(pin: QueryPin, index: number): string {
  const text = pin.texts[index];
  if (text === undefined) {
    throw new L4ParseError(
      'short-grid',
      `the query pin holds ${String(pin.texts.length)} text(s) and episode ${String(index)} was asked`,
    );
  }
  return text;
}

/**
 * Check a pin against the run before it spends an episode.
 *
 * The driver knows its tasks and its trial count before the first model call, so a pin that cannot cover
 * the phase is a refusal at that moment rather than an exception inside an episode already paid for. A pin
 * *longer* than the run is accepted: it was drawn from a phase with more episodes, and every episode this
 * run asks still has a text.
 */
export function assertQueryPinCovers(pin: QueryPin, episodes: number): void {
  if (pin.texts.length < episodes) {
    throw new L4ParseError(
      'short-grid',
      `the query pin holds ${String(pin.texts.length)} text(s) and this phase runs ${String(episodes)} episode(s)`,
    );
  }
}
