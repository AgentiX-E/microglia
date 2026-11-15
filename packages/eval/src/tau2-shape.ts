/**
 * The routine a τ² record states, read from the record itself.
 *
 * R109's fold is a function over a pack, and a pack is a list of records the store already wrote. The
 * store's `payload` carries a call **count** — it has since R85 — so the sequence is only in the text:
 * `A: get_order_details(order_id="W1"); exchange_delivered_order_items(...)`.
 *
 * Reading it back out is therefore not a convenience, it is the only route there is. Two alternatives
 * were refused, both for the reason this project refuses changes that rewrite what a run measured:
 *
 *  - **write the shape into the payload now** — the rendered line grows by a field, so `RECORD_CAPACITY`
 *    changes and every artefact's capacity reading becomes a number about a different line;
 *  - **store the actions beside the record** — a second copy of the episode in a record whose whole
 *    argument (R85) is that it stores the raw material once.
 *
 * The parse is a scanner rather than a `split('; ')` because arguments are JSON: `note="a; b"` is one
 * argument, and a split on the separator would turn one call into two and invent a routine that no task
 * taught. Names only: the arguments are the instance, which is the distinction the whole fold rests on.
 */
import { actionShapeOf } from './tau2-merge.js';

/**
 * The call names on a record's `A:` line, in order.
 *
 * Empty for a record that states no answer line — a rubric-only correction, or a claim written by a
 * distiller — and empty is the honest answer: a record that names no routine is its own unit.
 */
export function callsOfStatement(statement: string): string[] {
  const line = statement.split('\n').find((entry) => entry.startsWith('A: '));
  if (line === undefined) return [];
  const names: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let current = '';
  const flush = (): void => {
    // Everything before the first `(` is the name; a call with no parenthesis is the whole segment,
    // which is how a rubric-only correction states its routine.
    const cut = current.indexOf('(');
    const name = (cut === -1 ? current : current.slice(0, cut)).trim();
    if (name !== '') names.push(name);
    current = '';
  };
  for (const character of line.slice(3)) {
    if (quote !== null) {
      current += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ';' && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return names;
}

/**
 * The shape a record states, as the fold's extractor: `a > b > c`, or `undefined` for a record that
 * states no routine at all.
 */
export function tau2ShapeOf(item: { readonly statement: string }): string | undefined {
  const names = callsOfStatement(item.statement);
  return names.length === 0 ? undefined : names.join(' > ');
}

/**
 * R120 — the routine behind every correction the learn half produced, keyed by the task it taught.
 *
 * R119 printed `fold: units 631, folded 0, groups 0, atLeastTwo 0, max 1` beside `merge: shapes 53,
 * support.atLeastTwo 10, max 5`: one store, one dispatch, one question, two keys — and only one of
 * the keys had an input. The fold reads the `A:` line of an item's statement, and a record written by
 * the distiller is a sentence ("return actions carry the order_id, the item_ids and a
 * payment_method_id") with no answer line at all, so `callsOfStatement` returned `[]` for all 79
 * servable items and every item was its own unit. The fold could not fire, and the run reported its
 * inertness as a property of the store: "the fold removed nothing, so the two arms are one treatment".
 * That sentence was true and its reason was not the one given.
 *
 * The key is `actionShapeOf`, imported rather than re-derived: the census that priced the merge and
 * the key the fold reads must be one function, or the two numbers will drift and no reader can tell
 * which of them a result is about. What this function adds is the join — the correction's task is what
 * an item's evidence names — and one deliberate omission: a correction that called nothing taught no
 * routine, so it has no entry. `actionShapeOf` still keys it as `task:<id>` for the census, which needs
 * a bucket for every correction to size a store; the fold needs a routine, and an item that names none
 * is its own unit.
 */
export function shapeByTaskOf(
  corrections: readonly {
    readonly taskId: string;
    readonly actions: readonly { readonly name: string }[];
  }[],
): ReadonlyMap<string, string> {
  const byTask = new Map<string, string>();
  for (const correction of corrections) {
    if (correction.actions.length === 0) continue;
    byTask.set(correction.taskId, actionShapeOf(correction));
  }
  return byTask;
}

/** The item's side of the join: the distinct tasks its own evidence cites. */
type ShapeEvidence = { readonly evidence?: readonly { readonly taskId?: string }[] };

/**
 * The fold's extractor, with the correction's routine as a fallback for a record that states none.
 *
 * Four decisions, each of which a looser version gets wrong:
 *
 * **The record's own answer line wins.** A capture record states the calls it *made*, which is not
 * always the routine its reference trajectory asked for. A fallback that overrode the text would
 * replace a measurement with a task's intention.
 *
 * **The fallback reads the evidence, not the scope.** The scope's `intent` is free text the model
 * writes, and R119's store spells one routine three ways — `return_items`, `return_item`, and
 * `return_items` again under a different field — so it cannot key anything: 9 of 64 sampled items
 * shared an intent string and every one of them still carried `supportTasks: 1`.
 *
 * **Evidence that names two routines names none.** An item citing an exchange and a return is not one
 * routine, and folding it into either would credit one shape with the other's support — the laundering
 * R99 already paid for. `undefined` is the honest answer and it makes the item its own unit.
 *
 * **A task with no known routine contributes nothing rather than a veto.** A claim the store wrote from
 * a run whose correction is not in the learn half — a hand-written rule, a store another arm wrote —
 * cannot be named, and letting that silence forbid a name the other evidence does supply would make the
 * key depend on which half of the corpus a reader happened to have.
 */
export function tau2ShapeWithFallback(
  byTask: ReadonlyMap<string, string>,
): (item: { readonly statement: string } & ShapeEvidence) => string | undefined {
  return (item) => {
    const stated = tau2ShapeOf(item);
    if (stated !== undefined) return stated;
    let shape: string | undefined;
    for (const entry of item.evidence ?? []) {
      if (entry.taskId === undefined) continue;
      const candidate = byTask.get(entry.taskId);
      if (candidate === undefined) continue;
      if (shape === undefined) shape = candidate;
      else if (shape !== candidate) return undefined;
    }
    return shape;
  };
}
