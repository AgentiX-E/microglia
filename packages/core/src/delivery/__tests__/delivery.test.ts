import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex } from '../sha256.js';
import { knowledgeEvents, snapshotOf, taskCompleted, type DraftEvent } from '../events.js';
import { SIGNATURE_HEADER, WebhookDispatcher, eventId } from '../dispatcher.js';
import type { KnowledgeItem, TaskRecord } from '../../kernel/index.js';

const encoder = new TextEncoder();

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function macOf(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function item(overrides: Partial<KnowledgeItem> & { readonly id: string }): KnowledgeItem {
  return {
    schema: 'microglia.knowledge/1',
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'For comparison questions over revenue, use a line chart.',
    payload: { when: { intent: 'comparison' }, then: { mark: 'line' } },
    trust: 0.9,
    support: 0.9,
    confidence: 0.9,
    status: 'active',
    statusReason: 'confidence-cleared',
    tier: 'user-edit',
    evidence: [],
    contradictions: 0,
    applied: 0,
    succeeded: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as KnowledgeItem;
}

function draft(overrides: Partial<DraftEvent> = {}): DraftEvent {
  return {
    type: 'knowledge.admitted',
    namespace: 'acme',
    taskType: 'chart.recommend',
    item: { id: 'k_1', kind: 'constraint', statement: 'line', trust: 0.9 },
    reason: 'admitted',
    at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SHA-256 and HMAC, against the references', () => {
  it('matches the published digests for the empty string and `abc`', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto across block boundaries', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(digestOf(text));
    }
  });

  it('matches RFC 4231 test case 1 (key shorter than the block)', () => {
    expect(hmacSha256Hex('\u000b'.repeat(20), 'Hi There')).toBe(
      'sha256=b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('matches RFC 4231 test case 2 (short key, longer message)', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      'sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('matches node:crypto for a key longer than the block', () => {
    const key = 'a'.repeat(131);
    const message = 'Test Using Larger Than Block-Size Key - Hash Key First';
    expect(hmacSha256Hex(key, message)).toBe(macOf(key, message));
  });

  it('hashes bytes as readily as text', () => {
    const bytes = encoder.encode('abc');
    expect(sha256Hex(bytes)).toBe(sha256Hex('abc'));
  });
});

describe('what a store change implies', () => {
  const base = { namespace: 'acme', taskType: 'chart.recommend' };

  it('admits a rule it has not seen before', () => {
    const events = knowledgeEvents({ ...base, previous: {}, current: [item({ id: 'k_1' })] });
    expect(events.map((event) => event.type)).toEqual(['knowledge.admitted']);
    expect(events[0]?.item).toEqual({
      id: 'k_1',
      kind: 'constraint',
      statement: 'For comparison questions over revenue, use a line chart.',
      trust: 0.9,
    });
  });

  it('reports a rewrite of a rule that stays active', () => {
    const events = knowledgeEvents({
      ...base,
      previous: { k_1: { status: 'active', updatedAt: 1 } },
      current: [item({ id: 'k_1', updatedAt: 5 })],
    });
    expect(events.map((event) => event.type)).toEqual(['knowledge.superseded']);
  });

  it('reports a retirement once, and not again', () => {
    const retired = item({ id: 'k_1', status: 'retired', updatedAt: 9 });
    expect(
      knowledgeEvents({ ...base, previous: { k_1: { status: 'active', updatedAt: 1 } }, current: [retired] }).map(
        (event) => event.type,
      ),
    ).toEqual(['knowledge.retired']);
    expect(
      knowledgeEvents({ ...base, previous: { k_1: { status: 'retired', updatedAt: 9 } }, current: [retired] }),
    ).toEqual([]);
  });

  it('says nothing about a rule that has not been admitted', () => {
    const candidate = item({ id: 'k_1', status: 'candidate' });
    expect(knowledgeEvents({ ...base, previous: {}, current: [candidate] })).toEqual([]);
  });

  it('says nothing at all when the store has not moved', () => {
    const items = [item({ id: 'k_1' }), item({ id: 'k_2', updatedAt: 4 })];
    expect(knowledgeEvents({ ...base, previous: snapshotOf(items), current: items })).toEqual([]);
  });

  it('orders by updated time, then by id, so a replay is identical', () => {
    const items = [
      item({ id: 'k_b', updatedAt: 5 }),
      item({ id: 'k_a', updatedAt: 5 }),
      item({ id: 'k_c', updatedAt: 2 }),
    ];
    const first = knowledgeEvents({ ...base, previous: {}, current: items });
    const second = knowledgeEvents({ ...base, previous: {}, current: [...items].reverse() });
    expect(first.map((event) => event.item.id)).toEqual(['k_c', 'k_a', 'k_b']);
    expect(second.map((event) => event.item.id)).toEqual(['k_c', 'k_a', 'k_b']);
  });

  it('builds a task.completed event from the record the host already holds', () => {
    const record: TaskRecord = {
      schema: 'microglia.task/1',
      taskId: 't_7',
      taskType: 'chart.recommend',
      namespace: 'acme',
      attempts: 2,
      status: 'accepted',
      finalRunId: 'run_1',
      openedAt: 10,
      closedAt: 20,
    };
    const event = taskCompleted(record);
    expect(event.type).toBe('task.completed');
    expect(event.item.id).toBe('t_7');
    expect(event.reason).toBe('accepted');
    expect(event.at).toBe(20);
  });
});

type Received = { readonly body: string; readonly signature: string; readonly event: string };

/** A real receiver: a socket, a signature check, and a scripted response. */
async function receiver(script: readonly number[] = []): Promise<{
  readonly url: string;
  readonly received: Received[];
  readonly close: () => Promise<void>;
  readonly server: Server;
}> {
  const received: Received[] = [];
  const replies = [...script];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({
        body,
        signature: String(request.headers[SIGNATURE_HEADER.toLowerCase()] ?? ''),
        event: String(request.headers['x-microglia-event'] ?? ''),
      });
      const status = replies.shift() ?? 200;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}/microglia/events`,
    received,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  };
}

const open: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (open.length > 0) await (open.pop() as () => Promise<void>)();
});

function dispatcher(url: string, overrides: { attempts?: number; retries?: number } = {}) {
  const sleeps: number[] = [];
  const instance = new WebhookDispatcher({
    target: { url, secret: 'shhh' },
    fetch,
    clock: () => Date.now(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...(overrides.attempts === undefined ? {} : { attempts: overrides.attempts }),
  });
  return { instance, sleeps };
}

describe('the webhook sender', () => {
  it('signs the bytes it posts, and the receiver can verify them', async () => {
    const box = await receiver();
    open.push(box.close);
    const { instance } = dispatcher(box.url);
    const result = await instance.publish([draft()]);

    expect(result.failed).toEqual([]);
    expect(result.attempts).toHaveLength(1);
    expect(box.received).toHaveLength(1);
    const [first] = box.received;
    expect(first?.signature).toBe(macOf('shhh', first?.body ?? ''));
    expect(JSON.parse(first?.body ?? '{}')).toMatchObject({
      type: 'knowledge.admitted',
      namespace: 'acme',
      taskType: 'chart.recommend',
      seq: 1,
    });
  });

  it('retries a 5xx with a growing backoff, under the same event id', async () => {
    const box = await receiver([503, 500, 200]);
    open.push(box.close);
    const { instance, sleeps } = dispatcher(box.url);
    const result = await instance.publish([draft()]);

    expect(result.failed).toEqual([]);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([503, 500, 200]);
    expect(new Set(result.attempts.map((attempt) => attempt.eventId)).size).toBe(1);
    expect(sleeps).toEqual([200, 400]);
    expect(new Set(box.received.map((entry) => entry.event)).size).toBe(1);
  });

  it('does not retry a 4xx: the receiver refused this body', async () => {
    const box = await receiver([400, 200]);
    open.push(box.close);
    const { instance, sleeps } = dispatcher(box.url);
    const result = await instance.publish([draft()]);

    expect(result.attempts).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(box.received).toHaveLength(1);
  });

  it('treats an unreachable receiver as a retryable failure, then gives up', async () => {
    const instance = new WebhookDispatcher({
      target: { url: 'http://127.0.0.1:1/microglia/events', secret: 'shhh' },
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
      clock: () => 0,
      sleep: async () => undefined,
      attempts: 3,
    });
    const result = await instance.publish([draft()]);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([0, 0, 0]);
    expect(result.failed).toHaveLength(1);
  });

  it('reports every event failed when delivery is disabled', async () => {
    // `attempts: 0` must not mean "silently drop": a queue that answers nothing is
    // indistinguishable from one that succeeded, which is the worst failure mode a
    // delivery path has.
    const instance = new WebhookDispatcher({
      target: { url: 'http://127.0.0.1:1/never', secret: 'shhh' },
      fetch: async () => ({ ok: true, status: 200 }),
      clock: () => 0,
      sleep: async () => undefined,
      attempts: 0,
    });
    const result = await instance.publish([draft()]);
    expect(result.attempts).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });

  it('keeps sequence numbers per task type, and sends a batch in order', async () => {
    const box = await receiver();
    open.push(box.close);
    const { instance } = dispatcher(box.url);
    await instance.publish([
      draft({ taskType: 'chart.recommend', item: { id: 'k_1', kind: 'constraint', statement: 'a', trust: 1 } }),
      draft({ taskType: 'chart.recommend', item: { id: 'k_2', kind: 'constraint', statement: 'b', trust: 1 } }),
      draft({ taskType: 'sql.repair', item: { id: 'k_3', kind: 'constraint', statement: 'c', trust: 1 } }),
    ]);
    const seqs = box.received.map((entry) => {
      const body = JSON.parse(entry.body) as { seq: number; taskType: string };
      return `${body.taskType}:${body.seq}`;
    });
    expect(seqs).toEqual(['chart.recommend:1', 'chart.recommend:2', 'sql.repair:1']);
  });

  it('derives the event id from content and sequence, so a redelivery is recognisable', () => {
    const first = eventId(draft(), 1);
    expect(eventId(draft(), 1)).toBe(first);
    expect(eventId(draft(), 2)).not.toBe(first);
    expect(eventId(draft({ item: { id: 'k_2', kind: 'constraint', statement: 'x', trust: 1 } }), 1)).not.toBe(first);
    expect(first.startsWith('evt_')).toBe(true);
  });

  it('reports the sequence a batch would use without consuming it', async () => {
    const box = await receiver();
    open.push(box.close);
    const { instance } = dispatcher(box.url);
    expect(instance.nextSeq('chart.recommend')).toBe(1);
    await instance.publish([draft()]);
    expect(instance.nextSeq('chart.recommend')).toBe(2);
    expect(instance.nextSeq('other.task')).toBe(1);
  });
});
