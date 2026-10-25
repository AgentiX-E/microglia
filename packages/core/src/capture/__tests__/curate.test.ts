import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { curateKnowledge, density } from '../curate.js';
import { openMicroglia } from '../index.js';

const AT = 1_700_000_000_000;

function item(id: string, statement: string, overrides: Partial<DistillCandidate> = {}): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

async function storeWith(items: readonly KnowledgeItem[]): Promise<EmbeddedMemory> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  return store;
}

describe('curation', () => {
  it('merges two phrasings of one rule and closes the loser', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart'),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report).toMatchObject({ scanned: 2, merged: 1, pruned: 0, dryRun: false });

    const after = await store.listKnowledge({ status: 'all' });
    const byId = new Map(after.map((entry) => [entry.id, entry]));
    expect(byId.get('k_2')?.status).toBe('retired');
    expect(byId.get('k_2')?.statusReason).toBe('merged:k_1');
    expect(byId.get('k_1')?.evidence).toHaveLength(2);
    await store.close();
  });

  it('never merges two claims whose payloads disagree', async () => {
    // Same words, different rule. Merging would let the survivor's payload
    // inherit the loser's evidence — the selection route, and it needs no
    // attacker beyond a paraphrase of a rule that was already there.
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.', {
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
      }),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart', {
        payload: { when: { intent: 'trend' }, then: { mark: 'pie' } },
      }),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report.merged).toBe(0);
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.every((entry) => entry.status !== 'retired')).toBe(true);
    await store.close();
  });

  it('still merges the same rule written twice with the same payload', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.', {
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
      }),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart', {
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
      }),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report.merged).toBe(1);
    await store.close();
  });

  it('is idempotent: a second pass has nothing to merge', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart'),
    ]);
    await curateKnowledge(store, defaultPolicy, AT + 10);
    const second = await curateKnowledge(store, defaultPolicy, AT + 20);
    expect(second.merged).toBe(0);
    await store.close();
  });

  it('never merges across scopes or kinds', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart.', {
        scope: { task: 'chart.recommend', domain: 'hr' },
      }),
      item('k_3', 'Revenue questions use a line chart rather than a bar chart.', { kind: 'lexicon' }),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report.merged).toBe(0);
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.every((entry) => entry.status !== 'retired')).toBe(true);
    await store.close();
  });

  it('writes nothing on a dry run but reports the same decision', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      item('k_2', 'Revenue questions use a line chart rather than a bar chart'),
    ]);
    const dry = await curateKnowledge(store, defaultPolicy, AT + 10, { dryRun: true });
    expect(dry).toMatchObject({ merged: 1, dryRun: true });
    const untouched = await store.listKnowledge({ status: 'all' });
    expect(untouched.every((entry) => entry.status !== 'retired')).toBe(true);
    await store.close();
  });

  it('reports the cap without pruning unless asked', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue uses a line chart.'),
      item('k_2', 'Revenue uses a stacked bar chart.'),
      item('k_3', 'Revenue uses a donut chart.'),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10, { maxItemsPerTask: 2 });
    expect(report).toMatchObject({ overCap: 1, cappedTasks: 1, pruned: 0 });
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.filter((entry) => entry.status === 'retired')).toHaveLength(0);
    await store.close();
  });

  it('prunes the lowest utility density first when asked', async () => {
    const good = item('k_1', 'Revenue uses a line chart.');
    const bad = item('k_3', 'Revenue uses a donut chart.');
    const store = await storeWith([
      { ...good, utility: { injected: 5, flippedUp: 5, flippedDown: 0 } },
      { ...bad, utility: { injected: 5, flippedUp: 0, flippedDown: 5 } },
      item('k_2', 'Revenue uses a stacked bar chart.'),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10, {
      maxItemsPerTask: 2,
      prune: true,
    });
    expect(report).toMatchObject({ pruned: 1, overCap: 0 });
    const after = await store.listKnowledge({ status: 'all' });
    const retired = after.filter((entry) => entry.status === 'retired');
    expect(retired.map((entry) => entry.id)).toEqual(['k_3']);
    expect(retired[0]?.statusReason).toBe('pruned:low-utility');
    // The interval is closed, so a question about the past can still find it.
    expect(retired[0]?.validUntil).toBe(AT + 10);
    await store.close();
  });

  it('breaks a density tie by id, so the same store prunes the same rule', async () => {
    // Two rules with equal utility are equally expensive to lose, and a comparator
    // that returned 0 for the tie would leave the outcome to the sort's stability.
    // Pruning must be reproducible from the store alone.
    const a = item('k_1', 'Revenue uses a line chart.');
    const b = item('k_2', 'Revenue uses a donut chart.');
    expect(density({ ...a, utility: { injected: 2, flippedUp: 1, flippedDown: 1 } })).toBe(
      density({ ...b, utility: { injected: 2, flippedUp: 1, flippedDown: 1 } }),
    );
    const c = item('k_3', 'Revenue uses a scatter chart.');
    // Newest first, so the bucket is listed k_3, k_2, k_1 and the comparator is
    // called with the smaller id on the left as well as on the right. A comparator
    // tested in one direction only is a comparator half verified.
    const store = await storeWith([
      { ...a, utility: { injected: 2, flippedUp: 1, flippedDown: 1 }, updatedAt: AT + 1 },
      { ...b, utility: { injected: 2, flippedUp: 1, flippedDown: 1 }, updatedAt: AT + 2 },
      { ...c, utility: { injected: 2, flippedUp: 1, flippedDown: 1 }, updatedAt: AT + 3 },
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10, {
      maxItemsPerTask: 1,
      prune: true,
    });
    // Three items, one survivor: the two lowest densities go, and the tie between
    // them is broken by id.
    expect(report.pruned).toBe(2);
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.filter((entry) => entry.status === 'retired').map((entry) => entry.id).sort()).toEqual([
      'k_1',
      'k_2',
    ]);
    await store.close();
  });

  it('rejects options that would silently do something else', async () => {
    const store = await storeWith([]);
    await expect(curateKnowledge(store, defaultPolicy, AT, { mergeThreshold: 0 })).rejects.toThrow(
      MicrogliaError,
    );
    await expect(
      curateKnowledge(store, defaultPolicy, AT, { maxItemsPerTask: 0 }),
    ).rejects.toThrow(/positive integer/);
    await store.close();
  });
});

describe('curation edges', () => {
  it('sums utility across a merge, including an item that has none yet', () => {
    const left = item('k_1', 'Revenue questions use a line chart.');
    const right = item('k_2', 'Revenue questions use a line chart');
    expect(
      density({ ...left, utility: { injected: 3, flippedUp: 2, flippedDown: 1 } }),
    ).toBeCloseTo(3 / 5, 6);
    // Without a utility record the applied/succeeded ledger is the fallback, so a
    // store written before this field existed keeps a meaningful density.
    expect(density({ ...left, applied: 4, succeeded: 1 })).toBeCloseTo(2 / 6, 6);
    expect(density(left)).toBeCloseTo(0.5, 6);
  });

  it('does not double count an event that both duplicates cite', async () => {
    // The evidence route of MemForm: swap part of a real history for fake
    // support. Two near-duplicate items citing one correction is exactly the
    // shape a duplicate comes in, and summing their supports would let one
    // user's single correction pay for two rules — and admit their sum.
    const shared = { feedbackId: 'fb_shared', runId: 'run_1', at: AT, weight: 0.9 };
    const own = { feedbackId: 'fb_own', runId: 'run_2', at: AT + 1, weight: 0.9 };
    const first = {
      ...item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      evidence: [own, shared],
      support: 1.8,
    };
    const second = {
      ...item('k_2', 'Revenue questions use a line chart rather than a bar chart'),
      evidence: [shared],
      support: 0.9,
    };
    const store = await storeWith([first, second]);
    await curateKnowledge(store, defaultPolicy, AT + 10);

    const merged = await store.getKnowledge('k_1');
    expect(merged?.evidence).toHaveLength(2);
    expect(merged?.support).toBeCloseTo(1.8, 6);
    // Canonical order: oldest observation first, so the array does not record
    // which duplicate happened to be written first.
    expect(merged?.evidence.map((entry) => entry.feedbackId)).toEqual(['fb_shared', 'fb_own']);
    await store.close();
  });

  it('produces the same store whichever duplicate was written first', async () => {
    const shared = { feedbackId: 'fb_shared', runId: 'run_1', at: AT, weight: 0.9 };
    const own = { feedbackId: 'fb_own', runId: 'run_2', at: AT + 1, weight: 0.9 };
    const first = {
      ...item('k_1', 'Revenue questions use a line chart rather than a bar chart.'),
      evidence: [shared, own],
      support: 1.8,
    };
    const second = {
      ...item('k_2', 'Revenue questions use a line chart rather than a bar chart'),
      evidence: [shared],
      support: 0.9,
    };
    const forward = await storeWith([first, second]);
    const backward = await storeWith([second, first]);
    await curateKnowledge(forward, defaultPolicy, AT + 10);
    await curateKnowledge(backward, defaultPolicy, AT + 10);

    expect(JSON.stringify(await forward.listKnowledge({ status: 'all' }))).toBe(
      JSON.stringify(await backward.listKnowledge({ status: 'all' })),
    );
    await forward.close();
    await backward.close();
  });

  it('orders merged evidence by id when two observations share a timestamp', async () => {
    // Two corrections can land on the same clock tick. Ordering them by arrival
    // would make a store's evidence depend on which request the network delivered
    // first, and the replay lane would then compare two equivalent stores unequal.
    const statement = 'Revenue questions use a line chart.';
    const later = { feedbackId: 'fb_z', runId: 'run_z', at: AT, weight: 0.9 };
    const earlier = { feedbackId: 'fb_a', runId: 'run_a', at: AT, weight: 0.9 };
    const store = await storeWith([
      { ...item('k_1', statement), evidence: [later] },
      { ...item('k_2', statement), evidence: [earlier] },
    ]);
    await curateKnowledge(store, defaultPolicy, AT + 10);
    const merged = (await store.listKnowledge({ status: 'all' }))[0];
    expect(merged?.evidence.map((entry) => entry.feedbackId)).toEqual(['fb_a', 'fb_z']);
    await store.close();
  });

  it('collapses punctuation and case variants, and counts every closure', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart.'),
      item('k_2', 'revenue questions use a line chart'),
      item('k_3', 'Revenue questions use a line chart!'),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report.merged).toBe(2);
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.filter((entry) => entry.status === 'retired')).toHaveLength(2);
    await store.close();
  });

  it('keeps a one-word variant separate, because the threshold is conservative', async () => {
    // Six shared tokens out of seven on each side is a dice of 0.83, below the 0.85
    // default: a plural suffix is not enough evidence that two rules are one. The
    // threshold is a knob for exactly this reason, and the cost of guessing wrong is
    // asymmetric -- a wrong merge loses a rule, a missed merge costs a duplicate.
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart.'),
      item('k_2', 'Revenue questions use a line charts.'),
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(report.merged).toBe(0);
    const lowered = await curateKnowledge(store, defaultPolicy, AT + 10, { mergeThreshold: 0.8 });
    expect(lowered.merged).toBe(1);
    await store.close();
  });

  it('narrows by namespace and task when asked', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart.'),
      item('k_2', 'Revenue questions use a line chart'),
    ]);
    const wrongTask = await curateKnowledge(store, defaultPolicy, AT + 10, { task: 'other.task' });
    expect(wrongTask.scanned).toBe(0);
    const wrongNamespace = await curateKnowledge(store, defaultPolicy, AT + 10, {
      namespace: 'other',
    });
    expect(wrongNamespace.scanned).toBe(0);
    const scoped = await curateKnowledge(store, defaultPolicy, AT + 10, {
      namespace: 'acme',
      task: 'chart.recommend',
    });
    expect(scoped.merged).toBe(1);
    await store.close();
  });

  it('prunes by the applied ledger when no utility was ever recorded', async () => {
    const store = await storeWith([
      { ...item('k_1', 'Revenue uses a line chart.'), applied: 5, succeeded: 5 },
      { ...item('k_2', 'Revenue uses a stacked bar.'), applied: 5, succeeded: 0 },
    ]);
    const report = await curateKnowledge(store, defaultPolicy, AT + 10, {
      maxItemsPerTask: 1,
      prune: true,
    });
    expect(report.pruned).toBe(1);
    const after = await store.listKnowledge({ status: 'all' });
    expect(after.find((entry) => entry.status === 'retired')?.id).toBe('k_2');
    await store.close();
  });

  it('merges across several scope groups in a deterministic order', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart.'),
      item('k_2', 'Revenue questions use a line chart'),
      item('k_3', 'Headcount questions use a bar chart.', {
        scope: { task: 'chart.recommend', domain: 'hr' },
      }),
      item('k_4', 'Headcount questions use a bar chart', {
        scope: { task: 'chart.recommend', domain: 'hr' },
      }),
    ]);
    const first = await curateKnowledge(store, defaultPolicy, AT + 10);
    expect(first.merged).toBe(2);
    const after = await store.listKnowledge({ status: 'all' });
    const retired = after.filter((entry) => entry.status === 'retired').map((entry) => entry.id);
    expect(retired.sort()).toEqual(['k_2', 'k_4']);
    await store.close();
  });

  it('sums two utility records when both sides have one', async () => {
    const store = await storeWith([
      {
        ...item('k_1', 'Revenue questions use a line chart.'),
        utility: { injected: 2, flippedUp: 1, flippedDown: 1 },
      },
      {
        ...item('k_2', 'Revenue questions use a line chart'),
        utility: { injected: 3, flippedUp: 3, flippedDown: 0 },
      },
    ]);
    await curateKnowledge(store, defaultPolicy, AT + 10);
    const after = await store.listKnowledge({ status: 'all' });
    const survivor = after.find((entry) => entry.id === 'k_1');
    expect(survivor?.utility).toEqual({ injected: 5, flippedUp: 4, flippedDown: 1 });
    await store.close();
  });

  it('is reachable from the facade, scoped to its namespace', async () => {
    const store = await storeWith([
      item('k_1', 'Revenue questions use a line chart.'),
      item('k_2', 'Revenue questions use a line chart'),
    ]);
    const mg = await openMicroglia({ app: 'acme', namespace: 'acme', store });
    const report = await mg.curate();
    expect(report).toMatchObject({ scanned: 2, merged: 1 });
    await mg.close();
  });
});

describe('utility counters', () => {
  it('counts a chance every time an outcome lands on a cited rule', async () => {
    const store = await storeWith([item('k_1', 'Revenue questions use a line chart.')]);
    const mg = await openMicroglia({ app: 'acme', namespace: 'acme', store });

    const pack = await mg.recall({
      task: 'chart.recommend',
      text: 'monthly revenue trend',
      scope: { domain: 'sales' },
    });
    expect(pack.ids).toEqual(['k_1']);

    const accepted = mg.begin({ task: 'chart.recommend', input: { q: 1 }, pack });
    await accepted.complete({ mark: 'line' });
    await accepted.outcome(true);

    const rejected = mg.begin({ task: 'chart.recommend', input: { q: 2 }, pack });
    await rejected.complete({ mark: 'line' });
    await rejected.outcome(false, 'E_STYLE');

    const [entry] = await store.listKnowledge({ status: 'all' });
    expect(entry?.utility).toEqual({ injected: 2, flippedUp: 1, flippedDown: 1 });
    expect(density(entry as KnowledgeItem)).toBeCloseTo(2 / 4, 6);
    await mg.close();
  });
});

describe('the corroboration report', () => {
  it('counts what was observed twice and nothing that cannot be injected', async () => {
    const once = item('k_1', 'Revenue questions use a line chart.');
    const twice = {
      ...item('k_2', 'Break revenue down by region.'),
      evidence: [
        { feedbackId: 'fb_2a', runId: 'run_2', at: AT, weight: 0.9 },
        { feedbackId: 'fb_2b', runId: 'run_3', at: AT + 1, weight: 0.9 },
      ],
      support: 1.8,
    } as KnowledgeItem;
    const retired = {
      ...item('k_3', 'Churn questions use a bar chart.'),
      status: 'retired' as const,
      evidence: twice.evidence,
    } as KnowledgeItem;

    const store = await storeWith([once, twice, retired]);
    const mg = await openMicroglia({ app: 'acme', namespace: 'acme', store });
    // The number a host checks before trusting a pack: half the active store here is
    // corroborated, and the retired rule - which cannot reach a prompt - is not counted.
    expect(await mg.corroboration()).toEqual({ active: 2, corroborated: 1, share: 0.5 });
    await mg.close();
  });
});
