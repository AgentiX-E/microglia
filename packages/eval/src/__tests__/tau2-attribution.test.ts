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
  episodeStartsOf,
  itemTransfer,
  itemTransferLine,
  pairAttribution,
  pairedEpisodes,
  serveSplit,
  serveSplitLine,
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
