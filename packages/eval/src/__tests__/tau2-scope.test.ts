/**
 * R62 — the switch, and the values it refuses.
 *
 * Three cases are the substance: unset means the scope every published arm measured, the two legal
 * spellings are read case- and whitespace-insensitively because a workflow variable arrives from a
 * form, and anything else **throws**.
 *
 * The throw is the difference between this resolver and `resolveDistillForm`'s, and it is the reason
 * these cases exist at all: a form whose name is misspelt still measures *a* form and the artefact
 * says which one ran, while a scope whose name is misspelt measures the control and reports the
 * control's numbers under a treatment's name. There is no reading of a typo that is not a false
 * reading, so the only safe answer is to refuse before the first model call.
 */
import { describe, expect, it } from 'vitest';
import { resolveDistillScope } from '../tau2-scope.js';

describe('resolveDistillScope', () => {
  it('reads an unset variable as the scope every published arm measured', () => {
    expect(resolveDistillScope(undefined)).toBe('edited');
    expect(resolveDistillScope('')).toBe('edited');
  });

  it('reads both legal spellings, whatever case and padding the form sent', () => {
    expect(resolveDistillScope('edited')).toBe('edited');
    expect(resolveDistillScope(' all ')).toBe('all');
    expect(resolveDistillScope('ALL')).toBe('all');
    expect(resolveDistillScope('\tedited\n')).toBe('edited');
  });

  it('refuses a value it does not know, naming the value it received', () => {
    expect(() => resolveDistillScope('everything')).toThrow(RangeError);
    expect(() => resolveDistillScope('everything')).toThrow(
      "TAU_DISTILL_SCOPE must be unset, 'edited' or 'all'; received 'everything'",
    );
  });

  it('does not read `correction` as a scope, though it is a unit', () => {
    // The two switches sit beside each other in the environment and in the artefact, and the near-miss
    // has to be refused rather than guessed: `correction` is `TAU_DISTILL_UNIT`'s word, and a run that
    // put it in the scope variable would silently measure the published population.
    expect(() => resolveDistillScope('correction')).toThrow(RangeError);
  });
});
