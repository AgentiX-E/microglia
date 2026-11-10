import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_HOST, hostOf, isLoopbackHost, planCredential } from '../credential.js';

describe('planCredential', () => {
  it('spends the lane key wherever the lane points, because naming it is the answer', () => {
    const plan = planCredential({
      sotaKey: 'lane-key',
      deepseekKey: 'ds-key',
      endpointHost: 'api.zhipu.ai',
    });

    expect(plan).toEqual({ key: 'lane-key', source: 'lane' });
  });

  it('lends the deepseek key to the host that issued it', () => {
    const plan = planCredential({
      sotaKey: undefined,
      deepseekKey: 'ds-key',
      endpointHost: DEFAULT_MODEL_HOST,
    });

    expect(plan).toEqual({ key: 'ds-key', source: 'deepseek' });
  });

  it('lends it when no endpoint was configured, which is every published run', () => {
    const plan = planCredential({ sotaKey: undefined, deepseekKey: 'ds-key', endpointHost: '' });

    expect(plan).toEqual({ key: 'ds-key', source: 'deepseek' });
  });

  it('refuses to send one provider key to another provider host', () => {
    expect(() =>
      planCredential({ sotaKey: undefined, deepseekKey: 'ds-key', endpointHost: 'api.zhipu.ai' }),
    ).toThrow(/SOTA_API_KEY/);
  });

  it('treats a blank lane key as absent rather than as a credential', () => {
    const plan = planCredential({ sotaKey: '   ', deepseekKey: 'ds-key', endpointHost: '' });

    expect(plan).toEqual({ key: 'ds-key', source: 'deepseek' });
  });

  it('reports no credential rather than inventing one', () => {
    expect(planCredential({ sotaKey: undefined, deepseekKey: undefined, endpointHost: '' })).toEqual({
      key: '',
      source: 'none',
    });
  });

  it('does not complain about a foreign host when there is no key to misroute', () => {
    // The client's own "an API key is required" is the useful message here; naming a host
    // mismatch for a key that does not exist would send the reader to the wrong file.
    expect(planCredential({ sotaKey: '', deepseekKey: '', endpointHost: 'api.zhipu.ai' })).toEqual({
      key: '',
      source: 'none',
    });
  });

  it('still refuses a blank lane key against a foreign host', () => {
    expect(() =>
      planCredential({ sotaKey: '  ', deepseekKey: 'ds-key', endpointHost: 'api.zhipu.ai' }),
    ).toThrow(/SOTA_API_KEY/);
  });

  it('lends the key to a stand-in on this machine, because a stand-in authenticates nobody', () => {
    // The documented rehearsal puts `eval/drivers/stand-in.mjs` behind DEEPSEEK_ENDPOINT and
    // spends the real key against it. Refusing that would break the workflow the refusal exists
    // to protect, so the loopback hosts are exempt rather than special-cased at the call site.
    for (const endpointHost of ['127.0.0.1:8123', 'localhost:3000', '[::1]:9000', '0.0.0.0']) {
      expect(planCredential({ sotaKey: undefined, deepseekKey: 'ds-key', endpointHost })).toEqual({
        key: 'ds-key',
        source: 'deepseek',
      });
    }
  });

  it('does not mistake a provider whose name merely contains a loopback name', () => {
    expect(() =>
      planCredential({ sotaKey: undefined, deepseekKey: 'ds-key', endpointHost: 'localhost.example' }),
    ).toThrow(/SOTA_API_KEY/);
  });
});

describe('isLoopbackHost', () => {
  it('decides on the host, not on the port it happens to listen on', () => {
    expect(isLoopbackHost('127.0.0.1:65535')).toBe(true);
    expect(isLoopbackHost('  [::1]  ')).toBe(true);
  });

  it('says no to a provider and to a host it cannot read', () => {
    expect(isLoopbackHost('api.deepseek.com')).toBe(false);
    expect(isLoopbackHost('unparseable')).toBe(false);
  });
});

describe('hostOf', () => {
  it('drops the path and the query, because a token there would be committed', () => {
    expect(hostOf('https://api.zhipu.ai/v1/chat/completions?token=secret')).toBe('api.zhipu.ai');
  });

  it('names an endpoint it cannot parse rather than echoing it', () => {
    expect(hostOf('not a url')).toBe('unparseable');
  });
});
