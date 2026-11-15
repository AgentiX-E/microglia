/**
 * The unit a request asks for, and the vocabulary only the host can supply.
 *
 * These two fields travel separately — `query.shape` is the request's, `options.shapeOf` is the host's —
 * and the pair was never exercised through `openMicroglia`, which is the path the τ² driver actually
 * takes: it declares a shape extractor on the host and then asks per request for `collapse` or
 * `per-failure` over one store. The two-unit arm R109 and R120 ran depends on both halves arriving, so a
 * test that skips the host layer would pass on a lane where the switch was inert.
 */
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia } from '../index.js';

const AT = 1_700_000_000_000;

function item(id: string, statement: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.return', domain: 'retail' },
    statement,
    // One ref, and its own task: a candidate carries exactly one `evidence`, because one correction is
    // one record (`createKnowledgeItem` wraps it in the array). Support therefore only accrues across
    // *items*, which is why the store below is two records and the group's support is two -- the floor
    // is in distinct tasks, and a single item cannot meet it no matter how it is written.
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9, taskId: `t_${id}` },
    trust: 0.9,
    dedupeKey: `k_${id}`,
  };
  return { ...createKnowledgeItem(candidate, defaultPolicy, AT, id), status: 'active' };
}

const STORE = [
  item('k_1', 'A return action carries the item ids being returned for the order.'),
  item('k_2', 'A return action carries the order ids of the item.'),
];

const QUERY = { task: 'retail.return', text: 'return the item on this order and refund the customer' };

async function hostWith(shapeOf?: (entry: KnowledgeItem) => string | undefined) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of STORE) await store.putKnowledge(entry);
  return openMicroglia({
    app: 'acme',
    namespace: 'acme',
    store,
    ...(shapeOf === undefined ? {} : { shapeOf }),
  });
}

const routineOf = (): string => 'return_action';

describe('the unit is the request’s and the vocabulary is the host’s', () => {
  it('folds when the host can name a shape and the request asks for one', async () => {
    const mg = await hostWith(routineOf);
    const pack = await mg.recall({ ...QUERY, shape: 'collapse' });
    expect(pack.fold?.folded).toBe(1);
    expect(pack.fold?.groups).toHaveLength(1);
    // Two records, two tasks: the floor is met by the *store*, not by the sentence.
    expect(pack.fold?.groups[0]?.support).toBe(2);
    expect(pack.ids).toHaveLength(1);
  });

  it('reports the census without folding when the request asks for the other unit', async () => {
    // The same store, the same ranking, one line different: the control's own `atLeastTwo` becomes a
    // reading instead of an absence, which is what makes the two arms one experiment.
    const mg = await hostWith(routineOf);
    const pack = await mg.recall({ ...QUERY, shape: 'per-failure' });
    expect(pack.fold?.folded).toBe(0);
    expect(pack.fold?.groups).toEqual([]);
    expect(pack.ids).toHaveLength(2);
  });

  it('folds nothing when the host cannot name a shape, however the request is spelled', async () => {
    // The request's half without the host's is a switch with no vocabulary behind it, and the honest
    // reading of a host that never asked is no census at all rather than an empty one.
    const mg = await hostWith();
    const pack = await mg.recall({ ...QUERY, shape: 'collapse' });
    expect(pack.fold).toBeUndefined();
    expect(pack.ids.length).toBeGreaterThan(0);
  });
});
