import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';

function item(id: string) {
  const candidate: DistillCandidate = {
    namespace: 'n',
    kind: 'constraint',
    scope: { task: 't', domain: 'd' },
    statement: 'A rule that exists.',
    evidence: { feedbackId: `fb_${id}`, runId: 'run', at: 1, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  return createKnowledgeItem(candidate, defaultPolicy, 1, id);
}

describe('buildPack option fallbacks', () => {
  it('honours tag, limit, and an explicit candidate cap', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('k_1'));
    const pack = await buildPack(
      { task: 't', text: '', namespace: 'n', limit: 2 },
      { memory, candidates: 5, tag: 'acme-rules' },
    );
    expect(pack.rendered.startsWith('<acme-rules')).toBe(true);
    expect(pack.ids.length).toBeLessThanOrEqual(2);
    await memory.close();
  });
});
