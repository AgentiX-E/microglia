/**
 * The scope census: how much of a store says where its rules apply.
 *
 * The tests are written against the three states rather than against the arithmetic alone, because
 * the arithmetic is only meaningful once the state says it may be read. Two of them are the same
 * mistake this project has already paid for once — reading a projection's silence as a value — so
 * they are asserted as refusals: a dump that does not say what it carried is `unavailable`, and a
 * record with no scope object is counted as `unscoped` rather than as the widest possible rule.
 */
import { describe, expect, it } from 'vitest';
import { SCOPE_DIMS, carriedDims, scopeCensus } from '../scope-census.js';
import type { StoreDumpItem } from '../retrospect-store.js';

const all = SCOPE_DIMS;

const item = (scope: StoreDumpItem['scope']): StoreDumpItem => ({
  id: 'k1',
  statement: 'when the invoice is disputed, hold the refund',
  ...(scope === undefined ? {} : { scope }),
});

describe('refusals', () => {
  it('refuses to read a dump that does not say which dimensions it carried', () => {
    const census = scopeCensus([item({ task: 'retail' })], { carried: [] });
    expect(census.state).toBe('unavailable');
    expect(census.sentence).toContain('does not say which scope dimensions it carried');
    // Not zero: a refusal carries no counts, so nothing downstream can quote one as a measurement.
    expect(census.broad).toBe(0);
    expect(census.bySpecificity).toEqual({});
  });

  it('reports a store with no readable scope as empty rather than as infinitely wide', () => {
    const census = scopeCensus([item(undefined), item(undefined)], { carried: all });
    expect(census.state).toBe('empty');
    expect(census.unscoped).toBe(2);
    expect(census.scoped).toBe(0);
    expect(census.broadShare).toBe(0);
    expect(census.sentence).toContain('none of them carries a readable scope');
  });

  it('counts a scope with no task as malformed, because it cannot be placed at all', () => {
    const census = scopeCensus([item({ domain: 'sales' }), item({ task: '   ' })], { carried: all });
    expect(census.malformed).toBe(2);
    expect(census.scoped).toBe(0);
    expect(census.state).toBe('empty');
  });
});

describe('reading the width', () => {
  it('reads a task-only scope as the widest rule microglia can store', () => {
    const census = scopeCensus([item({ task: 'retail' })], { carried: all });
    expect(census.state).toBe('read');
    expect(census.broad).toBe(1);
    expect(census.broadShare).toBe(1);
    expect(census.bySpecificity).toEqual({ 1: 1 });
    for (const dim of all) {
      expect(census.declared[dim]).toBe(0);
      expect(census.open[dim]).toBe(1);
    }
  });

  it('reads a fully declared scope as specificity six', () => {
    const census = scopeCensus(
      [
        item({
          task: 'retail',
          domain: 'orders',
          schemaDigest: 'abc',
          intent: 'refund',
          field: 'status',
          reasonCode: 'disputed',
        }),
      ],
      { carried: all },
    );
    expect(census.bySpecificity).toEqual({ 6: 1 });
    expect(census.broad).toBe(0);
    for (const dim of all) {
      expect(census.declared[dim]).toBe(1);
      expect(census.open[dim]).toBe(0);
    }
  });

  it('separates declared from open per dimension, and keeps the two populations at one total', () => {
    const census = scopeCensus(
      [
        item({ task: 'retail', domain: 'orders', intent: 'refund' }),
        item({ task: 'retail', domain: 'hr' }),
        item({ task: 'retail' }),
      ],
      { carried: all },
    );
    expect(census.scoped).toBe(3);
    expect(census.declared.domain).toBe(2);
    expect(census.open.domain).toBe(1);
    expect(census.declared.intent).toBe(1);
    expect(census.open.intent).toBe(2);
    // `schemaDigest`, `field` and `reasonCode` are declared by nobody, so they are open on all three.
    expect(census.open.field).toBe(3);
    expect(census.bySpecificity).toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(census.broad).toBe(1);
    expect(census.broadShare).toBeCloseTo(1 / 3, 10);
  });

  it('names the widest dimension left open, so the sentence points at one field', () => {
    const census = scopeCensus(
      [item({ task: 'retail', domain: 'orders' }), item({ task: 'retail' })],
      { carried: ['domain', 'intent'] },
    );
    // intent is open on both, domain on one: the sentence must name intent.
    expect(census.sentence).toContain('`intent` at 1.0000');
  });

  it('says what it skipped when some records could not be read at all', () => {
    const census = scopeCensus(
      [item({ task: 'retail' }), item(undefined), item({ intent: 'refund' })],
      { carried: all },
    );
    expect(census.scoped).toBe(1);
    expect(census.unscoped).toBe(1);
    expect(census.malformed).toBe(1);
    expect(census.sentence).toContain('1 record(s) carry no scope at all and 1 name no task');
  });

  it('does not mention skipped records when every record was read', () => {
    const census = scopeCensus([item({ task: 'retail' })], { carried: all });
    expect(census.sentence).not.toContain('counted and not read');
  });
});

describe('the carried list is a boundary, not a hint', () => {
  it('counts only the dimensions it was told the dump carried', () => {
    const census = scopeCensus([item({ task: 'retail', domain: 'orders', intent: 'refund' })], {
      carried: ['domain'],
    });
    // intent is present in the record but not carried by the dump, so it is not a declared
    // dimension of this reading and specificity is task + domain.
    expect(census.bySpecificity).toEqual({ 2: 1 });
    expect(census.declared.domain).toBe(1);
    expect(census.declared.intent).toBe(0);
    expect(census.open.intent).toBe(0);
  });

  it('does not let a dimension the dump never carried read as open', () => {
    const census = scopeCensus([item({ task: 'retail' })], { carried: ['domain'] });
    expect(census.open.domain).toBe(1);
    expect(census.open.schemaDigest).toBe(0);
  });
});

describe('narrowing a declared dimension list', () => {
  it('keeps the dimensions this build knows, in canonical order', () => {
    expect(carriedDims(['intent', 'task', 'domain'])).toEqual(['domain', 'intent']);
  });

  it('ignores a dimension a later build added instead of refusing the whole list', () => {
    // Forward compatibility: an unknown name must not make the four known ones unreadable, or a
    // dump written by a newer build becomes undocumentable in this one.
    expect(carriedDims(['domain', 'tenant', 'field'])).toEqual(['domain', 'field']);
  });

  it('answers with nothing when the dump declared nothing', () => {
    expect(carriedDims(undefined)).toEqual([]);
    expect(carriedDims([])).toEqual([]);
    // And nothing is what makes the census refuse rather than assume all six.
    expect(scopeCensus([item({ task: 'retail' })], { carried: carriedDims(undefined) }).state).toBe(
      'unavailable',
    );
  });
});
