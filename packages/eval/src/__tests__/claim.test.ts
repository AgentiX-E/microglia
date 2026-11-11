import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitClaim, volatileKeysIn, VOLATILE_KEYS } from '../claim.js';

describe('splitClaim', () => {
  it('takes the hour out of the claim and says where it was', () => {
    const artefact = { id: 'poc-l0', ranAt: '2026-11-11T05:45:50.057Z', metrics: { recall: 1 } };
    const { claim, volatile } = splitClaim(artefact);
    expect(claim).toEqual({ id: 'poc-l0', metrics: { recall: 1 } });
    expect(volatile).toEqual({ ranAt: '2026-11-11T05:45:50.057Z' });
  });

  it('takes a latency out from three levels down, where the timings actually sit', () => {
    // The churn that produced this module was `arms[i].p50Ms` inside an array inside the study. A
    // top-level strip passes its own test and leaves the gate dirty, which is how this case exists.
    const study = {
      corpus: { holdout: 280 },
      arms: [
        { name: 'full', pass: true, p50Ms: 0.009, p95Ms: 0.019 },
        { name: 'noise', pass: false, p50Ms: 0.015, p95Ms: 0.043 },
      ],
    };
    const { claim, volatile } = splitClaim(study);
    expect(claim).toEqual({
      corpus: { holdout: 280 },
      arms: [
        { name: 'full', pass: true },
        { name: 'noise', pass: false },
      ],
    });
    expect(volatile).toEqual({
      'arms[0].p50Ms': 0.009,
      'arms[0].p95Ms': 0.019,
      'arms[1].p50Ms': 0.015,
      'arms[1].p95Ms': 0.043,
    });
  });

  it('leaves a threshold that is called p95 alone, because a threshold is a claim', () => {
    // The census that wrote `VOLATILE_KEYS` found forty timing-shaped names and exactly six that
    // changed between two runs of the same code. `p95_budget_ms` and `p95_growth_10k_to_100k` are
    // the study's *claims about scaling*; deleting them would be the fix destroying its own evidence.
    const scale = {
      p95_budget_ms: 12,
      p95_growth_10k_to_100k: 1.9,
      bound_ms: 5,
      deadline_ms: 3000,
      latency_p50_ms: 4,
    };
    const { claim, volatile } = splitClaim(scale);
    expect(claim).toEqual(scale);
    expect(volatile).toEqual({});
  });

  it('does not mutate the object the lane is still holding', () => {
    const artefact = { ranAt: 'now', metrics: { p95_ms: 3 } };
    splitClaim(artefact);
    expect(artefact).toEqual({ ranAt: 'now', metrics: { p95_ms: 3 } });
  });

  it('returns a document that held nothing volatile unchanged', () => {
    const clean = { id: 'x', metrics: { accuracy: 0.57 }, notes: ['a'] };
    const { claim, volatile } = splitClaim(clean);
    expect(claim).toEqual(clean);
    expect(volatile).toEqual({});
  });

  it('passes a root that is not an object straight through', () => {
    // Lanes write arrays and scalars through the same helper, and a walker that assumed an object
    // would turn a `samples` array into `{}` — silently, in the artefact, after the run was paid for.
    expect(splitClaim([1, 2]).claim).toEqual([1, 2]);
    expect(splitClaim('text').claim).toBe('text');
    expect(splitClaim(null).claim).toBeNull();
    expect(splitClaim(7).claim).toBe(7);
  });

  it('keeps a null value rather than treating it as absent', () => {
    expect(splitClaim({ ranAt: null, id: 'x' })).toEqual({ claim: { id: 'x' }, volatile: { ranAt: null } });
  });
});

describe('volatileKeysIn', () => {
  it('finds the paths a file would have to lose', () => {
    expect(volatileKeysIn({ ranAt: 'now', arms: [{ p50Ms: 1 }] })).toEqual(['ranAt', 'arms[0].p50Ms']);
  });

  it('says nothing about a clean document', () => {
    expect(volatileKeysIn({ id: 'x', metrics: { accuracy: 1 } })).toEqual([]);
  });

  it('walks arrays of scalars without inventing paths', () => {
    expect(volatileKeysIn({ samples: [1, 2, 3] })).toEqual([]);
  });
});

describe('the committed corpus', () => {
  // The invariant, read from the files rather than from the walk: a corpus grows back, and the way it
  // grows back is a new lane writing `ranAt` because every lane does.
  const roots = ['eval/results', 'bench/results'];
  const files = roots.flatMap((root) => {
    try {
      return readdirSync(root)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(root, name));
    } catch {
      return [];
    }
  });

  it('has artefacts to check, so a broken path cannot read as a clean corpus', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('carries no clock and no host timing', () => {
    const offenders = files.flatMap((file) =>
      volatileKeysIn(JSON.parse(readFileSync(file, 'utf8')) as unknown).map((path) => `${file}: ${path}`),
    );
    expect(offenders).toEqual([]);
  });

  it('is the list the code strips, not a list a reader has to reconstruct', () => {
    expect(VOLATILE_KEYS).toContain('ranAt');
    expect(new Set(VOLATILE_KEYS).size).toBe(VOLATILE_KEYS.length);
  });
});
