import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATE_ORDER } from '@agentix-e/microglia-protocol';
import { TAU2_GATE_INDEX } from '../tau2-gates.js';
import { gateRows, renderMatrix } from '../gate-matrix.js';
import { main } from '../bin/gate-matrix.js';

/**
 * The matrix is a projection of the two tables, so the tests are about the projection.
 *
 * The numbers it prints — 40 gates, 14 supplyable, 26 arm-indexed — are quoted in the audit and in
 * the white paper. A document written by hand drifts from the table it cites; this repository has
 * paid for that twice. So the test holds the generated text to the tables, and the guard that
 * matters is the one that refuses to omit a gate the protocol publishes.
 */

const bird = ['V1-pack-not-empty', 'V2-fold-partition', 'V99-not-a-gate'];

describe('the matrix rows', () => {
  it('publishes one row per gate, in publication order', () => {
    const rows = gateRows(bird);
    expect(rows.map((row) => row.id)).toEqual([...GATE_ORDER]);
  });

  it('places every gate in exactly one of the two tables', () => {
    // The audit's arithmetic is `evaluable + absent = GATE_ORDER.length`. A gate in both tables
    // would be counted twice and a gate in neither would be dropped, and both are the same defect.
    const rows = gateRows([]);
    expect(rows.filter((row) => row.lane === 'supplyable')).toHaveLength(TAU2_GATE_INDEX.supplyable.length);
    expect(rows.filter((row) => row.lane === 'arm-indexed')).toHaveLength(TAU2_GATE_INDEX.armIndexed.length);
    expect(TAU2_GATE_INDEX.supplyable.length + TAU2_GATE_INDEX.armIndexed.length).toBe(GATE_ORDER.length);
  });

  it('names the field a supplyable gate reads, and the arm an arm-indexed one needs', () => {
    const rows = gateRows([]);
    const supplyable = rows.find((row) => row.id === 'V44-domain-accounted');
    const armIndexed = rows.find((row) => row.id === 'V46-raw-is-verbatim');
    expect(supplyable?.field).toBe('domainOrigin');
    expect(armIndexed?.field).toBeUndefined();
    expect(armIndexed?.needs).toContain('raw arm');
  });

  it('marks the BIRD column from the artefact, not from the type', () => {
    // A lane whose type can supply a field is not evidence that a run supplied it: the committed
    // artefact carries ten gates, and the matrix says ten.
    const rows = gateRows(bird);
    expect(rows.filter((row) => row.bird)).toHaveLength(2);
    expect(rows.find((row) => row.id === 'V1-pack-not-empty')?.bird).toBe(true);
    expect(rows.find((row) => row.id === 'V44-domain-accounted')?.bird).toBe(false);
  });

  it('refuses to omit a gate the protocol publishes', () => {
    // Unreachable while the shipped tables are complete, which is why the source is injectable: the
    // guard has to be held by a test rather than by a comment.
    expect(() => gateRows([], { order: [...GATE_ORDER, 'V99-not-a-gate'] })).toThrow(
      'gate V99-not-a-gate is in neither table',
    );
  });
});

describe('the rendered document', () => {
  const rows = gateRows(bird);
  const markdown = renderMatrix(rows, '`eval/results/poc-sota-bird-dev.json`');

  it('states the counts a reader quotes, from the rows themselves', () => {
    expect(markdown).toContain(`| gates in the protocol | ${String(GATE_ORDER.length)} |`);
    expect(markdown).toContain(`| τ² can supply | ${String(TAU2_GATE_INDEX.supplyable.length)} |`);
    expect(markdown).toContain(`| τ² needs an arm it never ran | ${String(TAU2_GATE_INDEX.armIndexed.length)} |`);
    expect(markdown).toContain('| BIRD carried in this artefact | 2 |');
  });

  it('carries one table row per gate, in order', () => {
    const lines = markdown.split('\n').filter((line) => line.startsWith('| `V'));
    expect(lines).toHaveLength(GATE_ORDER.length);
    expect(lines[0]).toContain('`V0-instrument-ready`');
  });

  it('says which gates BIRD carried, and which it did not', () => {
    expect(markdown).toContain('| `V1-pack-not-empty` | supplyable | `meanPackIds` | yes |');
    expect(markdown).toContain('| `V44-domain-accounted` | supplyable | `domainOrigin` | — |');
    expect(markdown).toContain('| `V46-raw-is-verbatim` | arm-indexed |');
  });

  it('names the artefact it was rendered against, so the BIRD column is reproducible', () => {
    expect(markdown).toContain('`eval/results/poc-sota-bird-dev.json`');
  });
});

describe('the command', () => {
  it('writes the document where it is told to', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-matrix-'));
    const out = join(dir, 'matrix.md');
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(main(['--bird', 'eval/results/poc-sota-bird-dev.json', '--out', out])).toBe(0);
    log.mockRestore();
    const written = readFileSync(out, 'utf8');
    expect(written).toContain('# Gate coverage matrix');
    expect(written).toContain('| gates in the protocol | 40 |');
  });

  it('prints instead of writing when no path is given', () => {
    const log = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(main(['--bird', 'eval/results/poc-sota-bird-dev.json'])).toBe(0);
    const printed = log.mock.calls.map((call) => String(call[0])).join('');
    log.mockRestore();
    expect(printed).toContain('# Gate coverage matrix');
  });
});
