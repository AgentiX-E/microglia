/**
 * Where the harm landed: the population axis of the same renders the yield census counts.
 *
 * ## The question this exists for
 *
 * `serveYieldCensus` answers "what did a record do with what it was given". It cannot answer "which tasks did
 * the store touch", and the difference is the difference between two diseases with one symptom. A store that
 * breaks one trial of a hundred and a store that breaks one *task* of a hundred produce the same `breaks`
 * count. The first is interference: a record that was right for the episode's family and wrong for its
 * instance. The second is reach: a retrieval that found something plausible for a task family it has nothing
 * to say about. Only the second is fixed by a content axis, and only the first is fixed by a floor.
 *
 * R141 could not distinguish them, because a render carried no task id — and the reason it carried none was
 * that an id is an invitation to count at a second grain. The answer is not to withhold the id but to state
 * what it may be used for: it is **attribution**, it never divides, and the counting census (`serveYieldCensus`)
 * produces the identical table on the same renders with and without it. There is a case in the suite that
 * asserts exactly that, because the argument against the field is real and a comment is not a guard.
 *
 * ## Net zero is two readings
 *
 * A task whose repairs equal its breaks has net zero, and that number is the same whether the store did
 * nothing there or did one of each. `contested` separates them: it is the list of tasks where both directions
 * occurred, which is the only evidence that a record is *wrong* for a task rather than irrelevant to it. A
 * neutral task that is not contested is a task the store reached and changed nothing about — the same
 * tokens-without-mechanism that 85% of R141's renders were.
 */

import type { ServeRender } from './serve-yield.js';

export type TaskYield = {
  readonly taskId: string;
  readonly renders: number;
  /** Distinct records served into this task, which is not the render count: one record may render twice. */
  readonly items: number;
  /** Renders on an episode the reference arm failed: the only population a repair can come from. */
  readonly opportunity: number;
  readonly repairs: number;
  readonly breaks: number;
  readonly inert: number;
  /** `repairs - breaks`. */
  readonly net: number;
};

export type TaskYieldCensus = {
  /** Tasks reached, worst net first, ties by id. */
  readonly tasks: readonly TaskYield[];
  /** Renders that named a task — the population the rows are drawn from. */
  readonly rendered: number;
  /** Renders with no task id: counted and reported, never attached to a task that did not serve them. */
  readonly unattributed: number;
  readonly harmed: number;
  readonly helped: number;
  readonly neutral: number;
  /** Tasks where both a repair and a break occurred, whatever their net. */
  readonly contested: readonly string[];
  readonly worst: TaskYield | undefined;
};

export function serveTaskCensus(renders: readonly ServeRender[]): TaskYieldCensus {
  const perTask = new Map<string, { renders: number; items: Set<string>; repairs: number; breaks: number; opportunity: number }>();
  let rendered = 0;
  let unattributed = 0;
  for (const render of renders) {
    const taskId = render.task;
    if (taskId === undefined) {
      unattributed += 1;
      continue;
    }
    rendered += 1;
    const row = perTask.get(taskId) ?? { renders: 0, items: new Set<string>(), repairs: 0, breaks: 0, opportunity: 0 };
    row.renders += 1;
    row.items.add(render.itemId);
    if (!render.controlPassed) row.opportunity += 1;
    // The same two conditions the yield census uses, written the same way: an opportunity that was taken is a
    // repair, and a render on a passed trial that failed is a break. A render that did neither is inert, which
    // is the residual and not an omission.
    if (!render.controlPassed && render.memoryPassed) row.repairs += 1;
    if (render.controlPassed && !render.memoryPassed) row.breaks += 1;
    perTask.set(taskId, row);
  }

  const tasks = [...perTask]
    .map(([taskId, row]) => ({
      taskId,
      renders: row.renders,
      items: row.items.size,
      opportunity: row.opportunity,
      repairs: row.repairs,
      breaks: row.breaks,
      inert: row.renders - row.repairs - row.breaks,
      net: row.repairs - row.breaks,
    }))
    .sort((left, right) => (left.net === right.net ? left.taskId.localeCompare(right.taskId) : left.net - right.net));

  return {
    tasks,
    rendered,
    unattributed,
    harmed: tasks.filter((task) => task.net < 0).length,
    helped: tasks.filter((task) => task.net > 0).length,
    neutral: tasks.filter((task) => task.net === 0).length,
    contested: tasks.filter((task) => task.repairs > 0 && task.breaks > 0).map((task) => task.taskId),
    worst: tasks[0],
  };
}

/**
 * The census as one line.
 *
 * Three sentences for three states, because the states are not degrees of one another: no render at all, a
 * render that named no task (every artefact before this field existed), and a population. Printing
 * `0 task(s) reached` for the middle state is the collapse of absent into zero this lane has paid for twice.
 */
export function serveTaskLine(census: TaskYieldCensus): string {
  if (census.tasks.length === 0 && census.unattributed === 0) {
    return 'serve tasks: no render was made, so no task was reached';
  }
  if (census.tasks.length === 0) {
    return (
      'serve tasks: no render named a task, so the population axis is unread on this artefact ' +
      `(${String(census.unattributed)} render(s))`
    );
  }
  const worst = census.worst as TaskYield;
  const unattributed =
    census.unattributed === 0 ? '' : `; ${String(census.unattributed)} render(s) named no task`;
  return (
    `serve tasks: ${String(census.tasks.length)} task(s) reached by ${String(census.rendered)} render(s); ` +
    `${String(census.harmed)} harmed, ${String(census.helped)} helped, ` +
    `${String(census.neutral)} neutral, ${String(census.contested.length)} contested; ` +
    `worst ${worst.taskId} ${String(worst.net)} over ${String(worst.renders)} render(s)${unattributed}`
  );
}
