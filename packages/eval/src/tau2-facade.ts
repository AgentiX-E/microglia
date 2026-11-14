/**
 * The facade a benchmark agent reads packs from, extracted so its one non-obvious decision is testable.
 *
 * It is one endpoint and it writes nothing, which is why it lived inline in the driver for four arms.
 * What moved it out is R109's bug: the handler read `task` and `text` and **discarded every other query
 * pair**, so `MICROGLIA_PACK_KNOBS` — the fragment a registration's pack mode renders into a request —
 * arrived at the one place that had to honour it and was thrown away. A prefix arm would have served the
 * retrieved pack under the prefix arm's name, and the readback would have compared an arm against itself.
 *
 * The repair is not a second parser here: the query is parsed by `recallQueryOf`, the field list the HTTP
 * package uses, which validates every value and refuses the ones it cannot honour. A knob added to
 * `RecallQuery` therefore arrives in this file as a compile error rather than as a silence on the wire.
 *
 * Three behaviours worth stating, because each is a choice rather than an implementation detail:
 *
 *  - **A bad knob is a 400, not a 500.** The agent records a 500 as an unreachable sidecar and carries
 *    on with no pack; a 400 says which value was wrong. The run's own note is the difference between
 *    "the provider refused" and "the registration asked for a spelling that does not exist".
 *  - **The two required fields keep their defaults.** An agent that omits `text` gets an empty query,
 *    which the pack layer already answers with an empty pack — the same behaviour as before.
 *  - **The response carries only `rendered`.** What a host needs is the block; the census travels
 *    in-process on the pack the callback returns, so a facade cannot become a second artefact channel.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { recallQueryOf, type RecallQuery } from '@agentix-e/microglia-core';

export type FacadeRecall = (input: {
  readonly task: string;
  readonly text: string;
  /** Everything else the request asked for, validated. The driver owns `task`, `text` and the scope. */
  readonly query: Omit<RecallQuery, 'namespace' | 'task' | 'text'>;
}) => Promise<{ rendered: string }>;

export type FacadeOptions = {
  /** The task label an agent that sends none is assumed to be asking in. */
  readonly task: string;
};

export type Facade = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export function startRecallFacade(recall: FacadeRecall, options: FacadeOptions): Promise<Facade> {
  const server: Server = createServer((request, response) => {
    // `request.url` is present on every HTTP request Node parses; the union in its type is for a request
    // object the runtime never constructs, and a fallback here would be a branch no socket can reach.
    const url = new URL(request.url as string, 'http://127.0.0.1');
    if (url.pathname !== '/v1/recall') {
      response.writeHead(404).end();
      return;
    }
    const task = url.searchParams.get('task') ?? options.task;
    const text = url.searchParams.get('text') ?? '';
    const parsed = recallQueryOf((name) => url.searchParams.get(name) ?? undefined, { task, text });
    if ('error' in parsed) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: parsed.error }));
      return;
    }
    // `task` and `text` are passed separately because the callback is told what the *agent* asked rather
    // than what the driver decided to do with it: the pin replaces the retrieval text downstream.
    const { task: _task, text: _text, ...query } = parsed.query;
    recall({ task, text, query })
      .then((pack) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ rendered: pack.rendered }));
      })
      .catch(() => response.writeHead(500).end());
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // `listen` on a port resolves with a `net.AddressInfo`; the union also carries a unix-socket path,
      // which this facade never opens. The cast states that rather than leaving two branches no request
      // can reach — and an unreachable branch in a file a coverage gate reads is a line nobody can test.
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
