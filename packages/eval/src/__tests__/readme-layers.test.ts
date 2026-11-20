/**
 * The README's layer table, checked against the tree instead of trusted.
 *
 * `README.md` said the table was "recomputed from the source tree on every push". It was not: the
 * command existed and the table beside it was typed once, by hand, and had drifted from 37/6,821 to
 * 47/10,588 modules/lines in `core` alone. A number that nothing compares is a number that keeps
 * rendering after it stops being true, and the paragraph around it keeps rendering with it — the
 * heading still claimed 1,766 SQL lines after the scan said 1,956.
 *
 * So this test walks the tree the way `bin/coupling.ts` does, then parses the table and the two
 * sentences that quote it, and fails on any disagreement. It is a gate rather than a report because
 * the failure it catches has already happened once and had no symptom.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAYER_ORDER,
  isProductionModulePath,
  layerTotals,
  moduleRow,
  NON_PRODUCTION_DIRS,
  type Layer,
  type ModuleSource,
} from '../coupling.js';

const ROOT = process.cwd();

function collect(dir: string, pkg: Layer, into: ModuleSource[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (NON_PRODUCTION_DIRS.has(entry.name)) continue;
      collect(path, pkg, into);
      continue;
    }
    if (!isProductionModulePath(path)) continue;
    into.push({ path: path.slice(ROOT.length + 1), pkg, source: readFileSync(path, 'utf8') });
  }
}

const sources: ModuleSource[] = [];
for (const layer of LAYER_ORDER) {
  try {
    collect(join(ROOT, 'packages', layer, 'src'), layer, sources);
  } catch {
    // A package that is not checked out in this tree is simply absent, exactly as in the command.
  }
}

const totals = layerTotals(sources.map(moduleRow));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

/** The table body under the header that names a production-module column, as written cells. */
function tableCells(): string[][] {
  const lines = readme.split('\n');
  const header = lines.findIndex((line) => line.startsWith('| layer | production modules |'));
  if (header < 0) throw new Error('README has no layer table under the expected header');
  const rows: string[][] = [];
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    // The separator row is dashes, not content.
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

/** A published cell as a number: bold marks and thousands separators are formatting, not value. */
function numberIn(cell: string): number {
  const digits = cell.replace(/\*/g, '').match(/-?[\d,]+/);
  if (digits === null) throw new Error(`no number in cell ${JSON.stringify(cell)}`);
  return Number(digits[0].replace(/,/g, ''));
}

const layerOf = (cell: string): string => cell.replace(/`/g, '').split(' ')[0] as string;

describe('the README layer table', () => {
  it('lists every layer that has production modules, and no layer twice', () => {
    const named = tableCells().map((cells) => layerOf(cells[0] as string));
    expect(named).toEqual(totals.map((total) => total.layer));
  });

  it('reports the module count the walker finds', () => {
    const published = new Map(
      tableCells().map((cells) => [layerOf(cells[0] as string), numberIn(cells[1] as string)]),
    );
    for (const total of totals) {
      expect({ layer: total.layer, modules: published.get(total.layer) }).toEqual({
        layer: total.layer,
        modules: total.productionModules,
      });
    }
  });

  it('reports the line count the walker finds', () => {
    const published = new Map(
      tableCells().map((cells) => [layerOf(cells[0] as string), numberIn(cells[2] as string)]),
    );
    for (const total of totals) {
      expect({ layer: total.layer, lines: published.get(total.layer) }).toEqual({
        layer: total.layer,
        lines: total.lines,
      });
    }
  });

  it('reports the coupled count the walker finds', () => {
    const published = new Map(
      tableCells().map((cells) => [layerOf(cells[0] as string), numberIn(cells[3] as string)]),
    );
    for (const total of totals) {
      expect({ layer: total.layer, coupled: published.get(total.layer) }).toEqual({
        layer: total.layer,
        coupled: total.coupled,
      });
    }
  });

  it('quotes the adapter size and module count in the heading', () => {
    const sql = totals.find((total) => total.layer === 'sql');
    expect(sql).toBeDefined();
    const heading = readme.split('\n').find((line) => line.startsWith('### Where the scenario actually is'));
    expect(heading).toBeDefined();
    const quoted = (heading as string).replace(/\*\*/g, '').match(/([\d,]+) lines, ([\d,]+) modules/);
    expect(quoted).not.toBeNull();
    expect({ lines: Number((quoted as RegExpMatchArray)[1]?.replace(/,/g, '')), modules: Number((quoted as RegExpMatchArray)[2]) })
      .toEqual({ lines: sql?.lines, modules: sql?.productionModules });
  });

  it('quotes the adapter share of the tree, to one decimal', () => {
    const lines = totals.reduce((sum, total) => sum + total.lines, 0);
    const sql = totals.find((total) => total.layer === 'sql')?.lines ?? 0;
    const share = `${((100 * sql) / lines).toFixed(1)}%`;
    expect(readme).toContain(`${share} of the production tree`);
  });

  it('quotes the deferred count in the sentence that explains the gate', () => {
    const outside = totals.filter((total) => total.layer !== 'sql');
    const coupled = outside.reduce((sum, total) => sum + total.coupled, 0);
    // The prose wraps, so the claim is matched against the whole document with runs of whitespace
    // collapsed rather than against a single line: the first version of this test looked for the
    // ordinal on the same line as the count and failed on a paragraph that was merely wrapped.
    const flat = readme.replace(/\s+/g, ' ');
    expect(flat).toContain(`The ${coupled} modules that keep a scenario word outside the adapter`);
    // The count and the ordinal both have to move with the tree: "if a 26th arrives" is a claim about
    // 25, and a gate that keeps saying 25 after a 26th lands is a gate nobody re-read.
    expect(flat).toContain(`a ${coupled + 1}th arrives`);
  });
});
