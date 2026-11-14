/**
 * What the store actually said, reduced to what a readback needs to read.
 *
 * R51's census could say "16 of 16 items carry a condition" and nothing else: the artefact
 * recorded a count of conditions and not one of them. The readback then had to guess whether
 * the distiller had written its trigger in the user's register or in the procedure's, and the
 * two predict opposite coverage numbers — the first is the mechanism working, the second is
 * the mechanism writing something that no question can match.
 *
 * So the artefact carries the items. Bounded, because an artefact is a document and a store
 * can be large: the first `limit` items in the order the store lists them, each statement and
 * condition truncated at `maxChars`, with `truncated` reporting how many were left out. A
 * sample that silently drops half a store would make the register of the sample look like the
 * register of the store.
 */

import { countDistinctTasks } from '@agentix-e/microglia-core';

export type StoreItemRecord = {
  readonly id: string;
  readonly kind: string;
  /**
   * The item's lifecycle status, because the sample is not the population `conditioned` counts.
   *
   * `store.conditioned` is over *servable* items — active, and inside the recall scope — while
   * the sample is the first `limit` items the store lists. A readback that counted conditions
   * in the sample and compared the total to `conditioned` would be comparing two populations,
   * which is precisely the defect the coverage readings were repaired for. The status is what
   * lets a reader intersect the sample with the population the count was taken over, and it is
   * required rather than optional so no sample can be written that omits it.
   */
  readonly status: string;
  /** The condition as written, truncated. Absent when the item states none. */
  readonly when?: string;
  /** The claim as written, truncated. */
  readonly statement: string;
  readonly trust: number;
  readonly scope: { readonly domain?: string };
  /**
   * Distinct tasks among the item's evidence — the support the score actually credits.
   *
   * R55.0. The competitive record's `sup3` arm admits a claim only when at least three distinct
   * tasks derived it, and until this count existed nothing in this project asked whether anything
   * recurs: `support` is a sum of weights, and one correction at trust 0.9 clears the 0.8 floor by
   * itself. The count is taken with the score's own grouping (a task once, whatever its attempts;
   * a run stands in when no task is named), so a recurrence reading cannot disagree with the
   * fusion it explains.
   */
  readonly supportTasks: number;
  /** Evidence rows the item holds, which is the other half of the same question. */
  readonly evidence: number;
  /**
   * Why the item is in the state it is in, when the store says.
   *
   * R59. The recurrence pass retires a member and names the survivor that absorbed it
   * (`consolidated:<id>`), and without that pointer a sample holds the retired item and the
   * corroborated survivor with nothing joining them: a readback could report *that* a group merged
   * and never say *which* pair, which is the one thing the registration asks it to judge. Carried
   * as written rather than parsed, because the prefix is the store's vocabulary and a projection
   * that interpreted it would break when the store gains another reason.
   */
  readonly statusReason?: string;
  /**
   * The side the distiller recorded for this item, when it recorded one.
   *
   * R110. The retrospection lane consolidates corrections and may not use successes, and no dump
   * before this field carried the distinction: `kind` is what the model chose to write, so a reader
   * could only guess, and the guess read every τ² record as a success. Absent on a store written
   * before the field existed, which is why the reader counts silence rather than assuming.
   */
  readonly polarity?: 'repair' | 'pass';
};

export type StoreItemSample = {
  readonly items: readonly StoreItemRecord[];
  readonly limit: number;
  readonly maxChars: number;
  /** Items the store held beyond the sample. */
  readonly omitted: number;
  /** Items in the sample whose statement or condition was cut to fit `maxChars`. */
  readonly truncated: number;
};

const ELLIPSIS = '…';

function clip(text: string, maxChars: number): { readonly text: string; readonly cut: boolean } {
  if (text.length <= maxChars) return { text, cut: false };
  return { text: `${text.slice(0, Math.max(0, maxChars - 1))}${ELLIPSIS}`, cut: true };
}

export function storeItemSample(
  items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly when?: string;
    readonly statement: string;
    readonly trust: number;
    readonly scope: { readonly domain?: string };
    readonly evidence: readonly { readonly taskId?: string; readonly runId: string }[];
    /** The store's own reason for the item's status, which the recurrence pass uses to name a survivor. */
    readonly statusReason?: string;
    /** The side the distiller recorded, absent on a store that predates the field. */
    readonly polarity?: 'repair' | 'pass';
  }[],
  options: { readonly limit?: number; readonly maxChars?: number } = {},
): StoreItemSample {
  const limit = Math.max(1, Math.trunc(options.limit ?? 64));
  const maxChars = Math.max(8, Math.trunc(options.maxChars ?? 240));
  let truncated = 0;
  const sampled = items.slice(0, limit).map((item) => {
    const statement = clip(item.statement, maxChars);
    const when = item.when === undefined ? undefined : clip(item.when, maxChars);
    if (statement.cut || when?.cut === true) truncated += 1;
    return {
      id: item.id,
      kind: item.kind,
      status: item.status,
      ...(when === undefined ? {} : { when: when.text }),
      statement: statement.text,
      trust: item.trust,
      scope: item.scope.domain === undefined ? {} : { domain: item.scope.domain },
      supportTasks: countDistinctTasks(item.evidence),
      evidence: item.evidence.length,
      ...(item.statusReason === undefined ? {} : { statusReason: item.statusReason }),
      ...(item.polarity === undefined ? {} : { polarity: item.polarity }),
    };
  });
  return { items: sampled, limit, maxChars, omitted: Math.max(0, items.length - sampled.length), truncated };
}
