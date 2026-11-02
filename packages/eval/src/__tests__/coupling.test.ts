/**
 * The coupling scan's tests, one per shape that has already fooled it once.
 *
 * Three of the cases below are regressions rather than coverage. A `/` that starts a regular
 * expression instead of a comment, a `//` inside a URL, and a quote inside a regex literal are the
 * three ways a comment stripper silently eats a module's body — and an eaten body reads as a module
 * with no scenario words in it, which is the direction that makes a gate pass while the thing it
 * certifies is gone. Each has a test with the input that broke it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFERRALS,
  LAYER_ORDER,
  SCENARIO_WORDS,
  coreGate,
  coupledShare,
  importEdges,
  layerGate,
  layerTotals,
  moduleNameOf,
  moduleRow,
  scenarioWords,
  stripComments,
  totalityGate,
  wordsOf,
  type ModuleRow,
  type ModuleSource,
} from '../coupling.js';

const source = (path: string, text: string, pkg: ModuleSource['pkg'] = 'eval'): ModuleSource => ({
  path,
  pkg,
  source: text,
});

const row = (over: Partial<ModuleRow> = {}): ModuleRow => ({
  pkg: 'eval',
  module: 'example',
  path: 'packages/eval/src/example.ts',
  lines: 10,
  codeWords: [],
  commentWords: [],
  verdict: 'general',
  reason: null,
  ...over,
});

describe('stripComments', () => {
  it('removes a line comment and keeps the code before it', () => {
    expect(stripComments('const a = 1; // sql\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
  });

  it('removes a block comment', () => {
    expect(stripComments('a /* sql bird */ b')).toBe('a  b');
  });

  it('keeps a URL, because the slashes are inside a string', () => {
    expect(stripComments("const u = 'https://example.com/x'; // gone")).toBe("const u = 'https://example.com/x'; ");
  });

  it('keeps a template literal that contains a comment opener', () => {
    expect(stripComments('const t = `a // b`; // gone')).toBe('const t = `a // b`; ');
  });

  it('respects an escaped quote inside a string', () => {
    expect(stripComments("const s = 'it\\'s'; // gone")).toBe("const s = 'it\\'s'; ");
  });

  it('keeps a regex literal whose quotes would otherwise open a string', () => {
    // The exact input that broke the first version: `lexicon.ts` line 242.
    const text = 'const m = /^- "([^"]+)":/.exec(line);\n/** sql */\nconst after = 1;';
    expect(stripComments(text)).toBe('const m = /^- "([^"]+)":/.exec(line);\n\nconst after = 1;');
  });

  it('keeps a regex literal whose character class contains a slash', () => {
    expect(stripComments('const r = /[a/]b/g; // gone')).toBe('const r = /[a/]b/g; ');
  });

  it('keeps an escaped slash inside a regex', () => {
    expect(stripComments('const r = /a\\/b/; // gone')).toBe('const r = /a\\/b/; ');
  });

  it('reads a slash after a value as division, not as a regex', () => {
    // `b / c` divides; if this were read as a regex the rest of the line would be swallowed.
    expect(stripComments('const a = b / c; // sql')).toBe('const a = b / c; ');
  });

  it('reads a slash at the start of the file as a regex', () => {
    expect(stripComments('/sql/.test(x)')).toBe('/sql/.test(x)');
  });

  it('survives an unterminated block comment', () => {
    expect(stripComments('a /* b')).toBe('a ');
  });

  it('survives an unterminated string', () => {
    expect(stripComments("a 'b")).toBe("a 'b");
  });

  it('survives a string that ends on a lone backslash', () => {
    expect(stripComments("a 'b\\")).toBe("a 'b\\");
  });

  it('survives a regex that ends on a lone backslash', () => {
    expect(stripComments('const r = /a\\')).toBe('const r = /a\\');
  });
});

describe('scenarioWords', () => {
  it('finds the strict words, case-insensitively', () => {
    expect(scenarioWords('SQLite and BIRD')).toEqual(['sqlite', 'bird']);
  });

  it('treats a hyphenated phrase as one word, so it is not counted twice', () => {
    expect(scenarioWords('a text-to-sql system')).toEqual(['text-to-sql']);
  });

  it('does not count a word that merely contains a scenario word', () => {
    expect(scenarioWords('mysqlite is not sqlite')).toEqual(['sqlite']);
  });

  it('ignores the words the strict list deliberately leaves out', () => {
    // `query`, `schema`, `table` and `column` are excluded on purpose: they are also the vocabulary
    // of a memory store, and a gate with false positives gets suppressed.
    expect(scenarioWords('query the schema of a table by column')).toEqual([]);
  });

  it('tokenises on everything that is not a letter or a digit', () => {
    // `.` and `_` separate; `-` is kept inside a token so a hyphenated phrase stays one word.
    expect([...wordsOf('a.b_c text-to-sql')]).toEqual(['a', 'b', 'c', 'text-to-sql']);
  });
});

describe('moduleNameOf', () => {
  it('takes the last path component without the extension', () => {
    expect(moduleNameOf('packages/eval/src/sql-exec.ts')).toBe('sql-exec');
  });

  it('leaves a name with no extension alone', () => {
    expect(moduleNameOf('packages/eval/src/README')).toBe('README');
  });
});

describe('moduleRow', () => {
  it('calls everything in the adapter package an adapter, whether or not it says the word', () => {
    expect(moduleRow(source('packages/sql/src/value-samples.ts', 'export const x = 1;', 'sql')).verdict).toBe('adapter');
  });

  it('defers a module that names a scenario and has a written reason', () => {
    const result = moduleRow(source('packages/eval/src/sota.ts', "const p = 'sql';"));
    expect(result.verdict).toBe('deferred');
    expect(result.reason).toBe(DEFERRALS['sota']);
  });

  it('leaves a module general when it names a scenario and nobody wrote a reason', () => {
    // The gate is what fails; the row reports what it found.
    const result = moduleRow(source('packages/eval/src/unclassified.ts', "const p = 'sql';"));
    expect(result.verdict).toBe('general');
    expect(result.reason).toBeNull();
  });

  it('leaves a module general when it names nothing', () => {
    expect(moduleRow(source('packages/core/src/kernel/x.ts', 'export const x = 1;', 'core')).verdict).toBe('general');
  });

  it('counts a word that survives only in a comment separately, and does not enforce it', () => {
    const result = moduleRow(source('packages/eval/src/quiet.ts', '/** sql */\nexport const x = 1;'));
    expect(result.codeWords).toEqual([]);
    expect(result.commentWords).toEqual(['sql']);
  });

  it('counts a word that appears in code as code, not as a comment', () => {
    const result = moduleRow(source('packages/eval/src/loud.ts', "// sql\nconst p = 'sql';"));
    expect(result.codeWords).toEqual(['sql']);
    expect(result.commentWords).toEqual([]);
  });

  it('counts lines, and reports an empty module as zero rather than one', () => {
    expect(moduleRow(source('packages/eval/src/one.ts', 'a\nb')).lines).toBe(2);
    expect(moduleRow(source('packages/eval/src/empty.ts', '')).lines).toBe(0);
  });

  it('keeps the reason only on deferred rows', () => {
    expect(moduleRow(source('packages/sql/src/sota.ts', "const p = 'sql';", 'sql')).reason).toBeNull();
  });
});

describe('layerTotals', () => {
  const rows: readonly ModuleRow[] = [
    row({ pkg: 'core', lines: 100, verdict: 'general' }),
    row({ pkg: 'sql', lines: 300, verdict: 'adapter', codeWords: ['sql'] }),
    row({ pkg: 'sql', lines: 100, verdict: 'adapter' }),
    row({ pkg: 'eval', lines: 500, verdict: 'deferred', codeWords: ['sql'], reason: 'x' }),
  ];

  it('sums lines and modules per layer', () => {
    const totals = layerTotals(rows);
    expect(totals.map((total) => total.layer)).toEqual(['core', 'sql', 'eval']);
    expect(totals[1]).toEqual({ layer: 'sql', modules: 2, lines: 400, adapterLines: 400, deferredLines: 0, coupled: 1 });
  });

  it('drops a layer with no modules rather than publishing a zero row', () => {
    expect(layerTotals(rows).some((total) => total.layer === 'node')).toBe(false);
  });

  it('counts a layer with modules but no coupling as present and coupled-free', () => {
    const totals = layerTotals([row({ pkg: 'core', lines: 7 })]);
    expect(totals[0]?.coupled).toBe(0);
    expect(totals[0]?.deferredLines).toBe(0);
  });
});

describe('importEdges', () => {
  it('counts one file once however many times it imports the same package', () => {
    const edges = importEdges([
      source('packages/eval/src/a.ts', "import { x } from '@agentix-e/microglia-sql';\nimport type { Y } from '@agentix-e/microglia-sql';"),
    ]);
    expect(edges).toEqual([{ from: 'eval', to: 'sql', files: 1, upward: false }]);
  });

  it('counts two files as two', () => {
    const edges = importEdges([
      source('packages/eval/src/a.ts', "import { x } from '@agentix-e/microglia-sql';"),
      source('packages/eval/src/b.ts', "import { y } from '@agentix-e/microglia-sql';"),
    ]);
    expect(edges[0]?.files).toBe(2);
  });

  it('ignores a package importing itself', () => {
    expect(importEdges([source('packages/eval/src/a.ts', "import { x } from '@agentix-e/microglia-eval';")])).toEqual([]);
  });

  it('subpath imports count as the package they belong to', () => {
    const edges = importEdges([source('packages/node/src/a.ts', "import { m } from '@agentix-e/microglia-core/memory';", 'node')]);
    expect(edges[0]?.to).toBe('core');
  });

  it('ignores an internal name that is not one of the six layers', () => {
    expect(importEdges([source('packages/eval/src/a.ts', "import { x } from '@agentix-e/microglia-widget';")])).toEqual([]);
  });

  it('ignores a specifier that names no package', () => {
    expect(importEdges([source('packages/eval/src/a.ts', "import { x } from 'node:fs';")])).toEqual([]);
  });

  it('does not read an import out of a comment', () => {
    const edges = importEdges([source('packages/eval/src/a.ts', "// import { x } from '@agentix-e/microglia-sql';")]);
    expect(edges).toEqual([]);
  });

  it('marks an edge that points at an equal or higher rank as upward', () => {
    const edges = importEdges([source('packages/core/src/a.ts', "import { x } from '@agentix-e/microglia-eval';", 'core')]);
    expect(edges[0]?.upward).toBe(true);
  });

  it('sorts the edges so the artefact is stable between runs', () => {
    const edges = importEdges([
      source('packages/node/src/a.ts', "import { x } from '@agentix-e/microglia-core';", 'node'),
      source('packages/eval/src/b.ts', "import { x } from '@agentix-e/microglia-protocol';"),
    ]);
    expect(edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['eval->protocol', 'node->core']);
  });
});

describe('V72 totality', () => {
  it('passes when every coupled module is an adapter or has a reason', () => {
    const gate = totalityGate({
      scanned: 2,
      rows: [
        row({ pkg: 'sql', verdict: 'adapter', codeWords: ['sql'] }),
        row({ verdict: 'deferred', codeWords: ['bird'], reason: 'the loader' }),
      ],
    });
    expect(gate.pass).toBe(true);
    expect(gate.detail).toContain('1 deferred');
  });

  it('fails on a coupled module with no verdict, and names it', () => {
    const gate = totalityGate({ scanned: 1, rows: [row({ path: 'packages/eval/src/loose.ts', codeWords: ['sql'] })] });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('packages/eval/src/loose.ts');
  });

  it('fails when the table is shorter than the walk', () => {
    const gate = totalityGate({ scanned: 5, rows: [row()] });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('4 scanned modules');
  });

  it('fails when the walk found nothing at all', () => {
    expect(totalityGate({ scanned: 0, rows: [] }).pass).toBe(false);
  });
});

describe('V73 direction', () => {
  it('passes when every edge points downwards', () => {
    const gate = layerGate([{ from: 'eval', to: 'sql', files: 3, upward: false }]);
    expect(gate.pass).toBe(true);
    expect(gate.detail).toContain('every one downwards');
  });

  it('fails on an upward edge and names both ends', () => {
    const gate = layerGate([{ from: 'core', to: 'eval', files: 1, upward: true }]);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('core -> eval');
  });

  it('fails on an empty graph, because no package importing another cannot be true here', () => {
    expect(layerGate([]).pass).toBe(false);
  });
});

describe('V74 core', () => {
  it('passes when core has modules and none of them names a scenario', () => {
    const gate = coreGate([row({ pkg: 'core', lines: 7 }), row({ pkg: 'eval', codeWords: ['sql'] })]);
    expect(gate.pass).toBe(true);
    expect(gate.detail).toContain('zero scenario words');
  });

  it('fails when a core module names a scenario, and names it', () => {
    const gate = coreGate([row({ pkg: 'core', path: 'packages/core/src/x.ts', codeWords: ['sql'] })]);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('packages/core/src/x.ts');
  });

  it('fails vacuously when core has no production modules at all', () => {
    expect(coreGate([row({ pkg: 'eval' })]).pass).toBe(false);
  });
});

describe('shares', () => {
  it('reports the coupled share of production lines', () => {
    expect(coupledShare([row({ lines: 25, codeWords: ['sql'] }), row({ lines: 75 })])).toBe(0.25);
  });

  it('reports zero rather than NaN for an empty tree', () => {
    expect(coupledShare([])).toBe(0);
  });

  it('declares the six layers in dependency order, and every one of them has a rank', () => {
    expect([...LAYER_ORDER]).toEqual(['core', 'protocol', 'sql', 'eval', 'browser', 'node']);
    expect(SCENARIO_WORDS.length).toBe(6);
  });
});
