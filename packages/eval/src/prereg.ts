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
  /**
   * The recall floor this dispatch applies, when it is a use-side arm. Absent
   * means the as-is configuration. A declared floor is a registration, not a
   * knob: `prereg-floor.ts` recomputes it from the committed histogram before
   * the lane may apply it.
   */
  readonly recallFloor?: number;
  /**
   * Whether this registration measures a WITHIN-RUN pair of recall facades:
   * one dispatch, one store, two `minCoverage` rungs. `off` (or an absent key)
   * keeps every earlier registration on the single-facade path. The value is a
   * declaration, not a knob: `prereg-pair.ts` refuses a pair with no
   * non-zero registered `recallFloor`.
   */
  readonly facadePair?: 'as-is-floored' | 'off';
  /**
   * The scenario pair this registration executes, when it pins one.
   *
   * Absent means "whatever the lane is configured with", which is what every registration
   * before R54 meant. Present means the dispatch overrides the repository variables, and a
   * run whose artefact records a different pair measured a different experiment.
   */
  readonly trainDomain?: string;
  readonly testDomain?: string;
  /**
   * The domain recall is asked in. It must equal `trainDomain` when both are declared: a
   * recall scope that is neither the store's domain nor the question's is a third thing,
   * and no registration has a prediction about it.
   */
  readonly recallDomain?: string;
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

const REQUIRED_KEYS = ['id', 'step', 'opened', 'arms', 'sample', 'gates'] as const;
/**
 * The optional keys, all of which keep a registration opened before them valid.
 *
 * `trainDomain`/`testDomain`/`recallDomain` were added by R54 for a reason the lane had
 * already paid for: R51 registered three predictions about a within-scenario run, and the
 * dispatch inherited `TAU_TEST_DOMAIN=airline` from a repository variable set for the
 * transfer arm, so the readback graded a retail store answering airline questions. The
 * scenario is a property of the experiment, exactly as the recall floor is, and a property
 * of the experiment belongs in the registration rather than in whichever variable happened
 * to be set the day it ran.
 */
const HEADER_KEYS = [
  ...REQUIRED_KEYS,
  'recallFloor',
  'facadePair',
  'trainDomain',
  'testDomain',
  'recallDomain',
] as const;
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

  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) collected.push({ where: `header '${key}'`, problem: 'is required' });
  }

  const floorText = values.get('recallFloor');
  let recallFloor: number | undefined;
  if (floorText !== undefined) {
    const parsed = Number(floorText);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      collected.push({
        where: `header 'recallFloor'`,
        problem: 'is not a finite number in the unit interval',
      });
    } else {
      recallFloor = parsed;
    }
  }

  const pairText = values.get('facadePair');
  let facadePair: Prereg['facadePair'];
  if (pairText !== undefined) {
    if (pairText !== 'as-is-floored' && pairText !== 'off') {
      collected.push({
        where: `header 'facadePair'`,
        problem: `must be 'as-is-floored' or 'off', received '${pairText}'`,
      });
    } else {
      facadePair = pairText;
    }
  }

  if (facadePair === 'as-is-floored' && (recallFloor === undefined || recallFloor <= 0)) {
    collected.push({
      where: `header 'facadePair'`,
      problem: 'a paired facade needs a positive recallFloor declared in the same registration',
    });
  }

  // R54: the scenario pair. A domain is a lowercase word, not a path or an expression, because
  // it is pasted into `TAU_TRAIN_DOMAIN` and a value that means something to a shell is a value
  // that can change the experiment between the registration and the run.
  const domainOf = (key: 'trainDomain' | 'testDomain' | 'recallDomain'): string | undefined => {
    const text = values.get(key);
    if (text === undefined) return undefined;
    if (!/^[a-z][a-z0-9]*$/.test(text)) {
      collected.push({
        where: `header '${key}'`,
        problem: `'${text}' is not a scenario name such as retail or airline`,
      });
      return undefined;
    }
    return text;
  };
  const trainDomain = domainOf('trainDomain');
  const testDomain = domainOf('testDomain');
  const recallDomain = domainOf('recallDomain');
  if (recallDomain !== undefined && trainDomain !== undefined && recallDomain !== trainDomain) {
    collected.push({
      where: `header 'recallDomain'`,
      problem:
        'must equal trainDomain: recall is asked in the store\'s own scenario, and a third ' +
        'domain is an experiment no registration has a prediction about',
    });
  }
  if (recallDomain !== undefined && trainDomain === undefined) {
    collected.push({
      where: `header 'recallDomain'`,
      problem: 'needs trainDomain declared beside it, or the pair it is checked against is a variable',
    });
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
    prereg: {
      id,
      step,
      opened,
      arms,
      sample,
      gates,
      ...(recallFloor === undefined ? {} : { recallFloor }),
      ...(facadePair === undefined ? {} : { facadePair }),
      ...(trainDomain === undefined ? {} : { trainDomain }),
      ...(testDomain === undefined ? {} : { testDomain }),
      ...(recallDomain === undefined ? {} : { recallDomain }),
      prediction,
      refutation,
      file,
    },
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

export type GateAgreement = {
  readonly ok: boolean;
  readonly detail: string;
};

/**
 * The gate code out of the id an artefact records.
 *
 * An artefact names a gate `V17-net-sign` and a header names it `V17`: the code is the part the two
 * files have in common and the slug is a reading aid for whoever opens the JSON. A gate whose id
 * carries no slug is already a code, which is why the separator is searched for rather than assumed.
 */
function gateCode(gate: string): string {
  const at = gate.indexOf('-');
  return at === -1 ? gate : gate.slice(0, at);
}

/**
 * The gate list a pre-registration names, against the gate list its run emitted.
 *
 * R16's header was written by copying R15's file: seven transfer gates, when the arm set was four
 * dose points and a replica and the run could only emit the ten gates every dispatch emits. The
 * pre-registration passed validation, the run passed its gates, and the two disagreed — which is
 * the same defect as R12's admission, R13's ledger and R15's V14/V17, a field that was true when
 * it was written and silently stopped being true when the thing it described changed.
 *
 * It is checked here, offline, because both sides of the claim are files: the header in `prereg/`
 * and the `gates` array in the artefact. A dispatch cannot see this — it holds one of the two —
 * but the repository holds both, and `eval:protocol` reads them for every artefact that names a
 * pre-registration.
 *
 * Equality in both directions is the point. A gate the file names and the run never emits means
 * the file describes a different experiment; a gate the run emits and the file does not name means
 * the run was judged by a criterion it was not registered against.
 */
export function preregGateAgreement(prereg: Prereg, emitted: readonly string[]): GateAgreement {
  const declared = new Set(prereg.gates);
  // An artefact names a gate `V17-net-sign` and a header names it `V17`: the code is the part the
  // two files have in common, and the slug is a reading aid for whoever opens the JSON. Comparing
  // the two as written would fail every gate whose artefact id carries a name, which is all of
  // them.
  const ran = new Set(emitted.map(gateCode));
  const absent = prereg.gates.filter((gate) => !ran.has(gate));
  const unnamed = [...ran].filter((gate) => !declared.has(gate));
  if (absent.length === 0 && unnamed.length === 0) {
    return {
      ok: true,
      detail: `${declared.size} declared gate(s), every one emitted and none unannounced`,
    };
  }
  const parts: string[] = [];
  if (absent.length > 0) parts.push(`declares ${absent.join(', ')}, which the run never emitted`);
  if (unnamed.length > 0) parts.push(`does not name ${unnamed.join(', ')}, which the run emitted`);
  return { ok: false, detail: parts.join('; ') };
}


/**
 * Whether a registration enables the within-run paired facade.
 *
 * The workflow feeds this straight into `TAU_FACADE_PAIR`. A registration that
 * is absent, `off`, or was refused by `readPrereg` can never enable a pair, so
 * a dispatch cannot turn on two facades without a pre-registration that also
 * declares the floor it will apply.
 */
export function facadePairSwitch(prereg: Prereg): boolean {
  return prereg.facadePair === 'as-is-floored';
}
