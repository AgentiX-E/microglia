/**
 * The shipping contract, as an audit.
 *
 * `packages/core/src/kernel/serve-profile.ts` says what the product ships; this module says **why**, and
 * refuses the two ways that "why" can be absent. A record without a justification for a field is a product
 * knob nobody measured; a record whose justification is a reading that does not resolve is worse, because it
 * looks like evidence and is a sentence. Both are refusals rather than warnings: a warning in a build log is
 * a number nobody reads twice.
 *
 * ## The three states a field can be in
 *
 * - **measured** — a paired reading whose interval excludes zero at the stated alpha, and the product ships
 *   the value that reading chose. Both halves are required: a resolving reading about a knob the product does
 *   not ship is a finding, not a shipping justification.
 * - **unmeasured** — the product ships the library default and the record says so, with the reason. The reason
 *   is prose because there is no number; the audit prints it, so the debt is readable rather than implied.
 * - **refused** — the record claims one of the two above and the claim does not hold.
 *
 * ## Why the audit collects instead of throwing
 *
 * A record that drifts usually drifts in more than one field, and a check that throws on the first one turns a
 * five-line repair into five runs. Every problem is collected, printed in field order, and the exit code is the
 * only thing that is binary.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import {
  SERVE_PROFILE,
  SERVE_PROFILE_FIELDS,
  diffServeProfile,
  sameServeProfile,
  type ServeField,
  type ServeProfile,
} from '@agentix-e/microglia-core';

export const SERVE_PROFILE_SCHEMA = 'microglia.serve-profile/1';

/** A paired reading, stated as the numbers the audit needs and nothing else. */
export type ServeReading = {
  readonly id: string;
  /** The artefact the numbers come from, so a reader can re-derive them. */
  readonly artefact: string;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  /** The level the interval was taken at. `0.05` is what every registration in this repository states. */
  readonly alpha: number;
};

export type ServeJustification =
  | ({ readonly kind: 'reading' } & ServeReading)
  | { readonly kind: 'unmeasured'; readonly reason: string };

export type ServeProfileRecord = {
  readonly schema: string;
  readonly updatedBy: string;
  readonly profile: Readonly<Record<ServeField, unknown>>;
  readonly fields: Readonly<Record<ServeField, ServeJustification>>;
};

export type ServeProfileRow = {
  readonly field: ServeField;
  readonly shipped: unknown;
  readonly justification: ServeJustification | undefined;
};

export type ServeProfileAudit = {
  readonly rows: readonly ServeProfileRow[];
  readonly measured: number;
  readonly unmeasured: number;
  /** `measured / fields`, which is the debt: `1` means every shipped knob has a resolving reading. */
  readonly coverage: number;
  readonly refusals: readonly string[];
  /** Whether the product ships the values the record states. */
  readonly agrees: boolean;
};

const NUMBER_FIELDS = new Set<string>(['budget', 'speakMargin']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Read a record's justification, refusing every shape that would make the audit lie.
 *
 * The refusals are ordered so the first one printed is the one that explains the rest: a missing block is one
 * problem, five fields without a justification is five symptoms of it.
 */
function justificationOf(field: ServeField, value: unknown, problems: string[]): ServeJustification | undefined {
  if (!isObject(value)) {
    problems.push(`fields.${field}: missing justification`);
    return undefined;
  }
  const kind = value['kind'];
  if (kind === 'unmeasured') {
    const reason = value['reason'];
    if (typeof reason !== 'string' || reason.trim().length < 20) {
      problems.push(`fields.${field}: an unmeasured field needs a reason, not a placeholder`);
      return undefined;
    }
    return { kind: 'unmeasured', reason };
  }
  if (kind !== 'reading') {
    problems.push(`fields.${field}: kind must be "reading" or "unmeasured", received ${JSON.stringify(kind)}`);
    return undefined;
  }
  const id = value['id'];
  const artefact = value['artefact'];
  const deltaPp = value['deltaPp'];
  const ciLowPp = value['ciLowPp'];
  const ciHighPp = value['ciHighPp'];
  const alpha = value['alpha'];
  if (typeof id !== 'string' || id.trim() === '') {
    problems.push(`fields.${field}: a reading needs an id`);
    return undefined;
  }
  if (typeof artefact !== 'string' || artefact.trim() === '') {
    problems.push(`fields.${field}: a reading needs the artefact it came from`);
    return undefined;
  }
  if (!finite(deltaPp) || !finite(ciLowPp) || !finite(ciHighPp) || !finite(alpha)) {
    problems.push(`fields.${field}: delta, both bounds and alpha must be finite numbers`);
    return undefined;
  }
  if (alpha <= 0 || alpha > 0.5) {
    problems.push(`fields.${field}: alpha must be in (0, 0.5], received ${alpha}`);
    return undefined;
  }
  if (ciLowPp > deltaPp || deltaPp > ciHighPp) {
    problems.push(`fields.${field}: the interval [${ciLowPp}, ${ciHighPp}] does not contain ${deltaPp}`);
    return undefined;
  }
  if (!(ciLowPp > 0 || ciHighPp < 0)) {
    problems.push(
      `fields.${field}: the reading [${ciLowPp}, ${ciHighPp}] does not resolve, so it cannot justify a shipped value`,
    );
    return undefined;
  }
  return { kind: 'reading', id, artefact, deltaPp, ciLowPp, ciHighPp, alpha };
}

/**
 * Audit a parsed record against the profile the product ships.
 *
 * `shipped` is a parameter rather than an import inside the loop so a candidate profile can be priced against
 * the same rules before anyone changes the constant: `auditServeProfileRecord(record, CANDIDATE)` is the
 * question "would this ship?", asked before the diff exists.
 */
export function auditServeProfileRecord(
  record: unknown,
  shipped: ServeProfile = SERVE_PROFILE,
): ServeProfileAudit {
  const problems: string[] = [];
  if (!isObject(record)) {
    return {
      rows: [],
      measured: 0,
      unmeasured: 0,
      coverage: 0,
      refusals: ['record: expected an object'],
      agrees: false,
    };
  }
  if (record['schema'] !== SERVE_PROFILE_SCHEMA) {
    problems.push(`schema: expected ${SERVE_PROFILE_SCHEMA}, received ${JSON.stringify(record['schema'])}`);
  }
  const updatedBy = record['updatedBy'];
  if (typeof updatedBy !== 'string' || updatedBy.trim() === '') {
    problems.push('updatedBy: the round that last moved the profile has to be named');
  }
  const profileValue = record['profile'];
  const profile = isObject(profileValue) ? profileValue : {};
  if (!isObject(profileValue)) problems.push('profile: expected an object');

  const diff = diffServeProfile(profile, shipped);
  for (const key of diff.unknown) problems.push(`profile.${key}: not a shipped knob`);
  for (const field of diff.missing) problems.push(`profile.${field}: the product ships this field and the record omits it`);
  for (const item of diff.differing) {
    problems.push(`profile.${item.field}: the record states ${JSON.stringify(item.recorded)}, the product ships ${JSON.stringify(item.shipped)}`);
  }

  const fieldsValue = record['fields'];
  const fields = isObject(fieldsValue) ? fieldsValue : {};
  if (!isObject(fieldsValue)) problems.push('fields: expected an object');

  const rows: ServeProfileRow[] = [];
  let measured = 0;
  let unmeasured = 0;
  for (const field of SERVE_PROFILE_FIELDS) {
    const justification = justificationOf(field, fields[field], problems);
    const value = profile[field];
    if (justification?.kind === 'reading') {
      if (value === null || value === undefined) {
        problems.push(
          `profile.${field}: claims the reading ${justification.id} while the product ships the default, so the reading is decorative`,
        );
      } else {
        measured += 1;
      }
    } else if (justification?.kind === 'unmeasured') {
      unmeasured += 1;
    }
    rows.push({ field, shipped: shipped[field], justification });
  }
  for (const key of Object.keys(fields)) {
    if (!(SERVE_PROFILE_FIELDS as readonly string[]).includes(key)) {
      problems.push(`fields.${key}: not a shipped knob`);
    }
  }

  return {
    rows,
    measured,
    unmeasured,
    coverage: measured / SERVE_PROFILE_FIELDS.length,
    refusals: problems,
    agrees: sameServeProfile(diff),
  };
}

/**
 * Parse a record for callers that want the typed form: throws on a malformed document, and deliberately allows
 * an audit-shaped one. `parse` answers "can I read this file", `audit` answers "should this ship" — collapsing
 * them would make a drifted record unreadable, which is the one thing a drift report must be.
 */
export function parseServeProfileRecord(value: unknown): ServeProfileRecord {
  if (!isObject(value)) throw new MicrogliaError('MG_E_CONFIG', 'serve profile: expected an object');
  if (value['schema'] !== SERVE_PROFILE_SCHEMA) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `serve profile: schema must be ${SERVE_PROFILE_SCHEMA}, received ${JSON.stringify(value['schema'])}`,
    );
  }
  const profileValue = value['profile'];
  const fieldsValue = value['fields'];
  if (!isObject(profileValue)) throw new MicrogliaError('MG_E_CONFIG', 'serve profile: profile must be an object');
  if (!isObject(fieldsValue)) throw new MicrogliaError('MG_E_CONFIG', 'serve profile: fields must be an object');
  const updatedBy = value['updatedBy'];
  if (typeof updatedBy !== 'string' || updatedBy.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'serve profile: updatedBy is required');
  }
  const profile: Record<string, unknown> = {};
  for (const field of SERVE_PROFILE_FIELDS) {
    if (!(field in profileValue)) {
      throw new MicrogliaError('MG_E_CONFIG', `serve profile: profile.${field} is required`);
    }
    const entry = profileValue[field];
    if (NUMBER_FIELDS.has(field) && entry !== null && !finite(entry)) {
      throw new MicrogliaError('MG_E_CONFIG', `serve profile: profile.${field} must be a number or null`);
    }
    profile[field] = entry;
  }
  return {
    schema: SERVE_PROFILE_SCHEMA,
    updatedBy,
    profile: profile as Record<ServeField, unknown>,
    fields: fieldsValue as Record<ServeField, ServeJustification>,
  };
}

/** One line per field, then the debt. What a reader copies into a report. */
export function serveProfileLines(audit: ServeProfileAudit): readonly string[] {
  const lines = audit.rows.map((row) => {
    const value = row.shipped === null ? 'default' : String(row.shipped);
    const why =
      row.justification === undefined
        ? 'no justification'
        : row.justification.kind === 'reading'
          ? `${row.justification.id} ${row.justification.deltaPp >= 0 ? '+' : ''}${row.justification.deltaPp}pp [${row.justification.ciLowPp}, ${row.justification.ciHighPp}]`
          : 'unmeasured';
    return `${row.field.padEnd(13)} ${value.padEnd(10)} ${why}`;
  });
  const verdict =
    audit.refusals.length === 0
      ? `serve profile: ${audit.rows.length} fields, ${audit.measured} measured, ${audit.unmeasured} unmeasured, no drift`
      : `serve profile: REFUSED (${audit.refusals.length} problem${audit.refusals.length === 1 ? '' : 's'})`;
  return [...lines, verdict, ...audit.refusals.map((problem) => `  - ${problem}`)];
}
