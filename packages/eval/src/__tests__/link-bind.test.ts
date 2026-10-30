import { describe, expect, it } from 'vitest';
import {
  bindLinked,
  linkedCensus,
  linkTargetOf,
  transferLinked,
  typeFamily,
  type LinkedQuestion,
  type LinkTarget,
} from '../link-bind.js';
import type { TableShape } from '../sql-exec.js';
import { templateOf } from '../template.js';
import type { SchemaNames } from '../template.js';

const POSTS = `CREATE TABLE "posts" ("id" INTEGER, "displayname" TEXT, "price" TEXT, "acceptedanswerid" INTEGER)`;
const USERS = `CREATE TABLE "users" ("id" INTEGER, "displayname" TEXT, "reputation" INTEGER)`;
const BADGES = `CREATE TABLE "badges" ("id" INTEGER, "userid" INTEGER, "name" TEXT)`;
const ITEMS = `CREATE TABLE "items" ("id" INTEGER, "label" TEXT)`;
const PRODUCTS = `CREATE TABLE "products" ("id" INTEGER, "price" REAL)`;

function shape(table: string, columns: readonly (readonly [string, string])[]): TableShape {
  return { table, columns: columns.map(([name, type]) => ({ name, type })) };
}

const POSTS_SHAPE = shape('posts', [
  ['id', 'INTEGER'],
  ['displayname', 'TEXT'],
  ['price', 'TEXT'],
  ['acceptedanswerid', 'INTEGER'],
]);
const USERS_SHAPE = shape('users', [
  ['id', 'INTEGER'],
  ['displayname', 'TEXT'],
  ['reputation', 'INTEGER'],
]);
const BADGES_SHAPE = shape('badges', [
  ['id', 'INTEGER'],
  ['userid', 'INTEGER'],
  ['name', 'TEXT'],
]);

function names(shapes: readonly TableShape[]): SchemaNames {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const entry of shapes) {
    tables.add(entry.table);
    for (const column of entry.columns) columns.add(column.name);
  }
  return { tables, columns };
}

describe('typeFamily', () => {
  it('reads SQLite affinity rather than the exact spelling', () => {
    expect(typeFamily('INTEGER')).toBe('integer');
    expect(typeFamily('INT')).toBe('integer');
    expect(typeFamily('BIGINT')).toBe('integer');
    expect(typeFamily('VARCHAR(20)')).toBe('text');
    expect(typeFamily('TEXT')).toBe('text');
    expect(typeFamily('DATETIME')).toBe('temporal');
    expect(typeFamily('DATE')).toBe('temporal');
    expect(typeFamily('DECIMAL(10,2)')).toBe('real');
    expect(typeFamily('DOUBLE')).toBe('real');
    expect(typeFamily('BLOB')).toBe('blob');
  });

  it('treats an absent declaration as unknown rather than as a family', () => {
    // An untyped column is an absence of information; calling it `text` would make every rule about
    // an integer column disagree with it, which is a property of the dump rather than of the schema.
    expect(typeFamily('')).toBe('other');
    expect(typeFamily('   ')).toBe('other');
    expect(typeFamily('MONEY')).toBe('other');
  });
});

describe('linkTargetOf', () => {
  it('keeps the tables the link keeps and marks the ones the question names', () => {
    const ddl = [POSTS, USERS, BADGES].join('\n');
    const shapes = [POSTS_SHAPE, USERS_SHAPE, BADGES_SHAPE];
    const target = linkTargetOf(shapes, ddl, 'How many badges do users hold?', '');
    expect([...target.anchors].sort()).toEqual(['badges', 'users']);
    for (const table of target.anchors) expect(target.tables.map((entry) => entry.table)).toContain(table);
  });

  it('marks no anchor when the question names nothing, and keeps the whole schema', () => {
    const ddl = [POSTS, USERS].join('\n');
    const target = linkTargetOf([POSTS_SHAPE, USERS_SHAPE], ddl, 'How many rows are there?', '');
    expect(target.anchors.size).toBe(0);
    expect(target.tables).toHaveLength(2);
  });
});

describe('bindLinked', () => {
  const target: LinkTarget = { tables: [USERS_SHAPE, BADGES_SHAPE], anchors: new Set(['users', 'badges']) };

  it('binds a table slot to the name the linked set spells, and says so', () => {
    const template = templateOf('In users, displayname holds the name', names([USERS_SHAPE]));
    const outcome = bindLinked(template, [USERS_SHAPE], { tables: [USERS_SHAPE], anchors: new Set() });
    expect(outcome.status).toBe('bound');
    if (outcome.status !== 'bound') return;
    expect(outcome.statement).toBe('In users, displayname holds the name');
    expect(outcome.bindings.every((binding) => binding.via === 'name')).toBe(true);
  });

  it('binds a table slot to the table the question names, and scores the spelling at zero', () => {
    const template = templateOf('In posts, displayname holds the name', names([POSTS_SHAPE]));
    const only = { tables: [USERS_SHAPE], anchors: new Set(['users']) };
    const outcome = bindLinked(template, [POSTS_SHAPE], only);
    expect(outcome.status).toBe('bound');
    if (outcome.status !== 'bound') return;
    expect(outcome.statement).toBe('In users, displayname holds the name');
    const table = outcome.bindings.find((binding) => binding.slot.kind === 'table');
    expect(table).toEqual({ slot: { name: 'posts', kind: 'table' }, target: 'users', score: 0, via: 'link' });
  });

  it('prefers the shorter of several anchors, and withholds when two are equally short', () => {
    const shapes = [USERS_SHAPE, BADGES_SHAPE, shape('items', [['id', 'INTEGER'], ['label', 'TEXT']])];
    const template = templateOf('In posts, displayname holds the name', names([POSTS_SHAPE]));
    const shortest = bindLinked(template, [POSTS_SHAPE], {
      tables: shapes,
      anchors: new Set(['users', 'badges']),
    });
    expect(shortest.status).toBe('bound');
    if (shortest.status !== 'bound') return;
    expect(shortest.statement).toContain('In users,');

    // `users` and `items` are five letters each: nothing in the question says which one the slot is,
    // and an arbitrary pick is the guess this stage exists to avoid.
    const tie = bindLinked(template, [POSTS_SHAPE], {
      tables: shapes,
      anchors: new Set(['users', 'items']),
    });
    expect(tie).toEqual({ status: 'withheld', slot: { name: 'posts', kind: 'table' }, reason: 'table-tie' });
  });

  it('breaks a tie between equally good table names by the shorter name, then alphabetically', () => {
    // A role with two equally plausible referents is still a referent when the names tie on score:
    // the shorter name is the tie-break `template.ts` uses, and the alphabetical fallback keeps the
    // choice deterministic rather than dependent on the order a schema happened to be read in.
    const post = shape('post', [['id', 'INTEGER']]);
    const stats = shape('stats', [['id', 'INTEGER']]);
    const byLength = bindLinked(
      templateOf('In post_stats, every row is one post', names([shape('post_stats', [['id', 'INTEGER']])])),
      [shape('post_stats', [['id', 'INTEGER']])],
      { tables: [stats, post], anchors: new Set() },
    );
    expect(byLength.status).toBe('bound');
    if (byLength.status !== 'bound') return;
    // Both share one part with `post_stats`, so both score 0.5; `post` is shorter and wins.
    expect(byLength.bindings[0]).toMatchObject({ target: 'post', score: 0.5, via: 'name' });

    const post2 = shape('post', [['id', 'INTEGER']]);
    const meta = shape('meta', [['id', 'INTEGER']]);
    const byAlphabet = bindLinked(
      templateOf('In post_meta, every row is one post', names([shape('post_meta', [['id', 'INTEGER']])])),
      [shape('post_meta', [['id', 'INTEGER']])],
      { tables: [post2, meta], anchors: new Set() },
    );
    expect(byAlphabet.status).toBe('bound');
    if (byAlphabet.status !== 'bound') return;
    expect(byAlphabet.bindings[0]).toMatchObject({ target: 'meta', score: 0.5 });
  });

  it('breaks a tie between equally good column names the same way', () => {
    const wide = shape('wide', [
      ['unit_price', 'TEXT'],
      ['price_unit', 'TEXT'],
    ]);
    const template = templateOf('In posts, price is text', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [POSTS_SHAPE], { tables: [wide], anchors: new Set(['wide']) });
    expect(outcome.status).toBe('bound');
    if (outcome.status !== 'bound') return;
    // Both score 0.5 against `price` and both are ten characters, so the alphabet decides; the
    // statement proves which one was written into the sentence.
    expect(outcome.statement).toContain('price_unit');
  });

  it('withholds a table slot when the question names no table at all, and says why', () => {
    const template = templateOf('In posts, displayname holds the name', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [POSTS_SHAPE], { tables: [USERS_SHAPE], anchors: new Set() });
    expect(outcome).toEqual({ status: 'withheld', slot: { name: 'posts', kind: 'table' }, reason: 'no-table' });
  });

  it('separates a column the target does not have from one it has under another kind', () => {
    // The distinction is the one a reader needs to decide what to change: an absent column is a
    // vocabulary the memory cannot bridge, a present column of another kind is a rule that is simply
    // false there. They are counted apart because the repairs are different.
    const template = templateOf('In posts, acceptedanswerid is never null', names([POSTS_SHAPE]));
    const absent = bindLinked(template, [POSTS_SHAPE], { tables: [USERS_SHAPE], anchors: new Set(['users']) });
    expect(absent).toEqual({
      status: 'withheld',
      slot: { name: 'acceptedanswerid', kind: 'column' },
      reason: 'no-column',
    });
  });

  it('binds a column inside the table the template bound to', () => {
    const template = templateOf('In posts, displayname holds the name', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [POSTS_SHAPE], { tables: [USERS_SHAPE], anchors: new Set(['users']) });
    expect(outcome.status).toBe('bound');
    if (outcome.status !== 'bound') return;
    expect(outcome.statement).toBe('In users, displayname holds the name');
  });

  it('withholds when the column has the same name but a different kind', () => {
    // `price` is TEXT at home and REAL in the target: a rule about casting holds for one and not the
    // other, and showing it in the second database is a confident falsehood.
    const products = shape('products', [['id', 'INTEGER'], ['price', 'REAL']]);
    const template = templateOf('In posts, price is text and needs a cast', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [POSTS_SHAPE], {
      tables: [products],
      anchors: new Set(['products']),
    });
    expect(outcome).toEqual({ status: 'withheld', slot: { name: 'price', kind: 'column' }, reason: 'column-kind' });
  });

  it('searches the whole linked schema for a column when the rule names no table', () => {
    // A rule that names a column and no table is a claim about this database's vocabulary, so the
    // question's links are the namespace it meets — the same argument as the bound-table case, one
    // scope wider.
    const target = {
      tables: [shape('events', [['id', 'INTEGER'], ['acceptedanswerid', 'INTEGER']]), USERS_SHAPE],
      anchors: new Set(['events']),
    };
    const outcome = transferLinked('acceptedanswerid is never null', [POSTS_SHAPE], target);
    expect(outcome.status).toBe('bound');
    expect(outcome.status === 'bound' ? outcome.statement : '').toBe('acceptedanswerid is never null');
    expect(outcome.status === 'bound' ? outcome.bindings[0]?.slot.kind : '').toBe('column');
  });

  it('carries a statement that named nothing rather than calling it bound', () => {
    const template = templateOf('Prefer the second highest row', names([POSTS_SHAPE]));
    expect(bindLinked(template, [POSTS_SHAPE], target)).toEqual({
      status: 'slotless',
      statement: 'Prefer the second highest row',
    });
  });

  it('treats a home schema it cannot read as no type information rather than as a disagreement', () => {
    // A binder given a template but no home shape has nothing to compare kinds with; the documented
    // rule is that an unknown kind agrees with everything, so the name decides.
    const template = templateOf('In posts, displayname holds the name', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [], { tables: [USERS_SHAPE], anchors: new Set(['users']) });
    expect(outcome.status).toBe('bound');
    expect(outcome.status === 'bound' ? outcome.statement : '').toBe('In users, displayname holds the name');
  });

  it('never binds two slots of one template onto one column', () => {
    // Two names, one candidate: the second slot has nowhere to go, and a rename that maps both onto
    // one column would be a rewrite the rule never claimed.
    const narrow = shape('narrow', [['unit_price', 'TEXT']]);
    const home = shape('posts', [['id', 'INTEGER'], ['price', 'TEXT'], ['unit_price', 'TEXT']]);
    const template = templateOf('In posts, price and unit_price are the same column', names([home]));
    expect(template.slots).toHaveLength(3);
    const outcome = bindLinked(template, [home], { tables: [narrow], anchors: new Set(['narrow']) });
    expect(outcome.status).toBe('withheld');
  });

  it('never shows a half-bound statement', () => {
    const template = templateOf('In posts, acceptedanswerid is set when there is an answer', names([POSTS_SHAPE]));
    const outcome = bindLinked(template, [POSTS_SHAPE], { tables: [USERS_SHAPE], anchors: new Set(['users']) });
    expect(outcome.status).toBe('withheld');
    // The rejection names the slot that stopped it, so the artefact can count blockers by name.
    expect(outcome.status === 'withheld' ? outcome.slot.name : '').toBe('acceptedanswerid');
  });
});

describe('transferLinked', () => {
  it('reads the statement against its own schema and binds it against the target', () => {
    const outcome = transferLinked('In posts, displayname holds the name', [POSTS_SHAPE], {
      tables: [USERS_SHAPE],
      anchors: new Set(['users']),
    });
    expect(outcome.status).toBe('bound');
    expect(outcome.status === 'bound' ? outcome.statement : '').toBe('In users, displayname holds the name');
  });
});

describe('linkedCensus', () => {
  const rules = [
    { id: 'r1', statement: 'In posts, displayname holds the name', domain: 'codebase' },
    { id: 'r1', statement: 'In posts, displayname holds the name', domain: 'codebase' },
    { id: 'r2', statement: 'Prefer the second highest row', domain: 'codebase' },
    { id: 'r3', statement: 'In posting, acceptedanswerid is never null', domain: 'codebase' },
    { id: 'r4', statement: 'In posts, displayname holds the name', domain: null },
  ];
  const questions: LinkedQuestion[] = [
    { id: 'codebase#1', dbId: 'codebase', question: 'how many posts', evidence: '' },
    { id: 'forum#1', dbId: 'forum', question: 'how many users', evidence: '' },
    { id: 'forum#2', dbId: 'forum', question: 'how many rows are there', evidence: '' },
  ];
  const home = (dbId: string): readonly TableShape[] =>
    dbId === 'codebase' ? [POSTS_SHAPE] : dbId === 'forum' ? [USERS_SHAPE] : [];
  const linkOf = (question: LinkedQuestion): LinkTarget =>
    question.id === 'forum#1'
      ? { tables: [USERS_SHAPE], anchors: new Set(['users']) }
      : { tables: [USERS_SHAPE], anchors: new Set() };

  it('counts the family once, names what it could not place, and attempts only foreign questions', () => {
    const census = linkedCensus(rules, questions, home, linkOf);
    expect(census.rules).toBe(4);
    expect(census.duplicates).toBe(1);
    expect(census.homeless).toBe(1);
    // Two foreign questions per placed rule, never the rule's own database.
    expect(census.coverage.rules).toBe(3);
    expect(census.coverage.bound + census.coverage.slotless + census.coverage.withheld).toBe(6);
  });

  it('reports the attempt share the kill condition names and the rule share R10 reported', () => {
    const census = linkedCensus(rules, questions, home, linkOf);
    // `r1` binds on forum#1 and withholds on forum#2; `r2` is slotless everywhere; `r3` withholds
    // everywhere because `posting` is not a table and `acceptedanswerid` is not in the target.
    expect(census.coverage.bound).toBe(1);
    expect(census.coverage.slotless).toBe(2);
    expect(census.coverage.withheld).toBe(3);
    expect(census.withheldShare).toBe(0.5);
    expect(census.rulesBound).toBe(1);
    expect(census.rulesSlotless).toBe(1);
    expect(census.rulesWithheld).toBe(1);
    expect(Number(census.rulesWithheldShare.toFixed(4))).toBe(0.3333);
  });

  it('refuses a rule whose home database carries none of the questions instead of scoring it', () => {
    const census = linkedCensus(
      [{ id: 'r9', statement: 'In posts, displayname holds the name', domain: 'absent' }],
      questions,
      home,
      linkOf,
    );
    expect(census.unplaced).toBe(1);
    expect(census.coverage.bound + census.coverage.slotless + census.coverage.withheld).toBe(0);
    expect(census.withheldShare).toBe(0);
  });
});
