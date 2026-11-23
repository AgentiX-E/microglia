/**
 * R201's dose–response, read from the ladders the folds already carry.
 *
 * ## The question the registration asks
 *
 * R200 counts **78.1% [72.6, 82.8]** of 251 served packs *inert*: the episode's verdict was the same with the pack
 * as without it. The obvious gate follows — withhold a pack that cannot change anything and the accuracy is
 * unchanged by construction, so only the bill moves. `speakMargin` is that gate: a pack is served only when its top
 * two candidates are further apart than the margin, and the host has recorded, for every request, the margin its
 * ranking produced.
 *
 * ## Why this is a reader and not a purchase
 *
 * R201 was registered as three dispatches (≈0%, ≈35%, ≈70% withheld) at ¥4–5. They are not needed. Every fold this
 * lane has bought carries `serveSweep`, a ladder that prices *every* rung against the same episodes: for each rung,
 * how many trials still carry a pack, how many of those repaired, how many broke. The three margins are the rungs,
 * and the curve over them is a column of numbers that already exist. What was missing was a module that reads the
 * ladder as a dose–response and states the two things a gate has to be judged on.
 *
 * ## Two readings, and they are not the same number
 *
 * - **`inertServed`** — the ledger's reading: of the packs that survived the rung, how many changed nothing. This
 *   is the question "does the gate select on inertness", and it is the one that decides whether a margin is a
 *   mechanism or a dose knob.
 * - **`inertAll`** — the gate's own reading: of every trial, how many were unchanged. A withheld pack counts as
 *   inert because withholding cannot change a verdict the pack did not change, so this number rises towards 1 as
 *   the rung withholds more, by construction rather than by finding.
 *
 * A module that reported only the second would make any gate look like a success. The first is why `selectivity`
 * exists: `prevention − repairLoss`, i.e. how much more of the corpus's breaks a rung withholds than of its repairs.
 * A dose knob has selectivity ≈ 0 (it removes both in proportion to their base rates); a gate that selects on
 * inertness has selectivity > 0 by a wide margin. A gate that removes *repairing* packs first has it below zero.
 *
 * ## What it refuses
 *
 * - `carries no rung rows` — a fold with no ladder prices nothing, and a zero in its place would be a price.
 * - `trials is 0` — no share with a denominator.
 * - `says N withheld` against `trials − served` — the ladder's own arithmetic, so its withheld count is not a count.
 * - `engages N trial(s) of M served` — a repair or a break on a trial that carried no pack.
 * - `appears twice` — one fold pricing a rung twice is two curves under one name.
 * - `does not carry rung X` — pooling needs one ladder, not an intersection nobody stated.
 * - `no fold prices rung 0` — without the ungated row there is no baseline, and every delta is against nothing.
 */
export const RUNG_DOSE_SCHEMA = 'microglia.rung-dose/1';

/** One rung as one fold's `serveSweep` states it. */
export type RungRow = {
  readonly rung: number;
  /** Trials that still carried at least one pack at this rung. */
  readonly served: number;
  /** Trials whose every pack the rung withheld — the control's verdict, by the sweep's own model. */
  readonly withheld: number;
  /** Survivors whose verdict the pack repaired. */
  readonly kept: number;
  /** Survivors whose verdict the pack broke. */
  readonly broke: number;
};

/** One fold's ladder, as much of it as this question needs. */
export type DoseFold = {
  readonly artefact: string;
  readonly treatment: string;
  readonly trials: number;
  readonly rows: readonly RungRow[];
};

/** R201's registered acceptance: a gate that keeps fewer repairs than this is a filter on the memory itself. */
export const DEFAULT_GATES = { minRepairs: 4, minPrevented: 4 } as const;

export type DoseGates = { readonly minRepairs: number; readonly minPrevented: number };

/** One rung of the pooled curve. */
export type DosePoint = {
  readonly rung: number;
  /** Trials the rung still serves, pooled. */
  readonly served: number;
  /** Trials the rung withholds, pooled. */
  readonly withheld: number;
  readonly kept: number;
  readonly broke: number;
  /** Breaks the corpus had at rung 0 minus the breaks it has here. */
  readonly prevented: number;
  /** Repairs the corpus had at rung 0 minus the repairs it has here. */
  readonly lostRepairs: number;
  /** `(served - kept - broke) / served` — the ledger's reading, over the packs this rung still serves. */
  readonly inertServed: number;
  /** `(trials - kept - broke) / trials` — the gate's reading, in which a withheld pack is inert by construction. */
  readonly inertAll: number;
  /** `kept / repairs at rung 0` — how much of the memory's value survives. */
  readonly retention: number;
  /** `prevented / breaks at rung 0` — how much of its harm the rung removes. */
  readonly prevention: number;
  /**
   * `prevention - repairLoss`: positive means the rung withholds breaks faster than it loses repairs.
   *
   * `null` when the corpus repaired nothing at rung 0 — a gate cannot be said to lose repairs it never had, and
   * arithmetic would have made that corpus read as maximally anti-selective (`-1`) on the strength of a
   * denominator nobody owned.
   */
  readonly selectivity: number | null;
  readonly netPp: number;
};

export type DoseResponse = {
  readonly schema: string;
  readonly corpus: {
    readonly trials: number;
    readonly repairs: number;
    readonly breaks: number;
    readonly folds: number;
  };
  readonly gates: DoseGates;
  readonly points: readonly DosePoint[];
  /**
   * The lowest rung that keeps `minRepairs` and prevents `minPrevented`, or `null`.
   *
   * `null` rather than the best-delta rung, because the best delta is usually the rung that withholds everything:
   * a curve always ends at a trivially clean point, and naming it would be the arithmetic equivalent of a gate
   * that serves nothing.
   */
  readonly shippable: { readonly rung: number; readonly kept: number; readonly prevented: number } | null;
};

export type DoseOutcome =
  | { readonly ok: true; readonly dose: DoseResponse }
  | { readonly ok: false; readonly refusals: readonly string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOf(block: Record<string, unknown>, key: string): number | undefined {
  const value = block[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** A rung, printed the way the artefact keys it: `0`, `0.05`, `0.3`. */
function rungText(rung: number): string {
  return String(rung);
}

/**
 * One fold's ladder, or the reason it has none.
 *
 * Read from the artefact rather than from the record, because the record is derived from the artefacts and a
 * reader that trusted the record could not rebuild it.
 */
export function doseFoldOf(
  artefact: unknown,
  file: string,
): { readonly fold?: DoseFold; readonly problems: readonly string[] } {
  const root = isObject(artefact) ? artefact : {};
  const sweep = isObject(root['serveSweep']) ? root['serveSweep'] : undefined;
  if (sweep === undefined) return { problems: [`${file}: no serveSweep block`] };
  const trials = countOf(sweep, 'trials');
  if (trials === undefined) return { problems: [`${file}: trials is not a count`] };
  const rows = sweep['rows'];
  if (!Array.isArray(rows) || rows.length === 0) return { problems: [`${file}: carries no rung rows`] };
  const out: RungRow[] = [];
  const problems: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isObject(row)) {
      problems.push(`${file}: row ${String(index)} is not an object`);
      continue;
    }
    const rung = typeof row['rung'] === 'number' && Number.isFinite(row['rung']) ? row['rung'] : undefined;
    if (rung === undefined) {
      problems.push(`${file}: row ${String(index)} has no rung`);
      continue;
    }
    const served = countOf(row, 'served');
    const withheld = countOf(row, 'withheld');
    const kept = countOf(row, 'kept');
    const broke = countOf(row, 'broke');
    if (served === undefined || withheld === undefined || kept === undefined || broke === undefined) {
      problems.push(`${file}: rung ${rungText(rung)} is not a count of served, withheld, kept and broke`);
      continue;
    }
    out.push({ rung, served, withheld, kept, broke });
  }
  if (problems.length > 0) return { problems };
  const treatment = isObject(root['treatment']) ? JSON.stringify(root['treatment']) : 'unstated';
  return { fold: { artefact: file, treatment, trials, rows: out }, problems: [] };
}

/**
 * The pooled curve, or every reason the folds are not one corpus.
 *
 * Every refusal is collected: a fold that breaks the arithmetic usually breaks the next check too, and a repair is
 * one round either way.
 */
export function doseResponseOf(
  folds: readonly DoseFold[],
  gates: DoseGates = DEFAULT_GATES,
): DoseOutcome {
  if (folds.length === 0) {
    return { ok: false, refusals: ['a dose–response needs a fold: an empty corpus prices no rung'] };
  }
  const refusals: string[] = [];
  for (const fold of folds) {
    if (fold.trials === 0) {
      refusals.push(`${fold.artefact}: trials is 0, because no share would have a denominator`);
      continue;
    }
    if (fold.rows.length === 0) {
      refusals.push(`${fold.artefact}: carries no rung rows, so it prices nothing`);
      continue;
    }
    const seen = new Set<number>();
    for (const row of fold.rows) {
      if (seen.has(row.rung)) {
        refusals.push(`${fold.artefact}: rung ${rungText(row.rung)} appears twice`);
        continue;
      }
      seen.add(row.rung);
      if (row.withheld !== fold.trials - row.served) {
        refusals.push(
          `${fold.artefact}: rung ${rungText(row.rung)} says ${String(row.withheld)} withheld against ` +
            `${String(fold.trials)} trial(s) and ${String(row.served)} served`,
        );
      }
      if (row.kept + row.broke > row.served) {
        refusals.push(
          `${fold.artefact}: rung ${rungText(row.rung)} engages ${String(row.kept + row.broke)} trial(s) of ` +
            `${String(row.served)} served`,
        );
      }
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  // One ladder, not an intersection: a rung one fold never priced is a rung whose pool would silently exclude that
  // fold, which is how a curve becomes a property of whichever experiment happened to report it.
  const head = folds[0]!;
  for (const fold of folds.slice(1)) {
    for (const row of head.rows) {
      if (!fold.rows.some((mine) => mine.rung === row.rung)) {
        refusals.push(
          `the folds do not share one ladder: ${fold.artefact} does not carry rung ${rungText(row.rung)}, which ` +
            `${head.artefact} prices`,
        );
      }
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const baseline = head.rows.find((row) => row.rung === 0);
  if (baseline === undefined) {
    return { ok: false, refusals: ['no fold prices rung 0, so the curve has no baseline to be a delta against'] };
  }

  const trials = folds.reduce((total, fold) => total + fold.trials, 0);
  const zero = folds.reduce(
    (total, fold) => {
      const row = fold.rows.find((mine) => mine.rung === 0)!;
      return { served: total.served + row.served, kept: total.kept + row.kept, broke: total.broke + row.broke };
    },
    { served: 0, kept: 0, broke: 0 },
  );
  const rungs = [...head.rows.map((row) => row.rung)].sort((left, right) => left - right);

  const points: DosePoint[] = rungs.map((rung) => {
    let served = 0;
    let withheld = 0;
    let kept = 0;
    let broke = 0;
    for (const fold of folds) {
      const row = fold.rows.find((mine) => mine.rung === rung)!;
      served += row.served;
      withheld += row.withheld;
      kept += row.kept;
      broke += row.broke;
    }
    const prevented = zero.broke - broke;
    const lostRepairs = zero.kept - kept;
    const retention = zero.kept === 0 ? 0 : kept / zero.kept;
    const prevention = zero.broke === 0 ? 0 : prevented / zero.broke;
    return {
      rung,
      served,
      withheld,
      kept,
      broke,
      prevented,
      lostRepairs,
      // A rung that withholds every pack serves nothing, and an inert share over no packs has no denominator: the
      // gate's own reading survives that case (every trial is inert), the ledger's does not, and `0` would be a
      // mean of nothing. `trials` needs no such clause — a fold with no trial is refused before this point, so the
      // corpus is never empty and the gate's denominator always exists.
      inertServed: served === 0 ? 0 : (served - kept - broke) / served,
      inertAll: (trials - kept - broke) / trials,
      retention,
      prevention,
      selectivity: zero.kept === 0 ? null : prevention - (1 - retention),
      netPp: ((kept - broke) / trials) * 100,
    };
  });

  const shippable =
    points.find((point) => point.kept >= gates.minRepairs && point.prevented >= gates.minPrevented) ?? null;

  return {
    ok: true,
    dose: {
      schema: RUNG_DOSE_SCHEMA,
      corpus: { trials, repairs: zero.kept, breaks: zero.broke, folds: folds.length },
      gates: { minRepairs: gates.minRepairs, minPrevented: gates.minPrevented },
      points,
      shippable:
        shippable === null ? null : { rung: shippable.rung, kept: shippable.kept, prevented: shippable.prevented },
    },
  };
}

/** One rung on one line, in the form a readback greps for. */
export function dosePointLine(point: DosePoint): string {
  const sign = point.netPp >= 0 ? '+' : '';
  return (
    `rung ${rungText(point.rung)}: ${String(point.served)} served, ${String(point.withheld)} withheld; ` +
    `${String(point.kept)} kept, ${String(point.broke)} broke (${String(point.prevented)} break(s) prevented, ` +
    `${String(point.lostRepairs)} repair(s) lost); inert ${(point.inertServed * 100).toFixed(1)}% of served, ` +
    `selectivity ${
      point.selectivity === null
        ? 'n/a'
        : `${point.selectivity >= 0 ? '+' : ''}${(point.selectivity * 100).toFixed(1)}pp`
    }, ` +
    `net ${sign}${point.netPp.toFixed(2)}pp`
  );
}

/**
 * The verdict, in one sentence.
 *
 * Two answers, and the second is the one that matters: a curve with no qualifying rung refutes the gate as a
 * mechanism and leaves it as a dose knob, which is a cheaper and more useful finding than a number.
 */
export function shippableLine(dose: DoseResponse): string {
  const gates = `${String(dose.gates.minRepairs)} repair(s) and ${String(dose.gates.minPrevented)} break(s)`;
  if (dose.shippable === null) {
    return (
      `no rung keeps ${gates}: the margin is a dose knob on this corpus, ` +
      `not a gate over inert packs`
    );
  }
  return (
    `rung ${rungText(dose.shippable.rung)} keeps ${String(dose.shippable.kept)} repair(s) and prevents ` +
    `${String(dose.shippable.prevented)} break(s)`
  );
}

/**
 * The stored record, read with the refusals a stored record needs.
 *
 * A schema it does not know is refused rather than parsed: this file is the only record of a curve that cost
 * nothing to derive and would cost a dispatch to recover.
 */
export function parseRungDose(value: unknown): { readonly record?: DoseResponse; readonly refusals: readonly string[] } {
  if (!isObject(value)) return { refusals: ['the record is not an object'] };
  if (value['schema'] !== RUNG_DOSE_SCHEMA) {
    return { refusals: [`the record's schema is '${String(value['schema'])}', not '${RUNG_DOSE_SCHEMA}'`] };
  }
  const points = value['points'];
  if (!Array.isArray(points)) return { refusals: ['the record carries no points list'] };
  const refusals: string[] = [];
  const numeric = [
    'served',
    'withheld',
    'kept',
    'broke',
    'prevented',
    'lostRepairs',
    'inertServed',
    'inertAll',
    'retention',
    'prevention',
    'selectivity',
    'netPp',
  ] as const;
  for (const [index, point] of points.entries()) {
    if (!isObject(point)) {
      refusals.push(`point ${String(index)} is not an object`);
      continue;
    }
    if (typeof point['rung'] !== 'number' || !Number.isFinite(point['rung'])) {
      refusals.push(`point ${String(index)} has no rung`);
      continue;
    }
    const missing = numeric.find((field) => typeof point[field] !== 'number');
    if (missing !== undefined) refusals.push(`point ${String(index)} is missing ${missing}`);
  }
  const corpus = value['corpus'];
  if (!isObject(corpus)) refusals.push('the record carries no corpus block');
  const gates = value['gates'];
  if (!isObject(gates)) refusals.push('the record carries no gates block');
  if (refusals.length > 0) return { refusals };
  return { record: value as unknown as DoseResponse, refusals: [] };
}

/**
 * The committed record against a fresh derivation.
 *
 * Names the rung rather than printing "the record moved": a curve has ten points and the reader needs to know which
 * one, because a drift at the last rung and a drift at the first are different findings — the first is a gate that
 * withholds everything, the second is the corpus itself.
 */
export function driftOfDose(committed: DoseResponse, fresh: DoseResponse): readonly string[] {
  const problems: string[] = [];
  if (JSON.stringify(committed.corpus) !== JSON.stringify(fresh.corpus)) {
    problems.push(
      `the corpus has drifted: ${JSON.stringify(committed.corpus)} against ${JSON.stringify(fresh.corpus)}`,
    );
  }
  if (JSON.stringify(committed.gates) !== JSON.stringify(fresh.gates)) {
    problems.push(
      `the threshold has drifted: ${JSON.stringify(committed.gates)} against ${JSON.stringify(fresh.gates)}`,
    );
  }
  if (JSON.stringify(committed.shippable) !== JSON.stringify(fresh.shippable)) {
    problems.push(
      `the verdict has drifted: ${JSON.stringify(committed.shippable)} against ${JSON.stringify(fresh.shippable)}`,
    );
  }
  for (const point of committed.points) {
    const now = fresh.points.find((mine) => mine.rung === point.rung);
    if (now === undefined) {
      problems.push(`rung ${rungText(point.rung)} is no longer priced by the artefacts`);
      continue;
    }
    if (JSON.stringify(point) !== JSON.stringify(now)) {
      problems.push(`rung ${rungText(point.rung)} has drifted: ${JSON.stringify(point)} against ${JSON.stringify(now)}`);
    }
  }
  for (const point of fresh.points) {
    if (!committed.points.some((mine) => mine.rung === point.rung)) {
      problems.push(`rung ${rungText(point.rung)} is priced by the artefacts and absent from the committed record`);
    }
  }
  return problems;
}
