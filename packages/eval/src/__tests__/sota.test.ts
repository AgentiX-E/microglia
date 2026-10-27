import { describe, expect, it } from 'vitest';
import {
  HOUSE_CONVENTIONS,
  GenerationCache,
  OPTIONAL_ARMS,
  PROMPT_VERSION,
  armPairsAgainstFull,
  buildValidityGates,
  canonicalRows,
  conventionOf,
  extractSql,
  judgeScalar,
  matches,
  mismatchNote,
  parseArms,
  anchorPromptFor,
  promptFor,
  retryPromptFor,
  retrySubset,
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

  it('keeps counting duplicates under the multiset reading, which is the default', () => {
    // The default has to stay the multiset reading: every number this lane published was
    // scored that way, and a silent change of criterion would make the next run
    // incomparable with the last while calling itself an improvement.
    expect(matches(['[1]', '[1]'], ['[1]'])).toBe(false);
    expect(matches(['[1]', '[1]'], ['[1]'], 'multiset')).toBe(false);
  });

  it('collapses duplicates under the set reading', () => {
    expect(matches(['[1]', '[1]'], ['[1]'], 'set')).toBe(true);
    expect(matches(['[1]', '[1]', '[2]'], ['[2]', '[1]'], 'set')).toBe(true);
  });

  it('still separates different values under the set reading', () => {
    expect(matches(['[1]', '[2]'], ['[1]', '[3]'], 'set')).toBe(false);
    expect(matches(['[1]'], ['[1]', '[2]'], 'set')).toBe(false);
    expect(matches([], [])).toBe(true);
  });

  it('agrees with itself on inputs that carry no duplicates', () => {
    // The two readings can only differ on duplicate rows, so a set that has none is the
    // control: any disagreement there would be a bug in one of the two branches.
    const cases: [string[], string[]][] = [
      [['[1]', '[2]'], ['[1]', '[2]']],
      [['[1]'], ['[2]']],
      [['[1]'], []],
      [[], []],
    ];
    for (const [left, right] of cases) {
      expect(matches(left, right, 'set')).toBe(matches(left, right, 'multiset'));
    }
  });
});

describe('parseArms', () => {
  it('accepts every arm the package declares, one name at a time', () => {
    // The regression this exists for: `full-validated` was added to a lane's local copy
    // of the union, compiled there, and was rejected by this function at runtime — a
    // dispatch failed two seconds in with "Unknown arm". Every declared name is now
    // proved selectable.
    for (const arm of OPTIONAL_ARMS) {
      expect([...parseArms(arm)]).toEqual(['none', 'full', arm]);
    }
  });

  it('defaults to every optional arm plus the two required ones', () => {
    const arms = parseArms(undefined);
    expect([...arms].sort()).toEqual([
      'chars-150',
      'chars-300',
      'chars-600',
      'critique',
      'duplicate',
      'full',
      'full-anchored',
      'full-anchored-conditional',
      'full-corroborated',
      'full-grounded',
      'full-late',
      'full-narrow',
      'full-onretry',
      'full-plain',
      'full-repair',
      'full-repair-onretry',
      'full-sampled',
      'full-validated',
      'gated',
      'none',
      'none-replica',
      'oracle',
      'retry-blank',
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
    // The table is checked against the union at compile time, so this cannot catch an
    // omission — it catches a change. Adding an arm has to touch this list, which puts
    // the decision somewhere a reviewer sees it rather than inside a `Record` literal.
    expect([...OPTIONAL_ARMS]).toEqual([
      'full-narrow',
      'full-plain',
      'full-corroborated',
      'full-grounded',
      'full-sampled',
      'full-onretry',
      'full-repair',
      'full-repair-onretry',
      'retry-blank',
      'full-late',
      'full-anchored',
      'full-anchored-conditional',
      'full-validated',
      'critique',
      'gated',
      'duplicate',
      'wrong-scope',
      'stated',
      'oracle',
      'chars-150',
      'chars-300',
      'chars-600',
      'none-replica',
    ]);
  });

  it('accepts the scope-widening arm, which is a pack built from the same corrections', () => {
    expect([...parseArms('full-narrow')].sort()).toEqual(['full', 'full-narrow', 'none']);
  });

  it('accepts the shape arm, which differs from full by one field of text', () => {
    expect([...parseArms('full-plain')].sort()).toEqual(['full', 'full-plain', 'none']);
  });

  it('accepts the corroboration arm, which filters the same pack on evidence count', () => {
    expect([...parseArms('full-corroborated')].sort()).toEqual(['full', 'full-corroborated', 'none']);
  });

  it('accepts the critique arm, which asks for a decision per item', () => {
    expect([...parseArms('critique')].sort()).toEqual(['critique', 'full', 'none']);
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
    expect(PROMPT_VERSION).toBe('sql-prompt/3');
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

  it('V5 says a sample with no discordant pairs cannot estimate anything', () => {
    const flat = gate({ ...sound, detectablePp: Number.POSITIVE_INFINITY }, 'V5-resolution');
    expect(flat.pass).toBe(false);
    expect(flat.blocking).toBe(false);
    expect(flat.actual).toBe('not estimable: no question changed hands');
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

  it('omits the shape gate when nothing was injected to inspect', () => {
    expect(buildValidityGates(sound).map((entry) => entry.id)).not.toContain('V12-shape-present');
  });

  it('V12 reports what share of injected rules said when they apply', () => {
    // The shape experiment's validity condition: two arms that differ only in the
    // condition are the same pack when no rule carries one, and a delta of zero
    // then measures nothing. Advisory, because a run with no conditions is still a
    // run - it is a result about the distiller rather than about the shape.
    const present = gate({ ...sound, packConditions: { injected: 200, withCondition: 140 } }, 'V12-shape-present');
    expect(present.pass).toBe(true);
    expect(present.blocking).toBe(false);
    expect(present.actual).toBe('140/200 injected rule(s) carried a condition (70.0%)');

    const absent = gate({ ...sound, packConditions: { injected: 200, withCondition: 92 } }, 'V12-shape-present');
    expect(absent.pass).toBe(false);
    expect(absent.criterion).toContain('the two shapes are the same pack');

    const empty = gate({ ...sound, packConditions: { injected: 0, withCondition: 0 } }, 'V12-shape-present');
    expect(empty.pass).toBe(false);
    expect(empty.actual).toBe('0/0 injected rule(s) carried a condition (0.0%)');
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

describe('armPairsAgainstFull', () => {
  it('pairs each control against full on the questions both answered', () => {
    const rows = [
      { full: true, arms: { 'full-plain': true, gated: false } },
      { full: true, arms: { 'full-plain': false, gated: false } },
      { full: false, arms: { 'full-plain': false, gated: false } },
      { full: false, arms: { 'full-plain': false, gated: false } },
    ];
    const pairs = armPairsAgainstFull(rows);
    const plain = pairs.find((pair) => pair.arm === 'full-plain');
    const gated = pairs.find((pair) => pair.arm === 'gated');
    // `full-plain` is right once where `full` is right, and wrong once where it is;
    // `gated` never passes. Both deltas are against `full`, not against `none`.
    expect(plain).toMatchObject({ n: 4, lost: 1, gained: 0, deltaPp: -25 });
    expect(gated).toMatchObject({ n: 4, lost: 2, gained: 0, deltaPp: -50 });
  });

  it('skips questions an arm never answered instead of counting them as failures', () => {
    // A control that was not configured for a case has no outcome. Counting absence
    // as a loss would let a partially-run arm look worse than it measured.
    const rows = [
      { full: true, arms: { gated: undefined } },
      { full: true, arms: { gated: false } },
    ];
    const [pair] = armPairsAgainstFull(rows);
    expect(pair).toMatchObject({ arm: 'gated', n: 1, lost: 1 });
  });

  it('reports no pairs when no control ran', () => {
    expect(armPairsAgainstFull([{ full: true, arms: {} }])).toEqual([]);
  });

  it('leaves the interval touching zero when the two arms never disagree', () => {
    const rows = Array.from({ length: 20 }, () => ({ full: true, arms: { oracle: true } }));
    const [pair] = armPairsAgainstFull(rows);
    expect(pair).toMatchObject({ n: 20, deltaPp: 0, lost: 0, gained: 0, p: 1 });
    expect(pair?.ciLowPp).toBe(0);
    expect(pair?.ciHighPp).toBe(0);
  });
});

describe('the critique prompt', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE students (id INTEGER);',
    pack: '{"id":"k1","statement":"x"}',
    stated: false,
    convention: NO_CONVENTION,
  };

  it('asks for one decision per item before the query', () => {
    const prompt = promptFor({ ...base, critique: true });
    expect(prompt).toContain('<id>: apply');
    expect(prompt).toContain('use only the items you marked apply');
    // The instruction has to sit after the block it refers to and before the question,
    // or "that block" names the wrong text.
    expect(prompt.indexOf('decide for each item')).toBeGreaterThan(prompt.indexOf('{"id":"k1"'));
    expect(prompt.indexOf('decide for each item')).toBeLessThan(prompt.indexOf('Question:'));
  });

  it('leaves the ordinary prompt untouched', () => {
    expect(promptFor(base)).not.toContain('decide for each item');
    expect(promptFor({ ...base, critique: false })).not.toContain('decide for each item');
  });

  it('does not ask for decisions about a pack that was not injected', () => {
    // An instruction to judge an empty block is an instruction the model has to invent
    // a subject for, which is the failure mode the empty pack exists to avoid.
    const prompt = promptFor({ ...base, pack: '', critique: true });
    expect(prompt).not.toContain('decide for each item');
  });
});

describe('promptFor pack position', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE s (id INTEGER)',
    pack: '- rule one',
    stated: false,
    convention: undefined,
  };

  it('puts the pack before the question by default, which is what every published number used', () => {
    const prompt = promptFor(base);
    expect(prompt.indexOf('- rule one')).toBeLessThan(prompt.indexOf('Question: How many students?'));
  });

  it('puts the pack after the question when asked, and changes nothing else', () => {
    const early = promptFor(base);
    const late = promptFor({ ...base, packPosition: 'after' });
    expect(late.indexOf('Question: How many students?')).toBeLessThan(late.indexOf('- rule one'));
    // Same lines, one moved: the arm is position, not wording.
    expect(late.split('\n\n').sort()).toEqual(early.split('\n\n').sort());
  });

  it('does not duplicate the question when the pack is empty and placed after it', () => {
    const prompt = promptFor({ ...base, pack: '', packPosition: 'after' });
    expect(prompt.match(/Question:/g)).toHaveLength(1);
  });
});

describe('anchorPromptFor', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE s (id INTEGER)',
    draft: 'SELECT COUNT(*) FROM s',
    pack: '- rule one',
  };

  it('carries the draft verbatim, because the draft is what the model is being asked to keep', () => {
    expect(anchorPromptFor(base)).toContain('SELECT COUNT(*) FROM s');
  });

  it('puts the question before the rules, so the rules cannot shape the reading of it', () => {
    const prompt = anchorPromptFor(base);
    expect(prompt.indexOf('Question: How many students?')).toBeLessThan(prompt.indexOf('- rule one'));
    expect(prompt.indexOf('A first attempt')).toBeLessThan(prompt.indexOf('- rule one'));
  });

  it('makes doing nothing the default, which is the failure the arm exists for', () => {
    const prompt = anchorPromptFor(base);
    expect(prompt).toContain('If none applies, return the first attempt unchanged.');
    expect(prompt).toContain('change only what it justifies');
    expect(prompt).toContain('may not apply to this one');
  });

  it('omits the rules block entirely when the pack is empty', () => {
    const prompt = anchorPromptFor({ ...base, pack: '' });
    expect(prompt).not.toContain('Conventions learned from earlier corrections');
    expect(prompt).not.toContain('If none applies');
  });

  it('keeps the evidence when the benchmark supplies it', () => {
    const prompt = anchorPromptFor({ ...base, evidence: 'rate = count / enrollment' });
    expect(prompt).toContain('Evidence (may be wrong; it is external knowledge):');
  });
});

describe('anchorPromptFor modes', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE s (id INTEGER)',
    draft: 'SELECT COUNT(*) FROM s',
    pack: '- {"when":"the question counts rows","statement":"count with COUNT(*)"}',
  };

  it('keeps the conservative reading as the default, so an existing arm cannot change by accident', () => {
    expect(anchorPromptFor(base)).toBe(anchorPromptFor(base, 'conservative'));
    expect(anchorPromptFor(base)).toContain('return the first attempt unchanged');
  });

  it('changes one sentence between modes and nothing else', () => {
    const conservative = anchorPromptFor(base).split('\n\n');
    const conditional = anchorPromptFor(base, 'conditional').split('\n\n');
    // Same number of blocks, same blocks except the last: the arms differ in the
    // instruction and nothing else, which is what makes the comparison one variable.
    expect(conditional).toHaveLength(conservative.length);
    expect(conditional.slice(0, -1)).toEqual(conservative.slice(0, -1));
    expect(conditional.at(-1)).not.toBe(conservative.at(-1));
  });

  it('tells the conditional arm to act on a condition that holds, and to check it', () => {
    const prompt = anchorPromptFor(base, 'conditional');
    expect(prompt).toContain('Check that condition against the question above.');
    expect(prompt).toContain('apply that item even where the first attempt disagrees with it');
    expect(prompt).toContain('change nothing else');
  });

  it('still makes doing nothing the default when no condition holds', () => {
    expect(anchorPromptFor(base, 'conditional')).toContain('return the first attempt unchanged');
  });

  it('carries no instruction at all when the pack is empty, in either mode', () => {
    for (const mode of ['conservative', 'conditional'] as const) {
      const prompt = anchorPromptFor({ ...base, pack: '' }, mode);
      expect(prompt).not.toContain('first attempt unchanged');
      expect(prompt).not.toContain('Check that condition');
    }
  });
});

describe('retryPromptFor', () => {
  const base = {
    question: 'How many students?',
    evidence: '',
    ddl: 'CREATE TABLE s (id INTEGER)',
    attempt: 'SELECT COUNT(*) FROM missing',
    failure: 'it failed with: no such table: missing',
    pack: '- {"statement":"count rows with COUNT(*)"}',
  };

  it('states the failure in the terms the system observed, not a diagnosis', () => {
    const prompt = retryPromptFor(base);
    expect(prompt).toContain('That attempt did not work: it failed with: no such table: missing');
    // The arm measures the retry, so inventing a cause would make it measure the invention.
    expect(prompt).not.toContain('the table does not exist');
  });

  it('puts the attempt and the failure before the pack, so the failure frames it', () => {
    const prompt = retryPromptFor(base);
    expect(prompt.indexOf('An earlier attempt')).toBeLessThan(prompt.indexOf('Conventions learned'));
    expect(prompt.indexOf('did not work')).toBeLessThan(prompt.indexOf('Conventions learned'));
  });

  it('asks the model to check the conventions against the failure', () => {
    const prompt = retryPromptFor(base);
    expect(prompt).toContain('Check whether one of those conventions explains the failure.');
    expect(prompt).toContain('If none does, write a different query that answers the question.');
  });

  it('carries no conventions block and no instruction when the pack is empty', () => {
    const prompt = retryPromptFor({ ...base, pack: '' });
    expect(prompt).not.toContain('Conventions learned');
    expect(prompt).not.toContain('Check whether one of those conventions');
    expect(prompt).toContain('That attempt did not work');
  });

  it('keeps the evidence line when the benchmark supplies any', () => {
    expect(retryPromptFor({ ...base, evidence: 'rate = count / enrolment' })).toContain(
      'Evidence (may be wrong; it is external knowledge):',
    );
  });

  it('asks for a repair when the block holds repairs', () => {
    const prompt = retryPromptFor({ ...base, packKind: 'repair' });
    expect(prompt).toContain('Repairs of earlier failures, each with the reason it was wrong');
    expect(prompt).toContain('Check whether one of those failures is this failure.');
    expect(prompt).not.toContain('Check whether one of those conventions explains the failure.');
  });

  it('labels nothing when a repair arm has no repair to show', () => {
    // An empty pack under the repair form must render exactly as an empty pack under the
    // rule form: the arm would otherwise differ from `retry-blank` in its instructions
    // rather than in what it was given.
    expect(retryPromptFor({ ...base, pack: '', packKind: 'repair' })).toBe(
      retryPromptFor({ ...base, pack: '' }),
    );
  });
});

describe('mismatchNote', () => {
  const shape = (over: Partial<{ ok: boolean; error: string; rows: number; columns: string[] }>) => ({
    ok: true,
    rows: 1,
    columns: ['count'],
    ...over,
  });

  it('quotes the driver when the attempt did not run', () => {
    expect(mismatchNote(shape({ ok: false, error: 'Error: no such column: t2.raceId' }), shape({}))).toBe(
      'it failed: Error: no such column: t2.raceId',
    );
  });

  it('says so when the driver gave no message', () => {
    // The type allows an absent error, and a note that rendered "undefined" would be
    // indistinguishable from a diagnosis nobody made.
    expect(mismatchNote({ ok: false, rows: 0, columns: [] }, shape({}))).toBe(
      'it failed: the driver gave no message',
    );
  });

  it('compares row counts before column names', () => {
    // A join that multiplies rows also renames them; the count is the cause and the
    // names are the symptom, so the note leads with the count.
    expect(mismatchNote(shape({ rows: 12 }), shape({ rows: 1 }))).toBe(
      'it returned 12 rows where the corrected query returns 1',
    );
  });

  it('names both column lists when only the projection differs', () => {
    expect(mismatchNote(shape({ columns: ['name'] }), shape({ columns: ['forename', 'surname'] }))).toBe(
      'it returned columns [name] where the corrected query returns [forename, surname]',
    );
  });

  it('falls back to the values when the shape agrees', () => {
    expect(mismatchNote(shape({}), shape({}))).toBe(
      "it returned the corrected query's columns and row count, but different values",
    );
  });

  it('does not claim a difference it did not measure when the correction itself failed', () => {
    expect(mismatchNote(shape({}), shape({ ok: false, error: 'boom' }))).toBe(
      'it ran but returned the wrong rows',
    );
  });
});

describe('retrySubset', () => {
  const row = (retried: boolean, base: boolean, arm: boolean) => ({
    retried,
    withoutMemoryCorrect: base,
    arms: { 'retry-blank': arm } as Record<string, boolean | undefined>,
  });

  it('says nothing when no question was retried', () => {
    // An empty block rather than a zero: a run where nothing failed measured no retry arm,
    // and a delta of 0pp would read as a measured null.
    expect(retrySubset([row(false, false, true)])).toEqual([]);
  });

  it('measures the arm on the retried questions only', () => {
    const cases = [
      row(true, false, true),
      row(true, false, false),
      row(true, true, true),
      // Excluded: its first answer worked, so no retry arm touched it.
      row(false, false, false),
    ];
    const rows = retrySubset(cases, 7, 200);
    const blank = rows.find((entry) => entry.arm === 'retry-blank');
    expect(blank).toBeDefined();
    expect(blank?.n).toBe(3);
    expect(blank?.withoutMemoryAccuracy).toBeCloseTo(1 / 3, 6);
    expect(blank?.accuracy).toBeCloseTo(2 / 3, 6);
    expect(blank?.gained).toBe(1);
    expect(blank?.lost).toBe(0);
    expect(blank?.deltaPp).toBeCloseTo(100 / 3, 6);
  });

  it('reports an arm that only some retried questions carry', () => {
    const cases = [
      { retried: true, withoutMemoryCorrect: false, arms: { 'retry-blank': true } },
      { retried: true, withoutMemoryCorrect: false, arms: {} },
    ];
    const rows = retrySubset(cases, 7, 200);
    expect(rows).toHaveLength(1);
    // The question without the arm is not a failure of the arm; it is not a pair.
    expect(rows[0]?.n).toBe(1);
  });
});

describe('the pack is labelled by what it holds', () => {
  const prompt = (packKind?: 'rule' | 'repair') =>
    promptFor({
      question: 'How many races?',
      evidence: '',
      ddl: 'CREATE TABLE races (raceId INT);',
      pack: '{"statement":"x"}',
      stated: false,
      convention: NO_CONVENTION,
      ...(packKind === undefined ? {} : { packKind }),
    });

  it('keeps the rule wording by default, because every published number used it', () => {
    expect(prompt()).toContain('Workspace conventions learned from earlier corrections:');
    expect(prompt('rule')).toBe(prompt());
  });

  it('calls a repair note what it is', () => {
    const text = prompt('repair');
    expect(text).toContain('Repairs of earlier failures, each with the reason it was wrong');
    expect(text).not.toContain('Workspace conventions learned from earlier corrections:');
  });

  it('leaves an empty pack unlabelled either way', () => {
    const empty = promptFor({
      question: 'q',
      evidence: '',
      ddl: 'd',
      pack: '',
      stated: false,
      convention: NO_CONVENTION,
      packKind: 'repair',
    });
    expect(empty).not.toContain('Repairs of earlier failures');
  });
});
