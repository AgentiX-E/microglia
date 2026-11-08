import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  queryCoverage,
  recallText,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';

/**
 * R51: a rule is recalled by its condition, not only by its statement.
 *
 * `when` was added in iteration 62 for the reason the field's own comment gives —
 * "a statement records what was true; it says nothing about when it is true" —
 * and the renderer has printed it ahead of the statement since. Recall never
 * followed. The lexical index built its document from `statement`, `kind` and the
 * scope; the coverage gate measured against `statement` alone; MMR diversified on
 * `statement`. All three had decided, separately, that half a rule is the whole
 * rule.
 *
 * The cost is not hypothetical. On the R49 dispatch the store held ten rules, all
 * ten servable, and 38% of 1,528 requests were served an empty pack. Those rules
 * read "A request of this shape is resolved by calling find_user, then
 * cancel_pending_order, in that order" — a statement that shares no term with any
 * question a person asks, and a condition that had already been thrown away twice.
 */

const at = 1_700_000_000_000;

function item(
  statement: string,
  id: string,
  when?: string,
): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'sql.generate', domain: 'shop' },
    statement,
    ...(when === undefined ? {} : { when }),
    evidence: { feedbackId: `fb_${id}`, runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

/**
 * A rule of the shape the τ² lane actually wrote: the statement names tool calls
 * and nothing else; the condition names the situation, in the question's words.
 */
const TOOL_ONLY =
  'A request of this shape is resolved by calling find_user, then cancel_pending_order, in that sequence.';
// Chosen so that not one of the question's terms occurs in the statement: the
// real τ² statements ended "in that order", and the word `order` alone lifted a
// tool-only rule's coverage to 0.25 — enough to clear any floor the lane has ever
// tested, which is why a 0.01 floor measured as free in R49.
const CONDITION = 'the customer asks to cancel a shipment that has not left the warehouse';

async function storeWithCondition(): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putKnowledge(item(TOOL_ONLY, 'conditioned', CONDITION));
  await memory.putKnowledge(item(TOOL_ONLY, 'unconditioned'));
  return memory;
}

const question = {
  task: 'sql.generate',
  text: 'cancel a shipment that has not left the warehouse',
  namespace: 'acme',
  scope: { domain: 'shop' },
};

describe('recallText — the one definition of what a rule says', () => {
  it('is the statement alone when the rule states no condition', () => {
    expect(recallText({ statement: 's' })).toBe('s');
  });

  it('is the statement alone when the condition is an empty string', () => {
    // An empty condition is not a condition. Keeping the separator would put a
    // stray space in the document and, worse, make "has a condition" untestable
    // by length.
    expect(recallText({ statement: 's', when: '' })).toBe('s');
  });

  it('puts the condition first, where the renderer puts it', () => {
    expect(recallText({ statement: 's', when: 'w' })).toBe('w s');
  });
});

describe('the coverage gate reads the condition', () => {
  it('keeps a rule whose condition names the question, though its statement names nothing', async () => {
    const memory = await storeWithCondition();
    const pack = await buildPack({ ...question, minCoverage: 0.5 }, { memory });
    expect(pack.ids).toEqual(['conditioned']);
    await memory.close();
  });

  it('gives the unconditioned rule the zero coverage it earns, rather than a share of its neighbour', async () => {
    const memory = await storeWithCondition();
    const pack = await buildPack({ ...question, minCoverage: 0.01 }, { memory });
    // Both rules are in scope and both carry the same statement; only the one
    // with a condition mentions the question at all.
    expect(pack.ids).toEqual(['conditioned']);
    await memory.close();
  });

  it('still injects both when no floor is asked for, so the fix is the floor and not a filter', async () => {
    const memory = await storeWithCondition();
    const pack = await buildPack(question, { memory });
    expect(pack.ids.sort()).toEqual(['conditioned', 'unconditioned']);
    await memory.close();
  });

  it('measures coverage against the condition, and the statement alone measures zero', () => {
    expect(queryCoverage(question.text, recallText({ statement: TOOL_ONLY, when: CONDITION }))).toBe(1);
    expect(queryCoverage(question.text, TOOL_ONLY)).toBe(0);
  });
});

describe('the lexical index reads the condition', () => {
  it('ranks the conditioned rule first on a word only its condition carries', async () => {
    const memory = await storeWithCondition();
    // Scope is an index, not a filter: both rules come back because both are
    // active in the asked scope and rank is what the scope branch promises. What
    // the condition changes is the order, and the order is what `buildPack` turns
    // into a pack under a limit.
    const hits = await memory.search({ ...question, text: 'warehouse', limit: 10 });
    expect(hits.map((hit) => hit.item.id)).toEqual(['conditioned', 'unconditioned']);
    expect(hits[0]?.lexical ?? 0).toBeGreaterThan(0);
    expect(hits[1]?.lexical ?? 0).toBe(0);
    await memory.close();
  });

  it('reads the condition from the index and not from the statement, which carries none of the words', async () => {
    const memory = await storeWithCondition();
    const hits = await memory.search({ ...question, text: 'warehouse', limit: 10 });
    const statements = hits.map((hit) => hit.item.statement);
    expect(new Set(statements)).toEqual(new Set([TOOL_ONLY]));
    await memory.close();
  });
});
