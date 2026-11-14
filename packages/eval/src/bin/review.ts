/**
 * Serve the review console for one batch.
 *
 * Decisions are appended to a JSON Lines file the moment they are taken, and that file — not
 * the batch — is what a restart replays. It is the same property the ledger has as a pure
 * function, made durable: the audit trail is the state, and a session that ended at 3am can be
 * re-read at 9am by anyone who has both files.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { userInfo } from 'node:os';
import type { ReviewBatch, ReviewDecision } from '@agentix-e/microglia-core/retrospect';
import { createReviewServer } from '../review/server.js';

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function numberFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, not '${raw}'`);
  return value;
}

async function replay(path: string): Promise<ReviewDecision[]> {
  if (!existsSync(path)) return [];
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, position) => {
      try {
        return JSON.parse(line) as ReviewDecision;
      } catch {
        // A half-written last line is what a killed process leaves behind. Refusing the whole
        // file would lose every decision before it; skipping one silently would lose this one.
        throw new Error(`${path}:${position + 1} is not JSON — the decision log is truncated`);
      }
    });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const batchPath = flag(argv, '--batch');
  if (batchPath === undefined) throw new Error('usage: review --batch <batch.json> [--decisions <log.jsonl>] [--port 8765]');
  const decisionsPath = flag(argv, '--decisions') ?? batchPath.replace(/\.json$/, '.decisions.jsonl');
  // Loopback by default. The console takes write access to a memory store's inputs, and a
  // service that answers on every interface because nobody passed a flag is how that leaks.
  const host = flag(argv, '--host') ?? '127.0.0.1';
  const port = numberFlag(argv, '--port', 8765);
  const reviewer = flag(argv, '--reviewer') ?? userInfo().username;

  const batch = JSON.parse(await readFile(resolve(batchPath), 'utf8')) as ReviewBatch;
  const decisions = await replay(resolve(decisionsPath));
  await mkdir(dirname(resolve(decisionsPath)), { recursive: true });

  const handle = createReviewServer({
    batch,
    reviewer,
    decisions,
    append: (decision) => {
      // Fire and forget: a decision the reviewer has taken is already in the server's state,
      // and a slow disk must not stall the next card. A failure surfaces on the next export.
      void appendFile(resolve(decisionsPath), `${JSON.stringify(decision)}\n`, 'utf8');
    },
  });

  handle.server.listen(port, host, () => {
    process.stdout.write(
      [
        `console    http://${host}:${port}/`,
        `batch      ${batchPath} (${batch.items.length} candidate(s))`,
        `decisions  ${decisionsPath} (${decisions.length} replayed)`,
        `reviewer   ${reviewer}`,
      ].join('\n') + '\n',
    );
  });
  // A closed stdin means the shell that started this is gone; stop rather than linger.
  process.stdin.on('end', () => handle.server.close());
}

main().catch((error: unknown) => {
  process.stderr.write(`review: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
