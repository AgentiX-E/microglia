/**
 * Which key this lane may spend, and on which host.
 *
 * The model was already a variable (`SOTA_MODEL`) and the host was already a variable
 * (`DEEPSEEK_ENDPOINT`), so a run could be pointed at any OpenAI-shaped endpoint and the artefact
 * would say where it went. The credential could not: it was read from `DEEPSEEK_API_KEY` and
 * nowhere else. That makes the one experiment this record has never run — the same scaffold on a
 * different backbone — impossible to run correctly, and it makes it fail in the worst available
 * way. A key for the wrong provider is not a rejected request the lane reports; it is a `4xx` that
 * `verdictOf` classifies as `refusal`, which with an eight-prompt breaker ends the run as "the
 * endpoint is not answering". The τ² lane already paid for this exact shape once: thirty-two
 * prompts, thirty-two empty answers, and a store with no knowledge in it, read as a finding about
 * the model rather than about the configuration.
 *
 * So the plan is explicit rather than convenient. A named lane key is spent wherever the lane
 * points, because naming it is the answer to "which account pays for this". The DeepSeek key is
 * lent only to the host that issued it, or to a run that named no host at all — which is every
 * published BIRD cell in this repository. Anything else stops before the first call, with a
 * message that names the variable to set.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';

/** The host that issued `DEEPSEEK_API_KEY`, and the only foreign host it may be lent to. */
export const DEFAULT_MODEL_HOST = 'api.deepseek.com';

/** Where the key in a plan came from, recorded so a reader can tell a borrowed key from a lane's. */
export type CredentialSource = 'lane' | 'deepseek' | 'none';

export type CredentialPlan = {
  readonly key: string;
  readonly source: CredentialSource;
};

export type CredentialInput = {
  /** `SOTA_API_KEY`, the credential a backbone swap is supposed to supply. */
  readonly sotaKey: string | undefined;
  /** `DEEPSEEK_API_KEY`, the credential every published run spent. */
  readonly deepseekKey: string | undefined;
  /** The host of the configured endpoint, or `''` when the lane named none. */
  readonly endpointHost: string;
};

/**
 * The host of an endpoint, without the path or any query it carried.
 *
 * Parsed rather than echoed: an endpoint with a token in its query string would otherwise be
 * written into a committed artefact, and an endpoint that cannot be parsed is named as such
 * rather than reproduced.
 */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unparseable';
  }
}

/** The hosts that answer on this machine, and therefore authenticate nobody. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * A host with its port and its IPv6 brackets removed, which is what "same machine" is decided on.
 *
 * The port has to go: `hostOf` keeps it deliberately, because a stand-in is labelled by the port it
 * listened on and two rehearsals on two ports are two different runs. Nothing outside that label
 * wants it.
 */
function bareHost(host: string): string {
  return host
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
}

/** Whether an endpoint is a stand-in on this machine rather than a provider. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(bareHost(host.trim()));
}

/** Decide which key is spent, and refuse the one combination that spends it on the wrong host. */
export function planCredential(input: CredentialInput): CredentialPlan {
  const lane = (input.sotaKey ?? '').trim();
  if (lane !== '') return { key: lane, source: 'lane' };

  const borrowed = (input.deepseekKey ?? '').trim();
  if (borrowed === '') return { key: '', source: 'none' };

  const host = input.endpointHost.trim();
  if (host === '' || host === DEFAULT_MODEL_HOST) return { key: borrowed, source: 'deepseek' };
  // A stand-in on this machine authenticates nobody, so there is no provider to misroute a key to.
  // The rehearsal this repository documents — `eval/drivers/stand-in.mjs` behind
  // `DEEPSEEK_ENDPOINT` — spends the real key against a dummy server, and refusing that would
  // break the one workflow the refusal exists to protect.
  if (isLoopbackHost(host)) return { key: borrowed, source: 'deepseek' };

  throw new MicrogliaError(
    'MG_E_CONFIG',
    `DEEPSEEK_API_KEY would be sent to ${host}; set SOTA_API_KEY for that endpoint instead`,
    {
      endpoint_host: host,
      hint: 'The key and the host have to belong to the same provider. Setting SOTA_API_KEY records which account paid.',
    },
  );
}
