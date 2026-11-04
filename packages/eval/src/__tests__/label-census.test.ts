import { describe, expect, it } from 'vitest';

import { labelCensus, readLabelCensusTasks, UPSTREAM_DEFAULT_BASIS } from '../label-census.js';

/**
 * The census is what a published benchmark's labels are, counted.
 *
 * Every case below is a claim about someone else's data that this repository intends to publish, so
 * the fields are separated by *what the reward reads*, not by what the file happens to contain: a
 * corpus can carry a thousand call lists and score none of them, and a census that reported "112
 * tasks have calls" without saying so would be describing the file, not the benchmark.
 */

const task = (
  id: string,
  fields: {
    actions?: number;
    assertions?: number;
    communicate?: number;
    basis?: readonly string[];
  } = {},
) => ({
  id,
  actions: Array.from({ length: fields.actions ?? 0 }, (_, index) => ({ name: `call_${String(index)}` })),
  assertions: Array.from({ length: fields.assertions ?? 0 }, (_, index) => `assertion ${String(index)}`),
  communicate: Array.from({ length: fields.communicate ?? 0 }, (_, index) => `fact ${String(index)}`),
  ...(fields.basis === undefined ? {} : { rewardBasis: fields.basis }),
});

describe('labelCensus', () => {
  it('reads an empty corpus as zeros rather than as an error', () => {
    expect(labelCensus([])).toEqual({
      tasks: 0,
      calls: 0,
      rubric: 0,
      communicate: 0,
      teachable: 0,
      unteachable: 0,
      silent: 0,
      declaredBasis: 0,
      pathScored: 0,
      rubricGraded: 0,
    });
  });

  it('counts each field by the tasks that carry it, not by the entries', () => {
    const census = labelCensus([
      task('a', { actions: 3 }),
      task('b', { assertions: 2 }),
      task('c', { communicate: 5 }),
      task('d'),
    ]);
    expect(census).toMatchObject({ tasks: 4, calls: 1, rubric: 1, communicate: 1, teachable: 2 });
  });

  it('separates a file with nothing in it from a task nothing can be learned from', () => {
    // A task that only lists facts to communicate is not empty, and it still teaches a learner
    // nothing: no call to have made differently, no rubric saying what should have been true. Both
    // numbers are needed — the first describes the corpus, the second bounds `unanswered`.
    const census = labelCensus([task('facts only', { communicate: 5 }), task('nothing')]);
    expect(census).toMatchObject({ communicate: 1, teachable: 0, unteachable: 2, silent: 1 });
  });

  it('treats a task that states both forms as one teachable task', () => {
    const census = labelCensus([task('a', { actions: 1, assertions: 1 })]);
    expect(census).toMatchObject({ calls: 1, rubric: 1, teachable: 1, silent: 0 });
  });

  it('does not call a call list trajectory-graded unless the basis asks for ACTION', () => {
    // `actions` still defines the target DB state on the default basis -- it is replayed to derive the
    // hash -- so this field is not "unread calls". It is the narrower fact: the label does not constrain
    // the path the agent walks, only where it ends up.
    const census = labelCensus([task('a', { actions: 2 }), task('b', { actions: 1, basis: ['DB'] })]);
    expect(census).toMatchObject({ calls: 2, pathScored: 0, declaredBasis: 1 });
    expect(UPSTREAM_DEFAULT_BASIS).not.toContain('ACTION');
  });

  it('counts a call list as trajectory-graded when the task declares ACTION itself', () => {
    const census = labelCensus([task('a', { actions: 2, basis: ['ACTION'] })]);
    expect(census.pathScored).toBe(1);
  });

  it('counts a prose rubric as graded only when the basis asks for NL_ASSERTION', () => {
    // The label that really is read by nothing by default: `nl_assertions` gates the reward only under
    // `NL_ASSERTION`, so a lesson distilled from prose is a claim about commentary, not about the score.
    const census = labelCensus([task('a', { assertions: 1 }), task('b', { assertions: 1, basis: ['NL_ASSERTION'] })]);
    expect(census).toMatchObject({ rubric: 2, rubricGraded: 1 });
  });

  it('reads a declared empty basis as scoring nothing, not as inheriting the default', () => {
    // `[]` is a statement; `undefined` is silence. Collapsing them would let a task that explicitly
    // opted out of every reward be reported as if it were measuring the database.
    const census = labelCensus([task('a', { actions: 1, assertions: 1, basis: [] })]);
    expect(census).toMatchObject({ declaredBasis: 1, pathScored: 0, rubricGraded: 0 });
  });

  it('counts only the tasks that state a basis as declared', () => {
    const census = labelCensus([task('a', { basis: ['DB'] }), task('b'), task('c', { basis: [] })]);
    expect(census.declaredBasis).toBe(2);
    expect(census).toMatchObject({ pathScored: 0, rubricGraded: 0 });
  });

  it('separates a corpus that states no calls from one that states no text at all', () => {
    // These are different failures of the record and they cost a learner differently: a rubric-only
    // task can still be learned as a procedure, and a silent task cannot be learned at all.
    const census = labelCensus([task('a', { assertions: 1 }), task('b'), task('c', { actions: 1 })]);
    expect(census).toMatchObject({ rubric: 1, calls: 1, teachable: 2, unteachable: 1, silent: 1 });
  });
});

describe('readLabelCensusTasks', () => {
  const entry = {
    id: 'retail/0',
    evaluation_criteria: {
      actions: [{ name: 'find_user_id_by_name_zip', arguments: {} }],
      nl_assertions: ['the order is cancelled'],
      communicate_info: ['the refund takes five days'],
      reward_basis: ['DB', 'ACTION'],
    },
  };

  it('reads a bare task list, which is how the domain files ship', () => {
    const [task] = readLabelCensusTasks([entry]);
    expect(task).toMatchObject({ id: 'retail/0', rewardBasis: ['DB', 'ACTION'] });
    expect(task?.actions).toHaveLength(1);
    expect(task?.assertions).toEqual(['the order is cancelled']);
    expect(task?.communicate).toEqual(['the refund takes five days']);
  });

  it('reads a document that wraps the list in `tasks`, which is how a results file ships', () => {
    expect(readLabelCensusTasks({ tasks: [entry] }).map((task) => task.id)).toEqual(['retail/0']);
  });

  it('reads absent fields as absent rather than inventing an empty basis', () => {
    const [task] = readLabelCensusTasks([{ id: 'x', evaluation_criteria: { actions: [] } }]);
    expect(task?.rewardBasis).toBeUndefined();
    expect(task?.assertions).toEqual([]);
    expect(task?.communicate).toEqual([]);
  });

  it('refuses a document that is neither shape', () => {
    expect(() => readLabelCensusTasks({ rows: [] })).toThrow(/neither a task list/);
    expect(() => readLabelCensusTasks(42)).toThrow(/neither a task list/);
  });

  it('refuses an entry with no id, because a census of anonymous tasks cannot be audited', () => {
    expect(() => readLabelCensusTasks([{ evaluation_criteria: {} }])).toThrow(/no id/);
  });

  it('refuses an entry that is not an object', () => {
    expect(() => readLabelCensusTasks([42])).toThrow(/not an object/);
  });

  it('reads a task with no criteria at all as carrying nothing', () => {
    // Every field of `evaluation_criteria` is optional upstream, so a task can legitimately arrive
    // with none of them. That is the shape an unlabelled task has, and the census has to count it as
    // unteachable rather than fail the corpus.
    const [task] = readLabelCensusTasks([{ id: 'bare' }]);
    expect(task).toEqual({ id: 'bare', actions: [], assertions: [], communicate: [] });
  });

  it('refuses a basis that is not a list, rather than reading it as silence', () => {
    expect(() => readLabelCensusTasks([{ id: 'x', evaluation_criteria: { reward_basis: 'DB' } }])).toThrow(
      /reward_basis/,
    );
  });
});
