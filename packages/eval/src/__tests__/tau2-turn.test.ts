import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  episodeKey,
  pairedTurnCount,
  pairedTurnLine,
  pairedTurns,
  poissonInterval,
  turnCensusLine,
  turnCensusOf,
  turnCensusOfBlock,
  turnEpisodeOf,
  type TurnCensus,
} from '../tau2-turn.js';

/**
 * R125's census, and the three ways a count can lie.
 *
 * The module exists because the task-level test cannot resolve the effects this lane has: forty tasks give
 * 7.76pp of standard error and a 26.21pp minimum detectable difference. The turn-level count has a
 * denominator of 1,800, which is affordable — and exactly that ratio is what makes the ways it can go wrong
 * expensive. A zero that means "unread", a repetition invented from an unreadable argument, and a pair
 * joined by position rather than by episode all produce a large number that no arm can falsify.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const row = (task: string, trial: number, over: Record<string, unknown> = {}) => ({
  task,
  trial,
  assistant: 6,
  user: 4,
  userAfterAction: 3,
  userAfterError: 1,
  toolCalls: 5,
  toolResults: 5,
  toolResultsWithFlag: 5,
  toolErrors: 1,
  repeatCalls: 0,
  callsWithoutArguments: 0,
  ...over,
});

const censusOf = (rows: readonly Record<string, unknown>[], over: Record<string, unknown> = {}) =>
  turnCensusOf({
    turnCensus: {
      episodes: rows.length,
      measurable: rows.length,
      toolErrors: 1,
      toolResultsWithFlag: 5,
      toolCalls: 5,
      repeatCalls: 0,
      callsWithoutArguments: 0,
      userAfterAction: 3,
      userAfterError: 1,
      assistant: 6,
      rows,
      ...over,
    },
  });

describe('an unread phase is not a phase without wrong actions', () => {
  it('reports nothing at all when the diagnostics carry no census', () => {
    expect(turnCensusOf(undefined)).toBeUndefined();
    expect(turnCensusOf({})).toBeUndefined();
    // The pre-R125 artefact: `agent_turns` present, no `turns`. This is the shape every committed arm has,
    // and reading it as a zero would have made the instrument look like a clean bill of health.
    expect(turnCensusOf({ agent_turns: 1813, simulations: 160 })).toBeUndefined();
    expect(turnCensusLine(undefined)).toContain('no per-turn census reached this phase');
  });

  it('distinguishes a phase whose messages were unreadable from a quiet one', () => {
    const blind = turnCensusOf({ turnCensus: { episodes: 160, measurable: 0, rows: [] } });
    expect(blind?.measurable).toBe(0);
    expect(turnCensusLine(blind)).toContain('160 episode(s) ran and none carried readable messages');
  });

  // The ninth instance of this record's oldest defect, and the one the census was designed to make
  // impossible: `toolErrors` is null when no tool result carried the flag, so `0` can only ever mean that
  // the tools answered and none failed.
  it('refuses to print a zero when no result carried the error flag', () => {
    const census = turnCensusOf({
      turnCensus: {
        episodes: 2,
        measurable: 2,
        toolErrors: null,
        toolResultsWithFlag: 0,
        rows: [row('5', 0, { toolErrors: null, toolResultsWithFlag: 0 })],
      },
    });
    expect(census?.toolErrors).toBeNull();
    expect(turnCensusLine(census)).toContain('tool errors not observable');
  });

  it('drops a row that is not a row instead of zero-filling it', () => {
    expect(turnEpisodeOf({ task: '5' })).toBeUndefined();
    expect(turnEpisodeOf(null)).toBeUndefined();
    const census = censusOf([row('5', 0), { task: '9', trial: 0 }]);
    // `measurable` follows the rows that survived: a row missing its counts joins the pair as an episode on
    // which neither arm did anything, which is a measurement nobody made.
    expect(census?.rows).toHaveLength(1);
    expect(census?.measurable).toBe(1);
  });

  it('keeps a null error count from a row that had one', () => {
    const parsed = turnEpisodeOf(row('5', 0, { toolErrors: null, toolResultsWithFlag: 0 }));
    expect(parsed?.toolErrors).toBeNull();
    expect(parsed?.toolResultsWithFlag).toBe(0);
  });

  it('reads the artefact-side block as well as the diagnostics-side one', () => {
    const block = { episodes: 1, measurable: 1, toolErrors: 0, toolResultsWithFlag: 3, rows: [row('5', 0)] };
    expect(turnCensusOfBlock(block)?.toolErrors).toBe(0);
    expect(turnCensusOf({ turnCensus: block })?.rows).toHaveLength(1);
    expect(turnCensusOfBlock(undefined)).toBeUndefined();
  });
});

describe('a count of rare events has a Poisson interval, and zero is not certainty', () => {
  it('gives an empty arm an upper bound rather than a point', () => {
    const [low, high] = poissonInterval(0);
    expect(low).toBe(0);
    // −ln(0.025) = 3.689. An arm with no tool errors is consistent with 3.7 per phase, which is the
    // sentence that stops a zero from becoming a claim about safety.
    expect(high).toBeCloseTo(3.689, 3);
  });

  it('is symmetric around a count and never negative', () => {
    const [low, high] = poissonInterval(100);
    expect(low).toBeCloseTo(80.4, 1);
    expect(high).toBeCloseTo(119.6, 1);
    expect(poissonInterval(1)[0]).toBe(0);
    expect(poissonInterval(Number.NaN)).toEqual([0, 0]);
    expect(poissonInterval(-3)).toEqual([0, 0]);
  });
});

describe('the pair joins by episode, not by position', () => {
  it('pairs the same (task, trial) and drops what only one arm measured', () => {
    const memory = censusOf([row('5', 0, { toolErrors: 2 }), row('5', 1, { toolErrors: 0 }), row('9', 0)]);
    const control = censusOf([row('9', 0, { toolErrors: 1 }), row('5', 1, { toolErrors: 1 })]);
    const reading = pairedTurnCount('toolErrors', memory, control);
    // Two pairs: `5#1` and `9#0`. `5#0` has no control row, and pairing it by position would have taken
    // `9#0`'s control count as its own.
    expect(reading?.episodes).toBe(2);
    expect(reading?.memory).toBe(0 + 1);
    expect(reading?.control).toBe(1 + 1);
    expect(reading?.meanDelta).toBeCloseTo((0 - 1 + 1 - 1) / 2, 6);
  });

  it('refuses to grade separation when one side never counted', () => {
    const memory = censusOf([row('5', 0)], { toolErrors: null });
    const control = censusOf([row('5', 0, { toolErrors: 1 })]);
    expect(pairedTurnCount('toolErrors', memory, control)?.separated).toBeNull();
    // The row-level `null` also keeps the episode out of the pair: an unmeasured count is not a zero.
    const both = { ...memory, rows: [row('5', 0, { toolErrors: null })] } as TurnCensus;
    expect(pairedTurnCount('toolErrors', both, control)?.episodes).toBe(0);
  });

  it('says separated only when the two Poisson intervals are disjoint', () => {
    const wide = censusOf([row('5', 0, { repeatCalls: 3 })]);
    const same = censusOf([row('5', 0, { repeatCalls: 3 })]);
    expect(pairedTurnCount('repeatCalls', wide, same)?.separated).toBe(false);
    const many = (value: number) =>
      censusOf([
        row('5', 0, { repeatCalls: value }),
        row('5', 1, { repeatCalls: 0 }),
        row('9', 0, { repeatCalls: 0 }),
      ]);
    // 100 against 0 over the same episodes: 0's upper bound is 3.69 and 100's lower is 80.4.
    expect(pairedTurnCount('repeatCalls', many(100), many(0))?.separated).toBe(true);
  });

  it('needs two pairs before it will quote an interval', () => {
    const one = censusOf([row('5', 0)]);
    expect(pairedTurnCount('toolErrors', one, censusOf([row('5', 0)]))?.deltaInterval).toBeNull();
    const two = censusOf([row('5', 0), row('5', 1)]);
    expect(pairedTurnCount('toolErrors', two, censusOf([row('5', 0), row('5', 1)]))?.deltaInterval).not.toBeNull();
  });

  it('reads both measures a registration can name', () => {
    const readings = pairedTurns(censusOf([row('5', 0)]), censusOf([row('5', 0)]));
    expect(readings.map((reading) => reading.measure)).toEqual(['toolErrors', 'repeatCalls']);
    expect(pairedTurns(undefined, censusOf([row('5', 0)]))).toEqual([]);
    expect(pairedTurnLine([])).toContain('neither arm carried a census');
  });

  it('renders a pair with its verdict and its per-episode delta', () => {
    const memory = censusOf([row('5', 0, { toolErrors: 2 }), row('5', 1, { toolErrors: 0 })]);
    const control = censusOf([row('5', 0, { toolErrors: 0 }), row('5', 1, { toolErrors: 0 })]);
    const line = pairedTurnLine(pairedTurns(memory, control));
    expect(line).toContain('toolErrors 2 vs 0 over 2 pair(s)');
    expect(line).toContain('+1.000 per episode');
    expect(line).toContain('not separated');
  });
});

describe('the reader names the episode the way the join needs it', () => {
  it('keys a task and trial, so two trials of one task are two episodes', () => {
    expect(episodeKey({ task: '5', trial: 0 })).toBe('5#0');
    expect(episodeKey({ task: '5', trial: 1 })).not.toBe(episodeKey({ task: '5', trial: 0 }));
    // Retail task ids are numeric strings; `String()` keeps `5` and `'5'` the same key rather than two.
    expect(episodeKey({ task: '5', trial: 0 })).toBe(episodeKey({ task: 5 as unknown as string, trial: 0 }));
  });
});

describe('the census line carries its own denominator', () => {
  it('prints the flagged results beside the error count', () => {
    const line = turnCensusLine(censusOf([row('5', 0)]));
    expect(line).toContain('1 of 1 episode(s)');
    expect(line).toContain('6 assistant turn(s)');
    expect(line).toContain('1 tool error(s) of 5 flagged result(s)');
    expect(line).toContain('3 user turn(s) after an action, 1 after an error');
  });

  it('names the calls it could not read rather than calling them repeats', () => {
    const line = turnCensusLine(censusOf([row('5', 0)], { repeatCalls: 2, callsWithoutArguments: 4 }));
    expect(line).toContain('2 repeated, 4 unreadable');
  });
});

// AUDIT 34.154's check, for R125's reader. `turns.py` writes the block and this file reads it, in two
// languages; if the Python side renames `toolErrors` the line silently loses the count and every local gate
// stays green. The payload below is the one the driver ships, produced by the reader the driver runs.
describe('the two languages agree on the shape of the census', () => {
  const episodes = [
    {
      task_id: '5',
      trial: 0,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', tool_calls: [{ name: 'get_order', arguments: { id: 1 } }] },
        { role: 'tool', error: true, content: 'no such order' },
        { role: 'user', content: 'try the other id' },
        { role: 'assistant', tool_calls: [{ name: 'get_order', arguments: { id: 1 } }] },
        { role: 'tool', error: false, content: 'ok' },
      ],
    },
  ];
  const dumped = spawnSync('python3', ['eval/drivers/tau2/selfcheck_agent.py', '--parse-turns'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: JSON.stringify(episodes),
  });
  const available = dumped.status === 0 && dumped.stdout.trim() !== '';

  it.skipIf(!available)('writes every field this reader reads', () => {
    const block = JSON.parse(dumped.stdout) as Record<string, unknown>;
    expect(Object.keys(block).sort()).toEqual(
      [
        'assistant',
        'callsWithoutArguments',
        'episodes',
        'measurable',
        'repeatCalls',
        'rows',
        'toolCalls',
        'toolErrors',
        'toolResults',
        'toolResultsWithFlag',
        'userAfterAction',
        'userAfterError',
      ],
    );
    // And the row's keys, which are the ones the pair joins on and the ones a rename would break silently.
    const rows = block['rows'] as readonly Record<string, unknown>[];
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      [
        'assistant',
        'callsWithoutArguments',
        'repeatCalls',
        'task',
        'toolCalls',
        'toolErrors',
        'toolResults',
        'toolResultsWithFlag',
        'trial',
        'user',
        'userAfterAction',
        'userAfterError',
      ],
    );
  });

  it.skipIf(!available)('counts what the trajectory shows, through the reader the driver runs', () => {
    const block = turnCensusOfBlock(JSON.parse(dumped.stdout));
    // One episode, two assistant turns, two calls of which the second repeats the first, one tool result
    // in error, one user turn in reaction to it, and one user turn after the error — the four facts a
    // task-level score cannot see.
    expect(block?.episodes).toBe(1);
    expect(block?.measurable).toBe(1);
    expect(block?.assistant).toBe(2);
    expect(block?.toolCalls).toBe(2);
    expect(block?.repeatCalls).toBe(1);
    expect(block?.toolResults).toBe(2);
    expect(block?.toolResultsWithFlag).toBe(2);
    expect(block?.toolErrors).toBe(1);
    expect(block?.userAfterAction).toBe(1);
    expect(block?.userAfterError).toBe(1);
  });

  it.skipIf(!available)('treats an unreadable argument as unreadable, not as a repeat', () => {
    const blind = spawnSync('python3', ['eval/drivers/tau2/selfcheck_agent.py', '--parse-turns'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: JSON.stringify([
        {
          task_id: '9',
          trial: 0,
          messages: [
            { role: 'assistant', tool_calls: [{ name: 'get_order' }, { name: 'get_order' }] },
            { role: 'assistant', tool_calls: [{ name: 'get_order', arguments: 'a' }, { name: 'get_order', arguments: 'a' }] },
          ],
        },
      ]),
    });
    expect(blind.status).toBe(0);
    const block = turnCensusOfBlock(JSON.parse(blind.stdout));
    // Two calls with no payload: excluded and counted. Two with the same payload: one repeat.
    expect(block?.callsWithoutArguments).toBe(2);
    expect(block?.repeatCalls).toBe(1);
    // No tool result at all, so the error count is unmeasured rather than zero.
    expect(block?.toolErrors).toBeNull();
    expect(block?.toolResultsWithFlag).toBe(0);
  });
});

describe('the branches a malformed payload can reach', () => {
  it('defaults the fields a row may omit, and stringifies a numeric task id', () => {
    // τ² serialises `task_id` as a string; a release that sent a number would otherwise produce a join key
    // that never matches, and the pair would silently be empty rather than wrong.
    const parsed = turnEpisodeOf({ task: 5, assistant: 1, user: 1, toolCalls: 0 });
    expect(parsed).toEqual({
      task: '5',
      trial: 0,
      assistant: 1,
      user: 1,
      userAfterAction: 0,
      userAfterError: 0,
      toolCalls: 0,
      toolResults: 0,
      toolResultsWithFlag: 0,
      toolErrors: null,
      repeatCalls: 0,
      callsWithoutArguments: 0,
    });
    // `task` absent entirely: an empty key rather than `undefined` inside a string.
    expect(turnEpisodeOf({ assistant: 1, user: 0, toolCalls: 0 })?.task).toBe('');
  });

  it('reads a block whose rows are not a list as a block with no rows', () => {
    const block = turnCensusOfBlock({ episodes: 3, rows: 'not a list' });
    expect(block?.episodes).toBe(3);
    expect(block?.measurable).toBe(0);
    expect(block?.toolErrors).toBeNull();
    // And a non-object block is absent, not empty.
    expect(turnCensusOfBlock('nope')).toBeUndefined();
  });

  it('counts only the rows it could read, whatever the block claims it measured', () => {
    // The block's own `measurable` is not trusted: a list holding one unreadable row would otherwise make
    // the pair join on a row that has no episode key, and the count would exceed the table it describes.
    const block = turnCensusOfBlock({
      episodes: 3,
      measurable: 3,
      rows: [{}, 'not a row', { task: '5', assistant: 1, user: 1, toolCalls: 1 }],
    });
    expect(block?.episodes).toBe(3);
    expect(block?.measurable).toBe(1);
    // A block that states no episode count at all is zero rather than `undefined` in an arithmetic field.
    expect(turnCensusOfBlock({ rows: [] })?.episodes).toBe(0);
  });

  it('prints a verdict for a reading that could not be graded, and one with no pairs', () => {
    const line = pairedTurnLine([
      {
        measure: 'toolErrors',
        episodes: 0,
        memory: 0,
        control: 0,
        memoryInterval: null,
        controlInterval: null,
        separated: null,
        meanDelta: null,
        deltaInterval: null,
      },
    ]);
    expect(line).toContain('no pairs');
    expect(line).toContain('(unmeasured on one side)');
  });

  it('leaves the interval absent on the side that measured nothing', () => {
    // An interval over zero episodes is not a wide interval, it is no interval, and a reading that filled it
    // with `[0, 0]` would separate against every arm it was compared with.
    const blind = turnCensusOf({ turnCensus: { episodes: 4, measurable: 0, rows: [] } });
    const measured = censusOf([row('5', 0), row('5', 1)]);
    const memoryBlind = pairedTurnCount('toolErrors', blind, measured);
    expect(memoryBlind?.memoryInterval).toBeNull();
    expect(memoryBlind?.controlInterval).not.toBeNull();
    expect(memoryBlind?.separated).toBeNull();
    // And the other side, because an interval that only ever goes missing on one arm would be a bug a
    // single-direction case cannot see.
    const controlBlind = pairedTurnCount('toolErrors', measured, blind);
    expect(controlBlind?.memoryInterval).not.toBeNull();
    expect(controlBlind?.controlInterval).toBeNull();
    expect(controlBlind?.separated).toBeNull();
  });

  it('prints a negative delta without a plus sign, so a direction is legible at a glance', () => {
    const memory = censusOf([row('5', 0, { repeatCalls: 0 }), row('5', 1, { repeatCalls: 0 })]);
    const control = censusOf([row('5', 0, { repeatCalls: 4 }), row('5', 1, { repeatCalls: 4 })]);
    expect(pairedTurnLine(pairedTurns(memory, control))).toContain('-4.000 per episode');
  });

  it('says which side of the verdict a separated reading is on', () => {
    // A difference the intervals do not overlap is a different sentence from one they do, and this line is
    // the only place the artefact carries the difference: 40 pairs at 0 against 40 at 8 is the smallest
    // arrangement that separates, so the word appears exactly where the arithmetic earns it.
    const episodes = 40;
    const rows = Array.from({ length: episodes }, (_, index) => index);
    const memory = censusOf(rows.map((index) => row('5', index, { repeatCalls: 0 })));
    const control = censusOf(rows.map((index) => row('5', index, { repeatCalls: 8 })));
    const line = pairedTurnLine(pairedTurns(memory, control));
    expect(line).toContain('-8.000 per episode');
    expect(line).toContain('(separated)');
  });
});
