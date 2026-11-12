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

function itemLearnedAt(attempt: number | undefined, id = 'k_1'): KnowledgeItem {
  return createKnowledgeItem(
    {
      namespace: 'acme',
      kind: 'constraint',
      scope: { task: 'retail.1', domain: 'retail' },
      statement: 'Ask for the order id before reading the exchange policy.',
      evidence: {
        feedbackId: 'fb_1',
        runId: 'run_1',
        at: now,
        weight: 0.9,
        ...(attempt === undefined ? {} : { attempt }),
      },
      trust: 0.9,
      dedupeKey: `k-${String(attempt)}-${id}`,
    },
    defaultPolicy,
    now,
    id,
  );
}

function itemWith(evidence: readonly EvidenceRef[], id = 'k_1'): KnowledgeItem {
  return { ...itemLearnedAt(1, id), evidence, support: evidence.reduce((sum, e) => sum + e.weight, 0) };
}

describe('the attempt watermark', () => {
  it('serves everything when no watermark is asked for', () => {
    // Every offline arm recalls this way, and an upgrade must not change what a published number
    // measured: absence of the watermark is absence of the question, not "before 1".
    expect(visibleBefore(itemLearnedAt(9), undefined)).toBe(true);
  });

  it('withholds a claim learned by the attempt that is running', () => {
    // The one property the arm exists for. A claim distilled from attempt 2's failure cannot be in
    // attempt 2's pack, or the reading is leakage wearing accumulation's name.
    expect(visibleBefore(itemLearnedAt(2), 2)).toBe(false);
  });

  it('withholds a claim learned by a later attempt', () => {
    // Monotonic, not equality: a concurrent writer that lands attempt 3's record while attempt 2 is
    // still recalling must not be readable either.
    expect(visibleBefore(itemLearnedAt(3), 2)).toBe(false);
  });

  it('serves a claim learned by an earlier attempt', () => {
    expect(visibleBefore(itemLearnedAt(1), 2)).toBe(true);
  });

  it('sees a claim whose evidence declares no attempt at all', () => {
    // An item distilled offline predates the episode: it learned from no attempt, so every attempt
    // may read it. Reading absence as "the latest attempt" would empty every mixed store.
    expect(visibleBefore(itemLearnedAt(undefined), 1)).toBe(true);
  });

  it('withholds a merged claim that carries one observation from the running attempt', () => {
    // The rule is `every`, not `some`: an item that cites attempts 1 and 3 taught the model something
    // attempt 3 said, and the pack serves the item, not the reference.
    const merged = itemWith([ref({ attempt: 1 }), ref({ feedbackId: 'fb_2', attempt: 3 })]);
    expect(visibleBefore(merged, 3)).toBe(false);
  });

  it('serves a merged claim whose observations are all earlier', () => {
    const merged = itemWith([ref({ attempt: 1 }), ref({ feedbackId: 'fb_2', attempt: 2 })]);
    expect(visibleBefore(merged, 3)).toBe(true);
  });

  it('serves a claim with no evidence, because it cannot have learned from an attempt', () => {
    expect(visibleBefore(itemWith([]), 1)).toBe(true);
  });

  it('treats the first attempt as a real watermark and not as an absent one', () => {
    // `1` is the first attempt, and a store learned by it must be invisible to it. An `if (before)`
    // shortcut happens to pass this case, so the boundary is pinned on both sides of it.
    expect(visibleBefore(itemLearnedAt(1), 1)).toBe(false);
    expect(visibleBefore(itemLearnedAt(1), 2)).toBe(true);
  });

  it('does not treat a watermark of 0 as an absent one', () => {
    // `0` is not a valid attempt number for a 1-based host, and the predicate must still not special-
    // case it: as a watermark it serves exactly the claims that declare nothing, which is what `<`
    // says and what "before every attempt" means. Coercing it to `undefined` would be the shortcut
    // that turns a filter into a pass, and the wire refuses it for the same reason.
    expect(visibleBefore(itemLearnedAt(1), 0)).toBe(false);
    expect(visibleBefore(itemLearnedAt(undefined), 0)).toBe(true);
  });
});
