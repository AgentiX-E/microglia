/**
 * Count what a benchmark's labels carry, out of the files themselves.
 *
 * The reason this is a tool and not a paragraph: two of this repository's own sentences about
 * τ²-bench were derived from a run's counters, and the corpus disagrees with both of them. The
 * corpus is the one part of the experiment we do not control, so its shape is measured at the pinned
 * ref and printed beside the run that consumes it.
 *
 *   pnpm eval:label-census --corpus retail=.tau2-bench/data/tau2/domains/retail/tasks.json \
 *                          --corpus airline=.tau2-bench/data/tau2/domains/airline/tasks.json \
 *                          --out bench/results/tau2-label-census.json
 *
 * Only the flag parsing and the printing live here; every decision about what a label is lives in
 * `label-census.ts`, where it is covered by tests that state the distinction being made.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { labelCensus, readLabelCensusTasks, type LabelCensus } from '@agentix-e/microglia-eval';

type Corpus = { readonly name: string; readonly path: string };

type Args = { readonly corpora: readonly Corpus[]; readonly out?: string };

const USAGE = 'usage: label-census --corpus <name>=<path> [--corpus ...] [--out <path>]';

function parseArgs(argv: readonly string[]): Args {
  const corpora: Corpus[] = [];
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out') {
      if (value === undefined) throw new RangeError(`--out needs a path. ${USAGE}`);
      out = value;
      index += 1;
    } else if (flag === '--corpus') {
      const cut = value?.indexOf('=') ?? -1;
      if (value === undefined || cut <= 0 || cut === value.length - 1) {
        throw new RangeError(`--corpus needs <name>=<path>. ${USAGE}`);
      }
      corpora.push({ name: value.slice(0, cut), path: value.slice(cut + 1) });
      index += 1;
    } else {
      throw new RangeError(`unknown argument '${String(flag)}'. ${USAGE}`);
    }
  }
  if (corpora.length === 0) throw new RangeError(`nothing to count. ${USAGE}`);
  return out === undefined ? { corpora } : { corpora, out };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${String(Math.round((part / whole) * 1000) / 10)}%`;
}

function row(name: string, census: LabelCensus): string {
  const both = census.calls + census.rubric - census.teachable;
  const cells = [
    name,
    String(census.tasks),
    `${String(census.calls)} (${percent(census.calls, census.tasks)})`,
    `${String(census.rubric)} (${percent(census.rubric, census.tasks)})`,
    String(both),
    `${String(census.unteachable)} (${percent(census.unteachable, census.tasks)})`,
    `${String(census.silent)}`,
    String(census.declaredBasis),
    String(census.pathScored),
    String(census.rubricGraded),
  ];
  return `| ${cells.join(' | ')} |`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const counted = args.corpora.map((corpus) => {
    const raw = readFileSync(corpus.path, 'utf8');
    return {
      name: corpus.name,
      path: corpus.path,
      // The bytes are recorded with the counts, because a census is only auditable if the reader can
      // fetch the file that produced it and get the same numbers back.
      sha256: createHash('sha256').update(raw).digest('hex'),
      bytes: Buffer.byteLength(raw),
      census: labelCensus(readLabelCensusTasks(JSON.parse(raw) as unknown)),
    };
  });

  const header = [
    'corpus',
    'tasks',
    'calls',
    'rubric',
    'both',
    'unteachable',
    'silent',
    'basis declared',
    'path scored',
    'rubric graded',
  ];
  process.stdout.write(
    [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
      .concat(counted.map((entry) => row(entry.name, entry.census)))
      .join('\n') + '\n',
  );

  if (args.out !== undefined) {
    writeFileSync(args.out, `${JSON.stringify({ generatedAt: new Date().toISOString(), corpora: counted }, null, 2)}\n`);
  }
}

main();
