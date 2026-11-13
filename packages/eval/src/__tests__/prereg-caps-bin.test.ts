import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The caps command, run as a command.
 *
 * `sota.yml` reads its two lines into `TAU_TRAIN_TASKS` and `TAU_TEST_TASKS`, so the command's output
 * shape *is* the contract: a registration that pins nothing has to print two empty lines, and a
 * registration that pins half of the pair has to refuse rather than let a repository variable decide
 * the other half. Both are properties of the process rather than of `readPrereg`, which is why they are
 * asserted by running it.
 */

const BIN = 'packages/eval/src/bin/prereg-caps.ts';

const HEADER = [
  '---',
  'id: R87-caps',
  // The header id must match the file's stem, so the fixture writes `R87-caps.md`.
  'step: R87',
  'opened: 2026-11-12',
  'arms: memory',
  'sample: 57',
  'gates: V1',
];
const BODY = [
  '',
  '## Prediction',
  '',
  '- the learning half produces enough calls to grade a distribution of codes',
  '',
  '## Refutation',
  '',
  '- fewer calls than the floor means the population arithmetic is wrong',
  '',
];

function file(extra: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'prereg-caps-'));
  const path = join(dir, 'R87-caps.md');
  writeFileSync(path, [...HEADER, ...extra, '---', ...BODY].join('\n'));
  return path;
}

/**
 * Run the command and keep both streams.
 *
 * `spawnSync` rather than `execFileSync` because the capacity note is a diagnostic on a *passing* run:
 * a harness that could only read stderr from a failure would be unable to tell "printed nothing" from
 * "exited before printing", which is the distinction the note exists to make.
 */
function run(path: string): { code: number; out: string; err: string } {
  const child = spawnSync('npx', ['tsx', BIN, path], { encoding: 'utf8' });
  return { code: child.status ?? 1, out: child.stdout ?? '', err: child.stderr ?? '' };
}

describe('prereg-caps', () => {
  it('prints both caps, one per line, for the two variables the workflow reads', () => {
    const result = run(file(['trainTasks: 57', 'testTasks: 1']));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=57\ntest=1\nceiling=\nbudget=\npin=\ntaskSplit=\nqueryPin=\nrelease=\n');
  });

  it('prints the record ceiling beside the caps, which is the switch R85 lacked', () => {
    // Three lines because there are three numbers, and the third one decides what the arm measures
    // rather than how much of the corpus it reads. A ceiling left in a repository variable is chosen
    // by the last dispatch; R85's own 700 is what that costs -- twelve of twelve records clipped.
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'rawCeiling: 2000']));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=57\ntest=1\nceiling=2000\nbudget=\npin=\ntaskSplit=\nqueryPin=\nrelease=\n');
  });

  it('prints one empty line per variable when the registration pins nothing, so the variables stand', () => {
    const result = run(file([]));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=\ntest=\nceiling=\nbudget=\npin=\ntaskSplit=\nqueryPin=\nrelease=\n');
  });

  it('prints the capacity the inherited budget implies, so the pair is visible in the dispatch log', () => {
    // R88's pair exactly: a 2,000-character ceiling over the lane's 1,200-character pack. The output
    // contract cannot carry it -- no workflow input reads a capacity -- but the log can, and the log is
    // read by whoever looks at a run that served one record out of twelve.
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'rawCeiling: 2000', 'distillUnit: raw']));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=57\ntest=1\nceiling=2000\nbudget=\npin=\ntaskSplit=\nqueryPin=\nrelease=\n');
    expect(result.err).toContain('ceiling 2000 is above budget 1200');
    expect(result.err).toContain('capacity is 810 chars/record');
  });

  it('prints the budget when the registration states one, and says the ceiling fits it', () => {
    const result = run(
      file([
        'trainTasks: 57',
        'testTasks: 1',
        'distillUnit: raw',
        'rawCeiling: 2000',
        'packBudget: 2400',
      ]),
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=57\ntest=1\nceiling=2000\nbudget=2400\npin=\ntaskSplit=\nqueryPin=\nrelease=\n');
    expect(result.err).toContain('ceiling 2000 fits budget 2400 (capacity 2010 chars/record)');
  });

  it('prints the store pin when the registration freezes its learn half', () => {
    // R91: the fifth line. A pin is a path in the checkout rather than a number, and the workflow joins
    // it to the workspace -- so the command's job is to say *which* file, once, on its own line.
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'storePin: eval/pins/r90-retail.json']));
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      'train=57\ntest=1\nceiling=\nbudget=\npin=eval/pins/r90-retail.json\ntaskSplit=\nqueryPin=\nrelease=\n',
    );
  });

  it('refuses a pin that points outside the pins directory', () => {
    // A header read by a paid dispatch must not be able to name a file from anywhere else: the
    // restriction is what keeps the list reviewable in a diff and what keeps a header from reaching
    // outside the checkout.
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'storePin: /etc/passwd']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("header 'storePin'");
    expect(result.err).toContain('is not a pin under eval/pins/');
  });

  it("prints the published split when the registration runs the benchmark's halves", () => {
    // R92: a sixth line. `official` is the only value, because a share by another name would move the
    // boundary the comparison against a competitor's number rests on.
    const result = run(file(['trainTasks: 74', 'testTasks: 40', 'taskSplit: official']));
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      'train=74\ntest=40\nceiling=\nbudget=\npin=\ntaskSplit=official\nqueryPin=\nrelease=\n',
    );
  });

  it('prints the release the number is about, which is the line a dispatch is held to', () => {
    // R92: the eighth line. The header is the decision and `vars.TAU_VERSION` is the machine; before this
    // line the only thing comparing them was a dispatch that installed the wrong release, built a store,
    // generated a corpus and died on a file the wrong release does not ship.
    const result = run(file(['trainTasks: 74', 'testTasks: 40', 'release: v1.0.1']));
    expect(result.code).toBe(0);
    expect(result.out).toContain('release=v1.0.1\n');
  });

  it('refuses a release that is not a tag, so nothing has to interpret it', () => {
    // `latest`, `v1.0` and a branch name are all claims the driver cannot hold a run to.
    const result = run(file(['release: latest']));
    expect(result.code).toBe(1);
    expect(result.err).toContain('is not a release tag');
  });

  it('prints the query pin when the registration holds the question fixed', () => {
    // R92: the seventh line, and the one a *pack* arm needs rather than a benchmark arm. A pack is a
    // function of (store, query, options); the first two now have a line each, so a dispatch can hold two
    // of its three inputs instead of one.
    const result = run(
      file([
        'trainTasks: 57',
        'testTasks: 1',
        'storePin: eval/pins/r90-retail.json',
        'queryPin: eval/pins/r92-retail-queries.json',
      ]),
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      'train=57\ntest=1\nceiling=\nbudget=\npin=eval/pins/r90-retail.json\ntaskSplit=\nqueryPin=eval/pins/r92-retail-queries.json\nrelease=\n',
    );
  });

  it('refuses a query pin that points outside the pins directory', () => {
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'queryPin: ../queries.json']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("header 'queryPin'");
    expect(result.err).toContain('is not a pin under eval/pins/');
  });

  it('refuses a split stated as a share rather than named', () => {
    const result = run(file(['trainTasks: 74', 'testTasks: 40', 'taskSplit: 0.6491']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("header 'taskSplit'");
    expect(result.err).toContain('is not one of official');
  });

  it('refuses half a pin instead of letting a variable decide the other half', () => {
    // The defect this removes, in the shape it would return: a registration that fixes the learning
    // half and leaves the evaluation to whichever dispatch ran last is a cost decided by history.
    const result = run(file(['trainTasks: 57']));
    expect(result.code).toBe(1);
    expect(result.err).toContain('declare trainTasks and testTasks together');
  });

  it('refuses a cap that is not a count of tasks, and says which header', () => {
    const result = run(file(['trainTasks: -1', 'testTasks: 1']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("header 'trainTasks'");
    expect(result.err).toContain('is not a count of tasks');
  });

  it('refuses to run without a file rather than printing an empty contract', () => {
    let code = 0;
    let err = '';
    try {
      execFileSync('npx', ['tsx', BIN], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      code = failure.status ?? 1;
      err = failure.stderr ?? '';
    }
    // An empty contract would silently leave both caps to the repository variables, which is the
    // state a registration exists to replace -- so the usage line is a refusal, not a help text.
    expect(code).toBe(1);
    expect(err).toContain('usage: pnpm eval:prereg-caps');
  });
});

describe('prereg-caps and a ceiling the pack cannot carry', () => {
  it('refuses the dispatch when both numbers are stated and they disagree', () => {
    // The one refusal this command makes about the pair. It is not the same finding as a ceiling over an
    // inherited budget — that one is a note, because the arms that predate the header keep their reading
    // — it is a registration that stated both and got the arithmetic wrong before paying for 228
    // episodes that would write records the renderer drops.
    const result = run(file(['trainTasks: 57', 'testTasks: 1', 'distillUnit: raw', 'rawCeiling: 2000', 'packBudget: 1200']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("at header 'rawCeiling'");
    expect(result.err).toContain('exceeds the 810 characters a 1200-character pack can carry');
  });
});
