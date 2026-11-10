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
   * Whether this registration runs R53's three note levels as three facades of ONE dispatch.
   *
   * `off` (or an absent key) keeps every earlier registration on the single-note path. The
   * value is a declaration, not a knob: the level set is the registered one (`none`,
   * `standard`, `hardened`), and a registration that pairs the floor with the note would
   * vary two treatments at once.
   */
  readonly facadeNotes?: 'three-level' | 'off';
  /**
   * The planted distractor arms this registration runs, when it runs any.
   *
   * R57 declared three — `far`, `near`, `adversarial` — and dispatched them one at a time, because
   * the arm lived in a repository variable and a variable is global: three arms meant three
   * dispatches, each waiting six hours for the last, and a fourth experiment that forgot to clear
   * the variable would have measured a distractor it never asked for. A property of the experiment
   * belongs in the registration, exactly as the scenario pair and the recall floor do, so this is
   * where the arm list lives and the workflow fans it out into one job per arm.
   *
   * Absent means one arm with no plant, which is what every registration before R57 is.
   */
  readonly plantedArms?: readonly string[];
  /**
   * The sampling temperature a draw-based registration runs at, when it moves it.
   *
   * Absent means the lane's own default, which is what every sampling run before R70 used.
   * `SOTA_SAMPLE_TEMPERATURE` was a **repository variable**, and a variable is global: R69 measured
   * a pool at T = 0.7 and R70 wanted the same arms at T = 1.0, which on a variable is two
   * dispatches separated by a mutation every other queued run then inherits — the exact shape that
   * made `SOTA_MODEL` a per-dispatch input. Temperature is a property of the experiment, so it is
   * declared here, beside the arms and for the same reason, and the workflow reads it from the file
   * rather than from a variable nobody re-reads.
   *
   * A registration declares one temperature because it runs one dispatch: R69's two-dispatch design
   * was split into R69 (width at the default) and R70 (heat) when this key was added, since one
   * header cannot be honest about two temperatures.
   */
  readonly sampleTemperature?: number;
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
  'facadeNotes',
  'trainDomain',
  'testDomain',
  'recallDomain',
  'plantedArms',
  'temperature',
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

  const notesText = values.get('facadeNotes');
  let facadeNotes: Prereg['facadeNotes'];
  if (notesText !== undefined) {
    if (notesText !== 'three-level' && notesText !== 'off') {
      collected.push({
        where: `header 'facadeNotes'`,
        problem: `must be 'three-level' or 'off', received '${notesText}'`,
      });
    } else {
      facadeNotes = notesText;
    }
  }
  if (facadeNotes === 'three-level' && facadePair === 'as-is-floored') {
    collected.push({
      where: `header 'facadeNotes'`,
      problem: 'a three-level note arm and a paired recall facade vary two treatments in one dispatch',
    });
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

  // R57: the planted arms, one job each. A name is a lowercase word because it is pasted into
  // `TAU_PLANTED_RULES` and indexed into `eval/planted/<domain>.json`; a name with punctuation in it
  // would be an arm nobody can dispatch and a file nobody can find. Duplicates are refused rather
  // than collapsed: two legs writing the same artefact directory is a race, not a repeat.
  const plantedText = values.get('plantedArms');
  let plantedArms: readonly string[] | undefined;
  if (plantedText !== undefined) {
    const names = plantedText
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (names.length === 0) {
      collected.push({ where: `header 'plantedArms'`, problem: 'declares no arm' });
    }
    for (const name of names) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        collected.push({
          where: `header 'plantedArms'`,
          problem: `'${name}' is not an arm name such as near or adversarial`,
        });
      }
    }
    if (new Set(names).size !== names.length) {
      collected.push({ where: `header 'plantedArms'`, problem: 'an arm is listed twice' });
    }
    plantedArms = names;
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
  // R70: the temperature, which every draw in a run is sampled at.
  //
  // The bound is closed at zero now, and it used to be open, for a reason the first version stated and
  // then applied to the wrong set of registrations: "a zero here is a deterministic run wearing a
  // sampling arm's name, and it would be reported as a pool of identical draws without saying so."
  // That is exactly right **for a registration that declares a `sample-<n>` arm**, and it is wrong for
  // every other one — a run of `none` and `loo` at temperature zero is the lane's ordinary
  // deterministic form, and R77 cannot be registered at all without expressing it.
  //
  // So the rule follows the reason rather than the number: a sampling arm at zero is refused, because
  // its five draws would be one draw reported five times; a registration without one may pin zero,
  // because there is no pool for it to degenerate.
  const temperatureText = values.get('temperature');
  let sampleTemperature: number | undefined;
  if (temperatureText !== undefined) {
    const parsed = Number(temperatureText);
    const sampled = arms.some((arm) => arm.startsWith('sample-'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      collected.push({
        where: `header 'temperature'`,
        problem: `'${temperatureText}' is not a finite number in [0, 2]`,
      });
    } else if (parsed === 0 && sampled) {
      collected.push({
        where: `header 'temperature'`,
        problem: 'is zero for a registration that runs a sample-<n> arm, whose draws would all be one draw',
      });
    } else {
      sampleTemperature = parsed;
    }
  }
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
      ...(facadeNotes === undefined ? {} : { facadeNotes }),
      ...(trainDomain === undefined ? {} : { trainDomain }),
      ...(testDomain === undefined ? {} : { testDomain }),
      ...(recallDomain === undefined ? {} : { recallDomain }),
      ...(plantedArms === undefined ? {} : { plantedArms }),
      ...(sampleTemperature === undefined ? {} : { sampleTemperature }),
      prediction,
      refutation,
      file,
    },
    problems: [],
  };
}

/**
 * The planted arms one dispatch runs, as the matrix a workflow fans out over.
 *
 * `['']` rather than `[]` when a registration plants nothing: a matrix with no values is not a job at
 * all, and `''` is the value the driver already reads as "plant nothing" — so the unplanted leg needs
 * no branch in the lane and no second code path in the workflow.
 */
export function plantedArmMatrix(prereg: Prereg): readonly string[] {
  const arms = prereg.plantedArms ?? [];
  return arms.length === 0 ? [''] : [...arms];
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

/**
 * Whether the arms a dispatch buys are the arms its registration declares.
 *
 * The sampled arms travel in `SOTA_ARMS` — a dispatch input — while the registration declares the
 * same list in its header. Two representations of one fact, and this repository has paid for that
 * shape three times: `retry-values` was registered while the arm did not exist, `sample-5-exec`
 * existed as a parseable formula but not as a name in `OPTIONAL_ARMS`, and R67's dispatch read
 * `gated,oracle` from the menu default while its file said something else entirely. `pnpm check`
 * validates the header against `OPTIONAL_ARMS`; until now nothing compared it with the thing the run
 * actually buys, which is the only comparison that matters at run time.
 *
 * `none` and `full` are always measured and are not always written into a header, so they are dropped
 * from both sides before the comparison. Order is not a fact here: the lanes fan arms out and sort
 * their own output, so both sides are sorted before they are reported.
 *
 * The relation is **equality, in both directions**, and the first version of this function got that
 * wrong in a way worth recording. It asked only whether every declared arm was bought — which is
 * vacuously true when the header declares nothing beyond the baselines, and R72's header declares
 * exactly `full`. A dispatch of `gated,oracle` against it passed the check, ran a different
 * experiment from the one the file describes, and spent 7,235 calls before the budget forecast
 * noticed the arithmetic. "Every element of the empty set is bought" is true and useless; the arm a
 * run buys that its registration never names is the failure mode that costs money, and it is the one
 * the one-directional reading cannot see.
 *
 * The counter-argument for containment was R66: its header names `retry-values` while its dispatch
 * bought `retry-blank,retry-values`, because a treatment without its control is not a measurement.
 * The answer is to write the control into the header — it is the commitment, and a commitment that
 * omits half of what it buys is the defect, not the dispatch. R66's header now names both.
 */
export function armsAgainstRegistration(
  prereg: Pick<Prereg, 'arms'> | undefined,
  requested: Iterable<string>,
): {
  readonly ok: boolean;
  readonly declared: readonly string[];
  readonly requested: readonly string[];
  readonly unbought: readonly string[];
  readonly undeclared: readonly string[];
} {
  const declared = essentialArms(prereg?.arms ?? []);
  const bought = essentialArms(requested);
  const unbought = declared.filter((arm) => !bought.includes(arm));
  const undeclared = bought.filter((arm) => !declared.includes(arm));
  // A registration with no header is a hand run: there is no claim to disagree with.
  const ok = prereg === undefined || (unbought.length === 0 && undeclared.length === 0);
  return { ok, declared, requested: bought, unbought, undeclared };
}

/**
 * The sampled arms a header names that the lane cannot buy.
 *
 * Only `sample-` names are checked, and the restriction is the whole design. A registration's arm
 * header is read by three lanes with three vocabularies — this one's `sample-N-selector` family, the
 * tau-bench pair (`memory`/`reference`), and the BIRD arms that have been retired from the table but
 * are still described by the run that used them — so "every arm must exist" refuses files that are
 * correct. The `sample-` prefix is the one family whose names are *constructed* from a width and a
 * selector, and a constructed name can be parseable, plannable and absent from the list the lane
 * checks membership against: R67's dispatch died on `sample-5-exec` in two seconds for exactly that,
 * and R73's `sample-5-assert` was declared before the arm existed.
 *
 * The check lives here rather than in the lane because a registration is written days before it is
 * dispatched, and `pnpm check` runs on every push.
 */
export function unknownSampleArms(arms: Iterable<string>, known: Iterable<string>): readonly string[] {
  const table = new Set(known);
  return [...new Set(arms)]
    .filter((arm) => arm.startsWith('sample-') && !table.has(arm))
    .sort();
}

/**
 * The arms a header names, minus the two the lane always measures.
 *
 * Exported because the dispatch has to *fall back* to this list when no arm menu entry was given:
 * an empty `SOTA_ARMS` used to fall back to a hard-coded `gated,oracle`, which is a different
 * experiment from the one most registrations describe. The registration is the commitment, so it is
 * also the default, and this is the one place that decides what "declared" means.
 */
export function essentialArms(arms: Iterable<string>): readonly string[] {
  return [...new Set(arms)].filter((arm) => arm !== 'none' && arm !== 'full').sort();
}
