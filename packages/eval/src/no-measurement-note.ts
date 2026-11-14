/**
 * What a workflow step may say about a dispatch that measured nothing.
 *
 * ## Why this is not a shell script
 *
 * R111 put the logic inline, as a `node -e "…"` string inside the workflow. R104 ran it and it
 * crashed:
 *
 * ```
 * [eval]:9
 *     // The sentence here used to read the
 * SyntaxError: Unexpected end of input
 * ```
 *
 * Line 9 of the script is a comment that quotes a sentence — `// The sentence here used to read
 * "the provider failed its pre-flight probe" for every` — and the double quotes inside it closed the
 * shell's own `"` string. The script was cut in half at a comment. A step whose entire job is to
 * explain a red run produced a second, unrelated failure, and the reader of that run had two
 * problems where the record had one.
 *
 * The lesson is not "escape the quotes". It is that a workflow file is a place where logic cannot be
 * tested, and the one time it mattered the logic had never run: the step had only ever been exercised
 * on runs that measured something, where it prints nothing. So the text is a pure function over the
 * artefact here, and the workflow calls it.
 *
 * ## Three states, and no state may print an empty reason
 *
 * `measured` is silent by design. `silent` is a dispatch that ran and produced no number. `absent`
 * is a dispatch that wrote no artefact at all — which a reader must not confuse with a measurement of
 * zero, the distinction every census in this repository has had to draw at least once.
 *
 * The reason is the driver's own first note. If that note is missing **or blank**, the note says so
 * rather than printing `L4 produced no measurement: ` and stopping, because the one thing a
 * diagnostic may not be is empty.
 */

/** The part of a driver's artefact this note reads. Deliberately narrow: it is a document. */
export type NoteArtefact = {
  readonly notes?: readonly string[];
  readonly metrics?: Readonly<Record<string, unknown>>;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
};

export type NoMeasurementNote = {
  readonly state: 'measured' | 'silent' | 'absent';
  /** The `::warning::` line, absent when the dispatch measured. */
  readonly warning?: string;
  /** Lines for the step summary. Empty when the dispatch measured. */
  readonly summary: readonly string[];
};

/** The driver's reason, or an honest statement that there is not one. */
function reasonOf(artefact: NoteArtefact): string {
  const first = artefact.notes?.[0];
  if (typeof first !== 'string') return 'the driver wrote no reason';
  const trimmed = first.trim();
  return trimmed === '' ? 'the driver wrote a note, and it was blank' : trimmed;
}

/** A diagnostics section as a bounded line, or nothing when the artefact does not carry it. */
function section(
  diagnostics: Readonly<Record<string, unknown>> | undefined,
  key: string,
  label: string,
): string | undefined {
  const value = diagnostics?.[key];
  if (value === undefined) return undefined;
  return `${label}: ${JSON.stringify(value).slice(0, 600)}`;
}

/** A section, or nothing — as a list, so a caller spreads it and never writes the test twice. */
function pick(
  diagnostics: Readonly<Record<string, unknown>> | undefined,
  key: string,
  label: string,
): readonly string[] {
  const line = section(diagnostics, key, label);
  return line === undefined ? [] : [line];
}

/** A nested diagnostics object, or nothing when the artefact does not carry one. */
function nested(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function noMeasurementNote(artefact: NoteArtefact | undefined): NoMeasurementNote {
  if (artefact === undefined) {
    return {
      state: 'absent',
      warning: 'L4 wrote no artefact',
      summary: ['L4 wrote no artefact. No result is claimed.'],
    };
  }
  // An artefact with no metrics block cannot say whether it measured, and defaulting to silence
  // would make a corrupt write indistinguishable from a clean run: this step's job is to answer that
  // question, so "the document did not answer it" is said rather than swallowed.
  if (artefact.metrics === undefined) {
    return {
      state: 'absent',
      warning: 'L4 wrote an artefact with no metrics',
      summary: ['L4 wrote an artefact with no metrics block. No result is claimed.'],
    };
  }
  const metrics = artefact.metrics;
  if (metrics['status_no_measurement'] === 1) {
    const why = reasonOf(artefact);
    const diagnostics = artefact.diagnostics;
    // The replies are nested one level down, in the section that carries them, and they are the
    // reason this step exists: R104's stop could not say what the model returned.
    const distill = diagnostics?.['distill'];
    const lines = [
      `L4 produced NO MEASUREMENT: ${why}`,
      'No result is claimed.',
      // The writer first: a dispatch that measured nothing still knows whether a model wrote its
      // store, and that is the fact the next arm is chosen from.
      ...pick(diagnostics, 'distillWriter', 'Writer'),
      ...pick(diagnostics, 'funnel', 'Funnel'),
      ...pick(diagnostics, 'merge', 'Store shape supply'),
      ...pick(nested(distill), 'replies', 'Distiller replies'),
    ];
    return { state: 'silent', warning: `L4 produced no measurement: ${why}`, summary: lines };
  }
  if (metrics['status_not_run'] === 1) {
    const why =
      metrics['status_driver_missing'] === 1
        ? 'TAU_DRIVER names a module that does not exist'
        : 'neither TAU_RESULTS nor TAU_DRIVER is set';
    return {
      state: 'silent',
      warning: `L4 did not run: ${why}`,
      summary: [`L4 did not run: ${why}. No result is claimed.`],
    };
  }
  return { state: 'measured', summary: [] };
}
