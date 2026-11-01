/**
 * The τ² lane, expressed as the five-method contract the protocol measures.
 *
 * ## What this file is for
 *
 * `packages/protocol` states the contract; this is the first scenario in the repository to
 * implement it. The interesting content is not the five functions — they are short — but what
 * implementing them revealed about the contract, and each of the three findings is recorded where
 * it was found rather than in a document that could drift from the code.
 *
 * ## Finding 1: `parse` and `score` are receipts here, not readings
 *
 * The contract reads as though a lane sees the model's raw reply, decides what it says, and then
 * decides whether it is right. That is true of the BIRD lane, where the reply is SQL text in this
 * process and only the execution is delegated. It is not true of τ²: the agent runs in another
 * process, its transcript never crosses back, and the evaluator hands over a verdict with a
 * decomposition beside it. So `parse` parses *the receipt* and `score` reads the verdict out of it.
 *
 * That is not a workaround. Every gate in the protocol needs an outcome and nothing else — no gate
 * inspects a candidate's shape — so a lane that can only see receipts is still measurable by the
 * whole apparatus. What it cannot do is anything that would need the transcript, and nothing in the
 * gate list does. The contract's prose overstated what a lane must be able to see; the signature
 * was right.
 *
 * ## Finding 2: `prompt` renders the pack, not the prompt
 *
 * The agent assembles its own prompt in Python. What memory controls is the block that arrives over
 * the recall facade, so that block is what this adapter renders, and its placement — above the
 * instruction, because a τ² user message is the last thing the model reads before acting — is the
 * lane's decision rather than the protocol's. A protocol that rendered the whole prompt would have
 * to know where a policy document ends, which is a fact about this scenario.
 *
 * ## Finding 3: `strata` is outcome-blind because its argument list is
 *
 * τ²'s natural strata are the domain and the reward basis, and both are properties of the task
 * document. Nothing here can see a result, which is the enforcement the contract's docstring
 * promised.
 */
import { L4ParseError } from '../l4.js';
import type { LaneAdapter } from '@agentix-e/microglia-protocol/adapter';

/**
 * One task, reduced to what the lane and the protocol need.
 *
 * `instruction` and `referenceActions` are allowed to be empty strings and empty arrays rather than
 * being dropped: a τ² task document carries them, a re-scored fixture may not, and a lane that
 * refused to load a task without an instruction could not read the synthetic grid this repository
 * ships to exercise its own reader.
 */
export type Tau2Task = {
  readonly id: string;
  /** What the simulated user asks for, in the dataset's own words. */
  readonly instruction: string;
  /** `info.environment_info.domain_name`, or `unknown` when the document omits it. */
  readonly domain: string;
  /** The reward components the task declares, in declaration order. */
  readonly rewardBasis: readonly string[];
  /** The tool calls a correct trajectory contains, in the order τ² compares them. */
  readonly referenceActions: readonly string[];
};

/**
 * One scored attempt, as the lane can see it.
 *
 * No transcript. See finding 1: the evaluator consumes it, and the protocol never asks for it.
 */
export type Tau2Candidate = {
  /** `reward_info.reward`; `null` is an infrastructure error rather than a failure. */
  readonly reward: number | null;
  /** The per-check decomposition τ² publishes beside the reward, flattened and sorted. */
  readonly checks: readonly { readonly check: string; readonly value: number }[];
};

/** What memory puts in front of the agent: the rendered block and the ids it came from. */
export type Tau2Pack = {
  readonly rendered: string;
  readonly ids: readonly string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * `user_scenario.instructions` is a string or a structured object, depending on the domain.
 *
 * τ² models both: `UserScenario.instructions: str | StructuredUserInstructions`. A reader that
 * assumed the string form would return an empty instruction for every structured domain and then
 * report a prompt that said nothing, which is the shape of every silent-instrument defect this
 * record has had to repair.
 */
function instructionsOf(value: unknown): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (record === undefined) return '';
  const parts: string[] = [];
  for (const key of ['reason_for_call', 'known_info', 'unknown_info', 'task_instructions']) {
    const field = record[key];
    if (typeof field === 'string' && field.trim() !== '') parts.push(field);
  }
  return parts.join(' ');
}

/** The reference tool calls, in the order τ² compares them. */
function referenceActionsOf(criteria: Record<string, unknown> | undefined): readonly string[] {
  const actions = criteria?.['actions'];
  if (!Array.isArray(actions)) return [];
  const names: string[] = [];
  for (const entry of actions) {
    const action = asRecord(entry);
    const name = action?.['name'];
    if (typeof name === 'string' && name.trim() !== '') names.push(name);
  }
  return names;
}

function rewardBasisOf(criteria: Record<string, unknown> | undefined): readonly string[] {
  const basis = criteria?.['reward_basis'];
  if (!Array.isArray(basis)) return [];
  return basis.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The corpus, in document order.
 *
 * Document order rather than sorted: every fold partition and every pair downstream is computed
 * over this array's indices, and a loader that reordered a document would silently pair a question
 * with another question's answer. What the contract asks for is stability, not order.
 */
export function tau2Tasks(document: unknown): readonly Tau2Task[] {
  const root = asRecord(document);
  const tasks = root?.['tasks'];
  if (!Array.isArray(tasks)) {
    throw new L4ParseError('missing-tasks', '`tasks` is not an array');
  }
  const info = asRecord(root?.['info']);
  const environment = asRecord(info?.['environment_info']);
  const namedDomain = environment?.['domain_name'];
  const domain = typeof namedDomain === 'string' && namedDomain !== '' ? namedDomain : 'unknown';

  const seen = new Set<string>();
  const out: Tau2Task[] = [];
  for (const entry of tasks) {
    const task = asRecord(entry);
    const id = task?.['id'];
    if (typeof id !== 'string' || id === '') {
      throw new L4ParseError('missing-tasks', 'a task has no id');
    }
    if (seen.has(id)) {
      throw new L4ParseError('missing-tasks', `'${id}' appears twice in \`tasks\``);
    }
    seen.add(id);
    const criteria = asRecord(task?.['evaluation_criteria']);
    const scenario = asRecord(task?.['user_scenario']);
    out.push({
      id,
      instruction: instructionsOf(scenario?.['instructions']),
      domain,
      rewardBasis: rewardBasisOf(criteria),
      referenceActions: referenceActionsOf(criteria),
    });
  }
  return out;
}

/**
 * The pack's block, placed above the instruction.
 *
 * An empty pack renders as the empty string rather than as a header with nothing under it: a
 * `## What you know` with no entries is a prompt that says "you know nothing", and that is a
 * different condition from the reference arm, which says nothing at all.
 */
export function renderTau2Pack(pack: Tau2Pack): string {
  return pack.rendered.trim() === '' ? '' : `${pack.rendered.trim()}\n\n`;
}

/**
 * One simulation entry, read as a candidate.
 *
 * `undefined` means the entry carries no verdict at all — the evaluator did not run, so there is
 * nothing to score and the parse-rate gate should count it. A verdict of `null` is different and is
 * preserved: upstream permits it for infrastructure errors only, and counting it as a wrong answer
 * is how a lane reports its own harness failing as the model failing.
 */
export function parseTau2Candidate(raw: string): Tau2Candidate | undefined {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entry = asRecord(document);
  if (entry === undefined) return undefined;
  const info = asRecord(entry['reward_info']);
  if (info === undefined) return undefined;
  const reward = info['reward'];
  if (reward !== null && (typeof reward !== 'number' || !Number.isFinite(reward))) return undefined;

  const breakdown = asRecord(info['reward_breakdown']);
  // `RewardInfo.reward_breakdown` is `dict[RewardType, float]` — one scalar per basis, already
  // aggregated by the evaluator. Re-deriving it from `action_checks` and `db_check` would be a
  // second opinion about how τ² averages its own checks, and a lane that disagrees with the
  // benchmark about aggregation is a lane that cannot be compared with it.
  //
  // Sorted by name rather than by document order: two runs of the same task must produce the same
  // row order, and a JSON object's key order is a property of whoever wrote the file.
  const checks = Object.keys(breakdown ?? {})
    .sort()
    .flatMap((check) => {
      const value = breakdown?.[check];
      return typeof value === 'number' && Number.isFinite(value) ? [{ check, value }] : [];
    });
  return { reward: reward as number | null, checks };
}

/**
 * Whether the evaluator called it correct.
 *
 * `=== 1` rather than `>= 0.99`: τ²'s reward is a weighted sum of checks, so `0.999` is a near miss
 * and rounding it up is how a lane reports a pass the benchmark did not give.
 */
export function scoreTau2Candidate(candidate: Tau2Candidate): boolean {
  return candidate.reward === 1;
}

/**
 * The outcome-blind strata.
 *
 * Both are read off the task document. A stratum named after a result — "the questions the pack
 * rescued" — would measure regression to the mean and call it a subgroup effect, which is why the
 * contract's signature hands this function a task and nothing else.
 */
export function tau2Strata(task: Tau2Task): readonly string[] {
  const basis = [...task.rewardBasis].sort().join('+');
  return [`domain:${task.domain}`, `basis:${basis === '' ? 'unspecified' : basis}`];
}

/**
 * The adapter, over a corpus that has already been read.
 *
 * Taking the corpus rather than the document keeps `load` honest: it cannot fail, because the
 * document was read by `tau2Tasks`, whose refusals name the reason. A `load` that could throw would
 * make the protocol's first gate unreachable in exactly the case it is meant to catch.
 */
export function createTau2Adapter(
  corpus: readonly Tau2Task[],
): LaneAdapter<Tau2Task, Tau2Candidate, Tau2Pack> {
  return {
    load: async () => corpus,
    prompt: (task, pack) => `${renderTau2Pack(pack)}${task.instruction}`,
    parse: parseTau2Candidate,
    score: async (_task, candidate) => scoreTau2Candidate(candidate),
    strata: tau2Strata,
  };
}
