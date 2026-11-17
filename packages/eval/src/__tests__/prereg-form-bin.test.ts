import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The form command's wire, as a wire.
 *
 * `sota.yml` reads `distill.env` with `sed -n 's/^key=//p'`, so a key that the script stops printing is
 * not a formatting change — it is a dispatch that runs the control and reports it under the treatment's
 * name, silently, because an unset variable is a legal value for every one of these switches. R139 adds
 * a switch to that wire, and the round that adds a header without a line here would be the one where
 * the header did nothing.
 *
 * Asserted by running the process rather than by reading the source: the contract is the printed line.
 */
const BIN = 'packages/eval/src/bin/prereg-form.ts';

const HEADER = [
  '---',
  'id: R139-wire',
  'step: R139',
  'opened: 2026-11-17',
  'arms: memory',
  'sample: 114',
  'gates: V0,V1',
  'distillUnit: correction',
  'distillForm: lesson',
  'consolidate: true',
  'consolidateKey: routine',
];

const BODY = ['', '## Prediction', '', '- one claim, two spellings, one item', '', '## Refutation', '', '- the store does not move', ''];

function registration(extra: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'prereg-form-'));
  const path = join(dir, 'R139-wire.md');
  writeFileSync(path, [...HEADER, ...extra, '---', ...BODY].join('\n'));
  return path;
}

function run(path: string): { code: number; out: string; err: string } {
  const child = spawnSync('npx', ['tsx', BIN, path], { encoding: 'utf8' });
  return { code: child.status ?? 1, out: child.stdout ?? '', err: child.stderr ?? '' };
}

describe('prereg-form prints the linkage the registration fixed', () => {
  it('prints `all` when the header asks for it, which is the only path the driver reads', () => {
    const reading = run(registration(['consolidateLinkage: all']));
    expect(reading.code).toBe(0);
    expect(reading.out).toContain('consolidateLinkage=all');
    // The key rides the same wire and must not be disturbed by the new line: an arm that moved two
    // switches would be two treatments under one name.
    expect(reading.out).toContain('consolidateKey=routine');
  });

  it('prints an empty line when the header names no linkage, which leaves the run at the control', () => {
    // Empty is not a value the driver accepts from a header — it is the absence of one, and the driver's
    // resolver reads it as `key`. This is the line every artefact before R139 was produced under.
    const reading = run(registration([]));
    expect(reading.code).toBe(0);
    expect(reading.out).toContain('consolidateLinkage=\n');
  });
});
