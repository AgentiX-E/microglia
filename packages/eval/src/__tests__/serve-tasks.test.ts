import { describe, expect, it } from 'vitest';
import { serveTaskCensus, serveTaskLine } from '../serve-tasks.js';
import { serveYieldCensus, type ServeRender } from '../serve-yield.js';

/**
 * The population axis of the same renders.
 *
 * `serveYieldCensus` asks what a *record* did with what it was given. This asks the complementary question:
 * where did the harm land? A store that breaks one task of a hundred and a store that breaks one trial of a
 * hundred are the same `breaks` count and different diseases — the first is a retrieval that reaches a task
 * family it has nothing to say about, the second is interference with a single episode. R141 could not tell
 * them apart because a render carried no task id, and the id is what R148 puts on it.
 */
const render = (itemId: string, controlPassed: boolean, memoryPassed: boolean, task?: string): ServeRender =>
  task === undefined ? { itemId, controlPassed, memoryPassed } : { itemId, controlPassed, memoryPassed, task };

describe('serveTaskCensus', () => {
  it('groups renders by the task they were served into, and counts the ones that name none', () => {
    const census = serveTaskCensus([
      render('a', false, true, 't1'),
      render('a', true, false, 't1'),
      render('b', false, true, 't2'),
      // An artefact written before the task id was carried: it must be counted, not silently attached to the
      // first task or dropped, because a census that reports a population it did not read is the defect this
      // lane keeps deleting.
      render('b', false, false),
    ]);
    expect(census.rendered).toBe(3);
    expect(census.unattributed).toBe(1);
    expect(census.tasks).toHaveLength(2);
    const first = census.tasks.find((task) => task.taskId === 't1');
    expect(first).toMatchObject({ renders: 2, items: 1, repairs: 1, breaks: 1, opportunity: 1, inert: 0, net: 0 });
    const second = census.tasks.find((task) => task.taskId === 't2');
    expect(second).toMatchObject({ renders: 1, items: 1, repairs: 1, breaks: 0, opportunity: 1, net: 1 });
  });

  it('counts a record served twice into one task once, because a task was reached by two records or one', () => {
    // The record count is the set of ids, not the number of requests: a store that reaches task `t1` with the
    // same record at two boundaries is one record on one task, and the render count already says it was two.
    const census = serveTaskCensus([
      render('a', false, true, 't1'),
      render('a', false, true, 't1'),
      render('b', false, true, 't1'),
    ]);
    // Three renders, because the same record was served at two boundaries; two records, because the store
    // reached the task with two different records; three repairs, because all three renders landed on a trial
    // the reference arm had failed.
    expect(census.tasks[0]).toMatchObject({ taskId: 't1', renders: 3, items: 2, repairs: 3, opportunity: 3 });
  });

  it('marks a task that was both repaired and broken as contested, even when its net is zero', () => {
    // Net zero is two different readings — "nothing happened here" and "one of each" — and only the second is
    // evidence that a record is wrong for this task rather than irrelevant to it.
    const census = serveTaskCensus([
      render('a', false, true, 't1'),
      render('a', true, false, 't1'),
      render('b', true, true, 't2'),
    ]);
    expect(census.contested).toEqual(['t1']);
    expect(census.tasks.find((task) => task.taskId === 't1')?.net).toBe(0);
    // Two neutral tasks and one of them contested: the counts cross-cut on purpose, because `neutral` says the
    // net and `contested` says the shape of the evidence, and a store that did one of each is not the same
    // reading as a store that did nothing.
    expect(census.neutral).toBe(2);
  });

  it('separates the tasks it harmed from the ones it helped, and orders the worst first', () => {
    const census = serveTaskCensus([
      render('a', true, false, 't1'),
      render('b', true, false, 't1'),
      render('c', false, true, 't2'),
      render('d', true, true, 't3'),
    ]);
    expect(census.harmed).toBe(1);
    expect(census.helped).toBe(1);
    expect(census.neutral).toBe(1);
    // Ascending net: the harm first, then the tasks that changed nothing, then the one that helped.
    expect(census.tasks.map((task) => task.taskId)).toEqual(['t1', 't3', 't2']);
    expect(census.worst?.taskId).toBe('t1');
    expect(census.worst?.net).toBe(-2);
  });

  it('says nothing was reached rather than printing an empty table', () => {
    const census = serveTaskCensus([]);
    expect(census).toMatchObject({ rendered: 0, unattributed: 0, harmed: 0, helped: 0 });
    expect(census.worst).toBeUndefined();
    expect(serveTaskLine(census)).toBe('serve tasks: no render was made, so no task was reached');
  });

  it('prints the population, the split, and the worst task with the renders it took', () => {
    const census = serveTaskCensus([
      render('a', true, false, 't1'),
      render('b', true, false, 't1'),
      render('c', false, true, 't2'),
    ]);
    expect(serveTaskLine(census)).toBe(
      'serve tasks: 2 task(s) reached by 3 render(s); 1 harmed, 1 helped, 0 neutral, 0 contested; ' +
        'worst t1 -2 over 2 render(s)',
    );
  });

  it('names the renders it could not attribute instead of leaving them out of the total', () => {
    const census = serveTaskCensus([render('a', true, false, 't1'), render('b', true, false)]);
    expect(serveTaskLine(census)).toContain('1 render(s) named no task');
  });

  it('reads an artefact that names no task at all as an absence, not as a clean population', () => {
    // Every artefact before R148 is this case. The line has to say the reading is unavailable rather than
    // print `0 task(s) reached`, which a reader would take as "the store touched nothing".
    const census = serveTaskCensus([render('a', true, false), render('b', false, true)]);
    expect(census.rendered).toBe(0);
    expect(census.unattributed).toBe(2);
    expect(serveTaskLine(census)).toBe(
      'serve tasks: no render named a task, so the population axis is unread on this artefact (2 render(s))',
    );
  });
});

describe('the task id is attribution only', () => {
  it('does not change a single count in the yield census', () => {
    // The reason `ServeRender` carried no task id was that a field invites a second counting grain. The guard
    // against that is this case: the yield census, which is the counting census, must be identical on the same
    // renders with and without the id.
    const bare = [render('a', false, true), render('a', true, false), render('b', false, false)];
    const labelled = [
      render('a', false, true, 't1'),
      render('a', true, false, 't2'),
      render('b', false, false, 't2'),
    ];
    expect(serveYieldCensus(labelled)).toEqual(serveYieldCensus(bare));
  });
});
