/**
 * What survives a bank of lessons that has a ceiling, ported so the ceiling can be measured.
 *
 * The strongest published result in the experience-reuse line — ExpeL, and every later paper that
 * quotes it — is not a retrieval system. Its memory is a numbered list of natural-language rules,
 * capped at twenty, **rendered whole into every prompt**. Recall runs over *trajectories*, not over
 * rules (`fewshot_strategy: task_similarity`, `retriever_type: knn`); the rules themselves are never
 * retrieved, they are always present. That is a different mechanism from an injected pack, and the
 * difference is exactly the axis this project has been failing on: a rule that is always present
 * cannot be present for the wrong question.
 *
 * `agent/expel.py@LeapLabTHU/ExpeL` maintains that list with four operations against a vote counter —
 * `ADD` (+2), `AGREE` (+1), `EDIT` (+1), `REMOVE` (−1, or −3 once the list is past `max_num_rules + 5`)
 * — and drops any rule whose counter reaches zero. This module ports that arithmetic so that the
 * three places it can go wrong become countable rather than arguable:
 *
 * | weakness | where it lives | what it costs |
 * | --- | --- | --- |
 * | identity is one-directional substring | `rules[i] in operation_text` | a rule shortened into an *extension* of an existing one is kept; the reverse is not seen |
 * | the banned-word filter is substring, not token | `any(w in text for w in ['ADD','AGREE','EDIT'])` | a rule containing `ADDITIONAL`, `EDITED` or `AGREED` is silently discarded |
 * | the cap is soft | truncation happens nowhere; a "the list is full" suffix asks the model to evict | bank size drifts with model compliance, not with `max_num_rules` |
 * | one reply is not deduplicated against itself | the pre-pass checks `ADD` against the *incoming* bank, and the adds are appended after it | two identical `ADD`s in one reply both land, so a bank can hold the same sentence twice |
 *
 * Those are reported as counts by `mergeOperations` — `rejected`, `peak`, `culled` — and this module
 * takes no position on which identity mode is better. A port that also fixed the port would not be a
 * control, and the control is the entire point: the arm has to be able to run *this* algorithm before
 * a different one can be credited with anything.
 *
 * Not registered in `ROADMAP.md` as a prediction. It measures a competitor rather than this project,
 * and a prediction about somebody else's code is a prediction this repository cannot refute.
 */

/** The four operations ExpeL's extraction prompt is allowed to emit. */
export type OperationKind = 'ADD' | 'AGREE' | 'EDIT' | 'REMOVE';

export type Operation = {
  readonly kind: OperationKind;
  /** The 1-based rule number written beside the operation, when the reply writes one. */
  readonly number: number | null;
  readonly text: string;
};

export type Entry = {
  readonly text: string;
  readonly votes: number;
};

/**
 * How two rule texts are decided to be the same rule.
 *
 * `substring` is ExpeL's own reading and is kept as the default so that a default call reproduces
 * the competitor rather than an improvement on it. `exact` is what the substring test degrades to
 * when the model restates a rule verbatim, and is here to separate the two effects. `tokens` is the
 * candidate replacement: case, punctuation, word order and repetition removed.
 */
export type Identity = 'exact' | 'substring' | 'tokens';

/**
 * ExpeL's parse pattern, transliterated.
 *
 * The trailing `(?:[a-zA-Z\s\d]+: |)` strips a label prefix such as `Rule 3: `, and because
 * `[a-zA-Z\s\d]+` excludes the period it cannot eat a sentence boundary — `Take the apple. Note: it is red.`
 * keeps everything. What it *can* do is eat a legitimate colon clause: `ADD: Goal: reach the fridge.`
 * parses to `reach the fridge.`, which is why this is exported rather than inlined.
 */
const REPLY_SOURCE = '((?:REMOVE|EDIT|ADD|AGREE)(?: \\d+|)): (?:[a-zA-Z\\s\\d]+: |)(.*)';

/** The words ExpeL refuses to see in rule text, tested as substrings rather than as tokens. */
const BANNED = ['ADD', 'AGREE', 'EDIT'] as const;

/** Votes an `ADD` starts with. Two, so that one `REMOVE` does not delete a rule the model just wrote. */
export const ADD_VOTES = 2;

/** The margin above the cap at which ExpeL starts charging −3 for a removal. */
export const OVERFLOW_MARGIN = 5;

/** What a removal costs once the list is over its margin, against the usual −1. */
export const OVERFLOW_PENALTY = 3;

/**
 * The rules a reply states, in the order it stated them.
 *
 * Three filters are applied, and all three are ExpeL's: an empty body, a body containing a banned
 * word, and a body that does not end in a period. The last one is a truncation guard — a reply cut
 * off mid-sentence should not become a rule — and it also discards a legitimate rule written without
 * a final stop, which is counted by the caller as `rejected` rather than silently dropped.
 */
export function parseOperations(reply: string): Operation[] {
  const operations: Operation[] = [];
  // A fresh regex per call, because a `g` regex carries `lastIndex` between calls and a second parse
  // of the same text would start where the first one stopped. That defect is invisible in a
  // single-call test and is why the source is a string rather than a compiled constant.
  for (const match of reply.matchAll(new RegExp(REPLY_SOURCE, 'g'))) {
    // Both groups are mandatory in the pattern — `(.*)` always matches, possibly with nothing — so a
    // missing group is not a case the parser has to answer for.
    const head = match[1]!;
    const body = match[2]!.trim();
    if (body === '') continue;
    if (BANNED.some((word) => body.includes(word))) continue;
    if (!body.endsWith('.')) continue;
    const [kind, written] = head.split(' ');
    const number = written === undefined ? null : Number.parseInt(written, 10);
    operations.push({
      kind: kind as OperationKind,
      number: Number.isFinite(number as number) ? (number as number) : null,
      text: body,
    });
  }
  return operations;
}

/**
 * A rule's text reduced to the set of words it is made of.
 *
 * Order is discarded on purpose: `check the lamp first` and `first check the lamp` are the same
 * instruction in a numbered list that is rendered in bank order. What order carries is a constraint
 * on *within* a rule, and no rule in this bank is a two-clause procedure — the extraction prompt asks
 * for one imperative per line. If that ever stops being true, this normalization becomes a merge of
 * two different rules and the `tokens` identity has to be replaced rather than tuned.
 */
export function normalizeTokens(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  return [...new Set(words)].sort().join(' ');
}

/** Whether an incoming rule text is the same rule as an existing one, under one identity mode. */
export function sameRule(existing: string, incoming: string, identity: Identity): boolean {
  if (identity === 'exact') return existing === incoming;
  if (identity === 'tokens') return normalizeTokens(existing) === normalizeTokens(incoming);
  // ExpeL's direction, kept: the *existing* rule has to be contained in the incoming text. An
  // incoming rule that is a shortening of an existing one is therefore a new rule, and a bank can
  // hold both `always check the lamp before leaving` and `always check the lamp`.
  return incoming.includes(existing);
}

/** The index of the first entry the text is judged to repeat, or −1. First match, as ExpeL takes. */
export function findRule(bank: readonly Entry[], text: string, identity: Identity): number {
  for (let index = 0; index < bank.length; index += 1) {
    if (sameRule(bank[index]!.text, text, identity)) return index;
  }
  return -1;
}

export type MergeOptions = {
  readonly identity?: Identity;
  /** The declaration the overflow arithmetic is measured against. `null` disables the penalty step. */
  readonly cap?: number | null;
  readonly overflowPenalty?: number;
  readonly overflowMargin?: number;
};

export type MergeReport = {
  /** The bank after every operation, in vote order. */
  readonly bank: readonly Entry[];
  /** Operations discarded before they could act, because the rule they name was not there or already was. */
  readonly rejected: number;
  /** Rules removed because their counter reached zero. */
  readonly culled: number;
  /** The largest the bank ever got during the merge, which is where a soft cap shows up. */
  readonly peak: number;
  /** Operations that acted, for the ratio a reader wants beside `rejected`. */
  readonly applied: number;
};

/**
 * Apply one reply's operations to a bank, in ExpeL's order and with ExpeL's arithmetic.
 *
 * The order is `REMOVE`, `AGREE`, `EDIT`, `ADD` and it matters: an `EDIT` that names a rule the same
 * reply also `REMOVE`d must find the rule already gone, and an `ADD` that restates a rule the same
 * reply edited must be judged against the edited text. Sorting by vote count happens once at the end,
 * which is what makes the rendered order a function of the bank's history rather than of the reply's
 * ordering — the reason two runs that saw the same operations in different orders still render alike.
 */
export function mergeOperations(
  bank: readonly Entry[],
  operations: readonly Operation[],
  options: MergeOptions = {},
): MergeReport {
  const identity = options.identity ?? 'substring';
  const cap = options.cap ?? null;
  const penalty = options.overflowPenalty ?? OVERFLOW_PENALTY;
  const margin = options.overflowMargin ?? OVERFLOW_MARGIN;

  const working: Entry[] = bank.map((entry) => ({ ...entry }));
  let peak = working.length;
  let culled = 0;
  let applied = 0;
  let rejected = 0;

  // Pass one: resolve each operation against the bank as it stands, exactly as ExpeL does before it
  // applies anything. A reply that names a rule the bank does not hold is dropped here rather than
  // being allowed to create one under `DELETE`/`EDIT`, which is the behaviour a naive implementation
  // would get wrong by treating every unrecognised operation as an add.
  //
  // The pass resolves against `working` and never against `resolved`, which is the fourth weakness in
  // the header table: two identical adds in one reply are both accepted, because neither has landed
  // when the other is checked. It is kept because a port that deduplicated here would be a different
  // function from the one being controlled, and the effect is visible — the bank comes back with two
  // entries the rendered list prints twice.
  const resolved: { operation: Operation; index: number }[] = [];
  for (const operation of operations) {
    if (operation.kind === 'ADD') {
      if (findRule(working, operation.text, identity) !== -1) {
        rejected += 1;
        continue;
      }
      resolved.push({ operation, index: -1 });
      continue;
    }
    if (operation.kind === 'EDIT') {
      const byText = findRule(working, operation.text, identity);
      if (byText !== -1) {
        // An `EDIT` whose text already exists is an agreement written with the wrong verb.
        resolved.push({ operation: { ...operation, kind: 'AGREE' }, index: byText });
        continue;
      }
      const named = operation.number === null ? -1 : operation.number - 1;
      // One deliberate divergence, and it is a rejection rather than a rewrite. ExpeL checks
      // `rule_num > len(rules)` but not `rule_num < 1`, so `EDIT 0` reaches `rules[-1]` — Python
      // indexes from the end — and edits the last rule. A port that reproduced that would be
      // reproducing an out-of-bounds access that happens to be legal in one language; the operation
      // is counted in `rejected` instead, so a reply that emits one shows up in the report rather
      // than in a silently different bank.
      if (named < 0 || named >= working.length) {
        rejected += 1;
        continue;
      }
      resolved.push({ operation, index: named });
      continue;
    }
    const found = findRule(working, operation.text, identity);
    if (found === -1) {
      rejected += 1;
      continue;
    }
    resolved.push({ operation, index: found });
  }

  for (const kind of ['REMOVE', 'AGREE', 'EDIT', 'ADD'] as const) {
    for (const { operation, index } of resolved) {
      if (operation.kind !== kind) continue;
      if (kind === 'ADD') {
        working.push({ text: operation.text, votes: ADD_VOTES });
        applied += 1;
        peak = Math.max(peak, working.length);
        continue;
      }
      // The index was resolved against the pre-mutation bank, and nothing between the resolve and this
      // read removes an entry: `REMOVE` and `AGREE` change a counter, `EDIT` replaces an element in
      // place, and culling happens once after the last kind has run. The assertion states that
      // invariant; a change that culled inside the loop would have to come back here.
      const entry = working[index]!;
      applied += 1;
      if (kind === 'REMOVE') {
        const full = cap !== null && cap + margin <= working.length;
        working[index] = { text: entry.text, votes: entry.votes - (full ? penalty : 1) };
        continue;
      }
      if (kind === 'AGREE') {
        working[index] = { text: entry.text, votes: entry.votes + 1 };
        continue;
      }
      working[index] = { text: operation.text, votes: entry.votes + 1 };
    }
  }

  const surviving = working.filter((entry) => entry.votes > 0);
  culled = working.length - surviving.length;
  // Descending by votes, stable: `sort` is stable by specification, so two rules with equal support
  // keep the order they entered in, which is the order a reader compares two runs by.
  surviving.sort((left, right) => right.votes - left.votes);

  return { bank: surviving, rejected, culled, peak, applied };
}

/** The rules a prompt would carry, which is where a cap that nothing enforces becomes visible. */
export function renderable(bank: readonly Entry[], cap: number | null): readonly Entry[] {
  if (cap === null) return bank;
  return bank.slice(0, cap);
}
