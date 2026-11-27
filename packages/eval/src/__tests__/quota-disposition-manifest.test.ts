import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyQuotaFailure, quotaReplyFrom } from '../quota-disposition.js';

/**
 * The third reader. eval/tools/quota_disposition.py re-derives the manifest from the same
 * fixture bytes with no shared code; this test derives it again with the TypeScript product
 * that actually runs in the drivers. If either reader drifts, one side fails and the build
 * stops — the product ships the classification the measurement read.
 */
const ROOT = process.cwd();
const FIXTURE = join(ROOT, 'eval/fixtures/quota-replies.json');
const MANIFEST = join(ROOT, 'eval/manifests/quota-disposition.json');

type Fixture = {
  readonly cases: readonly {
    readonly id: string;
    readonly status: number;
    readonly body?: unknown;
    readonly retryAfterMs?: number | null;
  }[];
};
type Manifest = {
  readonly sourceSha256: string;
  readonly reading: {
    readonly cases: number;
    readonly byDisposition: Readonly<Record<string, number>>;
    readonly perCase: readonly {
      readonly id: string;
      readonly status: number;
      readonly family: string;
      readonly disposition: string;
      readonly hint: string;
      readonly code?: string;
    }[];
  };
};

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;

describe('quota-disposition product ↔ manifest agreement', () => {
  it('derives every case with the product and matches the manifest field by field', () => {
    expect(manifest.reading.cases).toBe(fixture.cases.length);
    expect(manifest.reading.perCase).toHaveLength(fixture.cases.length);
    const tally: Record<string, number> = {};
    for (const record of manifest.reading.perCase) {
      tally[record.disposition] = (tally[record.disposition] ?? 0) + 1;
    }
    expect(tally).toEqual(manifest.reading.byDisposition);

    for (const [index, record] of manifest.reading.perCase.entries()) {
      const source = fixture.cases[index] as Fixture['cases'][number];
      const body = source.body === undefined || source.body === null
        ? undefined
        : typeof source.body === 'string'
          ? source.body
          : JSON.stringify(source.body);
      const reply = quotaReplyFrom(source.status, source.retryAfterMs ?? undefined, body);
      const verdict = classifyQuotaFailure(reply);
      expect(verdict.family, `family of ${record.id}`).toBe(record.family);
      expect(verdict.disposition, `disposition of ${record.id}`).toBe(record.disposition);
      expect(verdict.hint, `hint of ${record.id}`).toBe(record.hint);
      expect(verdict.code, `code of ${record.id}`).toBe(record.code);
      expect(source.id).toBe(record.id);
      expect(source.status).toBe(record.status);
    }
  });

  it('names the decisive fact the manifest records: balance is a 403 stop, never a retried 429', () => {
    const balance = manifest.reading.perCase.find((c) => c.id === 'balance-403');
    expect(balance).toMatchObject({ status: 403, family: 'balance.insufficient', disposition: 'stop', hint: 'top-up' });
    expect(manifest.reading.perCase.some((c) => c.status === 403 && c.disposition === 'retry')).toBe(false);
  });
});
