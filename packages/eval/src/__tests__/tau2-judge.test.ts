import { describe, expect, it } from 'vitest';
import { judgeOf } from '../tau2-instrument.js';

/**
 * The judge a pass^4 on τ² retail is quoted with.
 *
 * R92 lost eleven of forty held-out tasks and every one of them carried an `nl_assertion`; the
 * twenty-nine that scored carried none. The cause was a module constant —
 * `DEFAULT_LLM_NL_ASSERTIONS = "gpt-4.1-2025-04-14"` in `tau2/config.py` at v1.0.1 — and a lane that
 * holds a DeepSeek key and no OpenAI key. The evaluator raised, `run_with_retry` retried three times,
 * and the task left the denominator.
 *
 * `run_split.py` redirects that judge. `judgeOf` is the same two variables read in the same order,
 * on this side of the process boundary, so the artefact can say which instrument graded the prose
 * assertions rather than leaving it in a dispatch log. These cases pin the precedence, because a
 * record that disagrees with the run is worse than no record: it is a claim.
 */
describe('the judge a dispatch used', () => {
  it('prefers the explicit judge over the arm’s own model', () => {
    expect(judgeOf({ TAU_JUDGE_MODEL: 'openai/gpt-4.1-2025-04-14', TAU_MODEL: 'deepseek/deepseek-flash' })).toBe(
      'openai/gpt-4.1-2025-04-14',
    );
  });

  it('falls back to the model the arm ran, which is what the runner does', () => {
    expect(judgeOf({ TAU_MODEL: 'deepseek/deepseek-flash' })).toBe('deepseek/deepseek-flash');
  });

  it('treats a blank explicit judge as unset rather than as a model named ""', () => {
    // An empty dispatch input is the shape a workflow hands a step that was not filled in, and
    // answering it with a blank judge would record a model that cannot be called.
    expect(judgeOf({ TAU_JUDGE_MODEL: '   ', TAU_MODEL: 'deepseek/deepseek-flash' })).toBe(
      'deepseek/deepseek-flash',
    );
  });

  it('answers nothing when neither variable is set, because absent is not a default', () => {
    // `undefined` leaves the field out of the artefact. Writing the release's own default here would
    // assert that gpt-4.1 graded the run, which is the assertion R92's redispatch exists to retract.
    expect(judgeOf({})).toBeUndefined();
    expect(judgeOf({ TAU_MODEL: '  ' })).toBeUndefined();
  });
});
