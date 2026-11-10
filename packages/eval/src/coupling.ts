/**
 * The layer table, recomputed from the source tree instead of remembered.
 *
 * This project has claimed for twenty iterations that the library is scenario-agnostic: that the
 * measurement protocol contains no text-to-SQL, that `core` has **zero** scenario words in
 * production code, and that the scenario is a known number of lines in a known place. The claim has
 * been made in a paragraph, measured once by hand, and never recomputed — which is the same failure
 * this record has repaired in four other layers, because a number nobody recomputes is a number
 * that stops being true on the first merge and stays published anyway.
 *
 * So the table becomes a reading. For every production module under `packages/*` it counts lines,
 * counts the scenario words that appear in **code** as opposed to comments, and classifies the
 * module one of three ways:
 *
 *   - **adapter** — it lives in `packages/sql`, which is where a module that mentions a database is
 *     allowed to live;
 *   - **deferred** — it lives elsewhere and mentions a database, and the reason it is not in
 *     `packages/sql` is written down in the table below;
 *   - **general** — it mentions no scenario at all.
 *
 * The classification is the *decision*; the word count is the *evidence*; and `V72` fails when a
 * module with scenario words in it is neither. That is what makes the property enforced rather than
 * asserted: adding `packages/eval/src/foo.ts` with `sqlite` in it breaks the build until somebody
 * either moves it or writes down why not.
 *
 * **Counting code and not comments is the load-bearing choice.** A module that explains in a comment
 * why it is *not* SQL-specific must not be counted as SQL-specific, and a module that does nothing
 * but mention SQL in a docstring is not coupled to it. The stripper has to understand strings before
 * it understands comments, because `'https://…'` contains `//` and a template literal can contain
 * both — the tests below drive each of those cases, one per shape.
 *
 * Everything here is a pure function over file contents. The walker lives in the bin.
 */
import { round4 } from './resolution.js';

/** The six packages, in dependency order: a package may import only from a strictly lower rank. */
export const LAYER_ORDER = ['core', 'protocol', 'sql', 'eval', 'browser', 'node'] as const;

export type Layer = (typeof LAYER_ORDER)[number];

/**
 * The rank of each layer.
 *
 * `eval` and `browser` share a rank because they are siblings that do not import each other, and
 * `node` sits above `browser` because it wraps it. A single total order is enough to express every
 * edge the repository has, and a total order is checkable in one comparison per edge rather than in
 * a hand-written matrix that would be the thing that goes stale.
 */
const RANK: Readonly<Record<Layer, number>> = {
  core: 0,
  protocol: 1,
  sql: 2,
  eval: 3,
  browser: 3,
  node: 4,
};

/**
 * The words that make a module scenario-bound.
 *
 * Chosen to be *unambiguous* rather than comprehensive. `query`, `schema`, `table` and `column` are
 * excluded even though they are SQL's vocabulary, because they are also the vocabulary of a memory
 * store, an artefact and a spreadsheet — counting them would flag `core/kernel` for saying "query
 * the journal" and the flag would be wrong, which is worse than not flagging. The strict list costs
 * recall and buys the only thing a gate needs: a failure that is never a false positive, because a
 * gate with false positives gets suppressed.
 */
export const SCENARIO_WORDS = ['sql', 'sqlite', 'nl2sql', 'text-to-sql', 'bird', 'm-schema'] as const;

/**
 * Modules that keep their scenario words and the reason they are not in `packages/sql`.
 *
 * Each one is a decision that stage 3 examined and declined to make, and each reason names the
 * *dependency* rather than the topic — "it mentions SQL" is not a reason to move a module, "it
 * depends on the artefact schema" is. A module that later loses that dependency should move, and
 * this table is where the reader can see that the question was asked.
 */
export const DEFERRALS: Readonly<Record<string, string>> = {
  artefacts: 'names the dataset and split ids; typed by the loader rather than by SQL',
  'artifact-schema': 'declares a record field called `sql`; the schema is the protocol\'s, the column is a string',
  'artifact-pool':
    'carries the candidate\'s query through from the artefact into the pool reading; it parses a ' +
    'record and executes nothing',
  'content-signal':
    'compares the question\'s own words against a candidate\'s column names and literals; it reads ' +
    'strings and executes nothing',
  'bird-data': 'the dataset loader; opens SQLite to read a corpus rather than to answer a question',
  'bird-rows': 'the corpus row shapes, not a query',
  coupling: 'the scanner itself: it defines the word list, so it necessarily contains every word on it',
  'empty-result': 'classifies an empty attempt against the gold query by table set and value; it reads shapes and writes no statement',
  exemplars: 'renders a training row\'s stored query text beside its question; it executes nothing and holds no adapter',
  'gate-matrix': 'the matrix names the artefact it was rendered against; the dataset name is an argument, not a query',
  judge: 'the LLM judge\'s prompt and record name the artefact being judged',
  'lane-scope': 'decides which of the two lanes a dispatch buys; the lane names are the subject, not a query',
  plugin: 'the plugin contract\'s worked example is a host that returns SQL',
  pool:
    'the candidate record carries the query text so a selector can be priced against a pool already ' +
    'bought; it stores a string and executes nothing',
  reproduction: 'the reproduction config names the published BIRD cell and its M-Schema rendering',
  'retry-trigger': 'the retry vocabulary is made of execution facts — no query, an error, no rows — and it carries them into a prompt rather than executing anything',
  'rose-vec': 'the public adjudication set\'s record fields',
  selector: 'candidate selection over SQL strings; the selector is a policy, the strings are opaque',
  sota: 'the mixed lane module: prompt, arms and gate inputs still share a file',
  validity: 'one gate diffs two statements, and it imports the differ from `sql` rather than copying it',
  'value-correction':
    'compares the literals an attempt wrote against the values a column holds; it reads two strings and executes nothing',
};

/** One production module, as the walker found it. */
export type ModuleSource = {
  /** Repository-relative path, `packages/eval/src/sota.ts`. */
  readonly path: string;
  /** The package the module belongs to, parsed from the path. */
  readonly pkg: Layer;
  readonly source: string;
};

/** What `general`, `adapter` and `deferred` mean is in the module comment; here they are a value. */
export type Verdict = 'adapter' | 'deferred' | 'general';

export type ModuleRow = {
  readonly pkg: Layer;
  readonly module: string;
  readonly path: string;
  readonly lines: number;
  /** Scenario words in code, after comments are removed. The enforced column. */
  readonly codeWords: readonly string[];
  /** Scenario words that appear only in comments. Published, never enforced. */
  readonly commentWords: readonly string[];
  readonly verdict: Verdict;
  /** Present exactly when `verdict` is `deferred`. */
  readonly reason: string | null;
};

/**
 * Whether a `/` at this point opens a regular expression rather than dividing.
 *
 * This is the one ambiguity a comment stripper cannot avoid, and it matters here for a concrete
 * reason: `lexicon.ts` contains `/^- "([^"]+)":/`, whose double quotes put a quote-tracking scanner
 * inside a string, from which it never recovers — it swallowed the module's remaining comments and
 * the first version of this file reported the module as SQL-coupled. The heuristic below is the
 * standard one: after a value (identifier, number, `)`, `]`) a slash divides; after an operator,
 * an opener or nothing at all it starts a regex.
 */
function opensRegex(previous: string | null): boolean {
  if (previous === null) return true;
  return !/[A-Za-z0-9_$)\]}]/.test(previous);
}

/**
 * The source with comments removed and everything else — strings, template literals and regular
 * expressions included — preserved byte for byte.
 *
 * One pass, one state, and the states are the point: a `/` inside a string is not a comment opener,
 * a quote inside a comment is not a string, a template literal can hold both, and a regex literal
 * can hold a quote. Getting this wrong in the permissive direction lets comments into the count; in
 * the strict direction it eats code after a `//` in a URL, and a module that loses half its body to
 * a stripper reads as general. Both failures happened here before this function was written.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let previous: string | null = null;
  const push = (text: string): void => {
    out.push(text);
    for (let i = text.length - 1; i >= 0; i -= 1) {
      const char = text[i] as string;
      if (!/\s/.test(char)) {
        previous = char;
        return;
      }
    }
  };
  while (index < source.length) {
    const char = source[index] as string;
    if (quote !== null) {
      push(char);
      if (char === '\\') {
        const escaped = source[index + 1];
        if (escaped !== undefined) {
          push(escaped);
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      push(char);
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === '/' && opensRegex(previous)) {
      // A regex literal: copied verbatim, with `[...]` honoured so that `[/]` does not end it.
      push(char);
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const inner = source[index] as string;
        if (inner === '\\') {
          const escaped = source[index + 1];
          push(inner);
          if (escaped !== undefined) push(escaped);
          index += 2;
          continue;
        }
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) {
          push(inner);
          index += 1;
          break;
        }
        push(inner);
        index += 1;
      }
      while (index < source.length && /[a-z]/.test(source[index] as string)) {
        push(source[index] as string);
        index += 1;
      }
      continue;
    }
    push(char);
    index += 1;
  }
  return out.join('');
}

/**
 * Which scenario words a piece of text uses.
 *
 * `text-to-sql` is matched as a word, and the tokeniser keeps `-` inside a token so that
 * `text-to-sql` does not degrade into `text`, `to`, `sql` — which would double count the same
 * phrase and make the column incomparable between a hyphenated and a spaced spelling.
 */
export function wordsOf(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9-]+/).filter((word) => word !== ''));
}

/** The scenario words a piece of text uses, in the order the strict list declares. */
export function scenarioWords(text: string): readonly string[] {
  const words = wordsOf(text);
  return SCENARIO_WORDS.filter((word) => words.has(word));
}

/** The module name a path ends in, without the extension: `packages/eval/src/sql-exec.ts` → `sql-exec`. */
export function moduleNameOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.endsWith('.ts') ? file.slice(0, -'.ts'.length) : file;
}

/**
 * One row per module: the counts, the verdict, and the reason when there is one.
 *
 * The verdict is derived rather than passed, so a row cannot disagree with the package it lives in.
 * A module in `packages/sql` is an adapter whether or not it happens to mention a database — the
 * package *is* the claim — and a module elsewhere is `deferred` only if it has a scenario word in
 * code **and** a written reason. A module with a word and no reason is `general` here and the gate
 * is what fails: the row reports what was found, the gate reports what it means.
 */
export function moduleRow(module: ModuleSource): ModuleRow {
  const code = stripComments(module.source);
  const codeWords = scenarioWords(code);
  // Words in the file but not in its code: they survive only inside comments. Derived by
  // subtraction rather than by a second stripper, because two strippers disagree eventually.
  const commentWords = scenarioWords(module.source).filter((word) => !codeWords.includes(word));
  const moduleName = moduleNameOf(module.path);
  const reason = DEFERRALS[moduleName] ?? null;
  const verdict: Verdict = module.pkg === 'sql'
    ? 'adapter'
    : codeWords.length > 0 && reason !== null
      ? 'deferred'
      : 'general';
  return {
    pkg: module.pkg,
    module: moduleName,
    path: module.path,
    lines: module.source === '' ? 0 : module.source.split('\n').length,
    codeWords,
    commentWords,
    verdict,
    reason: verdict === 'deferred' ? reason : null,
  };
}

/** Total lines, modules and adapter lines for one layer. */
export type LayerTotal = {
  readonly layer: Layer;
  readonly modules: number;
  readonly lines: number;
  readonly adapterLines: number;
  readonly deferredLines: number;
  /** Modules with at least one scenario word in code. The number the positioning text quotes. */
  readonly coupled: number;
};

export function layerTotals(rows: readonly ModuleRow[]): readonly LayerTotal[] {
  return LAYER_ORDER.map((layer) => {
    const mine = rows.filter((row) => row.pkg === layer);
    return {
      layer,
      modules: mine.length,
      lines: mine.reduce((total, row) => total + row.lines, 0),
      adapterLines: mine.filter((row) => row.verdict === 'adapter').reduce((total, row) => total + row.lines, 0),
      deferredLines: mine.filter((row) => row.verdict === 'deferred').reduce((total, row) => total + row.lines, 0),
      coupled: mine.filter((row) => row.codeWords.length > 0).length,
    };
  }).filter((total) => total.modules > 0);
}

/** One package importing another, counted by the files that do it. */
export type ImportEdge = {
  readonly from: Layer;
  readonly to: Layer;
  readonly files: number;
  /** `true` when the edge points at a layer of equal or higher rank: a cycle waiting to happen. */
  readonly upward: boolean;
};

/**
 * Package imports, parsed from the specifiers that carry a package name.
 *
 * Only `@agentix-e/microglia-*` specifiers count. A relative import cannot cross a package boundary,
 * so counting it would add noise, and a dynamic `import()` of a package is caught by the same
 * regular expression because the specifier is the same string.
 */
export function importEdges(sources: readonly ModuleSource[]): readonly ImportEdge[] {
  const counts = new Map<string, { from: Layer; to: Layer; files: number }>();
  for (const module of sources) {
    const targets = new Set<Layer>();
    // Comments are stripped first: a docstring that names a package is an explanation, not an import.
    for (const match of stripComments(module.source).matchAll(/['"]@agentix-e\/microglia-([a-z]+)[^'"]*['"]/g)) {
      const target = match[1] as Layer;
      if (target === module.pkg) continue;
      if (!LAYER_ORDER.includes(target)) continue;
      targets.add(target);
    }
    for (const target of targets) {
      const key = `${module.pkg}->${target}`;
      const existing = counts.get(key);
      if (existing === undefined) counts.set(key, { from: module.pkg, to: target, files: 1 });
      else counts.set(key, { ...existing, files: existing.files + 1 });
    }
  }
  return [...counts.values()]
    .map((edge) => ({ ...edge, upward: RANK[edge.to] >= RANK[edge.from] }))
    .sort((left, right) => `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`));
}

export type CouplingGate = {
  readonly id: string;
  readonly pass: boolean;
  readonly blocking: boolean;
  readonly detail: string;
};

/**
 * `V72` — every module with a scenario word in it is either an adapter or a deferred one with a reason.
 *
 * The failure this refuses is a module that slipped between two packages, which is the state the
 * repository was in before stage 3: the scenario was 11,764 lines with no line saying which of them
 * were the scenario. Silent omission again, and this time the omitted thing is a coupling nobody
 * decided on. The gate is also asked whether the walker emitted as many rows as it scanned, because
 * a table that is short for a filter's reason looks exactly like a table that is complete.
 */
export function totalityGate(input: {
  readonly scanned: number;
  readonly rows: readonly ModuleRow[];
}): CouplingGate {
  const unclassified = input.rows.filter(
    (row) => row.codeWords.length > 0 && row.pkg !== 'sql' && row.reason === null,
  );
  const reasons: string[] = [];
  if (input.rows.length === 0) reasons.push('the walk found no production modules');
  if (input.rows.length !== input.scanned) {
    reasons.push(`${String(input.scanned - input.rows.length)} scanned modules were not classified`);
  }
  if (unclassified.length > 0) {
    const first = unclassified[0] as ModuleRow;
    reasons.push(
      `${String(unclassified.length)} coupled modules have no verdict, first ${first.path} (${first.codeWords.join(', ')})`,
    );
  }
  return {
    id: 'V72-every-coupled-module-has-a-verdict',
    pass: reasons.length === 0,
    blocking: true,
    detail: reasons.length === 0
      ? `${String(input.rows.length)} modules, ${String(input.rows.filter((row) => row.verdict === 'deferred').length)} deferred with a reason`
      : reasons.join('; '),
  };
}

/**
 * `V73` — a package imports only downwards.
 *
 * `core ← protocol ← sql ← eval` is the design, and before stage 3 it was prose. A design that is
 * prose is one urgent patch away from being wrong: the first time a gate needs a SQL helper the
 * shortest path is an import in the other direction, and it compiles. So the edge list is checked,
 * not drawn — an edge to an equal or higher rank fails, and the gate names both ends.
 */
export function layerGate(edges: readonly ImportEdge[]): CouplingGate {
  const upward = edges.filter((edge) => edge.upward);
  return {
    id: 'V73-no-package-imports-upward',
    pass: upward.length === 0 && edges.length > 0,
    blocking: true,
    detail: edges.length === 0
      ? 'no package imports another, which cannot be true of this repository'
      : upward.length === 0
        ? `${String(edges.length)} edges, every one downwards`
        : `${String(upward.length)} upward, first ${(upward[0] as ImportEdge).from} -> ${(upward[0] as ImportEdge).to}`,
  };
}

/**
 * `V74` — `core` is the layer the positioning text promises: zero scenario words in code.
 *
 * This is the one sentence in the README that could be falsified without anyone noticing, because
 * nobody reads a library's internals to check a claim made about them. It is also the cheapest
 * sentence to falsify — one `import type` and a field name — so it is the one worth a gate. Comments
 * are excluded and published separately: `core`'s tests say `sql` because a scope string is free
 * text, and counting a test's prose as coupling would make the number about the fixtures.
 */
export function coreGate(rows: readonly ModuleRow[]): CouplingGate {
  const core = rows.filter((row) => row.pkg === 'core');
  const coupled = core.filter((row) => row.codeWords.length > 0);
  return {
    id: 'V74-core-is-scenario-free',
    pass: core.length > 0 && coupled.length === 0,
    blocking: true,
    detail: core.length === 0
      ? 'core has no production modules, so the claim is vacuous'
      : coupled.length === 0
        ? `${String(core.length)} core modules, zero scenario words in code`
        : `${String(coupled.length)} core modules name a scenario, first ${(coupled[0] as ModuleRow).path}`,
  };
}

/** The share of the repository's production lines that sit in a module with a scenario word in it. */
export function coupledShare(rows: readonly ModuleRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.lines, 0);
  if (total === 0) return 0;
  const coupled = rows.filter((row) => row.codeWords.length > 0).reduce((sum, row) => sum + row.lines, 0);
  return round4(coupled / total);
}
