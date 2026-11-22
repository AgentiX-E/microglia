/**
 * The shipping contract, checked.
 *
 * `--check` reads `eval/results/serve-profile.json`, audits it against the profile the product ships, prints
 * one line per field and fails on any refusal or drift. `--print` prints only the shipped profile, which is
 * what a reader copies into a deployment note. `--self-test` runs the audit over three in-memory records — a
 * sound one, a drifted one and a decorative one — so the refusals are exercised without the filesystem.
 *
 * The check is what makes this a contract rather than a comment: the record and the constant cannot move
 * independently, because the round that moves one and not the other is exactly the round this file exists to
 * stop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeServeProfile } from '@agentix-e/microglia-core';
import {
  auditServeProfileRecord,
  parseServeProfileRecord,
  serveProfileLines,
  type ServeProfileAudit,
} from '../serve-profile-record.js';

const RECORD = join(process.cwd(), 'eval/results/serve-profile.json');
const argv = process.argv.slice(2);

function report(audit: ServeProfileAudit): number {
  for (const line of serveProfileLines(audit)) process.stdout.write(`${line}\n`);
  return audit.refusals.length === 0 ? 0 : 1;
}

function selfTest(): number {
  const sound = {
    schema: 'microglia.serve-profile/1',
    updatedBy: 'self-test',
    profile: { budget: null, note: null, budgetBasis: null, speakMargin: null, credit: true },
    fields: {
      budget: { kind: 'unmeasured', reason: 'no arm has varied the character budget alone' },
      note: { kind: 'unmeasured', reason: 'the three-level arm was registered and never dispatched' },
      budgetBasis: { kind: 'unmeasured', reason: 'an accounting declaration rather than a treatment' },
      speakMargin: { kind: 'unmeasured', reason: 'the dispatched rung could not be told from the default' },
      credit: { kind: 'unmeasured', reason: 'a mechanism check, not a paired rate with an interval' },
    },
  };
  const failures: string[] = [];
  const expect = (label: string, audit: ServeProfileAudit, count: number): void => {
    if (audit.refusals.length !== count) {
      failures.push(`${label}: expected ${count} refusals, read ${audit.refusals.length}: ${audit.refusals.join(' | ')}`);
    }
  };

  const soundAudit = auditServeProfileRecord(sound);
  expect('sound record', soundAudit, 0);
  if (soundAudit.measured !== 0 || soundAudit.unmeasured !== 5) {
    failures.push(`sound record: expected 0 measured and 5 unmeasured, read ${soundAudit.measured}/${soundAudit.unmeasured}`);
  }
  if (parseServeProfileRecord(sound).updatedBy !== 'self-test') failures.push('parse: updatedBy lost');

  // A record whose stated value disagrees with the product: one refusal, and it names both numbers.
  const drifted = structuredClone(sound);
  // The clone carries the literal type of the fixture, so the field is widened here rather than in the fixture:
  // this record exists to be wrong, and a type that refuses the wrongness would hide the case.
  (drifted.profile as Record<string, unknown>)['budget'] = 800;
  expect('drifted record', auditServeProfileRecord(drifted), 1);

  // A reading that does not resolve is not a justification, however complete its fields are.
  const decorative = structuredClone(sound);
  decorative.fields.speakMargin = {
    kind: 'reading',
    id: 'R197',
    artefact: 'eval/results/x.json',
    deltaPp: 1,
    ciLowPp: -2,
    ciHighPp: 4,
    alpha: 0.05,
  } as unknown as (typeof decorative.fields)['speakMargin'];
  expect('unresolving reading', auditServeProfileRecord(decorative), 1);

  // A resolving reading on a knob the product does not ship is a finding in a drawer, not a justification.
  const unshipped = structuredClone(sound);
  unshipped.fields.speakMargin = {
    ...decorative.fields.speakMargin,
    deltaPp: 3,
    ciLowPp: 1,
    ciHighPp: 5,
  } as typeof unshipped.fields.speakMargin;
  expect('decorative reading', auditServeProfileRecord(unshipped), 1);

  // And the shape a record takes when someone adds a knob the product does not have.
  const invented = structuredClone(sound) as typeof sound & { profile: Record<string, unknown>; fields: Record<string, unknown> };
  invented.profile['retries'] = 3;
  invented.fields['retries'] = { kind: 'unmeasured', reason: 'a knob this product has never had' };
  expect('invented knob', auditServeProfileRecord(invented), 2);

  for (const failure of failures) process.stderr.write(`[serve-profile] ${failure}\n`);
  process.stdout.write(`serve-profile self-test: ${failures.length === 0 ? 'ok' : 'FAILED'}\n`);
  return failures.length === 0 ? 0 : 1;
}

if (argv.includes('--self-test')) {
  process.exitCode = selfTest();
} else if (argv.includes('--print')) {
  for (const line of describeServeProfile()) process.stdout.write(`${line}\n`);
} else {
  const record: unknown = JSON.parse(readFileSync(RECORD, 'utf8'));
  const audit = auditServeProfileRecord(record);
  process.exitCode = report(audit);
  if (audit.refusals.length > 0) {
    process.stderr.write(
      '\n[serve-profile] the product and the record disagree, so the shipped configuration is not the measured\n' +
        'one. Repair whichever side moved: a value that a reading chose belongs in the profile, and a value the\n' +
        'product ships without one belongs in the record as "unmeasured" with its reason.\n',
    );
  }
}
