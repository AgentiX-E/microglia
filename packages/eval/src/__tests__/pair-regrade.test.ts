import { describe, expect, it } from 'vitest';
import { regradePair, regradePairText } from '../pair-regrade.js';

/**
 * The re-grade is the only code in this repository that rewrites committed evidence, so its tests are
 * about what it refuses at least as much as about what it changes.
 *
 * The fixture is a pair artefact carrying the shape the real files carry: a verdict to read the state
 * from, a comparison to read the numbers from, a protocol block holding the resolution, and a gate table
 * in which one row is about to move.
 */

const V5 = {
  id: 'V5-resolution',
  criterion: 'the run claims no effect finer than its sample can resolve',
  actual: 'minimum detectable 23.23pp against a 6.00pp target',
  pass: false,
  blocking: true,
};

/** R152c's reading: −7.50pp at an 23.23pp resolution, `HARM` because the cost bar fired. */
function artefact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'poc-l4-pair',
    verdict: {
      state: 'HARM',
      claim: 'the memory costs accuracy: -7.50pp',
      servedPacks: 34,
      excludedAbovePp: 23.23,
    },
    comparison: { paired: 40, onlyFirst: 0, onlySecond: 0, deltaPp: -7.5, p: 0.5488, lost: 7, gained: 4 },
    protocol: { detectablePp: 23.23 },
    gates: [
      V5,
      {
        id: 'l4-paired',
        criterion: 'the memory does not cost accuracy: neither R45 revert branch fires',
        actual: '-7.50pp (p=0.5488, n=40, 34 served pack(s)): HARM',
        pass: false,
        blocking: true,
      },
      {
        id: 'l4-effect-resolved',
        criterion: 'the pair resolves the effect it reports',
        actual: 'the memory costs accuracy: -7.50pp',
        pass: true,
        blocking: false,
      },
      {
        id: 'l4-same-split',
        criterion: 'both arms scored exactly the same tasks',
        actual: '0 only in first, 0 only in second',
        pass: true,
        blocking: true,
      },
    ],
    ...overrides,
  };
}

/** The writer's serialisation, which `regradePairText` refuses to depart from. */
function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe('re-grading a pair artefact', () => {  it('flips the row whose predicate was looser than its criterion, and only that row', () => {
    const { gates, changed } = regradePair(artefact());
    expect(changed.map((row) => row.id)).toEqual(['l4-effect-resolved']);
    expect(changed[0]?.from).toBe(true);
    expect(changed[0]?.to).toBe(false);
    // The verdict, the numbers and the protocol row are not this tool's to move.
    const byId = new Map(gates.map((gate) => [gate.id, gate]));
    expect(byId.get('V5-resolution')).toEqual(V5);
    expect(byId.get('l4-paired')?.pass).toBe(false);
    expect(byId.get('l4-same-split')?.pass).toBe(true);
  });

  it('replaces the criterion with the predicate it now states', () => {
    const resolved = regradePair(artefact()).gates.find((gate) => gate.id === 'l4-effect-resolved');
    expect(resolved?.criterion).toContain('may be quoted as a finding');
    expect(resolved?.actual).toContain('which is a direction this pair cannot claim');
  });

  it('keeps the file`s row order, so a diff of two rows stays two rows', () => {
    const ids = regradePair(artefact()).gates.map((gate) => gate.id);
    expect(ids).toEqual(['V5-resolution', 'l4-paired', 'l4-effect-resolved', 'l4-same-split']);
  });

  it('reports rows the file predates instead of appending them', () => {
    // `poc-l4-pair-official.json` was written before `l4-rotation-reconciles` existed. Appending it would
    // date the artefact to a driver run it never came from.
    const { ungraded, gates } = regradePair(artefact());
    // R156: only a row this tool could actually recompute is listed as ungraded. The two rows whose
    // evidence lives in the arm artefacts are preserved instead, and named with their reason.
    expect(ungraded).toEqual([]);
    expect(gates.map((gate) => gate.id)).not.toContain('l4-rotation-reconciles');
    // Nothing is preserved *here* because this fixture does not carry the two rows in question — the two
    // tests below add them, and each asserts that its row survives the re-grade untouched.
    expect(regradePair(artefact()).preserved).toEqual([]);
  });

  it('keeps a projection failure the file recorded, because the evidence for it is not in the file', () => {
    // R152's artefact carries `l4-projection-complete: false` from the run that wrote it. The first
    // version of this tool recomputed that row from the pair artefact, which records only the fields that
    // *did* arrive — so the recomputation always passes, and the re-grade turned a recorded defect green.
    const failed = artefact({
      gates: [
        V5,
        {
          id: 'l4-projection-complete',
          criterion: 'every field either arm emitted reached its artefact',
          actual: 'memory: sidecarCensus, recallQueries',
          pass: false,
          blocking: true,
        },
      ],
    });
    const { gates, changed, preserved } = regradePair(failed);
    const row = gates.find((gate) => gate.id === 'l4-projection-complete');
    expect(row?.pass).toBe(false);
    expect(row?.actual).toBe('memory: sidecarCensus, recallQueries');
    expect(changed.map((entry) => entry.id)).not.toContain('l4-projection-complete');
    expect(preserved[0]?.reason).toContain('emitted fields');
  });

  it('keeps a rotation row the pair cannot re-derive', () => {
    // The policy and the pack ledger live in the memory arm. A recomputation here would report "no policy
    // declared" — a sentence about this tool rather than about the run.
    const withRotation = artefact({
      gates: [
        {
          id: 'l4-rotation-reconciles',
          criterion: 'the declared reading is the one the ledger accounts for',
          actual: 'requests, renders, maxRenders agree; mode, cap, servable cannot be reached',
          pass: true,
          blocking: true,
        },
      ],
    });
    const { gates, preserved } = regradePair(withRotation);
    expect(gates[0]?.actual).toContain('maxRenders agree');
    expect(preserved.map((row) => row.id)).toEqual(['l4-rotation-reconciles']);
  });

  it('keeps a row graded under a band the artefact only remembers in its sentence', () => {
    // `TAU_BAND` arrives through the environment. Recomputing such a row without it asks a resolution
    // question the pair never posed — AUDIT 34.128 — and the sentence is the only trace of the band.
    const banded = artefact({
      gates: [
        {
          id: 'l4-effect-resolved',
          criterion: 'the pair landed inside the interval it registered',
          actual: '−5.00pp against the registered band [−7.50, 2.50]pp',
          pass: true,
          blocking: false,
        },
      ],
    });
    const { gates, changed, preserved } = regradePair(banded);
    expect(changed).toEqual([]);
    expect(gates[0]?.actual).toContain('registered band');
    expect(preserved[0]?.reason).toContain('dispatch environment');
  });

  it('leaves a file that already reads correctly alone', () => {
    // A benefit that clears its own resolution was already certified, so a second pass over a regraded
    // file must report nothing to do — otherwise the tool would be a function of its own history.
    const { text } = regradePairText(canonical(artefact()));
    expect(regradePairText(text).regrade.changed).toEqual([]);
  });
});

describe('the text transform', () => {
  it('changes exactly the rows it re-graded', () => {
    const before = canonical(artefact());
    const after = regradePairText(before).text;
    expect(after.length).not.toBe(before.length);
    // Same bytes up to the gate table and after it: the only lines that differ are inside one row.
    const head = before.slice(0, before.indexOf('"gates"'));
    expect(after.startsWith(head)).toBe(true);
    expect(after.endsWith('}\n')).toBe(true);
    expect(JSON.parse(after).verdict).toEqual(JSON.parse(before).verdict);
  });

  it('refuses a file it would reformat, because a reformat hides a rewrite', () => {
    expect(() => regradePairText(JSON.stringify(artefact(), null, 4))).toThrow(/canonical serialisation/);
    expect(() => regradePairText(`${canonical(artefact())}\n`)).toThrow(/canonical serialisation/);
  });

  it('refuses an artefact missing an input rather than defaulting it to the answer it likes', () => {
    // A defaulted resolution of `undefined` would make every regraded row fail, which looks like a finding.
    const missing = artefact();
    (missing['protocol'] as Record<string, unknown>)['detectablePp'] = undefined;
    expect(() => regradePair(missing)).toThrow(/protocol\.detectablePp must be a finite number/);
  });

  it('refuses a verdict state it cannot grade', () => {
    const unknown = artefact();
    (unknown['verdict'] as Record<string, unknown>)['state'] = 'MAYBE';
    expect(() => regradePair(unknown)).toThrow(/verdict\.state must be one of/);
  });

  it('refuses a gate row that is not a gate', () => {
    const broken = artefact({ gates: [V5, { id: 'l4-paired', criterion: 'x', actual: 'y', pass: 'yes' }] });
    expect(() => regradePair(broken)).toThrow(/gates\[1\]\.pass must be a boolean/);
  });

  it('names the field it cannot read instead of grading around it', () => {
    // Every accessor refuses rather than defaults. A `?? 0` anywhere in this module would turn a file
    // this tool cannot read into a file it silently grades with numbers it invented.
    const noId = artefact({ gates: [V5, { criterion: 'x', actual: 'y', pass: true, blocking: false }] });
    expect(() => regradePair(noId)).toThrow(/gates\[1\]\.id must be a string/);
    for (const key of ['criterion', 'actual']) {
      const gates = [V5, { id: 'l4-paired', criterion: 'x', actual: 'y', pass: true, blocking: false }];
      (gates[1] as Record<string, unknown>)[key] = 7;
      expect(() => regradePair(artefact({ gates }))).toThrow(new RegExp(`gates\\[1\\]\\.${key} must be a string`));
    }
    const noBlocking = artefact({
      gates: [V5, { id: 'l4-paired', criterion: 'x', actual: 'y', pass: true }],
    });
    expect(() => regradePair(noBlocking)).toThrow(/gates\[1\]\.blocking must be a boolean/);
    expect(() => regradePair(artefact({ gates: {} }))).toThrow(/artefact\.gates must be an array/);
  });

  it('refuses a comparison that is not a number, and one that is not finite', () => {
    const text = artefact();
    (text['comparison'] as Record<string, unknown>)['paired'] = '40';
    expect(() => regradePair(text)).toThrow(/comparison\.paired must be a finite number/);
    const infinite = artefact();
    (infinite['comparison'] as Record<string, unknown>)['deltaPp'] = Number.POSITIVE_INFINITY;
    expect(() => regradePair(infinite)).toThrow(/comparison\.deltaPp must be a finite number/);
  });

  it('refuses a claim that is neither a sentence nor its absence', () => {
    const text = artefact();
    (text['verdict'] as Record<string, unknown>)['claim'] = 12;
    expect(() => regradePair(text)).toThrow(/verdict\.claim must be a string or null/);
  });

  it('refuses anything that is not an artefact at all', () => {
    expect(() => regradePair(null)).toThrow(/artefact must be an object/);
    expect(() => regradePair('poc-l4-pair')).toThrow(/artefact must be an object/);
    expect(() => regradePair([])).toThrow(/artefact must be an object/);
    expect(() => regradePair(artefact({ verdict: [] }))).toThrow(/verdict must be an object/);
    expect(() => regradePairText('null\n')).toThrow(/artefact must be an object/);
  });
});

describe('a row whose rule no longer computes it', () => {
  it('keeps a treatment row the corrected rule omits for a distractor arm', () => {
    // `pairGates` omits `l4-paired` on a planted arm, because a HARM verdict there is the arm agreeing with
    // its registration. An artefact written before that rule still carries the row, and the re-grade has
    // nothing to replace it with — so it stays, rather than disappearing from a table a reader compares.
    const planted = artefact({
      planted_arm: 'near',
      gates: [
        {
          id: 'l4-paired',
          criterion: 'the memory does not cost accuracy: neither R45 revert branch fires',
          actual: '-7.02pp (p=0.40, n=57, 57 served pack(s)): HARM, planted near',
          pass: false,
          blocking: true,
        },
      ],
    });
    const { gates, changed } = regradePair(planted);
    expect(gates.map((gate) => gate.id)).toEqual(['l4-paired']);
    expect(gates[0]?.pass).toBe(false);
    expect(changed).toEqual([]);
  });
});

describe('a field this tool cannot read', () => {
  it('refuses a planted arm that is not a name', () => {
    // `planted_arm` decides whether the treatment's two rows apply at all, so a value that is not a string
    // is a file whose gates cannot be graded — and defaulting it would grade a distractor as a treatment.
    expect(() => regradePair(artefact({ planted_arm: 3 }))).toThrow(/planted_arm must be a string/);
  });
});
