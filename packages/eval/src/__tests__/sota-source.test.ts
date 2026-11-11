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
