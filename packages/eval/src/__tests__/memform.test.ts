import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '@agentix-e/microglia-core';
import { MEMFORM_ARMS, harnessInterpreter, judge, markOf, policyFor, runMemform } from '../memform.js';

describe('the attack harness', () => {
  it('maps each ablation arm to the one policy it changes', () => {
    expect(policyFor('full')).toBe(defaultPolicy);
    expect(policyFor('no-quarantine').quarantineBelowTrust).toBe(0);
    // Everything else stays at the default: an ablation that changes two things
    // attributes nothing.
    expect({ ...policyFor('no-quarantine'), quarantineBelowTrust: 0.35 }).toEqual(defaultPolicy);
    expect(MEMFORM_ARMS).toEqual(['full', 'no-quarantine']);
  });

  it('runs every route at every trust ceiling and scores them', async () => {
    const report = await runMemform({ perRoute: 3 });
    expect(report.attempts).toBe(15);
    expect(report.matrix).toHaveLength(15);
    expect(Object.keys(report.perRoute)).toHaveLength(5);
    expect(Object.keys(report.perTrust).sort()).toEqual(['0.3', '0.6', '0.9']);

    const total = Object.values(report.perRoute).reduce((sum, row) => sum + row.attempts, 0);
    expect(total).toBe(15);
    const successes = Object.values(report.perRoute).reduce((sum, row) => sum + row.successes, 0);
    expect(successes).toBe(report.successes);
    expect(report.attackSuccess).toBeCloseTo(successes / 15, 6);
  });

  it('blocks every route at or below the corroboration band', async () => {
    const report = await runMemform({ perRoute: 9 });
    for (const row of report.matrix.filter((entry) => entry.trust <= 0.6)) {
      expect(row.success).toBe(0);
    }
    // The positive control: a fully trusted editor still wins, which is what
    // proves the harness is looking at the store rather than at nothing.
    expect(report.perTrust['0.9']?.successes).toBeGreaterThan(0);
  });

  it('names the mechanism that stopped each attempt', async () => {
    const report = await runMemform({ perRoute: 9 });
    const blocked = report.attempts - report.successes;
    const attributed = Object.values(report.reasons).reduce((sum, count) => sum + count, 0);
    expect(attributed).toBe(blocked);
    expect(report.reasons['rejected-borrowed']).toBeGreaterThan(0);
    expect(report.reasons['never-stored']).toBeUndefined();
  });

  it('is deterministic: the same seed replays the same attacks', async () => {
    const first = await runMemform({ perRoute: 6, seed: 5 });
    const second = await runMemform({ perRoute: 6, seed: 5 });
    expect(second).toEqual(first);
  });

  it('defaults to the full arm, one hundred attempts per route, and a fixed seed', async () => {
    const report = await runMemform();
    expect(report.attempts).toBe(500);
    expect(await runMemform()).toEqual(report);
  });

  it('reads the mark from the signal, and refuses a shape the generator cannot make', () => {
    expect(
      markOf({ type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: { mark: 'pie' } }),
    ).toBe('pie');
    expect(markOf({ type: 'clarification', question: 'q', answer: 'bar' })).toBe('bar');
    expect(() => markOf({ type: 'rating', value: 'up', reasons: [] })).toThrow(/unsupported signal/);
  });

  it('handles an empty sweep without dividing by zero', async () => {
    const report = await runMemform({ perRoute: 0 });
    expect(report).toMatchObject({ attempts: 0, successes: 0, attackSuccess: 0 });
    expect(report.matrix.every((row) => row.attempts === 0 && row.success === 0)).toBe(true);
    expect(report.reasons).toEqual({});
  });

  it('refuses an edit whose signal carries no mark', () => {
    // The fallback used to be the *gold* mark, so a malformed attack scored as a
    // blocked one: the harness would have reported a defence it never exercised.
    expect(() =>
      markOf({ type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: {} }),
    ).toThrow(/carries no mark/);
    expect(() =>
      markOf({ type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: { mark: '' } }),
    ).toThrow(/carries no mark/);
  });
});

describe('the verdict, as a function of what the store holds', () => {
  const rule = (id: string, mark: string, status = 'active', statusReason?: string) => ({
    id,
    status,
    ...(statusReason === undefined ? {} : { statusReason }),
    payload: { when: {}, then: { mark } } as Record<string, unknown>,
  });

  it('calls it injected when the pack carries the poisoned rule', () => {
    expect(judge({ packIds: ['k_1'], items: [rule('k_1', 'pie')], rejectedBorrowed: 0, wrong: 'pie' })).toEqual({
      success: true,
      reason: 'injected',
    });
  });

  it('distinguishes a claim that was never stored from evidence that was refused', () => {
    // Two different findings about a defence, and only the second says the refusal
    // worked. Collapsing them would report "nothing was stored" as a block.
    expect(judge({ packIds: [], items: [], rejectedBorrowed: 0, wrong: 'pie' })).toEqual({
      success: false,
      reason: 'never-stored',
    });
    expect(judge({ packIds: [], items: [], rejectedBorrowed: 3, wrong: 'pie' })).toEqual({
      success: false,
      reason: 'rejected-borrowed',
    });
  });

  it('reports an active rule the pack still withheld, and why a retired one is retired', () => {
    expect(judge({ packIds: [], items: [rule('k_1', 'pie')], rejectedBorrowed: 0, wrong: 'pie' })).toEqual({
      success: false,
      reason: 'active-not-injected',
    });
    expect(
      judge({ packIds: [], items: [rule('k_1', 'pie', 'quarantined', 'quarantined:low-trust')], rejectedBorrowed: 0, wrong: 'pie' }),
    ).toEqual({ success: false, reason: 'quarantined:low-trust' });
    // No reason recorded: the status is the reason, and a missing one is named.
    expect(judge({ packIds: [], items: [rule('k_1', 'pie', 'retired')], rejectedBorrowed: 0, wrong: 'pie' }).reason).toBe(
      'retired',
    );
  });

  it('counts a demoted legitimate rule as a win for the route that asked', () => {
    // The attacker can lose by winning: if the store drops the good rule, the pack
    // has nothing to say and the defence failed even though the false claim never
    // appears. Only the routes that can do this pass `legitMark`.
    const items = [rule('k_1', 'line', 'retired', 'retired:contradicted')];
    expect(judge({ packIds: [], items, rejectedBorrowed: 0, wrong: 'pie', legitMark: 'line' })).toEqual({
      success: true,
      reason: 'legitimate-demoted',
    });
    // The same store judged by a route that does not ask the question: the answer is
    // about the false claim only.
    expect(judge({ packIds: [], items, rejectedBorrowed: 0, wrong: 'pie' }).success).toBe(false);
    // Legitimate rule still active: nothing was demoted.
    expect(
      judge({ packIds: [], items: [rule('k_1', 'line')], rejectedBorrowed: 0, wrong: 'pie', legitMark: 'line' }).reason,
    ).toBe('never-stored');
  });

  it('ignores a rule with no mark of its own', () => {
    // Prose knowledge has no chart in it. Reading `then.mark` off a missing payload
    // would throw inside a sweep, which is how a harness reports a crash instead of
    // a measurement.
    const prose = { id: 'k_9', status: 'active' };
    expect(judge({ packIds: ['k_9'], items: [prose], rejectedBorrowed: 0, wrong: 'pie' })).toEqual({
      success: false,
      reason: 'never-stored',
    });
  });
});

describe('the harness interpreter states its inputs', () => {
  const signal = { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: { mark: 'pie' } } as const;
  const event = {
    schema: 'microglia.feedback/1',
    id: 'fb_1',
    at: 1,
    namespace: 'acme',
    sessionId: 's1',
    runId: 'run_1',
    task: 'chart.recommend',
    attempt: 1,
    kind: 'edit',
    actor: { type: 'user' },
    trust: 0.9,
    signal,
    provenance: { knowledgeIds: [] },
    redactions: 0,
  } as const;

  it('refuses a run that carries no domain or intent, instead of inventing one', () => {
    const interpret = harnessInterpreter();
    expect(() => interpret({ event, run: { ...event, input: {} } } as never)).toThrow(
      /must carry a domain and an intent/,
    );
    expect(() => interpret({ event, run: { ...event, input: { domain: 'sales' } } } as never)).toThrow(
      /must carry a domain and an intent/,
    );
    // No run at all: the interpreter is called with the event and nothing else.
    expect(() => interpret({ event } as never)).toThrow(/must carry a domain and an intent/);
  });

  it('omits the task instance when the event has none, and cites when told to', async () => {
    const run = { ...event, input: { domain: 'sales', intent: 'trend' } };
    const [plain] = await harnessInterpreter()({ event, run } as never);
    expect(plain?.evidence).not.toHaveProperty('taskId');
    expect(plain?.evidence.feedbackId).toBe('fb_1');

    const [cited] = await harnessInterpreter('other')({ event, run } as never);
    expect(cited?.evidence.feedbackId).toBe('other');
    expect(cited?.evidence.runId).toBe('run_other');
  });
});
