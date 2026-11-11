import { describe, expect, it } from 'vitest';
import { PROVIDER_ALIASES, splitProvider } from '../model-id.js';

/**
 * The translation, on its own.
 *
 * It used to live in `model-client.ts`, which imports the core package for its error type and therefore
 * needs a built `dist/`. Every job that reads a registration before the build — the scope resolver, the
 * arm fan-out — died in eleven seconds with `ERR_MODULE_NOT_FOUND` on a job whose only task was to say
 * which lane it had bought. A string rewrite that nothing has to be built to use is the fix, and these
 * are the four shapes it has to answer for.
 */
describe('splitProvider', () => {
  it('leaves a bare id alone, because most ids are bare', () => {
    expect(splitProvider('deepseek-flash')).toEqual({ sent: 'deepseek-flash' });
    expect(splitProvider('  deepseek-v4-pro  ')).toEqual({ sent: 'deepseek-v4-pro' });
  });

  it('strips the one alias the endpoint really serves, and says which it stripped', () => {
    // The τ² lane is a litellm caller in its Python half, so it names the model
    // `deepseek/deepseek-chat`; this endpoint's `model` field is `deepseek-chat`. Sending the router's
    // spelling was rejected with a 400 on every call, which the lane read as an empty answer.
    expect(splitProvider('deepseek/deepseek-chat')).toEqual({
      sent: 'deepseek-chat',
      stripped: 'deepseek',
    });
    expect(splitProvider('DeepSeek/deepseek-chat')).toEqual({
      sent: 'deepseek-chat',
      stripped: 'DeepSeek',
    });
  });

  it('leaves an unknown prefix attached, because it names a different provider rather than an alias', () => {
    // `deepseek-ai/DeepSeek-V3` and `openai/gpt-4o` are names of other things; mangling them would
    // report a provider mismatch for a configuration that made a different choice.
    expect(splitProvider('openai/gpt-4o')).toEqual({ sent: 'openai/gpt-4o' });
    expect(splitProvider('deepseek-ai/DeepSeek-V3')).toEqual({ sent: 'deepseek-ai/DeepSeek-V3' });
  });

  it('keeps the raw text when the prefix has nothing behind it, which the endpoint can refuse', () => {
    expect(splitProvider('deepseek/')).toEqual({ sent: 'deepseek/' });
    expect(splitProvider('/deepseek-flash')).toEqual({ sent: '/deepseek-flash' });
  });

  it('answers an empty id with an empty id, and leaves the refusal to the caller', () => {
    // The client refuses it; a registration header has already validated the shape. A translator that
    // throws forces every reader to depend on the error type it throws, which is the defect this module
    // was extracted to remove.
    expect(splitProvider('')).toEqual({ sent: '' });
    expect(splitProvider('   ')).toEqual({ sent: '' });
  });

  it('names the aliases it knows, so a reader can see the list is deliberately one entry', () => {
    expect([...PROVIDER_ALIASES]).toEqual(['deepseek']);
  });
});
