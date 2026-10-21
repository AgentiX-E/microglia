/**
 * The provider contracts.
 *
 * A host brings its own model vendor; the library only needs a completion and an
 * optional embedding. Keeping the interfaces this small is what lets the same
 * code run against a hosted API, a local gateway, or a test double the host
 * writes itself — without the library importing an SDK.
 */
import type { Json, JsonObject } from '../kernel/types.js';

export type LlmRequest = {
  readonly prompt: string;
  readonly system?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
};

export type LlmResponse = {
  readonly text: string;
  /** Provider-reported usage, when it exists. Estimated values must say so. */
  readonly tokens?: number;
  readonly model: string;
};

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface EmbeddingProvider {
  readonly id: string;
  /** Vector width, when the provider knows it up front. */
  readonly dimensions?: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export type ProviderKind = 'llm' | 'embedding';

/**
 * A declaration, not an instance: what a config file can hold.
 *
 * `id` names a factory; every other key is passed to it unchanged. The config is
 * data, so it can come from JSON, an environment variable, or a host's settings
 * table without the library knowing which.
 */
export type ProviderConfig = {
  readonly id: string;
  readonly [key: string]: Json;
};

export type ProviderFactory<T> = (config: JsonObject) => T;

export type Resolved<T> = {
  readonly provider: T;
  /** Where it came from, for the diagnostic a host reads at startup. */
  readonly source: 'instance' | 'registered';
};
