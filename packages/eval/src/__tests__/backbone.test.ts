import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  catalogueIdsOf,
  catalogueLine,
  catalogueNoteOf,
  catalogueVerdictOf,
  modelsUrlOf,
  probeBackbone,
} from '../backbone.js';

type Answer = { readonly status: number; readonly body?: unknown; readonly text?: string };

/** A fetch that answers from a script, and records what it was asked. */
function scripted(answer: Answer | Error): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (answer instanceof Error) throw answer;
    return new Response(answer.text ?? JSON.stringify(answer.body ?? null), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

const listing = (...ids: string[]): Answer => ({
  status: 200,
  body: { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) },
});

describe('modelsUrlOf', () => {
  it('reads the catalogue from the lane default when no endpoint was named', () => {
    // The lane's own default is what every published run called, so a probe that had to be told the
    // host separately would be a second place to leave unset.
    expect(modelsUrlOf('')).toBe('https://api.deepseek.com/models');
  });

  it('puts /models beside /chat/completions, keeping the host', () => {
    expect(modelsUrlOf('https://open.bigmodel.cn/api/paas/v4/chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/models',
    );
  });

  it('tolerates a trailing slash and drops a query string', () => {
    expect(modelsUrlOf('https://api.deepseek.com/chat/completions/?api-version=2')).toBe(
      'https://api.deepseek.com/models',
    );
  });

  it('refuses to invent a catalogue for an endpoint that is not chat-shaped', () => {
    // Guessing `../models` for an arbitrary path would produce an `absent` verdict about an address
    // nobody serves, which is the one failure mode this module exists to avoid.
    expect(modelsUrlOf('https://api.deepseek.com/v1/completions')).toBeUndefined();
    expect(modelsUrlOf('not a url')).toBeUndefined();
  });
});

describe('catalogueIdsOf', () => {
  it('reads the OpenAI shape and keeps the ids', () => {
    expect(catalogueIdsOf({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['a', 'b']);
  });

  it('accepts bare strings and removes a repeat', () => {
    expect(catalogueIdsOf({ data: ['a', 'a', 'c'] })).toEqual(['a', 'c']);
  });

  it('reads an empty catalogue as empty rather than as nothing', () => {
    // The difference matters: `[]` is "this host serves no model", `undefined` is "this is not a
    // catalogue", and only the second one may be reported as unlistable.
    expect(catalogueIdsOf({ data: [] })).toEqual([]);
  });

  it('rejects a payload that is not a catalogue', () => {
    expect(catalogueIdsOf(null)).toBeUndefined();
    expect(catalogueIdsOf('data')).toBeUndefined();
    expect(catalogueIdsOf({ models: ['a'] })).toBeUndefined();
    expect(catalogueIdsOf({ data: [{ id: 7 }] })).toBeUndefined();
    expect(catalogueIdsOf({ data: [{ object: 'model' }] })).toBeUndefined();
    expect(catalogueIdsOf({ data: [{ id: '  ' }] })).toBeUndefined();
    expect(catalogueIdsOf({ data: [42] })).toBeUndefined();
  });
});

describe('catalogueVerdictOf', () => {
  it('compares the id that is actually sent', () => {
    // The τ² lane configures `deepseek/deepseek-chat` and sends `deepseek-chat`; a catalogue lists the
    // second. Comparing the configured spelling would report every τ² dispatch as absent.
    expect(catalogueVerdictOf('deepseek/deepseek-chat', ['deepseek-chat'])).toBe('listed');
    expect(catalogueVerdictOf('deepseek/deepseek-chat', ['deepseek-flash'])).toBe('absent');
  });
});

describe('probeBackbone', () => {
  it('says listed and carries both spellings of the model', async () => {
    const { fetchImpl, asked } = scripted(listing('deepseek-flash', 'deepseek-chat'));
    const reading = await probeBackbone({
      endpoint: '',
      model: 'deepseek/deepseek-flash',
      apiKey: 'k',
      fetchImpl,
    });
    expect(reading.verdict).toBe('listed');
    expect(reading.model).toBe('deepseek-flash');
    expect(reading.configured).toBe('deepseek/deepseek-flash');
    expect(reading.models).toEqual(['deepseek-chat', 'deepseek-flash']);
    expect(reading.why).toBe('the host lists deepseek-flash among 2 model(s)');
    expect(asked).toEqual(['https://api.deepseek.com/models']);
  });

  it('says absent and keeps the served list, which is what the refusal prints', async () => {
    const { fetchImpl } = scripted(listing('deepseek-chat'));
    const reading = await probeBackbone({
      endpoint: '',
      model: 'deepseek-flash',
      apiKey: 'k',
      fetchImpl,
    });
    expect(reading.verdict).toBe('absent');
    expect(reading.models).toEqual(['deepseek-chat']);
    expect(reading.why).toBe('the host lists 1 model(s) and not deepseek-flash');
  });

  it('calls an HTTP error unlistable, because a host owes no catalogue', async () => {
    const { fetchImpl } = scripted({ status: 404 });
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue answered HTTP 404');
  });

  it('calls a refused key unlistable rather than absent, because the two are indistinguishable here', async () => {
    // A `401` is a bad credential ten seconds after dispatch instead of at the four-hundredth call, and
    // that is worth the request — but this module cannot tell it from a host that authenticates nothing
    // on `/models`, so it may not refuse the run on it.
    const { fetchImpl } = scripted({ status: 401 });
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
  });

  it('calls a body that is not JSON unlistable', async () => {
    const { fetchImpl } = scripted({ status: 200, text: '<html>nope</html>' });
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue answered with something that is not JSON');
  });

  it('calls JSON without a list of ids unlistable, which is the parser being wrong not the host', async () => {
    const { fetchImpl } = scripted({ status: 200, body: { models: ['m'] } });
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue answered JSON without a list of model ids');
  });

  it('calls a timeout unlistable and names it', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const { fetchImpl } = scripted(timeout);
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue did not answer (TimeoutError)');
  });

  it('names the rejection it got when the error carries no better label', async () => {
    const { fetchImpl } = scripted(new Error('socket hang up'));
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue did not answer (Error)');
  });

  it('survives a rejection that is not an Error at all, which is what a broken transport throws', async () => {
    const fetchImpl = (() => Promise.reject('boom')) as unknown as typeof fetch;
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.why).toBe('the catalogue did not answer (unknown)');
  });

  it('asks nothing when the endpoint has no derivable catalogue, and says why', async () => {
    const { fetchImpl, asked } = scripted(listing('m'));
    const reading = await probeBackbone({
      endpoint: 'https://api.deepseek.com/v1/completions',
      model: 'm',
      apiKey: 'k',
      fetchImpl,
    });
    expect(reading.verdict).toBe('unlistable');
    expect(reading.url).toBe('');
    expect(reading.why).toBe(
      'the endpoint is not an OpenAI-shaped chat endpoint, so its catalogue has no derivable address',
    );
    expect(asked).toEqual([]);
  });

  it('sends the credential it was given and nothing else', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(`${init?.method ?? 'GET'} ${headers.get('authorization') ?? ''}`);
      return new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await probeBackbone({ endpoint: '', model: 'm', apiKey: 'secret', fetchImpl });
    expect(seen).toEqual(['GET Bearer secret']);
  });

  it('reads a real host through the global fetch, which is the path a dispatch takes', async () => {
    // The injected form is the one every other case drives, and a default that crashed would stay
    // green behind it — so one case runs the shipped path against a server on this machine.
    const server = createServer((request, response) => {
      expect(request.url).toBe('/models');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'only-model' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const reading = await probeBackbone({
        endpoint: `http://127.0.0.1:${String(port)}/chat/completions`,
        model: 'only-model',
        apiKey: 'k',
      });
      expect(reading.verdict).toBe('listed');
      expect(reading.url).toBe(`http://127.0.0.1:${String(port)}/models`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('catalogueLine', () => {
  it('names the verdict, the reason and what was served', async () => {
    const { fetchImpl } = scripted(listing('a', 'b', 'c'));
    const reading = await probeBackbone({ endpoint: '', model: 'd', apiKey: 'k', fetchImpl });
    expect(catalogueLine(reading, 2)).toBe(
      '[backbone] absent — the host lists 3 model(s) and not d served: a, b … and 1 more',
    );
  });

  it('prints no served list when nothing was served', () => {
    expect(
      catalogueLine({
        model: 'm',
        configured: 'm',
        verdict: 'unlistable',
        url: '',
        models: [],
        why: 'no credential',
      }),
    ).toBe('[backbone] unlistable — no credential');
  });
});

describe('catalogueNoteOf', () => {
  const scratch = (): string => mkdtempSync(join(tmpdir(), 'backbone-note-'));

  it('reports unprobed when no probe ran, which is what every earlier artefact is', () => {
    expect(catalogueNoteOf(null)).toEqual({
      verdict: 'unprobed',
      model: '',
      listed: 0,
      why: 'no catalogue probe ran for this dispatch',
    });
    expect(catalogueNoteOf('  ').verdict).toBe('unprobed');
  });

  it('reads the note back from the file the probe wrote', async () => {
    const { fetchImpl } = scripted(listing('m', 'n'));
    const reading = await probeBackbone({ endpoint: '', model: 'm', apiKey: 'k', fetchImpl });
    const file = join(scratch(), 'probe.json');
    writeFileSync(file, JSON.stringify(reading));
    expect(catalogueNoteOf(file)).toEqual({
      verdict: 'listed',
      model: 'm',
      listed: 2,
      why: 'the host lists m among 2 model(s)',
    });
  });

  it('reports unprobed rather than listed when the file cannot be read', () => {
    const file = join(scratch(), 'absent.json');
    expect(catalogueNoteOf(file).verdict).toBe('unprobed');
    expect(catalogueNoteOf(file).why).toContain('could not be read');
  });

  it('reports unprobed when the file is not an object or names no verdict', () => {
    const directory = scratch();
    const notObject = join(directory, 'array.json');
    writeFileSync(notObject, '[1,2]');
    expect(catalogueNoteOf(notObject).why).toContain('is not an object');

    const noVerdict = join(directory, 'blank.json');
    writeFileSync(noVerdict, JSON.stringify({ model: 'm' }));
    expect(catalogueNoteOf(noVerdict).why).toContain('names no verdict');

    const broken = join(directory, 'broken.json');
    writeFileSync(broken, '{');
    expect(catalogueNoteOf(broken).verdict).toBe('unprobed');
  });

  it('keeps a verdict it does know, with a partial body', () => {
    // A probe file written by an older build has no `why` and no model list; the verdict is the part
    // that decides how the artefact should be read, so it survives.
    const file = join(scratch(), 'torn.json');
    writeFileSync(file, JSON.stringify({ verdict: 'unlistable' }));
    expect(catalogueNoteOf(file)).toEqual({
      verdict: 'unlistable',
      model: '',
      listed: 0,
      why: '',
    });
  });
});
