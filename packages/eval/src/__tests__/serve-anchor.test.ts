import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { knobFragment } from '../pack-knobs.js';
import { resolveServeAnchorPlan, SERVE_ANCHORS } from '../serve-anchor.js';

/**
 * The third axis of a serve, and the one the product has had all along.
 *
 * `RecallQuery.anchoring` is a published contract: `'scope'` lets a structured scope be the only reason a rule
 * appears, `'lexical'` requires it to share a word with the query. The τ² lane has only ever run the first, so
 * the corpus's 85% inert renders include every case where a rule matched on structure and said nothing about
 * the request — which is the largest single class in WikiTrace's own decomposition of degradation (arXiv
 * 2611.14320: 52% of events trace to a followed entry, and 80% of those are valid rules applied outside their
 * scope).
 *
 * This module resolves the switch and nothing else. It is deliberately **not** a `PackMode`: that type answers
 * *where a pack is served from* (`retrieved` / `prefix`), and its own doc comment says a third name would make
 * one axis claim two meanings. Anchoring is a **filter** on what may appear in a pack that is already served
 * from somewhere, so it is its own axis with its own default.
 */
describe('resolveServeAnchorPlan', () => {
  it('leaves the request byte-identical when nobody names an anchor', () => {
    // Rule one of the family: every committed artefact was produced by a request that carried no `anchoring`
    // parameter, and a default restated here would move the lane's history sideways the first time the pack
    // layer's own default changed.
    expect(resolveServeAnchorPlan({})).toEqual({ declared: false, knobs: {} });
    expect(resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: '' })).toEqual({ declared: false, knobs: {} });
    expect(resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: '   ' })).toEqual({ declared: false, knobs: {} });
  });

  it('sends the lexical anchor as the one parameter it is', () => {
    expect(resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: 'lexical' })).toEqual({
      anchor: 'lexical',
      declared: true,
      knobs: { anchoring: 'lexical' },
    });
  });

  it('lets a registration name the published default without moving the wire', () => {
    // `'scope'` is what the product already does, so an arm that declares it must be indistinguishable from an
    // arm that says nothing — except in the artefact, which needs to know the arm was declared. This is the
    // same distinction `PackModePlan.declared` exists for, one axis over.
    expect(resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: 'scope' })).toEqual({
      anchor: 'scope',
      declared: true,
      knobs: {},
    });
  });

  it('refuses a spelling it cannot honour, and names both that it can', () => {
    expect(() => resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: 'lexcial' })).toThrow(
      /must be unset or one of lexical, scope, not 'lexcial'/,
    );
    expect(() => resolveServeAnchorPlan({ TAU_SERVE_ANCHOR: 'Lexical' })).toThrow(/not 'Lexical'/);
  });

  it('publishes the two names as a list a caller can print', () => {
    // The refusal message and the registration's validation both read this list. Two spellings of one
    // vocabulary is how a header comes to accept a value the wire refuses.
    expect(SERVE_ANCHORS).toEqual(['lexical', 'scope']);
  });
});

/**
 * The join of the three axes, and the one combination it refuses.
 *
 * Tested as a function rather than through the command: the rule is about what a fragment may contain, and a
 * process launch per case would test the launcher.
 */
describe('knobFragment', () => {
  it('is empty when no axis adds a knob, which is the request every artefact was written with', () => {
    expect(knobFragment({ mode: '', shape: '' })).toBe('');
    expect(knobFragment({ mode: '', shape: '', anchor: '' })).toBe('');
  });

  it('joins the axes in one fragment, whatever order they resolve in', () => {
    expect(knobFragment({ mode: '', shape: '', anchor: 'lexical' })).toBe('anchoring=lexical');
    expect(knobFragment({ mode: '', shape: 'collapse', anchor: 'lexical' }).split('&').sort()).toEqual([
      'anchoring=lexical',
      'shape=collapse',
    ]);
    expect(knobFragment({ mode: 'prefix', shape: '', anchor: 'scope' }).split('&')).toContain('minCoverage=0');
  });

  it('refuses two knobs that would contradict each other on the wire', () => {
    // `prefix` means no retrieval (`anchoring=scope`, `minCoverage=0`); a lexical anchor means filter the
    // retrieval. Both cannot hold, and the last key in the fragment would win in silence.
    expect(() => knobFragment({ mode: 'prefix', shape: '', anchor: 'lexical' })).toThrow(
      /a lexical anchor has nothing to filter/,
    );
  });

  it('lets a caller reach it through the command as well', () => {
    // One launch, for the wire rather than for the rule: the command is what a workflow calls, and a wrapper
    // that dropped the environment would leave every registered anchor inert.
    const child = spawnSync('npx', ['tsx', 'packages/eval/src/bin/pack-knobs.ts', '', ''], {
      encoding: 'utf8',
      env: { ...process.env, TAU_SERVE_ANCHOR: 'lexical', TAU_PACK_MODE: '', TAU_PACK_SHAPE: '' },
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe('anchoring=lexical');
  });
});
