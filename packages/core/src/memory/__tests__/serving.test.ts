import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ASK_SOURCES,
  SERVING_DEFAULTS,
  SERVING_PLACEMENTS,
  SETTLEMENT_GRADES,
} from '../serving.js';

/**
 * The one test whose subject is a file in another directory.
 *
 * `eval/manifests/serving-defaults.json` is what the evaluation measured; this constant is what the product ships.
 * Nothing else in either repository compares them, and the failure mode without a comparison is the quiet one: a
 * round changes the placement, the product keeps the old one, and the published number stops being about the
 * shipped artefact while every test on both sides stays green.
 */
const manifestPath = fileURLToPath(
  new URL('../../../../../eval/manifests/serving-defaults.json', import.meta.url),
);

type Manifest = {
  readonly status: string;
  readonly defaults: {
    readonly placement: string;
    readonly askSource: string;
    readonly settlementGrades: readonly string[];
    readonly blockCeilingChars: number;
    readonly openAskCeiling: number;
    readonly trials: number;
    readonly blockLines: number;
  };
  readonly provenance: Record<string, { readonly value: unknown; readonly measuredIn: string }>;
  readonly notYet: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

describe('the serving defaults are the measured defaults', () => {
  it('reads a manifest this repository can act on', () => {
    expect(['pending', 'confirmed']).toContain(manifest.status);
    expect(manifest.defaults).toBeTypeOf('object');
  });

  it('ships the placement the manifest names', () => {
    expect(SERVING_DEFAULTS.placement).toBe(manifest.defaults.placement);
  });

  it('ships the ask source the manifest names', () => {
    expect(SERVING_DEFAULTS.askSource).toBe(manifest.defaults.askSource);
  });

  it('ships the settlement grades the manifest names, widest last', () => {
    expect([...SERVING_DEFAULTS.settlementGrades]).toEqual(manifest.defaults.settlementGrades);
  });

  it('ships the line budget the manifest names, which the default pack limit reads', () => {
    expect(SERVING_DEFAULTS.blockLines).toBe(manifest.defaults.blockLines);
    expect(Number.isInteger(SERVING_DEFAULTS.blockLines)).toBe(true);
    expect(SERVING_DEFAULTS.blockLines).toBeGreaterThan(0);
  });

  it('ships the block ceiling the manifest names', () => {
    expect(SERVING_DEFAULTS.blockCeilingChars).toBe(manifest.defaults.blockCeilingChars);
  });

  it('ships the open-ask ceiling the manifest names', () => {
    expect(SERVING_DEFAULTS.openAskCeiling).toBe(manifest.defaults.openAskCeiling);
  });

  it('ships the number of attempts the manifest names', () => {
    expect(SERVING_DEFAULTS.trials).toBe(manifest.defaults.trials);
  });

  it('carries every value in its own closed vocabulary', () => {
    expect(SERVING_PLACEMENTS).toContain(SERVING_DEFAULTS.placement);
    expect(ASK_SOURCES).toContain(SERVING_DEFAULTS.askSource);
    for (const grade of SERVING_DEFAULTS.settlementGrades) expect(SETTLEMENT_GRADES).toContain(grade);
  });

  it('names a provenance entry for every default it ships', () => {
    // A default with no round behind it is a preference. The manifest is what tells the two apart, so a value that
    // appears in `defaults` and not in `provenance` is a value nobody measured.
    for (const field of ['placement', 'askSource', 'settlementGrades', 'blockCeilingChars', 'openAskCeiling']) {
      expect(manifest.provenance[field], `${field} has no measuredIn`).toBeTypeOf('object');
      expect(manifest.provenance[field]?.measuredIn, `${field} has no measuredIn`).toMatch(/^R\d/);
    }
  });

  it('states what it does not yet ship', () => {
    // The admission policy is R219. It is named here rather than omitted so a reader of the defaults cannot mistake
    // "not listed" for "not needed".
    expect(Object.keys(manifest.notYet)).toContain('admissionPolicy');
  });

  it('has no provenance entry that disagrees with the value it explains', () => {
    for (const field of ['placement', 'askSource', 'settlementGrades'] as const) {
      expect(manifest.provenance[field]?.value, `${field} provenance disagrees with the default`).toEqual(
        manifest.defaults[field],
      );
    }
  });
});
