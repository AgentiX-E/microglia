import { describe, expect, it } from 'vitest';
import { preregGate, preregGateAgreement, readPrereg, type Prereg } from '../prereg.js';

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
