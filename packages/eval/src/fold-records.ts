/**
 * Two pair artefacts turned into the two fold records a cross-fit is run on.
 *
 * ## Why this exists at all
 *
 * `crossFitPool` needs three things from each fold: the per-task paired outcomes, the half its store learned
 * from (so the leak check can run), and the treatment identity (so two folds of two experiments cannot be
 * averaged). A pair artefact written before R152 states the first and refuses the other two, because the guards
 * that read them demanded a symmetry the lane does not have (`AUDIT 34.191`). Those runs are paid for; their
 * artefacts are in CI evidence, and the two files together do state everything the pool needs:
 *
 * - the **learning half** of one fold is the **evaluation half** of the other, because the two folds are one
 *   corpus read in opposite directions — 74 learn / 40 test and 40 learn / 74 test;
 * - the **treatment** is stated by whichever artefact states it, and the other fold's silence is the guard that
 *   was fixed, not a second experiment.
 *
 * This module is the composition, and it is a module with refusals because the composition is exactly where a
 * convenient assumption becomes a wrong number: "the sibling's half" is only the learning half if the two folds
 * genuinely tile, so the tiling is checked in both directions before anything is written.
 *
 * ## What it is not
 *
 * It does not re-derive `pass^4`, re-cut the split, or edit either run's artefact. Each fold record keeps the
 * ledger verbatim and names, field by field, where every value it did not read from its own file came from.
 * A reader who distrusts a derivation can see which one it was without opening the tool.
 */

/** One fold's paired outcomes, as the pair artefact's transfer ledger states them. */
export type FoldLedgerRow = {
  readonly task: string;
  readonly blankCorrect: boolean;
  readonly withMemoryCorrect: boolean;
};

/**
 * What one pair artefact says, read down to the three fields that matter here.
 *
 * Every optional field is optional because an artefact written before it existed reaches the guard as absent
 * rather than as a default — absence is the fact the derivation names.
 */
export type FoldInput = {
  readonly label: string;
  readonly ledger: readonly FoldLedgerRow[];
  readonly split?: { readonly learned: readonly string[]; readonly evaluated: readonly string[] };
  readonly treatment?: {
    readonly unit?: string;
    readonly form?: string;
    readonly scope?: string;
    readonly model?: string;
    readonly traceClaims?: number | undefined;
    readonly knobs?: string;
  };
  /** The run the artefact came from, carried into the record so the fold can be traced back to its dispatch. */
  readonly source?: string;
};

export type FoldRecord = {
  readonly id: string;
  readonly source: string | undefined;
  readonly treatment: NonNullable<FoldInput['treatment']>;
  readonly foldSplit: { readonly learned: readonly string[]; readonly evaluated: readonly string[] };
  readonly ledger: readonly FoldLedgerRow[];
  /** One sentence per field this record did not read from its own artefact. */
  readonly derivation: readonly string[];
};

export type FoldRecordsOutcome =
  | { readonly ok: true; readonly records: readonly FoldRecord[] }
  | { readonly ok: false; readonly refusals: readonly string[] };

const TREATMENT_FIELDS = ['unit', 'form', 'scope', 'model', 'traceClaims', 'knobs'] as const;

function sorted(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort();
}

function intersects(left: ReadonlySet<string>, right: readonly string[]): readonly string[] {
  return right.filter((id) => left.has(id)).sort();
}

function describe(ids: readonly string[]): string {
  const shown = ids.slice(0, 5).join(', ');
  return ids.length > 5 ? `${shown}, and ${String(ids.length - 5)} more` : shown;
}

/**
 * The treatment both folds agree they ran, or the reason they do not.
 *
 * A field stated by one fold and not the other is *carried*, with a derivation line, because the alternative is
 * to claim the two folds ran different treatments on the strength of one artefact being older. A field two folds
 * state differently is refused: that is two experiments, and no pool may average them.
 */
function treatmentOf(
  inputs: readonly FoldInput[],
): { readonly ok: true; readonly treatment: FoldRecord['treatment']; readonly notes: readonly string[] } | { readonly ok: false; readonly refusals: readonly string[] } {
  const refusals: string[] = [];
  const notes: string[] = [];
  const carried: Record<string, string | number> = {};
  for (const field of TREATMENT_FIELDS) {
    const stated = inputs
      .map((input) => ({ label: input.label, value: input.treatment?.[field] }))
      .filter((entry): entry is { label: string; value: string | number } => entry.value !== undefined);
    if (stated.length === 0) continue;
    const [head, ...rest] = stated;
    const differing = rest.find((entry) => entry.value !== head!.value);
    if (differing !== undefined) {
      refusals.push(
        `the folds are two experiments, not one corpus: ${field} is '${String(head!.value)}' on ${head!.label} ` +
          `and '${String(differing.value)}' on ${differing.label}`,
      );
      continue;
    }
    carried[field] = head!.value;
    if (stated.length !== inputs.length) {
      const silent = inputs.filter((input) => input.treatment?.[field] === undefined).map((input) => input.label);
      notes.push(
        `${field}: carried from ${head!.label}; ${silent.join(', ')} state none, which is the artefact's own ` +
          'silence rather than a second treatment',
      );
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };
  if (Object.keys(carried).length === 0) {
    return {
      ok: false,
      refusals: [
        'neither artefact states a treatment: unit, form, scope, model and knobs are all absent, so the two ' +
          'folds cannot be shown to be two halves of one treatment rather than two experiments',
      ],
    };
  }
  const text = (field: 'unit' | 'form' | 'scope' | 'model' | 'knobs'): string | undefined => {
    const value = carried[field];
    return typeof value === 'string' ? value : undefined;
  };
  const ceiling = carried['traceClaims'];
  return {
    ok: true,
    treatment: {
      ...(text('unit') === undefined ? {} : { unit: text('unit')! }),
      ...(text('form') === undefined ? {} : { form: text('form')! }),
      ...(text('scope') === undefined ? {} : { scope: text('scope')! }),
      ...(text('model') === undefined ? {} : { model: text('model')! }),
      ...(typeof ceiling === 'number' ? { traceClaims: ceiling } : {}),
      ...(text('knobs') === undefined ? {} : { knobs: text('knobs')! }),
    },
    notes,
  };
}

/**
 * The two fold records, or every reason these two files are not one corpus read twice.
 *
 * Every refusal names the fold and the ids involved. A composition tool that refused with "the folds do not
 * tile" would leave the operator to find which of forty tasks moved.
 */
export function foldRecordsOf(inputs: readonly FoldInput[]): FoldRecordsOutcome {
  if (inputs.length !== 2) {
    return {
      ok: false,
      refusals: [
        `a cross-fit is two folds, and ${String(inputs.length)} were given: one fold has no sibling to state the ` +
          'half it did not learn from',
      ],
    };
  }
  const refusals: string[] = [];
  const evaluated = inputs.map((input) => sorted(input.ledger.map((row) => row.task)));

  for (const [index, input] of inputs.entries()) {
    if (input.ledger.length === 0) {
      refusals.push(`fold '${input.label}' carries no ledger, so it measured nothing`);
      continue;
    }
    const ids = evaluated[index]!;
    if (ids.length !== input.ledger.length) {
      refusals.push(
        `fold '${input.label}' lists ${String(input.ledger.length)} row(s) over ${String(ids.length)} task(s): a ` +
          'ledger with two rows for one task is two trials joined as one, and the pool counts tasks',
      );
    }
    const stated = input.split?.evaluated;
    if (stated !== undefined && sorted(stated).join(',') !== ids.join(',')) {
      refusals.push(
        `fold '${input.label}' states it evaluated ${String(stated.length)} task(s) but its ledger holds ` +
          `${String(ids.length)}: the ledger is the population the pool reads`,
      );
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  // The learning half, per fold: stated by its own artefact when it can be, otherwise the sibling's evaluated
  // half — and either way checked against the tiling the whole design rests on.
  const learned = inputs.map((input, index) => {
    if (input.split !== undefined) return sorted(input.split.learned);
    const sibling = evaluated[index === 0 ? 1 : 0]!;
    return sibling;
  });

  for (const [index, input] of inputs.entries()) {
    const mine = learned[index]!;
    const rows = evaluated[index]!;
    const overlap = intersects(new Set(rows), mine);
    if (overlap.length > 0) {
      refusals.push(
        `fold '${input.label}' evaluates ${String(overlap.length)} task(s) it learned from: ${describe(overlap)} — ` +
          'that is the leak the cross-fit exists to exclude, and the number it produces is better than the truth',
      );
    }
    const siblingIndex = index === 0 ? 1 : 0;
    const siblingRows = evaluated[siblingIndex]!;
    // The tiling claim, checked once per fold that states its own learning half: this fold learned exactly what
    // the other answered. The mirror of the relation is the sibling's own pass through this loop, so checking it
    // twice would report one defect under two sentences. On a fold whose half was derived from `siblingRows` the
    // comparison would be a value against its own source, which reads as diligence and checks nothing.
    if (input.split !== undefined && mine.join(',') !== siblingRows.join(',')) {
      refusals.push(
        `the folds do not tile: '${input.label}' learned ${String(mine.length)} task(s) of which ` +
          `${String(mine.filter((id) => !siblingRows.includes(id)).length)} were not answered by ` +
          `'${inputs[siblingIndex]!.label}'`,
      );
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const treatment = treatmentOf(inputs);
  if (!treatment.ok) return { ok: false, refusals: treatment.refusals };

  const records = inputs.map((input, index) => {
    const derivation: string[] = [];
    if (input.split === undefined) {
      derivation.push(
        `learned: the sibling fold's evaluated half — the two folds are one corpus read in opposite directions, ` +
          `and the tiling is checked both ways before this record is written`,
      );
    }
    return {
      id: input.label,
      source: input.source,
      treatment: treatment.treatment,
      foldSplit: { learned: learned[index]!, evaluated: evaluated[index]! },
      ledger: input.ledger,
      derivation,
    };
  });
  const carriedFields = treatment.notes;
  return {
    ok: true,
    records: records.map((record) => ({ ...record, derivation: [...record.derivation, ...carriedFields] })),
  };
}

/** The composition as one line per fold, which is what a caller prints before it writes the records. */
export function foldRecordsLine(records: readonly FoldRecord[]): string {
  return records
    .map(
      (record) =>
        `[fold-records] ${record.id}: learned ${String(record.foldSplit.learned.length)} / evaluated ` +
        `${String(record.foldSplit.evaluated.length)}, treatment ` +
        `${record.treatment.unit ?? 'unstated'}/${record.treatment.form ?? 'unstated'}/` +
        `${record.treatment.scope ?? 'unstated'}`,
    )
    .join('\n');
}
