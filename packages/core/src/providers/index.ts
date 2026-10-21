/**
 * `@agentix-e/microglia-core/providers` — the model contracts and their registry.
 *
 * Two ways to supply a provider, both first class: pass an instance you built, or
 * register a factory once and refer to it by name from configuration.
 */
export type {
  EmbeddingProvider,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  ProviderFactory,
  ProviderKind,
  Resolved,
} from './types.js';
export { listProviders, registerProvider, resolveProvider } from './registry.js';
