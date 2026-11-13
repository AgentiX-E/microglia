import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSilencePlan } from '../inert.js';
import { OPTIONAL_ARMS, samplingSpecOf } from '../sota.js';
import { DEFAULT_SELECTED_ARM } from '../width.js';
import {
  armsAgainstRegistration,
  backboneProblem,
  distillFormProblem,
  essentialArms,
  facadePairSwitch,
  laneRoleProblem,
  plantedArmMatrix,
  preregGate,
  preregGateAgreement,
  populationAgainstRegistration,
  readPrereg,
  switchOverride,
  thinkingProblem,
  unknownSampleArms,
  type Prereg,
} from '../prereg.js';

const HEADER = [
  '---',
  'id: R8.3-xiyan-cell',
  'step: R8.3',
  'opened: 2026-10-30',
  'arms: none',
  'sample: 350',
  'gates: V31',
  '---',
  '',
].join('\n');

const PREDICTION = [
  '## Prediction',
  '',
  '- The comparison is indicative, never reproduced, because the splits differ in size and in name.',
  '- Our estimate is 53.71 percent on 350 questions, so the interval spans roughly 48.5 to 58.9 points.',
  '',
].join('\n');

const REFUTATION = [
  '## Refutation',
  '',
  '- If the gate accepts a cross-split comparison labelled reproduced, the catalogue is decoration.',
  '- If the intervals do not overlap at all, our harness is not measuring the quantity at all.',
  '',
].join('\n');

const VALID = `${HEADER}${PREDICTION}${REFUTATION}`;

function problemsOf(markdown: string, file = 'R8.3-xiyan-cell.md'): readonly string[] {
  return readPrereg(markdown, file).problems.map((problem) => `${problem.where}: ${problem.problem}`);
}

describe('readPrereg', () => {
  it('reads a complete registration', () => {
    const reading = readPrereg(VALID, 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg).toEqual({
      id: 'R8.3-xiyan-cell',
      step: 'R8.3',
      opened: '2026-10-30',
      arms: ['none'],
      sample: 350,
      gates: ['V31'],
      prediction: [
        'The comparison is indicative, never reproduced, because the splits differ in size and in name.',
        'Our estimate is 53.71 percent on 350 questions, so the interval spans roughly 48.5 to 58.9 points.',
      ],
      refutation: [
        'If the gate accepts a cross-split comparison labelled reproduced, the catalogue is decoration.',
        'If the intervals do not overlap at all, our harness is not measuring the quantity at all.',
      ],
      file: 'R8.3-xiyan-cell.md',
    });
  });

  it('refuses a file with no header at all', () => {
    expect(problemsOf('# just prose')).toEqual([
      'header: the file must open with a --- header block',
    ]);
    expect(readPrereg('# just prose', 'x.md').prereg).toBeUndefined();
  });

  it('refuses a header that never closes', () => {
    expect(problemsOf('---\nid: x\n')).toEqual(['header: the header block is never closed']);
  });

  it('reports a line that is not a pair, an unknown key, and a duplicate', () => {
    const broken = [
      '---',
      'id: R8.3-xiyan-cell',
      'this line has no colon',
      'colour: blue',
      'step: R8.3',
      'step: R8.4',
      'opened: 2026-10-30',
      'arms: none',
      'sample: 350',
      'gates: V31',
      '---',
      '',
      PREDICTION,
      REFUTATION,
    ].join('\n');
    const reported = problemsOf(broken);
    expect(reported).toContain('header \'this line has no colon\': expected key: value');
    expect(reported.some((entry) => entry.includes("unknown key"))).toBe(true);
    expect(reported).toContain("header 'step': declared twice");
  });

  it('reports every missing required key', () => {
    const reported = problemsOf('---\nid: R8.3-xiyan-cell\n---\n\n## Prediction\n\n- a claim that is long enough to pass\n\n## Refutation\n\n- a condition that is long enough to pass\n');
    for (const key of ['step', 'opened', 'arms', 'sample', 'gates']) {
      expect(reported).toContain(`header '${key}': is required`);
    }
  });

  it('refuses an id that disagrees with the file name', () => {
    expect(problemsOf(VALID, 'R8.4-something-else.md')).toContain(
      "header id: 'R8.3-xiyan-cell' does not match the file name 'R8.4-something-else'",
    );
  });

  it('skips blank lines and comments inside the header', () => {
    const spaced = VALID.replace('step: R8.3', '\n# a comment about the step\nstep: R8.3\n');
    expect(problemsOf(spaced)).toEqual([]);
  });

  it('refuses a file with no id at all', () => {
    const anon = VALID.replace('id: R8.3-xiyan-cell\n', '');
    expect(problemsOf(anon)).toEqual(["header 'id': is required"]);
  });

  it('reads the file name from a path with directories', () => {
    const reading = readPrereg(VALID, 'prereg/R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.file).toBe('prereg/R8.3-xiyan-cell.md');
  });

  it('refuses a malformed step, date and sample', () => {
    const broken = VALID.replace('step: R8.3', 'step: stage eight').replace('opened: 2026-10-30', 'opened: 30/10/2026').replace('sample: 350', 'sample: many');
    const reported = problemsOf(broken);
    expect(reported).toContain("header step: 'stage eight' is not a stage identifier such as R8.3");
    expect(reported).toContain("header opened: '30/10/2026' is not a calendar date");
    expect(reported).toContain("header sample: 'many' is not a positive integer");
  });

  it('refuses an impossible calendar date that matches the pattern', () => {
    expect(problemsOf(VALID.replace('opened: 2026-10-30', 'opened: 2026-13-45'))).toContain(
      "header opened: '2026-13-45' is not a calendar date",
    );
  });

  it('refuses an empty list, a bad gate code and a repeated gate', () => {
    expect(problemsOf(VALID.replace('arms: none', 'arms:'))).toContain('header: a comma-separated list is required');
    expect(problemsOf(VALID.replace('gates: V31', 'gates: gate31'))).toContain(
      "header gates: 'gate31' is not a gate code such as V30",
    );
    expect(problemsOf(VALID.replace('gates: V31', 'gates: V31,V31'))).toContain(
      'header gates: a gate is listed twice',
    );
  });

  it('splits a list on commas and trims it', () => {
    const reading = readPrereg(VALID.replace('arms: none', 'arms: none, full ,gated'), 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.arms).toEqual(['none', 'full', 'gated']);
  });

  it('refuses an unfilled placeholder anywhere in the file', () => {
    expect(problemsOf(VALID.replace('350', '350 <n>'))).toContain("body: unfilled placeholder '<n>'");
    // Assembled from pieces: the repository audit forbids the literal in source, and the
    // validator's job is to catch it in a document rather than to contain one.
    const draft = `TO${'DO'}`;
    expect(problemsOf(VALID.replace('350', `350 ${draft}`))).toContain(
      `body: unfilled placeholder '${draft}'`,
    );
  });

  it('refuses a file with neither section, and one with an empty section', () => {
    expect(problemsOf(HEADER)).toEqual([
      '## Prediction: section is missing',
      '## Refutation: section is missing',
    ]);
    const empty = `${HEADER}## Prediction\n\n## Refutation\n\n`;
    expect(problemsOf(empty)).toEqual([
      '## Prediction: section has no bullet',
      '## Refutation: section has no bullet',
    ]);
  });

  it('refuses a bullet too short to be a claim', () => {
    expect(problemsOf(`${HEADER}## Prediction\n\n- helps\n\n${REFUTATION}`)).toContain(
      "## Prediction: 'helps' is too short to be a claim",
    );
  });

  it('stops a section at the next heading', () => {
    const reading = readPrereg(
      `${HEADER}## Prediction\n\n- the first claim is long enough to count\n\n## Method\n\n- not a claim at all, but long\n\n${REFUTATION}`,
      'R8.3-xiyan-cell.md',
    );
    expect(reading.prereg?.prediction).toEqual(['the first claim is long enough to count']);
  });

  it('leaves the optional recall floor absent on a registration that does not declare one', () => {
    expect(readPrereg(VALID, 'R8.3-xiyan-cell.md').prereg?.recallFloor).toBeUndefined();
  });

  it('reads a declared recall floor', () => {
    const header = HEADER.replace('gates: V31', 'gates: V31\nrecallFloor: 0.01');
    const reading = readPrereg(`${header}${PREDICTION}${REFUTATION}`, 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.recallFloor).toBe(0.01);
  });

  it('accepts the as-is floor declared explicitly', () => {
    const header = HEADER.replace('gates: V31', 'gates: V31\nrecallFloor: 0');
    expect(readPrereg(`${header}${PREDICTION}${REFUTATION}`, 'R8.3-xiyan-cell.md').prereg?.recallFloor).toBe(0);
  });

  it('refuses a recall floor that is not a number', () => {
    const header = HEADER.replace('gates: V31', 'gates: V31\nrecallFloor: high');
    expect(problemsOf(`${header}${PREDICTION}${REFUTATION}`)).toContain(
      "header 'recallFloor': is not a finite number in the unit interval",
    );
  });

  it('refuses a recall floor outside the unit interval', () => {
    const header = HEADER.replace('gates: V31', 'gates: V31\nrecallFloor: 1.5');
    expect(problemsOf(`${header}${PREDICTION}${REFUTATION}`)).toContain(
      "header 'recallFloor': is not a finite number in the unit interval",
    );
  });
});

describe('preregGate', () => {
  it('passes a valid registration and names what it fixes', () => {
    const gate = preregGate(readPrereg(VALID, 'R8.3-xiyan-cell.md'));
    expect(gate).toEqual({
      code: 'V30',
      name: 'preregistration',
      ok: true,
      detail: 'R8.3-xiyan-cell fixes none at n=350 with V31',
    });
  });

  it('fails with the first problem', () => {
    const gate = preregGate(readPrereg('no header', 'x.md'));
    expect(gate.ok).toBe(false);
    expect(gate.detail).toContain('1 problem(s)');
    expect(gate.detail).toContain('header block');
  });

  it('fails with a generic reason when the reading carries no problem', () => {
    expect(preregGate({ prereg: undefined, problems: [] })).toEqual({
      code: 'V30',
      name: 'preregistration',
      ok: false,
      detail: 'no pre-registration',
    });
  });

  it('accepts a custom gate name', () => {
    expect(preregGate(readPrereg('no header', 'x.md'), 'dispatch').name).toBe('dispatch');
  });
});

describe('preregGateAgreement', () => {
  const registration = (gates: readonly string[]): Prereg => ({
    id: 'R16-injection-dose',
    step: 'R16',
    opened: '2026-10-31',
    arms: ['none'],
    sample: 350,
    gates,
    prediction: [],
    refutation: [],
    file: 'prereg/R16-injection-dose.md',
  });

  it('accepts a file that names exactly what the run emitted', () => {
    const agreement = preregGateAgreement(registration(['V1', 'V12', 'V32']), ['V32', 'V1', 'V12']);
    expect(agreement.ok).toBe(true);
    expect(agreement.detail).toBe('3 declared gate(s), every one emitted and none unannounced');
  });

  it('refuses a gate the file names and the run never emitted', () => {
    const agreement = preregGateAgreement(registration(['V1', 'V17']), ['V1']);
    expect(agreement.ok).toBe(false);
    expect(agreement.detail).toBe('declares V17, which the run never emitted');
  });

  it('refuses a gate the run emitted and the file never named', () => {
    const agreement = preregGateAgreement(registration(['V1']), ['V1', 'V8', 'V12']);
    expect(agreement.ok).toBe(false);
    expect(agreement.detail).toBe('does not name V8, V12, which the run emitted');
  });

  it('reports both directions when the lists have nothing in common', () => {
    const agreement = preregGateAgreement(registration(['V13', 'V14']), ['V1', 'V2']);
    expect(agreement.ok).toBe(false);
    expect(agreement.detail).toBe(
      'declares V13, V14, which the run never emitted; does not name V1, V2, which the run emitted',
    );
  });

  it('refuses a run that emitted nothing against a file that names a gate', () => {
    expect(preregGateAgreement(registration(['V1']), []).ok).toBe(false);
  });

  it('matches a slugged artefact id against the bare code in the header', () => {
    const agreement = preregGateAgreement(
      registration(['V1', 'V17']),
      ['V1-pack-not-empty', 'V17-net-sign'],
    );
    expect(agreement.ok).toBe(true);
    expect(agreement.detail).toBe('2 declared gate(s), every one emitted and none unannounced');
  });
});

describe('the facadePair header', () => {
  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${PREDICTION}${REFUTATION}`;
  }

  it('registers a within-run paired facade', () => {
    const reading = readPrereg(
      withHeader('recallFloor: 0.01\nfacadePair: as-is-floored'),
      'R8.3-xiyan-cell.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.facadePair).toBe('as-is-floored');
  });

  it('registers the explicit single-facade value', () => {
    const reading = readPrereg(withHeader('facadePair: off'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.facadePair).toBe('off');
  });

  it('leaves every registration opened before R49 on the single-facade path', () => {
    expect(readPrereg(VALID, 'R8.3-xiyan-cell.md').prereg?.facadePair).toBeUndefined();
  });

  it('refuses a value the protocol never declared', () => {
    const reported = problemsOf(withHeader('facadePair: maybe'));
    expect(reported.some((entry) => entry.includes("header 'facadePair'"))).toBe(true);
    expect(readPrereg(withHeader('facadePair: maybe'), 'R8.3-xiyan-cell.md').prereg).toBeUndefined();
  });

  it('keeps recallFloor and facadePair independent', () => {
    const reading = readPrereg(
      withHeader('recallFloor: 0.01\nfacadePair: as-is-floored'),
      'R8.3-xiyan-cell.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.recallFloor).toBe(0.01);
    expect(reading.prereg?.facadePair).toBe('as-is-floored');
  });
});

describe('a paired facade must register its floor', () => {
  it('refuses as-is-floored with no recallFloor', () => {
    const markdown = `${HEADER.replace(/^---\n/, "---\nfacadePair: as-is-floored\n")}${PREDICTION}${REFUTATION}`;
    const reading = readPrereg(markdown, 'R8.3-xiyan-cell.md');
    expect(reading.prereg).toBeUndefined();
    expect(problemsOf(markdown).some((entry) => entry.includes('positive recallFloor'))).toBe(true);
  });

  it('refuses as-is-floored with the as-is floor of zero', () => {
    const markdown = `${HEADER.replace(/^---\n/, "---\nrecallFloor: 0\nfacadePair: as-is-floored\n")}${PREDICTION}${REFUTATION}`;
    expect(problemsOf(markdown).some((entry) => entry.includes('positive recallFloor'))).toBe(true);
  });

  it('exposes a pair switch that is false for absent, off and invalid registrations', () => {
    const base = readPrereg(VALID, 'R8.3-xiyan-cell.md').prereg;
    expect(base).toBeDefined();
    if (base === undefined) return;
    expect(facadePairSwitch(base)).toBe(false);
    expect(facadePairSwitch({ ...base, facadePair: 'off' })).toBe(false);
    expect(facadePairSwitch({ ...base, facadePair: 'as-is-floored', recallFloor: 0.01 })).toBe(true);
  });
});

/**
 * R54: the scenario pair is a property of the experiment.
 *
 * R51 registered three predictions about a within-scenario run and was dispatched against a
 * repository variable that said `TAU_TEST_DOMAIN=airline`. The run measured exactly what it
 * was configured to measure; the configuration was simply invisible in the registration, and
 * the readback graded a retail store's rules on airline questions. These tests pin the header
 * that makes the pair visible and the three refusals that keep a half-pinned pair from
 * leaving half the experiment to a variable.
 */
describe('a registration declares its planted arms, and the workflow fans them out', () => {
  /**
   * R57's header, and the reason it is a header.
   *
   * The arm lived in `TAU_PLANTED_RULES` for three dispatches, which meant three six-hour runs in
   * sequence — a variable is global, and the dispatch menu is full at twenty-five inputs. A list in
   * the registration is the same declaration the scenario pair and the recall floor already are, and
   * it is the only one of the three that changes how many jobs a dispatch runs.
   */
  const withArms = (line: string): string =>
    `${HEADER.replace(/^---\n/, `---\n${line}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads the list, in the order it was registered', () => {
    const reading = readPrereg(withArms('plantedArms: far,near,adversarial'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.plantedArms).toEqual(['far', 'near', 'adversarial']);
  });

  it('leaves the list absent when nothing plants, and the matrix is then one unplanted leg', () => {
    // `['']` rather than `[]`: a matrix with no values is not a job at all, and the empty string is
    // what the driver already reads as "plant nothing".
    const reading = readPrereg(VALID, 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.plantedArms).toBeUndefined();
    expect(plantedArmMatrix(reading.prereg as Prereg)).toEqual(['']);
  });

  it('fans a declared list out one leg per arm', () => {
    const reading = readPrereg(withArms('plantedArms: far,near,adversarial'), 'R8.3-xiyan-cell.md');
    expect(plantedArmMatrix(reading.prereg as Prereg)).toEqual(['far', 'near', 'adversarial']);
  });

  it('refuses a name that no file can answer to', () => {
    // The name is pasted into `TAU_PLANTED_RULES` and indexed into `eval/planted/<domain>.json`; a
    // name with punctuation in it is an arm nobody can dispatch and a file nobody can find.
    expect(problemsOf(withArms('plantedArms: near,Adversarial!'))).toContain(
      "header 'plantedArms': 'Adversarial!' is not an arm name such as near or adversarial",
    );
  });

  it('refuses the same arm twice, because two legs write one artefact directory', () => {
    expect(problemsOf(withArms('plantedArms: near,near'))).toContain(
      "header 'plantedArms': an arm is listed twice",
    );
  });

  it('refuses a header that declares nothing', () => {
    expect(problemsOf(withArms('plantedArms:'))).toContain(
      "header 'plantedArms': declares no arm",
    );
  });
});

describe('a registration can pin its scenario pair', () => {
  const withDomains = (lines: readonly string[]): string =>
    `${HEADER.replace(/^---\n/, `---\n${lines.join('\n')}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads a complete pair', () => {
    const reading = readPrereg(
      withDomains(['trainDomain: retail', 'testDomain: retail', 'recallDomain: retail']),
      'R8.3-xiyan-cell.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.trainDomain).toBe('retail');
    expect(reading.prereg?.testDomain).toBe('retail');
    expect(reading.prereg?.recallDomain).toBe('retail');
  });

  it('leaves the pair absent when nothing pins it, which is every registration before R54', () => {
    const reading = readPrereg(VALID, 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.trainDomain).toBeUndefined();
    expect(reading.prereg?.testDomain).toBeUndefined();
    expect(reading.prereg?.recallDomain).toBeUndefined();
  });

  it('refuses a name that is not a scenario name', () => {
    // The value is pasted into `TAU_TEST_DOMAIN`, so anything a shell would interpret is a
    // value that can change the experiment between the registration and the run.
    for (const bad of ['Retail', 're-tail', '$(echo x)', '../retail', 'retail airline']) {
      const markdown = withDomains([`testDomain: ${bad}`]);
      expect(problemsOf(markdown).some((entry) => entry.includes('is not a scenario name')), bad).toBe(
        true,
      );
    }
  });

  it('refuses a recall domain the store does not own', () => {
    // A third domain is an experiment no registration has a prediction about: recall is asked
    // in the store's own scenario, which is what makes the transfer arm measurable at all.
    const markdown = withDomains([
      'trainDomain: retail',
      'testDomain: airline',
      'recallDomain: airline',
    ]);
    expect(problemsOf(markdown).some((entry) => entry.includes('must equal trainDomain'))).toBe(true);
  });

  it('refuses a recall domain with no train domain to check it against', () => {
    const markdown = withDomains(['recallDomain: retail']);
    expect(problemsOf(markdown).some((entry) => entry.includes('needs trainDomain declared beside it'))).toBe(
      true,
    );
  });
});

/**
 * R53's arm is a third declaration, and the first version of it was parsed, validated and then
 * dropped: the parser's own object literal did not carry the field, so `eval:prereg-notes`
 * printed `false` for a registration that said `three-level`. The lane has spent three
 * iterations on exactly this failure mode — a value that is read, checked, and never travels —
 * so the round trip is a test rather than a paragraph.
 */
describe('the facadeNotes header', () => {
  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${PREDICTION}${REFUTATION}`;
  }

  it('registers three note levels over one store', () => {
    const reading = readPrereg(withHeader('facadeNotes: three-level'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    // The return value, not the parse: this is the assertion that would have failed.
    expect(reading.prereg?.facadeNotes).toBe('three-level');
  });

  it('leaves every registration opened before R53 on the single-note path', () => {
    expect(readPrereg(VALID, 'R8.3-xiyan-cell.md').prereg?.facadeNotes).toBeUndefined();
  });

  it('refuses a value the protocol never declared', () => {
    const reported = problemsOf(withHeader('facadeNotes: four-level'));
    expect(reported.some((entry) => entry.includes("header 'facadeNotes'"))).toBe(true);
  });

  it('refuses to vary the note and the floor in one registration', () => {
    const reading = readPrereg(
      withHeader('recallFloor: 0.01\nfacadePair: as-is-floored\nfacadeNotes: three-level'),
      'R8.3-xiyan-cell.md',
    );
    expect(
      reading.problems.some((entry) => entry.problem.includes('vary two treatments in one dispatch')),
    ).toBe(true);
  });
});

describe('the sampling temperature', () => {
  // R70 measures the same arms at T = 1.0 that R69 measures at the lane's default. The value used
  // to live in `SOTA_SAMPLE_TEMPERATURE`, a repository variable, so setting it for one experiment
  // set it for every queued run — the shape that made `SOTA_MODEL` a per-dispatch input. A
  // registration declares its own temperature and the workflow reads it from the file.
  const withTemperature = (line: string, arms = 'sample-5-first'): string =>
    `${HEADER.replace('arms: none', `arms: ${arms}`).replace(/^---\n/, `---\n${line}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads the number a draw-based registration declares', () => {
    const reading = readPrereg(withTemperature('temperature: 1.0'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.sampleTemperature).toBe(1);
  });

  it('leaves every earlier registration on the lane default', () => {
    const reading = readPrereg(withTemperature(''), 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.sampleTemperature).toBeUndefined();
  });

  it('refuses a temperature outside the interval every provider in the lane accepts', () => {
    for (const bad of ['2.5', '-1', 'hot']) {
      const reported = problemsOf(withTemperature(`temperature: ${bad}`));
      expect(reported.some((entry) => entry.includes("header 'temperature'"))).toBe(true);
    }
  });

  it('refuses zero on a registration that draws a pool, because five draws would be one draw', () => {
    // The reason the old rule was written for, kept where it applies. A `sample-<n>` arm at
    // temperature zero returns the same query n times and the artefact would report a pool.
    const reported = problemsOf(withTemperature('temperature: 0'));
    expect(reported.some((entry) => entry.includes('whose draws would all be one draw'))).toBe(true);
  });

  it('accepts zero on a registration that draws once, which is the deterministic form', () => {
    // R77 needs it: its whole design is that a deterministic decoder given two prompts differing by
    // one rule returns the same query if and only if the rule did not matter. The old rule refused
    // this and called the declaration meaningless — but the temperature is what **every** draw in the
    // run is sampled at, so a registration without a sampling arm was never describing nothing, it was
    // describing its own single draw. R74 is the evidence: it declared no temperature, inherited the
    // workflow's 0.7, and its pairs were sampled at 0.7 without its file ever saying so.
    const reading = readPrereg(withTemperature('temperature: 0', 'none,loo'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.sampleTemperature).toBe(0);
  });

  it('accepts a non-zero temperature on a registration that draws once', () => {
    const reading = readPrereg(withTemperature('temperature: 0.7', 'none,loo'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.sampleTemperature).toBe(0.7);
  });
});

describe('the arms a dispatch buys against the arms it registers', () => {
  // R67's dispatch bought `gated,oracle` from the menu default while its file named five sampling
  // arms, and nothing noticed: the header is validated against `OPTIONAL_ARMS` and the menu was
  // validated against nothing. The comparison has to be order-insensitive and it has to ignore
  // `none`/`full`, because those are always measured and are not always written into a header.
  const registration = (...arms: string[]): { arms: readonly string[] } => ({ arms });

  it('agrees when both sides name the same arms in a different order', () => {
    const agreement = armsAgainstRegistration(
      registration('sample-5-first', 'sample-10-oracle', 'sample-5-exec'),
      ['sample-5-exec', 'sample-5-first', 'sample-10-oracle'],
    );
    expect(agreement.ok).toBe(true);
    expect(agreement.declared).toEqual(['sample-10-oracle', 'sample-5-exec', 'sample-5-first']);
    expect(agreement.requested).toEqual(['sample-10-oracle', 'sample-5-exec', 'sample-5-first']);
    expect(agreement.unbought).toEqual([]);
    expect(agreement.undeclared).toEqual([]);
  });

  it('ignores none and full, which every run measures whether or not it says so', () => {
    const agreement = armsAgainstRegistration(registration('sample-5-first'), ['none', 'full', 'sample-5-first']);
    expect(agreement.ok).toBe(true);
  });

  it('refuses a dispatch that buys an arm its registration does not name', () => {
    // The failure this exists for: the menu default is not the registration.
    const agreement = armsAgainstRegistration(registration('sample-10-first'), ['gated', 'oracle']);
    expect(agreement.ok).toBe(false);
    expect(agreement.declared).toEqual(['sample-10-first']);
    expect(agreement.requested).toEqual(['gated', 'oracle']);
    expect(agreement.undeclared).toEqual(['gated', 'oracle']);
    expect(agreement.unbought).toEqual(['sample-10-first']);
  });

  it('refuses a dispatch against a registration that declares only baselines', () => {
    // R72's shape, and the defect this rule had for one iteration. The header declares `full`, the
    // menu was empty, the workflow substituted `gated,oracle`, and the one-directional check asked
    // "is every declared arm bought" — of an empty list, which is true for any dispatch at all. The
    // run spent 7,235 calls measuring an experiment its file does not describe.
    const agreement = armsAgainstRegistration(registration('full'), ['gated', 'oracle']);
    expect(agreement.declared).toEqual([]);
    expect(agreement.ok).toBe(false);
    expect(agreement.undeclared).toEqual(['gated', 'oracle']);
    expect(agreement.unbought).toEqual([]);
  });

  it('accepts the baselines alone against a header that declares only baselines', () => {
    expect(armsAgainstRegistration(registration('full'), ['none', 'full']).ok).toBe(true);
  });

  it('refuses a dispatch that buys a control its registration does not name', () => {
    // R66's shape, and the relation is equality rather than containment: the file named the
    // treatment while the dispatch bought `retry-blank` beside it. The header is the commitment, so
    // the header was corrected — an arm list that omits half of what it buys is the defect, and a
    // rule that lets it pass is the rule that let R72 through.
    const agreement = armsAgainstRegistration(registration('retry-values'), ['retry-blank', 'retry-values']);
    expect(agreement.ok).toBe(false);
    expect(agreement.undeclared).toEqual(['retry-blank']);
    expect(agreement.unbought).toEqual([]);
  });

  it('refuses a dispatch that buys fewer arms than the registration declares', () => {
    const agreement = armsAgainstRegistration(
      registration('sample-5-first', 'sample-5-exec'),
      ['sample-5-first'],
    );
    expect(agreement.ok).toBe(false);
    expect(agreement.unbought).toEqual(['sample-5-exec']);
  });

  it('leaves a hand run alone, because there is no claim to disagree with', () => {
    expect(armsAgainstRegistration(undefined, ['gated', 'oracle']).ok).toBe(true);
  });

  it('drops the baselines, deduplicates and sorts what a header names', () => {
    // One definition of "declared", used by the check and by the dispatch's fallback: a header read
    // differently in two places is the shape this whole file exists to close.
    expect(essentialArms(['none', 'full', 'gated', 'gated', 'oracle'])).toEqual(['gated', 'oracle']);
    expect(essentialArms(['none', 'full'])).toEqual([]);
  });
});

describe('the sampled arms a header names that the lane cannot buy', () => {
  const KNOWN = ['sample-5', 'sample-5-first', 'sample-5-assert'];

  it('says nothing about a header whose arms all exist', () => {
    expect(unknownSampleArms(['sample-5-first', 'sample-5-assert'], KNOWN)).toEqual([]);
  });

  it('names the one that does not, because a constructible name is not an existing arm', () => {
    // R67's dispatch died on `sample-5-exec` in two seconds: the parser built it from a width and a
    // selector, and the table the lane checks membership against had never been told about it.
    expect(unknownSampleArms(['sample-5-first', 'sample-9-oracle'], KNOWN)).toEqual(['sample-9-oracle']);
  });

  it('leaves the other two vocabularies alone', () => {
    // `memory`/`reference` belong to the tau-bench lane and `retry-values` to a retired BIRD family.
    // A check that demanded every arm exist would refuse files that are correct, which is how a gate
    // teaches its author to route around it.
    expect(unknownSampleArms(['memory', 'reference', 'retry-values', 'keyword-router'], KNOWN)).toEqual([]);
  });

  it('reports each unknown arm once', () => {
    expect(unknownSampleArms(['sample-2-x', 'sample-2-x'], KNOWN)).toEqual(['sample-2-x']);
  });
});

describe('the target list a top-up registration buys its draws against', () => {
  const withTargets = (line: string): string =>
    `${HEADER.replace(/^---\n/, `---\n${line}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads a plan path out of the header', () => {
    const reading = readPrereg(
      withTargets('looTargets: eval/manifests/loo/R77-silent-tail.json'),
      'R8.3-xiyan-cell.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.looTargets).toBe('eval/manifests/loo/R77-silent-tail.json');
  });

  it('leaves every earlier registration buying nothing', () => {
    const reading = readPrereg(withTargets(''), 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.looTargets).toBeUndefined();
  });

  it('refuses a path that is absolute or climbs out of the repository', () => {
    // A registration is a document, and a document that names a file outside the tree is either a
    // typo or a dispatch that reads whatever the runner happens to have there.
    for (const bad of ['/etc/passwd', '../secrets.json', 'eval/../../x.json']) {
      const reported = problemsOf(withTargets(`looTargets: ${bad}`));
      expect(reported.some((entry) => entry.includes("header 'looTargets'"))).toBe(true);
    }
  });
});

describe('the population a registration scores', () => {
  const withOffset = (line: string): string =>
    `${HEADER.replace(/^---\n/, `---\n${line}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads an offset out of the header', () => {
    const reading = readPrereg(withOffset('offset: 2000'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.offset).toBe(2000);
  });

  it('leaves every earlier registration starting at the first question', () => {
    const reading = readPrereg(withOffset(''), 'R8.3-xiyan-cell.md');
    expect(reading.prereg?.offset).toBeUndefined();
  });

  it('refuses an offset that is not a count of questions', () => {
    // Zero is legal and therefore not in this list: a registration may state that it starts at the
    // beginning, and the value it states is the one the gate compares against. An empty value is read
    // as zero for the same reason `sample: ` reads as zero — the header's parser drops a value it
    // cannot interpret onto the key's absence, and absence already means "the first question".
    for (const bad of ['-1', '1.5', 'two']) {
      const reported = problemsOf(withOffset(`offset: ${bad}`));
      expect(reported.some((entry) => entry.includes('header offset'))).toBe(true);
    }
  });

  it('reads a split out of the header', () => {
    const reading = readPrereg(withOffset('split: dev'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.split).toBe('dev');
  });

  it('leaves every earlier registration saying nothing about its split', () => {
    expect(readPrereg(withOffset(''), 'R8.3-xiyan-cell.md').prereg?.split).toBeUndefined();
  });

  it('refuses a split the lane cannot serve', () => {
    // `sample` and the split are two halves of one population — 1,534 is `dev`, 350 is `minidev` — and
    // a header naming a split the workflow does not offer would be discovered by the first model call
    // of a dispatch that had already been paid for.
    for (const bad of ['Dev', 'minidev2', 'full']) {
      const reported = problemsOf(withOffset(`split: ${bad}`));
      expect(reported.some((entry) => entry.includes("header 'split'"))).toBe(true);
    }
  });

  it('reads an empty offset as the first question', () => {
    const reading = readPrereg(withOffset('offset:'), 'R8.3-xiyan-cell.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.offset).toBe(0);
  });
});

describe('a dispatch whose population disagrees with its registration', () => {
  const registration = (sample: number, offset?: number): Pick<Prereg, 'sample' | 'offset'> =>
    offset === undefined ? { sample } : { sample, offset };

  it('accepts the population the file names', () => {
    expect(populationAgainstRegistration(registration(2000), 2000, 0).ok).toBe(true);
    expect(populationAgainstRegistration(registration(1875, 2000), 1875, 2000).ok).toBe(true);
  });

  it('has nothing to compare against for a hand run', () => {
    expect(populationAgainstRegistration(undefined, 350, 0).ok).toBe(true);
  });

  it('refuses a dispatch that scores every usable question', () => {
    // `limit = 0` is not "at least `sample`": the extra questions change the folds, and the folds are
    // half of what a cross-fitted number means.
    const agreement = populationAgainstRegistration(registration(2000), 0, 0);
    expect(agreement.ok).toBe(false);
    expect(agreement.problems[0]).toContain('every usable question');
  });

  it('names both numbers when the sample disagrees', () => {
    const agreement = populationAgainstRegistration(registration(2000), 350, 0);
    expect(agreement.ok).toBe(false);
    expect(agreement.problems[0]).toContain('350');
    expect(agreement.problems[0]).toContain('2000');
  });

  it('refuses a slice that starts where the file does not', () => {
    // The two directions read differently on purpose: "starts at the first question" is a replay of a
    // prefix, and "skips 2000" is a promise to score questions the registration never sized.
    const atZero = populationAgainstRegistration(registration(1875, 2000), 1875, 0);
    expect(atZero.ok).toBe(false);
    expect(atZero.problems[0]).toContain('starts at the first question');
    const jumped = populationAgainstRegistration(registration(2000), 2000, 2000);
    expect(jumped.ok).toBe(false);
    expect(jumped.problems[0]).toContain('skips 2000');
  });

  it('reports both disagreements rather than the first', () => {
    const agreement = populationAgainstRegistration(registration(1875, 2000), 2000, 0);
    expect(agreement.problems.length).toBe(2);
  });

  it('accepts a split that matches the file', () => {
    expect(populationAgainstRegistration({ sample: 1534, split: 'dev' }, 1534, 0, 'dev').ok).toBe(true);
  });

  it('refuses the other split even when the question count agrees', () => {
    // R81's fourth dispatch: `sample: 1534` in the file, `split: minidev` on the menu. The limit check
    // passed because `limit` was 0 and the lane read every usable question of a 350-question split, and
    // the artefact was published under the registration's name for $0.0973.
    const agreement = populationAgainstRegistration({ sample: 350, split: 'dev' }, 350, 0, 'minidev');
    expect(agreement.ok).toBe(false);
    expect(agreement.problems).toEqual([
      "this dispatch scores the 'minidev' split, but the registration scores 'dev'",
    ]);
  });

  it('compares nothing when either side names no split', () => {
    // The same asymmetry the offset check uses: a file that never stated a split is not thereby wrong,
    // and a dispatch that states none is checked against nothing.
    expect(populationAgainstRegistration({ sample: 350 }, 350, 0, 'minidev').ok).toBe(true);
    expect(populationAgainstRegistration({ sample: 350, split: 'dev' }, 350, 0).ok).toBe(true);
  });
});

describe('the draw plan R78 is registered against', () => {
  // A registration that names a file nobody has read is a dispatch that fails at the reader, and the
  // failure would arrive after the runner was provisioned and the caches restored. This is the same
  // discipline as the coupling ledger: the committed artefact has to parse, and it has to agree with the
  // numbers the registration quotes about it.
  const reading = readPrereg(
    readFileSync('prereg/R78-silent-tail.md', 'utf8'),
    'prereg/R78-silent-tail.md',
  );

  it('is named by the registration and parses', () => {
    expect(reading.problems).toEqual([]);
    const declared = reading.prereg?.looTargets;
    expect(declared).toBe('eval/manifests/loo/R77-silent-tail.json');
    const plan = parseSilencePlan(readFileSync(declared as string, 'utf8'), declared as string);
    expect(plan.draws).toBe(5);
    expect(plan.targets.length).toBe(105);
    expect(plan.targets.reduce((sum, row) => sum + row.need, 0)).toBe(346);
  });

  it('names no rule twice, which the parser would refuse but a hand edit could reintroduce', () => {
    const plan = parseSilencePlan(
      readFileSync('eval/manifests/loo/R77-silent-tail.json', 'utf8'),
      'eval/manifests/loo/R77-silent-tail.json',
    );
    expect(new Set(plan.targets.map((row) => row.rule)).size).toBe(plan.targets.length);
  });

  it('scores questions R77 did not, because a re-drawn pair cannot inform', () => {
    // R77 is `offset = 0, n = 2,000` (its own header says 2000), so this dispatch starts where R77's
    // slice ended. The two numbers are the whole reason `offset` exists: a `loo` draw is a (rule,
    // question) pair and temperature zero makes a second draw of the same pair the same call.
    expect(reading.prereg?.offset).toBe(2000);
    expect(reading.prereg?.sample).toBe(1900);
    expect(populationAgainstRegistration(reading.prereg, 1900, 2000).ok).toBe(true);
    // The two ways the overlap could come back silently, refused by the same function the lane runs.
    expect(populationAgainstRegistration(reading.prereg, 1900, 0).ok).toBe(false);
    expect(populationAgainstRegistration(reading.prereg, 2000, 2000).ok).toBe(false);
  });

  it('fits in the corpus R77 measured, with the draws it needs and room to spare', () => {
    // `[sota] selection: 7829 of 9428 questions over 58 databases` in R77's job log. A slice that ran
    // past the end would score fewer questions than the registration sized, silently.
    const population = 7829;
    const offset = reading.prereg?.offset ?? 0;
    const sample = reading.prereg?.sample ?? 0;
    expect(offset + sample).toBeLessThan(population);
    // The draws this buys, at the hit rate R77 measured on its own packs: 369 of 2,000 questions hold
    // a plan rule. Below 346 the plan is only partly bought and the readback has to say so.
    // `floor(sample × 369 / 2000)`: 1,875 gives 345 and the plan needs 346, which is why the header
    // says 1,900 — the one-draw shortfall Amendment 1 records.
    expect(Math.floor((sample * 369) / 2000)).toBeGreaterThanOrEqual(346);
  });
});

describe('the pruning registration', () => {
  // R79 is the first arm whose counterfactual is less memory, and its meaning is entirely in the list
  // it names: `pruned` with no `looTargets` renders the full pack and would be published as `full`
  // under a second name. The lane refuses that; this asserts the file would not ask for it.
  const reading = readPrereg(
    readFileSync('prereg/R79-pruned-pack.md', 'utf8'),
    'prereg/R79-pruned-pack.md',
  );

  it('parses, declares the pruning arm, and names the list that gives it meaning', () => {
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.arms).toEqual(['pruned']);
    expect(reading.prereg?.looTargets).toBe('eval/manifests/loo/R77-silent-tail.json');
  });

  it('scores R78’s slice, so the learning cache pays for the second pass', () => {
    // Two registrations on one slice is not a duplicate dispatch: the store is rebuilt from the same
    // questions at the same seeds, and `SOTA_DISTILL_CACHE` keys on the prompt, so the second pass
    // learns for nothing. It also makes the two readbacks comparable question by question.
    const r78 = readPrereg(
      readFileSync('prereg/R78-silent-tail.md', 'utf8'),
      'prereg/R78-silent-tail.md',
    );
    expect(reading.prereg?.offset).toBe(r78.prereg?.offset);
    expect(reading.prereg?.sample).toBe(r78.prereg?.sample);
    expect(populationAgainstRegistration(reading.prereg, 1900, 2000).ok).toBe(true);
  });
});

describe('the scale registration', () => {
  // R80 is R73's mechanism at the size R73's own arithmetic asks for: 115 eligible questions cannot
  // separate an AUC of 0.56 from chance, and `dev` is the smallest split that can.
  const reading = readPrereg(
    readFileSync('prereg/R80-reader-at-scale.md', 'utf8'),
    'prereg/R80-reader-at-scale.md',
  );

  it('parses, and names the control beside the treatment', () => {
    // The header is the commitment. A file that named only `sample-5-assert` would let a dispatch buy
    // the treatment without the draw it is measured against, which is R66's lesson recorded as a rule.
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.arms).toEqual(['sample-5-first', 'sample-5-assert']);
  });

  it('names two arms the lane can build, not two it can only spell', () => {
    // R67's dispatch died in two seconds on a name the parser could construct and the table had never
    // been told about. Membership is asked of the table the lane dispatches with, not of a literal.
    for (const arm of reading.prereg?.arms ?? []) {
      expect(OPTIONAL_ARMS as readonly string[]).toContain(arm);
      expect(samplingSpecOf(arm)).toEqual({
        n: 5,
        selector: arm === 'sample-5-first' ? 'first' : 'assert',
      });
    }
  });

  it('sizes the split the published dev cell was measured on, so `none` re-buys 57.63%', () => {
    expect(reading.prereg?.sample).toBe(1534);
    // Absent rather than `offset: 0`: a header written before R78 says nothing about a start, and
    // reading that as zero is the parser's job. What matters here is that this register skips nothing
    // and therefore scores the same 1,534 questions the published cell was measured on.
    expect(reading.prereg?.offset ?? 0).toBe(0);
    expect(populationAgainstRegistration(reading.prereg, 1534, 0).ok).toBe(true);
  });

  it('names an arm the width reading does not default to', () => {
    // The share R67, R68 and R70 reported divided by `sample-5-exec`. R80's middle arm is a written
    // reader, so `eval:width-share` has to be told which arm to divide by; a reading stuck on the default
    // would have printed a ceiling for an arm this dispatch never bought, which is the wrong-file defect
    // one flag over.
    expect(reading.prereg?.arms ?? []).not.toContain(DEFAULT_SELECTED_ARM);
    expect(reading.prereg?.arms).toContain('sample-5-assert');
  });

  it('buys a population that can separate the AUC it is looking for', () => {
    // R73's own closing arithmetic: eligible questions are 32.9% of the split, 115 was too few to
    // detect 0.56, and about 500 is enough. A later edit that shrinks the sample has to argue with
    // this line rather than with a sentence in a file.
    const eligible = (questions: number): number => Math.floor(questions * 0.329);
    expect(eligible(350)).toBeLessThan(120);
    expect(eligible(reading.prereg?.sample ?? 0)).toBeGreaterThanOrEqual(500);
  });
});

describe('the reconstruction registration', () => {
  // R81 is the first arm that injects advice the store never stored, and its whole claim is that
  // persistence — not content, not quantity — is what costs the pack its points. The three papers it
  // cites all prescribe reconstruction; the file has to buy the control that tells a reconstruction from
  // a second attempt.
  const reading = readPrereg(
    readFileSync('prereg/R81-reconstruction.md', 'utf8'),
    'prereg/R81-reconstruction.md',
  );

  it('parses, and names the shuffled control beside the treatment', () => {
    // A header naming only `full-reconstructed` would let a dispatch buy a treatment that adds a call
    // with nothing to compare it to, and the arm's delta would then be a delta about the extra call.
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.arms).toEqual([
      'full-reconstructed',
      'full-reconstructed-shuffled',
    ]);
  });

  it('buys two arms the lane can build', () => {
    for (const arm of reading.prereg?.arms ?? []) {
      expect(OPTIONAL_ARMS as readonly string[]).toContain(arm);
    }
  });

  it('re-buys the published dev cell rather than a slice of it', () => {
    expect(reading.prereg?.sample).toBe(1534);
    expect(populationAgainstRegistration(reading.prereg, 1534, 0).ok).toBe(true);
  });

  it('keeps the guidance budget small enough that a win cannot be a length effect', () => {
    // The arm injects less text than the pack it is compared against, which is the only way a positive
    // delta is readable as "better aimed" rather than "more text".
    const source = readFileSync('packages/eval/src/bin/sota-bird.ts', 'utf8');
    const match = /const RECONSTRUCT_BUDGET = (\d+);/.exec(source);
    expect(match).not.toBeNull();
    const budget = Number(match?.[1]);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(1090 / 2);
  });
});

describe('a registration can fix the backbone, which is the one variable R82 moves', () => {
  const NAME = 'R8.3-xiyan-cell.md';
  const withHeader = (line: string): string =>
    `${HEADER.replace(/^---\n/, `---\n${line}\n`)}${PREDICTION}${REFUTATION}`;

  it('reads the model id, by bare name or with the provider prefix', () => {
    // The file name is the header's own id: `readPrereg` refuses a registration whose id and file
    // disagree, and a case that passed a different name would be reading `undefined` from a problem.
    expect(readPrereg(withHeader('backbone: deepseek-v4-pro'), NAME).prereg?.backbone).toBe(
      'deepseek-v4-pro',
    );
    expect(
      readPrereg(withHeader('backbone: deepseek/deepseek-v4-pro'), NAME).prereg?.backbone,
    ).toBe('deepseek/deepseek-v4-pro');
    // The dispatch spelling, where the prefix chooses a host and a key rather than naming a provider
    // inside the id: a registration may say either, and the comparison is on the id.
    expect(readPrereg(withHeader('backbone: zhipu:glm-4.7-flashx'), NAME).prereg?.backbone).toBe(
      'zhipu:glm-4.7-flashx',
    );
  });

  it('leaves it absent when the registration pins nothing, which is every registration before R82', () => {
    expect(readPrereg(VALID, NAME).prereg?.backbone).toBeUndefined();
  });

  it('refuses a value that is not a model id, before a dispatch can paste it into SOTA_MODEL', () => {
    // The header is validated on every push; a dispatch field is typeable by anyone and reaches a paid
    // run, so the shape is checked where the checking is free.
    expect(problemsOf(withHeader('backbone: DeepSeek V4'))).toContain(
      "header 'backbone': 'DeepSeek V4' is not a model id such as deepseek-flash, " +
        'deepseek/deepseek-flash or zhipu:glm-4.7-flashx',
    );
    expect(problemsOf(withHeader('backbone: -v4-pro'))).toHaveLength(1);
  });
});

describe('backboneProblem', () => {
  it('says nothing when the registration pins no model', () => {
    expect(backboneProblem('deepseek-flash', undefined)).toBeUndefined();
  });

  it('says nothing when the dispatch would call the model the registration fixed', () => {
    expect(backboneProblem('deepseek-v4-pro', 'deepseek-v4-pro')).toBeUndefined();
  });

  it('treats a dispatch-style provider prefix as the same model', () => {
    expect(backboneProblem('glm-4.7-flashx', 'zhipu:glm-4.7-flashx')).toBeUndefined();
  });

  it('compares what the client sends, so a provider prefix is the same model', () => {
    // `deepseek/` is litellm's spelling of the same id and `restModelOf` is the one place that
    // translation lives; a check on the typed spelling would refuse the lane's own convention.
    expect(backboneProblem('deepseek/deepseek-v4-pro', 'deepseek-v4-pro')).toBeUndefined();
  });

  it('refuses a run whose model is not the one the registration fixed', () => {
    expect(backboneProblem('deepseek-flash', 'deepseek-v4-pro')).toBe(
      "this registration fixes the backbone at 'deepseek-v4-pro' and this dispatch would call " +
        "'deepseek-flash', so the model is not the only variable that moved",
    );
  });
});

describe('the thinking regime a registration declares', () => {
  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${PREDICTION}${REFUTATION}`;
  }

  it('reads the regime, because it is a property of the experiment', () => {
    // R84's claim is that one variable moved and that the regime is the one that was held fixed. The
    // dispatch menu is full at twenty-five inputs and a repository variable is global, which is the
    // defect `SOTA_MODEL` and `SOTA_SAMPLE_TEMPERATURE` were both promoted out of — so the header is
    // the only place the regime can live without becoming a setting for every queued run.
    expect(readPrereg(withHeader('thinking: on'), 'R8.3-xiyan-cell.md').prereg?.thinking).toBe('on');
    expect(readPrereg(withHeader('thinking: off'), 'R8.3-xiyan-cell.md').prereg?.thinking).toBe('off');
  });

  it('leaves every registration that states none on the lane default', () => {
    expect(readPrereg(VALID, 'R8.3-xiyan-cell.md').prereg?.thinking).toBeUndefined();
  });

  it('refuses a spelling the lane cannot run', () => {
    expect(problemsOf(withHeader('thinking: yes'))).toContain(
      "header 'thinking': 'yes' is not on or off",
    );
  });

  it('refuses the synonyms the environment variable accepts, which are not declarations', () => {
    // `SOTA_THINKING` accepts `enabled`, `disabled`, `true` and `false` because a human types it into a
    // variable box; a header is read by every later dispatch and a registration that says `enabled` is
    // a registration whose declaration cannot be compared to the switch the lane runs.
    expect(problemsOf(withHeader('thinking: enabled'))).toContain(
      "header 'thinking': 'enabled' is not on or off",
    );
  });
});

describe('thinkingProblem', () => {
  it('says nothing when the registration pins no regime', () => {
    expect(thinkingProblem('on', undefined)).toBeUndefined();
  });

  it('says nothing when the dispatch runs the regime the registration fixed', () => {
    expect(thinkingProblem('on', 'on')).toBeUndefined();
    expect(thinkingProblem('off', 'off')).toBeUndefined();
  });

  it('says nothing when the dispatch names none, because the registration decides', () => {
    // `null` is the environment being unset, which is not a second opinion. This is the branch R84
    // relies on: an unset variable and `thinking: on` in the file is one regime, not a disagreement.
    expect(thinkingProblem(null, 'on')).toBeUndefined();
    expect(thinkingProblem(null, 'off')).toBeUndefined();
  });

  it('refuses a run whose regime is not the one the registration fixed', () => {
    expect(thinkingProblem('off', 'on')).toBe(
      "this registration fixes the thinking regime at 'on' and this dispatch would run 'off', " +
        'so the regime is not the only variable that moved',
    );
    expect(thinkingProblem('on', 'off')).toContain("fixes the thinking regime at 'off'");
  });
});

describe('the lane role, as a header field', () => {
  const HEADER = [
    '---',
    'id: R85-lane-role',
    'step: R85',
    'opened: 2026-11-11',
    'arms: sample-5-first',
    'sample: 350',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the role', () => {
    const reading = readPrereg(withHeader('lane: hostile'), 'R85-lane-role.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.lane).toBe('hostile');
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R85-lane-role.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.lane).toBeUndefined();
  });

  it('refuses a role outside the three, and the capitalised form of one', () => {
    expect(readPrereg(withHeader('lane: sota'), 'R85-lane-role.md').problems).toEqual([
      { where: "header 'lane'", problem: "'sota' is not one of product, transfer or hostile" },
    ]);
    expect(readPrereg(withHeader('lane: Product'), 'R85-lane-role.md').problems).toHaveLength(1);
  });
});

describe('the distiller form, as a header field', () => {
  const HEADER = [
    '---',
    'id: R86-distill-form',
    'step: R86',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 228',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the form the registration asks the distiller for', () => {
    const reading = readPrereg(withHeader('distillForm: procedure'), 'R86-distill-form.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.distillForm).toBe('procedure');
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('trainDomain: retail'), 'R86-distill-form.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.distillForm).toBeUndefined();
  });

  it('refuses a form the lane cannot render, and the capitalised form of one', () => {
    // `trace` is resolved by the unit, not by this field: a header that named it would be
    // declaring a form the lane never reads, which is the defect this field closes.
    expect(readPrereg(withHeader('distillForm: narrative'), 'R86-distill-form.md').problems).toEqual([
      { where: "header 'distillForm'", problem: "'narrative' is not one of lesson, procedure, repair, lexicon" },
    ]);
    expect(readPrereg(withHeader('distillForm: Procedure'), 'R86-distill-form.md').problems).toHaveLength(1);
    expect(readPrereg(withHeader('distillForm: trace'), 'R86-distill-form.md').problems).toHaveLength(1);
  });
});

describe('switchOverride — a switch the registration overrides is a notice, not a refusal', () => {
  it('reports the variable a registration overrode, with both values', () => {
    // The exact state that stopped R58: the header fixes 3, `vars.TAU_TRACE_CLAIMS` holds 6 from the
    // round that asked whether the cap binds, and the arm reads the header.
    expect(switchOverride('claims', 3, '6')).toBe(
      "claims: the variable holds '6', overridden by the registration's '3'",
    );
  });

  it('says nothing when the variable agrees or is unset', () => {
    expect(switchOverride('claims', 3, '3')).toBeUndefined();
    expect(switchOverride('claims', 3, '')).toBeUndefined();
    expect(switchOverride('claims', 3, null)).toBeUndefined();
    expect(switchOverride('claims', 3, '   ')).toBeUndefined();
  });

  it('marks the case that is actually dangerous: a variable with no declaration behind it', () => {
    // Here the variable *is* what runs, and the run cannot describe its own treatment. Still a notice
    // rather than a refusal, because refusing it here would refuse every registration that predates the
    // switch — the readback is where a value the header never named becomes a `NO_MEASUREMENT`.
    expect(switchOverride('unit', undefined, 'trace')).toBe(
      "unit: the registration declares none and the variable holds 'trace', which this dispatch will run",
    );
    expect(switchOverride('unit', undefined, '')).toBeUndefined();
  });

  it('compares numbers as the strings a header and a variable both are', () => {
    expect(switchOverride('claims', 3, '3.0')).toBe(
      "claims: the variable holds '3.0', overridden by the registration's '3'",
    );
    expect(switchOverride('claims', 3, ' 3 ')).toBeUndefined();
  });
});

describe('distillFormProblem', () => {
  it('says nothing when the registration names no form', () => {
    expect(distillFormProblem('procedure', undefined, 'correction')).toBeUndefined();
    expect(distillFormProblem('', undefined, 'trace')).toBeUndefined();
  });

  it('says nothing when the variable is unset, because the registration decides', () => {
    // A variable left over from another experiment is the case this exists for; an unset one is
    // not a second opinion, it is the absence of one.
    expect(distillFormProblem('', 'procedure', 'correction')).toBeUndefined();
    expect(distillFormProblem(null, 'procedure', 'correction')).toBeUndefined();
  });

  it('says nothing when the variable agrees', () => {
    expect(distillFormProblem('procedure', 'procedure', 'correction')).toBeUndefined();
  });

  it('leaves a stale variable to the notice rather than refusing the dispatch', () => {
    // This branch used to refuse, and the refusal was the wrong instrument: the arm reads the
    // registration's form, so `vars.TAU_DISTILL_FORM` holding `lesson` cannot make the run distil
    // lessons. `switchOverride` reports it; `switchOverride`'s describe is where that is graded.
    expect(distillFormProblem('lesson', 'procedure', 'correction')).toBeUndefined();
  });

  it('refuses a raw dispatch that declares a form, because no prompt is sent', () => {
    // R85's unit writes the episode verbatim and calls no model. A registration that named a form
    // would describe a prompt nothing sends, and the store would be published as `raw` while
    // claiming a form that was never asked for -- an inconsistency inside the registration, which is
    // the one class of disagreement this check still refuses.
    expect(distillFormProblem('', 'procedure', 'raw')).toContain('there is no prompt for a form');
    expect(distillFormProblem('', undefined, 'raw')).toBeUndefined();
  });

  it('refuses a trace dispatch that would discard the registered form', () => {
    // `form: unit === 'trace' ? 'trace' : DISTILL_FORM` makes a header that names a form and a
    // dispatch that distils traces a contradiction: the registered switch cannot take effect, and
    // the run would be published as an experiment of two variables with one of them inert.
    expect(distillFormProblem('', 'procedure', 'trace')).toBe(
      "this registration fixes the distiller's form at 'procedure' and this dispatch distils " +
        "'trace', which replaces the form, so the registered switch cannot take effect",
    );
    expect(distillFormProblem('', 'trace', 'trace')).toBeUndefined();
  });
});

describe('the distiller unit, as a header field', () => {
  const HEADER = [
    '---',
    'id: R87-distill-unit',
    'step: R87',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 228',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the unit the registration distils', () => {
    expect(readPrereg(withHeader('distillUnit: correction'), 'R87-distill-unit.md').prereg?.distillUnit)
      .toBe('correction');
    expect(readPrereg(withHeader('distillUnit: trace'), 'R87-distill-unit.md').prereg?.distillUnit)
      .toBe('trace');
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R87-distill-unit.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.distillUnit).toBeUndefined();
  });

  it('refuses a unit the lane cannot distil, and the capitalised form of one', () => {
    expect(readPrereg(withHeader('distillUnit: episode'), 'R87-distill-unit.md').problems).toEqual([
      { where: "header 'distillUnit'", problem: "'episode' is not one of correction, trace, raw" },
    ]);
    expect(readPrereg(withHeader('distillUnit: Trace'), 'R87-distill-unit.md').problems).toHaveLength(1);
  });
});

describe('the distilling scope', () => {
  const HEADER = [
    '---',
    'id: R87-distill-scope',
    'step: R87',
    'opened: 2026-11-12',
    'arms: memory,reference',
    'sample: 228',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the population the registration distils from', () => {
    // R62's whole treatment is this switch, and its header named nothing: the dispatch would have read
    // `vars.TAU_DISTILL_SCOPE`, which is the same "one experiment's setting applied to every queued
    // dispatch" defect the fourth switch closed one field over.
    expect(readPrereg(withHeader('distillScope: all'), 'R87-distill-scope.md').prereg?.distillScope)
      .toBe('all');
    expect(readPrereg(withHeader('distillScope: edited'), 'R87-distill-scope.md').prereg?.distillScope)
      .toBe('edited');
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R87-distill-scope.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.distillScope).toBeUndefined();
  });

  it('refuses a population the lane cannot distil, and the capitalised form of one', () => {
    expect(readPrereg(withHeader('distillScope: everything'), 'R87-distill-scope.md').problems).toEqual([
      { where: "header 'distillScope'", problem: "'everything' is not one of edited, all" },
    ]);
    expect(readPrereg(withHeader('distillScope: All'), 'R87-distill-scope.md').problems).toHaveLength(1);
  });
});


describe('the trace ceiling', () => {
  const HEADER = [
    '---',
    'id: R87-trace-claims',
    'step: R87',
    'opened: 2026-11-12',
    'arms: memory,reference',
    'sample: 228',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the ceiling the registration fixes', () => {
    // R58 asks for "up to three claims per trace" in prose and its header named nothing, so the
    // dispatch read `vars.TAU_TRACE_CLAIMS`, which holds 6 from the round that asked whether the cap
    // binds. A run at six is a different treatment from the one R58 describes.
    expect(readPrereg(withHeader('traceClaims: 3'), 'R87-trace-claims.md').prereg?.traceClaims).toBe(3);
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R87-trace-claims.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.traceClaims).toBeUndefined();
  });

  it('refuses a ceiling the lane cannot enforce, and a fraction of one', () => {
    expect(readPrereg(withHeader('traceClaims: 0'), 'R87-trace-claims.md').problems).toEqual([
      { where: "header 'traceClaims'", problem: "'0' is not an integer in 1..8" },
    ]);
    expect(readPrereg(withHeader('traceClaims: 9'), 'R87-trace-claims.md').problems).toHaveLength(1);
    expect(readPrereg(withHeader('traceClaims: 3.5'), 'R87-trace-claims.md').problems).toHaveLength(1);
  });
});

describe('packMode, the seventh switch out of a repository variable', () => {
  const HEADER = [
    '---',
    'id: R88-pack-mode',
    'step: R88',
    'opened: 2026-11-12',
    'arms: memory,reference',
    'sample: 228',
    'gates: V1,V2',
    '---',
    '',
  ].join('\n');
  const BODY =
    '\n## Prediction\n\n- **one claim that is long enough to count as a claim here.**\n' +
    '\n## Refutation\n\n- **Void** — the first branch, long enough to count as a claim.\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the place the registration serves a pack from', () => {
    // R55.1's second arm injects every admitted entry into the system prompt with no retrieval and no
    // budget; the first serves 1.42 items through a 1,200-character pack. A run that cannot say which
    // it ran is a control filed under a treatment's name.
    expect(readPrereg(withHeader('packMode: prefix'), 'R88-pack-mode.md').prereg?.packMode).toBe('prefix');
    expect(readPrereg(withHeader('packMode: retrieved'), 'R88-pack-mode.md').prereg?.packMode).toBe('retrieved');
  });

  it('leaves it absent when the header does not name one', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R88-pack-mode.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.packMode).toBeUndefined();
  });

  it('refuses a place the lane cannot serve from, in either spelling', () => {
    expect(readPrereg(withHeader('packMode: all'), 'R88-pack-mode.md').problems).toEqual([
      { where: "header 'packMode'", problem: "'all' is not one of retrieved, prefix" },
    ]);
    // Case matters: a header is compared against a variable box, and `Prefix` is not `prefix`.
    expect(readPrereg(withHeader('packMode: Prefix'), 'R88-pack-mode.md').problems).toHaveLength(1);
  });
});




describe('laneRoleProblem', () => {
  it('says nothing when the registration does not declare a role', () => {
    // Absent is every registration written before S2c, and forty of them are BIRD cells whose role the
    // split already fixes. Refusing them would be a migration, not a check.
    expect(laneRoleProblem(undefined, { split: 'dev' })).toBeUndefined();
    expect(laneRoleProblem(undefined, { split: 'test', tau2Domain: 'retail' })).toBeUndefined();
  });

  it('accepts the three roles on the lanes they belong to', () => {
    expect(laneRoleProblem('hostile', { split: 'dev' })).toBeUndefined();
    expect(laneRoleProblem('hostile', { split: 'minidev' })).toBeUndefined();
    expect(laneRoleProblem('product', { split: 'test', tau2Domain: 'retail' })).toBeUndefined();
    expect(laneRoleProblem('transfer', { split: 'test', tau2Domain: 'airline' })).toBeUndefined();
  });

  it('refuses a product or transfer claim on the hostile lane', () => {
    // This is the check that would have stopped the iteration before last. S2c forbade quoting BIRD's
    // absolute EX beside a leaderboard row on 2026-11-08; three days later a report still did it, and
    // nothing in the machinery could have objected, because the role only existed in prose.
    expect(laneRoleProblem('product', { split: 'dev' })).toBe(
      "this registration claims 'product' evidence on the 'dev' split, and that split is the hostile " +
        'case: its questions never recur, so a lift measured there is not a lift from experience',
    );
    expect(laneRoleProblem('transfer', { split: 'minidev' })).toContain("claims 'transfer' evidence");
    expect(laneRoleProblem('product', { split: 'train' })).toContain('never recur');
  });

  it('allows a tau2 registration that also names a split, because the domain decides the lane', () => {
    // The lane's τ² driver takes `train` and `test` as its split names, so `split` alone cannot say
    // which scenario ran. A declared domain does, and the check does not overreach into policing the
    // τ² roles: same-domain is product, cross-domain is transfer, and both are legible from the domain.
    expect(laneRoleProblem('product', { split: 'train', tau2Domain: 'retail' })).toBeUndefined();
    expect(laneRoleProblem('hostile', { split: 'test', tau2Domain: 'airline' })).toBeUndefined();
  });

  it('refuses the word for the role rather than a synonym for it', () => {
    expect(laneRoleProblem('sota', { split: 'dev' })).toBe(
      "header 'lane': 'sota' is not product, transfer or hostile",
    );
    expect(laneRoleProblem('Product', { split: 'dev' })).toContain('is not product, transfer or hostile');
  });
});

describe('trainTasks and testTasks, the two caps one number used to bind at once', () => {
  const HEADER = [
    '---',
    'id: R87-caps',
    'step: R87',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 57',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- the learning half produces at least eight distillation calls at this cap\n\n' +
    '## Refutation\n\n- fewer than eight calls means the population arithmetic is wrong\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads both caps when the registration pins them', () => {
    // R86's dispatch used one number for two populations: `l4_tasks = 10` sliced the evaluated list,
    // the plan split that slice in half, and a census of distillation faults was asked once instead
    // of fifteen times. A cap is a property of the experiment, and there are two of them.
    const reading = readPrereg(withHeader('trainTasks: 57\ntestTasks: 1'), 'R87-caps.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.trainTasks).toBe(57);
    expect(reading.prereg?.testTasks).toBe(1);
  });

  it('accepts zero, which means every task rather than none', () => {
    const reading = readPrereg(withHeader('trainTasks: 0\ntestTasks: 0'), 'R87-caps.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.trainTasks).toBe(0);
  });

  it('leaves both absent when the header names neither, so a variable still decides', () => {
    const reading = readPrereg(withHeader('split: dev'), 'R87-caps.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.trainTasks).toBeUndefined();
    expect(reading.prereg?.testTasks).toBeUndefined();
  });

  it('refuses a cap that is not a count of tasks', () => {
    // A negative cap would slice from the end of the list, which is not a smaller run but a different
    // one — and it would read as "the corpus was thinner" in every artefact downstream.
    expect(readPrereg(withHeader('trainTasks: -1\ntestTasks: 1'), 'R87-caps.md').problems).toEqual([
      { where: "header 'trainTasks'", problem: "'-1' is not a count of tasks" },
    ]);
    expect(readPrereg(withHeader('trainTasks: 2.5\ntestTasks: 1'), 'R87-caps.md').problems).toHaveLength(1);
  });
});

describe('rawCeiling, the one number R85 was mismeasured by', () => {
  const HEADER = [
    '---',
    'id: R88-ceiling',
    'step: R88',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 228',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- the record survives the write whole at this ceiling\n\n' +
    '## Refutation\n\n- a clipped record at this ceiling means the corpus is not what it was measured as\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the ceiling a registration states', () => {
    // R85 ran at 700 and clipped twelve of twelve, because 700 was borrowed from the trace unit's 640
    // and a record is a question plus an answer, not a summary of one call. The census over the
    // retail corpus puts the record maximum at 1532 characters, so a registration that wants an
    // uncut record has to be able to say so.
    const reading = readPrereg(withHeader('distillUnit: raw\nrawCeiling: 2000'), 'R88-ceiling.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.rawCeiling).toBe(2000);
  });

  it('leaves it absent when the header names none, so the published arms keep their reading', () => {
    const reading = readPrereg(withHeader('distillUnit: raw'), 'R88-ceiling.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.rawCeiling).toBeUndefined();
  });

  it('refuses a ceiling no record could fit, because the marker would be the whole record', () => {
    // Below the truncation marker's own length the slice produces a record whose entire text is " …":
    // stored, counted, and serving nothing. The interpreter refuses it too, and both refusals exist
    // because a header is read on every push and a dispatch is paid for once.
    expect(readPrereg(withHeader('distillUnit: raw\nrawCeiling: 1'), 'R88-ceiling.md').problems).toEqual([
      { where: "header 'rawCeiling'", problem: "'1' is not a ceiling a record can fit in" },
    ]);
    expect(readPrereg(withHeader('distillUnit: raw\nrawCeiling: 2000.5'), 'R88-ceiling.md').problems).toHaveLength(1);
  });
});

describe('taskSplit, whose halves an arm runs on', () => {
  const HEADER = [
    '---',
    'id: R92-official-split',
    'step: R92',
    'opened: 2026-11-13',
    'arms: memory',
    'sample: 160',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- the held-out half is the one the benchmark names\n\n' +
    '## Refutation\n\n- a half this lane cut itself proves the split was not read\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the one split a document states', () => {
    const reading = readPrereg(withHeader('taskSplit: official'), 'R92-official-split.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.taskSplit).toBe('official');
  });

  it('refuses a split stated as a share, because a number here would move the boundary', () => {
    expect(problemsOf(withHeader('taskSplit: 0.6491'), 'R92-official-split.md')).toEqual([
      "header 'taskSplit': '0.6491' is not one of official",
    ]);
    for (const bad of ['half', 'Official', 'train']) {
      expect(problemsOf(withHeader(`taskSplit: ${bad}`), 'R92-official-split.md')).toHaveLength(1);
    }
  });

  it('leaves the field absent when the arm cuts the pool itself', () => {
    const reading = readPrereg(withHeader('rawCeiling: 2000'), 'R92-official-split.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.taskSplit).toBeUndefined();
  });
});

describe('storePin, the learn half as a file', () => {
  const HEADER = [
    '---',
    'id: R91-store-frozen',
    'step: R91',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 228',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- the store is the same store\n\n' +
    '## Refutation\n\n- a store that differs proves the list does not determine it\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads a pin under eval/pins', () => {
    const reading = readPrereg(withHeader('storePin: eval/pins/r90-retail.json'), 'R91-store-frozen.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.storePin).toBe('eval/pins/r90-retail.json');
  });

  it('refuses a path outside the pins directory, so a header cannot reach the filesystem', () => {
    // The restriction is the check: a pin is a treatment and it has to live where a reviewer reads it,
    // and a header that could name any path could name a file this repository never reviewed.
    expect(problemsOf(withHeader('storePin: /etc/passwd'), 'R91-store-frozen.md')).toEqual([
      "header 'storePin': '/etc/passwd' is not a pin under eval/pins/",
    ]);
    for (const bad of ['pins/r90.json', 'eval/pins/../prereg/R90.md', 'eval/pins/x.txt']) {
      expect(problemsOf(withHeader(`storePin: ${bad}`), 'R91-store-frozen.md')).toHaveLength(1);
    }
  });

  it('leaves the field absent when the registration pins nothing, because a rebuild is the default', () => {
    const reading = readPrereg(withHeader('rawCeiling: 2000'), 'R91-store-frozen.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.storePin).toBeUndefined();
  });
});

describe('packBudget, the other half of the ceiling', () => {
  const HEADER = [
    '---',
    'id: R89-pack-carries',
    'step: R89',
    'opened: 2026-11-12',
    'arms: memory',
    'sample: 228',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- a record the pack can carry is served as it was written\n\n' +
    '## Refutation\n\n- a record dropped for size proves the ceiling and the budget are one number\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads the budget a registration states', () => {
    const reading = readPrereg(withHeader('packBudget: 2400'), 'R89-pack-carries.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.packBudget).toBe(2400);
  });

  it('refuses a budget no pack can carry, rather than reading zero as a default', () => {
    // A zero budget is not "the module default": it is a pack that renders nothing, and the default is
    // spelled by leaving the header out. The two must not be the same word.
    expect(problemsOf(withHeader('packBudget: 0'), 'R89-pack-carries.md')).toEqual([
      "header 'packBudget': '0' is not a budget a pack can carry in characters",
    ]);
    expect(problemsOf(withHeader('packBudget: 12.5'), 'R89-pack-carries.md')).toHaveLength(1);
  });

  it('accepts a ceiling the pack can carry, measured rather than assumed', () => {
    // 2,000 + 390 = 2,390 characters of pack, so 2,400 is the smallest round budget that carries the
    // longest retail record whole: the capacity is 810 at 1,200 and 2,010 at 2,400.
    const reading = readPrereg(
      withHeader('distillUnit: raw\nrawCeiling: 2000\npackBudget: 2400'),
      'R89-pack-carries.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.packBudget).toBe(2400);
  });

  it('reads a ceiling above the declared budget rather than refusing it here', () => {
    // The reader parses; it does not measure. `prereg.ts` is read by jobs that run *before* the build,
    // so it cannot reach the renderer that decides what a pack carries — the import-closure test enforces
    // that boundary, and the coupling check therefore lives in `prereg-pack.ts`, where the dispatch
    // reader and the gate over every registration both call it.
    const reading = readPrereg(
      withHeader('distillUnit: raw\nrawCeiling: 2000\npackBudget: 1200'),
      'R89-pack-carries.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.rawCeiling).toBe(2000);
    expect(reading.prereg?.packBudget).toBe(1200);
  });

  it('leaves a ceiling declared without a budget alone, so finished runs keep their reading', () => {
    // R85, R86, R87 and R88 all ran at 1,200 and none of them stated it. A validator that refused them
    // retroactively would be rewriting the record of what was dispatched; the dispatch log carries the
    // capacity instead (`prereg-caps` prints it), so the mismatch is visible where it is decided.
    const reading = readPrereg(
      withHeader('distillUnit: raw\nrawCeiling: 2000'),
      'R89-pack-carries.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.packBudget).toBeUndefined();
  });
});

describe('queryPin, the question as a file', () => {
  const HEADER = [
    '---',
    'id: R93-one-question',
    'step: R93',
    'opened: 2026-11-14',
    'arms: memory',
    'sample: 228',
    'gates: V1',
    '---',
    '',
  ].join('\n');
  const BODY =
    '## Prediction\n\n- two floors read the same pack\n\n' +
    '## Refutation\n\n- a pack ranked on two questions proves neither floor was priced\n';

  function withHeader(extra: string): string {
    return `${HEADER.replace(/^---\n/, `---\n${extra}\n`)}${BODY}`;
  }

  it('reads a pin under eval/pins', () => {
    // R92: the second pin. A pack is a function of (store, query, options) and this is the question, so a
    // registration whose subject is the pack has to be able to say it held one.
    const reading = readPrereg(
      withHeader('queryPin: eval/pins/r90-retail-queries.json'),
      'R93-one-question.md',
    );
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.queryPin).toBe('eval/pins/r90-retail-queries.json');
  });

  it('refuses a path outside the pins directory, for the same reason the store pin does', () => {
    expect(problemsOf(withHeader('queryPin: /etc/passwd'), 'R93-one-question.md')).toEqual([
      "header 'queryPin': '/etc/passwd' is not a pin under eval/pins/",
    ]);
    for (const bad of ['pins/queries.json', 'eval/pins/../prereg/R92.md', 'eval/pins/x.txt']) {
      expect(problemsOf(withHeader(`queryPin: ${bad}`), 'R93-one-question.md')).toHaveLength(1);
    }
  });

  it('leaves the field absent when the registration pins no question, which is the default', () => {
    // Absent is not "no queries ran": it means the queries were the ones the simulator drew, which is what
    // an arm quoting an absolute benchmark number must keep doing.
    const reading = readPrereg(withHeader('rawCeiling: 2000'), 'R93-one-question.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.queryPin).toBeUndefined();
  });

  it('reads the release the number is about, and refuses one that is not a tag', () => {
    // R92's header line. The tag is the decision and `vars.TAU_VERSION` is the machine; the driver refuses a
    // run where they disagree, so this field is what makes that comparison possible at all.
    const reading = readPrereg(withHeader('release: v1.0.1'), 'R93-one-question.md');
    expect(reading.problems).toEqual([]);
    expect(reading.prereg?.release).toBe('v1.0.1');
    // `latest`, a branch and a minor version are all claims nothing can hold a run to.
    for (const bad of ['latest', 'main', 'v1.0']) {
      expect(problemsOf(withHeader(`release: ${bad}`), 'R93-one-question.md')).toEqual([
        `header 'release': '${bad}' is not a release tag (v<major>.<minor>.<patch>)`,
      ]);
    }
    expect(
      readPrereg(withHeader('rawCeiling: 2000'), 'R93-one-question.md').prereg?.release,
    ).toBeUndefined();
  });
});
