/**
 * `@agentix-e/microglia-capture` — the SDK a host embeds.
 *
 * Five calls cover the loop:
 *
 *   const mg = await openMicroglia({ app, namespace, store });
 *   const pack = await mg.recall({ task, text });
 *   const run = mg.begin({ task, input, pack });
 *   await run.complete(output);
 *   await run.edit(corrected);
 *   await mg.distill();
 *
 * There is no UI, no server, and no background timer. The host decides when to
 * capture, when to learn, and where the journal lives.
 */
export { Microglia, creditOf, seededRandom } from './microglia.js';
export { curateKnowledge, density, type CurationOptions, type CurationReport } from './curate.js';
export { RunHandle, type RunHost } from './run.js';
export { TaskHandle, type AttemptStart, type TaskHost, type TaskSummary } from './task.js';
export { diagnose, type DoctorOptions } from './doctor.js';
export { buildDataset, toJsonl, type ExportOptions } from './export.js';
export { buildFeedbackEvent, assertJsonOutput, type BuildEventArgs } from './normalize.js';
export { normaliseReasons, trustFor } from './trust.js';

export type {
  DatasetRow,
  Diagnosis,
  DiagnosisIssue,
  ExportFormat,
  FeedbackInput,
  FeedbackOptions,
  MicrogliaOptions,
  RunStart,
  TaskDecision,
  TaskOpen,
} from './options.js';

import { Microglia } from './microglia.js';
import type { MicrogliaOptions } from './options.js';

/** Named factory: an async-looking call keeps the host from assuming no I/O. */
export function openMicroglia(options: MicrogliaOptions): Promise<Microglia> {
  return Microglia.open(options);
}
