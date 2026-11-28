import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import {
  REVISION_INTENTS,
  REVISION_REASONS,
  REVISION_VERDICTS,
  revisionIntegrity,
  SITE_KINDS,
  SITE_STATES,
  type RevisionInput,
  type RevisionSite,
} from '../revision-integrity.js';

describe('revisionIntegrity — a revision is only as good as its worst derived site (R249)', () => {
  const site = (id: string, kind: RevisionSite['kind'], state: RevisionSite['state']): RevisionSite => ({
    id,
    kind,
    state,
  });
  const input = (over: Partial<RevisionInput> = {}): RevisionInput => ({
    id: 'claim-1',
    intent: 'retract',
    sites: [site('s0', 'source', 'tombstoned')],
    ...over,
  });

  it('exposes the closed, ordered vocabularies', () => {
    expect(REVISION_INTENTS).toEqual(['retract', 'correct']);
    expect(SITE_KINDS).toEqual(['source', 'summary', 'fact-key', 'embedding', 'citation']);
    expect(SITE_STATES).toEqual(['live', 'augmented', 'tombstoned', 'purged']);
    expect(REVISION_VERDICTS).toEqual(['complete', 'residual', 'method-violation']);
    expect(REVISION_REASONS).toEqual([
      'full-purge',
      'tombstone-coverage',
      'augmented-and-covered',
      'live-site',
      'augment-retains-claim',
      'no-source-to-augment',
      'replace-drops-provenance',
    ]);
  });

  describe('coverage dominates: an untouched site keeps the old value', () => {
    it('a fully purged retract is complete (the only residual-zero removal)', () => {
      const r = revisionIntegrity(
        input({
          sites: [
            site('s0', 'source', 'purged'),
            site('s1', 'summary', 'purged'),
            site('s2', 'embedding', 'purged'),
          ],
        }),
      );
      expect(r.verdict).toBe('complete');
      expect(r.reason).toBe('full-purge');
      expect(r.residualSites).toBe(0);
      expect(r.siteCount).toBe(3);
      expect(r.purgedSites).toBe(3);
    });

    it('a tombstone-covered retract is complete', () => {
      const r = revisionIntegrity(
        input({
          sites: [site('s0', 'source', 'tombstoned'), site('s1', 'summary', 'tombstoned')],
        }),
      );
      expect(r.verdict).toBe('complete');
      expect(r.reason).toBe('tombstone-coverage');
      expect(r.tombstonedSites).toBe(2);
    });

    it('a live derived summary after a source-only deletion is residual (the FRS failure)', () => {
      const r = revisionIntegrity(
        input({
          sites: [site('s0', 'source', 'purged'), site('s1', 'summary', 'live')],
        }),
      );
      expect(r.verdict).toBe('residual');
      expect(r.reason).toBe('live-site');
      expect(r.residualSites).toBe(1);
      expect(r.liveSites).toBe(1);
    });

    it('counts every residual live site, not just the first', () => {
      const r = revisionIntegrity(
        input({
          sites: [site('s0', 'source', 'tombstoned'), site('s1', 'summary', 'live'), site('s2', 'embedding', 'live')],
        }),
      );
      expect(r.residualSites).toBe(2);
      expect(r.liveSites).toBe(2);
    });

    it('a live derived site also poisons a correction', () => {
      const r = revisionIntegrity(
        input({
          intent: 'correct',
          sites: [site('s0', 'source', 'augmented'), site('s1', 'summary', 'live')],
        }),
      );
      expect(r.verdict).toBe('residual');
      expect(r.reason).toBe('live-site');
    });
  });

  describe('method matches intent', () => {
    it('augmenting a retracted claim retains it, so it is residual', () => {
      const r = revisionIntegrity(
        input({
          intent: 'retract',
          sites: [site('s0', 'source', 'augmented'), site('s1', 'summary', 'tombstoned')],
        }),
      );
      expect(r.verdict).toBe('residual');
      expect(r.reason).toBe('augment-retains-claim');
      expect(r.residualSites).toBe(1);
      expect(r.augmentedSites).toBe(1);
    });

    it('augment plus a live site reports the more specific augment reason and counts both residuals', () => {
      const r = revisionIntegrity(
        input({
          intent: 'retract',
          sites: [site('s0', 'source', 'augmented'), site('s1', 'summary', 'live')],
        }),
      );
      // The augment-retains-claim branch is checked first for a retract (the more specific finding), and the count
      // still includes the live site: both sites carry the old value.
      expect(r.reason).toBe('augment-retains-claim');
      expect(r.residualSites).toBe(2);
    });

    it('a correction with an augmented source and clean derivatives is complete', () => {
      const r = revisionIntegrity(
        input({
          intent: 'correct',
          sites: [site('s0', 'source', 'augmented'), site('s1', 'summary', 'tombstoned'), site('s2', 'fact-key', 'purged')],
        }),
      );
      expect(r.verdict).toBe('complete');
      expect(r.reason).toBe('augmented-and-covered');
      expect(r.hasSource).toBe(true);
    });

    it('a correction with no source cannot augment provenance', () => {
      const r = revisionIntegrity(
        input({ intent: 'correct', sites: [site('s1', 'summary', 'tombstoned')] }),
      );
      expect(r.verdict).toBe('method-violation');
      expect(r.reason).toBe('no-source-to-augment');
      expect(r.hasSource).toBe(false);
    });

    it('a correction that purges the source drops provenance (LongMemEval replace-loss)', () => {
      const r = revisionIntegrity(
        input({
          intent: 'correct',
          sites: [site('s0', 'source', 'purged'), site('s1', 'summary', 'tombstoned')],
        }),
      );
      expect(r.verdict).toBe('method-violation');
      expect(r.reason).toBe('replace-drops-provenance');
    });

    it('a correction that tombstones the source also drops provenance', () => {
      const r = revisionIntegrity(
        input({ intent: 'correct', sites: [site('s0', 'source', 'tombstoned')] }),
      );
      expect(r.reason).toBe('replace-drops-provenance');
    });
  });

  describe('guards refuse rather than default', () => {
    it('refuses a blank revision id', () => {
      expect(() => revisionIntegrity(input({ id: '  ' }))).toThrow(MicrogliaError);
    });

    it('names the revision in an unknown-intent refusal', () => {
      try {
        revisionIntegrity(input({ id: 'bad-rev', intent: 'archive' as never }));
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('bad-rev');
      }
    });

    it('refuses an unknown intent', () => {
      expect(() => revisionIntegrity(input({ intent: 'archive' as never }))).toThrow(MicrogliaError);
    });

    it('refuses a non-array sites value', () => {
      expect(() => revisionIntegrity(input({ sites: 'x' as never }))).toThrow(MicrogliaError);
    });

    it('refuses empty sites', () => {
      expect(() => revisionIntegrity(input({ sites: [] }))).toThrow(MicrogliaError);
    });

    it('refuses a blank site id', () => {
      expect(() => revisionIntegrity(input({ sites: [site('  ', 'source', 'live')] }))).toThrow(MicrogliaError);
    });

    it('refuses a duplicate site id', () => {
      expect(() =>
        revisionIntegrity(
          input({ sites: [site('dup', 'source', 'tombstoned'), site('dup', 'summary', 'purged')] }),
        ),
      ).toThrow(MicrogliaError);
    });

    it('names the duplicate site id in the refusal', () => {
      try {
        revisionIntegrity(
          input({ sites: [site('dup-id', 'source', 'tombstoned'), site('dup-id', 'summary', 'purged')] }),
        );
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('dup-id');
      }
    });

    it('refuses an unknown site kind', () => {
      expect(() => revisionIntegrity(input({ sites: [site('s', 'vector-db' as never, 'live')] }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses an unknown site state', () => {
      expect(() => revisionIntegrity(input({ sites: [site('s', 'source', 'archived' as never)] }))).toThrow(
        MicrogliaError,
      );
    });
  });

  describe('determinism and purity', () => {
    it('returns the same readback for the same input', () => {
      const value = input({ sites: [site('s0', 'source', 'augmented'), site('s1', 'summary', 'live')] });
      expect(revisionIntegrity(value)).toEqual(revisionIntegrity(value));
    });

    it('does not mutate its input', () => {
      const sites = Object.freeze([Object.freeze(site('s0', 'source', 'tombstoned'))]);
      const value = Object.freeze(input({ sites }));
      expect(() => revisionIntegrity(value)).not.toThrow();
      expect(sites[0]?.state).toBe('tombstoned');
    });

    it('the four site-state counts always sum to the site count', () => {
      const value = input({
        sites: [
          site('a', 'source', 'augmented'),
          site('b', 'summary', 'live'),
          site('c', 'embedding', 'tombstoned'),
          site('d', 'citation', 'purged'),
        ],
      });
      const r = revisionIntegrity(value);
      expect(r.liveSites + r.augmentedSites + r.tombstonedSites + r.purgedSites).toBe(r.siteCount);
    });
  });
});
