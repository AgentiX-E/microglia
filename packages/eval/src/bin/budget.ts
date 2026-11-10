/**
 * What a dispatch will cost, computed from a run that already happened.
 *
 * The registrations of R70 through R74 each carried a cost table whose numbers were arithmetic done
 * by hand, and each of them was wrong: R72 budgeted 44,000 for a run that spent 16,876, R73's
 * amendment budgeted 5,600 for 3,165, and R74 budgeted 28,000 for a run that measured 29,609 on its
 * first fold and was stopped holding a fifth of its own cost. The arithmetic was not careless — it
 * was the wrong instrument, because calls per question per arm is a property of the lane at that
 * moment and not a constant.
 *
 * This command removes the arithmetic. It reads an artefact, takes the measured rate, and prints the
 * two numbers a dispatch form wants:
 *
 *   pnpm eval:budget --bird eval/results/poc-sota-bird-train-R72.json --arms none,full,loo
 *   pnpm eval:budget --bird <artefact> --arms none,full --questions 350
 *
 * The ceiling is printed as a separate number rather than as a percentage, because the two are
 * different claims: the projection is what the lane will spend at the rate it just demonstrated, and
 * the ceiling is what the operator authorises when part of the arm list has never demonstrated
 * anything. A registration that quotes one number for both has authored an estimate with a bound's
 * authority, which is exactly the mistake R74 paid for.
 *
 * Zero calls.
 */
import { readFileSync } from 'node:fs';
import { planBudget, samplingSpecOf, type PriorRun } from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Artefact = {
  readonly calls?: number;
  /**
   * The evaluated population. A number in older artefacts, a record with `eval` in current ones —
   * both spellings exist in the repository and a tool that reads only one of them refuses to price
   * half its own evidence.
   */
  readonly n?: number | { readonly eval?: number; readonly total?: number };
  readonly config?: {
    readonly arms?: readonly string[];
    readonly folds?: number;
    readonly limit?: number;
    /** Questions each fold distilled from. The part of the bill that does not scale with `limit`. */
    readonly learn_sample?: number;
    /**
     * The in-run deduplication of learning generations.
     *
     * `hits` of `hits + misses` learning requests were answered without a call, so this is the share of
     * the prior's learning pass that was free — the number that turns `learn_sample` into a cost. It
     * lives inside `config` because that is where the run wrote it; a reader looking for it at the top
     * level finds nothing and reports "nothing measurable", which is how this field was found to be in
     * the wrong place.
     */
    readonly generation_cache?: { readonly hits?: number; readonly misses?: number };
  };
  readonly per_case?: readonly unknown[];
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

/**
 * The evaluated population, which the artefact records in three shapes and only one of which is
 * the number a projection divides by.
 *
 * `n.total` is what the split offered, `n.eval` is what the run actually evaluated. Pricing a
 * dispatch from the first would overstate its cost on any split where some questions are unusable,
 * and the difference is not a rounding error on a split with a schema filter.
 */
const populationOf = (artefact: Artefact): number => {
  const n = artefact.n;
  if (typeof n === 'number') return n;
  if (n !== undefined && typeof n.eval === 'number') return n.eval;
  return artefact.per_case?.length ?? 0;
};

const numberOf = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function main(argv: readonly string[]): number {
  const path = flag(argv, 'bird') ?? birdArtefactPath();
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;

  // `per_case` is the last fallback because an artefact written before either field existed still
  // has the rows, and a projection that refused to read a file it could count would be a tool that
  // only works on new runs.
  const questions = populationOf(artefact);
  const cache = artefact.config?.generation_cache;
  const cacheRequests = (cache?.hits ?? 0) + (cache?.misses ?? 0);
  const prior: PriorRun = {
    calls: artefact.calls ?? 0,
    questions,
    arms: artefact.config?.arms ?? [],
    folds: artefact.config?.folds ?? 0,
    // Absent when the artefact predates the field, which is what makes the projection amortised: it
    // then charges the prior's learning pass to its questions and says so.
    learningPerFold: artefact.config?.learn_sample,
    learningHitShare: cacheRequests > 0 ? (cache?.hits ?? 0) / cacheRequests : undefined,
  };

  const requestedArms = flag(argv, 'arms');
  const arms = requestedArms === undefined ? prior.arms : requestedArms.split(',').map((arm) => arm.trim());
  const requestQuestions = numberOf(flag(argv, 'questions')) ?? prior.questions;
  const requestFolds = numberOf(flag(argv, 'folds')) ?? prior.folds;
  // `--learn` is the dispatch's own `learn_sample`. A dispatch that learns and does not say so is
  // priced as if it did not, which is the omission that stopped R77 after one fold.
  const requestLearning = numberOf(flag(argv, 'learn'));

  // Draws, not arms. A `sample-5-*` arm costs five calls per question, and a projection that counted
  // it as one is what let R68 be dispatched at 4,179 calls for a run that needed 5,638. The weight is
  // read from the same `samplingSpecOf` the lane dispatches with, so a new selector cannot arrive with
  // a cost nobody modelled.
  const weights: Record<string, number> = {};
  for (const arm of new Set([...prior.arms, ...arms])) {
    weights[arm] = samplingSpecOf(arm)?.n ?? 1;
  }
  const plan = planBudget(prior, {
    arms,
    questions: requestQuestions,
    folds: requestFolds,
    weights,
    learningPerFold: requestLearning,
  });

  process.stdout.write(`[budget] prior      ${path}\n`);
  process.stdout.write(
    `[budget] measured   ${prior.calls} calls over ${prior.questions} questions × ` +
      `${prior.arms.length} arm(s) × ${prior.folds} fold(s)\n`,
  );
  if (plan.unusable !== null) {
    process.stdout.write(`[budget] unusable   ${plan.unusable}: this file cannot price a dispatch\n`);
    if (plan.unmeasured.length > 0) {
      process.stdout.write(`[budget] unmeasured ${plan.unmeasured.join(', ')}\n`);
    }
    return 1;
  }

  process.stdout.write(
    `[budget] rate       ${plan.ratePerQuestionArm.toFixed(4)} calls per question per draw\n`,
  );
  const draws = arms.reduce((sum, arm) => sum + (weights[arm] ?? 1), 0);
  process.stdout.write(`[budget] draws      ${String(draws)} per question (${arms.map((arm) => `${arm}×${String(weights[arm] ?? 1)}`).join(', ')})\n`);
  process.stdout.write(
    `[budget] request    ${requestQuestions} questions × ${arms.length} arm(s) × ${requestFolds} fold(s)` +
      ` — ${arms.join(',')}\n`,
  );
  if (requestLearning !== undefined && requestLearning > 0) {
    process.stdout.write(
      `[budget] learning   ${String(requestLearning)} per fold × ${String(requestFolds)} fold(s) = ` +
        `${String(requestLearning * requestFolds)} request(s); the prior cache answered ` +
        `${cacheRequests > 0 ? `${(((cache?.hits ?? 0) / cacheRequests) * 100).toFixed(0)}%` : 'nothing measurable'}\n`,
    );
  }
  if (plan.amortisedLearning) {
    process.stdout.write(
      '[budget] amortised  the prior does not separate its learning pass from its questions, so the ' +
        'projection is a ratio over a mixture and the ceiling is the number to authorise\n',
    );
  }
  process.stdout.write(`[budget] projected  ${plan.projected}\n`);
  process.stdout.write(
    `[budget] ceiling    ${plan.ceiling}` +
      (plan.measured ? '' : ` (1.3× because ${plan.unmeasured.join(',')} is unmeasured)`) +
      (plan.ceiling > plan.projected ? ' — the bound, which prices learning cold\n' : ' — equal to the projection\n'),
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
