/**
 * How far one item may travel, when the store is smaller than the phase.
 *
 * ## The reading this exists for
 *
 * R143's two folds answered every request with a pack, and the packs were one item each. On the fold whose
 * store kept eleven servable items, **one item took twelve of forty renders**, two of them broke a trial and
 * none repaired one — while three items that did repair something (`kept 2`, `kept 1`, `kept 1`) were served
 * five, six and one time. On the fold whose store kept three items the concentration is total: 75 renders over
 * three records, 25.0 each, and a harm share of 23.81% against the rich fold's 8.33%. The mechanism named in
 * PROGRESS 178 is *renders per servable item*, and a ranking that always answers with its favourite produces
 * it without any store being wrong: the top item is the most generic one, so it is the one served into every
 * question it barely fits.
 *
 * ## Why a share and not a count
 *
 * A fixed cap ("at most N renders") is a dose knob: it changes how often the memory speaks, and dose is a
 * different axis that this lane has already priced. The question here is **allocation at constant dose** —
 * the same number of served requests, spread over the servable set instead of piled on its head — because
 * only that separates "the store is wrong" from "the store is applied in the wrong proportion".
 *
 * So the cap is the phase's own fair share: `ceil(requests / servable)`. With forty requests and eleven
 * servable items that is four, and eleven items times four covers forty requests, so the pack can still be
 * served on every request while no item is served more than four times. Where the arithmetic cannot cover the
 * phase — three servable items against seventy-five requests is twenty-five each, which is already what the
 * ranking did — the arm is the identity, and saying so before the dispatch is the point of computing the cap
 * from the store rather than writing a constant in a header.
 *
 * ## What it is not
 *
 * It is not a gate on quality, and it does not look at outcomes: it cannot know which item is poison and it
 * does not try. Rotation is the cheapest possible test of a causal claim — *if* the harm follows concentration
 * rather than content, moving renders off the favourite must move the harm, and the repair count must not fall
 * by the same share. That is falsifiable, and it is falsified if the breaks stay where they are.
 */
import type { KnowledgePack } from '@agentix-e/microglia-core';

export type ServeRotation = 'off' | 'fair-share';

export const SERVE_ROTATIONS: readonly ServeRotation[] = ['off', 'fair-share'];

export type ServeRotationPlan = {
  /** The mode this dispatch declared, absent when nobody declared one. */
  readonly mode?: ServeRotation;
  /** Whether the switch was set at all; the default and an undeclared value are different experiments. */
  readonly declared: boolean;
};

/**
 * The rotation a dispatch asked for.
 *
 * Unset means **the driver excludes nothing**, which is what every committed artefact ran with, and it is
 * stated as `undefined` rather than as `'off'` so a registration that never heard of the switch keeps the
 * request byte-identical to the runs it is compared against. A spelling outside the two names is refused
 * before the phase: an unknown mode would run the identity and report a treatment.
 */
export function resolveServeRotationPlan(
  env: Readonly<Record<string, string | undefined>>,
): ServeRotationPlan {
  const raw = (env['TAU_SERVE_ROTATION'] ?? '').trim();
  if (raw === '') return { declared: false };
  if (!SERVE_ROTATIONS.includes(raw as ServeRotation)) {
    throw new Error(
      `TAU_SERVE_ROTATION must be unset or one of ${SERVE_ROTATIONS.join(', ')}, not '${raw}': ` +
        'an unknown spelling would run no rotation and report one',
    );
  }
  return { mode: raw as ServeRotation, declared: true };
}

export type RotationCap = {
  /** Renders one item may take. Zero when the phase or the store is empty, which serves nothing. */
  readonly cap: number;
  /** Requests the phase will make, as the driver counted them. */
  readonly requests: number;
  /** Items the store can serve after its floor. */
  readonly servable: number;
};

/**
 * The cap, from the phase's own arithmetic.
 *
 * `ceil(requests / servable)` and never below one: a store that could serve fewer than one render per item
 * would be a store that cannot answer anything, and rounding that to zero would silently disable the memory
 * instead of measuring a spread. The two empty cases return zero and are read as "the cap was not needed"
 * rather than as a treatment — `RotationReading.servable` is what tells them apart.
 */
export function rotationCapOf(input: { readonly requests: number; readonly servable: number }): RotationCap {
  const requests = Math.max(0, Math.trunc(input.requests));
  const servable = Math.max(0, Math.trunc(input.servable));
  if (requests === 0 || servable === 0) return { cap: 0, requests, servable };
  return { cap: Math.max(1, Math.ceil(requests / servable)), requests, servable };
}

export type RotationReading = {
  readonly cap: number;
  readonly requests: number;
  readonly servable: number;
  /** Ids served at least once. */
  readonly distinct: number;
  /** Renders across every request, which is the quantity `cap × servable` bounds. */
  readonly renders: number;
  /** Ids that reached the cap, in id order. */
  readonly exhausted: readonly string[];
  /** Requests issued while every servable item was already exhausted: the pack could only be empty. */
  readonly starved: number;
  readonly maxRenders: number;
};

/**
 * The counter a phase keeps to enforce the cap.
 *
 * Two calls per request, in this order: `next()` before the recall (which returns the ids this request may
 * not be served) and `record()` after it (which charges the ids the pack actually carried). Splitting them is
 * what makes the exclusion observable: a request whose pack was empty charges nothing, so a store that
 * answered with nothing cannot be read as one whose items were all exhausted.
 *
 * The ledger is mutable state in the driver, which is unusual for this lane and deliberate. A pure function
 * of the request order would need the whole recall history to answer the one question the request asks — the
 * renders so far — and rebuilding that per request is the same state with a cost.
 */
export class ServeRotationLedger {
  private readonly cap: number;
  private readonly servable: number;
  private readonly counts = new Map<string, number>();
  private requests = 0;
  private renders = 0;
  private starved = 0;

  public constructor(cap: RotationCap) {
    this.cap = cap.cap;
    this.servable = cap.servable;
  }

  /**
   * The ids this request may not be served, and whether anything is left.
   *
   * A request is *starved* when the store could serve nothing because every servable item had already
   * travelled: the count exists so a phase whose memory fell silent can say whether it fell silent because
   * the rotation had spent it or because the store had nothing to say, which are different findings.
   */
  public next(): { readonly exclude: readonly string[]; readonly starved: boolean } {
    this.requests += 1;
    const exclude = this.exhausted();
    const starved = this.servable > 0 && exclude.length >= this.servable;
    if (starved) this.starved += 1;
    return { exclude, starved };
  }

  /** Charge one render to every id the pack carried. */
  public record(ids: readonly string[]): void {
    if (this.cap === 0) return;
    for (const id of ids) {
      this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
      this.renders += 1;
    }
  }

  private exhausted(): readonly string[] {
    if (this.cap === 0) return [];
    const out: string[] = [];
    for (const [id, count] of this.counts) if (count >= this.cap) out.push(id);
    return out.sort((left, right) => left.localeCompare(right));
  }

  public reading(): RotationReading {
    let maxRenders = 0;
    for (const count of this.counts.values()) if (count > maxRenders) maxRenders = count;
    return {
      cap: this.cap,
      requests: this.requests,
      servable: this.servable,
      distinct: this.counts.size,
      renders: this.renders,
      exhausted: this.exhausted(),
      starved: this.starved,
      maxRenders,
    };
  }
}

/**
 * The ids one pack carried, as the rotation charges them.
 *
 * The pack's `ids` and never its `rendered` text: a folded pack renders one line for several items, and the
 * question the cap answers is how many times an *item* was put in front of an episode.
 */
export function rotationsOf(pack: Pick<KnowledgePack, 'ids'>): readonly string[] {
  return pack.ids;
}

/**
 * One line for the run log.
 *
 * The maximum comes before the cap so the two numbers are read as one sentence — "12 renders under a cap of
 * 4" is a rotation that did not run, while "4 under 4" is one that did — and the starved count is printed
 * only when it is non-zero, because a phase that served every request has nothing to explain.
 */
export function rotationLine(reading: RotationReading): string {
  if (reading.servable === 0) {
    return 'serve rotation: absent (the store can serve nothing, so no share exists)';
  }
  if (reading.cap === 0) {
    return `serve rotation: absent (no request was made; fair share over ${String(reading.servable)} item(s) is unmeasured)`;
  }
  const starved = reading.starved === 0 ? '' : `, ${String(reading.starved)} starved request(s)`;
  return (
    `serve rotation: cap ${String(reading.cap)} per item from ` +
    `${String(reading.requests)} request(s) over ${String(reading.servable)} servable item(s); ` +
    `max ${String(reading.maxRenders)}, ${String(reading.renders)} render(s) over ${String(reading.distinct)} item(s), ` +
    `${String(reading.exhausted.length)} exhausted${starved}`
  );
}
