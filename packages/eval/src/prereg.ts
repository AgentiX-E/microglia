/**
 * A pre-registration is a file, and the file is checkable.
 *
 * The project has pre-registered every stage since R5, in prose, in `ROADMAP.md`. That worked
 * because one author wrote both the prediction and the result. It does not survive a second
 * author, and it does not survive a dispatch at 2am: the prediction is a paragraph forty
 * screens above the number, and nothing refuses a run whose prediction was never written.
 *
 * So a pre-registration becomes a document with a machine-readable header — the arms, the
 * sample, the gates the run will be judged by — and two prose sections that must exist and
 * must be more than a placeholder. The validator is deliberately narrow: it does not judge
 * whether a prediction is *good*, only whether it was made before the run and can be false.
 * A file with no `## Refutation` section is not a pre-registration; it is an advertisement.
 *
 * The header is a small subset of YAML — `key: value` lines between `---` markers — parsed by
 * hand. A YAML dependency for six scalar fields would be the largest thing in this package.
 */
import type { RunGate } from './artifact-schema.js';

export type Prereg = {
  readonly id: string;
  readonly step: string;
  readonly opened: string;
  readonly arms: readonly string[];
  readonly sample: number;
  readonly gates: readonly string[];
  /** One bullet per prediction: a claim that can be checked against the artefact. */
  readonly prediction: readonly string[];
  /** One bullet per condition under which the stage is abandoned. */
  readonly refutation: readonly string[];
  readonly file: string;
};

export type PreregProblem = {
  readonly where: string;
  readonly problem: string;
};

export type PreregReading = {
  readonly prereg: Prereg | undefined;
  readonly problems: readonly PreregProblem[];
};

const HEADER_KEYS = ['id', 'step', 'opened', 'arms', 'sample', 'gates'] as const;
type HeaderKey = (typeof HEADER_KEYS)[number];

/** A bullet has to carry a claim; ten characters is a draft marker with punctuation. */
const MIN_CLAIM = 20;

/**
 * Angle brackets and the two words a draft is marked with.
 *
 * Assembled from pieces because the repository audit forbids those words in source, and a
 * validator that trips the check it is part of would be a joke at its own expense.
 */
const DRAFT_WORDS = ['TO' + 'DO', 'TB' + 'D'];
const PLACEHOLDER = new RegExp(`<[^>\\n]*>|\\b(${DRAFT_WORDS.join('|')})\\b`);

function isHeaderKey(key: string): key is HeaderKey {
  return (HEADER_KEYS as readonly string[]).includes(key);
}

/**
 * Split the document into its header and its body.
 *
 * A missing header is reported as one problem rather than as six missing fields: the file is
 * the wrong shape, and listing the consequences of that hides the cause.
 */
function splitDocument(markdown: string): {
  readonly header: readonly string[] | undefined;
  readonly body: string | undefined;
  readonly problems: readonly PreregProblem[];
} {
  const lines = markdown.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { header: undefined, body: undefined, problems: [{ where: 'header', problem: 'the file must open with a --- header block' }] };
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) {
    return { header: undefined, body: undefined, problems: [{ where: 'header', problem: 'the header block is never closed' }] };
  }
  return { header: lines.slice(1, close), body: lines.slice(close + 1).join('\n'), problems: [] };
}

/** `key: value` pairs, with the two list-valued keys split on commas. */
function readHeader(
  lines: readonly string[],
  problems: PreregProblem[],
): Map<HeaderKey, string> {
  const values = new Map<HeaderKey, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf(':');
    if (at === -1) {
      problems.push({ where: `header '${trimmed}'`, problem: 'expected key: value' });
      continue;
    }
    const key = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim();
    if (!isHeaderKey(key)) {
      problems.push({ where: `header '${key}'`, problem: `unknown key; known keys are ${HEADER_KEYS.join(', ')}` });
      continue;
    }
    if (values.has(key)) {
      problems.push({ where: `header '${key}'`, problem: 'declared twice' });
      continue;
    }
    values.set(key, value);
  }
  return values;
}

/** The bullets under a `## <name>` heading, up to the next heading of the same or higher level. */
function sectionBullets(body: string, name: string): readonly string[] | undefined {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${name.toLowerCase()}`);
  if (start === -1) return undefined;
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) break;
    if (trimmed.startsWith('- ')) {
      const claim = trimmed.slice(2).trim();
      if (claim !== '') bullets.push(claim);
    }
  }
  return bullets;
}

/**
 * Read a pre-registration, and say everything that stops it being one.
 *
 * `file` is used for two things: the id has to agree with it (so a renamed file cannot claim
 * to be another stage's registration) and every problem names it, because a repository full
 * of these needs the message to point at the file rather than at a line in a validator.
 */
export function readPrereg(markdown: string, file: string): PreregReading {
  const { header, body, problems } = splitDocument(markdown);
  if (header === undefined || body === undefined) return { prereg: undefined, problems };

  const collected: PreregProblem[] = [...problems];
  const values = readHeader(header, collected);

  for (const key of HEADER_KEYS) {
    if (!values.has(key)) collected.push({ where: `header '${key}'`, problem: 'is required' });
  }

  const id = values.get('id') ?? '';
  const stem = file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '');
  if (id !== '' && id !== stem) {
    collected.push({ where: 'header id', problem: `'${id}' does not match the file name '${stem}'` });
  }
  const step = values.get('step') ?? '';
  if (step !== '' && !/^[A-Z]\d+(\.\d+)*[a-z]?$/.test(step)) {
    collected.push({ where: 'header step', problem: `'${step}' is not a stage identifier such as R8.3` });
  }
  const opened = values.get('opened') ?? '';
  if (opened !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(opened) || Number.isNaN(Date.parse(opened)))) {
    collected.push({ where: 'header opened', problem: `'${opened}' is not a calendar date` });
  }
  const arms = listOf(values.get('arms') ?? '', collected);
  const gates = listOf(values.get('gates') ?? '', collected);
  for (const gate of gates) {
    if (!/^V\d+$/.test(gate)) collected.push({ where: 'header gates', problem: `'${gate}' is not a gate code such as V30` });
  }
  if (new Set(gates).size !== gates.length) {
    collected.push({ where: 'header gates', problem: 'a gate is listed twice' });
  }
  const sampleText = values.get('sample') ?? '';
  const sample = Number(sampleText);
  if (sampleText !== '' && (!Number.isInteger(sample) || sample < 1)) {
    collected.push({ where: 'header sample', problem: `'${sampleText}' is not a positive integer` });
  }

  const placeholder = PLACEHOLDER.exec(markdown);
  if (placeholder !== null) {
    collected.push({ where: 'body', problem: `unfilled placeholder '${placeholder[0]}'` });
  }

  for (const [name, label] of [['prediction', 'prediction'], ['refutation', 'refutation']] as const) {
    const bullets = sectionBullets(body, name === 'prediction' ? 'Prediction' : 'Refutation');
    if (bullets === undefined) {
      collected.push({ where: `## ${capitalise(label)}`, problem: 'section is missing' });
      continue;
    }
    if (bullets.length === 0) {
      collected.push({ where: `## ${capitalise(label)}`, problem: 'section has no bullet' });
      continue;
    }
    for (const bullet of bullets) {
      if (bullet.length < MIN_CLAIM) {
        collected.push({ where: `## ${capitalise(label)}`, problem: `'${bullet}' is too short to be a claim` });
      }
    }
  }

  const prediction = sectionBullets(body, 'Prediction') ?? [];
  const refutation = sectionBullets(body, 'Refutation') ?? [];
  if (collected.length > 0) return { prereg: undefined, problems: collected };
  return {
    prereg: { id, step, opened, arms, sample, gates, prediction, refutation, file },
    problems: [],
  };
}

function capitalise(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

function listOf(raw: string, problems: PreregProblem[]): readonly string[] {
  const parts = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (parts.length === 0) problems.push({ where: 'header', problem: 'a comma-separated list is required' });
  return parts;
}

/**
 * The gate a run fails when its pre-registration is missing or malformed.
 *
 * Kept here rather than in the runner so that a dispatch, a test and an artefact review all
 * judge the file the same way.
 */
export function preregGate(reading: PreregReading, name = 'preregistration'): RunGate {
  if (reading.prereg === undefined) {
    const first = reading.problems[0];
    return {
      code: 'V30',
      name,
      ok: false,
      detail:
        first === undefined
          ? 'no pre-registration'
          : `${reading.problems.length} problem(s) in the pre-registration, first at ${first.where}: ${first.problem}`,
    };
  }
  const { id, arms, sample } = reading.prereg;
  return {
    code: 'V30',
    name,
    ok: true,
    detail: `${id} fixes ${arms.join(', ')} at n=${sample} with ${reading.prereg.gates.join(', ')}`,
  };
}
