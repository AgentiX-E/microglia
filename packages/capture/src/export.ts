/**
 * Dataset export.
 *
 * The flywheel's output is not only memory. Edits are also the training data
 * every post-training stack expects, and the mapping is mechanical once the
 * event is normalised:
 *
 *   edit            -> SFT (prompt, after) and DPO (prompt, after, before)
 *   rating          -> KTO (prompt, output, binary label)
 *   edit + run      -> eval case (input, expected)
 *
 * Export is a pure read of the journal. Nothing is uploaded, and nothing leaves
 * the host's process unless the host writes the returned string.
 */
import type { Json } from '@agentix-e/microglia-core';
import type { MemoryPort } from '@agentix-e/microglia-memory';
import type { DatasetRow, ExportFormat } from './options.js';

export type ExportOptions = {
  readonly memory: MemoryPort;
  readonly namespace: string;
  readonly task?: string;
  readonly since?: number;
};

export async function buildDataset(
  format: ExportFormat,
  options: ExportOptions,
): Promise<readonly DatasetRow[]> {
  const events = await options.memory.listEvents({
    namespace: options.namespace,
    ...(options.since === undefined ? {} : { since: options.since }),
  });

  const rows: DatasetRow[] = [];
  for (const event of events) {
    if (options.task !== undefined && event.task !== options.task) continue;
    const run = await options.memory.getRun(event.runId);
    if (!run) continue;

    if (format === 'sft' && event.signal.type === 'edit') {
      rows.push({
        id: event.id,
        task: event.task,
        prompt: run.input,
        completion: event.signal.after,
      });
      continue;
    }

    if (format === 'dpo' && event.signal.type === 'edit' && run.output !== undefined) {
      rows.push({
        id: event.id,
        task: event.task,
        prompt: run.input,
        chosen: event.signal.after,
        rejected: run.output,
      });
      continue;
    }

    if (format === 'kto' && event.signal.type === 'rating') {
      rows.push({
        id: event.id,
        task: event.task,
        prompt: run.input,
        completion: run.output ?? null,
        label: event.signal.value === 'up',
      });
      continue;
    }

    if (format === 'eval' && (event.signal.type === 'edit' || event.signal.type === 'rating')) {
      const expected: Json =
        event.signal.type === 'edit' ? event.signal.after : (run.output ?? null);
      rows.push({
        id: event.id,
        task: event.task,
        input: run.input,
        expected,
        signal: event.signal.type === 'edit' ? 'edit' : 'rating',
        runId: event.runId,
        at: event.at,
      });
    }
  }

  return rows;
}

/**
 * JSONL with a header line.
 *
 * The header is what makes an exported file self-describing: a consumer six
 * months later needs the schema version and the source app, not a README that
 * was never written.
 */
export function toJsonl(
  rows: readonly DatasetRow[],
  meta: { readonly app: string; readonly namespace: string; readonly format: ExportFormat },
): string {
  const header = JSON.stringify({
    schema: 'microglia.dataset/1',
    app: meta.app,
    namespace: meta.namespace,
    format: meta.format,
    rows: rows.length,
  });
  return [header, ...rows.map((row) => JSON.stringify(row))].join('\n') + '\n';
}
