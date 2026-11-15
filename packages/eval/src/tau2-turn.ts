/**
 * R125 — the unit a memory can afford to move, read out of a phase's own trajectories.
 *
 * ## Why the unit moved
 *
 * Every paired test on this lane compares **tasks**, and the retail split ships forty. Forty tasks give
 * 7.76pp of standard error, R124 measured a 26.21pp minimum detectable difference, R123a measured 14.01pp
 * — the record has now paid three times for the same arithmetic. More trials do not help: six trials on
 * forty tasks is still forty tasks (`z = 1.29` for a 10pp effect). More tasks do not help either: 114
 * give 4.60pp, and 300 are needed for a 7.5pp gap at `z = 1.96`.
 *
 * What is affordable is per-turn behaviour, and it is already paid for: a phase of 160 episodes records
 * 1,813 assistant turns, and a memory that induces a wrong action shows up in them as a call that came
 * back in error, as the same call made twice with the same arguments, and as the user turn that follows
 * either. `eval/drivers/tau2/turns.py` counts them in the process that holds the messages; this module
 * reads the counts back and pairs them across arms.
 *
 * ## The one rule this module is built around
 *
 * **A count with no denominator is not a reading.** `toolErrors: 0` is two different sentences — the tools
 * answered and none failed, or this release stopped serialising the flag — and the census carries
 * `toolResultsWithFlag` so that the two can be told apart. When that denominator is zero the numerator
 * arrives as `null`, and every type here keeps `null` distinct from `0` rather than defaulting: the record
 * has repaired the collapse of missing into zero nine times, and each repair cost a round.
 */

/** One episode's counts, as `turns.py` wrote them: camelCase because it crosses as JSON, not as Python. */
export type TurnEpisode = {
  readonly task: string;
  readonly trial: number;
  /** Assistant turns in the episode. */
  readonly assistant: number;
  /** Every user message, the opening instruction included. */
  readonly user: number;
  /** User messages that followed the agent's first action — the turns the simulator took in reaction. */
  readonly userAfterAction: number;
  /** Of those, the ones that followed a tool result marked in error. */
  readonly userAfterError: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  /** Tool results that carried an `error` field. The denominator of `toolErrors`. */
  readonly toolResultsWithFlag: number;
  /** `null` when no tool result carried the flag: the release stopped saying, which is not zero errors. */
  readonly toolErrors: number | null;
  readonly repeatCalls: number;
  /** Calls whose argument payload this reader could not see, so they cannot be called repeats. */
  readonly callsWithoutArguments: number;
};

/** A phase's census: totals beside the rows the paired reading joins on. */
export type TurnCensus = {
  /** Episodes the phase ran. */
  readonly episodes: number;
  /** Episodes whose messages this reader could see. */
  readonly measurable: number;
  readonly toolErrors: number | null;
  readonly toolResultsWithFlag: number;
  readonly toolCalls: number;
  /** Tool results the phase recorded — the population `toolResultsWithFlag` is a share of. */
  readonly toolResults: number;
  readonly repeatCalls: number;
  readonly callsWithoutArguments: number;
  readonly userAfterAction: number;
  readonly userAfterError: number;
  readonly assistant: number;
  readonly rows: readonly TurnEpisode[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * One row, or `undefined` when the row is not a row.
 *
 * A row missing its counts is dropped rather than zero-filled, because a zero-filled row joins into the
 * paired reading as an episode on which neither arm did anything — which is a measurement of the memory's
 * quietness that the run never made.
 */
export function turnEpisodeOf(raw: unknown): TurnEpisode | undefined {
  const row = asRecord(raw);
  if (row === undefined) return undefined;
  const assistant = count(row['assistant']);
  const user = count(row['user']);
  const toolCalls = count(row['toolCalls']);
  if (assistant === undefined || user === undefined || toolCalls === undefined) return undefined;
  const errors = row['toolErrors'];
  const task = row['task'];
  return {
    task: typeof task === 'string' ? task : String(task ?? ''),
    trial: count(row['trial']) ?? 0,
    assistant,
    user,
    userAfterAction: count(row['userAfterAction']) ?? 0,
    userAfterError: count(row['userAfterError']) ?? 0,
    toolCalls,
    toolResults: count(row['toolResults']) ?? 0,
    toolResultsWithFlag: count(row['toolResultsWithFlag']) ?? 0,
    // `null` survives as `null`; an absent key is also "not measured", which is the same sentence.
    toolErrors: typeof errors === 'number' && Number.isFinite(errors) ? errors : null,
    repeatCalls: count(row['repeatCalls']) ?? 0,
    callsWithoutArguments: count(row['callsWithoutArguments']) ?? 0,
  };
}

/**
 * The census from the block itself, or `undefined` when the block is not one.
 *
 * Two entry points — this and `turnCensusOf` — because the block travels in two shapes: nested under
 * `diagnostics.turns` inside a phase's own document, and at `tau2.turnCensus` inside an arm's artefact. A
 * reader with one entry point would have to know which, and the two artefacts would drift apart the first
 * time one of them was extended.
 */
export function turnCensusOfBlock(raw: unknown): TurnCensus | undefined {
  const block = asRecord(raw);
  if (block === undefined) return undefined;
  const rows = Array.isArray(block['rows'])
    ? block['rows']
        .map((entry) => turnEpisodeOf(entry))
        .filter((row): row is TurnEpisode => row !== undefined)
    : [];
  return {
    episodes: count(block['episodes']) ?? 0,
    // From the rows rather than from the block's own `measurable`, because the two can disagree — a block
    // written by one release and read by another — and the rows are what the pair will join on. A reader
    // that trusted the block's count would print `160 of 160` over a table it could only pair 3 of.
    measurable: rows.length,
    toolErrors: typeof block['toolErrors'] === 'number' ? (block['toolErrors'] as number) : null,
    toolResultsWithFlag: count(block['toolResultsWithFlag']) ?? 0,
    toolCalls: count(block['toolCalls']) ?? 0,
    toolResults: count(block['toolResults']) ?? 0,
    repeatCalls: count(block['repeatCalls']) ?? 0,
    callsWithoutArguments: count(block['callsWithoutArguments']) ?? 0,
    userAfterAction: count(block['userAfterAction']) ?? 0,
    userAfterError: count(block['userAfterError']) ?? 0,
    assistant: count(block['assistant']) ?? 0,
    rows,
  };
}

/**
 * The census from a phase's diagnostics, or `undefined` when the phase did not write one.
 *
 * `undefined` rather than an empty census: an artefact written before this instrument existed cannot be
 * read as a run without tool errors, and the two are the sentences a reader most needs to keep apart.
 *
 * The key is `turnCensus` rather than `turns` because the diagnostics already carry an `agent_turns`, and a
 * reader who confused the two would divide a bill by the wrong population — the defect §179 named.
 */
export function turnCensusOf(diagnostics: unknown): TurnCensus | undefined {
  const root = asRecord(diagnostics);
  return turnCensusOfBlock(root?.['turnCensus']);
}

/** The two counts a registered turn-level claim is made in. */
export type TurnMeasure = 'toolErrors' | 'repeatCalls';

/**
 * The exact Poisson interval for a count, at 95%.
 *
 * A count of rare events is not a proportion: its interval comes from the Poisson tail, and the zero case
 * is the one that matters here. Zero observed errors is consistent with up to 3.69 expected — the upper
 * bound is `−ln(0.025)` — so an arm with `toolErrors: 0` has not shown that the memory is safe, it has shown
 * that the rate is below 3.7 per phase. Intervals that ignore this are how a zero becomes a claim.
 */
export function poissonInterval(n: number): readonly [number, number] {
  if (!Number.isFinite(n) || n < 0) return [0, 0];
  if (n === 0) return [0, -Math.log(0.025)];
  const half = 1.959964 * Math.sqrt(n);
  return [Math.max(0, n - half), n + half];
}

/** One measure, paired across the two arms episode by episode. */
export type PairedTurnReading = {
  readonly measure: TurnMeasure;
  /** Episodes present in both arms with the measure observed in both. */
  readonly episodes: number;
  readonly memory: number;
  readonly control: number;
  readonly memoryInterval: readonly [number, number] | null;
  readonly controlInterval: readonly [number, number] | null;
  /**
   * Whether the two arms' Poisson intervals are disjoint.
   *
   * `null` when either count is unmeasured — the refutation this reading is registered against cannot be
   * graded on a side that never counted.
   */
  readonly separated: boolean | null;
  /** Mean per-episode difference (memory − control), or `null` below two pairs. */
  readonly meanDelta: number | null;
  /** Paired 95% interval on that mean, from the per-episode differences. */
  readonly deltaInterval: readonly [number, number] | null;
};

/** The key two arms' rows join on: one episode is one `(task, trial)`. */
export function episodeKey(row: { readonly task: string; readonly trial: number }): string {
  return `${row.task}#${String(row.trial)}`;
}

function intervalOf(values: readonly number[]): readonly [number, number] | null {
  if (values.length < 2) return null;
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const half = 1.959964 * Math.sqrt(variance / n);
  return [mean - half, mean + half];
}

/**
 * One measure, paired by episode.
 *
 * The pairing is by `(task, trial)` rather than by position, which is the same repair R128 made for the
 * attribution join: a phase can recall more than once per episode, and a positional join pairs one
 * episode's behaviour with another's. An episode missing from either side is dropped and the drop shows up
 * as `episodes` being smaller than either arm's census — never as a zero.
 */
export function pairedTurnCount(
  measure: TurnMeasure,
  memory: TurnCensus | undefined,
  control: TurnCensus | undefined,
): PairedTurnReading | undefined {
  if (memory === undefined || control === undefined) return undefined;
  const controlRows = new Map(control.rows.map((row) => [episodeKey(row), row]));
  const deltas: number[] = [];
  let memoryTotal = 0;
  let controlTotal = 0;
  let measured = 0;
  for (const row of memory.rows) {
    const other = controlRows.get(episodeKey(row));
    if (other === undefined) continue;
    const left = row[measure];
    const right = other[measure];
    if (left === null || right === null) continue;
    measured += 1;
    memoryTotal += left;
    controlTotal += right;
    deltas.push(left - right);
  }
  const memoryMeasured = memory[measure] !== null;
  const controlMeasured = control[measure] !== null;
  const separated =
    memoryMeasured && controlMeasured
      ? !overlaps(poissonInterval(memoryTotal), poissonInterval(controlTotal))
      : null;
  const meanDelta =
    deltas.length === 0 ? null : deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  return {
    measure,
    episodes: measured,
    memory: memoryTotal,
    control: controlTotal,
    memoryInterval: memoryMeasured ? poissonInterval(memoryTotal) : null,
    controlInterval: controlMeasured ? poissonInterval(controlTotal) : null,
    separated,
    meanDelta,
    deltaInterval: intervalOf(deltas),
  };
}

function overlaps(
  left: readonly [number, number],
  right: readonly [number, number],
): boolean {
  return left[0] <= right[1] && right[0] <= left[1];
}

/** Every measure R125 registers, paired. */
export function pairedTurns(
  memory: TurnCensus | undefined,
  control: TurnCensus | undefined,
): readonly PairedTurnReading[] {
  const readings: PairedTurnReading[] = [];
  for (const measure of ['toolErrors', 'repeatCalls'] as const) {
    const reading = pairedTurnCount(measure, memory, control);
    if (reading !== undefined) readings.push(reading);
  }
  return readings;
}

/**
 * The line a run prints, and it prints the denominator before the count.
 *
 * `0 toolErrors` is followed by `of N results that carried the flag`, because the two halves of that
 * sentence are the measurement and the reader cannot otherwise tell a clean phase from an unread one. When
 * the census itself is absent the line says so instead of printing zeros — the same rule the speak line
 * follows for `rivaled`.
 */
export function turnCensusLine(census: TurnCensus | undefined): string {
  if (census === undefined) {
    return 'turns: no per-turn census reached this phase, so nothing is claimed about wrong actions';
  }
  if (census.measurable === 0) {
    return `turns: ${String(census.episodes)} episode(s) ran and none carried readable messages`;
  }
  const measured = `${String(census.measurable)} of ${String(census.episodes)} episode(s)`;
  const errors =
    census.toolErrors === null
      ? 'tool errors not observable (no result carried the flag)'
      : `${String(census.toolErrors)} tool error(s) of ${String(census.toolResultsWithFlag)} flagged result(s)`;
  return (
    `turns: ${measured}, ${String(census.assistant)} assistant turn(s), ` +
    `${String(census.toolCalls)} call(s) (${String(census.repeatCalls)} repeated` +
    `${census.callsWithoutArguments === 0 ? '' : `, ${String(census.callsWithoutArguments)} unreadable`}); ` +
    `${errors}; ${String(census.userAfterAction)} user turn(s) after an action, ` +
    `${String(census.userAfterError)} after an error`
  );
}

/** The paired line: two arms, one measure, and whether the difference exceeds either interval. */
export function pairedTurnLine(readings: readonly PairedTurnReading[]): string {
  if (readings.length === 0) {
    return 'turns: neither arm carried a census, so no paired count is available';
  }
  const parts = readings.map((reading) => {
    const verdict =
      reading.separated === null
        ? 'unmeasured on one side'
        : reading.separated
          ? 'separated'
          : 'not separated';
    const delta =
      reading.meanDelta === null
        ? 'no pairs'
        : `${reading.meanDelta >= 0 ? '+' : ''}${reading.meanDelta.toFixed(3)} per episode`;
    return `${reading.measure} ${String(reading.memory)} vs ${String(reading.control)} over ${String(reading.episodes)} pair(s), ${delta} (${verdict})`;
  });
  return `turns paired: ${parts.join('; ')}`;
}
