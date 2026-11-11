/**
 * Whether the host a dispatch named really serves the model it named.
 *
 * Two values decide where a run's tokens are bought — the model and the host — and until now neither
 * was ever checked against the only authority that knows: the provider's own catalogue. A dispatch
 * naming a model the host does not serve does not fail at the door. It fails as a `4xx` per prompt,
 * which `verdictOf` classifies as a refusal, which trips the eight-prompt breaker, which ends the run
 * as "the endpoint stopped answering" — twenty minutes and about a dollar later. `planCredential`
 * closed the credential half of that shape, for the same reason and with the same argument; this
 * closes the model half.
 *
 * **The verdict has three values and the third one is the load-bearing one.** `listed` and `absent`
 * are answers. `unlistable` is the absence of an answer: a host that publishes no catalogue, an
 * endpoint that is not OpenAI-shaped, a network that did not resolve. That third value must never
 * veto a run — a check that cannot run is a check that knows nothing, and a gate that refuses on
 * "I could not tell" is a gate that breaks the first host whose catalogue lives at another path. Only
 * `absent` refuses, and it refuses in ten seconds with the served list printed.
 *
 * The catalogue is also worth keeping after the run: a number produced by a model that the host
 * listed at dispatch time is a different claim from a number produced by a model id nobody ever
 * confirmed, and the artefact is the only place that difference can survive.
 */
import { readFileSync } from 'node:fs';

import { DEFAULT_CHAT_ENDPOINT, restModelOf } from './model-client.js';

/**
 * What a catalogue says about a model — or that it said nothing.
 *
 * `unlistable` carries a reason rather than a boolean, because "the host has no catalogue" and "the
 * key was refused" are the same verdict here and would be the same silence in a log.
 */
export type CatalogueVerdict = 'listed' | 'absent' | 'unlistable';

export type CatalogueReading = {
  /** The id the lane would actually send, after the provider alias is dropped. */
  readonly model: string;
  /** The id as configured, kept so a reader can see the alias was understood rather than ignored. */
  readonly configured: string;
  readonly verdict: CatalogueVerdict;
  /** The catalogue URL that was asked, or `''` when the endpoint has no derivable sibling. */
  readonly url: string;
  /** The ids the host listed, sorted. Empty when `unlistable`. */
  readonly models: readonly string[];
  /** One sentence a step's log can print, and the artefact can carry. */
  readonly why: string;
};

/** What the artefact records about the probe, which is less than the probe itself. */
export type CatalogueNote = {
  readonly verdict: CatalogueVerdict | 'unprobed';
  readonly model: string;
  readonly listed: number;
  readonly why: string;
};

const CHAT_PATH = '/chat/completions';

/**
 * The catalogue URL that belongs to a chat endpoint, or `undefined` when there is no such sibling.
 *
 * Derived rather than configured, because a second variable is a second thing to leave unset — and
 * refused rather than guessed when the path is not `/chat/completions`: inventing `../models` for an
 * arbitrary endpoint would produce an `absent` verdict about an address nobody serves, which is the
 * one failure mode this file exists to avoid.
 */
export function modelsUrlOf(endpoint: string): string | undefined {
  const target = endpoint.trim() === '' ? DEFAULT_CHAT_ENDPOINT : endpoint.trim();
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith(CHAT_PATH)) return undefined;
  url.pathname = `${path.slice(0, -CHAT_PATH.length)}/models`;
  // A query string on a chat endpoint is a token or a version pin; neither belongs to the catalogue.
  url.search = '';
  return url.toString();
}

/**
 * The ids in an OpenAI-shaped catalogue payload, or `undefined` when the payload is not one.
 *
 * Two shapes are accepted because the second one is what a host returns when it answers `{"data": []}`
 * or nests the list under an envelope. Anything else is `undefined` rather than `[]`: an empty list
 * read from a payload that never had one would turn a broken parser into a confident `absent`.
 */
export function catalogueIdsOf(payload: unknown): readonly string[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const data = (payload as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      ids.push(entry);
      continue;
    }
    if (typeof entry !== 'object' || entry === null) return undefined;
    const id = (entry as { readonly id?: unknown }).id;
    if (typeof id !== 'string' || id.trim() === '') return undefined;
    ids.push(id.trim());
  }
  return [...new Set(ids)].sort();
}

/** Whether a sorted catalogue contains the id the lane would send. */
export function catalogueVerdictOf(model: string, ids: readonly string[]): CatalogueVerdict {
  return ids.includes(restModelOf(model).sent) ? 'listed' : 'absent';
}

export type ProbeInput = {
  /** The configured endpoint, or `''` for the lane's default host. */
  readonly endpoint: string;
  /** The configured model id, which may carry a `provider/` alias. */
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** Injected in tests; the default is the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
};

/**
 * Ask the host what it serves, and read the answer as a verdict rather than as an exception.
 *
 * Every failure mode is a verdict, because the caller's decision is the same for all of them except
 * `absent`: continue, and record that the catalogue could not be read. Throwing would put the
 * distinction between "this host lists nothing" and "this host does not answer" into a stack trace.
 */
export async function probeBackbone(input: ProbeInput): Promise<CatalogueReading> {
  const configured = input.model.trim();
  const sent = restModelOf(configured).sent;
  const url = modelsUrlOf(input.endpoint);
  const base = { model: sent, configured, url: url ?? '', models: [] as readonly string[] };

  if (url === undefined) {
    return {
      ...base,
      verdict: 'unlistable',
      why: 'the endpoint is not an OpenAI-shaped chat endpoint, so its catalogue has no derivable address',
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${input.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    return { ...base, verdict: 'unlistable', why: `the catalogue did not answer (${name})` };
  }

  if (!response.ok) {
    /* `404` is the ordinary case and not a defect: a host is free to serve chat completions and no
     * catalogue at all. `401` is the interesting one — it is a refused key reported ten seconds after
     * the dispatch instead of at the four-hundredth call — but it is still not `absent`, because this
     * file cannot tell a refused key from a host that authenticates nothing on `/models`. */
    return {
      ...base,
      verdict: 'unlistable',
      why: `the catalogue answered HTTP ${String(response.status)}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ...base, verdict: 'unlistable', why: 'the catalogue answered with something that is not JSON' };
  }
  const ids = catalogueIdsOf(payload);
  if (ids === undefined) {
    return {
      ...base,
      verdict: 'unlistable',
      why: 'the catalogue answered JSON without a list of model ids',
    };
  }
  const verdict = catalogueVerdictOf(sent, ids);
  return {
    model: sent,
    configured,
    verdict,
    url,
    models: ids,
    why:
      verdict === 'listed'
        ? `the host lists ${sent} among ${String(ids.length)} model(s)`
        : `the host lists ${String(ids.length)} model(s) and not ${sent}`,
  };
}

/** One line for a step's log: the verdict, the model, and what was served when it was not the model. */
export function catalogueLine(reading: CatalogueReading, served = 12): string {
  const shown = reading.models.slice(0, served).join(', ');
  const more =
    reading.models.length > served ? ` … and ${String(reading.models.length - served)} more` : '';
  const tail = reading.models.length === 0 ? '' : ` served: ${shown}${more}`;
  return `[backbone] ${reading.verdict} — ${reading.why}${tail}`;
}

/**
 * The note the artefact carries, read back from the probe's own file.
 *
 * `unprobed` is a real value and not an error: every artefact committed before this existed, and
 * every rehearsal that runs the lane directly, was produced without a probe. Recording it as
 * `unprobed` keeps the difference between "the host listed this model" and "nobody asked" visible,
 * which a default of `listed` would erase.
 */
export function catalogueNoteOf(file: string | null): CatalogueNote {
  if (file === null || file.trim() === '') {
    return { verdict: 'unprobed', model: '', listed: 0, why: 'no catalogue probe ran for this dispatch' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {
      verdict: 'unprobed',
      model: '',
      listed: 0,
      why: `the catalogue probe's file at ${file} could not be read`,
    };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { verdict: 'unprobed', model: '', listed: 0, why: `the catalogue probe's file at ${file} is not an object` };
  }
  const record = payload as Record<string, unknown>;
  const verdict = record['verdict'];
  const models = record['models'];
  if (verdict !== 'listed' && verdict !== 'absent' && verdict !== 'unlistable') {
    return { verdict: 'unprobed', model: '', listed: 0, why: `the catalogue probe's file at ${file} names no verdict` };
  }
  return {
    verdict,
    model: typeof record['model'] === 'string' ? record['model'] : '',
    listed: Array.isArray(models) ? models.length : 0,
    why: typeof record['why'] === 'string' ? record['why'] : '',
  };
}
