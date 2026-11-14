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
