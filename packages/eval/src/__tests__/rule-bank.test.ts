/**
 * The bank arithmetic, tested on the three places it can quietly differ from the original.
 *
 * `rule-bank.ts` ports a competitor's update rule, so the tests are not about this project's intent —
 * they are about whether the port is the same function. Three of them pin a behaviour that looks like
 * a defect and is kept because the port would otherwise stop being a control: identity is
 * one-directional, the banned-word filter works on substrings rather than tokens, and the cap evicts
 * nothing. A fourth pins the one place the port deliberately refuses to follow.
 */
import { describe, expect, it } from 'vitest';
import {
  ADD_VOTES,
  OVERFLOW_MARGIN,
  OVERFLOW_PENALTY,
  findRule,
  mergeOperations,
  normalizeTokens,
  parseOperations,
  renderable,
  sameRule,
  type Entry,
} from '../rule-bank.js';

const bankOf = (...texts: string[]): Entry[] => texts.map((text) => ({ text, votes: ADD_VOTES }));

describe('parseOperations', () => {
  it('reads the four operations, numbered or not', () => {
    const reply = [
      'ADD: Always check the lamp before leaving the room.',
      'AGREE 2: Always check the lamp before leaving the room.',
      'EDIT 1: Open the fridge before taking the apple.',
      'REMOVE 3: Never open the microwave first.',
    ].join('\n');
    expect(parseOperations(reply)).toEqual([
      { kind: 'ADD', number: null, text: 'Always check the lamp before leaving the room.' },
      { kind: 'AGREE', number: 2, text: 'Always check the lamp before leaving the room.' },
      { kind: 'EDIT', number: 1, text: 'Open the fridge before taking the apple.' },
      { kind: 'REMOVE', number: 3, text: 'Never open the microwave first.' },
    ]);
  });

  it('strips a label prefix, and cannot eat a sentence boundary doing it', () => {
    // `[a-zA-Z\s\d]+` excludes the period, so the first case loses its label and the second keeps
    // everything after `ADD:` because `Take the apple` contains one.
    expect(parseOperations('ADD: Rule: reach the fridge.')[0]?.text).toBe('reach the fridge.');
    expect(parseOperations('ADD: Take the apple. Note: it is red.')[0]?.text).toBe(
      'Take the apple. Note: it is red.',
    );
  });

  it('drops a rule whose text merely contains a banned word', () => {
    // The filter is `word in body`, so an imperative that happens to start with ADDITIONAL is
    // discarded and the reply loses a rule it meant to add. Kept, because it is the original's.
    expect(parseOperations('ADD: ADDITIONAL care is needed near the sink.')).toEqual([]);
    expect(parseOperations('ADD: The EDITED copy must be placed on the desk.')).toEqual([]);
    expect(parseOperations('ADD: A rule AGREED by both trials is kept.')).toEqual([]);
    // `REMOVE` is not on the banned list, so a rule about removal survives.
    expect(parseOperations('ADD: REMOVE the wrapper before heating.')).toHaveLength(1);
  });

  it('drops an empty body and a body that is not a finished sentence', () => {
    expect(parseOperations('ADD: ')).toEqual([]);
    expect(parseOperations('ADD: take the apple')).toEqual([]);
    expect(parseOperations('ADD: take the apple.')).toHaveLength(1);
  });

  it('does not carry state between two parses of the same text', () => {
    // A module-level `g` regex would return nothing the second time. The source is a string for this.
    const reply = 'ADD: take the apple.';
    expect(parseOperations(reply)).toHaveLength(1);
    expect(parseOperations(reply)).toHaveLength(1);
  });

  it('ignores prose that is not an operation', () => {
    expect(parseOperations('Here is what I learned.\nIt was useful.')).toEqual([]);
  });
});

describe('normalizeTokens', () => {
  it('forgets case, punctuation, order and repetition', () => {
    const a = normalizeTokens('Check the lamp first.');
    const b = normalizeTokens('first, check the LAMP — the lamp.');
    expect(a).toBe(b);
  });

  it('keeps words that differ', () => {
    expect(normalizeTokens('check the lamp.')).not.toBe(normalizeTokens('check the sink.'));
  });

  it('reduces to the empty string when there is nothing alphabetic', () => {
    expect(normalizeTokens('  ---  ')).toBe('');
  });
});

describe('sameRule', () => {
  it('exact sees only a verbatim restatement', () => {
    expect(sameRule('take the apple.', 'take the apple.', 'exact')).toBe(true);
    expect(sameRule('take the apple.', 'Take the apple.', 'exact')).toBe(false);
  });

  it('substring is one-directional, which is what the original is', () => {
    // Containment has to be at the end, because every rule carries its closing period: `check the
    // lamp.` sits inside `Always check the lamp.` and does not sit inside `check the lamp soon.`
    expect(sameRule('check the lamp.', 'Always check the lamp.', 'substring')).toBe(true);
    // The reverse is a different rule as far as this test is concerned: a shortening is not seen.
    expect(sameRule('Always check the lamp.', 'check the lamp.', 'substring')).toBe(false);
    expect(sameRule('check the lamp.', 'check the lamp soon.', 'substring')).toBe(false);
  });

  it('tokens sees both directions and the reordering', () => {
    expect(sameRule('take the apple before the knife.', 'Take the apple.', 'tokens')).toBe(false);
    expect(sameRule('check the lamp first.', 'First check the lamp.', 'tokens')).toBe(true);
  });
});

describe('findRule', () => {
  it('takes the first match, not the best one', () => {
    const bank = bankOf('check the lamp.', 'Always check the lamp.');
    // Both entries contain the query, and the first is returned even though the second is an exact
    // restatement of it.
    expect(findRule(bank, 'Always check the lamp.', 'substring')).toBe(0);
    expect(findRule(bank, 'Always check the lamp.', 'exact')).toBe(1);
  });

  it('returns -1 when nothing matches', () => {
    expect(findRule(bankOf('take the apple.'), 'open the fridge.', 'substring')).toBe(-1);
  });
});

describe('mergeOperations', () => {
  it('refuses a restatement of what the bank already holds', () => {
    const bank = bankOf('take the apple.');
    const report = mergeOperations(bank, [
      { kind: 'ADD', number: null, text: 'take the apple.' },
      { kind: 'ADD', number: null, text: 'Always take the apple.' },
    ]);
    expect(report.bank).toEqual([{ text: 'take the apple.', votes: ADD_VOTES }]);
    expect(report.rejected).toBe(2);
    expect(report.applied).toBe(0);
  });

  it('does deduplicate two identical adds inside one reply, because it does not', () => {
    // The fourth weakness in the header table, pinned as behaviour: the pre-pass resolves every add
    // against the *incoming* bank, so neither sees the other and both land.
    const report = mergeOperations([], [
      { kind: 'ADD', number: null, text: 'take the apple.' },
      { kind: 'ADD', number: null, text: 'take the apple.' },
    ]);
    expect(report.bank).toHaveLength(2);
    expect(report.rejected).toBe(0);
  });

  it('agrees for one and edits for one, by text and by number', () => {
    const bank = bankOf('take the apple.', 'open the fridge.');
    const report = mergeOperations(bank, [
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
      { kind: 'EDIT', number: 2, text: 'open the fridge before the apple.' },
    ]);
    expect(report.bank).toEqual([
      { text: 'take the apple.', votes: ADD_VOTES + 1 },
      { text: 'open the fridge before the apple.', votes: ADD_VOTES + 1 },
    ]);
    expect(report.rejected).toBe(0);
  });

  it('turns an edit whose text already exists into an agreement', () => {
    const bank = bankOf('take the apple.', 'open the fridge first.');
    const report = mergeOperations(bank, [
      { kind: 'EDIT', number: 2, text: 'Always take the apple.' },
    ]);
    // The substring identity sees `take the apple.` inside the new text, so the edit is an agreement
    // on rule one and rule two is untouched — the rule the number named is not the rule that moves.
    expect(report.bank).toEqual([
      { text: 'take the apple.', votes: ADD_VOTES + 1 },
      { text: 'open the fridge first.', votes: ADD_VOTES },
    ]);
    expect(report.applied).toBe(1);
  });

  it('rejects an edit that names a rule outside the bank, including number zero', () => {
    const bank = bankOf('take the apple.');
    expect(mergeOperations(bank, [{ kind: 'EDIT', number: 4, text: 'x.' }]).rejected).toBe(1);
    expect(mergeOperations(bank, [{ kind: 'EDIT', number: 0, text: 'x.' }]).rejected).toBe(1);
    expect(mergeOperations(bank, [{ kind: 'EDIT', number: null, text: 'x.' }]).rejected).toBe(1);
    // And the divergence from the original, stated: Python's `rules[-1]` would have edited rule one.
    expect(mergeOperations(bank, [{ kind: 'EDIT', number: 0, text: 'x.' }]).bank).toEqual(bank);
  });

  it('removes for one, and culls at zero', () => {
    const bank = bankOf('take the apple.');
    const once = mergeOperations(bank, [{ kind: 'REMOVE', number: 1, text: 'take the apple.' }]);
    expect(once.bank).toEqual([{ text: 'take the apple.', votes: ADD_VOTES - 1 }]);
    expect(once.culled).toBe(0);
    const twice = mergeOperations(once.bank, [
      { kind: 'REMOVE', number: 1, text: 'take the apple.' },
    ]);
    expect(twice.bank).toEqual([]);
    expect(twice.culled).toBe(1);
  });

  it('charges three for a removal once the bank is past the cap plus the margin', () => {
    const texts = Array.from({ length: OVERFLOW_MARGIN + 1 }, (_, index) => `rule ${index}.`);
    // Support starts at five, because a rule at two votes would be culled by a −3 and the reading
    // would then be about the cull rather than about the penalty.
    const bank = texts.map((text) => ({ text, votes: 5 }));
    const report = mergeOperations(
      bank,
      [{ kind: 'REMOVE', number: 1, text: 'rule 0.' }],
      { cap: 1 },
    );
    // 1 + 5 <= 6, so the bank is over its margin and the removal costs three rather than one.
    expect(report.bank.find((entry) => entry.text === 'rule 0.')?.votes).toBe(5 - OVERFLOW_PENALTY);
    // And a rule at two votes in the same state is culled by that same removal, which is the reason
    // the penalty exists: it is a pressure, not a deletion.
    const thin = mergeOperations(
      texts.map((text) => ({ text, votes: ADD_VOTES })),
      [{ kind: 'REMOVE', number: 1, text: 'rule 0.' }],
      { cap: 1 },
    );
    expect(thin.bank.some((entry) => entry.text === 'rule 0.')).toBe(false);
    expect(thin.culled).toBe(1);
  });

  it('charges one when no cap is declared, however large the bank', () => {
    const texts = Array.from({ length: 40 }, (_, index) => `rule ${index}.`);
    const report = mergeOperations(bankOf(...texts), [
      { kind: 'REMOVE', number: 1, text: 'rule 0.' },
    ]);
    expect(report.bank.find((entry) => entry.text === 'rule 0.')?.votes).toBe(ADD_VOTES - 1);
  });

  it('rejects a removal or agreement that names a rule the bank does not hold', () => {
    const bank = bankOf('take the apple.');
    expect(mergeOperations(bank, [{ kind: 'REMOVE', number: 1, text: 'open the fridge.' }]).rejected).toBe(1);
    expect(mergeOperations(bank, [{ kind: 'AGREE', number: 1, text: 'open the fridge.' }]).rejected).toBe(1);
  });

  it('applies removals before agreements before edits before adds', () => {
    // One reply that agrees once and removes three times: 2 + 1 − 1 − 1 − 1 = 0, which culls the
    // rule. Applying the agreement after the removals, or the additions before either, moves the net.
    const bank = bankOf('take the apple.');
    const report = mergeOperations(bank, [
      { kind: 'ADD', number: null, text: 'open the fridge.' },
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
      { kind: 'REMOVE', number: 1, text: 'take the apple.' },
      { kind: 'REMOVE', number: 1, text: 'take the apple.' },
      { kind: 'REMOVE', number: 1, text: 'take the apple.' },
    ]);
    expect(report.bank).toEqual([{ text: 'open the fridge.', votes: ADD_VOTES }]);
    expect(report.culled).toBe(1);
  });

  it('adds last, so an agreement cannot land on a rule the same reply added', () => {
    const report = mergeOperations([], [
      { kind: 'ADD', number: null, text: 'take the apple.' },
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
    ]);
    expect(report.bank).toEqual([{ text: 'take the apple.', votes: ADD_VOTES }]);
    expect(report.rejected).toBe(1);
  });

  it('sorts by votes and keeps the entry order on a tie', () => {
    const bank = bankOf('first.', 'second.', 'third.');
    const report = mergeOperations(bank, [
      { kind: 'AGREE', number: 1, text: 'third.' },
      { kind: 'AGREE', number: 2, text: 'third.' },
    ]);
    expect(report.bank.map((entry) => entry.text)).toEqual(['third.', 'first.', 'second.']);
  });

  it('reports the peak, which is where a soft cap shows up', () => {
    // Nothing in the arithmetic evicts when the bank passes its cap, so a long run of adds grows the
    // bank without bound and `renderable` is the only thing that keeps the prompt small.
    const report = mergeOperations([], [
      { kind: 'ADD', number: null, text: 'a.' },
      { kind: 'ADD', number: null, text: 'b.' },
      { kind: 'ADD', number: null, text: 'c.' },
    ], { cap: 2 });
    expect(report.peak).toBe(3);
    expect(renderable(report.bank, 2)).toHaveLength(2);
  });

  it('does not mutate the bank it was given', () => {
    const bank = bankOf('take the apple.');
    const before = JSON.stringify(bank);
    mergeOperations(bank, [{ kind: 'AGREE', number: 1, text: 'take the apple.' }]);
    expect(JSON.stringify(bank)).toBe(before);
  });

  it('counts an operation whose entry vanished mid-merge as rejected', () => {
    // Two edits that resolve to the same index and one removal of it: the second edit still finds a
    // counter to move, so nothing vanishes. What this pins is that the index arithmetic survives a
    // reply that names the same rule four times over.
    const bank = bankOf('take the apple.');
    const report = mergeOperations(bank, [
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
      { kind: 'AGREE', number: 1, text: 'take the apple.' },
    ]);
    expect(report.bank).toEqual([{ text: 'take the apple.', votes: ADD_VOTES + 4 }]);
    expect(report.rejected).toBe(0);
  });
});

describe('renderable', () => {
  it('returns the whole bank when no cap is declared', () => {
    const bank = bankOf('a.', 'b.', 'c.');
    expect(renderable(bank, null)).toBe(bank);
  });

  it('truncates to the cap when one is', () => {
    const bank = bankOf('a.', 'b.', 'c.');
    expect(renderable(bank, 2).map((entry) => entry.text)).toEqual(['a.', 'b.']);
    expect(renderable(bank, 0)).toEqual([]);
  });
});
