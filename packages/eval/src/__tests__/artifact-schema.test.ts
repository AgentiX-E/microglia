import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUN_ARTIFACT_SCHEMA,
  runArtifactJson,
  runArtifactReport,
  validateRunArtifact,
  type RunArtifact,
} from '../artifact-schema.js';

function base(): RunArtifact {
  return {
    schema: RUN_ARTIFACT_SCHEMA,
    id: 'offline-fixture',
    generatedAt: '2026-10-30T00:00:00.000Z',
    prereg: 'R8.1-offline-fixture',
    generator: {
      contract: 'candidate-generator/1',
      name: 'keyword-router',
      version: '1.0.0',
      source: 'eval/plugins/keyword-router.mjs',
    },
    protocol: { comparison: 'multiset', cases: 2, concurrency: 1 },
    cases: [
      { id: 'shop#1', dbId: 'shop', sql: 'SELECT count(*) FROM customer', error: null, correct: true },
      { id: 'shop#2', dbId: 'shop', sql: 'SELECT * FROM customer', error: null, correct: false },
    ],
    metrics: {
      n: 2,
      answered: 2,
      correct: 1,
      accuracy: 0.5,
      low: 0.0945,
      high: 0.9055,
      byDatabase: [{ dbId: 'shop', n: 2, correct: 1 }],
    },
    gates: [{ code: 'V27', name: 'third-party-module', ok: true, detail: 'loaded from eval/plugins' }],
  };
}

/** A copy with one field replaced, expressed as a path-free mutation for readability. */
function patched(mutate: (copy: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(base()) as unknown as Record<string, unknown>;
  mutate(copy);
  return copy;
}

function paths(value: unknown): readonly string[] {
  return validateRunArtifact(value).problems.map((problem) => problem.path);
}

describe('validateRunArtifact', () => {
  it('accepts a well-formed artefact', () => {
    expect(validateRunArtifact(base())).toEqual({ ok: true, problems: [] });
  });

  it('rejects anything that is not an object', () => {
    expect(validateRunArtifact(null)).toEqual({
      ok: false,
      problems: [{ path: '', problem: 'the artefact must be a JSON object' }],
    });
    expect(paths([])).toEqual(['']);
  });

  it('rejects a wrong schema literal', () => {
    expect(paths(patched((copy) => (copy['schema'] = 'microglia.run-artifact/2')))).toEqual(['schema']);
  });

  it('rejects an empty id and a non-timestamp', () => {
    expect(paths(patched((copy) => (copy['id'] = '  ')))).toEqual(['id']);
    expect(paths(patched((copy) => (copy['generatedAt'] = '2026-10-30')))).toEqual(['generatedAt']);
    expect(paths(patched((copy) => (copy['generatedAt'] = '2026-13-45T99:00:00Z')))).toEqual(['generatedAt']);
  });

  it('accepts a null pre-registration and rejects a non-string one', () => {
    expect(validateRunArtifact(patched((copy) => (copy['prereg'] = null))).ok).toBe(true);
    expect(paths(patched((copy) => (copy['prereg'] = 7)))).toEqual(['prereg']);
  });

  it('checks every field of the generator block', () => {
    expect(paths(patched((copy) => (copy['generator'] = 'nope')))).toEqual(['generator']);
    const wrong = patched((copy) => {
      copy['generator'] = { contract: 'candidate-generator/0', name: '', version: '', source: '' };
    });
    expect(paths(wrong)).toEqual([
      'generator.contract',
      'generator.name',
      'generator.version',
      'generator.source',
    ]);
  });

  it('checks the protocol block', () => {
    expect(paths(patched((copy) => (copy['protocol'] = 1)))).toEqual(['protocol']);
    const wrong = patched((copy) => {
      copy['protocol'] = { comparison: 'loose', cases: 0, concurrency: 0 };
    });
    expect(paths(wrong)).toEqual([
      'protocol.comparison',
      'protocol.cases',
      'protocol.concurrency',
      'protocol.cases',
    ]);
  });

  it('refuses an artefact with no cases', () => {
    expect(paths(patched((copy) => (copy['cases'] = [])))).toEqual(['cases']);
  });

  it('refuses a case count that disagrees with the array', () => {
    expect(paths(patched((copy) => (copy['protocol'] = { comparison: 'set', cases: 3, concurrency: 1 })))).toEqual([
      'protocol.cases',
    ]);
  });

  it('checks each case: shape, id, database, exclusivity and correctness', () => {
    const bad = patched((copy) => {
      copy['cases'] = [
        'nope',
        { id: '', dbId: '', sql: null, error: null, correct: 'yes' },
        { id: 'a', dbId: 'shop', sql: 'select 1', error: 'boom', correct: true },
        { id: 'a', dbId: 'shop', sql: null, error: 'boom', correct: true },
      ];
      copy['protocol'] = { comparison: 'multiset', cases: 4, concurrency: 1 };
    });
    const reported = paths(bad);
    expect(reported).toContain('cases[0]');
    expect(reported).toContain('cases[1].id');
    expect(reported).toContain('cases[1].dbId');
    expect(reported).toContain('cases[1].correct');
    expect(reported).toContain('cases[2]');
    expect(reported).toContain('cases[3].id');
    expect(reported).toContain('cases[3].correct');
  });

  it('checks sql and error types separately from their exclusivity', () => {
    const bad = patched((copy) => {
      copy['cases'] = [{ id: 'x', dbId: 'shop', sql: 5, error: 7, correct: false }];
      copy['protocol'] = { comparison: 'multiset', cases: 1, concurrency: 1 };
    });
    const reported = paths(bad);
    expect(reported).toContain('cases[0].sql');
    expect(reported).toContain('cases[0].error');
  });

  it('refuses metrics that are not the cases, counted', () => {
    expect(paths(patched((copy) => (copy['metrics'] = 'nope')))).toEqual(['metrics']);
    const wrong = patched((copy) => {
      copy['metrics'] = {
        n: 5,
        answered: 1,
        correct: 2,
        accuracy: 0.4,
        low: 0.1,
        high: 0.9,
        byDatabase: [{ dbId: 'shop', n: 2, correct: 1 }],
      };
    });
    const reported = paths(wrong);
    expect(reported).toContain('metrics.n');
    expect(reported).toContain('metrics.answered');
    expect(reported).toContain('metrics.correct');
    expect(reported).toContain('metrics.accuracy');
  });

  it('refuses an accuracy that is not correct over n', () => {
    expect(paths(patched((copy) => ((copy['metrics'] as Record<string, unknown>)['accuracy'] = 0.6)))).toEqual([
      'metrics.accuracy',
    ]);
    expect(paths(patched((copy) => ((copy['metrics'] as Record<string, unknown>)['accuracy'] = 1.5)))).toContain(
      'metrics.accuracy',
    );
  });

  it('refuses an interval that does not contain the estimate', () => {
    const bad = patched((copy) => {
      copy['metrics'] = { ...(copy['metrics'] as Record<string, unknown>), low: 0.6, high: 0.9 };
    });
    expect(paths(bad)).toContain('metrics');
  });

  it('refuses a malformed interval bound', () => {
    const bad = patched((copy) => {
      copy['metrics'] = { ...(copy['metrics'] as Record<string, unknown>), low: -0.1 };
    });
    expect(paths(bad)).toContain('metrics.low');
    const nan = patched((copy) => {
      copy['metrics'] = { ...(copy['metrics'] as Record<string, unknown>), high: Number.NaN };
    });
    expect(paths(nan)).toContain('metrics.high');
  });

  it('checks the per-database rows: shape, duplicates, counts and totals', () => {
    const empty = patched((copy) => {
      copy['metrics'] = { ...(copy['metrics'] as Record<string, unknown>), byDatabase: [] };
    });
    expect(paths(empty)).toEqual(['metrics.byDatabase']);

    const bad = patched((copy) => {
      copy['metrics'] = {
        ...(copy['metrics'] as Record<string, unknown>),
        byDatabase: [7, { dbId: '', n: 0, correct: 5 }, { dbId: 'shop', n: 2, correct: 1 }],
      };
    });
    const reported = paths(bad);
    expect(reported).toContain('metrics.byDatabase[0]');
    expect(reported).toContain('metrics.byDatabase[1].dbId');
    expect(reported).toContain('metrics.byDatabase[1].n');
    expect(reported).toContain('metrics.byDatabase[1].correct');
    expect(reported).toContain('metrics.byDatabase');
  });

  it('refuses duplicate databases and more correct than cases', () => {
    const bad = patched((copy) => {
      copy['metrics'] = {
        ...(copy['metrics'] as Record<string, unknown>),
        byDatabase: [
          { dbId: 'shop', n: 1, correct: 2 },
          { dbId: 'shop', n: 1, correct: 0 },
        ],
      };
    });
    const reported = paths(bad);
    expect(reported).toContain('metrics.byDatabase[0].correct');
    expect(reported).toContain('metrics.byDatabase[1].dbId');
  });

  it('refuses an artefact with no gates and a gate of the wrong shape', () => {
    expect(paths(patched((copy) => (copy['gates'] = [])))).toEqual(['gates']);
    const bad = patched((copy) => (copy['gates'] = ['nope', { code: 'X1', name: '', ok: 'yes', detail: '' }]));
    const reported = paths(bad);
    expect(reported).toContain('gates[0]');
    expect(reported).toContain('gates[1].code');
    expect(reported).toContain('gates[1].name');
    expect(reported).toContain('gates[1].ok');
    expect(reported).toContain('gates[1].detail');
  });
});

describe('runArtifactReport', () => {
  it('renders every section from the artefact alone', () => {
    const report = runArtifactReport(base());
    expect(report).toContain('# Run offline-fixture');
    expect(report).toContain('Generator **keyword-router** 1.0.0');
    expect(report).toContain('2 cases, multiset comparison, concurrency 1');
    expect(report).toContain('| accuracy | 50.00% (95% CI 9.45%–90.55%) |');
    expect(report).toContain('| shop | 2 | 1 | 50.00% |');
    expect(report).toContain('| shop#1 | shop | correct | SELECT count(*) FROM customer |');
    expect(report).toContain('| shop#2 | shop | wrong | SELECT * FROM customer |');
    expect(report).toContain('| V27 | third-party-module | pass | loaded from eval/plugins |');
  });

  it('says when a run has no pre-registration', () => {
    expect(runArtifactReport({ ...base(), prereg: null })).toContain('no pre-registration.');
  });

  it('renders an unanswered case as its error, and escapes pipes', () => {
    const artifact: RunArtifact = {
      ...base(),
      cases: [{ id: 'x', dbId: 'shop', sql: null, error: 'boom | bang', correct: false }],
      protocol: { comparison: 'multiset', cases: 1, concurrency: 1 },
      metrics: {
        n: 1,
        answered: 0,
        correct: 0,
        accuracy: 0,
        low: 0,
        high: 0.9455,
        byDatabase: [{ dbId: 'shop', n: 1, correct: 0 }],
      },
    };
    expect(runArtifactReport(artifact)).toContain('| x | shop | no answer | error: boom \\| bang |');
    const piped: RunArtifact = {
      ...artifact,
      cases: [{ id: 'x', dbId: 'shop', sql: 'SELECT a || b', error: null, correct: false }],
      metrics: { ...artifact.metrics, answered: 1 },
    };
    expect(runArtifactReport(piped)).toContain('SELECT a \\|\\| b');
  });

  it('renders a database with no cases as zero', () => {
    const artifact: RunArtifact = {
      ...base(),
      metrics: { ...base().metrics, byDatabase: [{ dbId: 'empty', n: 0, correct: 0 }] },
    };
    expect(runArtifactReport(artifact)).toContain('| empty | 0 | 0 | 0.00% |');
  });
});

describe('runArtifactJson', () => {
  it('writes two-space JSON with a trailing newline that parses back', () => {
    const text = runArtifactJson(base());
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "schema": "microglia.run-artifact/1"');
    expect(validateRunArtifact(JSON.parse(text)).ok).toBe(true);
  });
});

describe('the published schema', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../schema/run-artifact.schema.json', import.meta.url), 'utf8'),
  ) as {
    readonly required: readonly string[];
    readonly properties: Record<string, unknown>;
    readonly $defs: Record<string, { readonly required?: readonly string[] }>;
  };

  it('requires exactly the keys the artefact carries', () => {
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(base())));
  });

  it('requires the keys the validator insists on, at every nested level', () => {
    const artefact = base() as unknown as Record<string, unknown>;
    const nested: Record<string, unknown> = {
      generator: artefact['generator'],
      protocol: artefact['protocol'],
      metrics: artefact['metrics'],
      gate: (artefact['gates'] as unknown[])[0],
      case: (artefact['cases'] as unknown[])[0],
    };
    for (const [name, definition] of Object.entries(schema.$defs)) {
      const required = definition.required ?? [];
      expect(required.length).toBeGreaterThan(0);
      const instance = nested[name] as Record<string, unknown>;
      expect(Object.keys(instance).sort()).toEqual([...required].sort());
    }
  });
});
