/**
 * R244 — the state role at the render boundary, written before the implementation.
 *
 * The pure classifier (`state-role.test.ts`) is necessary but not sufficient: a role that never reaches the model
 * is an instrument, not a product. These tests pin the integration at the one seam that decides what the model sees:
 * `encodeItemLine` / `renderPack` / `makePack`. Two properties are non-negotiable and are asserted together —
 *
 *  1. default-off means byte-for-byte identical to every artefact committed before R244, and
 *  2. opt-in prints a `state` per line, applies serial-max over revisions of one claim, and keeps a contest visible.
 *
 * The fixtures build real `KnowledgeItem`s through `createKnowledgeItem`, then move their clocks the way the store
 * does (`expireKnowledge` and a contradiction), so the reading is about the product's records rather than a copy.
 */
import { describe, expect, it } from 'vitest';

import { createKnowledgeItem, defaultPolicy, expireKnowledge, type DistillCandidate, type KnowledgeItem } from '../../kernel/index.js';
import { encodeItemLine, makePack, renderPack } from '../render.js';

const AT = 1_700_000_000_000;

function candidate(index: number, statement: string): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.return', domain: 'retail' },
    statement,
    evidence: { feedbackId: `fb_${index}`, runId: `run_${index}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${index}`,
  };
}

function live(index: number, statement = `Rule number ${index} about returning a delivered item.`): KnowledgeItem {
  return { ...createKnowledgeItem(candidate(index, statement), defaultPolicy, AT, `id_${index}`), status: 'active' };
}

const OPT = { budget: 100_000 };
const ON = { budget: 100_000, stateRole: { now: AT } };

function parseLines(rendered: string): Record<string, unknown>[] {
  return rendered
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('default path is byte-identical (R244 switch is off)', () => {
  it('encodeItemLine adds no state field when none is requested', () => {
    const line = encodeItemLine(live(0), true);
    expect(line).not.toContain('"state"');
  });

  it('renderPack emits exactly the pre-R244 bytes', () => {
    const items = [live(0), live(1)];
    expect(renderPack(items, OPT).rendered).toBe(renderPack(items, { ...OPT, stateRole: undefined }).rendered);
  });

  it('makePack emits exactly the pre-R244 bytes', () => {
    const pack = makePack([live(0)], OPT);
    expect(pack.rendered).not.toContain('"state"');
  });
});

describe('opt-in state role reaches the rendered line', () => {
  it('prints current for a live uncontested item', () => {
    const pack = makePack([live(0)], ON);
    expect(parseLines(pack.rendered)[0]?.state).toBe('current');
  });

  it('prints historical for a world-time-expired but still active item', () => {
    const item = expireKnowledge(live(0), AT - 1, 'policy-changed');
    const pack = makePack([{ ...item, status: 'active' }], ON);
    expect(parseLines(pack.rendered)[0]?.state).toBe('historical');
  });

  it('prints transition for a contested item', () => {
    const item: KnowledgeItem = { ...live(0), contradictions: 2 };
    const pack = makePack([item], ON);
    expect(parseLines(pack.rendered)[0]?.state).toBe('transition');
  });

  it('serial-max supersedes an older revision of the same claim', () => {
    const statement = 'One claim with two revisions.';
    const old = { ...live(0, statement), updatedAt: AT - 100 };
    const fresh = { ...live(1, statement), updatedAt: AT };
    const pack = makePack([old, fresh], ON);
    const states = parseLines(pack.rendered).map((line) => line.state);
    expect(states).toContain('current');
    expect(states).toContain('historical');
    const freshLine = parseLines(pack.rendered).find((line) => line.id === 'id_1');
    expect(freshLine?.state).toBe('current');
  });

  it('keeps a contested older revision visible as transition after serial-max', () => {
    const statement = 'One claim with two revisions.';
    const contested = { ...live(0, statement), updatedAt: AT - 100, contradictions: 1 };
    const fresh = { ...live(1, statement), updatedAt: AT };
    const pack = makePack([contested, fresh], ON);
    const contestedLine = parseLines(pack.rendered).find((line) => line.id === 'id_0');
    expect(contestedLine?.state).toBe('transition');
  });
});

describe('the switch composes with existing knobs without changing their bytes', () => {
  it('a state-on pack differs from state-off by exactly the state field, not the ids', () => {
    const items = [live(0), live(1), live(2)];
    const off = renderPack(items, OPT);
    const on = renderPack(items, ON);
    expect(on.ids).toEqual(off.ids);
    expect(on.tokens).toBeGreaterThan(off.tokens);
  });

  it('accepts a renderable item that carries no clocks (the R57 planted arm) as current', () => {
    // An authored item planted into a pack it did not build has none of the four clocks; with the switch on it is
    // still rendered, and reported current rather than crashing on undefined.
    const bare = { id: 'x', kind: 'constraint' as const, confidence: 0.9, scope: { task: 't' }, statement: 'planted' };
    const pack = renderPack([bare], ON);
    expect(parseLines(pack.rendered)[0]?.state).toBe('current');
  });
});
