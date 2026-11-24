import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACK_LEDGERS_SCHEMA,
  driftOf,
  headlineLine,
  headlineOf,
  inertPriceOf,
  ledgerLine,
  ledgerOf,
  packLedgersRecord,
  pairBillsOf,
  parseLedgersRecord,
  priceLines,
  pooledLine,
  pooledOf,
  priceLine,
  treatmentKeyOf,
  type PackLedger,
  type PackLedgersRecord,
} from '../pack-ledgers.js';
import type { ArmBill } from '../arm-bill.js';

const unpriced = { priced: false as const, reason: 'no bill', memoryState: 'absent' as const, controlState: 'absent' as const };
const priced = { priced: true as const, injectedTokensPerEpisode: 10, inertTokensPerEpisode: 7.25, memoryState: 'census' as const, controlState: 'census' as const };

const TREATMENT = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-flash', traceClaims: 6, knobs: '' };

/** An artefact that closes: 40 served, 29 inert, 4 repaired, 7 broke, −7.5 pp. */
function fixture(overrides: {
  yieldBlock?: Record<string, unknown>;
  degradation?: Record<string, unknown>;
  comparison?: Record<string, unknown>;
  treatment?: unknown;
} = {}): unknown {
  return {
    treatment: overrides.treatment === undefined ? TREATMENT : overrides.treatment,
    serveYield: {
      renders: 40,
      opportunity: 6,
      repairs: 4,
      breaks: 7,
      inert: 29,
      ...overrides.yieldBlock,
    },
    degradation: {
      broke: 7,
      repaired: 4,
      blankRight: 34,
      measured: 40,
      netPp: -7.5,
      ...overrides.degradation,
    },
    comparison: { paired: 40, lost: 7, gained: 4, deltaPp: -7.5, ...overrides.comparison },
  };
}

function ledgerOfOk(artefact: unknown, file = 'fold.json'): PackLedger {
  const read = ledgerOf(artefact, file);
  if (!read.ok) throw new Error(`expected a ledger, got ${read.problems.join(' | ')}`);
  return read.ledger;
}

function problemsOf(artefact: unknown): readonly string[] {
  const read = ledgerOf(artefact, 'fold.json');
  if (read.ok) throw new Error('expected a refusal');
  return read.problems;
}

describe('treatmentKeyOf', () => {
  it('names every field the pair artefact writes, in one order', () => {
    expect(treatmentKeyOf(TREATMENT)).toBe(
      'unit=correction/form=lesson/scope=all/model=deepseek/deepseek-flash/traceClaims=6',
    );
    expect(treatmentKeyOf({ ...TREATMENT, rotation: 'fair-share' })).toContain('rotation=fair-share');
  });

  it('says `unstated` rather than guessing, for a block that is absent or empty', () => {
    expect(treatmentKeyOf(undefined)).toBe('unstated');
    expect(treatmentKeyOf(null)).toBe('unstated');
    expect(treatmentKeyOf({})).toBe('unstated');
    expect(treatmentKeyOf({ unit: '', knobs: null })).toBe('unstated');
  });

  it('separates a declared `none` from a field the file does not carry', () => {
    // R202. `poc-l4-pair-r152` declares no rotation while its registration pins `serveRotation: fair-share`, so a
    // key that dropped the field filed a bounded fold with the unbounded ones and the pool averaged two
    // mechanisms. Writing the field makes those two keys differ. It does **not** make the old fold correct: the
    // three pre-field artefacts keep the key they have rather than being re-labelled by inference, and this test
    // pins the property the pool rests on — three states, three keys.
    const before = treatmentKeyOf(TREATMENT);
    const none = treatmentKeyOf({ ...TREATMENT, rotation: 'none' });
    const bounded = treatmentKeyOf({ ...TREATMENT, rotation: 'fair-share' });
    expect(new Set([before, none, bounded]).size).toBe(3);
    expect(none).toBe(`${before}/rotation=none`);
  });

  it('separates a sentence fold from a block fold, and both from a file written before the field', () => {
    // R204. Three states, three keys, for R202's reason: a fold that served a sentence and a fold that served the
    // block are two treatments, and the pool has to be able to say so from the artefact alone.
    const before = treatmentKeyOf(TREATMENT);
    const block = treatmentKeyOf({ ...TREATMENT, serveBody: 'rendered' });
    const sentence = treatmentKeyOf({ ...TREATMENT, serveBody: 'guidance' });
    expect(new Set([before, block, sentence]).size).toBe(3);
    expect(sentence).toBe(`${before}/serveBody=guidance`);
  });
});

describe('ledgerOf', () => {
  it('reads the identity the artefacts close, and derives the shares from it', () => {
    const ledger = ledgerOfOk(fixture());
    expect(ledger).toMatchObject({ renders: 40, inert: 29, repaired: 4, broke: 7, measured: 40, blankRight: 34 });
    expect(ledger.inertShare).toBeCloseTo(0.725, 10);
    expect(ledger.engagedShare).toBeCloseTo(0.275, 10);
    expect(ledger.breakPremium).toBe(3);
    expect(ledger.repairsPerBreak).toBeCloseTo(4 / 7, 10);
    expect(ledger.treatment).toBe('unit=correction/form=lesson/scope=all/model=deepseek/deepseek-flash/traceClaims=6');
  });

  it('refuses a file that is missing one of the three blocks, and names it', () => {
    expect(problemsOf({ serveYield: {}, degradation: {} }).join(' ')).toContain('no comparison block');
    expect(problemsOf({ serveYield: {}, comparison: {} }).join(' ')).toContain('no degradation block');
    expect(problemsOf({ degradation: {}, comparison: {} }).join(' ')).toContain('no serveYield block');
    expect(problemsOf(null).join(' ')).toContain('no serveYield block');
  });

  it('refuses a field that is not a non-negative number', () => {
    for (const bad of [{ renders: '40' }, { renders: -1 }, { renders: 4.5 }, { inert: null }]) {
      expect(problemsOf(fixture({ yieldBlock: bad })).join(' ')).toMatch(/not a non-negative number/);
    }
    // Legal JSON that parses to a non-finite number: `1e999`. The percentage is not a percentage.
    const infinite = JSON.parse(JSON.stringify(fixture()).replace('-7.5', '1e999')) as unknown;
    expect(problemsOf(infinite).join(' ')).toContain('degradation.netPp is not a non-negative number');
  });

  it('refuses a zero denominator instead of dividing by it', () => {
    const zero = fixture({
      yieldBlock: { renders: 0, inert: 0, repairs: 0, breaks: 0, opportunity: 0 },
      degradation: { broke: 0, repaired: 0, blankRight: 0, measured: 0, netPp: 0 },
      comparison: { paired: 0, lost: 0, gained: 0, deltaPp: 0 },
    });
    expect(problemsOf(zero).join(' ')).toContain('measured is zero');
  });

  it('refuses a degradation that is arithmetically impossible', () => {
    const impossible = fixture({ degradation: { repaired: 7, blankRight: 34, netPp: -7.5 } });
    expect(problemsOf(impossible).join(' ')).toContain('degradation is impossible');
    const breakOutside = fixture({ degradation: { broke: 35, blankRight: 34 } });
    expect(problemsOf(breakOutside).join(' ')).toContain('degradation is impossible');
  });

  it('refuses two blocks that describe different episodes', () => {
    expect(problemsOf(fixture({ yieldBlock: { breaks: 6 } })).join(' ')).toContain('census disagrees');
    expect(problemsOf(fixture({ comparison: { lost: 6 } })).join(' ')).toContain('comparison disagrees');
  });

  it('refuses an inert count that does not close on served minus engaged', () => {
    expect(problemsOf(fixture({ yieldBlock: { inert: 30 } })).join(' ')).toContain('inert does not close');
  });

  it('checks each census against itself when the fold withholds episodes from one of them', () => {
    // R205's own fold. The degradation census is over the forty paired trials and the render census is over the
    // nine that carried a body, so `measured == renders` is not an identity on this arm and never was: the pair
    // said 2 broke / 4 repaired of 40, and 1 broke / 0 repaired of 9 renders. Both close inside themselves, and
    // the cross-population triple is the check that has to be scoped rather than the numbers that have to move.
    const transient = {
      ...(fixture({
        yieldBlock: { renders: 9, opportunity: 0, repairs: 0, breaks: 1, inert: 8, withheld: 35 },
        degradation: { broke: 2, repaired: 4, blankRight: 33, measured: 40, netPp: 5 },
        comparison: { paired: 40, lost: 2, gained: 4, deltaPp: 5 },
      }) as Record<string, unknown>),
      treatment: { ...TREATMENT, serveBody: 'guidance' },
      transient: { guidance: { calls: 42, sentences: 5, refusals: 37, failures: 0 } },
    };
    expect(ledgerOfOk(transient).renders).toBe(9);
    // And the render census still has to close on its own terms: eight inert against nine renders with one break
    // is the identity this fold is allowed to owe.
    expect(
      problemsOf({
        ...(transient as Record<string, unknown>),
        serveYield: { renders: 9, opportunity: 0, repairs: 0, breaks: 1, inert: 9, withheld: 35 },
      }).join(' '),
    ).toContain('inert does not close');
    // A block fold still owes the cross-population identity, because on a block arm no episode is withheld and
    // the two censuses are one population.
    expect(
      problemsOf({
        ...(fixture() as Record<string, unknown>),
        serveYield: { renders: 9, opportunity: 6, repairs: 4, breaks: 7, inert: 29 },
      }).join(' '),
    ).toContain('census disagrees');
  });

  it('refuses a percentage that is not the ledger’s own fraction', () => {
    expect(problemsOf(fixture({ degradation: { netPp: -7.4 } })).join(' ')).toContain('net does not close');
    expect(problemsOf(fixture({ comparison: { deltaPp: -8 } })).join(' ')).toContain('net does not close');
  });

  it('refuses a sentence fold whose population cannot be named, and accepts one whose population is', () => {
    // R204. `serveYield.renders` counts the packs the facade served; on the transient arm the agent read the
    // sentence. An episode whose guidance call failed carried nothing while its block counted as rendered, and
    // every such episode would be booked as an inert pack — inflating the 78.7% this whole line is about.
    //
    // R205 changed what the gate can ask. It no longer has to infer the population from a refusal count: the
    // join publishes `withheld`, the number of episodes it dropped because their prompt carried no body, and a
    // fold that carries it has said which population its renders are over. A refusal *without* it is still the
    // pre-R205 artefact and is still refused — the gate did not get nicer, the artefact got checkable.
    const guided = (transient: Record<string, unknown>, yieldBlock: Record<string, unknown> = {}): unknown => ({
      ...(fixture({ yieldBlock }) as Record<string, unknown>),
      treatment: { ...TREATMENT, serveBody: 'guidance' },
      transient,
    });
    expect(
      problemsOf(guided({ guidance: { calls: 40, sentences: 38, refusals: 0, failures: 2 } })).join(' '),
    ).toContain('2 of 40 guidance calls failed, so the rendered count is not the injected one');
    // A failure is not repairable by the instrument: the episode it lost is a hole in the arm's coverage, and a
    // fold with holes is not poolable with one without however well its population is named.
    expect(
      problemsOf(guided({ guidance: { calls: 40, sentences: 40, refusals: 0, failures: 2 } }, { withheld: 0 })).join(
        ' ',
      ),
    ).toContain('2 of 40 guidance calls failed');
    // The first dispatch of this arm came back with no failures at all and 34 refusals of 40, and its artefact
    // says nothing about which episodes carried a body: refused, because the renders may be the facade's.
    expect(
      problemsOf(guided({ guidance: { calls: 40, sentences: 6, refusals: 34, failures: 0 } })).join(' '),
    ).toContain('the renders may describe the facade rather than the prompts');
    // The fold R205's instrument publishes for that run: six episodes carried a sentence, 34 carried nothing and
    // are counted rather than rendered, and the census closes over all forty calls.
    const proven = {
      ...(fixture({
        yieldBlock: { renders: 6, opportunity: 4, repairs: 1, breaks: 1, inert: 4, withheld: 34 },
        degradation: { broke: 1, repaired: 1, blankRight: 5, measured: 6, netPp: 0 },
        comparison: { paired: 6, lost: 1, gained: 1, deltaPp: 0 },
      }) as Record<string, unknown>),
      treatment: { ...TREATMENT, serveBody: 'guidance' },
      transient: { guidance: { calls: 40, sentences: 6, refusals: 34, failures: 0 } },
    };
    expect(ledgerOfOk(proven).renders).toBe(6);
    // Zero of both is the reading, not a pass by default: the census has to say so, and so does the join.
    expect(
      ledgerOfOk(guided({ guidance: { calls: 40, sentences: 40, refusals: 0, failures: 0 } }, { withheld: 0 }))
        .renders,
    ).toBe(40);
    // The census has to close over its own three outcomes: 40 calls answered 6 + 30 + 0, and a fold whose
    // counters do not add up is not a fold whose population can be named.
    expect(
      problemsOf(
        guided({ guidance: { calls: 40, sentences: 6, refusals: 30, failures: 0 } }, { withheld: 34 }),
      ).join(' '),
    ).toContain('the guidance census does not close');
    // No census at all is a third state, and it is refused rather than read as "no failures".
    expect(problemsOf(guided({})).join(' ')).toContain('carries no guidance census');
    expect(problemsOf(guided({ guidance: { sentences: 40 } })).join(' ')).toContain(
      'carries no call, refusal and failure count',
    );
    // And the phase's own block, for a fold read from a driver artefact rather than from a pair.
    const fromPhase = {
      ...(fixture({ yieldBlock: { withheld: 0 } }) as Record<string, unknown>),
      treatment: { ...TREATMENT, serveBody: 'guidance' },
      memory: { guidance: { calls: 40, sentences: 40, refusals: 0, failures: 0 } },
    };
    expect(ledgerOfOk(fromPhase).renders).toBe(40);
    // A block fold is left alone whatever its memory block says: the gate is about the body, and the body is
    // `rendered` for every artefact written before the field.
    const block = {
      ...(fixture() as Record<string, unknown>),
      memory: { guidance: { calls: 40, refusals: 9, failures: 3 } },
    };
    expect(ledgerOfOk(block).renders).toBe(40);
  });

  it('carries `null` rather than zero when nothing broke', () => {
    const clean = fixture({
      yieldBlock: { repairs: 2, breaks: 0, inert: 38 },
      degradation: { broke: 0, repaired: 2, netPp: 5 },
      comparison: { lost: 0, gained: 2, deltaPp: 5 },
    });
    const ledger = ledgerOfOk(clean);
    expect(ledger.repairsPerBreak).toBeNull();
    expect(ledger.breakPremium).toBe(-2);
  });
});

function fold(artefact: string, overrides: Partial<PackLedger> = {}): PackLedger {
  return {
    artefact,
    treatment: 'one',
    // R206: every fold names its material, and every fixture before this round served the rendered block.
    body: 'rendered',
    renders: 10,
    opportunity: 2,
    repaired: 2,
    broke: 3,
    inert: 5,
    measured: 10,
    blankRight: 7,
    netPp: -10,
    deltaPp: -10,
    inertShare: 0.5,
    engagedShare: 0.5,
    breakPremium: 1,
    repairsPerBreak: 2 / 3,
    ...overrides,
  };
}

describe('pooledOf', () => {
  it('pools only folds that share a treatment, in first-seen order', () => {
    const pools = pooledOf([
      fold('a', { treatment: 'one' }),
      fold('b', { treatment: 'two', broke: 0, repaired: 0, inert: 10, netPp: 0, deltaPp: 0, breakPremium: 0, repairsPerBreak: null }),
      fold('c', { treatment: 'one' }),
    ]);
    expect(pools.map((pool) => pool.treatment)).toEqual(['one', 'two']);
    expect(pools[0]?.folds).toEqual(['a', 'c']);
    expect(pools[0]?.renders).toBe(20);
    expect(pools[0]?.inert).toBe(10);
    expect(pools[0]?.deltaPp).toBeCloseTo(-10, 10);
  });

  it('says how many breaks a gate would have to prevent, and gives no rate when nothing broke', () => {
    const [negative] = pooledOf([fold('a', { broke: 3, repaired: 2 })]);
    expect(negative?.breaksToFlip).toBe(2);
    expect(negative?.breakShareToFlip).toBeCloseTo(2 / 3, 10);
    const [positive] = pooledOf([fold('a', { broke: 1, repaired: 3, breakPremium: -2 })]);
    expect(positive?.breaksToFlip).toBe(0);
    expect(positive?.breakShareToFlip).toBeNull();
    const [silent] = pooledOf([fold('a', { broke: 0, repaired: 0, breakPremium: 0, repairsPerBreak: null })]);
    expect(silent?.breaksToFlip).toBe(1);
    expect(silent?.breakShareToFlip).toBeNull();
  });

  it('carries a Wilson interval on the inert share rather than a point', () => {
    const [pool] = pooledOf([fold('a', { renders: 40, inert: 29, repaired: 4, broke: 7, measured: 40 })]);
    expect(pool?.inertShare).toBeCloseTo(0.725, 10);
    expect(pool?.inertInterval[0]).toBeLessThan(0.725);
    expect(pool?.inertInterval[1]).toBeGreaterThan(0.725);
    expect(pool?.inertInterval[0]).toBeGreaterThan(0.5);
  });
});

describe('headlineOf', () => {
  it('pools across treatments and names them', () => {
    const headline = headlineOf([fold('a', { treatment: 'one' }), fold('b', { treatment: 'two' })]);
    expect(headline.treatments).toEqual(['one', 'two']);
    expect(headline.renders).toBe(20);
  });

  it('deduplicates the keys it mixed', () => {
    expect(headlineOf([fold('a', { treatment: 'one' }), fold('b', { treatment: 'one' })]).treatments).toEqual(['one']);
  });

  it('refuses an empty corpus rather than printing 0% inert', () => {
    expect(() => headlineOf([])).toThrow(/at least one fold/);
  });

  it('refuses to average two materials and names both', () => {
    // R204's fold is the case: its `renders` are the summariser's inputs, so a corpus share that included it
    // would be a percentage of two different denominators wearing one name.
    const mixed = [fold('a'), fold('b', { body: 'guidance' })];
    expect(() => headlineOf(mixed)).toThrow(/mixes serve bodies \(rendered, guidance\)/);
  });

  it('pools the material the caller named, and only that one', () => {
    const mixed = [fold('a', { renders: 10, inert: 5 }), fold('b', { body: 'guidance', renders: 4, inert: 3 })];
    const rendered = headlineOf(mixed, 'rendered');
    expect(rendered.body).toBe('rendered');
    expect(rendered.renders).toBe(10);
    expect(rendered.folds).toEqual(['a']);
    const guidance = headlineOf(mixed, 'guidance');
    expect(guidance.renders).toBe(4);
    expect(guidance.body).toBe('guidance');
  });

  it('refuses a body the corpus does not carry', () => {
    expect(() => headlineOf([fold('a')], 'guidance')).toThrow(/no fold served the body 'guidance'/);
  });

  it('names the body on the line a reader quotes', () => {
    expect(headlineLine(headlineOf([fold('a')]))).toContain('over the rendered body');
  });
});

function census(calls: number, promptTokens?: number): ArmBill {
  return {
    calls,
    source: 'census',
    ...(promptTokens === undefined ? {} : { promptTokens, completionTokens: 10 }),
  };
}

describe('inertPriceOf', () => {
  const ledger = { measured: 40, inertShare: 0.725 };

  it('prices the inert share as the difference between two censuses', () => {
    const price = inertPriceOf(ledger, { memory: census(12, 1000), control: census(10, 600) });
    expect(price.priced).toBe(true);
    if (!price.priced) return;
    expect(price.injectedTokensPerEpisode).toBeCloseTo(10, 10);
    expect(price.inertTokensPerEpisode).toBeCloseTo(7.25, 10);
  });

  it('refuses to price a count, or a census with no token column', () => {
    const counted = inertPriceOf(ledger, {
      memory: { calls: 12, source: 'count' },
      control: census(10, 600),
    });
    expect(counted.priced).toBe(false);
    expect(counted.memoryState).toBe('count');
    if (!counted.priced) expect(counted.reason).toContain("both arms need a census");

    const noTokens = inertPriceOf(ledger, { memory: census(12), control: census(10) });
    expect(noTokens.priced).toBe(false);
    if (!noTokens.priced) expect(noTokens.reason).toContain('prompt-token column');
  });

  it('refuses a negative premium rather than charting it', () => {
    const backwards = inertPriceOf(ledger, { memory: census(12, 600), control: census(10, 1000) });
    expect(backwards.priced).toBe(false);
    if (!backwards.priced) expect(backwards.reason).toContain('fewer prompt tokens');
  });
});

describe('the lines a reader sees', () => {
  it('renders a fold with and without a break to divide by', () => {
    expect(ledgerLine(fold('a'))).toBe(
      'a: 10 served, 5 inert (50.0%), 2 repaired against 3 broke (0.67 repairs per break), -10.00 pp',
    );
    expect(ledgerLine(fold('b', { broke: 0, repaired: 0, repairsPerBreak: null, breakPremium: 0, deltaPp: 0 }))).toContain(
      'no break to divide by',
    );
  });

  it('renders a pool with the break count a gate must buy, or says it is already positive', () => {
    const [negative] = pooledOf([fold('a', { broke: 3, repaired: 2 })]);
    expect(pooledLine(negative as PackLedger & never)).toContain('2 of 3 breaks must go (67%)');
    const [positive] = pooledOf([fold('a', { broke: 1, repaired: 3 })]);
    expect(pooledLine(positive as PackLedger & never)).toContain('already positive');
  });

  it('renders a pool with breaks but no rate as zero-percent, rather than dropping the clause', () => {
    const [silent] = pooledOf([fold('a', { broke: 0, repaired: 0, breakPremium: 0, repairsPerBreak: null })]);
    expect(pooledLine(silent as PackLedger & never)).toContain('1 of 0 breaks must go (0%)');
  });

  it('names what the headline mixed', () => {
    expect(headlineLine(headlineOf([fold('a'), fold('b')]))).toContain('pooled over 1 treatment(s)');
  });

  it('renders the price in both states', () => {
    expect(priceLine(inertPriceOf({ measured: 40, inertShare: 0.725 }, { memory: census(12, 1000), control: census(10, 600) }))).toBe(
      'inert price: 10.0 injected prompt tokens an episode, of which 7.3 bought nothing',
    );
    expect(priceLine(inertPriceOf({ measured: 40, inertShare: 0.725 }, { memory: { calls: 1, source: 'absent' }, control: census(10, 600) }))).toContain(
      'unpriced',
    );
  });
});

describe('the record', () => {
  it('refuses the whole record when one fold cannot be read', () => {
    const { record, refusals } = packLedgersRecord([
      { path: 'good.json', artefact: fixture() },
      { path: 'bad.json', artefact: { serveYield: {} } },
    ]);
    expect(record).toBeUndefined();
    expect(refusals.join(' ')).toContain('bad.json: no degradation block');
  });

  it('writes the reason a fold is unpriced rather than pricing it at zero', () => {
    const { record } = packLedgersRecord([{ path: 'good.json', artefact: fixture() }]);
    expect(record?.schema).toBe(PACK_LEDGERS_SCHEMA);
    const entry = record?.price['good.json'];
    expect(entry?.priced).toBe(false);
    if (entry !== undefined && !entry.priced) expect(entry.reason).toContain('no arm blocks');
  });

  it('prices a fold from its own pair blocks, and only that fold', () => {
    const priced = {
      ...(fixture() as Record<string, unknown>),
      first: { calls: 10, bill: 'census', promptTokens: 600 },
      second: { calls: 12, bill: 'census', promptTokens: 1000 },
    };
    const { record } = packLedgersRecord([
      { path: 'priced.json', artefact: priced },
      { path: 'bare.json', artefact: fixture() },
    ]);
    expect(record?.price['priced.json']?.priced).toBe(true);
    expect(record?.price['bare.json']?.priced).toBe(false);
  });
});

describe('parseLedgersRecord', () => {
  const sound = packLedgersRecord([{ path: 'good.json', artefact: fixture() }]).record as PackLedgersRecord;

  it('round-trips the record the writer produces', () => {
    const parsed = parseLedgersRecord(JSON.parse(JSON.stringify(sound)));
    expect(parsed.refusals).toEqual([]);
    expect(parsed.record?.folds[0]?.artefact).toBe('good.json');
  });

  it('refuses every shape that would let a stale file pass', () => {
    expect(parseLedgersRecord('nope').refusals[0]).toContain('not an object');
    expect(parseLedgersRecord({ ...sound, schema: 'other' }).refusals[0]).toContain('schema must be');
    expect(parseLedgersRecord({ ...sound, folds: [{ artefact: 'x' }] }).refusals).toContain('folds must be an array of ledgers');
    expect(parseLedgersRecord({ ...sound, pooled: [{}] }).refusals).toContain('pooled must be an array of pools');
    expect(parseLedgersRecord({ ...sound, headline: {} }).refusals).toContain('headline must be a pool carrying its treatments');
    expect(parseLedgersRecord({ ...sound, price: { 'x.json': { reason: 'no flag' } } }).refusals).toContain(
      'price must map each fold to an entry carrying a `priced` flag',
    );
    expect(parseLedgersRecord({ ...sound, price: [] }).refusals).toContain(
      'price must map each fold to an entry carrying a `priced` flag',
    );
    // Structural checks inside the two element guards: a fold that is not an object, one with a numeric
    // treatment, a pool with no interval and one whose interval is not a pair.
    expect(parseLedgersRecord({ ...sound, folds: [null] }).refusals).toContain('folds must be an array of ledgers');
    expect(
      parseLedgersRecord({ ...sound, folds: [{ ...(sound.folds[0] as PackLedger), treatment: 7 }] }).refusals,
    ).toContain('folds must be an array of ledgers');
    const noInterval = { treatment: 'one', folds: ['a'], renders: 1, measured: 1, repaired: 0, broke: 0, inert: 1, inertShare: 1, deltaPp: 0, breaksToFlip: 1 };
    expect(parseLedgersRecord({ ...sound, pooled: [noInterval] }).refusals).toContain('pooled must be an array of pools');
    expect(parseLedgersRecord({ ...sound, pooled: [{ ...noInterval, inertInterval: [0, 1, 2] }] }).refusals).toContain(
      'pooled must be an array of pools',
    );
    expect(parseLedgersRecord({ ...sound, pooled: [{ ...noInterval, inertInterval: [0, 1] }] }).refusals).toEqual([]);
    expect(parseLedgersRecord({ ...sound, pooled: [{ ...noInterval, inertInterval: [0, 1], renders: 'ten' }] }).refusals).toContain(
      'pooled must be an array of pools',
    );
    expect(parseLedgersRecord({ ...sound, pooled: [{ ...noInterval, folds: 'nope' }] }).refusals).toContain(
      'pooled must be an array of pools',
    );
    expect(parseLedgersRecord({ ...sound, pooled: [null] }).refusals).toContain('pooled must be an array of pools');
  });
});

describe('driftOf', () => {
  const sound = packLedgersRecord([{ path: 'good.json', artefact: fixture() }]).record as PackLedgersRecord;

  it('is silent when the record and the artefacts agree', () => {
    expect(driftOf(sound, JSON.parse(JSON.stringify(sound)))).toEqual([]);
  });

  it('names each way the evidence can move', () => {
    const moved = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    const first = moved.folds[0] as unknown as Record<string, unknown>;
    first['inert'] = 30;
    expect(driftOf(moved, sound).join(' ')).toContain('the committed ledger has drifted');

    const missing = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    expect(driftOf({ ...missing, folds: [] }, sound).join(' ')).toContain('absent from the committed record');

    const extra = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    extra.folds.push({ ...(extra.folds[0] as PackLedger), artefact: 'gone.json' });
    expect(driftOf(extra, sound).join(' ')).toContain('no longer carry');

    const pooledMoved = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    (pooledMoved.pooled[0] as unknown as Record<string, unknown>)['renders'] = 41;
    expect(driftOf(pooledMoved, sound).join(' ')).toContain('pools have drifted');

    const headlineMoved = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    (headlineMoved.headline as unknown as Record<string, unknown>)['renders'] = 41;
    expect(driftOf(headlineMoved, sound).join(' ')).toContain('corpus reading has drifted');

    const priceMoved = JSON.parse(JSON.stringify(sound)) as PackLedgersRecord;
    (priceMoved.price['good.json'] as unknown as Record<string, unknown>)['reason'] = 'something else entirely';
    expect(driftOf(priceMoved, sound).join(' ')).toContain('price column has drifted');
  });
});

describe('pairBillsOf', () => {
  it('reads the control from `first` and the memory arm from `second`, tokens included', () => {
    const bills = pairBillsOf({
      first: { calls: 10, bill: 'census', promptTokens: 600, uncachedTokens: 40 },
      second: { calls: 12, bill: 'census', promptTokens: 1000 },
    });
    expect(bills?.control).toEqual({ calls: 10, source: 'census', promptTokens: 600, uncachedTokens: 40 });
    expect(bills?.memory).toEqual({ calls: 12, source: 'census', promptTokens: 1000 });
  });

  it('returns nothing rather than inventing a bill for a file without arm blocks', () => {
    expect(pairBillsOf(undefined)).toBeUndefined();
    expect(pairBillsOf('nope')).toBeUndefined();
    expect(pairBillsOf({ first: { calls: 1 } })).toBeUndefined();
  });

  it('applies R198’s rule to a file that never wrote a state: zero is silence, a number is a count', () => {
    const bills = pairBillsOf({ first: { calls: 0 }, second: { calls: 7 } });
    expect(bills?.control.source).toBe('absent');
    expect(bills?.memory.source).toBe('count');
  });

  it('drops a token column that the state says was not measured', () => {
    const bills = pairBillsOf({
      first: { calls: 3, bill: 'count', promptTokens: 600 },
      second: { calls: 4, bill: 'absent', promptTokens: 900 },
    });
    expect(bills?.control.promptTokens).toBeUndefined();
    expect(bills?.memory.promptTokens).toBeUndefined();
  });
});

describe('priceLines', () => {
  it('collapses a column where nothing is priced into one line with its count', () => {
    const lines = priceLines({ 'a.json': unpriced, 'b.json': unpriced });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unpriced for all 2 fold(s)');
  });

  it('keeps a mixed column per fold, so a reader knows which fold the price is about', () => {
    const lines = priceLines({ 'a.json': unpriced, 'b.json': priced });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('a.json inert price: unpriced');
    expect(lines[1]).toContain('b.json inert price: 10.0 injected');
  });

  it('says nothing for an empty column', () => {
    expect(priceLines({})).toEqual([]);
  });
});

/**
 * The published numbers, recomputed — each from the folds it was published over.
 *
 * R197's cancellation quoted a pooled census of −4.64 pp over 194 pairs: the four folds paid for after R152, which
 * silently mixed R152c's bounded arm with three unbounded ones. R200 then read five folds to −4.38 pp. Those two
 * numbers are *historical* and are recomputed here from the exact files they were taken over, because a corpus that
 * grows would otherwise rewrite the arithmetic of a published sentence and hide that it had moved. The corpus of
 * record is the last case, and it is quoted with the count it was taken over rather than as a constant.
 */
describe('the published τ² census, recomputed from the artefacts', () => {
  const sources = readdirSync(join(process.cwd(), 'eval/results'))
    .filter((name) => name.startsWith('poc-l4-pair') && name.endsWith('.json'))
    .sort()
    .map((name) => ({
      path: `eval/results/${name}`,
      artefact: JSON.parse(readFileSync(join(process.cwd(), 'eval/results', name), 'utf8')) as unknown,
    }));

  it('reads every committed fold without a refusal', () => {
    const read = packLedgersRecord(sources);
    expect(read.refusals).toEqual([]);
    // The count is the number of files the lane has committed, not a constant: a fold added without its record
    // regenerated fails the drift test below, and a test that also pinned the count would have to be edited for
    // every dispatch — which is how a suite starts testing its own edit history.
    expect(read.record?.folds).toHaveLength(sources.length);
  });

  it('still reproduces −4.64 pp over the four folds it was published over', () => {
    // The exact population R197's cancellation quoted. Named rather than derived from "everything except the
    // pre-treatment artefact", because that filter silently grew when R198's fold arrived.
    const named = ['poc-l4-pair-official.json', 'poc-l4-pair-r152.json', 'poc-l4-pair-r152c.json', 'poc-l4-pair-swapped.json'];
    const byPath = new Map(sources.map((source) => [source.path.split('/').pop() ?? '', source.artefact]));
    const four = packLedgersRecord(
      named.map((name) => ({ path: `eval/results/${name}`, artefact: byPath.get(name) as unknown })),
    ).record?.folds;
    expect(four).toHaveLength(4);
    const broke = (four ?? []).reduce((total, fold) => total + fold.broke, 0);
    const repaired = (four ?? []).reduce((total, fold) => total + fold.repaired, 0);
    const measured = (four ?? []).reduce((total, fold) => total + fold.measured, 0);
    expect(measured).toBe(194);
    expect(((repaired - broke) / measured) * 100).toBeCloseTo(-4.64, 2);
  });

  it('reproduces −4.38 pp over the five folds R200 published it on', () => {
    // R200's headline, over the five folds that existed when it was written. Six folds now, and the last case
    // states that reading — the published sentence keeps its own arithmetic.
    const five = sources.filter((source) => !source.path.includes('r198'));
    const record = packLedgersRecord(five).record as PackLedgersRecord;
    expect(record.folds).toHaveLength(5);
    expect(record.headline.deltaPp).toBeCloseTo(-4.38, 2);
  });

  it('states the corpus of record with its own count, and the price it now carries', () => {
    const record = packLedgersRecord(sources).record as PackLedgersRecord;
    expect(record.folds).toHaveLength(sources.length);
    // Six folds, 291 served packs, −3.44 pp: the number R198's fold moved, and the reason it is quoted with the
    // count beside it rather than as a bare percentage.
    expect(record.headline.measured).toBe(291);
    expect(record.headline.deltaPp).toBeCloseTo(-3.44, 2);
    expect(record.headline.inert).toBe(229);
    // And it is the first corpus with a priced column: one fold's bill is a census on both arms, and the premium
    // it prints is the number every cost claim in this record now has to be quoted against.
    const prices = Object.values(record.price);
    const priced = prices.filter((entry) => entry.priced);
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ priced: true, memoryState: 'census', controlState: 'census' });
    expect(priced[0].priced && priced[0].injectedTokensPerEpisode).toBeCloseTo(3299.6, 1);
  });

  it('keeps the sign under either pooling rule, which is what the conclusion rests on', () => {
    const record = packLedgersRecord(sources).record as PackLedgersRecord;
    expect(record.headline.deltaPp).toBeLessThan(0);
    for (const pool of record.pooled) expect(pool.deltaPp).toBeLessThan(0);
  });

  it('keeps every committed key exactly where it was, so re-reading a fold never re-labels it', () => {
    // R202's acceptance clause, in the form a test can hold: the unstated pool shrinks by the folds re-run after
    // the change, never by the folds merely re-read. Four of the five artefacts predate the field and one declares
    // `fair-share`; none of the five may gain a `rotation=` segment from this round.
    const record = packLedgersRecord(sources).record as PackLedgersRecord;
    const keys = new Map(record.folds.map((fold) => [fold.artefact.split('/').pop() ?? '', fold.treatment]));
    expect(keys.get('poc-l4-pair-r152c.json')).toContain('/rotation=fair-share');
    for (const name of [
      'poc-l4-pair.json',
      'poc-l4-pair-official.json',
      'poc-l4-pair-r152.json',
      'poc-l4-pair-swapped.json',
    ]) {
      expect(keys.get(name) ?? '').not.toContain('rotation=');
    }
  });

  it('regenerates the committed record with no drift, which is what makes `--check` a gate', () => {
    const committed = JSON.parse(
      readFileSync(join(process.cwd(), 'eval/results/pack-ledgers.json'), 'utf8'),
    ) as PackLedgersRecord;
    const fresh = packLedgersRecord(sources).record as PackLedgersRecord;
    expect(driftOf(committed, fresh)).toEqual([]);
  });
});
