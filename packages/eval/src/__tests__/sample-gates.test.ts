import { describe, expect, it } from 'vitest';
import { sampleGates, type SampleGateInput } from '../sample-gates.js';

/**
 * The two arms of an L4 dispatch are not graded against the same bar.
 *
 * Six consecutive `sota` runs concluded `failure` with the memory arm green, because the
 * memory-free reference arm was graded against `published + 5pp` — a bar a control cannot pass and
 * is not supposed to. The defect is not cosmetic: a status that is always red is a status nobody
 * reads, and the failures it exists to signal become indistinguishable from the expected one.
 */

const memory: SampleGateInput = {
  arm: 'memory',
  pass4: 0.5439,
  tasks: 57,
  unscored: 0,
  minTasks: 40,
  published: { meets: false },
  bar: 0.05,
};

function ids(gates: ReturnType<typeof sampleGates>): string[] {
  return gates.map((gate) => gate.id);
}

describe('the sample gates of one arm', () => {
  it('holds the memory arm to the published bar when one applies', () => {
    const gates = sampleGates(memory);
    expect(ids(gates)).toEqual(['l4-pass4', 'l4-coverage', 'l4-fully-scored']);
    expect(gates[0]?.pass).toBe(false);
    expect(gates[0]?.criterion).toBe('>= published + 0.05');
  });

  it('never holds the control to the treatment bar', () => {
    // The bar is a statement about the treatment. The control owes the pairing step a complete
    // per-task record instead, which is a different gate rather than no gate.
    const gates = sampleGates({ ...memory, arm: 'reference' });
    expect(ids(gates)).toEqual(['l4-control-arm', 'l4-coverage', 'l4-fully-scored']);
    expect(gates[0]?.pass).toBe(true);
  });

  it('omits the bar entirely when no published number applies to the scenario', () => {
    // Omitting a gate is a statement and not a pass: the metric carries `published_bar_applies: 0`.
    const gates = sampleGates({ ...memory, published: undefined });
    expect(ids(gates)).toEqual(['l4-coverage', 'l4-fully-scored']);
  });

  it('fails the control when it dropped a task the pairing step needs', () => {
    const gates = sampleGates({ ...memory, arm: 'reference', unscored: 3 });
    const control = gates.find((gate) => gate.id === 'l4-control-arm');
    expect(control?.pass).toBe(false);
    expect(control?.actual).toBe('57 scored, 3 unscored');
    // And the shared gate still says the same thing about the same number.
    expect(gates.find((gate) => gate.id === 'l4-fully-scored')?.pass).toBe(false);
  });

  it('fails the control when it scored nothing at all', () => {
    const gates = sampleGates({ ...memory, arm: 'reference', tasks: 0 });
    expect(gates.find((gate) => gate.id === 'l4-control-arm')?.pass).toBe(false);
    expect(gates.find((gate) => gate.id === 'l4-coverage')?.pass).toBe(false);
  });

  it('grades the wrapper-only arm as a control, with its own sentence', () => {
    // R101's arm carries the treatment's agent and none of its pack, so `published + 5pp` is not a
    // statement about it — and its job is still to hand the pairing step a complete per-task record,
    // which is what the control gate asks. Same gate, different sentence, because a reader who cannot
    // tell which control they are looking at cannot tell which half of R93's delta it explains.
    const gates = sampleGates({ ...memory, arm: 'scaffold' });
    expect(ids(gates)).toEqual(['l4-control-arm', 'l4-coverage', 'l4-fully-scored']);
    expect(gates[0]?.criterion).toBe(
      'the wrapper-only control scored every task it claims, so the pair separates the wrapper from the pack',
    );
    expect(sampleGates({ ...memory, arm: 'scaffold', unscored: 1 })[0]?.pass).toBe(false);
  });
});

/**
 * A planted distractor is the third kind of arm, and it needs the control's argument rather than the
 * treatment's.
 *
 * R57 plants one irrelevant rule per pack and asks what it costs. The `far` arm answered: `pass^4`
 * 0.5789 against a published 0.575, a paired ledger of 9 broken and 9 repaired episodes — net zero,
 * which is the reading the registration predicted. The `L4 arm` step concluded `failure` anyway,
 * because the published bar was applied to an arm whose own hypothesis is that it does not clear it.
 * An arm that was right and a status that says it was wrong is the same defect as a control failing a
 * bar no control can pass (six runs of it, one class of bug), and it was paid for twice in one round.
 */

const planted: SampleGateInput = { ...memory, planted: { arm: 'far' } };

describe('a planted distractor arm', () => {
  it('is not held to a published bar its own registration predicts it misses', () => {
    const gates = sampleGates(planted);
    expect(ids(gates)).toEqual(['l4-coverage', 'l4-fully-scored']);
    expect(gates.some((gate) => gate.id === 'l4-pass4')).toBe(false);
  });

  it('still owes the sample, because planting a distractor does not license a small one', () => {
    // The bar is the only gate a plant lifts. A ten-task arm is not evidence about anything, and the
    // one thing a distractor arm still has to do is be a complete measurement of itself.
    const gates = sampleGates({ ...planted, tasks: 12, unscored: 2 });
    expect(gates.find((gate) => gate.id === 'l4-coverage')?.pass).toBe(false);
    expect(gates.find((gate) => gate.id === 'l4-fully-scored')?.pass).toBe(false);
    expect(gates).toHaveLength(2);
  });

  it('leaves the memory arm holding the bar when it planted nothing', () => {
    // Keyed on the plant rather than on the environment: an arm that planted no distractor is the
    // treatment, and it is graded like one. `undefined` is the same statement as an absent key.
    expect(ids(sampleGates(memory))).toEqual(['l4-pass4', 'l4-coverage', 'l4-fully-scored']);
    expect(ids(sampleGates({ ...memory, planted: undefined }))).toEqual([
      'l4-pass4',
      'l4-coverage',
      'l4-fully-scored',
    ]);
  });

  it('is graded by its plant census and ledger, which is why nothing is left here', () => {
    // The gate is not replaced with a weaker one: what a planted arm owes is a plant share inside the
    // band and a paired excess, and both are graded by `eval/verifiers/r57_readback.py` against the
    // registration. Two gates is the whole content of this file's opinion about the arm.
    expect(sampleGates(planted).map((gate) => gate.criterion)).toEqual([
      '>= 40 tasks',
      '= 0 unscored tasks',
    ]);
  });
});
