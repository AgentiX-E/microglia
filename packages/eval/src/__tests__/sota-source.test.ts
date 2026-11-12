import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * Structural invariants of the benchmark lane, checked on its own source.
 *
 * These are not style rules. R81 was dispatched, ran for sixteen minutes and **$0.23**, produced a
 * complete artefact, and recorded `reconstruct: null`: its reconstruction pass had been written inside
 * `if (samplingArmsThisRun.length > 0 || wantsCeiling || priorRequested)`, so a dispatch that bought no
 * sampling arm never reached it. Every gate that could have caught it downstream did — `V80` failed with
 * `0 of 0 question(s) carried advice` and `V77` failed on the two missing arms — and none of them could
 * say *why*, because from the artefact's side "the pass wrote nothing" and "the pass never ran" are the
 * same reading.
 *
 * A pass whose cost is one call per question must not be conditional on a different arm's configuration.
 * The type checker cannot see this, the linter cannot see this, and the arm-coverage gate sees only its
 * consequence, so the invariant is stated here: a variable declared at the top level of `runFold` has a
 * `Block` for a parent, and a variable that has to run whenever its arms are bought must be one of them.
 */
const PATH = new URL('../bin/sota-bird.ts', import.meta.url);

function parse(): { source: string; file: ts.SourceFile } {
  const source = readFileSync(PATH, 'utf8');
  return { source, file: ts.createSourceFile(PATH.pathname, source, ts.ScriptTarget.ESNext, true) };
}

/** Every `const <name> = ...` statement in the file, with the ancestors that contain it. */
function declarationOf(
  file: ts.SourceFile,
  name: string,
): { node: ts.VariableStatement; ancestors: readonly ts.Node[] } | undefined {
  let found: { node: ts.VariableStatement; ancestors: readonly ts.Node[] } | undefined;
  const walk = (node: ts.Node, ancestors: readonly ts.Node[]): void => {
    if (found !== undefined) return;
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((declaration) => declaration.name.getText(file) === name)
    ) {
      found = { node, ancestors };
      return;
    }
    ts.forEachChild(node, (child) => walk(child, [...ancestors, node]));
  };
  walk(file, []);
  return found;
}

describe('a pass that costs a call per question is not gated on another arm', () => {
  const { file } = parse();

  it('declares the reconstruction pass at the top level of runFold', () => {
    const declaration = declarationOf(file, 'reconstructWanted');
    expect(declaration, 'reconstructWanted must exist: it is what the pass is gated on').toBeDefined();
    const parent = declaration?.ancestors.at(-1);
    // A `Block` parent is the function body. Anything else — an `IfStatement`, a loop, a `try` — means
    // the pass is reachable only when some other arm's configuration allows it, which is the defect.
    expect(ts.isBlock(parent), `parent is ${parent === undefined ? 'nothing' : ts.SyntaxKind[parent.kind]}`)
      .toBe(true);
    const owner = declaration?.ancestors.at(-2);
    expect(owner === undefined ? '' : owner.getText(file).slice(0, 40)).toContain('async function runFold');
  });

  it('does not nest it inside the sampling block that swallowed it', () => {
    const declaration = declarationOf(file, 'reconstructWanted');
    const conditions = (declaration?.ancestors ?? [])
      .filter((node): node is ts.IfStatement => ts.isIfStatement(node))
      .map((node) => node.expression.getText(file));
    expect(conditions.filter((text) => text.includes('samplingArmsThisRun'))).toEqual([]);
  });

  it('keeps the sampling block itself a top-level statement, so the move did not reshape it', () => {
    const declaration = declarationOf(file, 'samplingArmsThisRun');
    // The block is the thing the pass was moved *out of*; if a future edit flattens it, the invariant
    // above would still pass while the lane lost a condition, so the shape is asserted on both ends.
    expect(declaration).toBeDefined();
    let samplingIf: ts.IfStatement | undefined;
    const walk = (node: ts.Node): void => {
      if (samplingIf !== undefined) return;
      if (ts.isIfStatement(node) && node.expression.getText(file).includes('samplingArmsThisRun.length > 0')) {
        samplingIf = node;
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(file);
    expect(samplingIf, 'the sampling block must still exist').toBeDefined();
    // The pass must sit *after* that block ends, not inside it: the source is one string here, so this
    // is the ordering the artefact's per-fold bookkeeping depends on and the ordering the pass was moved
    // into. A future edit that re-nests it fails this line rather than failing at `0 of 0` on a paid run.
    const pushAt = file.text.indexOf('reconstructPasses.push(');
    expect(pushAt).toBeGreaterThan((samplingIf as ts.IfStatement).end);
  });
});

/**
 * The same defect in a second array.
 *
 * R81's third attempt failed `V77` after forty-two minutes with one of its two bought arms missing:
 * the donor library that `full-reconstructed-shuffled` draws from was built under `full-shuffled`
 * alone, so the reconstruction pair — which buys the control and not the arm that fills the library —
 * found no donor, produced no call and published no row. The treatment arm was complete, which is why
 * nothing before the coverage gate could see it.
 *
 * The lesson is not "fix that line". It is that **any array an arm reads has to be built for every
 * arm that reads it**, and the check has to happen before the run pays for the evaluation rather than
 * after. Both halves are asserted below.
 */
describe('an input library is built for every arm that reads it', () => {
  const { file } = parse();

  /** The condition a `const` is initialised under, or an empty string when it is not conditional. */
  function conditionOf(name: string): string {
    const declaration = declarationOf(file, name);
    expect(declaration, `${name} must exist`).toBeDefined();
    const initializer = declaration?.node.declarationList.declarations[0]?.initializer;
    expect(initializer, `${name} must be initialised`).toBeDefined();
    return initializer !== undefined && ts.isConditionalExpression(initializer)
      ? initializer.condition.getText(file)
      : '';
  }

  it('builds the donor library for the reconstruction control, not only for full-shuffled', () => {
    const condition = conditionOf('packLibrary');
    expect(condition).toContain("'full-shuffled'");
    expect(condition).toContain("'full-reconstructed-shuffled'");
  });

  it('refuses an empty library at the top of the first fold, not at the last gate', () => {
    const declaredAt = file.text.indexOf('const packLibrary');
    expect(declaredAt).toBeGreaterThan(0);
    // A union that a later edit narrows is one failure; deleting the check is another, and the second
    // one is silent. Both arms are named here because both read the same array. Matched as a pattern
    // rather than as a string so the call may be wrapped across lines without failing the test.
    for (const arm of ['full-shuffled', 'full-reconstructed-shuffled']) {
      const check = new RegExp(`requireInput\\(\\s*'${arm}'`).exec(file.text)?.index ?? -1;
      expect(check, `${arm} reads the library and has no check that it was filled`).toBeGreaterThan(
        declaredAt,
      );
    }
  });
});

/**
 * The general form of the defect R81 found twice.
 *
 * Two attempts died of the same shape in two different arrays: a pass written inside another arm's
 * `if`, and a donor library initialised under another arm's condition. Both are instances of one
 * sentence — **this lane has inputs that only some arms fill, and every arm that reads one has to be
 * among the arms that fill it** — so the check below is written against that sentence rather than
 * against either array.
 *
 * It walks the file once for `const x = <condition containing ARMS.has(...)> ? ... : ...`, then again
 * for every reference to `x`, carrying down the arm conditions of the `if` and the conditional
 * expressions the reference sits inside. A reader under an arm the declaration does not name is the
 * defect. The two fixtures after it exist because a check that is only ever run against a fixed file
 * cannot show that it would have fired before the fix.
 */
type ArmInputAudit = {
  /** Every input built under an arm condition, and the arms that condition names. */
  readonly declared: ReadonlyMap<string, readonly string[]>;
  /** Inputs read under an arm their declaration does not name, with those arms. */
  readonly missing: ReadonlyMap<string, readonly string[]>;
};

function armsIn(text: string): readonly string[] {
  return [...text.matchAll(/ARMS\.has\('([a-z0-9-]+)'\)/g)].map((match) => match[1] as string);
}

function auditArmInputs(source: string, name = 'sota-bird.ts'): ArmInputAudit {
  const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true);
  const declared = new Map<string, readonly string[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer === undefined || !ts.isConditionalExpression(initializer)) continue;
        const arms = armsIn(initializer.condition.getText(parsed));
        if (arms.length > 0) declared.set(declaration.name.getText(parsed), arms);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const readers = new Map<string, Set<string>>();
  const walk = (node: ts.Node, guards: readonly string[]): void => {
    if (ts.isIdentifier(node) && declared.has(node.text)) {
      const arms = readers.get(node.text) ?? new Set<string>();
      for (const arm of guards) arms.add(arm);
      readers.set(node.text, arms);
      return;
    }
    // Only the guard itself is read, never the guarded statement: an `if` whose body happens to
    // mention another arm would otherwise attribute that arm to everything inside it, and the first
    // version of this check did exactly that and reported the fixed array as still broken.
    const deeper = ts.isIfStatement(node)
      ? [...guards, ...armsIn(node.expression.getText(parsed))]
      : ts.isConditionalExpression(node)
        ? [...guards, ...armsIn(node.condition.getText(parsed))]
        : guards;
    ts.forEachChild(node, (child) => walk(child, deeper));
  };
  walk(parsed, []);
  const missing = new Map<string, readonly string[]>();
  for (const [input, built] of declared) {
    const unbuilt = [...(readers.get(input) ?? [])].filter((arm) => !built.includes(arm));
    if (unbuilt.length > 0) missing.set(input, unbuilt);
  }
  return { declared, missing };
}

describe('every arm that reads a conditional input is one of the arms that fills it', () => {
  it('finds no such reader in the lane', () => {
    const audit = auditArmInputs(readFileSync(PATH, 'utf8'));
    // The count guards against a refactor that removes the pattern: an empty audit passes for ever.
    expect(audit.declared.size).toBeGreaterThanOrEqual(8);
    expect([...audit.missing]).toEqual([]);
  });

  it("catches the array that failed R81's third attempt", () => {
    const fixture = [
      "const packLibrary = ARMS.has('full-shuffled') ? pieces : [];",
      "if (ARMS.has('full-reconstructed-shuffled')) consume(packLibrary);",
    ].join('\n');
    expect([...auditArmInputs(fixture, 'fixture.ts').missing]).toEqual([
      ['packLibrary', ['full-reconstructed-shuffled']],
    ]);
  });

  it('leaves an input that is not conditional alone', () => {
    const fixture = [
      'const everything = gather();',
      "if (ARMS.has('full')) consume(everything);",
    ].join('\n');
    const audit = auditArmInputs(fixture, 'fixture.ts');
    expect(audit.declared.size).toBe(0);
    expect([...audit.missing]).toEqual([]);
  });
});

/**
 * The fifth instance of the same shape, and the first one that produced a number.
 *
 * R81's fourth dispatch published `full-reconstructed` and `full-reconstructed-shuffled` at **0.00%**
 * — both at −52.57pp, with `V77` finding a row for each and `V80` finding advice in the prompts. The
 * plans existed and carried the treatment; they were never sent to the model. `replies` was collected
 * with one `mapPool(plans, …)` before the reconstruction pass appended its own plans, and the judge
 * then paired `plans[index]` with `replies[index]`, so every appended plan read another plan's reply
 * or `undefined`. The judge reads `undefined` as a failed reply, which is a wrong answer, which is an
 * effect.
 *
 * Three properties replace it, and each is asserted below: the judge looks the reply up by plan, a
 * fold refuses to score when a plan has none, and a pass that appends plans asks them.
 */
describe('a plan that was never sent to the model is not scored', () => {
  const text = readFileSync(PATH, 'utf8');
  // The judge loop, not the first `judgeReply(` in the file: the validation pass calls the same
  // function on learn rows, and an anchor that matched that one would compare positions in two
  // different parts of the fold.
  const judgeLoop = text.indexOf('for (const [index, plan] of plans.entries()) {');

  it('looks the reply up by plan rather than by position', () => {
    expect(judgeLoop).toBeGreaterThan(0);
    const body = text.slice(judgeLoop, text.indexOf('judged.set(', judgeLoop));
    expect(body).toContain('replyOf.get(plan)');
    // Not the file: the comment above the map explains the defect and names the old expression, so a
    // file-wide search would fail on the explanation rather than on the code.
    expect(body).not.toContain('replies[');
  });

  it('refuses a fold in which a planned call has no reply', () => {
    const guard = text.indexOf('replyOf.size !== plans.length');
    expect(guard).toBeGreaterThan(0);
    // Before the judge, because the judge is what turns a missing reply into a wrong answer.
    expect(guard).toBeLessThan(judgeLoop);
  });

  it('asks the plans that a later pass appends', () => {
    const first = text.indexOf('await askPlanned(plans);');
    const later = text.indexOf('askPlanned(plans.slice(answered));');
    expect(first).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(first);
    // After the reconstruction calls and before the judge: an arm whose prompt is built from the
    // store has to be answered after it is built and before it is scored.
    const reconstructCall = text.indexOf("call(position, 'full-reconstructed-shuffled', guidance.text, 0);");
    expect(reconstructCall).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(reconstructCall);
    expect(later).toBeLessThan(judgeLoop);
  });
});

describe('the thinking regime is the registration\'s, and the artefact says which one ran', () => {
  const { file, source: text } = parse();

  it('derives the regime from the header rather than from the variable alone', () => {
    // R84's claim is that one variable moved, and the regime is the one it held fixed. A lane that ran
    // the variable's value while the file said the other thing would publish a number about a different
    // experiment under the registration's name, and nothing in the artefact would contradict it: the
    // `thinking` field would simply report what the variable held.
    const derived = declarationOf(file, 'THINKING');
    expect(derived).toBeDefined();
    const body = derived?.node.getText(file) ?? '';
    expect(body).toContain('declaredThinking(PREREG)');
    expect(body).toContain('thinkingProblem(THINKING_ENV, declared)');
    expect(body).toContain('return THINKING_ENV ?? declared ?? \'off\';');
  });

  it('reads the header before the budget it decides', () => {
    // `answerBudget` adds the thinking headroom, so a regime discovered after the budget is computed
    // would produce 700 tokens for a run that thinks and truncate every answer it was meant to protect.
    expect(text.indexOf('const THINKING:')).toBeLessThan(text.indexOf('const COMPLETION_BUDGET ='));
  });

  it('records the regime it ran, not the one the environment named', () => {
    const usage = text.indexOf('thinking: THINKING,', text.indexOf('usage: {'));
    expect(usage).toBeGreaterThan(0);
    expect(text.slice(usage, usage + 40)).toContain('thinking: THINKING,');
    // The raw variable is never what the run reports: an unset variable is `null` and the artefact has
    // no such value, and a set one that the header overruled would be a different run's regime.
    expect(text).not.toContain('thinking: THINKING_ENV');
  });
});

describe('the lane role is on the artefact, not only in the documents', () => {
  const { source: text } = parse();

  it('declares the class that these numbers may be quoted as', () => {
    // BIRD is the hostile case by S2c. The constant is what makes the classification a property of the
    // output instead of a convention its reader has to remember — and remembering is what failed: a
    // report quoted this lane's absolute accuracy beside a leaderboard row three days after the rule
    // was fixed.
    expect(text).toContain("const CLAIM_CLASS = 'hostile';");
    const usage = text.indexOf('claim_class: CLAIM_CLASS,');
    expect(usage).toBeGreaterThan(0);
    // It sits in the same object as the model and the regime, because a reader who takes one of those
    // three without the other two is holding a number about an experiment they cannot identify.
    expect(usage).toBeGreaterThan(text.indexOf('configured_model: llm.configuredModel,'));
    expect(usage).toBeLessThan(text.indexOf('max_completion_tokens: COMPLETION_BUDGET,'));
  });

  it('refuses a registration that claims evidence this lane cannot supply', () => {
    const call = text.indexOf('laneRoleProblem(reading.prereg.lane');
    expect(call).toBeGreaterThan(0);
    // The split is the fact the refusal turns on: a BIRD split means no recurrence, and a claim of
    // product or transfer evidence on it is a claim about experience measured where nothing recurs.
    expect(text.slice(call, call + 120)).toContain('split: SPLIT_NAME');
    // Refused before the first model call, like every other header check: the block that runs this is
    // the one that already reads the registration for its backbone, and it is module scope.
    expect(call).toBeLessThan(text.indexOf('await askPlanned('));
  });
});

describe('every switch a registration owns is read from the registration', () => {
  const WORKFLOW = new URL('../../../../.github/workflows/sota.yml', import.meta.url);
  const text = readFileSync(WORKFLOW, 'utf8');

  /**
   * The switches a header field supplies, and the output each must be read from.
   *
   * The list is the point. A switch that a registration can fix and a dispatch can still override is a
   * treatment with two sources of truth, and the record has paid for that three times: R51 graded a
   * retail store on airline questions because the scenario pair lived in a variable, R82's model was one
   * forgotten `PATCH` from being a different experiment, and R56's entire treatment — the distiller's
   * form — had been unsettable by any dispatch until this round. The last one is why the check exists:
   * the form was read by the driver, resolved through a tested function, recorded in the artefact, and
   * reachable only from `vars`, so a registration could say `procedure` and run `lesson`.
   */
  const OWNED: readonly (readonly [string, string])[] = [
    ['TAU_MIN_COVERAGE', 'floor'],
    ['TAU_FACADE_PAIR', 'pair'],
    ['TAU_FACADE_NOTES', 'notes'],
    ['TAU_TRAIN_DOMAIN', 'train'],
    ['TAU_TEST_DOMAIN', 'test'],
    ['TAU_RECALL_DOMAIN', 'recall'],
    ['TAU_DISTILL_FORM', 'form'],
    ['TAU_DISTILL_UNIT', 'unit'],
    ['TAU_DISTILL_SCOPE', 'scope'],
    ['TAU_TRACE_CLAIMS', 'claims'],
    // The seventh, and the one whose absence the repository audit caught rather than a test: a switch
    // that code reads and no workflow can set has its default as its only value, which is what
    // `scripts/audit.mjs` refuses. R55.1's two arms differ in this line and nothing else.
    ['TAU_PACK_MODE', 'mode'],
  ];

  /** The line a key is assigned on, in the L4 step, with its continuation lines folded in. */
  function assignmentOf(key: string): string {
    const lines = text.split('\n');
    const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`));
    expect(index, `${key} is not assigned anywhere in sota.yml`).toBeGreaterThan(-1);
    return lines.slice(index, index + 3).join('\n');
  }

  /** Every line a key is assigned on: two arms of one experiment read the same header. */
  function assignmentsOf(key: string): readonly string[] {
    const lines = text.split('\n');
    const found = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.trimStart().startsWith(`${key}:`))
      .map((entry) => lines.slice(entry.index, entry.index + 3).join('\n'));
    expect(found.length, `${key} is not assigned anywhere in sota.yml`).toBeGreaterThan(0);
    return found;
  }

  it('does not read the note level from the three-arm flag', () => {
    // `TAU_INJECTION_NOTE` is a level (`standard`, `hardened`, `cautious`, `none`); `facadeNotes` is
    // the three-arm flag and its output is `false` when a header names nothing. Wiring the level to it
    // made every dispatch fail before its first model call, which is how this assertion came to exist:
    // a switch whose two spellings look alike and mean different things is not a switch the guard can
    // infer from a name.
    expect(text).toContain('TAU_INJECTION_NOTE: ${{ vars.TAU_INJECTION_NOTE }}');
  });

  for (const [key, output] of OWNED) {
    it(`${key} prefers the registration's ${output} over the variable`, () => {
      expect(assignmentOf(key)).toContain(`steps.recall_floor.outputs.${output}`);
    });

    it(`every arm that sets ${key} reads the registration's ${output}`, () => {
      // The first version of this test read one assignment and passed while the reference arm read the
      // repository variable: a control whose artefact records `lesson` beside a treatment that recorded
      // `procedure` is two experiments in one file, and it was invisible because the assertion stopped
      // at the first match.
      for (const assignment of assignmentsOf(key)) {
        expect(assignment, assignment).toContain(`steps.recall_floor.outputs.${output}`);
      }
    });
  }

  it('emits each of those outputs from the step that reads the header', () => {
    // A preference for an output that is never written is an empty string, which silently restores the
    // variable — the same failure as never wiring it, one layer down.
    for (const output of OWNED.map(([, name]) => name)) {
      expect(text).toContain(`echo "${output}=`);
    }
  });
});

describe('the distiller is sized by the same function as the answer', () => {
  const { source: text } = parse();

  it('does not leave the distiller budget as a literal at the call site', () => {
    // R84 sent 1,400 distillations through a literal — `form === 'repair' ? 3000 : 2000` — while the
    // answer went through `answerBudget`, so with the regime on, the distiller spent its ceiling
    // thinking and 572 replies arrived empty or truncated. The two magnitudes were in the same file and
    // only one of them knew what regime the run was in.
    expect(text).toContain('chat(prompt, distillBudget(form, THINKING))');
    expect(text).not.toContain("form === 'repair' ? 3000 : 2000");
  });

  it('records the budgets it used, which is two numbers and not one', () => {
    // The artefact published `distill_max_tokens: 2000` while a repair run spent 3,000: a recorded
    // value that is not the value the run ran, which is the defect the rate card closed for money.
    expect(text).toContain("distill_max_tokens: distillBudget('rule', THINKING),");
    expect(text).toContain("distill_repair_max_tokens: distillBudget('repair', THINKING),");
  });
});
