/**
 * The facade, tested over real HTTP, because the defect it exists to catch was a boundary defect.
 *
 * R109 found that this handler read `task` and `text` and dropped every other pair. The treatment knob
 * for the shape arm — and, before it, the four knobs of the prefix arm — therefore died one process away
 * from the pack that was supposed to honour them, and nothing failed: the run served a pack, the
 * artefact recorded a mode, and the two disagreed. Only a request that crosses the boundary can tell.
 *
 * So each test below starts the server, sends a query, and reads what the callback was told. No mocks:
 * the callback is a real function and the transport is a real socket on port 0.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startRecallFacade, type Facade } from '../tau2-facade.js';

let facade: Facade | undefined;

afterEach(async () => {
  await facade?.close();
  facade = undefined;
});

type Seen = { task: string; text: string; query: Record<string, unknown> };

/** Start the facade with a callback that records what it was handed and answers one fixed block. */
async function serve(): Promise<{ seen: Seen[]; url: string }> {
  const seen: Seen[] = [];
  facade = await startRecallFacade(
    async ({ task, text, query }) => {
      seen.push({ task, text, query: { ...query } });
      return { rendered: '<microglia-knowledge version="1" note="" items="0"></microglia-knowledge>' };
    },
    { task: 'tau2.act' },
  );
  return { seen, url: facade.url };
}

describe('the recall facade', () => {
  it('carries the shape knob to the pack it serves', async () => {
    const { seen, url } = await serve();
    const response = await fetch(`${url}/v1/recall?task=tau2.act&text=cancel&shape=collapse`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rendered: expect.stringContaining('microglia-knowledge') });
    expect(seen[0]?.query).toEqual({ shape: 'collapse' });
  });

  it('carries every knob of the prefix arm at once', async () => {
    const { seen, url } = await serve();
    await fetch(
      `${url}/v1/recall?task=tau2.act&text=cancel&anchoring=scope&minCoverage=0&limit=999&budget=200000`,
    );
    expect(seen[0]?.query).toEqual({
      anchoring: 'scope',
      minCoverage: 0,
      limit: 999,
      budget: 200000,
    });
  });

  it('keeps the two required fields separate from the knobs', async () => {
    const { seen, url } = await serve();
    // The session's own `domain` is a knob by parse and not by decision: the driver overrides the scope,
    // and this test pins that the facade does not silently drop it before the callback can decide.
    await fetch(`${url}/v1/recall?task=retail&text=where+is+my+order&domain=retail&shape=per-failure`);
    expect(seen[0]?.task).toBe('retail');
    expect(seen[0]?.text).toBe('where is my order');
    expect(seen[0]?.query).toEqual({ shape: 'per-failure' });
  });

  it('refuses a knob it cannot honour, with the reason rather than a 500', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/v1/recall?task=tau2.act&text=cancel&shape=merge`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'shape is not one of per-failure, collapse' });
  });

  it('answers 404 on any other path, rather than serving a pack from a typo', async () => {
    const { url } = await serve();
    expect((await fetch(`${url}/v1/recall2?text=x`)).status).toBe(404);
  });

  it('assumes the lane\'s task label when the request names none', async () => {
    const { seen, url } = await serve();
    await fetch(`${url}/v1/recall?text=cancel`);
    expect(seen[0]?.task).toBe('tau2.act');
  });

  it('defaults a request that states no text to an empty query', async () => {
    const { seen, url } = await serve();
    expect((await fetch(`${url}/v1/recall?task=tau2.act`)).status).toBe(200);
    expect(seen[0]?.text).toBe('');
    expect(seen[0]?.query).toEqual({});
  });

  it('turns a callback that throws into a 500, which is the reading of an unreachable sidecar', async () => {
    facade = await startRecallFacade(async () => {
      throw new Error('store closed');
    }, { task: 'tau2.act' });
    const response = await fetch(`${facade.url}/v1/recall?text=x`);
    expect(response.status).toBe(500);
  });
});
