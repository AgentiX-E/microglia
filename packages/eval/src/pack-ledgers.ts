/**
 * The pack's three ledgers: served, engaged, inert — and the arithmetic a gate would have to buy.
 *
 * Every fold this lane has bought reports the same four numbers in two places: `serveYield` says how many
 * packs were rendered, how many had an opportunity, how many repaired and how many broke; `degradation`
 * says the same episode counts from the comparison's side. Read together they close an identity that no
 * document in this repository states:
 *
 * ```text
 * inert = renders - repaired - broke
 * ```
 *
 * A pack is inert exactly when the episode's verdict did not change, so the identity is not an estimate of
 * inertness — it is the definition, and an artefact whose blocks do not close it is describing two different
 * populations. That is the first thing this module refuses.
 *
 * ## Why the ledger rather than the delta
 *
 * The paired delta on this lane moves sign between folds (+2.50, +2.50, −3.51, −7.50, −10.81) inside
 * intervals whose half-widths are ±9 to ±11 points, so no mechanism claim survives it. The *inert share*
 * does not move: five folds, five splits, three treatments, and it lands between 70% and 88% every time.
 * That is the stable fact about how this memory is used — and the one a gate can act on, because withholding
 * a pack that provably changed nothing cannot change accuracy by construction, only the bill.
 *
 * ## What it refuses, and why a refusal is the point
 *
 * - `inert-does-not-close` — the yield block's own arithmetic is wrong, so its inert count is not a count.
 * - `census-disagrees` — `serveYield` and `degradation` report different episodes, so one of the two is stale.
 * - `comparison-disagrees` — `lost`/`gained` do not match `broke`/`repaired`, so the delta and the ledger are
 *   about different runs. This is the check that would have caught a pair artefact assembled from two arms
 *   of different dispatches.
 * - `degradation-impossible` — a repair where the control was already right, or a break where it was wrong.
 * - `net-does-not-close` — the printed percentage is not `(repaired - broke) / measured`.
 *
 * A module that reported the ledger for a file that fails any of these would be quoting a number it cannot
 * defend, which is the failure mode this lane has spent forty rounds learning to refuse.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import { wilsonInterval } from './reproduction.js';
import type { ArmBill } from './arm-bill.js';

export const PACK_LEDGERS_SCHEMA = 'microglia.pack-ledgers/1';

/** One fold's ledger, as the two blocks that already carry it close it. */
export type PackLedger = {
  /** The artefact file, so every number below can be re-derived from a path. */
  readonly artefact: string;
  /** The canonical treatment key; `unstated` for an artefact written before the block existed. */
  readonly treatment: string;
  readonly renders: number;
  readonly opportunity: number;
  readonly repaired: number;
  readonly broke: number;
  readonly inert: number;
  readonly measured: number;
  readonly blankRight: number;
  readonly netPp: number;
  readonly deltaPp: number;
  /** `inert / renders` — the share of served packs that provably changed no verdict. */
  readonly inertShare: number;
  /** `(repaired + broke) / renders` — the complement, and the population any mechanism claim is about. */
  readonly engagedShare: number;
  /** `broke - repaired`: positive means the pack costs episodes, negative means it buys them. */
  readonly breakPremium: number;
  /** `repaired / broke`, or `null` when nothing broke — a rate with no denominator is not zero. */
  readonly repairsPerBreak: number | null;
};

export type LedgerRead =
  | { readonly ok: true; readonly ledger: PackLedger }
  | { readonly ok: false; readonly artefact: string; readonly problems: readonly string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-negative integer at `key`, or `undefined` when the value is anything else. */
function countOf(block: Record<string, unknown>, key: string): number | undefined {
  const value = block[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** A finite number at `key`, or `undefined`. */
function numberOf(block: Record<string, unknown>, key: string): number | undefined {
  const value = block[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The treatment as one string.
 *
 * The fields are the ones the pair artefact already writes. `rotation` is included because it is a *serving*
 * policy — the bounded arm caps how many packs travel — and a pool that mixed a bounded fold with an
 * unbounded one would be averaging two mechanisms under one name, which is exactly what the published
 * −4.64 pp did. A block that is absent yields `unstated` rather than a guess: an artefact from before the
 * block existed cannot be assigned to a treatment by inference.
 *
 * **The key is what the file declares, not what ran.** `poc-l4-pair-r152` carries no `rotation` while its
 * registration pins `serveRotation: fair-share`, so its own pool contains a bounded fold. That defect is recorded
 * rather than repaired by inference — inferring the value from the registration would make the key depend on a file
 * the artefacts do not reference. R202 closed it at the producer: `treatmentOf` writes `rotation` unconditionally,
 * as the declared policy or the literal `none`, so every fold bought after that round states one and this reader's
 * omission rule no longer decides anything about a new fold. The reader is deliberately unchanged: a committed key
 * may not move because the fold was re-read, and the four pre-field artefacts keep exactly the strings they had.
 */
export function treatmentKeyOf(treatment: unknown): string {
  if (!isObject(treatment)) return 'unstated';
  // R204: `serveBody` last, and therefore outside every key committed before it existed — which is what keeps
  // the six committed folds' pooled readings reproducible byte for byte. A field appended here moves only the
  // keys of artefacts that carry it, and the driver writes it on every pack-serving arm from R204 on.
  const order = ['unit', 'form', 'scope', 'model', 'traceClaims', 'knobs', 'rotation', 'serveBody'] as const;
  const parts: string[] = [];
  for (const field of order) {
    const value = treatment[field];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${field}=${String(value)}`);
  }
  return parts.length === 0 ? 'unstated' : parts.join('/');
}

/** The tolerance the percentage identities are closed at. Four places is what the artefacts print. */
const CLOSE_ENOUGH_PP = 1e-6;

/**
 * Read one artefact into a ledger, or say why it cannot be read.
 *
 * Every problem is collected rather than thrown, because a fold that fails one check usually fails the
 * neighbouring one for the same reason, and a repair is one round either way.
 */
export function ledgerOf(artefact: unknown, file: string): LedgerRead {
  const problems: string[] = [];
  const root = isObject(artefact) ? artefact : {};
  const yieldBlock = isObject(root['serveYield']) ? root['serveYield'] : undefined;
  const degradation = isObject(root['degradation']) ? root['degradation'] : undefined;
  const comparison = isObject(root['comparison']) ? root['comparison'] : undefined;
  if (yieldBlock === undefined) problems.push(`${file}: no serveYield block`);
  if (degradation === undefined) problems.push(`${file}: no degradation block`);
  if (comparison === undefined) problems.push(`${file}: no comparison block`);
  if (yieldBlock === undefined || degradation === undefined || comparison === undefined) {
    return { ok: false, artefact: file, problems };
  }

  const renders = countOf(yieldBlock, 'renders');
  const opportunity = countOf(yieldBlock, 'opportunity');
  const repairs = countOf(yieldBlock, 'repairs');
  const breaks = countOf(yieldBlock, 'breaks');
  const inert = countOf(yieldBlock, 'inert');
  const measured = countOf(degradation, 'measured');
  const broke = countOf(degradation, 'broke');
  const repaired = countOf(degradation, 'repaired');
  const blankRight = countOf(degradation, 'blankRight');
  const netPp = numberOf(degradation, 'netPp');
  const paired = countOf(comparison, 'paired');
  const lost = countOf(comparison, 'lost');
  const gained = countOf(comparison, 'gained');
  const deltaPp = numberOf(comparison, 'deltaPp');

  const missing: readonly (readonly [string, unknown])[] = [
    ['serveYield.renders', renders],
    ['serveYield.opportunity', opportunity],
    ['serveYield.repairs', repairs],
    ['serveYield.breaks', breaks],
    ['serveYield.inert', inert],
    ['degradation.measured', measured],
    ['degradation.broke', broke],
    ['degradation.repaired', repaired],
    ['degradation.blankRight', blankRight],
    ['degradation.netPp', netPp],
    ['comparison.paired', paired],
    ['comparison.lost', lost],
    ['comparison.gained', gained],
    ['comparison.deltaPp', deltaPp],
  ];
  for (const [name, value] of missing) {
    if (value === undefined) problems.push(`${file}: ${name} is not a non-negative number`);
  }
  if (problems.length > 0) return { ok: false, artefact: file, problems };

  // R204: a transient fold whose summariser failed cannot quote its served share, and this is the round that has
  // to say so rather than the round after it.
  //
  // `serveYield.renders` counts the packs the *facade* served. On every arm before this one that was also what the
  // agent read, so served and injected were the same population and the identity `inert = served − repaired −
  // broke` had one denominator. On the transient arm the block is the summariser's input: an episode whose
  // guidance call failed carried nothing at all while its block still counted as rendered, and every failure
  // would therefore be booked as an inert pack — inflating the one number this line of work is about. The fold is
  // refused rather than adjusted, because subtracting failures from renders would publish a share over a
  // population no field of the artefact carries.
  const treatmentBlock = isObject(root['treatment']) ? root['treatment'] : {};
  if (treatmentBlock['serveBody'] === 'guidance') {
    // The pair's own reading first, then the phase's: a fold read from a driver artefact carries the census under
    // `memory`, and one read from a pair under `transient`. One gate, two documents, no third copy of the name.
    const transientBlock = isObject(root['transient']) ? root['transient'] : {};
    const memoryBlock = isObject(root['memory']) ? root['memory'] : {};
    const fromPair = isObject(transientBlock['guidance']) ? transientBlock['guidance'] : undefined;
    const fromPhase = isObject(memoryBlock['guidance']) ? memoryBlock['guidance'] : undefined;
    const guidanceBlock = fromPair ?? fromPhase;
    if (guidanceBlock === undefined) {
      problems.push(
        `${file}: the pack was a sentence and the fold carries no guidance census, so its served share is unreadable`,
      );
    } else {
      const failures = countOf(guidanceBlock, 'failures');
      const refusals = countOf(guidanceBlock, 'refusals');
      const calls = countOf(guidanceBlock, 'calls');
      if (failures === undefined || refusals === undefined || calls === undefined) {
        problems.push(`${file}: the guidance census carries no call, refusal and failure count`);
      } else if (failures > 0) {
        problems.push(
          `${file}: ${failures} of ${calls} guidance calls failed, so the rendered count is not the injected one`,
        );
      } else if (refusals > 0) {
        // The first dispatch of this arm came back with `failures: 0` and `refusals: 34` of 40, and the gate as
        // written above read that as a fold it could quote. A refusal injects nothing exactly as a failure does —
        // the difference is who declined — so the population that carried a body is the `sentences`, and the
        // rendered count is the facade's. 85% of that fold's share was therefore about packs nobody read.
        problems.push(
          `${file}: ${refusals} of ${calls} guidance call(s) answered NONE, so the rendered count is not the ` +
            'injected one — an episode with no sentence carried no pack',
        );
      }
    }
  }

  // Narrowed together so the identities below read as the arithmetic they are.
  const r = renders as number;
  const measuredN = measured as number;
  const brokeN = broke as number;
  const repairedN = repaired as number;
  const blankRightN = blankRight as number;
  const inertN = inert as number;

  if (measuredN === 0) {
    problems.push(`${file}: measured is zero, so no share has a denominator`);
    return { ok: false, artefact: file, problems };
  }
  // A repair is possible only where the control was wrong, a break only where it was right.
  if (repairedN > measuredN - blankRightN || brokeN > blankRightN) {
    problems.push(
      `${file}: degradation is impossible — ${repairedN} repaired of ${measuredN - blankRightN} eligible, ` +
        `${brokeN} broke of ${blankRightN} at risk`,
    );
  }
  if (brokeN !== (breaks as number) || repairedN !== (repairs as number) || measuredN !== r) {
    problems.push(
      `${file}: census disagrees — serveYield says ${String(breaks)} broke / ${String(repairs)} repaired / ${r} ` +
        `rendered, degradation says ${brokeN} / ${repairedN} / ${measuredN}`,
    );
  }
  if (inertN !== r - (repairs as number) - (breaks as number)) {
    problems.push(
      `${file}: inert does not close — ${inertN} inert against ${r} rendered and ` +
        `${(repairs as number) + (breaks as number)} engaged`,
    );
  }
  if (lost !== brokeN || gained !== repairedN || paired !== measuredN) {
    problems.push(
      `${file}: comparison disagrees — lost/gained/paired ${String(lost)}/${String(gained)}/${String(paired)} ` +
        `against ${brokeN}/${repairedN}/${measuredN}`,
    );
  }
  const expectedPp = ((repairedN - brokeN) / measuredN) * 100;
  if (Math.abs((netPp as number) - expectedPp) > CLOSE_ENOUGH_PP || Math.abs((deltaPp as number) - (netPp as number)) > CLOSE_ENOUGH_PP) {
    problems.push(
      `${file}: net does not close — ${String(netPp)} pp against ${expectedPp.toFixed(4)} pp from the ledger ` +
        `and ${String(deltaPp)} pp from the comparison`,
    );
  }
  if (problems.length > 0) return { ok: false, artefact: file, problems };

  return {
    ok: true,
    ledger: {
      artefact: file,
      treatment: treatmentKeyOf(root['treatment']),
      renders: r,
      opportunity: opportunity as number,
      repaired: repairedN,
      broke: brokeN,
      inert: inertN,
      measured: measuredN,
      blankRight: blankRightN,
      netPp: netPp as number,
      deltaPp: deltaPp as number,
      inertShare: inertN / r,
      engagedShare: (repairedN + brokeN) / r,
      breakPremium: brokeN - repairedN,
      repairsPerBreak: brokeN === 0 ? null : repairedN / brokeN,
    },
  };
}

/** A pool of folds that share one treatment, or the whole corpus when the caller asks for that. */
export type PooledLedger = {
  readonly treatment: string;
  readonly folds: readonly string[];
  readonly renders: number;
  readonly measured: number;
  readonly repaired: number;
  readonly broke: number;
  readonly inert: number;
  readonly opportunity: number;
  readonly inertShare: number;
  /** The Wilson interval on `inertShare`, over served packs. */
  readonly inertInterval: readonly [number, number];
  readonly engagedShare: number;
  readonly breakPremium: number;
  readonly repairsPerBreak: number | null;
  readonly deltaPp: number;
  /**
   * How many breakages a gate must prevent for this pool's delta to stop being negative.
   *
   * Zero when the pool is already positive: the question "how many must go" has no answer for a pool that
   * does not need the repair, and printing `0` would read as "it is fine" rather than "not applicable".
   */
  readonly breaksToFlip: number;
  /** `breaksToFlip / broke`, or `null` when nothing broke or nothing needs to. */
  readonly breakShareToFlip: number | null;
};

function poolOf(treatment: string, folds: readonly PackLedger[]): PooledLedger {
  const renders = folds.reduce((total, fold) => total + fold.renders, 0);
  const measured = folds.reduce((total, fold) => total + fold.measured, 0);
  const repaired = folds.reduce((total, fold) => total + fold.repaired, 0);
  const broke = folds.reduce((total, fold) => total + fold.broke, 0);
  const inert = folds.reduce((total, fold) => total + fold.inert, 0);
  const opportunity = folds.reduce((total, fold) => total + fold.opportunity, 0);
  const premium = broke - repaired;
  const breaksToFlip = premium >= 0 ? premium + 1 : 0;
  const interval = wilsonInterval({ accuracy: inert / renders, n: renders });
  return {
    treatment,
    folds: folds.map((fold) => fold.artefact),
    renders,
    measured,
    repaired,
    broke,
    inert,
    opportunity,
    inertShare: inert / renders,
    inertInterval: [interval.low, interval.high],
    engagedShare: (repaired + broke) / renders,
    breakPremium: premium,
    repairsPerBreak: broke === 0 ? null : repaired / broke,
    deltaPp: ((repaired - broke) / measured) * 100,
    breaksToFlip,
    breakShareToFlip: broke === 0 || breaksToFlip === 0 ? null : breaksToFlip / broke,
  };
}

/**
 * Pool the folds by treatment, in the order the treatments first appear.
 *
 * This is the correction the published −4.64 pp needed and did not have: that pool mixed R152c's bounded
 * arm (a rotation over the travel budget) with three unbounded folds, so the number was an average of two
 * mechanisms. Pooling by key separates them without discarding either, and the sign — which is what the
 * conclusion rests on — survives in both.
 */
export function pooledOf(ledgers: readonly PackLedger[]): readonly PooledLedger[] {
  const groups = new Map<string, PackLedger[]>();
  for (const ledger of ledgers) {
    const existing = groups.get(ledger.treatment);
    if (existing === undefined) groups.set(ledger.treatment, [ledger]);
    else existing.push(ledger);
  }
  return [...groups.entries()].map(([treatment, folds]) => poolOf(treatment, folds));
}

/** The whole corpus, with the treatments it mixes named rather than hidden. */
export type PackHeadline = PooledLedger & { readonly treatments: readonly string[] };

/**
 * The corpus-level reading.
 *
 * It pools across treatments on purpose — the question "is this memory mostly inert?" is about the pack, not
 * about one arm of it — and it carries the list of keys so a reader can see that it did. A corpus with no
 * fold is refused rather than pooled to zero: an empty headline would print `0% inert`, which is the most
 * misleading number this module could produce.
 */
export function headlineOf(ledgers: readonly PackLedger[]): PackHeadline {
  if (ledgers.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', 'a headline needs at least one fold to pool', { folds: 0 });
  }
  const treatments = [...new Set(ledgers.map((ledger) => ledger.treatment))];
  return { ...poolOf('all', ledgers), treatments };
}

/**
 * The two bills a priced pair carries, or `undefined` when the file cannot supply them.
 *
 * The pair writes `first` (the control arm) and `second` (the memory arm) in that order, and it writes its
 * own `bill` state beside the count. A file written before that state existed is read by the same rule
 * `arm-bill` applies to an artefact: a recorded non-zero count is a count, and a missing or zero one is
 * silence — never a measured zero.
 */
export function pairBillsOf(artefact: unknown): { readonly memory: ArmBill; readonly control: ArmBill } | undefined {
  if (!isObject(artefact)) return undefined;
  const first = isObject(artefact['first']) ? artefact['first'] : undefined;
  const second = isObject(artefact['second']) ? artefact['second'] : undefined;
  if (first === undefined || second === undefined) return undefined;
  const billOf = (block: Record<string, unknown>): ArmBill => {
    const calls = countOf(block, 'calls') ?? 0;
    const stated = block['bill'];
    const source: ArmBill['source'] =
      stated === 'census' || stated === 'count' || stated === 'absent'
        ? stated
        : calls === 0
          ? 'absent'
          : 'count';
    const promptTokens = countOf(block, 'promptTokens');
    const uncachedTokens = countOf(block, 'uncachedTokens');
    return {
      calls,
      source,
      ...(source !== 'census' || promptTokens === undefined ? {} : { promptTokens }),
      ...(source !== 'census' || uncachedTokens === undefined ? {} : { uncachedTokens }),
    };
  };
  return { control: billOf(first), memory: billOf(second) };
}

export type InertPrice =
  | {
      readonly priced: true;
      readonly injectedTokensPerEpisode: number;
      readonly inertTokensPerEpisode: number;
      readonly memoryState: ArmBill['source'];
      readonly controlState: ArmBill['source'];
    }
  | {
      readonly priced: false;
      readonly reason: string;
      readonly memoryState: ArmBill['source'];
      readonly controlState: ArmBill['source'];
    };

/**
 * What the inert share costs.
 *
 * Two censuses are required, not one: the injection price is a *difference* between the arms, so an arm
 * without tokens cannot be priced even if the other has them, and a count-only artefact is unpriced rather
 * than priced at zero. The subtraction is refused when it comes out negative — two arms of one dispatch
 * cannot have the memory arm billing fewer prompt tokens than its own control, and a negative premium
 * propagated into a chart is worse than a blank.
 */
export function inertPriceOf(
  ledger: { readonly measured: number; readonly inertShare: number },
  bills: { readonly memory: ArmBill; readonly control: ArmBill },
): InertPrice {
  const states = { memoryState: bills.memory.source, controlState: bills.control.source };
  if (bills.memory.source !== 'census' || bills.control.source !== 'census') {
    return {
      priced: false,
      ...states,
      reason:
        `both arms need a census: the memory arm is '${bills.memory.source}' and the control is ` +
        `'${bills.control.source}', and a token premium cannot be taken from a count`,
    };
  }
  const memoryTokens = bills.memory.promptTokens;
  const controlTokens = bills.control.promptTokens;
  if (memoryTokens === undefined || controlTokens === undefined) {
    return {
      priced: false,
      ...states,
      reason: 'a census without a prompt-token column prices nothing; the provider printed calls only',
    };
  }
  const injected = (memoryTokens - controlTokens) / ledger.measured;
  if (injected < 0) {
    return {
      priced: false,
      ...states,
      reason:
        `the memory arm bills fewer prompt tokens than its control (${memoryTokens} against ${controlTokens}), ` +
        'so the two arms are not one dispatch',
    };
  }
  return {
    priced: true,
    ...states,
    injectedTokensPerEpisode: injected,
    inertTokensPerEpisode: injected * ledger.inertShare,
  };
}

/** One line per fold, in the shape the gate prints. */
export function ledgerLine(ledger: PackLedger): string {
  const perBreak = ledger.repairsPerBreak === null ? 'no break to divide by' : ledger.repairsPerBreak.toFixed(2);
  return (
    `${ledger.artefact}: ${ledger.renders} served, ${ledger.inert} inert ` +
    `(${(ledger.inertShare * 100).toFixed(1)}%), ${ledger.repaired} repaired against ${ledger.broke} broke ` +
    `(${perBreak} repairs per break), ${ledger.deltaPp.toFixed(2)} pp`
  );
}

/** One line per pool. */
export function pooledLine(pooled: PooledLedger): string {
  const flip =
    pooled.breaksToFlip === 0
      ? 'already positive'
      : `${pooled.breaksToFlip} of ${pooled.broke} breaks must go (${((pooled.breakShareToFlip ?? 0) * 100).toFixed(0)}%)`;
  return (
    `${pooled.treatment}: ${pooled.folds.length} fold(s), ${pooled.renders} served, ` +
    `inert ${(pooled.inertShare * 100).toFixed(1)}% ` +
    `[${(pooled.inertInterval[0] * 100).toFixed(1)}, ${(pooled.inertInterval[1] * 100).toFixed(1)}], ` +
    `${pooled.deltaPp.toFixed(2)} pp, ${flip}`
  );
}

/** The corpus line, which names what it mixed. */
export function headlineLine(headline: PackHeadline): string {
  return `${pooledLine(headline)} — pooled over ${headline.treatments.length} treatment(s)`;
}

/** The price line, which says the state of both bills even when it cannot price them. */
export function priceLine(price: InertPrice): string {
  if (!price.priced) return `inert price: unpriced — ${price.reason}`;
  return (
    `inert price: ${price.injectedTokensPerEpisode.toFixed(1)} injected prompt tokens an episode, ` +
    `of which ${price.inertTokensPerEpisode.toFixed(1)} bought nothing`
  );
}

/**
 * The price column, one line per fold — or one line for the whole column when no fold is priced.
 *
 * Five identical refusals would read as noise; one line with the count reads as the state of the column.
 * The mixed case stays per fold, because a reader needs to know which fold the price is about.
 */
export function priceLines(price: Readonly<Record<string, InertPrice>>): readonly string[] {
  const entries = Object.entries(price);
  const unpriced = entries.filter(([, entry]) => !entry.priced);
  if (entries.length > 0 && unpriced.length === entries.length) {
    const reason = (unpriced[0]?.[1] as { readonly reason: string }).reason;
    return [`inert price: unpriced for all ${entries.length} fold(s) — ${reason}`];
  }
  return entries.map(([path, entry]) => `${path} ${priceLine(entry)}`);
}

/** The committed record: what the artefacts say, recomputed rather than transcribed. */
export type PackLedgersRecord = {
  readonly schema: string;
  readonly updatedBy: string;
  readonly folds: readonly PackLedger[];
  readonly pooled: readonly PooledLedger[];
  readonly headline: PackHeadline;
  /**
   * The price of inertness, **per fold**, keyed by the artefact it was measured on.
   *
   * Per fold rather than per corpus because a bill belongs to a dispatch: two folds paid for in two runs
   * have two injection prices, and averaging them into one number would hide the only thing a price column
   * is for. A fold whose artefact carries no census is unpriced with its own reason, so the column says how
   * many of the folds it actually covers.
   */
  readonly price: Readonly<Record<string, InertPrice>>;
};

export type LedgerSource = { readonly path: string; readonly artefact: unknown };

export type RecordRead = {
  readonly record: PackLedgersRecord | undefined;
  readonly refusals: readonly string[];
};

/**
 * Build the record from the artefacts, refusing the whole thing if any fold cannot be read.
 *
 * A record with one unreadable fold and four good ones would publish a headline over four fifths of the
 * corpus while looking complete; the refusal is what keeps the denominator honest.
 */
export function packLedgersRecord(sources: readonly LedgerSource[]): RecordRead {
  const refusals: string[] = [];
  const folds: PackLedger[] = [];
  const price: Record<string, InertPrice> = {};
  for (const source of sources) {
    const read = ledgerOf(source.artefact, source.path);
    if (!read.ok) {
      refusals.push(...read.problems);
      continue;
    }
    folds.push(read.ledger);
    const bills = pairBillsOf(source.artefact);
    price[source.path] =
      bills === undefined
        ? {
            priced: false,
            memoryState: 'absent',
            controlState: 'absent',
            reason: 'the artefact carries no arm blocks, so no bill can be attributed to this fold',
          }
        : inertPriceOf(read.ledger, bills);
  }
  if (refusals.length > 0) return { record: undefined, refusals };
  return {
    record: {
      schema: PACK_LEDGERS_SCHEMA,
      updatedBy: 'R200',
      folds,
      pooled: pooledOf(folds),
      headline: headlineOf(folds),
      price,
    },
    refusals,
  };
}

/** The fields a stored record must carry, so a hand-edited file cannot pass as one. */
function isLedgerLike(value: unknown): value is PackLedger {
  if (!isObject(value)) return false;
  const numeric = ['renders', 'measured', 'repaired', 'broke', 'inert', 'inertShare', 'breakPremium', 'deltaPp'];
  return typeof value['artefact'] === 'string' && typeof value['treatment'] === 'string' && numeric.every((key) => numberOf(value, key) !== undefined);
}

function isPooledLike(value: unknown): value is PooledLedger {
  if (!isObject(value)) return false;
  if (typeof value['treatment'] !== 'string' || !Array.isArray(value['folds'])) return false;
  const interval = value['inertInterval'];
  if (!Array.isArray(interval) || interval.length !== 2) return false;
  const numeric = ['renders', 'measured', 'repaired', 'broke', 'inert', 'inertShare', 'deltaPp', 'breaksToFlip'];
  return numeric.every((key) => numberOf(value, key) !== undefined);
}

/** Read the committed record, refusing every shape that would let a stale file pass the gate. */
export function parseLedgersRecord(value: unknown): RecordRead {
  if (!isObject(value)) return { record: undefined, refusals: ['the record is not an object'] };
  const refusals: string[] = [];
  if (value['schema'] !== PACK_LEDGERS_SCHEMA) {
    refusals.push(`schema must be '${PACK_LEDGERS_SCHEMA}', received ${JSON.stringify(value['schema'])}`);
  }
  const folds = value['folds'];
  const pooled = value['pooled'];
  const headline = value['headline'];
  const price = value['price'];
  if (!Array.isArray(folds) || !folds.every(isLedgerLike)) refusals.push('folds must be an array of ledgers');
  if (!Array.isArray(pooled) || !pooled.every(isPooledLike)) refusals.push('pooled must be an array of pools');
  if (!isPooledLike(headline) || !Array.isArray((headline as Record<string, unknown>)['treatments'])) {
    refusals.push('headline must be a pool carrying its treatments');
  }
  if (!isObject(price) || !Object.values(price).every((entry) => isObject(entry) && typeof entry['priced'] === 'boolean')) {
    refusals.push('price must map each fold to an entry carrying a `priced` flag');
  }
  if (refusals.length > 0) return { record: undefined, refusals };
  return {
    record: value as unknown as PackLedgersRecord,
    refusals,
  };
}

/**
 * Where the committed record and a fresh read disagree.
 *
 * Reported per fold rather than as one message, because the useful question a reader has is *which* number
 * moved — a re-run of one fold and a change of rule look identical to a whole-file comparison, and only the
 * second is a change in the evidence.
 */
export function driftOf(stored: PackLedgersRecord, fresh: PackLedgersRecord): readonly string[] {
  const problems: string[] = [];
  const known = new Map(stored.folds.map((fold) => [fold.artefact, fold]));
  for (const fold of fresh.folds) {
    const before = known.get(fold.artefact);
    if (before === undefined) {
      problems.push(`${fold.artefact}: absent from the committed record`);
      continue;
    }
    known.delete(fold.artefact);
    if (JSON.stringify(before) !== JSON.stringify(fold)) {
      problems.push(`${fold.artefact}: the committed ledger has drifted`);
    }
  }
  for (const artefact of known.keys()) {
    problems.push(`${artefact}: the committed record names a fold the artefacts no longer carry`);
  }
  if (JSON.stringify(stored.pooled) !== JSON.stringify(fresh.pooled)) problems.push('pooled: the pools have drifted');
  if (JSON.stringify(stored.headline) !== JSON.stringify(fresh.headline)) problems.push('headline: the corpus reading has drifted');
  if (JSON.stringify(stored.price) !== JSON.stringify(fresh.price)) problems.push('price: the price column has drifted');
  return problems;
}
