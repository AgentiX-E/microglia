import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmClient } from '../model-client.js';

const noSleep = async (): Promise<void> => undefined;

type Call = { readonly status: number; readonly body?: unknown };

/** A fetch that answers from a script, and records what it was asked. */
function scripted(calls: readonly Call[]): { fetchImpl: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url) + ' ' + String(init?.body ?? ''));
    const call = calls[Math.min(index, calls.length - 1)] as Call;
    index += 1;
    if (call.status === 0) throw new Error('socket hang up');
    return new Response(call.body === undefined ? null : JSON.stringify(call.body), {
      status: call.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const ok = (content: string, tokens = 12): Call => ({
  status: 200,
  body: { choices: [{ message: { content } }], usage: { total_tokens: tokens } },
});

function client(calls: readonly Call[], overrides: Partial<ConstructorParameters<typeof LlmClient>[0]> = {}) {
  const { fetchImpl, seen } = scripted(calls);
  const instance = new LlmClient({
    apiKey: 'k',
    model: 'm',
    maxCalls: 100,
    fetchImpl,
    sleep: noSleep,
    random: () => 0,
    ...overrides,
  });
  return { instance, seen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LlmClient', () => {
  it('uses the process defaults when nothing is injected', async () => {
    // Every production run takes this path: global fetch, the real timer for
    // backoff, `Math.random` for jitter, the default endpoint, the 60 s timeout.
    // Testing only the injected form would leave the shipped configuration
    // uncovered - which is how a default that crashes at runtime stays green.
    vi.useFakeTimers();
    let seen = 0;
    vi.stubGlobal('fetch', async () => {
      seen += 1;
      return seen === 1
        ? new Response(null, { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    const instance = new LlmClient({ apiKey: 'k', model: 'm', maxCalls: 10 });
    const pending = instance.chat('hi');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: 'ok', attempts: 2 });
    expect(instance.stats).toMatchObject({ calls: 2, retries: 1 });
  });

  it('refuses an empty key instead of sending an unauthenticated call', () => {
    expect(() => new LlmClient({ apiKey: '', model: 'm', maxCalls: 1 })).toThrow(/API key is required/);
  });

  it('names no vendor in that message, because the client speaks one shape for all of them', () => {
    // The client is an OpenAI-compatible chat caller with a configurable endpoint. A
    // message naming one provider reads as "the others are unsupported" when the only
    // thing missing was the key.
    let message = '';
    try {
      new LlmClient({ apiKey: '', model: 'm', maxCalls: 1 });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toMatch(/DEEPSEEK|ZHIPU|OPENAI/i);
  });

  it('returns the text, the token count and the attempts it took', async () => {
    const { instance } = client([ok('SELECT 1', 42)]);
    await expect(instance.chat('hi')).resolves.toEqual({ text: 'SELECT 1', tokens: 42, attempts: 1 });
    expect(instance.stats).toEqual({ calls: 1, prompts: 1, failures: 0, retries: 0, tokens: 42 });
  });

  it('treats a missing choice as an empty reply rather than throwing', async () => {
    const { instance } = client([{ status: 200, body: {} }]);
    const reply = await instance.chat('hi');
    expect(reply.text).toBe('');
    expect(reply.tokens).toBe(0);
  });

  it('retries a 429 and a 5xx, and counts both the attempts and the retries', async () => {
    const { instance } = client([{ status: 429 }, { status: 503 }, ok('done')]);
    const reply = await instance.chat('hi');
    expect(reply.text).toBe('done');
    expect(reply.attempts).toBe(3);
    expect(instance.stats).toMatchObject({ calls: 3, prompts: 1, retries: 2, failures: 0 });
  });

  it('retries a network failure', async () => {
    const { instance } = client([{ status: 0 }, ok('done')]);
    await expect(instance.chat('hi')).resolves.toMatchObject({ text: 'done', attempts: 2 });
  });

  it('does not retry a 402: no credit is a configuration failure, not a transient one', async () => {
    const { instance, seen } = client([{ status: 402, body: { error: 'insufficient balance' } }]);
    await expect(instance.chat('hi')).rejects.toThrow(/402/);
    expect(seen).toHaveLength(1);
    expect(instance.stats).toMatchObject({ calls: 1, prompts: 1, failures: 0 });
  });

  it('turns any other refusal into a named store failure carrying the body', async () => {
    const { instance } = client([{ status: 400, body: { error: 'bad prompt' } }]);
    await expect(instance.chat('hi')).rejects.toMatchObject({
      code: 'MG_E_STORE_IO',
      details: { body: expect.stringContaining('bad prompt') },
    });
  });

  it('gives up after four attempts and reports the call as a failed prompt', async () => {
    const { instance } = client([{ status: 500 }]);
    await expect(instance.chat('hi')).rejects.toThrow(/failed after retries/);
    expect(instance.stats).toMatchObject({ calls: 4, prompts: 1, failures: 1, retries: 3 });
  });

  it('trips the breaker after several prompts fail in a row', async () => {
    const { instance } = client([{ status: 500 }], { breakerThreshold: 2 });
    await expect(instance.chat('a')).rejects.toThrow(/failed after retries/);
    await expect(instance.chat('b')).rejects.toThrow(/MG_E_PROVIDER_FAILED|not answering/);
    expect(instance.stats).toMatchObject({ prompts: 2, failures: 2, calls: 8 });
  });

  it('resets the breaker on a success, so intermittent failures never trip it', async () => {
    const { instance } = client(
      [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, ok('fine'), { status: 500 }],
      { breakerThreshold: 2 },
    );
    await expect(instance.chat('a')).rejects.toThrow(/failed after retries/);
    await expect(instance.chat('b')).resolves.toMatchObject({ text: 'fine' });
    await expect(instance.chat('c')).rejects.toThrow(/failed after retries/);
  });

  it('refuses to spend a call past the budget', async () => {
    const { instance, seen } = client([ok('one'), ok('two')], { maxCalls: 1 });
    await expect(instance.chat('a')).resolves.toMatchObject({ text: 'one' });
    await expect(instance.chat('b')).rejects.toMatchObject({ code: 'MG_E_BUDGET_EXCEEDED' });
    expect(seen).toHaveLength(1);
  });

  it('spends the budget on attempts, not on prompts', async () => {
    const { instance } = client([{ status: 503 }, ok('done')], { maxCalls: 2 });
    await expect(instance.chat('a')).resolves.toMatchObject({ attempts: 2 });
    await expect(instance.chat('b')).rejects.toMatchObject({ code: 'MG_E_BUDGET_EXCEEDED' });
  });

  it('sends the model, the prompt, temperature 0 and the token cap', async () => {
    const { instance, seen } = client([ok('x')]);
    await instance.chat('PROMPT TEXT', 1234);
    const body = JSON.parse(seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as {
      model?: string;
      messages?: { content?: string }[];
      temperature?: number;
      max_tokens?: number;
    };
    expect(body).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'PROMPT TEXT' }],
      temperature: 0,
      max_tokens: 1234,
    });
  });
});
