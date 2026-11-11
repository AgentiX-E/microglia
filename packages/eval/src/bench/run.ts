/**
 * Benchmark entry point.
 *
 * Writes the artifact before printing, so a failing gate still leaves the JSON
 * that explains why. Exit code is non-zero when a blocking gate fails, which is
 * what lets CI treat the claim as a test rather than a slide.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderJson, summarise } from '../report.js';
import { splitClaim } from '../claim.js';
import { DEFAULT_CONFIG, runStudy } from '../study.js';

const result = await runStudy(DEFAULT_CONFIG);
const dir = join(process.cwd(), 'bench', 'results');
await mkdir(join(dir, '.volatile'), { recursive: true });
// JSON only: the repository keeps two prose documents, not a third generated one.
//
// The claim is what is committed and it holds no wall clock and no per-arm latency: `pnpm check`
// runs this study, so a file carrying either one made the gate dirty on every run. The timings are
// real measurements of *a* machine and are written beside the claim, uncommitted, where a reader
// asking "which arm was slow" can still find them.
const { claim, volatile } = splitClaim(result);
await writeFile(join(dir, 'study.json'), renderJson(claim as typeof result), 'utf8');
await writeFile(join(dir, '.volatile', 'study.json'), `${JSON.stringify(volatile, null, 2)}\n`, 'utf8');

process.stdout.write(`${summarise(result)}\n`);
process.stdout.write(`artifacts: ${dir}\n`);

if (result.gates.some((gate) => gate.blocking && !gate.pass)) {
  process.exitCode = 1;
}
