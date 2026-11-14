/**
 * Say what a dispatch that measured nothing was doing, in one line and one summary section.
 *
 * The logic is `noMeasurementNote`, which is tested. This file is the shell around it: read the
 * artefact, print the warning, append the section. It exists because the workflow cannot hold logic
 * — R111 put this decision inline and R104 crashed it at a comment containing a double quote.
 *
 * Usage: pnpm eval:say-what-happened
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { noMeasurementNote, type NoteArtefact } from '../no-measurement-note.js';

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const SUFFIX = (process.env['POC_RESULT_SUFFIX'] ?? '').trim();
const PATH = join(RESULTS, `poc-l4${SUFFIX === '' ? '' : `-${SUFFIX}`}.json`);

function read(): NoteArtefact | undefined {
  if (!existsSync(PATH)) return undefined;
  try {
    return JSON.parse(readFileSync(PATH, 'utf8')) as NoteArtefact;
  } catch {
    // An artefact that cannot be parsed is an artefact that did not answer the question, and the
    // note says exactly that rather than printing a JSON error into a summary.
    return { metrics: undefined, notes: [] };
  }
}

const note = noMeasurementNote(read());
if (note.warning !== undefined) process.stdout.write(`::warning::${note.warning}\n`);
for (const line of note.summary) process.stdout.write(`[say-what-happened] ${line}\n`);
if (note.summary.length > 0) {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath !== undefined && summaryPath.trim() !== '') {
    appendFileSync(summaryPath, `${note.summary.join('\n')}\n`);
  }
}
process.stdout.write(`[say-what-happened] ${note.state}\n`);
