import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  visibleBefore,
  type EvidenceRef,
  type KnowledgeItem,
} from '../index.js';

const now = 1_700_000_000_000;

function ref(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return { feedbackId: 'fb_1', runId: 'run_1', at: now, weight: 0.9, ...overrides };
}

function itemWrittenAt(trial: number | undefined, id = 'k_1'): KnowledgeItem {
  return createKnowledgeItem(
    {
      namespace: 'acme',
      kind: 'constraint',
      scope: { task: 'retail.1', domain: 'retail' },
      statement: 'Ask for the order id before reading the exchange policy.',
      evidence: { feedbackId: 'fb_1', runId: 'run_1', at: now, weight: 0.9, ...(trial === undefined ? {} : { trial }) },
      trust: 0.9,
      dedupeKey: `k-${String(trial)}-${id}`,
    },
    defaultPolicy,
    now,
    id,
  );
}

function itemWith(evidence: readonly EvidenceRef[], id = 'k_1'): KnowledgeItem {
  return { ...itemWrittenAt(0, id), evidence, support: evidence.reduce((sum, e) => sum + e.weight, 0) };
}

describe('the in-episode watermark', () => {
  it('serves everything when no watermark is asked for', () => {
    // Every offline arm recalls this way, and an upgrade must not change what a published number
    // measured: absence of the watermark is absence of the question, not a zero.
    expect(visibleBefore(itemWrittenAt(9), undefined)).toBe(true);
  });

  it('withholds a claim written by the trial that is running', () => {
    // The one property the arm exists for. A claim distilled from trial 2's failure cannot be in
    // trial 2's pack, or the reading is leakage wearing accumulation's name.
    expect(visibleBefore(itemWrittenAt(2), 2)).toBe(false);
  });

  it('withholds a claim written by a later trial', () => {
    // Monotonic, not equality: a concurrent writer that lands trial 3's record while trial 2 is
    // still recalling must not be readable either.
    expect(visibleBefore(itemWrittenAt(3), 2)).toBe(false);
  });

  it('serves a claim written by an earlier trial', () => {
    expect(visibleBefore(itemWrittenAt(1), 2)).toBe(true);
  });

  it('sees a claim whose evidence declares no trial at all', () => {
    // An item distilled offline predates the episode: it never learned from any trial, so every
    // trial may read it. Reading absence as "the last trial" would empty every mixed store.
    expect(visibleBefore(itemWrittenAt(undefined), 1)).toBe(true);
  });

  it('withholds a merged claim that carries one observation from the running trial', () => {
    // The rule is `every`, not `some`: an item that cites trial 2 alongside trial 0 taught the
    // model something trial 2 said, and the pack is the item, not the reference.
    const merged = itemWith([ref({ trial: 0 }), ref({ feedbackId: 'fb_2', trial: 2 })]);
    expect(visibleBefore(merged, 2)).toBe(false);
  });

  it('serves a merged claim whose observations are all earlier', () => {
    const merged = itemWith([ref({ trial: 0 }), ref({ feedbackId: 'fb_2', trial: 1 })]);
    expect(visibleBefore(merged, 2)).toBe(true);
  });

  it('serves a claim with no evidence, because it cannot have learned from a trial', () => {
    expect(visibleBefore(itemWith([]), 1)).toBe(true);
  });

  it('treats trial 0 as a trial and not as an absent watermark', () => {
    // `0` is falsy and this is exactly where that kind of shortcut would hide: a store written by
    // the first attempt would read as an offline store and leak into the first attempt.
    expect(visibleBefore(itemWrittenAt(0), 0)).toBe(false);
    expect(visibleBefore(itemWrittenAt(0), 1)).toBe(true);
  });
});
