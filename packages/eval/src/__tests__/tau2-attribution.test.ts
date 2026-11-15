/**
 * The join, tested on the shape R123a actually produced.
 *
 * The defect this file is written against is not arithmetic — it is the assumption that requests and
 * episodes can be joined by position. `recall` fires once per episode, so the counts are nearly equal
 * (164 over 160) and a positional join agrees with the truth on the first 160 rows and disagrees on the
 * rest, silently. The fixtures below therefore include the double-recall episode, because a join that is
 * only tested on one-request-per-episode is a join that has never been tested.
 */
import { describe, expect, it } from 'vitest';
import {
  boundaryDefect,
  boundaryJoin,
  boundaryLine,
  boundarySpan,
  boundaryTasksOf,
  episodeStartsOf,
  itemTransfer,
  itemTransferLine,
  pairAttribution,
  pairedEpisodes,
  serveSplit,
  serveSplitLine,
  taskKey,
} from '../tau2-attribution.js';

describe('attributing a trial to the claims it was served', () => {
  it('splits the ledger at the boundaries the agent recorded', () => {
    const result = itemTransfer({
      episodes: [
        { startsAt: 0, memory: true, control: false },
        { startsAt: 1, memory: false, control: true },
      ],
      ledger: [['k_a', 'k_b'], ['k_a']],
    });
    // `k_a` was served into both episodes and split one win and one loss, which is a net of zero and not a
    // removal candidate; `k_b` was only present when the memory won.
    expect(result.items).toEqual([
      { id: 'k_a', episodes: 2, kept: 1, broke: 1, net: 0 },
      { id: 'k_b', episodes: 1, kept: 1, broke: 0, net: 1 },
    ]);
    expect(result.unmatchedRequests).toBe(0);
  });

  it('gives a double-recall episode both of its requests and the next episode none of them', () => {
    // The exact shape of the gap: 164 requests, 160 episodes, and the four extras inside an episode. A
    // positional join would attribute request 2 to episode 2 here; the boundary says it is episode 0's.
    const result = itemTransfer({
      episodes: [
        { startsAt: 0, memory: false, control: true },
        { startsAt: 2, memory: true, control: false },
      ],
      ledger: [['k_a'], ['k_b'], ['k_c']],
    });
    expect(result.items).toEqual([
      { id: 'k_a', episodes: 1, kept: 0, broke: 1, net: -1 },
      { id: 'k_b', episodes: 1, kept: 0, broke: 1, net: -1 },
      { id: 'k_c', episodes: 1, kept: 1, broke: 0, net: 1 },
    ]);
  });

  it('counts one episode once for a claim served twice into it', () => {
    // A long trajectory renders the same claim on several turns. Weighting it by renders would make a
    // verbose episode's claims look better attested than a short one's, which is a property of the
    // renderer rather than of the store.
    const result = itemTransfer({
      episodes: [{ startsAt: 0, memory: true, control: false }],
      ledger: [['k_a'], ['k_a'], ['k_a']],
    });
    expect(result.items).toEqual([{ id: 'k_a', episodes: 1, kept: 1, broke: 0, net: 1 }]);
  });

  it('orders the worst claim first, with ties broken by id so two readbacks diff', () => {
    const result = itemTransfer({
      episodes: [
        { startsAt: 0, memory: false, control: true },
        { startsAt: 1, memory: false, control: true },
      ],
      ledger: [['k_z', 'k_b'], ['k_z', 'k_a']],
    });
    expect(result.items.map((item) => item.id)).toEqual(['k_z', 'k_a', 'k_b']);
  });

  it('reports a ledger with no episodes as unattributed rather than as a clean store', () => {
    const result = itemTransfer({ episodes: [], ledger: [['k_a'], ['k_b']] });
    expect(result.items).toEqual([]);
    expect(result.unmatchedRequests).toBe(2);
  });

  it('skips a repeated boundary instead of inventing an empty episode', () => {
    // A recall that returned without a request leaves the index unchanged, which is legal. The second
    // episode covers the tail, and the first spends nothing.
    const result = itemTransfer({
      episodes: [
        { startsAt: 0, memory: true, control: false },
        { startsAt: 0, memory: true, control: false },
        { startsAt: 1, memory: false, control: true },
      ],
      ledger: [['k_a'], ['k_b']],
    });
    expect(result.items).toEqual([
      { id: 'k_b', episodes: 1, kept: 0, broke: 1, net: -1 },
      { id: 'k_a', episodes: 1, kept: 1, broke: 0, net: 1 },
    ]);
  });
});

describe('the line a run prints about it', () => {
  it('names the three worst claims, because a total leaves the next round where this one started', () => {
    const line = itemTransferLine(
      {
        items: [
          { id: 'k_1', episodes: 3, kept: 0, broke: 3, net: -3 },
          { id: 'k_2', episodes: 2, kept: 0, broke: 2, net: -2 },
          { id: 'k_3', episodes: 4, kept: 1, broke: 3, net: -2 },
          { id: 'k_4', episodes: 2, kept: 2, broke: 0, net: 2 },
        ],
        unmatchedRequests: 0,
      },
      { top: 2 },
    );
    expect(line).toContain('4 item(s) over 11 served episode(s)');
    expect(line).toContain('3 with a negative net, 1 positive');
    expect(line).toContain('worst k_1 -3 of 3, k_2 -2 of 2');
  });

  it('says nothing can be attributed when nothing was served into a measured episode', () => {
    expect(itemTransferLine({ items: [], unmatchedRequests: 4 })).toContain('nothing can be attributed');
  });

  it('distinguishes a store with no harmful claim from a store with no claims', () => {
    const line = itemTransferLine({
      items: [{ id: 'k_1', episodes: 2, kept: 2, broke: 0, net: 2 }],
      unmatchedRequests: 0,
    });
    expect(line).toContain('1 item(s) over 2 served episode(s)');
    expect(line).toContain('0 with a negative net, 1 positive');
    expect(line).toContain('no claim was served into more trials than it broke');
  });
});

describe('pairing two arms into episodes', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('pairs by task and trial, not by position', () => {
    const episodes = pairedEpisodes({
      referenceTrials: [row('a', 0, 1), row('a', 1, 0)],
      memoryTrials: [row('a', 1, 1), row('a', 0, 0)],
      episodeStarts: [0, 1],
    });
    // The memory arm's first row is task `a`'s second trial, and it is paired with the reference's second
    // trial. A positional join would compare it against trial 0 and invert both readings.
    expect(episodes).toEqual([
      { startsAt: 0, memory: true, control: false },
      { startsAt: 1, memory: false, control: true },
    ]);
  });

  it('declines a boundary count that disagrees with the trial count', () => {
    expect(
      pairedEpisodes({
        referenceTrials: [row('a', 0, 1)],
        memoryTrials: [row('a', 0, 1), row('a', 1, 1)],
        episodeStarts: [0],
      }),
    ).toBeUndefined();
  });

  it('drops a trial either side declined to score, rather than calling it a failure', () => {
    const episodes = pairedEpisodes({
      referenceTrials: [row('a', 0, null), row('a', 1, 1), row('b', 0, 0)],
      memoryTrials: [row('a', 0, 1), row('a', 1, null), row('b', 0, 1)],
      episodeStarts: [0, 1, 2],
    });
    expect(episodes).toEqual([{ startsAt: 2, memory: true, control: false }]);
  });

  it('drops a trial the other arm never ran', () => {
    const episodes = pairedEpisodes({
      referenceTrials: [row('a', 0, 1)],
      memoryTrials: [row('a', 0, 1), row('z', 0, 0)],
      episodeStarts: [0, 1],
    });
    expect(episodes).toEqual([{ startsAt: 0, memory: true, control: true }]);
  });
});

describe('reading the three fields off an artefact', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('declines each missing field rather than reporting an empty store', () => {
    // The three ways an artefact can predate the instrument. Every one of them must be `undefined`, because
    // an empty table reads as "no claim was served into a measured trial" and the truth is "this run could
    // not say" — the distinction R123a cost a dispatch to learn.
    expect(pairAttribution({ episodeStarts: [0], memoryTrials: [row('a', 0, 1)] })).toBeUndefined();
    expect(pairAttribution({ ledger: [['k']], memoryTrials: [row('a', 0, 1)] })).toBeUndefined();
    expect(pairAttribution({ ledger: [['k']], episodeStarts: [0] })).toBeUndefined();
  });

  it('produces the table when all three are present', () => {
    const reading = pairAttribution({
      ledger: [['k_1']],
      episodeStarts: [0],
      memoryTrials: [row('a', 0, 0)],
      referenceTrials: [row('a', 0, 1)],
    });
    expect(reading).toEqual({ items: [{ id: 'k_1', episodes: 1, kept: 0, broke: 1, net: -1 }], unmatchedRequests: 0 });
  });

  it('treats a memory arm with no reference rows as unpaired rather than as all losses', () => {
    const reading = pairAttribution({
      ledger: [['k_1']],
      episodeStarts: [0],
      memoryTrials: [row('a', 0, 0)],
    });
    // The request is counted as unattributed rather than attributed to a loss: with no control row there is
    // no outcome to pair, and the one served request belongs to an episode that was never measured.
    expect(reading).toEqual({ items: [], unmatchedRequests: 1 });
  });
});

describe('what the gate did to the trials it withheld from', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  // R123's mechanism check, and the fixture is the shape the lane produces: four requests over four episodes,
  // so the boundary is `[0, 1, 2, 3]` and each episode owns one request. An empty ledger entry is a refusal —
  // `buildPack` returns no ids — and that is the only signal the artefact carries.
  it('splits one arm by whether a pack reached the episode', () => {
    const reading = serveSplit({
      ledger: [['k_1'], [], ['k_2'], ['k_3']],
      episodeStarts: [0, 1, 2, 3],
      memoryTrials: [row('a', 0, 1), row('b', 0, 0), row('c', 0, 1), row('d', 0, 1)],
    });
    expect(reading).toEqual({
      measured: { served: { episodes: 3, passed: 3 }, withheld: { episodes: 1, passed: 0 } },
    });
  });

  // The boundary is an *index*, so an episode's range is half-open and can span requests. This is the case a
  // positional join gets wrong and the case R123's writer produced by accident: two requests, one episode.
  it('counts an episode as served when any request in its range carried a pack', () => {
    const reading = serveSplit({
      ledger: [[], ['k_1'], ['k_2']],
      episodeStarts: [0, 2],
      memoryTrials: [row('a', 0, 1), row('b', 0, 0)],
    });
    // Episode `a` owns requests 0 and 1: refused, then served. A join that read only the episode's first
    // request would call it withheld and understate the gate's reach by half; it is served, and it passed.
    // Episode `b` owns request 2, which was served, and it failed.
    expect(reading).toEqual({
      measured: { served: { episodes: 2, passed: 1 }, withheld: { episodes: 0, passed: 0 } },
    });
  });

  // R123's actual defect, and the reason this function can no longer answer with `undefined`. Its phase
  // recorded one boundary per *request* — `[0, 1, ..., 161]` over 160 episodes — so the array was a position,
  // not a partition. A joiner that accepted it would have called every request an episode, and every gate
  // decision would have been attributed to a trial of its own.
  it('refuses a boundary that repeats or decreases, and says which entry', () => {
    const reading = serveSplit({
      ledger: [['k'], ['k'], ['k']],
      episodeStarts: [0, 0, 2],
      memoryTrials: [row('a', 0, 1), row('b', 0, 1), row('c', 0, 1)],
    });
    expect(reading).toMatchObject({ absent: 'boundary-disagrees' });
    if ('absent' in reading) expect(reading.detail).toContain('repeats or decreases at entry 1');
  });

  it('names the absent reason rather than returning nothing, for each of the three ways it can fail', () => {
    const three = [
      serveSplit({ memoryTrials: [row('a', 0, 1)] }),
      serveSplit({ ledger: [['k']], memoryTrials: [row('a', 0, 1)] }),
      serveSplit({ ledger: [['k'], ['k']], episodeStarts: [0], memoryTrials: [row('a', 0, 1), row('b', 0, 1)] }),
    ];
    expect(three.map((reading) => ('absent' in reading ? reading.absent : 'measured'))).toEqual([
      'no-ledger',
      'no-boundary',
      'boundary-disagrees',
    ]);
    // And a boundary that starts past the ledger is the fourth shape, reported with both numbers.
    const past = serveSplit({
      ledger: [['k']],
      episodeStarts: [0, 3],
      memoryTrials: [row('a', 0, 1), row('b', 0, 1)],
    });
    expect(past).toMatchObject({ absent: 'boundary-disagrees' });
    if ('absent' in past) expect(past.detail).toContain('request 3 of 1');
  });

  it('keeps an unscored episode out of both rates', () => {
    const reading = serveSplit({
      ledger: [['k_1'], []],
      episodeStarts: [0, 1],
      memoryTrials: [row('a', 0, null), row('b', 0, 1)],
    });
    expect(reading).toEqual({ measured: { served: { episodes: 0, passed: 0 }, withheld: { episodes: 1, passed: 1 } } });
  });

  it('prints both rates with their intervals, and prints the absence instead of printing nothing', () => {
    const line = serveSplitLine({
      measured: { served: { episodes: 100, passed: 90 }, withheld: { episodes: 40, passed: 30 } },
    });
    expect(line).toContain('served 90 of 100 = 90.00%');
    expect(line).toContain('withheld 30 of 40 = 75.00%');
    // Wilson, not Wald: 40 episodes is small enough that the two disagree at the edge.
    expect(line).toMatch(/\[\d+\.\d, \d+\.\d\]/);
    const empty = serveSplitLine({ measured: { served: { episodes: 0, passed: 0 }, withheld: { episodes: 0, passed: 0 } } });
    expect(empty).toContain('served none measured');
    // The sentence R123 needed and did not get: a run whose registered mechanism check could not be computed.
    const absent = serveSplitLine({ absent: 'no-boundary', detail: '162 request(s) with no episode boundary' });
    expect(absent).toContain('not measured (no-boundary)');
    expect(absent).toContain('162 request(s) with no episode boundary');
  });

  // The shape R123 actually recorded, with its own numbers: 162 boundaries (`[0..161]`), 162 ledger entries,
  // 160 trials. Not a hypothetical — this is the field the phase wrote, and the reader that printed nothing has
  // to be able to name it, because the next round's reader will meet the same shape in any artefact written
  // before the repair.
  it('refuses the exact shape R123 recorded, and reports both counts', () => {
    const reading = serveSplit({
      ledger: Array.from({ length: 162 }, () => ['k']),
      episodeStarts: Array.from({ length: 162 }, (_, index) => index),
      memoryTrials: Array.from({ length: 160 }, (_, index) => row(`t${String(index)}`, 0, 1)),
    });
    expect(reading).toMatchObject({ absent: 'boundary-disagrees' });
    if ('absent' in reading) expect(reading.detail).toContain('162 boundar(ies) against 160 trial row(s)');
    // And the sentence the log would have carried, which is what R123's run did not print.
    expect(serveSplitLine(reading)).toContain('not measured (boundary-disagrees)');
  });

  // R131's registered self-check, in miniature: with no gate every request is served, so every episode is in
  // the served bucket and the split's rate must equal the arm's own episode rate. A split that reports anything
  // else has mis-assigned requests, and on an ungated arm there is no other explanation available.
  it('reproduces the arm rate when nothing was withheld', () => {
    const trials = Array.from({ length: 160 }, (_, index) => row(`t${String(index)}`, 0, index % 4 === 0 ? 0 : 1));
    const reading = serveSplit({
      ledger: Array.from({ length: 162 }, () => ['k']),
      // Two episodes spent two requests, which is the shape a real phase produces: 162 requests, 160 episodes.
      episodeStarts: [...Array.from({ length: 159 }, (_, index) => index), 160],
      memoryTrials: trials,
    });
    expect(reading).toMatchObject({ measured: { withheld: { episodes: 0, passed: 0 } } });
    if ('measured' in reading) {
      expect(reading.measured.served.episodes).toBe(160);
      // 120 of the 160 trials passed, which is 0.75 — the same number the arm would report.
      expect(reading.measured.served.passed).toBe(120);
    }
  });

  it('reads the boundary off a sidecar block, and drops one that is not a list of indices', () => {
    expect(episodeStartsOf({ episodeStarts: [0, 3, 7] })).toEqual([0, 3, 7]);
    expect(episodeStartsOf({ episodeStarts: [] })).toBeUndefined();
    expect(episodeStartsOf({ episodeStarts: [0, -1] })).toBeUndefined();
    expect(episodeStartsOf({ episodeStarts: [0, 1.5] })).toBeUndefined();
    expect(episodeStartsOf({ episodeStarts: 'nope' })).toBeUndefined();
    expect(episodeStartsOf(undefined)).toBeUndefined();
    expect(episodeStartsOf(null)).toBeUndefined();
  });
});

/**
 * R136 — the join by identity, on the shape R135 actually produced.
 *
 * R135 opened 41 boundaries for 40 scored episodes: one task was simulated twice, `serve split` printed
 * `boundary-disagrees`, and the arm's registered mechanism check was lost to a count. The fixtures below are
 * that shape, because a join tested only on one-boundary-per-task is a join that has never been tested — the
 * same reason the earlier describe block is built on the double-recall episode.
 */
describe('joining a boundary to the task it opened for', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('reads the task list off a sidecar block and drops one that is not a list of names', () => {
    expect(boundaryTasksOf({ boundaryTasks: ['a', null, 'b'] })).toEqual(['a', null, 'b']);
    expect(boundaryTasksOf({ boundaryTasks: [] })).toBeUndefined();
    expect(boundaryTasksOf({ boundaryTasks: ['a', ''] })).toBeUndefined();
    expect(boundaryTasksOf({ boundaryTasks: ['a', 3] })).toBeUndefined();
    expect(boundaryTasksOf({ boundaryTasks: 'a' })).toBeUndefined();
    expect(boundaryTasksOf(undefined)).toBeUndefined();
    expect(boundaryTasksOf(null)).toBeUndefined();
  });

  it('compares a task id with or without the domain prefix', () => {
    // `per_task` names the task `retail/5` and the runner's boundary names it `5`. A join that compared the
    // two strings as written would resolve nothing and call the instrument broken.
    expect(taskKey('retail/5')).toBe('5');
    expect(taskKey('5')).toBe('5');
    expect(taskKey('a/b/c')).toBe('c');
  });

  it('names the task a repeated boundary belongs to instead of refusing on the count', () => {
    const join = boundaryJoin({
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', 'b', 'a'],
      memoryTrials: [row('retail/a', 0, 1), row('retail/b', 0, 0)],
    });
    // Two groups for three boundaries: `a` opened twice, `b` once.
    expect(join).toMatchObject({
      measured: [
        { task: 'a', boundaries: [0, 2], trial: 0 },
        { task: 'b', boundaries: [1], trial: 1 },
      ],
      retried: [{ task: 'a', boundaries: [0, 2], trial: 0 }],
      unresolved: 0,
    });
  });

  it('declines each way the two lists can fail to be a join', () => {
    // Absent, positional-but-shorter, and a name the arm never scored. Each is a different repair: run the
    // instrument, fix the writer, or find the artefact that was labelled with the wrong task.
    expect(boundaryJoin({ memoryTrials: [row('a', 0, 1)], boundaryTasks: ['a'] })).toMatchObject({
      absent: 'no-boundary',
    });
    expect(
      boundaryJoin({ episodeStarts: [0], memoryTrials: [row('a', 0, 1)] }),
    ).toMatchObject({ absent: 'no-tasks' });
    expect(
      boundaryJoin({
        episodeStarts: [0, 2],
        boundaryTasks: ['a'],
        memoryTrials: [row('a', 0, 1)],
      }),
    ).toMatchObject({ absent: 'length-disagrees' });
    const orphaned = boundaryJoin({
      episodeStarts: [0, 2],
      boundaryTasks: ['a', 'zzz'],
      memoryTrials: [row('a', 0, 1)],
    });
    // One resolvable task and one orphan: measured, with the orphan counted rather than dropped into `a`.
    expect(orphaned).toMatchObject({ unresolved: 1 });
    const allOrphaned = boundaryJoin({
      episodeStarts: [0, 2],
      boundaryTasks: ['yyy', 'zzz'],
      memoryTrials: [row('a', 0, 1)],
    });
    expect(allOrphaned).toMatchObject({ absent: 'unknown-task' });
  });

  it('prints the count, the repeats and the unresolved boundaries in one line', () => {
    expect(
      boundaryLine(
        boundaryJoin({
          episodeStarts: [0, 2, 4],
          boundaryTasks: ['a', 'b', 'a'],
          memoryTrials: [row('a', 0, 1), row('b', 0, 0)],
        }),
      ),
    ).toBe('boundary: 3 boundar(ies) for 2 task(s); repeated a 2');
    expect(
      boundaryLine(
        boundaryJoin({
          episodeStarts: [0, 1],
          boundaryTasks: ['a', 'b'],
          memoryTrials: [row('a', 0, 1), row('b', 0, 0)],
        }),
      ),
    ).toBe('boundary: 2 boundar(ies) for 2 task(s), none repeated');
    expect(
      boundaryLine(
        boundaryJoin({
          episodeStarts: [0, 2],
          boundaryTasks: ['a', 'zzz'],
          memoryTrials: [row('a', 0, 1)],
        }),
      ),
    ).toBe('boundary: 1 boundar(ies) for 1 task(s), none repeated; 1 unresolved');
    expect(boundaryLine({ absent: 'no-tasks', detail: 'nothing named' })).toContain('not joined (no-tasks)');
  });

  it('splits a 41-boundary arm into the 40 trials it scored', () => {
    // The exact shape that cost R135 its mechanism reading: five requests, three boundaries, two tasks, and
    // the first task's second boundary sitting *after* the second task's. `a` was served in its first
    // boundary and refused in its retry, so it counts once, as served; `b` was refused throughout.
    const split = serveSplit({
      ledger: [['k'], [], [], [], []],
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', 'b', 'a'],
      memoryTrials: [row('retail/a', 0, 0), row('retail/b', 0, 1)],
    });
    expect(split).toEqual({
      measured: { served: { episodes: 1, passed: 0 }, withheld: { episodes: 1, passed: 1 } },
    });
  });

  it('refuses a named boundary that resolves to no task rather than falling back to position', () => {
    // The fallback would be the join this instrument replaces, wearing its name. `b` was never scored, so
    // the requests it opened belong to no trial and the split says so.
    const split = serveSplit({
      ledger: [['k'], ['k'], ['k']],
      episodeStarts: [0, 1, 2],
      boundaryTasks: ['a', 'b', 'c'],
      memoryTrials: [row('a', 0, 1), row('b', 0, 1)],
    });
    expect(split).toMatchObject({ absent: 'tasks-unresolved' });
    if ('absent' in split) expect(split.detail).toContain('1 of 3');
    expect(serveSplitLine(split)).toContain('not measured (tasks-unresolved)');
  });

  it('still refuses the count when the arm names no tasks at all', () => {
    // The pre-R136 behaviour, kept and tested: without identity a 3-versus-2 pair is a refusal, because a
    // positional join would report a number rather than a defect.
    const split = serveSplit({
      ledger: [['k'], [], [], [], []],
      episodeStarts: [0, 2, 4],
      memoryTrials: [row('a', 0, 0), row('b', 0, 1)],
    });
    expect(split).toMatchObject({ absent: 'boundary-disagrees' });
    if ('absent' in split) expect(split.detail).toContain('3 boundar(ies) against 2 trial row(s)');
  });

  it('reports the joins own refusal through the split rather than swallowing it', () => {
    const split = serveSplit({
      ledger: [['k'], []],
      episodeStarts: [0, 1],
      boundaryTasks: ['a'],
      memoryTrials: [row('a', 0, 1), row('b', 0, 1)],
    });
    expect(split).toMatchObject({ absent: 'boundary-disagrees' });
    if ('absent' in split) expect(split.detail).toContain('task name(s)');
  });
});

describe('pairing a repeated task into one episode with two ranges', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('gives one episode both of its boundaries and no episode its neighbours', () => {
    const episodes = pairedEpisodes({
      referenceTrials: [row('a', 0, 1), row('b', 0, 0)],
      memoryTrials: [row('a', 0, 0), row('b', 0, 1)],
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', 'b', 'a'],
      ledgerLength: 5,
    });
    expect(episodes).toEqual([
      { startsAt: 0, spans: [[0, 2], [4, 5]], memory: false, control: true },
      { startsAt: 2, spans: [[2, 4]], memory: true, control: false },
    ]);
  });

  it('attributes the claims of both ranges to the one episode they were served into', () => {
    const reading = pairAttribution({
      ledger: [['k_a'], ['k_a'], ['k_b'], [], ['k_a']],
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', 'b', 'a'],
      memoryTrials: [row('a', 0, 0), row('b', 0, 1)],
      referenceTrials: [row('a', 0, 1), row('b', 0, 0)],
    });
    // `k_a` was served in `a`'s first boundary and again in its retry, and `a` lost: one episode, broken
    // once. A positional join would have handed requests 3 and 4 to `b` and cleared the claim.
    expect(reading?.items).toEqual([
      { id: 'k_a', episodes: 1, kept: 0, broke: 1, net: -1 },
      { id: 'k_b', episodes: 1, kept: 1, broke: 0, net: 1 },
    ]);
  });

  it('declines the pair when a named boundary resolves to nothing', () => {
    expect(
      pairedEpisodes({
        referenceTrials: [row('a', 0, 1)],
        memoryTrials: [row('a', 0, 1)],
        episodeStarts: [0, 2],
        boundaryTasks: ['a', 'zzz'],
        ledgerLength: 3,
      }),
    ).toBeUndefined();
  });

  it('reads a span as half-open and stops the last one at the ledger', () => {
    expect(boundarySpan([0, 4], 0, 9)).toEqual([0, 4]);
    expect(boundarySpan([0, 4], 1, 9)).toEqual([4, 9]);
    // A boundary past the end is clamped rather than read as a range over requests that do not exist.
    expect(boundarySpan([0, 12], 1, 9)).toEqual([9, 9]);
    expect(boundaryDefect([0, 4, 7], 9)).toBeUndefined();
    expect(boundaryDefect([0, 4, 4], 9)).toContain('repeats or decreases');
    expect(boundaryDefect([0, 9], 9)).toContain('starts past the ledger');
  });
});

describe('the joins tolerance and its refusals', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('refuses a ledger whose rows are not lists of ids', () => {
    // A malformed artefact, and the two possible tolerances are both wrong: reading the hole as an empty pack
    // keeps the request in the denominator while contributing no observation, and dropping the row shifts
    // every later request onto the wrong episode. So the table throws and the split says why.
    const holed = [['k'], undefined as unknown as string[], ['k']] as readonly (readonly string[])[];
    expect(() =>
      itemTransfer({ episodes: [{ startsAt: 0, memory: true, control: false }], ledger: holed }),
    ).toThrow(TypeError);
    const split = serveSplit({
      ledger: holed,
      episodeStarts: [0, 1, 2],
      boundaryTasks: ['a', 'b', 'c'],
      memoryTrials: [row('a', 0, 1), row('b', 0, 1), row('c', 0, 1)],
    });
    expect(split).toMatchObject({ absent: 'no-ledger' });
    if ('absent' in split) expect(split.detail).toContain('no id list');
  });

  it('declines a split whose arm recorded no trial rows at all', () => {
    expect(
      serveSplit({ ledger: [['k']], episodeStarts: [0], memoryTrials: [] }),
    ).toMatchObject({ absent: 'boundary-disagrees', detail: 'the arm recorded no trial rows to join the boundary to' });
  });

  it('counts a boundary that names no task rather than grouping it with the next one', () => {
    const join = boundaryJoin({
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', null, 'a'],
      memoryTrials: [row('a', 0, 1)],
    });
    expect(join).toMatchObject({ unresolved: 1, measured: [{ task: 'a', boundaries: [0, 2], trial: 0 }] });
  });

  it('resolves nothing when the arm carries no trial rows', () => {
    const join = boundaryJoin({ episodeStarts: [0], boundaryTasks: ['a'] });
    expect(join).toMatchObject({ absent: 'unknown-task' });
  });

  it('propagates the refusal of the pair rather than reporting an empty table', () => {
    // A positional pair whose counts disagree: `pairedEpisodes` returns `undefined` and the caller must say so
    // instead of handing back `{items: [], unmatchedRequests: 0}`.
    expect(
      pairAttribution({
        ledger: [['k'], ['k']],
        episodeStarts: [0, 1],
        memoryTrials: [row('a', 0, 1)],
        referenceTrials: [row('a', 0, 1)],
      }),
    ).toBeUndefined();
  });

  it('drops a named trial the control arm never ran', () => {
    const episodes = pairedEpisodes({
      referenceTrials: [row('a', 0, 1)],
      memoryTrials: [row('a', 0, 1), row('z', 0, 1)],
      episodeStarts: [0, 2],
      boundaryTasks: ['a', 'z'],
      ledgerLength: 4,
    });
    expect(episodes).toEqual([{ startsAt: 0, spans: [[0, 2]], memory: true, control: true }]);
  });
});

describe('a joined trial the harness declined to score', () => {
  const row = (id: string, trial: number, reward: number | null) => ({ id, trial, reward });

  it('counts on neither side of the split, because a null reward is not a failure', () => {
    // The defect `tau2-degradation` was written against: folding `null` into a failure inflates the withheld
    // bucket with trials nobody scored.
    const split = serveSplit({
      ledger: [['k'], [], [], [], []],
      episodeStarts: [0, 2, 4],
      boundaryTasks: ['a', 'b', 'a'],
      memoryTrials: [row('a', 0, null), row('b', 0, 0)],
    });
    expect(split).toEqual({
      measured: { served: { episodes: 0, passed: 0 }, withheld: { episodes: 1, passed: 0 } },
    });
  });
});
