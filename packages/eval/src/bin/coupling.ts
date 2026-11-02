/**
 * R40's reading: the layer table recomputed from the tree, not remembered.
 *
 * `PROGRESS` §136 published a table — 11,764 lines of text-to-SQL, 37.2% of the repository, none of
 * it in `core` — and every number in it was measured once by hand. That is the failure mode this
 * record has repaired four times in other layers: a claimed number with no recomputation is one
 * merge away from being false and nobody notices, because the sentence keeps rendering.
 *
 * So the same table is a command. It walks every production module in `packages/*`, counts its
 * lines, counts the scenario words that appear in **code** rather than in comments, classifies it
 * against the deferral table, and reads the package import graph. Three gates decide whether the
 * answer is publishable: every coupled module has a verdict (`V72`), no package imports upward
 * (`V73`), and `core` names no scenario at all (`V74`).
 *
 * No model call. No artefact input. The output changes only when the source does, which is what
 * makes it diffable in CI on every push.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAYER_ORDER,
  coupledShare,
  coreGate,
  importEdges,
  layerGate,
  layerTotals,
  moduleRow,
  totalityGate,
  type Layer,
  type ModuleSource,
} from '../coupling.js';
import { writeJson } from './lib.js';

const ROOT = process.cwd();

/** Directories whose contents are not production code, by the repository's own definition. */
const SKIP_DIRS: ReadonlySet<string> = new Set(['__tests__', 'bin', 'bench']);

/**
 * Whether a file is a production module of its package.
 *
 * `index.ts` is a re-export surface and `.d.ts` is a declaration; neither contains a decision, so
 * counting their lines would make the table's denominator depend on how many subpaths a package
 * chose to expose.
 */
function isProductionModule(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.d.ts')) return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name !== 'index.ts';
}

function collect(dir: string, pkg: Layer, into: ModuleSource[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path, pkg, into);
      continue;
    }
    if (!isProductionModule(path)) continue;
    into.push({ path: path.slice(ROOT.length + 1), pkg, source: readFileSync(path, 'utf8') });
  }
}

const sources: ModuleSource[] = [];
for (const layer of LAYER_ORDER) {
  const dir = join(ROOT, 'packages', layer, 'src');
  if (existsSync(dir)) collect(dir, layer, sources);
}

const rows = sources.map(moduleRow);
const edges = importEdges(sources);
const layers = layerTotals(rows);
const gates = [totalityGate({ scanned: sources.length, rows }), layerGate(edges), coreGate(rows)];

/** Modules that name a scenario, with the verdict that decides whether that is allowed. */
const coupled = rows
  .filter((row) => row.codeWords.length > 0)
  .map((row) => ({
    pkg: row.pkg,
    module: row.module,
    path: row.path,
    lines: row.lines,
    words: row.codeWords,
    verdict: row.verdict,
    reason: row.reason,
  }))
  .sort((left, right) => left.path.localeCompare(right.path));

/** Modules that mention a scenario only in a comment: published, and deliberately not enforced. */
const commentOnly = rows
  .filter((row) => row.codeWords.length === 0 && row.commentWords.length > 0)
  .map((row) => ({ pkg: row.pkg, module: row.module, words: row.commentWords }))
  .sort((left, right) => left.module.localeCompare(right.module));

const sql = layers.find((layer) => layer.layer === 'sql');
const core = layers.find((layer) => layer.layer === 'core');
const deferred = rows.filter((row) => row.verdict === 'deferred');
const totalLines = layers.reduce((sum, layer) => sum + layer.lines, 0);

const statement = `the scenario is ${String(sql?.lines ?? 0)} of ${String(totalLines)} production lines `
  + `across ${String(sources.length)} modules: ${String(sql?.modules ?? 0)} adapter modules in \`sql\`, `
  + `${String(deferred.length)} deferred with a reason, and \`core\` at ${String(core?.coupled ?? 0)} coupled `
  + `modules of ${String(core?.modules ?? 0)}; ${String(edges.length)} package edges, `
  + `${String(edges.filter((edge) => edge.upward).length)} of them upward.`;

await writeJson('poc-coupling', {
  id: 'poc-coupling',
  title: 'The scenario\'s size, recomputed from the tree on every push',
  source: 'worktree',
  scanned: sources.length,
  totals: {
    modules: sources.length,
    lines: totalLines,
    adapterLines: sql?.lines ?? 0,
    deferredLines: deferred.reduce((sum, row) => sum + row.lines, 0),
    coupledShare: coupledShare(rows),
  },
  layers,
  edges,
  coupled,
  commentOnly,
  gates,
  statement: statement.replace(/\s+/g, ' ').trim(),
});
