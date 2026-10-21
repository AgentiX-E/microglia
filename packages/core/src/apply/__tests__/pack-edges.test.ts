import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';

describe('pack defaults', () => {
  it('falls back to the query budget, then to 1200 characters, and to eight items', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    const fromQuery = await buildPack(
      { task: 't', text: '', namespace: 'n', budget: 300 },
      { memory },
    );
    expect(fromQuery.budget).toBe(300);

    const fallback = await buildPack({ task: 't', text: '', namespace: 'n' }, { memory });
    expect(fallback.budget).toBe(1200);
    expect(fallback.ids).toEqual([]);

    const limited = await buildPack(
      { task: 't', text: '', namespace: 'n', limit: 3 },
      { memory, candidates: 20 },
    );
    expect(limited.ids.length).toBeLessThanOrEqual(3);
    await memory.close();
  });
});
