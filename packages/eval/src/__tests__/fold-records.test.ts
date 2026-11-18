import { describe, expect, it } from 'vitest';
import { foldRecordsLine, foldRecordsOf, type FoldInput } from '../fold-records.js';

/**
 * The composition of two pair artefacts into two fold records.
 *
 * Every case here is a way the composition can be wrong while still producing two files: a sibling's half used
 * as a learning half on a corpus the two folds do not tile, a treatment carried from a fold that ran another
 * one, a ledger that counts trials as tasks. The tool writes files that a cross-fit then trusts, so each refusal
 * has to name the fold and the ids.
 */

function rows(prefix: string, ids: readonly string[]): FoldInput['ledger'] {
  return ids.map((id) => ({ task: `${prefix}${id}`, blankCorrect: true, withMemoryCorrect: true }));
}

/** A fold whose own artefact states both halves, which is what a post-R152 run writes. */
function stating(input: {
  readonly label: string;
  readonly train: readonly string[];
  readonly test: readonly string[];
  readonly treatment?: FoldInput['treatment'];
}): FoldInput {
  return {
    label: input.label,
    ledger: rows('', input.test),
    split: { learned: input.train, evaluated: input.test },
    ...(input.treatment === undefined ? {} : { treatment: input.treatment }),
  };
}

/** A fold from an artefact written before the guards were fixed: ledger only. */
function silent(input: { readonly label: string; readonly test: readonly string[] }): FoldInput {
  return { label: input.label, ledger: rows('', input.test) };
}

const TREATMENT = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-chat', knobs: '' };

describe('foldRecordsOf', () => {
  it('states both folds from one artefact that states its split and one that does not', () => {
    // The R143 shape: the `swapped` fold states 40 learn / 74 test, the `official` fold states neither and
    // repeats the other half. Both records have to end up with a learning half the pool can check a leak against.
    const official = silent({ label: 'official', test: ['t1', 't2'] });
    const swapped = stating({ label: 'swapped', train: ['t1', 't2'], test: ['t3', 't4', 't5'], treatment: TREATMENT });
    const outcome = foldRecordsOf([official, swapped]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    const [first, second] = outcome.records;
    expect(first?.foldSplit).toEqual({ learned: ['t3', 't4', 't5'], evaluated: ['t1', 't2'] });
    expect(second?.foldSplit).toEqual({ learned: ['t1', 't2'], evaluated: ['t3', 't4', 't5'] });
    expect(first?.treatment).toEqual(TREATMENT);
    expect(first?.derivation.join(' ')).toContain("learned: the sibling fold's evaluated half");
  });

  it('carries each field the silent artefact does not state, and says which fold stated it', () => {
    const official: FoldInput = { label: 'official', ledger: rows('', ['t1']), treatment: { unit: 'correction', model: 'deepseek/deepseek-chat' } };
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t2'], treatment: TREATMENT });
    const outcome = foldRecordsOf([official, swapped]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    // The fold that states the field wins it, and a field only one fold states is carried rather than refused:
    // the alternative is claiming two treatments on the strength of an older artefact.
    expect(outcome.records[0]?.treatment).toEqual(TREATMENT);
    expect(outcome.records[0]?.derivation.join(' ')).toContain('form: carried from swapped');
  });

  it('refuses two folds of two treatments, whatever their halves look like', () => {
    const official = stating({ label: 'official', train: ['t3'], test: ['t1'], treatment: { ...TREATMENT, model: 'deepseek/deepseek-flash' } });
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT });
    expect(foldRecordsOf([official, swapped])).toEqual({
      ok: false,
      refusals: ["the folds are two experiments, not one corpus: model is 'deepseek/deepseek-flash' on official and 'deepseek/deepseek-chat' on swapped"],
    });
  });

  it('refuses a rotation fold and an unbounded fold as two treatments', () => {
    // R152. The composition is where two pair artefacts become one claim, so the policy that bounds how far an
    // item travels has to be compared here and not only in the pool: a fold record that dropped it would hand the
    // pool two folds that look identical.
    const official = stating({
      label: 'official',
      train: ['t3'],
      test: ['t1'],
      treatment: { ...TREATMENT, rotation: 'fair-share' },
    });
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT });
    expect(foldRecordsOf([official, swapped])).toEqual({
      ok: false,
      refusals: [
        "the folds are two experiments, not one corpus: rotation is 'fair-share' on official and unstated on " +
          'swapped — a field whose absence is the control may not be carried',
      ],
    });
  });

  it('carries the serving policy into the record when both folds declared one', () => {
    const official = stating({
      label: 'official',
      train: ['t3'],
      test: ['t1'],
      treatment: { ...TREATMENT, rotation: 'fair-share' },
    });
    const swapped = stating({
      label: 'swapped',
      train: ['t1'],
      test: ['t3'],
      treatment: { ...TREATMENT, rotation: 'fair-share' },
    });
    const outcome = foldRecordsOf([official, swapped]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(outcome.records[0]?.treatment.rotation).toBe('fair-share');
    expect(outcome.records[1]?.treatment.rotation).toBe('fair-share');
  });

  it('refuses when neither artefact states a treatment, rather than pooling two unrecorded runs', () => {
    const outcome = foldRecordsOf([
      stating({ label: 'official', train: ['t3'], test: ['t1'] }),
      stating({ label: 'swapped', train: ['t1'], test: ['t3'] }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('neither artefact states a treatment');
  });

  it('refuses two folds that do not tile, and names how many ids fell outside', () => {
    // The sibling's evaluated half is only a learning half if it is the other side of one boundary: an id the
    // sibling never answered is a task this fold claims to have learned from and nobody evaluated. One sentence,
    // because the relation is symmetric and each fold that states its half is checked once.
    const official = stating({ label: 'official', train: ['t4'], test: ['t1'] });
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT });
    const outcome = foldRecordsOf([official, swapped]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals).toEqual([
      "the folds do not tile: 'official' learned 1 task(s) of which 1 were not answered by 'swapped'",
    ]);
  });

  it('refuses a fold that evaluates a task it learned from, which is the leak the design excludes', () => {
    const leaky = stating({ label: 'official', train: ['t1', 't3'], test: ['t1'] });
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT });
    const outcome = foldRecordsOf([leaky, swapped]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("fold 'official' evaluates 1 task(s) it learned from: t1");
  });

  it('refuses a ledger that lists two rows for one task, because the pool counts tasks', () => {
    const doubled: FoldInput = {
      label: 'official',
      ledger: [
        { task: 't1', blankCorrect: true, withMemoryCorrect: true },
        { task: 't1', blankCorrect: false, withMemoryCorrect: true },
      ],
      split: { learned: ['t3'], evaluated: ['t1'] },
      treatment: TREATMENT,
    };
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT });
    const outcome = foldRecordsOf([doubled, swapped]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('lists 2 row(s) over 1 task(s)');
  });

  it('refuses a fold whose stated evaluation half disagrees with its own ledger', () => {
    const mismatched = stating({ label: 'official', train: ['t3'], test: ['t1'] });
    const lying: FoldInput = { ...mismatched, split: { learned: ['t3'], evaluated: ['t1', 't9'] } };
    const swapped = stating({ label: 'swapped', train: ['t1', 't9'], test: ['t3'], treatment: TREATMENT });
    const outcome = foldRecordsOf([lying, swapped]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('states it evaluated 2 task(s) but its ledger holds 1');
  });

  it('refuses one fold, an empty ledger, and three folds, because a cross-fit is two halves', () => {
    const one = foldRecordsOf([stating({ label: 'official', train: ['t3'], test: ['t1'] })]);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.refusals[0]).toContain('a cross-fit is two folds, and 1 were given');

    const three = foldRecordsOf([
      stating({ label: 'a', train: ['t3'], test: ['t1'] }),
      stating({ label: 'b', train: ['t1'], test: ['t3'] }),
      stating({ label: 'c', train: ['t1'], test: ['t3'] }),
    ]);
    expect(three.ok).toBe(false);
    if (!three.ok) expect(three.refusals[0]).toContain('and 3 were given');

    const empty = foldRecordsOf([
      { label: 'official', ledger: [] },
      stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT }),
    ]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.refusals.join(' ')).toContain("fold 'official' carries no ledger, so it measured nothing");
  });

  it('keeps the ledger verbatim and the source, so a fold record can be traced to its dispatch', () => {
    const official: FoldInput = {
      label: 'official',
      ledger: [
        { task: 't1', blankCorrect: false, withMemoryCorrect: true },
        { task: 't2', blankCorrect: true, withMemoryCorrect: false },
      ],
      source: 'run 44318618847',
    };
    const swapped = stating({ label: 'swapped', train: ['t1', 't2'], test: ['t3'], treatment: TREATMENT });
    const outcome = foldRecordsOf([official, swapped]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(outcome.records[0]?.ledger).toEqual(official.ledger);
    expect(outcome.records[0]?.source).toBe('run 44318618847');
    expect(outcome.records[0]?.id).toBe('official');
  });

  it('prints one line per fold, with the halves and the treatment a reader checks first', () => {
    const outcome = foldRecordsOf([
      silent({ label: 'official', test: ['t1'] }),
      stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: TREATMENT }),
    ]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(foldRecordsLine(outcome.records)).toBe(
      '[fold-records] official: learned 1 / evaluated 1, treatment correction/lesson/all\n' +
        '[fold-records] swapped: learned 1 / evaluated 1, treatment correction/lesson/all',
    );
  });

  it('states a silent fold that comes second as well as one that comes first', () => {
    // Argument order is the operator's, not the corpus's: the run that was fixed second may be passed first, and
    // a derivation that only worked for index 0 would be a tool that silently depends on how it was called.
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ['t2'], treatment: TREATMENT });
    const official = silent({ label: 'official', test: ['t1'] });
    const outcome = foldRecordsOf([swapped, official]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(outcome.records[1]?.foldSplit).toEqual({ learned: ['t2'], evaluated: ['t1'] });
  });

  it('names how many ids it did not print, so a leak of forty stays one sentence', () => {
    // A refusal a reader has to scroll is a refusal they skip. The count is what they act on, and it is the only
    // part of a long list that survives being one line.
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    const leaky = stating({ label: 'official', train: ids, test: ids });
    const swapped = stating({ label: 'swapped', train: ['t1'], test: ids, treatment: TREATMENT });
    const outcome = foldRecordsOf([leaky, swapped]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('t1, t2, t3, t4, t5, and 2 more');
  });

  it('carries a numeric ceiling and prints unstated for the fields nobody stated', () => {
    // `traceClaims` is a number and every other field is a string, so the carry has to survive both types; the
    // line then has to say "unstated" rather than print a dash a reader would read as zero.
    const outcome = foldRecordsOf([
      stating({ label: 'official', train: ['t2'], test: ['t1'], treatment: { traceClaims: 400 } }),
      stating({ label: 'swapped', train: ['t1'], test: ['t2'], treatment: { traceClaims: 400, model: 'deepseek/deepseek-chat' } }),
    ]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(outcome.records[0]?.treatment).toEqual({ traceClaims: 400, model: 'deepseek/deepseek-chat' });
    expect(foldRecordsLine(outcome.records)).toContain('treatment unstated/unstated/unstated');
  });

  it('names an unstated treatment field rather than printing a dash', () => {
    const outcome = foldRecordsOf([
      silent({ label: 'official', test: ['t1'] }),
      stating({ label: 'swapped', train: ['t1'], test: ['t3'], treatment: { unit: 'correction' } }),
    ]);
    if (!outcome.ok) throw new Error(outcome.refusals.join('; '));
    expect(foldRecordsLine(outcome.records)).toContain('treatment correction/unstated/unstated');
  });
});
