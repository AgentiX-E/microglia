/**
 * R10's price, read before it is paid.
 *
 * The stage's kill condition is stated over rules: *if more than 60% of the family is withheld as
 * unbindable, the measurement is about the binder and not about transfer, and no verdict is issued.*
 * That is a sentence about schemas, and a schema is available offline — so the number can be had for
 * zero model calls instead of 2,600, and a construction that cannot bind is refused before it is
 * dispatched rather than after.
 *
 * What this command reads: every rule the artefact carries (its statement and the database it was
 * learned in), the columns and tables of each database the store covers, and the binder itself. It
 * reads no question, no answer and no model, so it cannot say whether a bound rule helps; it can say
 * whether there is anything to show.
 *
 * It exits zero whatever the census says, because a construction rejected by its own pre-registered
 * condition is a result and not a build failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindingCensus, resolveDatabase, schemaIndex, type CensusRule, type SchemaNames } from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Artifact = {
  readonly items?: readonly { readonly id: string; readonly statement?: string; readonly domain?: string | null }[];
};

const DB_DIR = process.env['BIRD_DB_DIR'] ?? join(process.cwd(), 'eval', 'fixtures', 'bird-minidev');

/** The share above which R10 issues no verdict, fixed in the pre-registration before this existed. */
const KILL_SHARE = 0.6;

function main(): void {
  const artifact = JSON.parse(readFileSync(birdArtefactPath(), 'utf8')) as Artifact;
  const stored = artifact.items ?? [];
  if (stored.length === 0) {
    process.stdout.write(
      '[template] this artefact carries no store: the binder has nothing to read, which is a reading\n' +
        '[template] about the run and not about the construction\n',
    );
    return;
  }

  const rules: CensusRule[] = stored
    .filter((item): item is typeof item & { statement: string } => typeof item.statement === 'string')
    .map((item) => ({ id: item.id, statement: item.statement, domain: item.domain ?? null }));

  // The databases the store covers, kept only if this machine has them: a census over schemas that
  // cannot be opened would report a binder failure that is really a missing file.
  const claimed = [...new Set(rules.map((rule) => rule.domain).filter((id): id is string => id !== null))].sort();
  const paths = new Map<string, string>();
  const missing: string[] = [];
  for (const dbId of claimed) {
    const path = resolveDatabase(DB_DIR, dbId);
    if (existsSync(path)) paths.set(dbId, path);
    else missing.push(dbId);
  }
  if (paths.size < 2) {
    process.stdout.write(
      `[template] ${paths.size} of ${claimed.length} database(s) readable under ${DB_DIR}; a binder needs\n` +
        '[template] one to read the rule in and a different one to bind it against, so there is nothing to\n' +
        '[template] measure here. Set BIRD_DB_DIR to an extracted copy of the split this artefact measured.\n',
    );
    return;
  }

  const names = new Map<string, SchemaNames>();
  for (const [dbId, path] of paths) {
    const index = schemaIndex(path);
    names.set(dbId, { tables: index.tables, columns: index.columns });
  }
  const census = bindingCensus(rules, [...paths.keys()], (dbId) => names.get(dbId) as SchemaNames);

  const share = (part: number, whole: number): string => `${part}/${whole}=${(whole === 0 ? 0 : (part / whole) * 100).toFixed(1)}%`;
  process.stdout.write(
    `[template] ${census.rules} rule(s) against ${paths.size} database(s): ` +
      `${census.homeless} homeless, ${census.unplaced} unplaced, ` +
      `${census.rulesBound + census.rulesSlotless + census.rulesWithheld} attempted` +
      `${census.duplicates === 0 ? '' : ` (${census.duplicates} entry(s) named a rule already counted)`}\n`,
  );
  if (missing.length > 0) {
    process.stdout.write(`[template] not on this machine: ${missing.join(', ')}\n`);
  }
  process.stdout.write(
    `[template] rules: ${share(census.rulesBound, census.rulesBound + census.rulesSlotless + census.rulesWithheld)} bound, ` +
      `${share(census.rulesSlotless, census.rulesBound + census.rulesSlotless + census.rulesWithheld)} slotless, ` +
      `${share(census.rulesWithheld, census.rulesBound + census.rulesSlotless + census.rulesWithheld)} withheld\n`,
  );
  const coverage = census.coverage;
  process.stdout.write(
    `[template] attempts: ${share(coverage.bound, coverage.bound + coverage.slotless + coverage.withheld)} bound, ` +
      `${share(coverage.slotless, coverage.bound + coverage.slotless + coverage.withheld)} slotless, ` +
      `${share(coverage.withheld, coverage.bound + coverage.slotless + coverage.withheld)} withheld ` +
      `over ${coverage.rules} rule(s)\n`,
  );
  for (const blocker of coverage.blockers.slice(0, 10)) {
    process.stdout.write(
      `[template] blocker: ${blocker.kind} '${blocker.name}' stopped ${blocker.attempts} attempt(s)\n`,
    );
  }
  // The verdict this command exists to reach. It is stated as the pre-registration states it — over
  // rules — and it names what the run would have measured instead of what it would have shown.
  process.stdout.write(
    census.withheldShare > KILL_SHARE
      ? `[template] ${(census.withheldShare * 100).toFixed(1)}% of the attempted family is withheld, above the ` +
          `${(KILL_SHARE * 100).toFixed(0)}% the pre-registration fixes as its kill condition: an arm-B dispatch ` +
          'would measure the binder and not the hypothesis, so no verdict is issued from it\n'
      : `[template] ${(census.withheldShare * 100).toFixed(1)}% withheld, inside the pre-registration's ` +
          `${(KILL_SHARE * 100).toFixed(0)}% condition: arm B can be dispatched and read as a test of transfer\n`,
  );
}

main();
