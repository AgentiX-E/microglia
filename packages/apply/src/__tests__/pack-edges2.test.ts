import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { buildPack } from '../pack.js';

describe('buildPack option fallbacks', () => {
  it('honours tag, limit, and an explicit candidate cap', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    const pack = await buildPack(
      { task: 't', text: '', namespace: 'n', limit: 2 },
      { memory, candidates: 5, tag: 'acme-rules' },
    );
    expect(pack.rendered.startsWith('<acme-rules')).toBe(true);
    expect(pack.ids.length).toBeLessThanOrEqual(2);
    await memory.close();
  });
});
