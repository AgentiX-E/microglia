/**
 * The browser client.
 *
 * It knows two endpoints and one rule: feedback is queued before it is sent, so a
 * tab that closes mid-correction does not lose the correction. Recall is not
 * queued — a stale answer is worse than no knowledge.
 */
import { hashText } from '@agentix-e/microglia-core';
import type { KnowledgePack, RecallQuery } from '@agentix-e/microglia-core';
import { memoryOutbox, type FeedbackPayload, type Outbox } from './outbox.js';

export type ClientOptions = {
  /** Base URL of a `@agentix-e/microglia-node` deployment, e.g. `https://api.example.com`. */
  readonly endpoint: string;
  readonly token?: string;
  /** Injected for tests and for hosts that wrap `fetch` (retries, tracing). */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly outbox?: Outbox;
};

export type RecallResult = Pick<KnowledgePack, 'ids' | 'rendered' | 'tokens' | 'hash'>;

export type SendResult = {
  readonly sent: number;
  readonly failed: number;
  readonly queued: number;
};

let counter = 0;

export class MicrogliaClient {
  private readonly base: string;
  private readonly call: typeof fetch;
  private readonly outbox: Outbox;

  public constructor(private readonly options: ClientOptions) {
    this.base = options.endpoint.replace(/\/+$/, '');
    this.call = options.fetch ?? fetch;
    this.outbox = options.outbox ?? memoryOutbox();
  }

  /** Ask the workspace what it has learned about this kind of question. */
  public async recall(query: Omit<RecallQuery, 'namespace'>): Promise<RecallResult> {
    const params = new URLSearchParams({ task: query.task, text: query.text });
    if (query.scope?.domain !== undefined) params.set('domain', query.scope.domain);
    if (query.scope?.intent !== undefined) params.set('intent', query.scope.intent);
    if (query.scope?.field !== undefined) params.set('field', query.scope.field);
    if (query.budget !== undefined) params.set('budget', String(query.budget));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.minCoverage !== undefined) params.set('minCoverage', String(query.minCoverage));

    const response = await this.request(`/v1/recall?${params.toString()}`, { method: 'GET' });
    return (await response.json()) as RecallResult;
  }

  public async health(): Promise<{ ok: boolean; stats: Record<string, number> }> {
    const response = await this.request('/v1/health', { method: 'GET' });
    return (await response.json()) as { ok: boolean; stats: Record<string, number> };
  }

  /**
   * Record a correction. Queued first, sent immediately when the network allows.
   *
   * The key is derived from the payload and a counter rather than a timestamp, so
   * two identical corrections in one session are still two events while a retry of
   * the same one is one.
   */
  public async feedback(payload: FeedbackPayload): Promise<{ queued: boolean; key: string }> {
    counter += 1;
    const key = `mg-${hashText(JSON.stringify(payload)).slice(0, 12)}-${counter}`;
    this.outbox.push({ key, payload, attempts: 0 });
    const result = await this.flush();
    return { queued: result.queued > 0, key };
  }

  /** Drain the outbox. Returns counts rather than throwing on the first failure. */
  public async flush(): Promise<SendResult> {
    let sent = 0;
    let failed = 0;
    for (const entry of this.outbox.list()) {
      try {
        await this.request('/v1/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': entry.key },
          body: JSON.stringify(entry.payload),
        });
        this.outbox.remove(entry.key);
        sent += 1;
      } catch {
        this.outbox.update(entry.key, entry.attempts + 1);
        failed += 1;
      }
    }
    return { sent, failed, queued: this.outbox.list().length };
  }

  public pending(): number {
    return this.outbox.list().length;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const attempts = this.options.attempts ?? 3;
    const baseDelay = this.options.baseDelayMs ?? 250;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** (attempt - 1)));
      }
      try {
        const response = await this.call(`${this.base}${path}`, {
          ...init,
          headers: {
            ...(this.options.token === undefined ? {} : { authorization: `Bearer ${this.options.token}` }),
            ...(init.headers ?? {}),
          },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`upstream ${response.status}`);
          continue;
        }
        if (!response.ok) {
          const body = (await response.text()).slice(0, 200);
          throw new Error(`${response.status}: ${body}`);
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function createClient(options: ClientOptions): MicrogliaClient {
  return new MicrogliaClient(options);
}
