import { describe, expect, it } from 'vitest';
import {
  facadePairSwitch,
  plantedArmMatrix,
  preregGate,
  preregGateAgreement,
  readPrereg,
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
    for (const bad of ['0', '2.5', '-1', 'hot']) {
      const reported = problemsOf(withTemperature(`temperature: ${bad}`));
      expect(reported.some((entry) => entry.includes("header 'temperature'"))).toBe(true);
    }
  });

  it('refuses a temperature on a registration that draws nothing', () => {
    // A temperature with no `sample-<n>` arm describes no draw: it would be recorded in the
    // artefact and read afterwards as a property of a run that never sampled.
    const reported = problemsOf(withTemperature('temperature: 1.0', 'none,gated'));
    expect(reported.some((entry) => entry.includes('describes no draw'))).toBe(true);
  });
});
