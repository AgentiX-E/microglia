/**
 * Provider resolution: instance, then registered factory, then nothing.
 *
 * There is deliberately no "default provider". A library that silently falls
 * back to an environment variable produces a stack trace three layers away from
 * the misconfiguration; a named error at the call site does not.
 */
import { MicrogliaError } from '../kernel/errors.js';
import type {
  EmbeddingProvider,
  LlmProvider,
  ProviderConfig,
  ProviderFactory,
  ProviderKind,
  Resolved,
} from './types.js';

type AnyProvider = LlmProvider | EmbeddingProvider;

const registries: Record<ProviderKind, Map<string, ProviderFactory<never>>> = {
  llm: new Map(),
  embedding: new Map(),
};

/** Register a factory under a name a config can refer to. */
export function registerProvider<T extends AnyProvider>(
  kind: ProviderKind,
  id: string,
  factory: ProviderFactory<T>,
): void {
  if (id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'A provider id cannot be empty');
  }
  const registry = registries[kind] as Map<string, ProviderFactory<T>>;
  if (registry.has(id)) {
    throw new MicrogliaError('MG_E_CONFIG', `A ${kind} provider is already registered as '${id}'`, {
      kind,
      id,
    });
  }
  registry.set(id, factory);
}

/** Names a config may reference. Sorted, because a diagnostic is read by a human. */
export function listProviders(kind: ProviderKind): readonly string[] {
  return [...registries[kind].keys()].sort();
}

/**
 * Resolve a declaration, or an instance the host built itself.
 *
 * The instance wins: a host that constructed an object has already made a
 * decision, and re-resolving it through a registry would override that decision
 * silently.
 */
export function resolveProvider<T extends AnyProvider>(
  kind: ProviderKind,
  choice: T | ProviderConfig | undefined,
): Resolved<T> | undefined {
  if (choice === undefined) return undefined;
  if (isInstance<T>(choice)) return { provider: choice, source: 'instance' };
  const config = configOf(choice);
  const registry = registries[kind] as Map<string, ProviderFactory<T>>;
  const factory = registry.get(config.id);
  if (factory === undefined) {
    throw new MicrogliaError('MG_E_PROVIDER_MISSING', `No ${kind} provider is registered as '${config.id}'`, {
      kind,
      id: config.id,
      known: listProviders(kind),
    });
  }
  return { provider: factory(config), source: 'registered' };
}

function isInstance<T extends AnyProvider>(choice: T | ProviderConfig): choice is T {
  if (typeof (choice as LlmProvider).complete === 'function') return true;
  return typeof (choice as EmbeddingProvider).embed === 'function';
}

/** The declaration behind a choice that was not an instance. */
function configOf(choice: AnyProvider | ProviderConfig): ProviderConfig {
  return choice as ProviderConfig;
}
