/**
 * R244 — read-time state roles and deterministic serial-max, pinned by behaviour.
 *
 * The store already carries four clocks (`validFrom/Until`, `systemFrom/Until`) and a contradiction count — the
 * bitemporal shape Graphiti and DISCERN validate. What it never did is tell the *reader* which of two versions of
 * one claim is current. `validityDecay` keeps a world-time-expired rule `active` (so it can be re-asserted), and
 * `encodeItemLine` renders it in exactly the same six fields as a live one. The model is then asked to guess which
 * rule still holds — the assembly step Freshness measures at 78-94.8% for a deterministic serial-max against 7%
 * for a model asked to decide, and A-TMA measures at +0.240 conflict accuracy when the state role is stated.
 *
 * These tests are written before the implementation. They pin four things, each of which a cheaper version gets
 * wrong: the three roles are exhaustive and transition wins; serial-max is deterministic and order-independent; a
 * superseded version never becomes current just because it has the largest serial; and the default path is byte-for-
 * byte unchanged so every committed artefact still renders identically.
 */
import { describe, expect, it } from 'vitest';

import type { KnowledgeItem, KnowledgeScope } from '../../kernel/index.js';
import {
  STATE_ROLES,
  resolveStates,
  serialOf,
  stateRoleOf,
  subjectKey,
  type StateSubject,
} from '../state-role.js';

const AT = 1_700_000_000_000;

function scope(task: string): KnowledgeScope {
  return { task, domain: 'retail' };
}

/** A minimal state subject. The functions under test read no field outside this shape. */
function subject(overrides: Partial<StateSubject> = {}): StateSubject {
  return {
    id: 'k_a',
    namespace: 'acme',
    kind: 'constraint',
    scope: scope('retail.return'),
    validFrom: AT - 1000,
    validUntil: Number.POSITIVE_INFINITY,
    systemFrom: AT - 1000,
    systemUntil: Number.POSITIVE_INFINITY,
    contradictions: 0,
    status: 'active',
    updatedAt: AT,
    ...overrides,
  };
}

describe('STATE_ROLES', () => {
  it('is the closed three-role vocabulary the renderer prints', () => {
    expect([...STATE_ROLES]).toEqual(['current', 'historical', 'transition']);
  });
});

describe('stateRoleOf', () => {
  it('calls a live, uncontested item current', () => {
    expect(stateRoleOf(subject(), AT)).toBe('current');
  });

  it('calls an item whose world-time validity has ended historical', () => {
    expect(stateRoleOf(subject({ validUntil: AT - 1 }), AT)).toBe('historical');
  });

  it('calls an item whose system-time validity has ended historical', () => {
    expect(stateRoleOf(subject({ systemUntil: AT - 1 }), AT)).toBe('historical');
  });

  it('calls a future-dated item historical, not current', () => {
    expect(stateRoleOf(subject({ validFrom: AT + 1 }), AT)).toBe('historical');
  });

  it('calls an item with a contradiction a transition', () => {
    expect(stateRoleOf(subject({ contradictions: 1 }), AT)).toBe('transition');
  });

  it('calls a conflicted item a transition even with no counted contradiction', () => {
    expect(stateRoleOf(subject({ status: 'conflicted' }), AT)).toBe('transition');
  });

  it('lets transition win over an expired clock: a contested claim is never silently current', () => {
    expect(
      stateRoleOf(subject({ contradictions: 2, validUntil: AT - 1, systemUntil: AT - 1 }), AT),
    ).toBe('transition');
  });

  it('treats the validity boundary as still current — expiry is strictly after', () => {
    expect(stateRoleOf(subject({ validUntil: AT }), AT)).toBe('current');
    expect(stateRoleOf(subject({ systemUntil: AT }), AT)).toBe('current');
  });
});

describe('serialOf', () => {
  it('orders by updatedAt, then by id so the comparison never depends on a model', () => {
    expect(serialOf(subject({ updatedAt: 9, id: 'z' })) < serialOf(subject({ updatedAt: 10, id: 'a' }))).toBe(true);
    expect(serialOf(subject({ updatedAt: 10, id: 'a' })) < serialOf(subject({ updatedAt: 10, id: 'b' }))).toBe(true);
  });

  it('zero-pads the clock so a lexical comparison keeps numeric order', () => {
    // 999 < 1000 numerically; without padding '999' > '1000' lexically.
    expect(serialOf(subject({ updatedAt: 999, id: 'a' })) < serialOf(subject({ updatedAt: 1000, id: 'a' }))).toBe(
      true,
    );
  });
});

describe('subjectKey', () => {
  it('groups the versions of one claim and separates different claims', () => {
    const a = subject({ id: 'k_a' });
    const b = subject({ id: 'k_b' });
    const otherScope = subject({ id: 'k_c', scope: scope('retail.exchange') });
    const otherKind = subject({ id: 'k_d', kind: 'negative' });
    expect(subjectKey(a)).toBe(subjectKey(b));
    expect(subjectKey(a)).not.toBe(subjectKey(otherScope));
    expect(subjectKey(a)).not.toBe(subjectKey(otherKind));
  });
});

describe('resolveStates', () => {
  it('leaves a lone item at its own state role', () => {
    const resolved = resolveStates([subject({ id: 'k_a', validUntil: AT - 1 })], AT);
    expect(resolved.get('k_a')).toBe('historical');
  });

  it('keeps only the newest version of a subject current and supersedes the rest', () => {
    const old = subject({ id: 'k_old', updatedAt: AT - 100 });
    const fresh = subject({ id: 'k_new', updatedAt: AT });
    const resolved = resolveStates([old, fresh], AT);
    expect(resolved.get('k_new')).toBe('current');
    expect(resolved.get('k_old')).toBe('historical');
  });

  it('is independent of input order — the winner is the serial, not the ranking', () => {
    const old = subject({ id: 'k_old', updatedAt: AT - 100 });
    const fresh = subject({ id: 'k_new', updatedAt: AT });
    const forward = resolveStates([old, fresh], AT);
    const reverse = resolveStates([fresh, old], AT);
    expect(forward.get('k_new')).toBe(reverse.get('k_new'));
    expect(forward.get('k_old')).toBe(reverse.get('k_old'));
  });

  it('breaks an equal-time tie by the serial, so the winner never depends on input order', () => {
    const a = subject({ id: 'a', updatedAt: AT });
    const b = subject({ id: 'b', updatedAt: AT });
    // serial-max literally maximises the serial: equal clocks, larger id wins. Both orders agree.
    expect(resolveStates([b, a], AT).get('b')).toBe('current');
    expect(resolveStates([b, a], AT).get('a')).toBe('historical');
    expect(resolveStates([a, b], AT).get('b')).toBe('current');
  });

  it('never promotes an expired newest version to current', () => {
    const expired = subject({ id: 'k_new', updatedAt: AT, validUntil: AT - 1 });
    const older = subject({ id: 'k_old', updatedAt: AT - 100 });
    const resolved = resolveStates([expired, older], AT);
    expect(resolved.get('k_new')).toBe('historical');
    // The newest is still the serial winner, so the older one is superseded too.
    expect(resolved.get('k_old')).toBe('historical');
  });

  it('keeps a transition even when it loses the serial — a contest is not resolved by age', () => {
    const contested = subject({ id: 'k_contested', updatedAt: AT - 100, contradictions: 1 });
    const fresh = subject({ id: 'k_new', updatedAt: AT });
    const resolved = resolveStates([fresh, contested], AT);
    expect(resolved.get('k_contested')).toBe('transition');
    expect(resolved.get('k_new')).toBe('current');
  });

  it('does not supersede across subjects', () => {
    const one = subject({ id: 'k_a', scope: scope('retail.return'), updatedAt: AT });
    const two = subject({ id: 'k_b', scope: scope('retail.exchange'), updatedAt: AT - 100 });
    const resolved = resolveStates([one, two], AT);
    expect(resolved.get('k_a')).toBe('current');
    expect(resolved.get('k_b')).toBe('current');
  });

  it('accepts full KnowledgeItems, which carry every field the subject needs', () => {
    const full: KnowledgeItem = {
      schema: 'microglia.knowledge/1',
      ...subject({ id: 'k_full' }),
      statement: 'A claim.',
      scope: scope('retail.return'),
      evidence: [],
      support: 1,
      confidence: 0.9,
      trust: 0.9,
      applied: 0,
      succeeded: 0,
      createdAt: AT - 1000,
    } as KnowledgeItem;
    expect(resolveStates([full], AT).get('k_full')).toBe('current');
  });
});
