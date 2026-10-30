import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_CONTRACT,
  assertGenerator,
  generatorProblems,
  loadGenerator,
  readReply,
  runGenerator,
  runOne,
  sameRows,
  type CandidateGenerator,
  type PluginCase,
  type Scorer,
} from '../plugin.js';

const caseOf = (overrides: Partial<PluginCase> & { id: string }): PluginCase => ({
  dbId: 'shop',
  question: 'How many customers are there?',
  evidence: '',
  ddl: 'CREATE TABLE customer (id INTEGER)',
  gold: ['{"count(*)":3}'],
  ...overrides,
});

const generatorOf = (reply: (id: string) => unknown): CandidateGenerator => ({
  contract: CANDIDATE_CONTRACT,
  name: 'stub',
  version: '1.0.0',
  generate: (request) => Promise.resolve(reply(request.id) as { sql: string }),
});

/** The gold rows of the fixture cases, keyed by id, so a scorer needs no database. */
const LOOKUP: Record<string, readonly string[]> = {
  'shop#1': ['{"count(*)":3}'],
  'shop#2': ['{"count(*)":3}'],
  'library#1': ['{"count(*)":3}'],
};

const lookup: Scorer = (sql, item) => (sql === 'fail' ? undefined : (LOOKUP[item.id] ?? []));

describe('generatorProblems', () => {
  it('accepts a complete generator', () => {
    expect(generatorProblems(generatorOf(() => 'select 1'))).toEqual([]);
  });

  it('names every missing field at once', () => {
    const problems = generatorProblems({});
    expect(problems.map((entry) => entry.field)).toEqual(['contract', 'name', 'version', 'generate']);
  });

  it('rejects a module that is not an object', () => {
    expect(generatorProblems('nope')).toEqual([{ field: '', problem: 'the module must export an object' }]);
    expect(generatorProblems(null)).toHaveLength(1);
  });

  it('rejects a wrong contract string and an empty name', () => {
    const problems = generatorProblems({
      contract: 'candidate-generator/0',
      name: '   ',
      version: '1',
      generate: () => 'select 1',
    });
    expect(problems.map((entry) => entry.field)).toEqual(['contract', 'name']);
  });
});

describe('assertGenerator', () => {
  it('returns a valid generator unchanged', () => {
    const generator = generatorOf(() => 'select 1');
    expect(assertGenerator(generator, 'x')).toBe(generator);
  });

  it('throws MG_E_CONFIG with the module in the details', () => {
    expect(() => assertGenerator({}, 'eval/plugins/broken.mjs')).toThrow(/MG_E_CONFIG/);
    try {
      assertGenerator({ contract: 'nope' }, 'eval/plugins/broken.mjs');
    } catch (error) {
      const details = (error as { details: Record<string, unknown> }).details;
      expect(Object.keys(details)).toContain('contract');
      // A module that is not an object at all is reported under one key rather than five.
      try {
        assertGenerator('nope', 'eval/plugins/broken.mjs');
      } catch (inner) {
        expect((inner as { details: Record<string, unknown> }).details['module']).toBe(
          'the module must export an object',
        );
      }
      expect(details['contract']).toContain('candidate-generator/1');
    }
  });
});

describe('readReply', () => {
  it('takes a string and trims it', () => {
    expect(readReply('  select 1  ')).toBe('select 1');
  });

  it('takes an object with sql', () => {
    expect(readReply({ sql: 'select 2' })).toBe('select 2');
  });

  it('refuses an empty string, an object without sql, and a non-reply', () => {
    expect(() => readReply('   ')).toThrow(/empty string/);
    expect(() => readReply({ sql: '  ' })).toThrow(/neither SQL nor an error/);
    expect(() => readReply(null)).toThrow(/neither SQL nor an error/);
  });
});

describe('sameRows', () => {
  it('compares multisets by length and value', () => {
    expect(sameRows(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameRows(['a'], ['a', 'b'])).toBe(false);
    expect(sameRows(['a', 'c'], ['a', 'b'])).toBe(false);
  });

  it('collapses duplicates under the set comparison', () => {
    expect(sameRows(['a', 'a'], ['a'], 'set')).toBe(true);
    expect(sameRows(['a', 'b'], ['a', 'c'], 'set')).toBe(false);
    expect(sameRows(['a'], ['a', 'b'], 'set')).toBe(false);
  });
});

describe('loadGenerator', () => {
  it('loads the fixture generator from outside the package', async () => {
    const loaded = await loadGenerator('eval/plugins/keyword-router.mjs', { cwd: process.cwd() });
    expect(loaded.generator.name).toBe('keyword-router');
    expect(loaded.insidePackage).toBe(false);
    expect(loaded.source).toBe('eval/plugins/keyword-router.mjs');
  });

  it('refuses a module inside packages/eval before importing it', async () => {
    await expect(
      loadGenerator('packages/eval/src/plugin.ts', { cwd: process.cwd() }),
    ).rejects.toThrow(/must live outside packages\/eval/);
  });

  it('refuses the package root itself', async () => {
    await expect(
      loadGenerator('packages/eval', { cwd: '/repo' , packageRoot: '/repo/packages/eval' }),
    ).rejects.toThrow(/outside packages\/eval/);
  });

  it('reports an import failure as a configuration error', async () => {
    await expect(loadGenerator('eval/plugins/missing.mjs', { cwd: process.cwd() })).rejects.toThrow(
      /could not import/,
    );
  });

  it('uses the default export when there is one and the module otherwise', async () => {
    const generator = generatorOf(() => 'select 1');
    const withDefault = await loadGenerator('x.mjs', {
      cwd: '/repo',
      packageRoot: '/repo/packages/eval',
      load: () => Promise.resolve({ default: generator }),
    });
    expect(withDefault.generator).toBe(generator);
    const bare = await loadGenerator('x.mjs', {
      cwd: '/repo',
      packageRoot: '/repo/packages/eval',
      load: () => Promise.resolve(generator),
    });
    expect(bare.generator).toBe(generator);
  });

  it('defaults the working directory and the package root', async () => {
    const loaded = await loadGenerator('eval/plugins/keyword-router.mjs');
    expect(loaded.generator.name).toBe('keyword-router');
  });

  it('reports a non-Error rejection from the importer', async () => {
    await expect(
      loadGenerator('x.mjs', {
        cwd: '/repo',
        packageRoot: '/repo/packages/eval',
        load: () => Promise.reject('refused'),
      }),
    ).rejects.toThrow(/could not import/);
  });

  it('resolves .. and . in the specifier before deciding provenance', async () => {
    await expect(
      loadGenerator('/repo/packages/eval/./dist/../src/x.mjs', {
        cwd: '/repo',
        packageRoot: '/repo/packages/eval',
      }),
    ).rejects.toThrow(/outside packages\/eval/);
  });

  it('keeps an absolute path outside the working directory absolute', async () => {
    const generator = generatorOf(() => 'select 1');
    const loaded = await loadGenerator('/tmp/x.mjs', {
      cwd: '/repo',
      packageRoot: '/repo/packages/eval',
      load: () => Promise.resolve({ default: generator }),
    });
    expect(loaded.source).toBe('/tmp/x.mjs');
  });
});

describe('runOne', () => {
  it('scores a correct answer', async () => {
    const outcome = await runOne(generatorOf(() => 'select 1'), caseOf({ id: 'shop#1' }), lookup);
    expect(outcome).toEqual({ id: 'shop#1', dbId: 'shop', sql: 'select 1', error: null, correct: true });
  });

  it('records a thrown generator as an unanswered case', async () => {
    const generator: CandidateGenerator = {
      contract: CANDIDATE_CONTRACT,
      name: 'angry',
      version: '1',
      generate: () => Promise.reject(new Error('boom')),
    };
    const outcome = await runOne(generator, caseOf({ id: 'shop#1' }), lookup);
    expect(outcome.sql).toBeNull();
    expect(outcome.error).toBe('boom');
    expect(outcome.correct).toBe(false);
  });

  it('records a non-Error rejection as its own text', async () => {
    const generator: CandidateGenerator = {
      contract: CANDIDATE_CONTRACT,
      name: 'terse',
      version: '1',
      generate: () => Promise.reject('nope'),
    };
    const outcome = await runOne(generator, caseOf({ id: 'shop#1' }), lookup);
    expect(outcome.error).toBe('nope');
  });

  it('treats an unexecutable statement as wrong, not missing', async () => {
    const outcome = await runOne(generatorOf(() => 'fail'), caseOf({ id: 'shop#1' }), lookup);
    expect(outcome.sql).toBe('fail');
    expect(outcome.error).toBeNull();
    expect(outcome.correct).toBe(false);
  });

  it('times out a generator that never answers', async () => {
    const generator: CandidateGenerator = {
      contract: CANDIDATE_CONTRACT,
      name: 'slow',
      version: '1',
      generate: () => new Promise<string>(() => undefined),
    };
    const outcome = await runOne(generator, caseOf({ id: 'shop#1' }), lookup, 5);
    expect(outcome.error).toContain('did not answer within 5ms');
    expect(outcome.correct).toBe(false);
  });

  it('skips the timeout when it is zero', async () => {
    const outcome = await runOne(generatorOf(() => 'select 1'), caseOf({ id: 'shop#1' }), lookup, 0);
    expect(outcome.correct).toBe(true);
  });
});

describe('runGenerator', () => {
  const cases = [caseOf({ id: 'shop#1' }), caseOf({ id: 'shop#2' }), caseOf({ id: 'library#1', dbId: 'library' })];
  const input = {
    generator: generatorOf((id) => (id === 'library#1' ? 'fail' : 'select 1')),
    source: 'eval/plugins/stub.mjs',
    insidePackage: false,
    cases,
    score: lookup,
    comparison: 'multiset' as const,
    concurrency: 2,
    prereg: { id: 'R8.1-offline-fixture', resolved: true },
    id: 'test-run',
    now: '2026-10-30T00:00:00.000Z',
  };

  it('assembles the artefact the schema validates', async () => {
    const artifact = await runGenerator(input);
    expect(artifact.schema).toBe('microglia.run-artifact/1');
    expect(artifact.metrics.n).toBe(3);
    expect(artifact.metrics.answered).toBe(3);
    expect(artifact.metrics.correct).toBe(2);
    expect(artifact.metrics.accuracy).toBeCloseTo(2 / 3, 12);
    expect(artifact.metrics.low).toBeLessThan(artifact.metrics.accuracy);
    expect(artifact.metrics.high).toBeGreaterThan(artifact.metrics.accuracy);
    expect(artifact.metrics.byDatabase).toEqual([
      { dbId: 'shop', n: 2, correct: 2 },
      { dbId: 'library', n: 1, correct: 0 },
    ]);
    expect(artifact.gates.map((gate) => gate.code)).toEqual(['V27', 'V30', 'V29']);
    expect(artifact.gates.every((gate) => gate.ok)).toBe(true);
    expect(artifact.prereg).toBe('R8.1-offline-fixture');
  });

  it('fails V27 when the generator lives inside the package', async () => {
    const artifact = await runGenerator({ ...input, insidePackage: true });
    const gate = artifact.gates.find((entry) => entry.code === 'V27');
    expect(gate?.ok).toBe(false);
    expect(gate?.detail).toContain('not a third-party generator');
  });

  it('fails V30 when no pre-registration resolves', async () => {
    const artifact = await runGenerator({ ...input, prereg: { id: 'nope', resolved: false } });
    expect(artifact.gates.find((entry) => entry.code === 'V30')?.ok).toBe(false);
    expect(artifact.prereg).toBe('nope');
  });

  it('records a null pre-registration when the id is empty', async () => {
    const artifact = await runGenerator({ ...input, prereg: { id: '', resolved: false } });
    expect(artifact.prereg).toBeNull();
    expect(artifact.gates.find((entry) => entry.code === 'V30')?.ok).toBe(false);
  });

  it('fails V29 when too few cases are answered', async () => {
    const angry: CandidateGenerator = {
      contract: CANDIDATE_CONTRACT,
      name: 'angry',
      version: '1',
      generate: () => Promise.reject(new Error('boom')),
    };
    const artifact = await runGenerator({ ...input, generator: angry });
    const gate = artifact.gates.find((entry) => entry.code === 'V29');
    expect(gate?.ok).toBe(false);
    expect(gate?.detail).toContain('0/3 answered');
  });

  it('refuses an empty case list and a bad concurrency', async () => {
    await expect(runGenerator({ ...input, cases: [] })).rejects.toThrow(/at least one case/);
    await expect(runGenerator({ ...input, concurrency: 0 })).rejects.toThrow(/positive integer/);
    await expect(runGenerator({ ...input, concurrency: 1.5 })).rejects.toThrow(/positive integer/);
  });
});
