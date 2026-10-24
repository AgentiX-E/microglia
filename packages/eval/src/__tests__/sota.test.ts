import { describe, expect, it } from 'vitest';
import {
  HOUSE_CONVENTIONS,
  GenerationCache,
  OPTIONAL_ARMS,
  PROMPT_VERSION,
  buildValidityGates,
  canonicalRows,
  conventionOf,
  extractSql,
  judgeScalar,
  matches,
  parseArms,
  promptFor,
  reportedSql,
  type GateInput,
} from '../sota.js';

const NO_CONVENTION = undefined;

describe('conventionOf', () => {
  it('treats the empty name as "no convention"', () => {
    expect(conventionOf('')).toBeUndefined();
    expect(conventionOf('   ')).toBeUndefined();
  });

  it('resolves a known convention, ignoring surrounding whitespace', () => {
    expect(conventionOf('thousands')).toBe('thousands');
    expect(conventionOf(' round10 ')).toBe('round10');
  });

  it('refuses an unknown name instead of silently running the plain lane', () => {
    expect(conventionOf('millions')).toBeUndefined();
    // A name that is a prototype key must not resolve through the prototype chain.
    expect(conventionOf('toString')).toBeUndefined();
  });
});

describe('the two house conventions', () => {
  it('scales thousands, and is defined for every numeric answer', () => {
    const spec = HOUSE_CONVENTIONS.thousands;
    expect(spec.transform(2_500_000)).toBe(2500);
    expect(spec.transform(2_500_400)).toBe(2500.4);
    // The subset is "one row, one numeric column", not "at least a thousand": a
    // convention that reports in thousands is defined for 999 and for 5.
    expect(spec.applies(999)).toBe(true);
    expect(spec.applies(5)).toBe(true);
    expect(spec.applies(-1000)).toBe(true);
    expect(spec.transform(5)).toBe(0.005);
  });

  it('rounds to ten for every numeric answer', () => {
    const spec = HOUSE_CONVENTIONS.round10;
    expect(spec.transform(1234)).toBe(1230);
    expect(spec.transform(4)).toBe(0);
    expect(spec.applies(0)).toBe(true);
  });

  it('rewrites the gold query so the expected value is what the workspace reports', () => {
    expect(HOUSE_CONVENTIONS.thousands.sql('SELECT 1')).toBe('SELECT ROUND((SELECT 1) / 1000.0, 3)');
    expect(HOUSE_CONVENTIONS.round10.sql('SELECT 1')).toBe('SELECT ROUND((SELECT 1) / 10.0) * 10');
  });
});

describe('judgeScalar', () => {
  it('accepts a value that matches at the stated precision', () => {
    expect(judgeScalar(2500, 2500)).toBe(true);
    expect(judgeScalar(2500.0000001, 2500)).toBe(true);
  });

  it('rejects a different value, and any answer the convention cannot define', () => {
    expect(judgeScalar(2501, 2500)).toBe(false);
    expect(judgeScalar(undefined, 2500)).toBe(false);
  });

  it('rejects when the question has no expected value', () => {
    expect(judgeScalar(2500, undefined)).toBe(false);
  });
});

describe('reportedSql', () => {
  it('leaves the statement alone when the workspace has no convention', () => {
    expect(reportedSql('SELECT 1;', NO_CONVENTION)).toBe('SELECT 1;');
  });

  it('strips the trailing terminator before wrapping, so the wrapper stays one statement', () => {
    expect(reportedSql('SELECT 1;\n', HOUSE_CONVENTIONS.round10)).toBe('SELECT ROUND((SELECT 1) / 10.0) * 10');
    expect(reportedSql('  SELECT 1  ', HOUSE_CONVENTIONS.round10)).toBe('SELECT ROUND((SELECT 1) / 10.0) * 10');
  });
});

describe('extractSql', () => {
  it('prefers a fenced block and drops the terminator', () => {
    expect(extractSql('```sql\nSELECT 1;\n```')).toBe('SELECT 1');
    expect(extractSql('```\nSELECT 2\n```')).toBe('SELECT 2');
  });

  it('accepts an unfenced statement, taking the first line that starts one', () => {
    expect(extractSql('SELECT 3')).toBe('SELECT 3');
    expect(extractSql('Here is the query:\nSELECT 4')).toBe('SELECT 4');
    expect(extractSql('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('WITH x AS (SELECT 1) SELECT * FROM x');
  });

  it('strips line and block comments before looking for the statement', () => {
    expect(extractSql('-- note\n-- again\nSELECT 5')).toBe('SELECT 5');
    expect(extractSql('/* note */\nSELECT 6')).toBe('SELECT 6');
    expect(extractSql('```sql\n-- note\nSELECT 7\n```')).toBe('SELECT 7');
  });

  it('returns undefined when there is nothing to run', () => {
    expect(extractSql('')).toBeUndefined();
    expect(extractSql('   \n  ')).toBeUndefined();
    expect(extractSql('```sql\n\n```')).toBeUndefined();
    expect(extractSql('I cannot answer that.')).toBeUndefined();
    expect(extractSql('-- only a comment\n')).toBeUndefined();
  });

  it('keeps a statement that spans lines, and trims trailing newlines', () => {
    expect(extractSql('```sql\nSELECT a,\n  b\nFROM t;\n```\n')).toBe('SELECT a,\n  b\nFROM t');
  });
});

describe('canonicalRows', () => {
  it('orders columns so a different column order compares equal', () => {
    expect(canonicalRows([{ b: 1, a: 2 }])).toEqual(canonicalRows([{ a: 2, b: 1 }]));
    expect(canonicalRows([{ b: 1, a: 2 }])[0]).toBe('[2,1]');
  });

  it('orders rows so a different row order compares equal', () => {
    expect(canonicalRows([{ a: 2 }, { a: 1 }])).toEqual(['[1]', '[2]']);
  });

  it('rounds floats to six decimals and keeps integers exact', () => {
    expect(canonicalRows([{ a: 1.23456789 }])[0]).toBe('[1.234568]');
    expect(canonicalRows([{ a: 7 }])[0]).toBe('[7]');
  });

  it('maps null, undefined and strings without inventing equality', () => {
    expect(canonicalRows([{ a: null }])[0]).toBe('[null]');
    expect(canonicalRows([{ a: undefined }])[0]).toBe('[null]');
    expect(canonicalRows([{ a: 'x' }])[0]).toBe('["x"]');
    // A string that looks like a number is not the number.
    expect(canonicalRows([{ a: '7' }])[0]).not.toBe(canonicalRows([{ a: 7 }])[0]);
  });
});

describe('matches', () => {
  it('requires the same multiset', () => {
    expect(matches(['[1]', '[2]'], ['[1]', '[2]'])).toBe(true);
    expect(matches(['[1]', '[2]'], ['[1]'])).toBe(false);
    expect(matches([], [])).toBe(true);
  });

  it('postpones ordering to the caller: two unsorted lists are not equal', () => {
    expect(matches(['[2]', '[1]'], ['[1]', '[2]'])).toBe(false);
  });
});

describe('parseArms', () => {
  it('defaults to every optional arm plus the two required ones', () => {
    const arms = parseArms(undefined);
    expect([...arms].sort()).toEqual([
      'duplicate',
      'full',
      'full-narrow',
      'gated',
      'none',
      'oracle',
      'stated',
      'wrong-scope',
    ]);
  });

  it('keeps none and full even when the caller lists nothing', () => {
    expect([...parseArms('')].sort()).toEqual(['full', 'none']);
  });

  it('accepts a subset, with whitespace and empty entries', () => {
    expect([...parseArms(' gated , oracle ,')].sort()).toEqual(['full', 'gated', 'none', 'oracle']);
  });

  it('refuses an arm it does not implement, and says which ones exist', () => {
    expect(() => parseArms('gated,oracle2')).toThrow(RangeError);
    expect(() => parseArms('gated,oracle2')).toThrow(/Unknown arm 'oracle2'/);
  });

  it('covers every documented arm', () => {
    expect([...OPTIONAL_ARMS]).toEqual([
      'full-narrow',
      'gated',
      'duplicate',
      'wrong-scope',
      'stated',
      'oracle',
    ]);
  });

  it('accepts the scope-widening arm, which is a pack built from the same corrections', () => {
    expect([...parseArms('full-narrow')].sort()).toEqual(['full', 'full-narrow', 'none']);
  });
});

describe('promptFor', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE s (id INTEGER)',
    pack: '',
    stated: false,
    convention: NO_CONVENTION,
  };

  it('always carries the schema and ends with the question', () => {
    const prompt = promptFor(base);
    expect(prompt).toContain('CREATE TABLE s (id INTEGER)');
    expect(prompt.trimEnd().endsWith('Question: How many students?')).toBe(true);
  });

  it('omits the evidence block when there is no evidence', () => {
    expect(promptFor(base)).not.toContain('Evidence');
    expect(promptFor({ ...base, evidence: 'students are enrolled' })).toContain(
      'Evidence (may be wrong; it is external knowledge):\nstudents are enrolled',
    );
  });

  it('injects the pack when there is one, and nothing when there is not', () => {
    expect(promptFor(base)).not.toContain('learned from earlier corrections');
    expect(promptFor({ ...base, pack: '- report in thousands' })).toContain(
      'Workspace conventions learned from earlier corrections:\n- report in thousands',
    );
  });

  it('states the convention only on the stated arm, and only when one exists', () => {
    expect(promptFor({ ...base, stated: true, convention: HOUSE_CONVENTIONS.round10 })).toContain(
      'Workspace convention:\n- This workspace reports every numeric answer rounded to the nearest ten.',
    );
    expect(promptFor({ ...base, stated: true, convention: NO_CONVENTION })).not.toContain(
      'Workspace convention',
    );
    expect(promptFor({ ...base, stated: false, convention: HOUSE_CONVENTIONS.round10 })).not.toContain(
      'Workspace convention',
    );
  });

  it('keeps the prompt version next to the prompt it describes', () => {
    expect(PROMPT_VERSION).toBe('sql-prompt/2');
  });
});

describe('GenerationCache', () => {
  it('remembers what it stored', () => {
    const cache = new GenerationCache();
    expect(cache.has('a#1')).toBe(false);
    expect(cache.get('a#1')).toBeUndefined();
    cache.set('a#1', 'SELECT 1');
    expect(cache.has('a#1')).toBe(true);
    expect(cache.get('a#1')).toBe('SELECT 1');
  });

  it('distinguishes a stored empty reply from a missing entry', () => {
    const cache = new GenerationCache();
    cache.set('a#1', '');
    expect(cache.has('a#1')).toBe(true);
    expect(cache.get('a#1')).toBe('');
  });

  it('counts hits and misses, because a hit is a call not made', () => {
    const cache = new GenerationCache();
    cache.count(false);
    cache.count(true);
    cache.count(true);
    cache.set('a#1', 'SELECT 1');
    expect(cache.stats).toEqual({ hits: 2, misses: 1, size: 1 });
  });
});

describe('buildValidityGates', () => {
  const sound: GateInput = {
    meanPackIds: 2.4,
    partition: { evaluated: 350, total: 350, duplicated: 0, leaked: 0 },
    parseRate: 1,
    goldExecRate: 1,
    detectablePp: 5.5,
    packControls: [{ arm: 'gated', meanPackIds: 2.1 }],
    channelBest: { arm: 'oracle', deltaPp: 32 },
    callFailureRate: 0,
    calls: 1750,
    callFailures: 0,
  };

  const gate = (input: GateInput, id: string): { pass: boolean; actual: string; blocking: boolean } => {
    const found = buildValidityGates(input).find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`gate ${id} is missing`);
    return found;
  };

  it('defines the gates in a fixed order, with stable ids', () => {
    expect(buildValidityGates(sound).map((entry) => entry.id)).toEqual([
      'V1-pack-not-empty',
      'V2-fold-partition',
      'V3-parse-rate',
      'V4-gold-executable',
      'V5-resolution',
      'V6-controls-inject',
      'V7-channel',
      'V8-call-reliability',
    ]);
  });

  it('passes every gate on a sound run', () => {
    expect(buildValidityGates(sound).every((entry) => entry.pass)).toBe(true);
  });

  it('V1 fails when the memory arm injected nothing', () => {
    expect(gate({ ...sound, meanPackIds: 0 }, 'V1-pack-not-empty').pass).toBe(false);
    expect(gate(sound, 'V1-pack-not-empty').actual).toBe('2.40 rules/question');
  });

  it('V2 fails on a duplicate, a leak, or a short evaluation', () => {
    expect(gate({ ...sound, partition: { ...sound.partition, duplicated: 1 } }, 'V2-fold-partition').pass).toBe(
      false,
    );
    expect(gate({ ...sound, partition: { ...sound.partition, leaked: 1 } }, 'V2-fold-partition').pass).toBe(false);
    expect(gate({ ...sound, partition: { ...sound.partition, evaluated: 349 } }, 'V2-fold-partition').pass).toBe(
      false,
    );
    expect(gate(sound, 'V2-fold-partition').actual).toBe('350/350 questions, 0 duplicates, 0 leaks');
  });

  it('V3 fails below a 90% parse rate, and passes exactly at the boundary', () => {
    expect(gate({ ...sound, parseRate: 0.899 }, 'V3-parse-rate').pass).toBe(false);
    expect(gate({ ...sound, parseRate: 0.9 }, 'V3-parse-rate').pass).toBe(true);
  });

  it('V4 fails when a gold query does not execute', () => {
    expect(gate({ ...sound, goldExecRate: 0.989 }, 'V4-gold-executable').pass).toBe(false);
    expect(gate({ ...sound, goldExecRate: 0.99 }, 'V4-gold-executable').pass).toBe(true);
  });

  it('V5 is advisory and fails above a 6pp minimum detectable difference', () => {
    const failing = gate({ ...sound, detectablePp: 6.01 }, 'V5-resolution');
    expect(failing.pass).toBe(false);
    expect(failing.blocking).toBe(false);
    expect(failing.actual).toBe('minimum detectable 6.01pp');
    expect(gate({ ...sound, detectablePp: 6 }, 'V5-resolution').pass).toBe(true);
  });

  it('V6 passes when no pack control was configured, and fails a control that injected nothing', () => {
    expect(gate({ ...sound, packControls: [] }, 'V6-controls-inject').pass).toBe(true);
    expect(gate({ ...sound, packControls: [] }, 'V6-controls-inject').actual).toBe(
      'no pack-based controls configured',
    );
    expect(gate({ ...sound, packControls: [{ arm: 'gated', meanPackIds: 0 }] }, 'V6-controls-inject').pass).toBe(
      false,
    );
  });

  it('V7 passes when no channel control ran, and needs 10pp when one did', () => {
    expect(gate({ ...sound, channelBest: undefined }, 'V7-channel').pass).toBe(true);
    expect(gate({ ...sound, channelBest: undefined }, 'V7-channel').actual).toBe('no channel control was run');
    expect(gate({ ...sound, channelBest: { arm: 'oracle', deltaPp: 9.99 } }, 'V7-channel').pass).toBe(false);
    expect(gate({ ...sound, channelBest: { arm: 'oracle', deltaPp: 10 } }, 'V7-channel').pass).toBe(true);
  });

  it('V8 fails when the endpoint swallowed more than 2% of the prompts', () => {
    expect(gate({ ...sound, callFailureRate: 0.02 }, 'V8-call-reliability').pass).toBe(true);
    const failing = gate({ ...sound, callFailureRate: 0.0201, callFailures: 36 }, 'V8-call-reliability');
    expect(failing.pass).toBe(false);
    expect(failing.blocking).toBe(true);
    expect(failing.actual).toBe('2.01% (36/1750 calls)');
  });

  it('omits the subset gate entirely when no convention is being taught', () => {
    expect(buildValidityGates(sound).map((entry) => entry.id)).not.toContain('V9-subset-size');
  });

  it('records the S2b subset floor as an advisory gate, not a silent branch', () => {
    const wide = gate({ ...sound, subset: { qualifying: 140, minimum: 100 } }, 'V9-subset-size');
    expect(wide.pass).toBe(true);
    expect(wide.blocking).toBe(false);
    expect(wide.actual).toBe('140 qualifying question(s)');

    const narrow = gate({ ...sound, subset: { qualifying: 99, minimum: 100 } }, 'V9-subset-size');
    expect(narrow.pass).toBe(false);
    // Advisory: a narrow subset does not fail the run, it downgrades the claim.
    expect(narrow.blocking).toBe(false);
    expect(narrow.criterion).toContain('direction rather than a verdict');
  });

  it('omits the convention-execution gate unless a convention is taught', () => {
    expect(buildValidityGates(sound).map((entry) => entry.id)).not.toContain('V10-convention-executable');
  });

  it('V10 refuses a run whose rewritten gold disagrees with the expected value', () => {
    // This is the gate that separates a scoring bug from a model that cannot follow
    // the convention: if the gold query, rewritten, does not produce the value the
    // scorer expects, no answer could pass and the run measures the rewrite.
    expect(gate({ ...sound, conventionExecRate: 1 }, 'V10-convention-executable').pass).toBe(true);
    const failing = gate({ ...sound, conventionExecRate: 0.98 }, 'V10-convention-executable');
    expect(failing.pass).toBe(false);
    expect(failing.blocking).toBe(true);
    expect(failing.actual).toBe('98.00%');
  });

  it('omits the channel ceiling outside the convention lane', () => {
    expect(buildValidityGates(sound).map((entry) => entry.id)).not.toContain('V11-channel-ceiling');
  });

  it('V11 requires the strongest control to reach the ceiling the protocol names', () => {
    // V7 asks whether the channel responds at all; V11 asks whether it is usable.
    // An oracle at 49% says the model will not reproduce the answer form even when
    // it is handed to it, and a mechanism measurement on top of that is meaningless.
    expect(gate({ ...sound, channelCeiling: 0.9 }, 'V11-channel-ceiling').pass).toBe(true);
    const failing = gate({ ...sound, channelCeiling: 0.4897 }, 'V11-channel-ceiling');
    expect(failing.pass).toBe(false);
    expect(failing.blocking).toBe(true);
    expect(failing.actual).toBe('48.97%');
  });

  it('marks exactly V5 advisory and everything else blocking', () => {
    const advisory = buildValidityGates({
      ...sound,
      subset: { qualifying: 140, minimum: 100 },
    })
      .filter((entry) => !entry.blocking)
      .map((entry) => entry.id);
    expect(advisory).toEqual(['V5-resolution', 'V9-subset-size']);
  });
});
