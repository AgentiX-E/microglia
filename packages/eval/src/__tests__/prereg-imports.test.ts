import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * A registration is read by jobs that run *before* the build, so its import closure must not need one.
 *
 * This is the second half of a defect that cost two dispatches. `prereg.ts` imported `restModelOf` from
 * `model-client.ts`, which imports `@agentix-e/microglia-core` for its error type — and the core
 * package's entry point is `dist/index.js`, which does not exist until something builds it. The `BIRD`
 * job builds before it reads anything and was fine; the two jobs that answer "which lane is this" and
 * "which arms does this registration run" do not, and both died with `ERR_MODULE_NOT_FOUND` on a step
 * whose entire job was to print a line. The failure was in the dispatch, not in the experiment, and it
 * took a paid run's worth of time to read.
 *
 * The translation now lives in `model-id.ts`, which imports nothing. This test walks the relative import
 * closure of `prereg.ts` and refuses any edge into the core package, so the next convenience import that
 * looks harmless fails here in two seconds instead of in CI on a dispatch.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_SRC = resolve(HERE, '..');

/** Every relative module a file imports, resolved to a path on disk, plus every bare specifier it names. */
function importsOf(file: string): { readonly relatives: readonly string[]; readonly bare: readonly string[] } {
  const source = readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const relatives: string[] = [];
  const bare: string[] = [];
  parsed.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    // An `import type` is erased by the compiler, so it is not a module the runtime loads: `prereg.ts`
    // names `sota.ts`'s arm type and that file imports the core package, which is exactly the edge this
    // walk must not follow — and exactly the edge the bundler does not follow either.
    if (node.importClause?.isTypeOnly === true) return;
    const specifier = node.moduleSpecifier.text;
    if (specifier.startsWith('.')) {
      // `./x.js` is how the source names `./x.ts`: the build rewrites the extension, the tree does not.
      relatives.push(resolve(dirname(file), specifier).replace(/\.js$/, '.ts'));
    } else {
      bare.push(specifier);
    }
  });
  return { relatives, bare };
}

function closureOf(entry: string): Map<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const { relatives, bare } = importsOf(file);
    seen.set(file, bare);
    queue.push(...relatives);
  }
  return seen;
}

describe('the registration reader runs before anything is built', () => {
  const closure = closureOf(resolve(EVAL_SRC, 'prereg.ts'));

  it('imports nothing from the core package anywhere in its relative closure', () => {
    const offenders = [...closure.entries()]
      .filter(([, bare]) => bare.some((specifier) => specifier.startsWith('@agentix-e/microglia-')))
      .map(([file, bare]) => `${file.replace(EVAL_SRC, '')} -> ${bare.join(', ')}`);
    // The core package's entry point is `dist/index.js`, and every job that answers a question about a
    // registration runs before `pnpm build`. A dependency here is a dependency on a build.
    expect(offenders).toEqual([]);
  });

  it('reaches the translation without reaching the client that owns an error type', () => {
    const files = [...closure.keys()].map((file) => file.replace(EVAL_SRC, ''));
    expect(files).toContain('/model-id.ts');
    expect(files).not.toContain('/model-client.ts');
  });

  it('walks a closure of more than one file, so the test is not passing on an empty walk', () => {
    // A resolver that found no relative imports at all would satisfy both assertions above while proving
    // nothing. `prereg.ts` imports its own type box and the model-id translation, so two is the floor.
    expect(closure.size).toBeGreaterThanOrEqual(2);
  });
});
