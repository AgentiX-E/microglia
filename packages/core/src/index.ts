/**
 * `@agentix-e/microglia-core` — the library a host embeds.
 *
 * One install, one import, and the whole loop:
 *
 *   const mg = await openMicroglia({ app, namespace, store });
 *   const pack = await mg.recall({ task, text, scope });
 *   const run = mg.begin({ task, input, pack });
 *   await run.complete(output);
 *   await run.edit(corrected);
 *   await mg.distill();
 *
 * The modules underneath are also reachable as subpaths, so a host that wants
 * only retrieval can import `@agentix-e/microglia-core/apply` and leave the
 * distiller out of its bundle:
 *
 *   /memory    embedded store, journal, lexical index
 *   /distill   rules interpreter, model interpreter, generalisation
 *   /apply     pack construction, MMR, rendering
 *   /capture   the facade, run handle, feedback normalisation, export
 *   /kernel    contracts and pure algorithms
 */
export * from './kernel/index.js';
export * from './capture/index.js';
