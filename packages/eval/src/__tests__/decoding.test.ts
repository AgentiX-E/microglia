import { describe, expect, it } from 'vitest';
import { THINKING_HEADROOM, answerBudget, distillBudget } from '../decoding.js';

describe('answerBudget', () => {
  it('passes the answer budget through unchanged when the model does not think', () => {
    // The lane's 700 was correct for exactly as long as no model spent it before writing.
    expect(answerBudget(700, 'off')).toBe(700);
  });

  it('adds room to think on top of the answer, not instead of it', () => {
    expect(answerBudget(700, 'on')).toBe(700 + THINKING_HEADROOM);
  });

  it('covers the reasoning the lane actually observed', () => {
    // 1,354,007 reasoning tokens over 1,989 replies is 681 per reply against a 700-token budget,
    // which left about nineteen for a SQL statement and dropped the parse rate to 51.43%. The
    // constant has to be above the observation with room for the tail, or it is a comment.
    expect(THINKING_HEADROOM).toBeGreaterThan(681);
    expect(THINKING_HEADROOM).toBeGreaterThanOrEqual(681 * 1.5);
  });

  it('answers zero when asked for zero, which keeps the function honest at its edge', () => {
    expect(answerBudget(0, 'off')).toBe(0);
    expect(answerBudget(0, 'on')).toBe(THINKING_HEADROOM);
  });

  it('is monotone in both arguments, so a bigger request is never a smaller budget', () => {
    for (const mode of ['off', 'on'] as const) {
      expect(answerBudget(701, mode)).toBeGreaterThanOrEqual(answerBudget(700, mode));
    }
    expect(answerBudget(700, 'on')).toBeGreaterThan(answerBudget(700, 'off'));
  });
});

describe('distillBudget', () => {
  it('sizes the distiller the same way it sizes an answer', () => {
    // R84's distiller failed 572 of 1,400 replies — empty or truncated JSON — because its budget was a
    // literal at the call site and the regime added headroom to a different literal. A regime that
    // changes token economics has to reach every budget that spends those tokens, and the distiller is
    // the one call a fold makes to a second prompt on every correction.
    expect(distillBudget('procedure', 'off')).toBe(2_000);
    expect(distillBudget('repair', 'off')).toBe(3_000);
    expect(distillBudget('procedure', 'on')).toBe(3_200);
    expect(distillBudget('repair', 'on')).toBe(4_200);
  });

  it('gives the repair form its own base, because it answers a different question', () => {
    // The repair pass shows the model the attempt and the reference, so its answer is longer than a
    // rule's. That was already true and was already two literals in two files.
    expect(distillBudget('repair', 'off') - distillBudget('lesson', 'off')).toBe(1_000);
  });
});
