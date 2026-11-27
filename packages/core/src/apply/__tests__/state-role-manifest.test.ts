/**
 * R244 — the three-reader agreement, pinned.
 *
 * `eval/manifests/state-role.json` is derived by the Python reader (`eval/tools/state_role.py --verify`) from the
 * fixture's bytes. This test derives the same reading with the product's own functions — `stateRoleOf`, `serialOf`,
 * `subjectKey`, `resolveStates` — over those same bytes and compares every item. If the product and the evaluation
 * ever disagree about what state a rule is in, exactly one of these two readers fails, and the build stops. That is
 * the whole point: "the product ships the state the measurement read" becomes a property a build checks, not a
 * promise in a document.
 *
 * `null` in the fixture is an open clock (`Infinity`), the store's own JSON encoding; the translation is explicit
 * here rather than assumed, so a fixture that wrote a literal `0` could not quietly pass as an open bound.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveStates, serialOf, stateRoleOf, subjectKey, type StateSubject } from '../state-role.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/state-role-store.json`, 'utf8')) as {
  at: number;
  items: (Omit<StateSubject, 'validUntil' | 'systemUntil' | 'validFrom' | 'systemFrom'> & {
    validUntil: number | null;
    systemUntil: number | null;
    validFrom: number;
    systemFrom: number;
  })[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/state-role.json`, 'utf8')) as {
  schema: string;
  reading: {
    at: number;
    claims: number;
    items: number;
    roles: Record<string, number>;
    perItem: { id: string; own: string; resolved: string; serial: string; subject: string; winner: string }[];
    worldExpiredStillActive: number;
  };
};

function open(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

function subject(raw: (typeof fixture.items)[number]): StateSubject {
  return {
    id: raw.id,
    namespace: raw.namespace,
    kind: raw.kind,
    scope: raw.scope,
    validFrom: raw.validFrom,
    validUntil: open(raw.validUntil),
    systemFrom: raw.systemFrom,
    systemUntil: open(raw.systemUntil),
    contradictions: raw.contradictions,
    status: raw.status,
    updatedAt: raw.updatedAt,
  };
}

const items = fixture.items.map(subject);
const resolved = resolveStates(items, fixture.at);
const byId = new Map(items.map((item) => [item.id, item]));

describe('the product agrees with the Python reader on every field', () => {
  it('reads the same schema and population', () => {
    expect(manifest.schema).toBe('microglia/state-role@1');
    expect(manifest.reading.at).toBe(fixture.at);
    expect(manifest.reading.items).toBe(items.length);
    expect(manifest.reading.claims).toBe(new Set(items.map(subjectKey)).size);
  });

  it('agrees on every item’s own role, resolved role, serial and subject', () => {
    for (const row of manifest.reading.perItem) {
      const item = byId.get(row.id);
      expect(item, `manifest names an item the fixture lacks: ${row.id}`).toBeDefined();
      const state = item as StateSubject;
      expect(stateRoleOf(state, fixture.at), `${row.id} own role`).toBe(row.own);
      expect(resolved.get(row.id), `${row.id} resolved role`).toBe(row.resolved);
      expect(serialOf(state), `${row.id} serial`).toBe(row.serial);
      expect(subjectKey(state), `${row.id} subject`).toBe(row.subject);
    }
  });

  it('agrees on the winner of every claim (the max serial)', () => {
    const groups = new Map<string, StateSubject[]>();
    for (const item of items) {
      const key = subjectKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const row of manifest.reading.perItem) {
      const state = byId.get(row.id) as StateSubject;
      const group = groups.get(subjectKey(state)) as StateSubject[];
      const winner = group.reduce((best, candidate) =>
        serialOf(candidate) > serialOf(best) ? candidate : best,
      );
      expect(winner.id, `${row.id} claim winner`).toBe(row.winner);
    }
  });

  it('agrees on the role tally and the defect count', () => {
    const tally: Record<string, number> = { current: 0, historical: 0, transition: 0 };
    for (const item of items) {
      const role = resolved.get(item.id) as string;
      tally[role] = (tally[role] ?? 0) + 1;
    }
    expect(tally).toEqual(manifest.reading.roles);
    const defects = items.filter(
      (item) => item.validUntil < fixture.at && item.contradictions === 0 && item.status === 'active',
    ).length;
    expect(defects).toBe(manifest.reading.worldExpiredStillActive);
  });
});
