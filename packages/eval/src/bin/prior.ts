/**
 * POC: what a memory-shaped verifier would be worth if it were perfect.
 *
 * The prior this command reads does not look at rules. It assumes extraction and retrieval are
 * already solved and asks the only question left: on this database, how often did a result of this
 * shape turn out right. That is the strongest version of "memory as a verifier", and it costs no
 * model calls — the pool exists, the folds exist, and the answer is arithmetic over both.
 *
 * The reason to run it before building one is the same reason R7.0 was run before R7.2: a stage that
 * has spent three iterations on selectors that read shapes should price the idea before paying for
 * a fourth. If perfect recall cannot beat the first draw, imperfect recall will not.
 *
 * Three scopes, one function: a database and a shape, a shape alone, a database alone. The three
 * rows say whether the effect is the schema, the shape, or the base rate of a database — the
 * difference between a memory and a table of which databases are hard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { poolFromArtifact, priorTable, type ArtifactPoolCase } from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Artifact = {
  readonly per_case: readonly ArtifactPoolCase[];
  readonly config?: { readonly arms?: readonly string[] };
  readonly generated_at?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

function main(): void {
  const artifact = JSON.parse(
    readFileSync(birdArtefactPath(), 'utf8'),
  ) as Artifact;
  const { questions, recorded } = poolFromArtifact(artifact.per_case, artifact.config?.arms ?? []);
  const keyed = questions.filter(
    (question) => question.dbId !== undefined && question.fold !== undefined,
  );
  if (keyed.length === 0) {
    process.stdout.write(
      recorded
        ? '[prior] this artefact records no database or fold beside the pool: the prior cannot be ' +
            'keyed, and a number computed without a key would describe a corpus it never saw\n'
        : '[prior] this artefact predates the pool field, so there is nothing to look anything up in\n',
    );
    return;
  }

  const cases = keyed.map((question) => ({
    id: question.id,
    dbId: question.dbId as string,
    fold: question.fold as number,
    candidates: question.candidates,
  }));
  const rows = priorTable(cases);
  const unmeasured = rows.filter((row) => !row.measurable);
  if (unmeasured.length > 0) {
    process.stdout.write(
      `[prior] ${unmeasured.length} scope(s) could not be keyed; reporting only the ones that could\n`,
    );
  }
  process.stdout.write(
    `[prior] ${cases.length} question(s), lookups built leave-one-fold-out: a question is never\n` +
      '[prior] helped by its own answer, which is the same cross-fitting the rules go through\n',
  );
  for (const row of rows) {
    if (!row.measurable) continue;
    process.stdout.write(
      `[prior] ${row.scope.padEnd(13)} ${row.keys} key(s), ` +
        `${row.choices} choice(s), ${row.covered} with support  ` +
        `${(row.accuracy * 100).toFixed(1)}% vs first draw ${(row.baseline * 100).toFixed(1)}%  ` +
        `${row.deltaPp >= 0 ? '+' : ''}${row.deltaPp.toFixed(2)}pp ` +
        `(+${row.gained} / -${row.lost}) p ${row.p.toFixed(4)}\n`,
    );
  }
  const best = rows
    .filter((row) => row.measurable && row.choices > 0)
    .reduce<(typeof rows)[number] | undefined>(
      (top, row) => (top === undefined || row.deltaPp > top.deltaPp ? row : top),
      undefined,
    );
  process.stdout.write(
    best === undefined
      ? '[prior] no scope offered a choice to make\n'
      : `[prior] best scope '${best.scope}': ${best.deltaPp >= 0 ? '+' : ''}${best.deltaPp.toFixed(2)}pp ` +
          `over the first draw on ${best.choices} question(s), ${best.covered} of them with any ` +
          `support at all. In sample on this pool: an upper bound for a verifier, not a result.\n`,
  );
}

main();
