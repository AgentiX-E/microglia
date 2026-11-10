import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmClient, attemptTimeoutMs, restModelOf, retryAfterMs } from '../model-client.js';

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
    // Fixed, because the band a call is billed in is read from the clock: a suite without this
    // asserts a different bill before and after 10:00 UTC, which is the defect under test arriving
    // through the test suite instead of the lane. Monday noon UTC is off-peak.
    now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0)),
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
    await expect(instance.chat('hi')).resolves.toEqual({
      text: 'SELECT 1',
      tokens: 42,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      attempts: 1,
    });
    expect(instance.stats).toEqual({
      calls: 1,
      prompts: 1,
      failures: 0,
      retries: 0,
      timeouts: 0,
      tokens: 42,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('keeps the prompt, the cache split and the completion apart, because they bill differently', async () => {
    // The lane read `total_tokens` alone until now, and a cached prompt token is fifty times cheaper
    // than a miss: this is the split without which no bill in this repository could be explained.
    const { instance } = client([
      {
        status: 200,
        body: {
          choices: [{ message: { content: 'SELECT 2' } }],
          usage: {
            total_tokens: 1_300,
            prompt_tokens: 1_000,
            completion_tokens: 300,
            prompt_cache_hit_tokens: 800,
            prompt_cache_miss_tokens: 200,
          },
        },
      },
    ]);
    const reply = await instance.chat('hi');
    expect(reply.promptTokens).toBe(1_000);
    expect(reply.cachedTokens).toBe(800);
    expect(reply.completionTokens).toBe(300);
    expect(instance.usage.off_peak).toEqual({ promptTokens: 1_000, cachedTokens: 800, completionTokens: 300 });
    expect(instance.usage.peak).toEqual({ promptTokens: 0, cachedTokens: 0, completionTokens: 0 });
  });

  it('books a call answered inside a peak window at the peak rate, which is a different bill', async () => {
    // The same tokens, twelve hours apart. A lane that books its whole run at the band in force
    // when it finished cannot tell these apart, and that is the number the clock would then choose.
    const body = (text: string): Call => ({
      status: 200,
      body: {
        choices: [{ message: { content: text } }],
        usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 },
      },
    });
    const peak = client([body('a')], { now: () => new Date(Date.UTC(2026, 10, 9, 2, 0, 0)) });
    await peak.instance.chat('hi');
    expect(peak.instance.usage.peak).toEqual({ promptTokens: 20, cachedTokens: 0, completionTokens: 10 });
    expect(peak.instance.usage.off_peak).toEqual({ promptTokens: 0, cachedTokens: 0, completionTokens: 0 });
  });

  it('splits a run that crosses a window boundary across both bands', async () => {
    // 03:59 UTC is peak, 04:01 is not. One run, two rates, and the bill is exact only because the
    // clock is read per reply rather than once at the end.
    const body = (text: string): Call => ({
      status: 200,
      body: {
        choices: [{ message: { content: text } }],
        usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 },
      },
    });
    let minute = 59;
    const hour = 3;
    const straddling = client([body('a'), body('b')], {
      now: () => {
        const moment = new Date(Date.UTC(2026, 10, 9, hour, minute, 0));
        minute += 2;
        return moment;
      },
    });
    await straddling.instance.chat('one');
    await straddling.instance.chat('two');
    expect(straddling.instance.usage.peak.completionTokens).toBe(10);
    expect(straddling.instance.usage.off_peak.completionTokens).toBe(10);
  });

  it('records reasoning tokens when the provider attributes any', async () => {
    // Billed as output, indistinguishable from an answer token in every other field. The number is
    // the only evidence a lane is paying for thinking, so it is kept even though nothing acts on it.
    const { instance } = client([
      {
        status: 200,
        body: {
          choices: [{ message: { content: 'ok' } }],
          usage: { total_tokens: 10, prompt_tokens: 4, completion_tokens: 6, completion_tokens_details: { reasoning_tokens: 5 } },
        },
      },
    ]);
    const reply = await instance.chat('hi');
    expect(reply.reasoningTokens).toBe(5);
    expect(instance.stats.reasoningTokens).toBe(5);
  });

  it('leaves reasoning tokens absent when the provider says nothing, which is not zero', async () => {
    const { instance } = client([ok('x')]);
    const reply = await instance.chat('hi');
    expect(reply.reasoningTokens).toBeUndefined();
    expect(instance.stats.reasoningTokens).toBe(0);
  });

  it('clamps a cache-hit count larger than the prompt it belongs to', async () => {
    const { instance } = client([
      {
        status: 200,
        body: {
          choices: [{ message: { content: 'x' } }],
          usage: { total_tokens: 10, prompt_tokens: 4, completion_tokens: 6, prompt_cache_hit_tokens: 99 },
        },
      },
    ]);
    const reply = await instance.chat('hi');
    expect(reply.cachedTokens).toBe(4);
  });

  it('sums the bill across prompts, which is what the usage line reads', async () => {
    const { instance } = client([
      {
        status: 200,
        body: {
          choices: [{ message: { content: 'a' } }],
          usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 },
        },
      },
      {
        status: 200,
        body: {
          choices: [{ message: { content: 'b' } }],
          usage: { total_tokens: 60, prompt_tokens: 40, completion_tokens: 20, prompt_cache_hit_tokens: 15 },
        },
      },
    ]);
    await instance.chat('one');
    await instance.chat('two');
    expect(instance.stats.promptTokens).toBe(60);
    expect(instance.stats.cachedTokens).toBe(20);
    expect(instance.stats.completionTokens).toBe(30);
  });

  it('sends no thinking field unless it was told which way to ask', async () => {
    const { instance, seen } = client([ok('x')]);
    await instance.chat('hi');
    const body = JSON.parse(seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as { thinking?: unknown };
    expect(body.thinking).toBeUndefined();
  });

  it('sends the disable switch when the run asked for the cheap path, and the enable switch for its control', async () => {
    const off = client([ok('x')], { thinking: 'off' });
    await off.instance.chat('hi');
    const offBody = JSON.parse(off.seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as { thinking?: unknown };
    expect(offBody.thinking).toEqual({ type: 'disabled' });

    const on = client([ok('x')], { thinking: 'on' });
    await on.instance.chat('hi');
    const onBody = JSON.parse(on.seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as { thinking?: unknown };
    expect(onBody.thinking).toEqual({ type: 'enabled' });
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
    // The prompt was sent and refused, so it is a failed prompt; what a 402 does not get is a retry.
    // Counting it as zero failures is how a run with no credit reports perfect reliability.
    expect(instance.stats).toMatchObject({ calls: 1, prompts: 1, failures: 1 });
  });

  it('treats a request the provider will refuse again as a configuration failure, not a lost prompt', async () => {
    // A `400` is a property of what was sent: the same request fails identically next time. Reporting
    // it as one lost prompt is what let thirty-two refusals arrive at the distiller as thirty-two
    // corrections the model had nothing to say about, and a whole arm evaluate an empty store.
    const { instance } = client([{ status: 400, body: { error: 'model not found' } }]);
    await expect(instance.chat('hi')).rejects.toMatchObject({
      code: 'MG_E_CONFIG',
      details: { body: expect.stringContaining('model not found'), model: 'm' },
    });
  });

  it('keeps the four 4xx codes that ask for the same request again on the transient path', async () => {
    for (const status of [408, 409, 425]) {
      const { instance } = client([{ status }]);
      await expect(instance.chat('hi')).rejects.toMatchObject({
        code: 'MG_E_STORE_IO',
        details: { last: `status ${status}` },
      });
      expect(instance.stats).toMatchObject({ calls: 4, prompts: 1, failures: 1 });
    }
  });

  it('counts a refusal that is not retried as a failed prompt', async () => {
    // A provider that rejects the request outright is the case that produced an empty store on a
    // dispatch nobody could explain: 32 distillation prompts, 400 each, `failures: 0`. The prompt
    // left, and it did not come back with a reply, which is what the count means.
    const { instance } = client([{ status: 400, body: { error: 'model not found' } }]);
    await expect(instance.chat('hi')).rejects.toThrow(/400/);
    expect(instance.stats).toMatchObject({ calls: 1, prompts: 1, failures: 1, retries: 0 });
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

  it('sends the temperature it was given, for the sampling arms', async () => {
    // A single draw cannot be compared with itself, so the arms that draw several times need a
    // non-zero temperature to have anything to select between. The default stays 0 so that every
    // published number keeps the baseline it was measured against.
    const { instance, seen } = client([ok('x')]);
    await instance.chat('PROMPT TEXT', 700, 0.7);
    const body = JSON.parse(seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as {
      temperature?: number;
    };
    expect(body.temperature).toBe(0.7);
  });

  it('sends the model the endpoint serves, not the router name it was configured with', async () => {
    // The τ² lane names its model the way litellm does — `deepseek/deepseek-chat` — because the
    // Python side of that lane is a litellm caller. This client posts to
    // `api.deepseek.com/chat/completions`, which serves `deepseek-chat` and rejects the prefixed
    // form with a 400. One variable, two naming conventions, and the run that discovered it did so
    // by storing nothing.
    const { instance, seen } = client([ok('x')], { model: 'deepseek/deepseek-chat' });
    await instance.chat('PROMPT');
    const body = JSON.parse(seen[0]?.split(' ').slice(1).join(' ') ?? '{}') as { model?: string };
    expect(body.model).toBe('deepseek-chat');
    expect(instance.model).toBe('deepseek-chat');
    expect(instance.configuredModel).toBe('deepseek/deepseek-chat');
  });
});

describe('restModelOf', () => {
  it('drops the provider alias litellm puts in front of the id', () => {
    expect(restModelOf('deepseek/deepseek-chat')).toEqual({
      sent: 'deepseek-chat',
      stripped: 'deepseek',
    });
    expect(restModelOf('DeepSeek/deepseek-reasoner').sent).toBe('deepseek-reasoner');
  });

  it('leaves a bare id alone, which is what every artefact before this one used', () => {
    expect(restModelOf('deepseek-chat')).toEqual({ sent: 'deepseek-chat' });
    expect(restModelOf('  m  ')).toEqual({ sent: 'm' });
  });

  it('leaves another vendor\u2019s prefix alone, rather than mangling a name it does not know', () => {
    // `openai/gpt-4o` is not this endpoint's shorthand for anything: stripping it would send `gpt-4o`
    // to a DeepSeek endpoint and report a model-not-found for a configuration that named another
    // provider on purpose. The request fails, and it fails saying what it was asked for.
    expect(restModelOf('openai/gpt-4o')).toEqual({ sent: 'openai/gpt-4o' });
    expect(restModelOf('deepseek-ai/DeepSeek-V3').sent).toBe('deepseek-ai/DeepSeek-V3');
  });

  it('refuses an empty id instead of posting one', async () => {
    expect(() => restModelOf('   ')).toThrow(/model/);
    expect(() => new LlmClient({ apiKey: 'k', model: '', maxCalls: 1 })).toThrow(/model/);
  });

  it('keeps an id it cannot translate instead of inventing one', () => {
    // `deepseek/` with nothing behind it is not this endpoint's spelling of any model. Strip the
    // alias and the request would be sent with an empty `model`, which is a body the endpoint would
    // refuse for a reason that has nothing to do with what the run configured; keeping the raw text
    // lets the endpoint answer, and its answer names the id it was asked for.
    expect(restModelOf('deepseek/')).toEqual({ sent: 'deepseek/' });
    expect(restModelOf('deepseek/   ')).toEqual({ sent: 'deepseek/' });
    // A leading slash has no alias in front of it, so there is nothing to strip.
    expect(restModelOf('/deepseek-chat')).toEqual({ sent: '/deepseek-chat' });
  });
});

describe('attemptTimeoutMs', () => {
  it('grows with the allowance, because a 2,000-token reply is more than a minute of generation', () => {
    // The number this replaced was a constant 60s for every request, and the dev split spent two
    // dispatches discovering it: distillation asks for 2,000 tokens, the client killed the reply at
    // 60 seconds, four times, and the fold's learning half took 43 minutes where its evaluation half
    // took two.
    expect(attemptTimeoutMs(200)).toBe(53_000);
    expect(attemptTimeoutMs(700)).toBe(123_000);
    expect(attemptTimeoutMs(2_000)).toBe(300_000);
  });

  it('caps, so one wedged request cannot consume the run', () => {
    expect(attemptTimeoutMs(100_000)).toBe(300_000);
  });

  it('treats a negative allowance as nothing to wait for', () => {
    expect(attemptTimeoutMs(-5)).toBe(25_000);
  });

  it('is what the request actually uses, not a default beside it', async () => {
    // The signal is constructed per call. A test that only checked the formula would stay green if
    // the client kept passing a constant.
    const signals: AbortSignal[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal !== undefined && init.signal !== null) signals.push(init.signal);
      return new Response(JSON.stringify(ok('x').body), { status: 200 });
    }) as unknown as typeof fetch;
    const instance = new LlmClient({ apiKey: 'k', model: 'm', maxCalls: 10, fetchImpl, sleep: noSleep });
    await instance.chat('p', 2_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('reads the seconds a provider sends', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(' 0 ')).toBe(0);
  });

  it('ignores a header that is not a number, rather than waiting NaN milliseconds', () => {
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs('')).toBeUndefined();
    expect(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(retryAfterMs('-1')).toBeUndefined();
  });

  it('caps the wait, because a provider asking for minutes is telling us the run is over', () => {
    expect(retryAfterMs('600')).toBe(60_000);
  });
});

describe('a timeout is a different bet from a 429', () => {
  it('abandons a timed-out attempt after two tries instead of four', async () => {
    // Retrying a request the client itself killed doubles the wall clock and buys no evidence: the
    // same prompt gets the same slowness. Four attempts is right for "not now" and wrong for
    // "too slow".
    const timeout = Object.assign(new Error('the operation timed out'), { name: 'TimeoutError' });
    let attempts = 0;
    const instance = new LlmClient({
      apiKey: 'k',
      model: 'm',
      maxCalls: 100,
      sleep: noSleep,
      random: () => 0,
      fetchImpl: (async () => {
        attempts += 1;
        throw timeout;
      }) as unknown as typeof fetch,
    });
    await expect(instance.chat('p')).rejects.toMatchObject({ code: 'MG_E_STORE_IO' });
    expect(attempts).toBe(2);
    expect(instance.stats.timeouts).toBe(2);
    expect(instance.stats.retries).toBe(1);
  });

  it('waits what the provider asked for before retrying a 429', async () => {
    const waits: number[] = [];
    let index = 0;
    const instance = new LlmClient({
      apiKey: 'k',
      model: 'm',
      maxCalls: 100,
      random: () => 0,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      fetchImpl: (async () => {
        index += 1;
        return index === 1
          ? new Response(null, { status: 429, headers: { 'retry-after': '3' } })
          : new Response(JSON.stringify(ok('x').body), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await instance.chat('p');
    expect(waits).toEqual([3000]);
    expect(instance.stats.retries).toBe(1);
    expect(instance.stats.timeouts).toBe(0);
  });

  it('still gives up after four attempts when the provider keeps refusing', async () => {
    const instance = new LlmClient({
      apiKey: 'k',
      model: 'm',
      maxCalls: 100,
      sleep: noSleep,
      random: () => 0,
      fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
    });
    await expect(instance.chat('p')).rejects.toMatchObject({ code: 'MG_E_STORE_IO' });
    expect(instance.stats.calls).toBe(4);
  });
});

describe('the deadline', () => {
  it('refuses to start a call after it, and spends nothing', async () => {
    const { instance } = client([ok('x')], { deadline: Date.now() - 1 });
    await expect(instance.chat('p')).rejects.toMatchObject({ code: 'MG_E_DEADLINE' });
    expect(instance.stats.calls).toBe(0);
  });

  it('stops between attempts when it passes during the retry', async () => {
    // The check is per attempt rather than per prompt: a prompt that fails at minute 129 and would
    // be retried at minute 131 must not be retried. The clock is moved inside `sleep`, which is what
    // the backoff would have done.
    let index = 0;
    const instance = new LlmClient({
      apiKey: 'k',
      model: 'm',
      maxCalls: 100,
      random: () => 0,
      deadline: Date.now() + 50,
      sleep: async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
      },
      fetchImpl: (async () => {
        index += 1;
        return new Response(null, { status: 503 });
      }) as unknown as typeof fetch,
    });
    await expect(instance.chat('p')).rejects.toMatchObject({ code: 'MG_E_DEADLINE' });
    expect(instance.stats.calls).toBe(1);
  });

  it('is absent by default, so every existing lane keeps its behaviour', async () => {
    const { instance } = client([ok('x')]);
    await expect(instance.chat('p')).resolves.toMatchObject({ text: 'x' });
  });
});

describe('LlmClient authorising more calls', () => {
  it('refuses a call past the ceiling it was constructed with', async () => {
    const { instance } = client([ok('one')], { maxCalls: 1 });
    await expect(instance.chat('first')).resolves.toMatchObject({ text: 'one' });
    await expect(instance.chat('second')).rejects.toThrow(/call budget reached/);
  });

  it('spends a call it was authorised to spend after the fact', async () => {
    // R74's shape: the run measures a fold, learns its own forecast was low, and is authorised to
    // keep going. The capability is the whole point — a forecast that can only refuse is a
    // forecast that converts a 5.7% arithmetic miss into a discarded run.
    const { instance, seen } = client([ok('one'), ok('two')], { maxCalls: 1 });
    await instance.chat('first');
    expect(instance.authoriseCalls(2)).toBe(2);
    await expect(instance.chat('second')).resolves.toMatchObject({ text: 'two' });
    expect(seen).toHaveLength(2);
  });

  it('reports the ceiling in force rather than the one it was built with', () => {
    const { instance } = client([], { maxCalls: 10 });
    expect(instance.callCap).toBe(10);
    instance.authoriseCalls(25);
    expect(instance.callCap).toBe(25);
  });

  it('ignores a lower authorisation instead of shrinking a run that is already paying', () => {
    // A forecast can measure a *cheaper* fold than the one it replaced, and the right response to
    // good news is not to fail the call the run is in the middle of making.
    const { instance } = client([], { maxCalls: 40 });
    expect(instance.authoriseCalls(12)).toBe(40);
    expect(instance.callCap).toBe(40);
  });

  it('ignores a non-finite authorisation rather than making the ceiling unbounded', () => {
    // `Infinity` reaching this field is a NaN sliding through arithmetic in a forecast, and a
    // ceiling of Infinity is not a budget at all — it is the absence of one, arrived at by accident.
    const { instance } = client([], { maxCalls: 10 });
    expect(instance.authoriseCalls(Number.POSITIVE_INFINITY)).toBe(10);
    expect(instance.authoriseCalls(Number.NaN)).toBe(10);
  });

  it('keeps the raised ceiling across a burst of concurrent calls', async () => {
    const { instance } = client([ok('a'), ok('b'), ok('c')], { maxCalls: 1 });
    instance.authoriseCalls(3);
    const texts = await Promise.all([instance.chat('1'), instance.chat('2'), instance.chat('3')]);
    expect(texts.map((text) => text.text)).toEqual(['a', 'b', 'c']);
  });
});
