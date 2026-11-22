/**
 * The audit that keeps the product from shipping a configuration nobody measured.
 *
 * The cases are organised around the two ways a record can lie: it can disagree with the constant, or it can
 * agree with it and justify a field with something that is not evidence. The committed record is read first,
 * because that is the assertion the build actually depends on; everything after it is a refusal table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SERVE_PROFILE } from '@agentix-e/microglia-core';
import {
  SERVE_PROFILE_SCHEMA,
  auditServeProfileRecord,
  parseServeProfileRecord,
  serveProfileLines,
  type ServeJustification,
} from '../serve-profile-record.js';

type Record_ = {
  schema: unknown;
  updatedBy: unknown;
  profile: Record<string, unknown>;
  fields: Record<string, unknown>;
};

function sound(): Record_ {
  const unmeasured = (reason: string): ServeJustification => ({ kind: 'unmeasured', reason });
  return {
    schema: SERVE_PROFILE_SCHEMA,
    updatedBy: 'test',
    profile: { ...SERVE_PROFILE },
    fields: {
      budget: unmeasured('no arm has varied the character budget alone'),
      note: unmeasured('the three-level arm was registered and never dispatched'),
      budgetBasis: unmeasured('an accounting declaration rather than a treatment'),
      speakMargin: unmeasured('the dispatched rung could not be told from the default'),
      credit: unmeasured('a mechanism check, not a paired rate with an interval'),
    },
  };
}

const READING: ServeJustification = {
  kind: 'reading',
  id: 'R197',
  artefact: 'eval/results/poc-x.json',
  deltaPp: 3,
  ciLowPp: 1,
  ciHighPp: 5,
  alpha: 0.05,
};

function problems(record: unknown): readonly string[] {
  return auditServeProfileRecord(record).refusals;
}

describe('the committed record', () => {
  it('agrees with the product, byte for field', () => {
    const record: unknown = JSON.parse(readFileSync(join(process.cwd(), 'eval/results/serve-profile.json'), 'utf8'));
    const audit = auditServeProfileRecord(record);
    expect(audit.refusals).toEqual([]);
    expect(audit.agrees).toBe(true);
    expect(audit.rows).toHaveLength(5);
  });

  it('states the debt, which today is every field', () => {
    // Not an aspiration: five shipped knobs, none backed by a resolving paired reading. If a round buys a
    // reading, this number moves and the doc that quotes it has to move with it.
    const record: unknown = JSON.parse(readFileSync(join(process.cwd(), 'eval/results/serve-profile.json'), 'utf8'));
    const audit = auditServeProfileRecord(record);
    expect(audit.measured).toBe(0);
    expect(audit.unmeasured).toBe(5);
    expect(audit.coverage).toBe(0);
  });
});

describe('schema and shape', () => {
  it('accepts a sound record', () => {
    expect(problems(sound())).toEqual([]);
  });

  it('refuses something that is not an object', () => {
    expect(problems(null)).toEqual(['record: expected an object']);
    expect(problems([])).toEqual(['record: expected an object']);
  });

  it('refuses a schema from another release', () => {
    const record = sound();
    record.schema = 'microglia.serve-profile/2';
    expect(problems(record)).toEqual([
      'schema: expected microglia.serve-profile/1, received "microglia.serve-profile/2"',
    ]);
  });

  it('refuses a record that does not name the round that moved it', () => {
    const record = sound();
    record.updatedBy = '  ';
    expect(problems(record)).toEqual(['updatedBy: the round that last moved the profile has to be named']);
  });

  it('refuses a fields block that is missing, and names every field it leaves unjustified', () => {
    const record = sound();
    delete record.fields;
    const read = problems(record);
    expect(read[0]).toBe('fields: expected an object');
    expect(read).toHaveLength(6);
    expect(read[1]).toBe('fields.budget: missing justification');
  });

  it('refuses a profile that is not an object, and says so once each', () => {
    const record = sound();
    record.profile = 'x' as unknown as Record<string, unknown>;
    const read = problems(record);
    expect(read).toContain('profile: expected an object');
    expect(read).toContain('profile.budget: the product ships this field and the record omits it');
  });
});

describe('drift between the record and the product', () => {
  it('names a knob the product does not have', () => {
    const record = sound();
    record.profile['retries'] = 3;
    record.fields['retries'] = { kind: 'unmeasured', reason: 'a knob this product has never had' };
    expect(problems(record)).toEqual(['profile.retries: not a shipped knob', 'fields.retries: not a shipped knob']);
  });

  it('names a knob the product ships and the record forgot', () => {
    const record = sound();
    delete record.profile['credit'];
    expect(problems(record)).toContain('profile.credit: the product ships this field and the record omits it');
  });

  it('prints both numbers when they disagree', () => {
    const record = sound();
    record.profile['budget'] = 800;
    expect(problems(record)).toEqual([
      'profile.budget: the record states 800, the product ships null',
    ]);
  });
});

describe('justifications', () => {
  it('refuses a field with no justification at all', () => {
    const record = sound();
    delete record.fields['note'];
    expect(problems(record)).toEqual(['fields.note: missing justification']);
  });

  it('refuses an unmeasured field whose reason is a placeholder', () => {
    const record = sound();
    record.fields['note'] = { kind: 'unmeasured', reason: 'TODO' };
    expect(problems(record)).toEqual(['fields.note: an unmeasured field needs a reason, not a placeholder']);
  });

  it('refuses an unknown kind', () => {
    const record = sound();
    record.fields['note'] = { kind: 'probably', reason: 'a sufficiently long reason to pass the length test' };
    expect(problems(record)).toEqual([
      'fields.note: kind must be "reading" or "unmeasured", received "probably"',
    ]);
  });

  it('refuses a reading without an id or without its artefact', () => {
    const noId = sound();
    noId.fields['speakMargin'] = { ...READING, id: ' ' };
    expect(problems(noId)).toEqual(['fields.speakMargin: a reading needs an id']);
    const noFile = sound();
    noFile.fields['speakMargin'] = { ...READING, artefact: '' };
    expect(problems(noFile)).toEqual(['fields.speakMargin: a reading needs the artefact it came from']);
  });

  it('refuses a reading whose numbers are not numbers', () => {
    const record = sound();
    record.fields['speakMargin'] = { ...READING, deltaPp: Number.NaN };
    expect(problems(record)).toEqual([
      'fields.speakMargin: delta, both bounds and alpha must be finite numbers',
    ]);
  });

  it('refuses an alpha outside (0, 0.5]', () => {
    const zero = sound();
    zero.fields['speakMargin'] = { ...READING, alpha: 0 };
    expect(problems(zero)).toEqual(['fields.speakMargin: alpha must be in (0, 0.5], received 0']);
    const wide = sound();
    wide.fields['speakMargin'] = { ...READING, alpha: 0.6 };
    expect(problems(wide)).toEqual(['fields.speakMargin: alpha must be in (0, 0.5], received 0.6']);
  });

  it('refuses an interval that does not contain its own delta', () => {
    const record = sound();
    record.fields['speakMargin'] = { ...READING, deltaPp: 9 };
    expect(problems(record)).toEqual(['fields.speakMargin: the interval [1, 5] does not contain 9']);
  });

  it('refuses a reading that does not resolve', () => {
    const record = sound();
    record.fields['speakMargin'] = { ...READING, deltaPp: 1, ciLowPp: -2, ciHighPp: 4 };
    expect(problems(record)).toEqual([
      'fields.speakMargin: the reading [-2, 4] does not resolve, so it cannot justify a shipped value',
    ]);
  });

  it('refuses a resolving reading on a knob the product ships at its default', () => {
    // The sharpest one: the evidence is fine and the product ignores it. That is a finding in a drawer.
    const record = sound();
    record.fields['speakMargin'] = { ...READING };
    expect(problems(record)).toEqual([
      'profile.speakMargin: claims the reading R197 while the product ships the default, so the reading is decorative',
    ]);
    expect(auditServeProfileRecord(record).measured).toBe(0);
  });

  it('counts a resolving reading on a shipped value as measured', () => {
    const record = sound();
    record.profile['speakMargin'] = 0.2;
    record.fields['speakMargin'] = { ...READING };
    const audit = auditServeProfileRecord(record, { ...SERVE_PROFILE, speakMargin: 0.2 });
    expect(audit.refusals).toEqual([]);
    expect(audit.measured).toBe(1);
    expect(audit.unmeasured).toBe(4);
    expect(audit.coverage).toBeCloseTo(0.2, 10);
  });

  it('prices a candidate profile with the same rules, before the constant moves', () => {
    const record = sound();
    record.profile['budget'] = 800;
    expect(auditServeProfileRecord(record).agrees).toBe(false);
    expect(auditServeProfileRecord(record, { ...SERVE_PROFILE, budget: 800 }).agrees).toBe(true);
  });
});

describe('parseServeProfileRecord', () => {
  it('returns the typed record it was given', () => {
    const parsed = parseServeProfileRecord(sound());
    expect(parsed.schema).toBe(SERVE_PROFILE_SCHEMA);
    expect(parsed.profile.credit).toBe(true);
  });

  it('throws with the reason rather than defaulting', () => {
    expect(() => parseServeProfileRecord('x')).toThrow(/expected an object/);
    expect(() => parseServeProfileRecord({ ...sound(), schema: 'wrong' })).toThrow(/schema must be/);
    expect(() => parseServeProfileRecord({ ...sound(), profile: [] })).toThrow(/profile must be an object/);
    expect(() => parseServeProfileRecord({ ...sound(), fields: null })).toThrow(/fields must be an object/);
    expect(() => parseServeProfileRecord({ ...sound(), updatedBy: '' })).toThrow(/updatedBy is required/);
  });

  it('refuses a numeric field that is neither a number nor null', () => {
    const record = sound();
    record.profile['budget'] = '1200';
    expect(() => parseServeProfileRecord(record)).toThrow(/profile.budget must be a number or null/);
  });

  it('refuses a profile missing a field the product ships', () => {
    const record = sound();
    delete record.profile['note'];
    expect(() => parseServeProfileRecord(record)).toThrow(/profile.note is required/);
  });
});

describe('serveProfileLines', () => {
  it('renders one row per field, the debt, and the problems', () => {
    const record = sound();
    record.profile['budget'] = 800;
    const lines = serveProfileLines(auditServeProfileRecord(record));
    expect(lines[0]).toBe('budget        default    unmeasured');
    expect(lines[4]).toBe('credit        true       unmeasured');
    expect(lines[5]).toBe('serve profile: REFUSED (1 problem)');
    expect(lines[6]).toBe('  - profile.budget: the record states 800, the product ships null');
  });

  it('prints a field with no justification as exactly that, rather than as a verdict', () => {
    const record = sound();
    delete record.fields;
    const lines = serveProfileLines(auditServeProfileRecord(record));
    expect(lines[0]).toBe('budget        default    no justification');
  });

  it('prints several problems in the plural, and states a non-null value that is not a number', () => {
    const record = sound();
    record.profile['budget'] = 800;
    record.profile['credit'] = false;
    const lines = serveProfileLines(auditServeProfileRecord(record));
    expect(lines[4]).toBe('credit        true       unmeasured');
    expect(lines[5]).toBe('serve profile: REFUSED (2 problems)');
  });

  it('prints a measured reading as its numbers, and a clean audit as no drift', () => {
    const record = sound();
    record.profile['speakMargin'] = 0.2;
    record.fields['speakMargin'] = { ...READING };
    const lines = serveProfileLines(auditServeProfileRecord(record, { ...SERVE_PROFILE, speakMargin: 0.2 }));
    expect(lines[3]).toBe('speakMargin   0.2        R197 +3pp [1, 5]');
    expect(lines[5]).toBe('serve profile: 5 fields, 1 measured, 4 unmeasured, no drift');
  });

  it('prints a negative reading with its sign, which is the one a reviewer looks for', () => {
    const record = sound();
    record.profile['speakMargin'] = 0.2;
    record.fields['speakMargin'] = { kind: 'reading', id: 'R9', artefact: 'x.json', deltaPp: -3, ciLowPp: -5, ciHighPp: -1, alpha: 0.05 };
    const lines = serveProfileLines(auditServeProfileRecord(record, { ...SERVE_PROFILE, speakMargin: 0.2 }));
    expect(lines[3]).toBe('speakMargin   0.2        R9 -3pp [-5, -1]');
  });
});
