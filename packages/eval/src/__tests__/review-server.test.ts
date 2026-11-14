import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  buildBatch,
  DEFAULT_RETROSPECT_POLICY,
  type GuidelineProposal,
  type RetrospectSource,
  type ReviewDecision,
} from '@agentix-e/microglia-core/retrospect';
import { createReviewServer, renderedOf } from '../review/server.js';

const at = 1_700_000_000_000;

const corpus: RetrospectSource[] = [
  {
    id: 'k1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested for a damaged item',
    task: 'retail.support',
    taskId: 'task-a',
    outcome: 'repair',
    confidence: 0.8,
    at,
  },
  {
    id: 'k2',
    statement: 'Refund the shipping fee for an item that arrived damaged.',
    when: 'when a refund is requested for a damaged item and the box was open',
    task: 'retail.support',
    taskId: 'task-b',
    outcome: 'repair',
    confidence: 0.7,
    at,
  },
];

function proposals(): GuidelineProposal[] {
  return [
    {
      id: 'gp1',
      statement: 'Refund the shipping fee for a damaged item.',
      when: 'when a refund is requested for a damaged item',
      covers: ['k1', 'k2'],
    },
    {
      id: 'gp2',
      statement: 'Refund the shipping fee.',
      when: 'when a refund is requested for a damaged item',
      covers: ['k1'],
    },
  ];
}

function batchOf(ids: readonly string[] = ['gp1', 'gp2']) {
  return buildBatch({
    id: 'batch-1',
    createdAt: at,
    namespace: 'acme',
    policy: DEFAULT_RETROSPECT_POLICY,
    corpus,
    proposals: proposals().filter((proposal) => ids.includes(proposal.id)),
  });
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(options: Parameters<typeof createReviewServer>[0]): Promise<string> {
  const { server } = createReviewServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function get(base: string, path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  return { status: response.status, body: path === '/' ? text : JSON.parse(text) };
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('the console serves a page and the batch behind it', () => {
  it('serves the console with the batch and reviewer in it', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const page = await get(base, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('Retrospection review');
    expect(page.body).toContain('batch-1');
    expect(page.body).toContain('lambertyan');
  });

  it('serves each card with its verdict, its sources and the block the model would read', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await get(base, '/api/batch');
    expect(status).toBe(200);
    expect(body.items.map((item: { candidateId: string }) => item.candidateId)).toEqual(['gp1', 'gp2']);
    const card = body.items[0];
    expect(card.verdict.state).toBe('reviewable');
    expect(card.support).toMatchObject({ covered: 2, distinctTasks: 2 });
    expect(card.members.map((member: { id: string }) => member.id)).toEqual(['k1', 'k2']);
    // The block is the production renderer's output, not a description of it.
    expect(card.rendered).toContain('<microglia-knowledge');
    expect(card.rendered).toContain('Refund the shipping fee for a damaged item.');
  });

  it('shows why a card is not reviewable rather than hiding it', async () => {
    const base = await listen({ batch: batchOf(['gp2']), reviewer: 'lambertyan' });
    const { body } = await get(base, '/api/batch');
    expect(body.items[0].verdict.state).toBe('restatement');
    expect(body.items[0].verdict.sentence).toContain('not a guideline');
  });
});

describe('a decision is recorded or refused, and never half-recorded', () => {
  it('records an accept and returns the updated card and summary', async () => {
    const appended: ReviewDecision[] = [];
    const base = await listen({
      batch: batchOf(),
      reviewer: 'lambertyan',
      append: (decision) => appended.push(decision),
    });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'accept',
      textBefore: 'Refund the shipping fee for a damaged item.',
      at: at + 1,
      elapsedMs: 1_200,
    });
    expect(status).toBe(200);
    expect(body.item.state).toBe('accepted');
    expect(body.summary.accepted).toBe(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.reviewer).toBe('lambertyan');
  });

  it('refuses an accept the gate rejected, with the sentence that says why', async () => {
    const base = await listen({ batch: batchOf(['gp2']), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp2',
      action: 'accept',
      textBefore: 'Refund the shipping fee.',
      at: at + 1,
      elapsedMs: 900,
    });
    expect(status).toBe(409);
    expect(body.error).toContain('restatement');
  });

  it('records an edit and admits the reviewer’s wording', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'edit',
      textBefore: 'Refund the shipping fee for a damaged item.',
      textAfter: 'Refund the shipping fee when an item arrives damaged.',
      at: at + 6,
      elapsedMs: 3_300,
    });
    expect(status).toBe(200);
    expect(body.item.statement).toBe('Refund the shipping fee when an item arrives damaged.');
    expect(body.item.decision.action).toBe('edit');
    expect(body.summary.editRate).toBe(1);
  });

  it('refuses a body with no candidate at all, rather than defaulting to one', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', { action: 'accept', textBefore: 'x' });
    expect(status).toBe(409);
    expect(body.error).toContain('not in this batch');
  });

  it('accepts a body with no timestamp, and records zero rather than refusing', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'accept',
      textBefore: 'Refund the shipping fee for a damaged item.',
      elapsedMs: 120,
    });
    expect(status).toBe(200);
    expect(body.item.decision.at).toBe(0);
  });

  it('refuses an unknown action', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status } = await post(base, '/api/decision', { candidateId: 'gp1', action: 'approve' });
    expect(status).toBe(409);
  });

  it('refuses a body that is not JSON', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', 'not json');
    expect(status).toBe(400);
    expect(body.error).toContain('not JSON');
  });

  it('refuses a body over its own limit rather than reading it', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan', maxBodyBytes: 8 });
    const { status } = await post(base, '/api/decision', { candidateId: 'gp1', action: 'accept' });
    expect(status).toBe(413);
  });

  it('reports a failure that is not a refusal as a server error', async () => {
    const base = await listen({
      batch: batchOf(),
      reviewer: 'lambertyan',
      append: () => {
        throw new Error('disk is full');
      },
    });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'accept',
      textBefore: 'Refund the shipping fee for a damaged item.',
      at: at + 1,
      elapsedMs: 10,
    });
    expect(status).toBe(500);
    expect(body.error).toContain('disk is full');
  });
});

describe('a card that claims a source the corpus does not have', () => {
  it('shows the missing source as missing rather than pretending it is covered', async () => {
    const batch = buildBatch({
      id: 'batch-ghost',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [{ ...(proposals()[0] as GuidelineProposal), covers: ['k1', 'k2', 'ghost'] }],
    });
    const base = await listen({ batch, reviewer: 'lambertyan' });
    const { body } = await get(base, '/api/batch');
    const card = body.items[0];
    const ghost = card.members.find((member: { id: string }) => member.id === 'ghost');
    expect(ghost).toMatchObject({ verdict: 'unwitnessed', overlap: 0, task: '', outcome: 'unknown' });
    expect(ghost.statement).toContain('not in this corpus');
    expect(card.verdict.state).toBe('unwitnessed');
  });
});

describe('a card shows what it would also match', () => {
  it('lists collateral, and says which of it was a pass', async () => {
    const wider: RetrospectSource[] = [
      ...corpus,
      {
        id: 'k3',
        statement: 'Refund the shipping fee for a fragile item.',
        when: 'when a refund is requested for a damaged item that was fragile',
        task: 'retail.support',
        taskId: 'task-c',
        outcome: 'repair',
        confidence: 0.7,
        at,
      },
      {
        id: 'p1',
        statement: 'A refund was processed for a damaged item.',
        when: 'when a refund is requested for a damaged item and the customer asked first',
        task: 'retail.support',
        taskId: 'task-d',
        outcome: 'pass',
        confidence: 0.9,
        at,
      },
    ];
    const batch = buildBatch({
      id: 'batch-wide',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus: wider,
      proposals: [proposals()[0] as GuidelineProposal],
    });
    const base = await listen({ batch, reviewer: 'lambertyan' });
    const { body } = await get(base, '/api/batch');
    const card = body.items[0];
    expect(card.collateral.map((entry: { id: string }) => entry.id)).toEqual(['k3', 'p1']);
    expect(card.support.collateral).toBe(2);
    expect(card.support.collateralPasses).toBe(1);
  });
});

describe('the decisions a reviewer makes that carry text', () => {
  it('records a rejection with its reason on the card', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'reject',
      textBefore: 'Refund the shipping fee for a damaged item.',
      reason: 'two situations, not one',
      at: at + 2,
      elapsedMs: 2_400,
    });
    expect(status).toBe(200);
    expect(body.item.state).toBe('rejected');
    expect(body.item.reasons).toEqual(['two situations, not one']);
    expect(body.summary.rejected).toBe(1);
  });

  it('records a split and shows the parts it produced', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status, body } = await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'split',
      textBefore: 'Refund the shipping fee for a damaged item.',
      splitInto: ['Refund the shipping fee for a damaged item.', 'Refund the shipping fee when the box was open.'],
      at: at + 3,
      elapsedMs: 3_100,
    });
    expect(status).toBe(200);
    expect(body.item.state).toBe('split');
    expect(body.item.children).toHaveLength(2);
    expect(body.summary.split).toBe(1);
  });

  it('records an override with its reason and admits it on export', async () => {
    const base = await listen({ batch: batchOf(['gp2']), reviewer: 'lambertyan' });
    const { status } = await post(base, '/api/decision', {
      candidateId: 'gp2',
      action: 'override',
      textBefore: 'Refund the shipping fee.',
      reason: 'two more tasks will arrive next week',
      at: at + 4,
      elapsedMs: 5_000,
    });
    expect(status).toBe(200);
    const exported = await get(base, '/api/export');
    expect(exported.body.admitted[0].payload.reviewAction).toBe('override');
    expect(exported.body.summary.overrides).toBe(1);
  });
});

describe('the export is what a later arm would load', () => {
  it('carries the admitted guidelines and the ledger that produced them', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    await post(base, '/api/decision', {
      candidateId: 'gp1',
      action: 'accept',
      textBefore: 'Refund the shipping fee for a damaged item.',
      at: at + 1,
      elapsedMs: 1_000,
    });
    const { status, body } = await get(base, '/api/export');
    expect(status).toBe(200);
    expect(body.admitted).toHaveLength(1);
    expect(body.admitted[0]).toMatchObject({ kind: 'procedure', when: 'when a refund is requested for a damaged item' });
    expect(body.admitted[0].payload.mergedFrom).toEqual(['k1', 'k2']);
    expect(body.decisions).toHaveLength(1);
    expect(body.summary.acceptRate).toBe(1);
  });

  it('carries nothing when nothing was accepted', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { body } = await get(base, '/api/export');
    expect(body.admitted).toEqual([]);
    expect(body.decisions).toEqual([]);
  });
});

describe('the handle exposes what it has, for a caller that is not a browser', () => {
  it('reports the batch, the summary and the admitted set without a request', () => {
    const handle = createReviewServer({ batch: batchOf(), reviewer: 'lambertyan' });
    expect(handle.state().items).toHaveLength(2);
    expect(handle.summary().pending).toBe(2);
    expect(handle.admitted()).toEqual([]);
    servers.push(handle.server);
  });
});

describe('a restart replays the ledger rather than trusting the batch', () => {
  it('arrives at the same state from the decisions file', async () => {
    const decision: ReviewDecision = {
      candidateId: 'gp1',
      action: 'accept',
      textBefore: 'Refund the shipping fee for a damaged item.',
      reviewer: 'lambertyan',
      at: at + 5,
      elapsedMs: 800,
    };
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan', decisions: [decision] });
    const { body } = await get(base, '/api/batch');
    expect(body.items[0].state).toBe('accepted');
    expect(body.items[0].decision.action).toBe('accept');
    expect(body.summary.accepted).toBe(1);
  });
});

describe('the routes refuse what they are not', () => {
  it('answers 404 for a path it does not serve', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status } = await get(base, '/api/nothing');
    expect(status).toBe(404);
  });

  it('answers 405 for a known path with the wrong method, rather than 404', async () => {
    const base = await listen({ batch: batchOf(), reviewer: 'lambertyan' });
    const { status } = await post(base, '/api/batch', {});
    expect(status).toBe(405);
  });
});

describe('the rendered block is the renderer’s, at a budget that can refuse', () => {
  it('drops a statement longer than the pack can carry instead of showing a truncated one', () => {
    const long = buildBatch({
      id: 'batch-2',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [proposals()[0] as GuidelineProposal],
    });
    expect(renderedOf(long.items[0]!, 10_000)).toContain('Refund the shipping fee');
    // A budget that admits no item renders nothing at all, which is what the console has to
    // show a reviewer whose guideline will never fit.
    expect(renderedOf(long.items[0]!, 60)).toBe('');
  });
});
