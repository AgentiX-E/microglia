/**
 * The census as the reading, on the numbers a stopping arm is worth.
 *
 * R104 paid $1.21 for a score no design on this board can order, and the informative half came free:
 * 63 of 73 replies were blank. R112 then excluded form and model, which leaves the thinking regime —
 * and the arm that tests it should stop after the learning half, because $1.21 buys a delta that
 * cannot be read. These tests pin the sentence such a stop carries, including the two states that must
 * never be called a refusal.
 */
import { describe, expect, it } from 'vitest';
import { learnOnlyReason, silenceOf } from '../learn-only.js';
import type { DistillReplyCensus } from '../distill-replies.js';

function census(overrides: Partial<DistillReplyCensus>): DistillReplyCensus {
  return { calls: 0, answered: 0, empty: 0, blank: 0, unparsed: 0, chars: 0, ...overrides };
}

describe('reading the reply census as the finding', () => {
  it('says nothing was asked when no call was recorded, which is not a refusal', () => {
    const reading = silenceOf(census({}));
    expect(reading.state).toBe('unasked');
    expect(reading.blankShare).toBe(0);
    expect(reading.emptyShare).toBe(0);
    expect(reading.sentence).toContain('not a reading about the distiller');
  });

  it('reads a full grid of answers as answered everywhere', () => {
    const reading = silenceOf(census({ calls: 8, answered: 8, chars: 4_800 }));
    expect(reading.state).toBe('answered-everywhere');
    expect(reading.sentence).toContain('every one of 8 call(s) produced a candidate');
  });

  it('reads R104 back as mostly blank, with the share and the tally', () => {
    // The shape R104 produced: 73 calls, 10 answered, 63 with no visible character.
    const reading = silenceOf(census({ calls: 73, answered: 10, blank: 63, chars: 6_824 }));
    expect(reading.state).toBe('mostly-blank');
    expect(reading.blankShare).toBeCloseTo(63 / 73, 10);
    expect(reading.sentence).toContain('86.3% of replies carried no visible character');
    expect(reading.sentence).toContain('73 call(s): 10 answered, 0 empty, 63 blank, 0 unparsed');
    expect(reading.sentence).toContain('A blank reply is the regime or the model, not the prompt');
  });

  it('reads a majority of empty replies as the writer choosing silence', () => {
    const reading = silenceOf(census({ calls: 10, answered: 4, empty: 6, chars: 900 }));
    expect(reading.state).toBe('mostly-empty');
    expect(reading.sentence).toContain('60.0% of replies parsed to an empty list');
    expect(reading.sentence).toContain('a finding about the corrections');
  });

  it('calls a half-blank log mostly blank rather than mixed, because the boundary is the claim', () => {
    const reading = silenceOf(census({ calls: 4, answered: 2, blank: 2, chars: 300 }));
    expect(reading.state).toBe('mostly-blank');
  });

  it('reads a log with four states and no majority as mixed rather than picking one', () => {
    const reading = silenceOf(census({ calls: 5, answered: 2, empty: 1, blank: 1, unparsed: 1, chars: 400 }));
    expect(reading.state).toBe('mixed');
    expect(reading.sentence).toContain('no state holds a majority');
  });

  it('does not call one blank reply in seventy-three a majority', () => {
    const reading = silenceOf(census({ calls: 73, answered: 71, blank: 1, unparsed: 1, chars: 40_000 }));
    expect(reading.state).toBe('mixed');
  });

  it('refuses a negative or fractional count rather than reporting a share of it', () => {
    const reading = silenceOf(census({ calls: -5, answered: 0, empty: 0, blank: 3, chars: 0 }));
    expect(reading.calls).toBe(0);
    expect(reading.state).toBe('unasked');
    expect(silenceOf(census({ calls: 7.9, answered: 0, blank: 8 })).calls).toBe(7);
  });
});

describe('the sentence a learn-only stop carries', () => {
  it('states that the stop is the delivery, and quotes the census', () => {
    const reason = learnOnlyReason(silenceOf(census({ calls: 73, answered: 10, blank: 63, chars: 6_824 })));
    expect(reason).toContain('the census is the reading and the score is not');
    expect(reason).toContain('63 blank');
  });
});
