/**
 * The process a host runs.
 *
 * `createServer` wires the three things a deployment needs — a durable journal, an
 * open facade, and the HTTP app — and returns them separately so a test can mount
 * the app without a socket and a supervisor can close the store on shutdown.
 */
import { serve } from '@hono/node-server';
import { EmbeddedMemory, JsonlJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core';
import { combineInterpreters, createLlmInterpreter, ruleInterpreter } from '@agentix-e/microglia-core/distill';
import type { Microglia } from '@agentix-e/microglia-core';
import type { LlmProvider } from '@agentix-e/microglia-core/providers';
import { createApp } from './app.js';

export type ServerOptions = {
  /** Directory holding the journal. One writer per directory. */
  readonly dir: string;
  readonly app?: string;
  readonly namespace: string;
  readonly token?: string;
  /** When supplied, distillation can turn free-text feedback into typed lessons. */
  readonly llm?: LlmProvider;
};

export type Server = {
  readonly microglia: Microglia;
  readonly store: EmbeddedMemory;
  readonly app: ReturnType<typeof createApp>;
  close(): Promise<void>;
};

export async function createServer(options: ServerOptions): Promise<Server> {
  const store = await EmbeddedMemory.open(new JsonlJournal({ dir: options.dir }));
  const llm = options.llm;
  const microglia = await openMicroglia({
    app: options.app ?? 'microglia',
    namespace: options.namespace,
    store,
    ...(llm === undefined
      ? {}
      : {
          interpreter: combineInterpreters(
            createLlmInterpreter({
              llm: {
                complete: (prompt: string) =>
                  llm.complete({ prompt, maxTokens: 2000 }).then((response) => response.text),
              },
            }),
            ruleInterpreter,
          ),
        }),
  });
  const app = createApp({
    microglia,
    ...(options.token === undefined ? {} : { token: options.token }),
  });
  return {
    microglia,
    store,
    app,
    async close() {
      await microglia.close();
    },
  };
}

/** Listen on a port. Returns the node server so a host can shut it down. */
export function listen(
  server: Server,
  port: number,
  hostname = '127.0.0.1',
): ReturnType<typeof serve> {
  return serve({ fetch: server.app.fetch, port, hostname });
}
