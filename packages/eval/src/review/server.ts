/**
 * The review console's server: the smallest thing that can hold a reviewer's decisions.
 *
 * Two constraints shape it. The first is that the console must show **what the model would
 * see**, not a description of it — every defect this project has found in the delivery path
 * (the double-wrapped element, the empty block that still cost 1.14pp, the note that
 * competed with the rules for characters) was invisible in the data and obvious in the
 * string. So the page is served the real renderer's output for each card, computed here with
 * `renderPack` rather than re-implemented in the browser.
 *
 * The second is that the ledger is append-only and the server is a fold over it. A restart
 * replays the decisions file onto the batch and arrives at the same state, which means the
 * audit trail is the state rather than a log beside it. That property is a test.
 *
 * No dependencies, no static files, no framework: one file of routes and one string of page.
 * A console that needs a build step to review a sentence is a console nobody runs.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MicrogliaError, type DistillCandidate } from '@agentix-e/microglia-core';
import {
  applyDecision,
  summaryOf,
  toDistillCandidate,
  type ReviewBatch,
  type ReviewDecision,
  type ReviewItem,
  type ReviewSummary,
} from '@agentix-e/microglia-core/retrospect';
import { renderPack, type RenderableItem } from '@agentix-e/microglia-core/apply';
import { renderConsole } from './page.js';

export type ReviewServerOptions = {
  readonly batch: ReviewBatch;
  /** Who is reviewing. Every decision is attributed, so this cannot be blank. */
  readonly reviewer: string;
  /** Decisions already taken, replayed onto the batch in order before the server starts. */
  readonly decisions?: readonly ReviewDecision[];
  /** Called after a decision is applied; the bin writes one JSON line per call. */
  readonly append?: (decision: ReviewDecision) => void;
  readonly now?: () => number;
  /** Body ceiling. A decision is a sentence and a few numbers; a megabyte is generous. */
  readonly maxBodyBytes?: number;
};

export type ReviewServer = {
  readonly server: Server;
  readonly state: () => ReviewBatch;
  readonly admitted: () => readonly DistillCandidate[];
  readonly summary: () => ReviewSummary;
};

const DEFAULT_MAX_BODY = 1_048_576;

/** A card as the browser needs it: the record, the verdict, and the text the model would read. */
export type ReviewCardPayload = {
  readonly candidateId: string;
  readonly statement: string;
  readonly when: string;
  readonly state: string;
  readonly verdict: { readonly state: string; readonly sentence: string };
  readonly support: {
    readonly covered: number;
    readonly distinctTasks: number;
    readonly collateral: number;
    readonly collateralPasses: number;
    readonly unwitnessed: number;
    readonly polarityConflicts: number;
  };
  readonly members: readonly {
    readonly id: string;
    readonly statement: string;
    readonly when: string;
    readonly task: string;
    readonly outcome: string;
    readonly verdict: string;
    readonly overlap: number;
  }[];
  readonly collateral: readonly {
    readonly id: string;
    readonly when: string;
    readonly outcome: string;
  }[];
  readonly reasons: readonly string[];
  readonly rendered: string;
  readonly decision?: {
    readonly action: string;
    readonly reviewer: string;
    readonly at: number;
    readonly elapsedMs: number;
    readonly reason?: string;
  };
  readonly children?: readonly { readonly id: string; readonly statement: string }[];
};

function renderableOf(item: ReviewItem): RenderableItem {
  return {
    id: item.proposal.id,
    kind: 'procedure',
    confidence: 0.5,
    scope: { task: 'retrospect' },
    statement: item.text,
    when: item.proposal.when,
  };
}

/**
 * The block a reviewer has to read before accepting.
 *
 * Rendered with the production renderer at the production budget, so a guideline long enough
 * to be dropped by the pack is visible here rather than at the far end of an experiment:
 * a rule that is admitted and never served is worse than one that is refused, because the
 * first looks like a memory that does not help.
 */
export function renderedOf(item: ReviewItem, budget = 2_400): string {
  return renderPack([renderableOf(item)], { budget, conditions: true }).rendered;
}

export function cardOf(batch: ReviewBatch, item: ReviewItem): ReviewCardPayload {
  const report = item.admissibility.report;
  const byId = new Map(batch.corpus.map((source) => [source.id, source]));
  return {
    candidateId: item.proposal.id,
    statement: item.text,
    when: item.proposal.when,
    state: item.state,
    verdict: { state: item.admissibility.state, sentence: item.admissibility.sentence },
    support: {
      covered: report.covered,
      distinctTasks: report.distinctTasks,
      collateral: report.collateral.length,
      collateralPasses: report.collateral.filter((entry) => entry.outcome === 'pass').length,
      unwitnessed: report.unwitnessed,
      polarityConflicts: report.polarityConflicts.length,
    },
    members: item.proposal.covers.map((id) => {
      const source = byId.get(id);
      const finding = report.findings.find((entry) => entry.sourceId === id);
      return {
        id,
        statement: source?.statement ?? '(not in this corpus)',
        when: source?.when ?? '',
        task: source?.taskId ?? '',
        outcome: source?.outcome ?? 'unknown',
        verdict: finding?.verdict ?? 'unwitnessed',
        overlap: Number((finding?.overlap ?? 0).toFixed(2)),
      };
    }),
    collateral: report.collateral.map((entry) => ({
      id: entry.sourceId,
      when: byId.get(entry.sourceId)?.when ?? '',
      outcome: entry.outcome,
    })),
    reasons: item.decision?.reason === undefined ? [] : [item.decision.reason],
    rendered: renderedOf(item),
    ...(item.decision === undefined
      ? {}
      : {
          decision: {
            action: item.decision.action,
            reviewer: item.decision.reviewer,
            at: item.decision.at,
            elapsedMs: item.decision.elapsedMs,
            ...(item.decision.reason === undefined ? {} : { reason: item.decision.reason }),
          },
        }),
    ...(item.children === undefined
      ? {}
      : { children: item.children.map((child) => ({ id: child.id, statement: child.statement })) }),
  };
}

function send(response: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(payload),
    // The console is a local tool that mutates a file; a cached page would show a stale card.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new MicrogliaError('MG_E_CONFIG', 'request body exceeds the console limit', { limit });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function decisionOf(raw: unknown, reviewer: string): ReviewDecision {
  const value = raw as Record<string, unknown>;
  const action = value['action'];
  // Kept in one place because it drifted once: `override` was added to the ledger and not
  // here, so the console's own override button came back as "unknown action".
  const allowed = ['accept', 'edit', 'reject', 'split', 'defer', 'override'];
  if (typeof action !== 'string' || !allowed.includes(action)) {
    throw new MicrogliaError('MG_E_CONFIG', 'unknown action', { action: String(action) });
  }
  return {
    candidateId: String(value['candidateId'] ?? ''),
    action: action as ReviewDecision['action'],
    // The server sends the text it showed and refuses a mismatch, so a stale tab cannot
    // decide a card it is not looking at.
    textBefore: String(value['textBefore'] ?? ''),
    ...(value['textAfter'] === undefined ? {} : { textAfter: String(value['textAfter']) }),
    ...(value['reason'] === undefined ? {} : { reason: String(value['reason']) }),
    ...(Array.isArray(value['splitInto']) ? { splitInto: value['splitInto'].map((part) => String(part)) } : {}),
    reviewer,
    at: Number(value['at'] ?? 0),
    elapsedMs: Number(value['elapsedMs'] ?? Number.NaN),
  };
}

export function createReviewServer(options: ReviewServerOptions): ReviewServer {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  let batch = (options.decisions ?? []).reduce((current, decision) => applyDecision(current, decision), options.batch);

  // Accepted implies decided, and the filter says so in one place rather than leaving a
  // fallback that can never run and a reader wondering which one is true.
  const admitted = (): readonly DistillCandidate[] =>
    batch.items
      .filter((item): item is ReviewItem & { decision: ReviewDecision } =>
        item.state === 'accepted' && item.decision !== undefined,
      )
      .map((item) => toDistillCandidate(batch, item, { decisionId: `decision-${item.decision.at}` }));

  const server = createServer((request, response) => {
    void (async () => {
      // `request.url` is set on every request a server handler sees; the base is a placeholder
      // because only the pathname is read.
      const url = new URL(request.url as string, 'http://127.0.0.1');
      const path = url.pathname;
      try {
        if (request.method === 'GET' && path === '/') {
          send(response, 200, renderConsole({ batchId: batch.id, reviewer: options.reviewer }), 'text/html');
          return;
        }
        if (request.method === 'GET' && path === '/api/batch') {
          send(response, 200, {
            id: batch.id,
            namespace: batch.namespace,
            createdAt: batch.createdAt,
            reviewer: options.reviewer,
            summary: summaryOf(batch),
            items: batch.items.map((item) => cardOf(batch, item)),
          });
          return;
        }
        if (request.method === 'GET' && path === '/api/export') {
          send(response, 200, {
            batch: batch.id,
            summary: summaryOf(batch),
            admitted: admitted(),
            // The ledger, not the state: a reader can replay this and check the summary.
            decisions: batch.items.flatMap((item) => (item.decision === undefined ? [] : [item.decision])),
          });
          return;
        }
        if (request.method === 'POST' && path === '/api/decision') {
          const body = await readBody(request, limit);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            send(response, 400, { error: 'body is not JSON' });
            return;
          }
          let decision: ReviewDecision;
          try {
            decision = decisionOf(parsed, options.reviewer);
            batch = applyDecision(batch, decision);
          } catch (error) {
            // A refusal is information: the reviewer is told which invariant stopped it and
            // the card stays where it was, so nothing is half-recorded.
            send(response, 409, { error: (error as Error).message });
            return;
          }
          options.append?.(decision);
          const item = batch.items.find((entry) => entry.proposal.id === decision.candidateId) as ReviewItem;
          send(response, 200, { item: cardOf(batch, item), summary: summaryOf(batch) });
          return;
        }
        if (path === '/api/decision' || path === '/api/batch' || path === '/api/export' || path === '/') {
          send(response, 405, { error: 'method not allowed' });
          return;
        }
        send(response, 404, { error: 'no such route' });
      } catch (error) {
        const known = error instanceof MicrogliaError;
        send(response, known ? 413 : 500, { error: (error as Error).message });
      }
    })();
  });

  return {
    server,
    state: () => batch,
    admitted,
    summary: () => summaryOf(batch),
  };
}
