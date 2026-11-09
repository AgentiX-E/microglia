/**
 * Which of the workflow's two lanes a dispatch actually buys.
 *
 * The `sota` workflow holds two lanes that measure different things on different corpora: BIRD/SQL over
 * Mini-Dev, and τ² retail over pass^4. Their gates were written separately and neither knew about the
 * other, so `bird` defaulted to `true` for every dispatch — including the ones whose registration is a
 * τ² registration and whose BIRD lane is therefore a 1,768-call, seventeen-minute measurement of an arm
 * nobody grades. R61 paid that, on a job that then failed for an unrelated reason; the waste is the part
 * that repeats silently, because a lane nobody grades still produces a number and a green step.
 *
 * The rule this file encodes is the one the rest of the lane already follows for the recall floor, the
 * facade pair and the note levels: **the registration decides the experiment.** A registration that
 * declares a `recallFloor` is a τ² registration, and a τ² registration buys no BIRD lane. A
 * registration that declares none is a BIRD registration and buys one.
 *
 * The dispatch input becomes an override rather than a default, and that is the second half of the
 * repair: `bird` defaulted to `true`, so a dispatch that meant to buy the lane and one that never
 * thought about it were the same string, and no rule could tell them apart. Its default is now empty —
 * *the registration decides* — with `true` and `false` as explicit statements. The two BIRD-only splits
 * stay as an explicit request, because `dev` and `train` exist for no other purpose.
 *
 * The function is pure and the workflow only prints its answer, so the decision is testable in a
 * repository whose other workflow expressions are not.
 */

/** What the workflow knows before it spends anything. */
export type LaneRequest = {
  /** `github.event_name`: `workflow_dispatch`, `schedule`, `push`. */
  readonly event: string;
  /** The dispatch input, verbatim. Empty when the event has no inputs. */
  readonly bird: string;
  /** The dispatch split: `minidev`, `dev` or `train`. Empty when the event has no inputs. */
  readonly split: string;
  /**
   * Whether the named registration declares a `recallFloor`.
   *
   * Undefined when the dispatch names no registration — a scheduled run has none, and so does a push.
   */
  readonly declaresRecallFloor?: boolean;
};

/** The decision, with the sentence that explains it in the run summary. */
export type LaneScope = {
  readonly bird: boolean;
  readonly reason: string;
};

/**
 * Resolve the BIRD lane for one dispatch.
 *
 * The order matters and is the argument: an explicit `bird: false` is honoured before anything reads
 * the registration, a BIRD-only split outranks the registration's kind, and the registration's kind
 * outranks the input's default. Each step down that list is a weaker statement of intent than the one
 * above it, which is why a default can never override a declaration.
 */
export function laneScope(request: LaneRequest): LaneScope {
  if (request.event !== 'workflow_dispatch') {
    return {
      bird: true,
      reason: `a ${request.event} run has no dispatch inputs; the scheduled measurement runs both lanes`,
    };
  }
  if (request.bird === 'false') {
    return {
      bird: false,
      reason: 'the dispatch asked for no BIRD lane (`bird: false`)',
    };
  }
  if (request.bird === 'true') {
    return {
      bird: true,
      reason: 'the dispatch asked for the BIRD lane explicitly (`bird: true`)',
    };
  }
  if (request.split === 'dev' || request.split === 'train') {
    return {
      bird: true,
      reason: `the dispatch names the \`${request.split}\` split, which exists only for the BIRD lane`,
    };
  }
  if (request.declaresRecallFloor === true) {
    return {
      bird: false,
      reason:
        'the registration declares a recall floor, so it is a τ² registration and buys no BIRD lane; ' +
        'register a BIRD question to measure one',
    };
  }
  if (request.declaresRecallFloor === false) {
    return {
      bird: true,
      reason: 'the registration declares no recall floor, so it is a BIRD registration',
    };
  }
  return {
    bird: true,
    reason: 'the dispatch names no registration, so the BIRD lane stands on its default',
  };
}

/**
 * The file a dispatch's `prereg` input names.
 *
 * One identifier arrives in three forms — `R63-recall-order`, `R63-recall-order.md`, and
 * `prereg/R63-recall-order.md` — because the CLI (`pnpm eval:prereg <path>`) takes a path and the
 * workflow input takes an id. A dispatch that passed the path where the id was expected built
 * `prereg/prereg/R63-recall-order.md.md` and reported that nobody had registered it: a message naming
 * a file no caller typed, about a file that exists. The fix belongs in the resolver, not in the
 * instruction to be more careful.
 */
export function preregFileOf(id: string): string {
  let name = id.trim();
  while (name.startsWith('./')) name = name.slice(2);
  if (name.startsWith('prereg/')) name = name.slice('prereg/'.length);
  if (name.endsWith('.md')) name = name.slice(0, -'.md'.length);
  return name === '' ? '' : `prereg/${name}.md`;
}
