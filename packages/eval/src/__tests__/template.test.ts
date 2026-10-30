import { describe, expect, it } from 'vitest';
import {
  bindTemplate,
  bindingCensus,
  injectionFormOf,
  nameScore,
  templateCoverage,
  templateOf,
  transferStatement,
  type SchemaNames,
  type TemplateAttempt,
} from '../template.js';

function names(columns: readonly string[], tables: readonly string[] = []): SchemaNames {
  return { columns: new Set(columns), tables: new Set(tables) };
}

describe('templateOf', () => {
  it('lifts a column out of the sentence and leaves the rest of the prose alone', () => {
    const template = templateOf('Cast price to real before comparing it to a number', names(['price']));
    expect(template.text).toBe('Cast {price} to real before comparing it to a number');
    expect(template.slots).toEqual([{ name: 'price', kind: 'column' }]);
  });

  it('lifts a table, and prefers the column when one name is both', () => {
    expect(templateOf('Join with rank', names([], ['rank'])).slots).toEqual([{ name: 'rank', kind: 'table' }]);
    expect(templateOf('Join with rank', names(['rank'], ['rank'])).slots).toEqual([
      { name: 'rank', kind: 'column' },
    ]);
  });

  it('leaves a word the schema does not have, because there is nothing to bind it to', () => {
    const template = templateOf('Prefer the second highest row', names(['price']));
    expect(template.text).toBe('Prefer the second highest row');
    expect(template.slots).toEqual([]);
  });

  it('records one slot per name however often the name is said, and replaces every occurrence', () => {
    const template = templateOf('When price is text, cast price', names(['price']));
    expect(template.text).toBe('When {price} is text, cast {price}');
    expect(template.slots).toEqual([{ name: 'price', kind: 'column' }]);
  });

  it('matches case-insensitively and stores the schema spelling', () => {
    const template = templateOf('Cast Price AS REAL', names(['price']));
    expect(template.text).toBe('Cast {price} AS REAL');
  });

  it('ignores names too short to be identifiers', () => {
    const template = templateOf('Cast id AS REAL', names(['id']));
    expect(template.text).toBe('Cast id AS REAL');
    expect(template.slots).toEqual([]);
  });
});

describe('nameScore', () => {
  it('scores identity at one and no shared part at zero', () => {
    expect(nameScore('price', 'price')).toBe(1);
    expect(nameScore('price', 'prize')).toBe(0);
  });

  it('scores a shared part by Jaccard, so a compound name is half a match', () => {
    expect(nameScore('price', 'unit_price')).toBeCloseTo(0.5, 10);
    expect(nameScore('unit_price', 'unit_price_usd')).toBeCloseTo(2 / 3, 10);
  });
});

describe('bindTemplate', () => {
  it('binds an identical name at full score and rewrites the statement', () => {
    const template = templateOf('Cast price to real', names(['price']));
    const binding = bindTemplate(template, names(['price'], ['sales']));
    expect(binding.ok).toBe(true);
    expect(binding).toMatchObject({ statement: 'Cast price to real' });
    expect(binding.ok && binding.bindings).toEqual([
      { slot: { name: 'price', kind: 'column' }, target: 'price', score: 1, via: 'name' },
    ]);
  });

  it('binds the target schema vocabulary in place of the source one', () => {
    const template = templateOf('Cast price to real', names(['price']));
    const binding = bindTemplate(template, names(['unit_price'], ['sales']));
    expect(binding.ok && binding.statement).toBe('Cast unit_price to real');
  });

  it('withholds a template whose slot has no referent at all', () => {
    const template = templateOf('Cast price to real', names(['price']));
    const binding = bindTemplate(template, names(['rating'], ['sales']));
    expect(binding.ok).toBe(false);
    expect(binding.ok === false && binding.slot).toEqual({ name: 'price', kind: 'column' });
  });

  it('withholds when the closest candidate shares too little of the name', () => {
    const template = templateOf('Cast price to real', names(['price']));
    // `prices` is one part against one part, but the parts differ, so the score is zero.
    expect(bindTemplate(template, names(['prices'])).ok).toBe(false);
  });

  it('breaks a tie by the shorter name, then lexicographically', () => {
    const template = templateOf('Cast price to real', names(['price']));
    // Both candidates score 0.5 against `price`; the shorter one adds least to what the rule said.
    const short = bindTemplate(template, names(['unit_price', 'price_us']));
    expect(short.ok && short.bindings[0]?.target).toBe('price_us');
    const equal = bindTemplate(template, names(['price_a', 'price_b']));
    expect(equal.ok && equal.bindings[0]?.target).toBe('price_a');
  });

  it('never binds two slots onto one candidate', () => {
    const template = templateOf('Compare price with cost', names(['price', 'cost']));
    // Only one column exists, and it can only stand for one of the two slots.
    const binding = bindTemplate(template, names(['price']));
    expect(binding.ok).toBe(false);
  });

  it('binds a table slot only to a table', () => {
    const template = templateOf('Count rows of frpm', names([], ['frpm']));
    expect(bindTemplate(template, names(['frpm'])).ok).toBe(false);
    expect(bindTemplate(template, names([], ['frpm_enrollment'])).ok).toBe(true);
  });
});

describe('transferStatement', () => {
  it('reports a rule with no schema identifier as slotless rather than bound', () => {
    const outcome = transferStatement('Take the second highest value', names(['price']), names(['cost']));
    expect(outcome).toEqual({ status: 'slotless', statement: 'Take the second highest value' });
  });

  it('reports the bound statement when every slot binds', () => {
    const outcome = transferStatement('Cast price to real', names(['price']), names(['unit_price']));
    expect(outcome).toEqual({
      status: 'bound',
      statement: 'Cast unit_price to real',
      bindings: [{ slot: { name: 'price', kind: 'column' }, target: 'unit_price', score: 0.5, via: 'name' }],
    });
  });

  it('withholds the rule rather than showing it unbound', () => {
    const outcome = transferStatement('Cast price to real', names(['price']), names(['rating']));
    expect(outcome).toEqual({ status: 'withheld', slot: { name: 'price', kind: 'column' } });
  });
});

describe('templateCoverage', () => {
  const bound = { status: 'bound', statement: 'x', bindings: [] } as const;
  const slotless = { status: 'slotless', statement: 'x' } as const;
  const withheld = { status: 'withheld', slot: { name: 'price', kind: 'column' } } as const;

  it('counts attempts, not trials, and reports the share that could not bind', () => {
    const attempts: TemplateAttempt[] = [
      { key: 'r1\u0000db_a', outcome: bound },
      { key: 'r1\u0000db_b', outcome: slotless },
      { key: 'r2\u0000db_a', outcome: withheld },
      // The same attempt reported once per trial must not become two attempts.
      { key: 'r2\u0000db_a', outcome: withheld },
    ];
    const coverage = templateCoverage(attempts);
    expect(coverage).toMatchObject({
      bound: 1,
      slotless: 1,
      withheld: 1,
      rules: 2,
    });
    expect(coverage.withheldShare).toBeCloseTo(1 / 3, 10);
    expect(coverage.blockers).toEqual([{ name: 'price', kind: 'column', attempts: 1 }]);
  });

  it('names the blockers, most blocking first and alphabetically on a tie', () => {
    const coverage = templateCoverage([
      { key: 'r1\u0000a', outcome: { status: 'withheld', slot: { name: 'zeta', kind: 'column' } } },
      { key: 'r2\u0000a', outcome: { status: 'withheld', slot: { name: 'alpha', kind: 'table' } } },
      { key: 'r3\u0000a', outcome: { status: 'withheld', slot: { name: 'alpha', kind: 'table' } } },
      { key: 'r4\u0000a', outcome: { status: 'withheld', slot: { name: 'beta', kind: 'column' } } },
    ]);
    expect(coverage.blockers).toEqual([
      { name: 'alpha', kind: 'table', attempts: 2 },
      { name: 'beta', kind: 'column', attempts: 1 },
      { name: 'zeta', kind: 'column', attempts: 1 },
    ]);
  });

  it('reports zero rather than a division when nothing was attempted', () => {
    expect(templateCoverage([])).toEqual({
      bound: 0,
      slotless: 0,
      withheld: 0,
      rules: 0,
      withheldShare: 0,
      blockers: [],
      reasons: [],
    });
  });
});

describe('bindingCensus', () => {
  const schemas: Record<string, SchemaNames> = {
    db_a: names(['price'], ['sales']),
    db_b: names(['unit_price'], ['orders']),
    db_c: names(['rating'], ['reviews']),
  };
  const lookup = (dbId: string): SchemaNames => schemas[dbId] as SchemaNames;

  it('counts a rule once and an attempt per foreign database', () => {
    const census = bindingCensus(
      [{ id: 'r1', statement: 'Cast price to real', domain: 'db_a' }],
      ['db_a', 'db_b', 'db_c'],
      lookup,
    );
    // One rule, two foreign databases: it binds in db_b and has nothing to bind in db_c.
    expect(census.rulesBound).toBe(1);
    expect(census.coverage.bound).toBe(1);
    expect(census.coverage.withheld).toBe(1);
    expect(census.coverage.blockers).toEqual([{ name: 'price', kind: 'column', attempts: 1 }]);
  });

  it('separates a rule with no home database from one the binder failed on', () => {
    const census = bindingCensus(
      [
        { id: 'r1', statement: 'Cast price to real', domain: null },
        { id: 'r2', statement: 'Cast price to real', domain: 'db_elsewhere' },
      ],
      ['db_a', 'db_b'],
      lookup,
    );
    expect(census.homeless).toBe(1);
    expect(census.unplaced).toBe(1);
    expect(census.coverage.bound + census.coverage.withheld + census.coverage.slotless).toBe(0);
    // Nothing was attempted, so the share is zero rather than a division by nothing.
    expect(census.withheldShare).toBe(0);
  });

  it('calls a rule unplaced when there is nowhere else to show it', () => {
    const census = bindingCensus(
      [{ id: 'r1', statement: 'Cast price to real', domain: 'db_a' }],
      ['db_a'],
      lookup,
    );
    expect(census.unplaced).toBe(1);
    expect(census.rulesBound).toBe(0);
  });

  it('counts a rule with no schema identifier as slotless rather than withheld', () => {
    const census = bindingCensus(
      [{ id: 'r1', statement: 'Take the second highest value', domain: 'db_a' }],
      ['db_a', 'db_b'],
      lookup,
    );
    expect(census.rulesSlotless).toBe(1);
    expect(census.withheldShare).toBe(0);
  });

  it('collapses a store that lists one rule per fold, because five folds are one rule', () => {
    const census = bindingCensus(
      [
        { id: 'r1', statement: 'Cast price to real', domain: 'db_a' },
        { id: 'r1', statement: 'Cast price to real', domain: 'db_a' },
      ],
      ['db_a', 'db_b'],
      lookup,
    );
    expect(census.rules).toBe(1);
    expect(census.duplicates).toBe(1);
    expect(census.coverage.bound).toBe(1);
  });

  it('reads the kill condition over rules, so one lucky database does not save the family', () => {
    const census = bindingCensus(
      [
        { id: 'r1', statement: 'Cast price to real', domain: 'db_a' },
        { id: 'r2', statement: 'Count the school ranks', domain: 'db_a' },
      ],
      ['db_a', 'db_c'],
      lookup,
    );
    // r1 binds nowhere (db_c has no price-like column) and r2 names nothing in db_a's schema.
    expect(census.rulesWithheld).toBe(1);
    expect(census.rulesSlotless).toBe(1);
    expect(census.withheldShare).toBe(0.5);
  });
});

describe('injectionFormOf', () => {
  it('defaults to the incumbent form, so a silent dispatch repeats R9.4', () => {
    expect(injectionFormOf(undefined)).toBe('prose');
    expect(injectionFormOf('')).toBe('prose');
    expect(injectionFormOf('prose')).toBe('prose');
  });

  it('reads the new form', () => {
    expect(injectionFormOf('bound')).toBe('bound');
  });

  it('refuses an unknown form instead of falling back to one', () => {
    expect(() => injectionFormOf('templated')).toThrow(RangeError);
  });
});
