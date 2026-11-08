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

/**
 * Exit code for "there is nothing to price", distinct from "the reading is zero".
 *
 * This command had no failure mode. On the committed artefact it printed *this artefact predates
 * the pool field* and returned zero, so a caller — or a reader — could not tell an unpriced axis
 * from a priced one whose effect was nil. That is defect 26 in its purest form: a check that
 * passes on an absent input. The review that found this read the whole output-side family
 * (selector AUCs, the judge cascade, the oracle ceiling) and asked which of those claims could be
 * recomputed from a committed file; the answer for the prior was none, and the command that would
 * have said so was green.
 *
 * `2` is the same code the readback verifiers use for "the input is not there", so one convention
 * covers both halves of a readback: a missing subject and a missing measurement are not results.
 */
const CANNOT_PRICE = 2;

function cannotPrice(reason: string): void {
  process.stdout.write(`[prior] cannot price: ${reason}\n`);
  process.exitCode = CANNOT_PRICE;
}

function main(): void {
  const path = birdArtefactPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // A missing artefact is a configuration absence, not a crash. The stack trace this used to
    // print named a path and stopped; it did not say that the axis had no input.
    cannotPrice(`no artefact at ${path}`);
    return;
  }
  const artifact = JSON.parse(raw) as Artifact;
  const { questions, recorded } = poolFromArtifact(artifact.per_case, artifact.config?.arms ?? []);
  const keyed = questions.filter(
    (question) => question.dbId !== undefined && question.fold !== undefined,
  );
  if (keyed.length === 0) {
    cannotPrice(
      recorded
        ? 'the artefact records no database or fold beside the pool, and a prior keyed without one ' +
            'would describe a corpus it never saw'
        : 'the artefact carries no pool: no candidate list was recorded, so there is nothing to ' +
            'look anything up in',
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
  // A pool where every question has one candidate is a *finding* — the draws collapsed — and it
  // exits zero, because the subject was present and the answer is zero. That is the distinction
  // the code above exists to preserve: absence is code 2, a nil reading is code 0.
  process.stdout.write(
    best === undefined
      ? '[prior] no scope offered a choice to make: the pool holds no question with two candidates\n'
      : `[prior] best scope '${best.scope}': ${best.deltaPp >= 0 ? '+' : ''}${best.deltaPp.toFixed(2)}pp ` +
          `over the first draw on ${best.choices} question(s), ${best.covered} of them with any ` +
          `support at all. In sample on this pool: an upper bound for a verifier, not a result.\n`,
  );
}

main();
