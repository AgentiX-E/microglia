import { describe, expect, it } from 'vitest';
import { speakLineOf, type RecallTraffic } from '../tau2-speak.js';

const traffic = (overrides: Partial<RecallTraffic> = {}): RecallTraffic => ({
  recalls: 168,
  recall_failures: 0,
  recall_empty: 7,
  silent_because: { 'no-leader': 7 },
  ...overrides,
});

describe('the speak line partitions the requests the facade saw', () => {
  it('prints the served, the withheld and the failed, and the reasons behind the withheld', () => {
    const line = speakLineOf(0.05, traffic());
    expect(line).toContain('margin 0.05');
    expect(line).toContain('168 request(s) reached the facade');
    expect(line).toContain('161 served');
    expect(line).toContain('7 withheld');
    expect(line).toContain('no-leader 7');
    expect(line).toContain('0 failed');
  });

  it('says the default is the default, so a zero cannot be read as a settled floor', () => {
    expect(speakLineOf(0, traffic())).toContain('every non-empty pack is served');
  });

  it('names every bucket, in a stable order', () => {
    const line = speakLineOf(
      0.05,
      traffic({
        recall_empty: 9,
        silent_because: { unattributed: 2, 'no-leader': 7 },
      }),
    );
    expect(line).toContain('no-leader 7, unattributed 2');
  });

  it('counts a failure as neither served nor withheld', () => {
    // A request that threw is not a pack the gate refused: the partition would credit the gate with an
    // infrastructure fact.
    const line = speakLineOf(0.05, traffic({ recall_failures: 3, recalls: 170 }));
    expect(line).toContain('160 served');
    expect(line).toContain('3 failed');
  });

  it('omits the parenthetical when nothing was withheld, rather than printing empty brackets', () => {
    const line = speakLineOf(0, traffic({ recall_empty: 0, silent_because: {} }));
    expect(line).toContain('0 withheld, 0 failed');
    expect(line).not.toContain('()');
  });

  it('states that it cannot say, rather than printing zero, when the phase kept no counters', () => {
    for (const absent of [undefined, null]) {
      const line = speakLineOf(0, absent);
      expect(line).toContain('cannot say how many packs the gate withheld');
      expect(line).not.toContain('0 withheld');
    }
  });
});
