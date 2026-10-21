/**
 * DeepSeek as an `LlmProvider`.
 *
 * The implementation is a function of its configuration, not of the environment:
 * a host can run two deployments with different keys in one process, and a test
 * can point it at a local server without touching global state.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ProviderFactory,
} from '@agentix-e/microglia-core/providers';
import type { JsonObject } from '@agentix-e/microglia-core';

export const DEEPSEEK_BASE = 'https://api.deepseek.com';

export type DeepSeekOptions = {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

export function deepseekProvider(options: DeepSeekOptions): LlmProvider {
  const model = options.model ?? 'deepseek-chat';
  const base = options.baseUrl ?? DEEPSEEK_BASE;
  const call = options.fetch ?? fetch;
  return {
    id: `deepseek:${model}`,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const response = await call(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
            { role: 'user', content: request.prompt },
          ],
          temperature: request.temperature ?? 0,
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok) {
        throw new MicrogliaError('MG_E_PROVIDER_MISSING', `DeepSeek returned ${response.status}`, {
          status: response.status,
        });
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      };
      return {
        text: body.choices?.[0]?.message?.content ?? '',
        model,
        ...(body.usage?.total_tokens === undefined ? {} : { tokens: body.usage.total_tokens }),
      };
    },
  };
}

/** The declaration a config file may hold; `id` names this factory. */
export const deepseekFactory: ProviderFactory<LlmProvider> = (config: JsonObject) => {
  const apiKey = config['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'deepseek requires apiKey');
  }
  return deepseekProvider({
    apiKey,
    ...(typeof config['model'] === 'string' ? { model: config['model'] } : {}),
    ...(typeof config['baseUrl'] === 'string' ? { baseUrl: config['baseUrl'] } : {}),
  });
};
