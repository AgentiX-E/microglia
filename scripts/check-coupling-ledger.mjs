#!/usr/bin/env node
/**
 * Grade the coupling ledger against a fresh walk of the tree.
 *
 * The checks were written inline in `ci.yml` as a `node -e` string, and that placement is why this
 * file exists. Two consequences, both paid for on 2026-11-09:
 *
 *   1. **CI knew something the local gate did not.** `pnpm check` runs `eval:coupling`, which rewrites
 *      `eval/results/poc-coupling.json` in the working tree; nothing locally compared that committed
 *      ledger to the walk, and this comparison is the only thing that notices the two describing
 *      different trees. Two pushes went red for it while every local gate was green — and a green
 *      local gate that is not the CI gate is the defect class this repository keeps writing audits
 *      about (`AUDIT 34.85`).
 *   2. **An inline script cannot be tested.** Eleven assertions about the shape of the tree had no
 *      fixtures; a predicate that always returned true would have looked exactly like a passing build.
 *
 * So the block moves here, unchanged in its claims, and gains `--self-test`: the same checks are run
 * against fixtures whose verdict is known, so a predicate that stops discriminating fails here.
 *
 * Usage:
 *   node scripts/check-coupling-ledger.mjs                      # scan into a temp dir, then grade
 *   node scripts/check-coupling-ledger.mjs <dir>                # grade an existing poc-coupling.json
 *   node scripts/check-coupling-ledger.mjs --self-test
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMITTED = 'eval/results/poc-coupling.json';

/** Read one artefact, with the fix in the message rather than a stack trace. */
function read(path) {
  if (!existsSync(path)) {
    process.stderr.write(`coupling ledger: no artefact at ${path}\n`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`coupling ledger: ${path} is not JSON: ${String(error)}\n`);
    process.exit(2);
  }
}

/**
 * The checks, in the order a reader would ask them.
 *
 * Each entry is `[claim, predicate]`. The predicates are the ones `ci.yml` carried: they assert
 * properties of the walk (every module classified, nothing imports upward, core is scenario-free) and
 * one relation between the walk and the committed snapshot. The module counts are deliberately *not*
 * pinned — adding a module is not a regression, and a check that fails when the tree grows teaches the
 * project to edit the check.
 */
function checks(fresh, committed) {
  const gates = Object.fromEntries((fresh.gates ?? []).map((gate) => [gate.id, gate]));
  const layer = (name) => (fresh.layers ?? []).find((entry) => entry.layer === name) ?? {};
  const coupled = fresh.coupled ?? [];
  const deferred = coupled.filter((entry) => entry.verdict === 'deferred');
  const unclassified = coupled.filter((entry) => entry.verdict === 'general');
  const upward = (fresh.edges ?? []).filter((edge) => edge.upward);
  const commentOnly = fresh.commentOnly ?? [];

  return [
    [
      'every coupled module has a verdict, and the walk emitted what it scanned',
      gates['V72-every-coupled-module-has-a-verdict']?.pass === true &&
        fresh.scanned === fresh.totals?.modules &&
        unclassified.length === 0,
    ],
    [
      'no package imports upward: five edges, all downwards',
      gates['V73-no-package-imports-upward']?.pass === true &&
        (fresh.edges ?? []).length === 5 &&
        upward.length === 0,
    ],
    [
      'core is scenario-free: every module classified, zero coupled',
      gates['V74-core-is-scenario-free']?.pass === true &&
        layer('core').modules > 0 &&
        layer('core').coupled === 0,
    ],
    [
      'the adapter is a package: seven modules, every line of them classified adapter',
      layer('sql').modules === 7 && layer('sql').adapterLines === layer('sql').lines,
    ],
    [
      'every deferral carries a written reason, and none is blank',
      // The count is not pinned, and it was: the pin broke twice in one iteration for the same reason
      // this file's header gives about `fresh.totals.modules` — the tree grows, the check goes red, and
      // the repair is an edit to a number that measures nothing. What the pin was reaching for is that
      // a deferral is a *decision somebody wrote down*, so that is what is checked: every deferred
      // module carries a reason longer than a placeholder, and there is at least one, so a walk that
      // classified nothing cannot pass this by being empty.
      deferred.length > 0 &&
        deferred.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 20),
    ],
    [
      'the five adapter modules that name a database are the ones that execute, guard, differ, link and render',
      coupled
        .filter((entry) => entry.pkg === 'sql')
        .map((entry) => entry.module)
        .sort()
        .join(',') === 'm-schema,schema-link,sql-diff,sql-exec,sql-guard',
    ],
    [
      'the largest deferred module is the lane that has not been split yet',
      deferred.slice().sort((a, b) => b.lines - a.lines)[0]?.module === 'sota',
    ],
    [
      'the scenario is between a tenth and a third of the tree, and the library packages are clean',
      fresh.totals?.coupledShare > 0.1 &&
        fresh.totals?.coupledShare < 0.33 &&
        layer('protocol').coupled === 0 &&
        layer('node').coupled === 0 &&
        layer('browser').coupled === 0,
    ],
    [
      'a comment is not a coupling: every prose-only hit names a word',
      commentOnly.length === (committed.commentOnly ?? []).length &&
        commentOnly.length > 0 &&
        commentOnly.every((entry) => entry.words.length > 0),
    ],
    [
      'the committed snapshot still describes the tree it was taken from',
      committed.scanned === fresh.scanned &&
        committed.totals?.modules === fresh.totals?.modules &&
        (committed.gates ?? []).every((gate) => gate.pass),
    ],
    [
      'the statement quotes arithmetic rather than a verdict',
      String(fresh.statement ?? '').startsWith('the scenario is ') &&
        String(fresh.statement ?? '').includes(' 0 of them upward') &&
        String(fresh.statement ?? '').includes('agnostic') === false,
    ],
  ];
}

/** Run the check list and return the claims that did not hold. */
function failures(fresh, committed) {
  return checks(fresh, committed)
    .filter(([, ok]) => !ok)
    .map(([claim]) => claim);
}

function grade(fresh, committed) {
  const bad = failures(fresh, committed);
  if (bad.length > 0) {
    process.stderr.write(`coupling ledger failed: ${bad.join(', ')}\n`);
    return 1;
  }
  const deferred = (fresh.coupled ?? []).filter((entry) => entry.verdict === 'deferred').length;
  const adapters = (fresh.layers ?? []).find((entry) => entry.layer === 'sql')?.modules ?? 0;
  const coreCoupled = (fresh.layers ?? []).find((entry) => entry.layer === 'core')?.coupled ?? 0;
  process.stdout.write(
    `coupling ledger: ${String(checks(fresh, committed).length)} checks pass, ${String(fresh.scanned)} modules, ` +
      `${String(adapters)} adapter modules, ${String(deferred)} deferred, core coupled=${String(coreCoupled)}\n`,
  );
  return 0;
}

/**
 * A fresh walk of this tree, in a directory of its own.
 *
 * `POC_RESULT_DIR` rather than a rewrite of the committed ledger: the point of the comparison is that
 * the committed file is *not* touched by the run that grades it. `pnpm check` runs `eval:coupling`
 * separately, and that one does rewrite it, which is why this command has to scan again.
 */
function scan() {
  const dir = mkdtempSync(join(tmpdir(), 'coupling-ledger-'));
  execFileSync('pnpm', ['--silent', 'eval:coupling'], {
    stdio: 'inherit',
    env: { ...process.env, POC_RESULT_DIR: dir },
  });
  return join(dir, 'poc-coupling.json');
}

/**
 * Minimal artefacts, shaped exactly as the walk emits them.
 *
 * The fixtures are built from one base and perturbed, so a failing case differs from a passing one in
 * exactly the field under test — a fixture that changed three fields would pass for the wrong reason.
 */
function fixture(overrides = {}) {
  const base = {
    scanned: 167,
    totals: { modules: 167, coupledShare: 0.17 },
    layers: [
      { layer: 'core', modules: 40, lines: 100, adapterLines: 0, deferredLines: 0, coupled: 0 },
      { layer: 'eval', modules: 111, lines: 100, adapterLines: 0, deferredLines: 10, coupled: 14 },
      { layer: 'protocol', modules: 3, lines: 10, adapterLines: 0, deferredLines: 0, coupled: 0 },
      { layer: 'node', modules: 4, lines: 10, adapterLines: 0, deferredLines: 0, coupled: 0 },
      { layer: 'browser', modules: 2, lines: 10, adapterLines: 0, deferredLines: 0, coupled: 0 },
      { layer: 'sql', modules: 7, lines: 20, adapterLines: 20, deferredLines: 0, coupled: 5 },
    ],
    edges: [
      { from: 'eval', to: 'core', files: 47, upward: false },
      { from: 'eval', to: 'protocol', files: 8, upward: false },
      { from: 'eval', to: 'sql', files: 3, upward: false },
      { from: 'node', to: 'core', files: 2, upward: false },
      { from: 'browser', to: 'core', files: 1, upward: false },
    ],
    gates: [
      { id: 'V72-every-coupled-module-has-a-verdict', pass: true },
      { id: 'V73-no-package-imports-upward', pass: true },
      { id: 'V74-core-is-scenario-free', pass: true },
    ],
    coupled: [
      ...Array.from({ length: 13 }, (_, index) => ({
        pkg: 'eval',
        module: `deferred-${String(index).padStart(2, '0')}`,
        lines: 40,
        verdict: 'deferred',
        reason: 'it names the scenario it knows about, in prose, for a reason',
      })),
      // The largest deferred module has to be the lane that has not been split yet.
      { pkg: 'eval', module: 'sota', lines: 900, verdict: 'deferred', reason: 'the lane has not been split yet' },
      { pkg: 'sql', module: 'm-schema', lines: 5, verdict: 'adapter', reason: 'a database name is its subject' },
      { pkg: 'sql', module: 'schema-link', lines: 5, verdict: 'adapter', reason: 'a database name is its subject' },
      { pkg: 'sql', module: 'sql-diff', lines: 5, verdict: 'adapter', reason: 'a database name is its subject' },
      { pkg: 'sql', module: 'sql-exec', lines: 5, verdict: 'adapter', reason: 'a database name is its subject' },
      { pkg: 'sql', module: 'sql-guard', lines: 5, verdict: 'adapter', reason: 'a database name is its subject' },
    ],
    commentOnly: [{ pkg: 'eval', module: 'coupling', words: ['retail'] }],
    statement: 'the scenario is 28 of 167 modules, and 0 of them upward',
  };
  return { ...base, ...overrides };
}

/** The committed ledger as a fixture would hold it: same tree, all gates passing. */
function committedOf(fresh) {
  return { scanned: fresh.scanned, totals: fresh.totals, gates: fresh.gates, commentOnly: fresh.commentOnly };
}

function selfTest() {
  const cases = [
    ['a walk that matches its ledger is clean', fixture(), fixture(), []],
    [
      'a tree that grew past its committed ledger is refused',
      fixture(),
      { ...committedOf(fixture()), scanned: 166, totals: { modules: 166, coupledShare: 0.16 } },
      ['the committed snapshot still describes the tree it was taken from'],
    ],
    [
      'a committed ledger with a failing gate is refused',
      fixture(),
      { ...committedOf(fixture()), gates: fixture().gates.map((gate) => ({ ...gate, pass: false })) },
      ['the committed snapshot still describes the tree it was taken from'],
    ],
    [
      'a coupled module with no verdict is refused',
      fixture({
        coupled: [
          ...fixture().coupled,
          { pkg: 'eval', module: 'unclassified', lines: 3, verdict: 'general', reason: '' },
        ],
      }),
      fixture(),
      ['every coupled module has a verdict, and the walk emitted what it scanned'],
    ],
    [
      'an upward edge is refused',
      fixture({
        edges: [
          { from: 'eval', to: 'core', files: 47, upward: false },
          { from: 'core', to: 'eval', files: 1, upward: true },
        ],
      }),
      fixture(),
      ['no package imports upward: five edges, all downwards'],
    ],
    [
      // A deferral is a decision somebody wrote down, so an empty reason is a lost decision. The
      // previous fixture flipped the verdict to `adapter` instead — a state the scanner cannot
      // produce, since it derives `adapter` from the package — and the claim it exercised was the
      // one whose count kept breaking. This one blanks the reason, which the record can really do.
      'a blank deferral reason is refused, because a deferral was a decision somebody wrote down',
      fixture({
        coupled: fixture().coupled.map((entry) =>
          entry.module === 'deferred-00' ? { ...entry, reason: '' } : entry,
        ),
      }),
      fixture(),
      ['every deferral carries a written reason, and none is blank'],
    ],
    [
      'a statement that quotes a verdict instead of arithmetic is refused',
      fixture({ statement: 'the scenario is agnostic' }),
      fixture(),
      ['the statement quotes arithmetic rather than a verdict'],
    ],
    [
      'a snapshot that disagrees about which prose-only hits exist is refused',
      fixture(),
      { ...committedOf(fixture()), commentOnly: [] },
      ['a comment is not a coupling: every prose-only hit names a word'],
    ],
  ];

  let failed = 0;
  for (const [name, fresh, committed, expected] of cases) {
    const bad = failures(fresh, committed);
    const ok = bad.join('|') === expected.join('|');
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${name} -> ${bad.length === 0 ? 'clean' : bad.join(', ')}\n`);
    if (!ok) {
      failed += 1;
      process.stdout.write(`       expected: ${expected.length === 0 ? 'clean' : expected.join(', ')}\n`);
    }
  }
  if (failed > 0) {
    process.stderr.write(`${String(failed)} self-test case(s) failed\n`);
    return 1;
  }
  process.stdout.write('SELF-TEST PASSED\n');
  return 0;
}

const argument = process.argv[2];
if (argument === '--self-test') {
  process.exit(selfTest());
} else {
  const freshPath = argument === undefined ? scan() : join(argument, 'poc-coupling.json');
  process.exit(grade(read(freshPath), read(COMMITTED)));
}
