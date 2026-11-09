/**
 * R62 — the prompt a widened scope reads, and the prompt it must not.
 *
 * R61's repair prompt is a published measurement. If the trace prompt grew the two sentences a passing
 * record needs, a lane still learning from repairs alone would read a different prompt and its numbers
 * would no longer be comparable with the store R61 graded — which is the one comparison this round is
 * built on. So the invariant is not "the sentences appear when asked"; it is **the prompt is the same
 * string when not asked**, asserted against the five-argument call that predates the option.
 *
 * The second half is the reason the sentences exist at all. A record made from a pass has no
 * `expected` — the attempt is the reference — and a model shown a payload without a key the prompt
 * told it to expect will most likely answer with an empty array. An empty store from that reading
 * would be indistinguishable from R62's own refutation ("the success distiller has nothing to say"),
 * so the instrument must not manufacture it.
 */
import { describe, expect, it } from 'vitest';
import { buildDistillPrompt, createLlmInterpreter } from '../llm.js';
import type { FeedbackEvent, RunRecord } from '../../kernel/index.js';

const at = 1_700_000_000_000;

const event: FeedbackEvent = {
  schema: 'microglia.feedback/1',
  id: 'fb_1',
  at,
  namespace: 'acme',
  sessionId: 's',
  runId: 'r',
  task: 'retail.act',
  kind: 'edit',
  actor: { type: 'user' },
  trust: 0.9,
  signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 1, after: null },
  provenance: { knowledgeIds: [] },
};

const run: RunRecord = {
  schema: 'microglia.run/1',
  id: 'r',
  at,
  namespace: 'acme',
  sessionId: 's',
  task: 'retail.act',
  input: { trace: { attempt: ['find_user(user_id="u_1")'], rubricMet: true } },
  output: { actions: ['find_user'] },
  status: 'ok',
};

const context = { event, run };

describe('the trace prompt under a widened scope', () => {
  it('is the published string, byte for byte, when the scope is not declared', () => {
    const published = buildDistillPrompt(context, [], undefined, 'trace', 3);
    expect(buildDistillPrompt(context, [], undefined, 'trace', 3, false)).toBe(published);
    // The payload itself carries `rubricMet` — this fixture's run is a passing record — so the
    // assertion is about the instruction, which is where a prompt change would show.
    expect(published).not.toContain('`rubricMet` is true when the trajectory met every check');
  });

  it('names the shape a passing record has, and what to do with it', () => {
    const widened = buildDistillPrompt(context, [], undefined, 'trace', 3, true);
    expect(widened).toContain('`rubricMet` is true when the trajectory met every check');
    expect(widened).toContain('- When `rubricMet` is true, state the rule the trajectory follows');
  });

  it('differs from the published string by exactly two lines and nothing else', () => {
    // A diff assertion rather than a containment assertion: a later edit that reflowed the shared
    // rules while adding the passing ones would pass a containment test and quietly move R61's arm.
    const published = buildDistillPrompt(context, [], undefined, 'trace', 3).split('\n');
    const widened = buildDistillPrompt(context, [], undefined, 'trace', 3, true).split('\n');
    const added = widened.filter((line) => !published.includes(line));
    const removed = published.filter((line) => !widened.includes(line));
    expect(removed).toEqual([]);
    expect(added).toEqual([
      '`rubricMet` is true when the trajectory met every check instead of failing one: there `attempt` is the reference, `expected` is absent because there is nothing to compare it to, and `rubric` is the checks the attempt met.',
      '- When `rubricMet` is true, state the rule the trajectory follows, in the order it follows it: what the successful path establishes, and why that order is what makes it succeed. Do not compare it with anything.',
    ]);
  });

  it('leaves every other form alone, because the option is about the trace unit', () => {
    for (const form of ['lesson', 'repair', 'procedure', 'lexicon'] as const) {
      expect(buildDistillPrompt(context, [], undefined, form, 3, true)).toBe(
        buildDistillPrompt(context, [], undefined, form, 3),
      );
    }
  });
});

describe('the interpreter threads the scope to the prompt', () => {
  async function promptOf(options: { readonly passScope?: boolean }): Promise<string> {
    const seen: string[] = [];
    const interpreter = createLlmInterpreter({
      llm: {
        complete: async (prompt: string) => {
          seen.push(prompt);
          return '{"candidates":[]}';
        },
      },
      form: 'trace',
      ...options,
    });
    await interpreter(context);
    expect(seen).toHaveLength(1);
    return seen[0] ?? '';
  }

  it('sends the passing sentences when the lane declared the scope', async () => {
    expect(await promptOf({ passScope: true })).toContain('`rubricMet` is true');
  });

  it('sends the published prompt when it did not', async () => {
    expect(await promptOf({})).not.toContain('`rubricMet` is true');
  });
});
