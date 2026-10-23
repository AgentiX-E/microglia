/**
 * Zhipu GLM as an `EmbeddingProvider`.
 *
 * Embeddings are optional in Microglia: retrieval works on BM25 alone, and a host
 * adds a dense channel when it has one. Keeping the adapter here rather than in
 * core means the browser bundle never carries a vendor URL.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import type {
  EmbeddingProvider,
  ProviderFactory,
} from '@agentix-e/microglia-core/providers';
import type { JsonObject } from '@agentix-e/microglia-core';

export const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';

export type ZhipuOptions = {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

export function zhipuEmbeddings(options: ZhipuOptions): EmbeddingProvider {
  const model = options.model ?? 'embedding-3';
  const base = options.baseUrl ?? ZHIPU_BASE;
  const call = options.fetch ?? fetch;
  return {
    id: `zhipu:${model}`,
    async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return [];
      const response = await call(`${base}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok) {
        throw new MicrogliaError('MG_E_PROVIDER_MISSING', `Zhipu returned ${response.status}`, {
          status: response.status,
        });
      }
      const body = (await response.json()) as { data?: { embedding?: number[] }[] };
      const data = body.data ?? [];
      // An entry with no vector is a malformed reply, not a similarity of zero. The
      // empty vector would flow into an index where every comparison against it is
      // meaningless, and nothing downstream could tell that from a real miss.
      const missing = data.findIndex((entry) => entry.embedding === undefined || entry.embedding.length === 0);
      if (missing !== -1) {
        throw new MicrogliaError('MG_E_PROVIDER_MISSING', 'Zhipu returned an entry with no vector', {
          index: missing,
          received: data.length,
        });
      }
      const vectors = data.map((entry) => entry.embedding as number[]);
      if (vectors.length !== texts.length) {
        throw new MicrogliaError('MG_E_PROVIDER_MISSING', 'Zhipu returned a different number of vectors', {
          expected: texts.length,
          received: vectors.length,
        });
      }
      return vectors;
    },
  };
}

export const zhipuFactory: ProviderFactory<EmbeddingProvider> = (config: JsonObject) => {
  const apiKey = config['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'zhipu requires apiKey');
  }
  return zhipuEmbeddings({
    apiKey,
    ...(typeof config['model'] === 'string' ? { model: config['model'] } : {}),
    ...(typeof config['baseUrl'] === 'string' ? { baseUrl: config['baseUrl'] } : {}),
  });
};
