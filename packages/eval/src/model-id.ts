/**
 * The one translation between how a model is named and what an endpoint is told it is called.
 *
 * This module exists because of an import cycle that was not a cycle: `prereg.ts` needs to compare the
 * model a registration fixes against the model a dispatch would call, and the only place that knows how
 * `deepseek/deepseek-chat` becomes `deepseek-chat` is `model-client.ts` — which imports
 * `@agentix-e/microglia-core` for its error type, and therefore needs a built `dist/`. Every job that
 * reads a registration before the build — the scope resolver, the arm fan-out — could not load it, and
 * the dispatch died in eleven seconds with `ERR_MODULE_NOT_FOUND` on a job whose only task was to print
 * which lane it had bought.
 *
 * The translation is a string rewrite. Keeping it beside a network client was the accident; keeping it
 * where nothing has to be built is the fix. `model-client.ts` re-exports it, so its public surface is
 * unchanged and the error it raises for an empty id stays with the client that needs one.
 */

/**
 * The model ids the endpoint serves under a `provider/` alias.
 *
 * One list, and only one entry, because it is a translation rather than a guess. The τ² lane is a
 * litellm caller in its Python half and a REST caller in this one, so its model is named
 * `deepseek/deepseek-chat` — litellm's spelling of the provider and the id. This client posts to
 * `api.deepseek.com/chat/completions`, whose `model` field is `deepseek-chat`. Sending the router's
 * spelling was rejected with a 400 on every call, and the lane read that as "the model said nothing
 * about this correction": 32 prompts, 32 empty answers, a store with no knowledge in it.
 *
 * The list stays narrow on purpose. A prefix this file does not know is left alone, because
 * `deepseek-ai/DeepSeek-V3` and `openai/gpt-4o` are names of other things rather than aliases of
 * this one, and mangling them would report a provider mismatch for a configuration that made a
 * different choice.
 */
export const PROVIDER_ALIASES: ReadonlySet<string> = new Set(['deepseek']);

/**
 * What this endpoint should be told the model is called.
 *
 * Returns the id to send and, when a prefix was removed, the prefix, so a caller can record both
 * names: the artefact says what was configured, and the request says what was asked.
 *
 * An empty id is answered with an empty `sent` rather than an error. Whether that is a refusal is the
 * caller's question — the client refuses it, a registration header has already validated the shape —
 * and a translator that throws forces every reader to depend on the error type it throws.
 */
export function splitProvider(configured: string): { readonly sent: string; readonly stripped?: string } {
  const trimmed = configured.trim();
  if (trimmed === '') return { sent: '' };
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return { sent: trimmed };
  const alias = trimmed.slice(0, slash);
  if (!PROVIDER_ALIASES.has(alias.toLowerCase())) return { sent: trimmed };
  const rest = trimmed.slice(slash + 1).trim();
  // `deepseek/` with nothing behind it is not a model id; keeping the raw text lets the endpoint
  // answer, which is a better error than one this file invents.
  return rest === '' ? { sent: trimmed } : { sent: rest, stripped: alias };
}
