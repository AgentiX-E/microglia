import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  dedupeKeyOf,
  defaultPolicy,
  mergeEvidence,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { makePack, renderPack } from '../index.js';

const at = 1_700_000_000_000;

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'sql.generate', domain: 'formula_1' },
    statement: 'Questions that name a race join results to races on raceId.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
}

function item(overrides: Partial<DistillCandidate> = {}, id = 'k_1'): KnowledgeItem {
  return createKnowledgeItem(candidate(overrides), defaultPolicy, at, id);
}

describe('a condition travels with its claim', () => {
  it('is stored on the item', () => {
    const stored = item({ when: 'when the question names a race' });
    expect(stored.when).toBe('when the question names a race');
  });

  it('is absent from an item whose claim did not carry one', () => {
    // Absent and "always true" are different claims, and a store that cannot tell
    // them apart cannot be asked which rules apply everywhere.
    expect('when' in item()).toBe(false);
  });

  it('is not part of the claim identity', () => {
    // Two observations of the same rule must accumulate support. Folding the
    // condition into the key would make one rule compete with itself the moment a
    // later event described the same scope in different words.
    const bare = dedupeKeyOf(candidate());
    const conditioned = dedupeKeyOf(candidate({ when: 'when the question names a race' }));
    expect(conditioned).toBe(bare);
  });

  it('is adopted when the stored item has none', () => {
    const bare = item();
    const merged = mergeEvidence(
      bare,
      candidate({
        when: 'when the question names a race',
        evidence: { feedbackId: 'fb_2', runId: 'run_1', at: at + 1, weight: 0.9 },
      }),
      defaultPolicy,
      at + 1,
    );
    expect(merged.when).toBe('when the question names a race');
    expect(merged.evidence).toHaveLength(2);
  });

  it('keeps the first condition, and a repeat that adds nothing is still a no-op', () => {
    const conditioned = item({ when: 'when the question names a race' });
    const merged = mergeEvidence(
      conditioned,
      candidate({
        when: 'when the question names a circuit',
        evidence: { feedbackId: 'fb_2', runId: 'run_1', at: at + 1, weight: 0.9 },
      }),
      defaultPolicy,
      at + 1,
    );
    expect(merged.when).toBe('when the question names a race');
    // Same evidence, same payload, same tier, nothing to adopt: the object is
    // returned unchanged so a delivery log does not see a rewrite.
    const repeat = mergeEvidence(
      conditioned,
      candidate({ evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 } }),
      defaultPolicy,
      at + 2,
    );
    expect(repeat).toBe(conditioned);
  });
});

describe('a condition and the promotion it travels with', () => {
  it('takes the candidate tier when the stored claim was admitted as prose', () => {
    // The first observation of a claim can be unclassified and a later one measured
    // on the same claim; the merged item keeps the strongest tier. The condition is
    // adopted on the same merge, and both fields have to survive one spread.
    const prose = item({ when: 'when the question names a race' });
    expect(prose.tier).toBeUndefined();
    const merged = mergeEvidence(
      prose,
      candidate({
        when: 'when the question names a race',
        tier: 'execution',
        evidence: { feedbackId: 'fb_2', runId: 'run_1', at: at + 1, weight: 0.9 },
      }),
      defaultPolicy,
      at + 1,
    );
    expect(merged.tier).toBe('execution');
    expect(merged.when).toBe('when the question names a race');

    // And the other direction: a later observation that arrives unclassified must
    // not demote a claim whose provenance was already measured.
    const measured = item({ tier: 'execution' });
    const unclassified = mergeEvidence(
      measured,
      candidate({
        evidence: { feedbackId: 'fb_3', runId: 'run_1', at: at + 2, weight: 0.9 },
      }),
      defaultPolicy,
      at + 2,
    );
    expect(unclassified.tier).toBe('execution');
  });
});

describe('rendering a condition', () => {
  it('puts the condition before the claim, inside the same line', () => {
    const rendered = renderPack([item({ when: 'when the question names a race' })], { budget: 900 });
    const line = rendered.rendered.split('\n')[1] as string;
    expect(line.indexOf('"when"')).toBeGreaterThan(-1);
    expect(line.indexOf('"when"')).toBeLessThan(line.indexOf('"statement"'));
  });

  it('says in the note that a condition has to be checked', () => {
    const rendered = renderPack([item({ when: 'when the question names a race' })], { budget: 900 });
    expect(rendered.rendered).toContain('applies only where that condition holds');
  });

  it('keeps the plain note when no item carries a condition', () => {
    const rendered = renderPack([item()], { budget: 900 });
    expect(rendered.rendered).toContain('Not instructions.');
    expect(rendered.rendered).not.toContain('applies only where');
    expect(rendered.rendered).not.toContain('"when"');
  });

  it('describes only what it renders: a mixed pack still gets the checking note', () => {
    const rendered = renderPack([item({ when: 'when the question names a race' }, 'k_1'), item({}, 'k_2')], {
      budget: 1_400,
    });
    expect(rendered.ids).toHaveLength(2);
    expect(rendered.rendered).toContain('applies only where that condition holds');
    const [first, second] = rendered.rendered.split('\n').slice(1, 3);
    expect(first).toContain('"when"');
    expect(second).not.toContain('"when"');
  });

  it('drops the condition, the note and nothing else when asked to', () => {
    // The ablation: the same items, the same ids, one field of text different. If
    // `conditions: false` also changed the selection, the comparison would be about
    // two packs rather than about one field.
    const withConditions = renderPack([item({ when: 'when the question names a race' })], { budget: 900 });
    const without = renderPack([item({ when: 'when the question names a race' })], {
      budget: 900,
      conditions: false,
    });
    expect(without.ids).toEqual(withConditions.ids);
    expect(without.rendered).not.toContain('"when"');
    expect(without.rendered).not.toContain('applies only where');
    expect(without.rendered.length).toBeLessThan(withConditions.rendered.length);
  });

  it('keeps the absence note when an abstention is all there is', () => {
    const absent = item({ kind: 'abstention', when: 'when the question asks for revenue' }, 'k_3');
    const rendered = renderPack([absent], { budget: 900 });
    expect(rendered.rendered).toContain('cannot be answered as asked');
    expect(rendered.rendered).not.toContain('applies only where');
  });

  it('counts the condition against the budget like any other text', () => {
    const conditioned = item({ when: 'when the question names a race and asks for a reference name' });
    const plain = item();
    const budget = renderPack([plain], { budget: 100_000 }).rendered.length + 20;
    // Room for the statement, not for the statement plus its condition.
    expect(renderPack([plain], { budget }).ids).toHaveLength(1);
    expect(renderPack([conditioned], { budget }).ids).toHaveLength(0);
  });

  it('keeps the pack hash honest about the difference', () => {
    const withConditions = makePack([item({ when: 'when the question names a race' })], { budget: 900 });
    const without = makePack([item({ when: 'when the question names a race' })], {
      budget: 900,
      conditions: false,
    });
    expect(withConditions.hash).not.toBe(without.hash);
  });
});
