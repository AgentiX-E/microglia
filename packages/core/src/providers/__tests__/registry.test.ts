import { describe, expect, it } from 'vitest';
import {
  listProviders,
  registerProvider,
  resolveProvider,
} from '../registry.js';
import type { EmbeddingProvider, LlmProvider } from '../types.js';

function llm(id: string): LlmProvider {
  return { id, complete: async () => ({ text: 'ok', model: id }) };
}

function embedding(id: string): EmbeddingProvider {
  return { id, embed: async (texts) => texts.map(() => [0, 1]) };
}

describe('provider registry', () => {
  it('builds a provider from a declaration and reports where it came from', () => {
    const seen: string[] = [];
    registerProvider('llm', 'test-declared', (config) => {
      seen.push(String(config['endpoint']));
      return llm('test-declared');
    });
    const resolved = resolveProvider('llm', { id: 'test-declared', endpoint: 'https://example.test' });
    expect(resolved?.source).toBe('registered');
    expect(resolved?.provider.id).toBe('test-declared');
    expect(seen).toEqual(['https://example.test']);
  });

  it('prefers an instance the host built over a registered name', () => {
    const instance = llm('test-instance');
    const resolved = resolveProvider('llm', instance);
    expect(resolved).toEqual({ provider: instance, source: 'instance' });
  });

  it('names the known providers when a declaration resolves to nothing', () => {
    registerProvider('llm', 'test-known', () => llm('test-known'));
    try {
      resolveProvider('llm', { id: 'test-absent' });
      throw new Error('expected a throw');
    } catch (error) {
      const failure = error as { code?: string; details?: { known?: string[] } };
      expect(failure.code).toBe('MG_E_PROVIDER_MISSING');
      expect(failure.details?.known).toContain('test-known');
    }
  });

  it('refuses a duplicate name and an empty one', () => {
    registerProvider('llm', 'test-duplicate', () => llm('test-duplicate'));
    expect(() => registerProvider('llm', 'test-duplicate', () => llm('x'))).toThrow(/already registered/);
    expect(() => registerProvider('embedding', '  ', () => embedding('x'))).toThrow(/cannot be empty/);
  });

  it('keeps the two kinds apart and lists them sorted', () => {
    registerProvider('embedding', 'test-embed-b', () => embedding('test-embed-b'));
    registerProvider('embedding', 'test-embed-a', () => embedding('test-embed-a'));
    expect(listProviders('embedding')).toEqual(['test-embed-a', 'test-embed-b']);
    expect(listProviders('llm')).not.toContain('test-embed-a');
    expect(resolveProvider('embedding', undefined)).toBeUndefined();
  });
});
