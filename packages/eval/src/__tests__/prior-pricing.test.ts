/**
 * `eval:prior` had no failure mode, and that is what the review found.
 *
 * The command prices the only position for memory this repository has never put a number on:
 * memory judging a candidate rather than proposing one. It reads a recorded candidate pool and
 * compares a leave-one-fold-out prior against the first draw. On the committed artefact it printed
 * *this artefact predates the pool field, so there is nothing to look anything up in* and returned
 * zero — so an axis that has never been priced was indistinguishable, to a caller and to CI, from
 * an axis whose effect is nil.
 *
 * No committed artefact in this repository carries a pool. `poc-sota-bird-dev.json` is a two-arm
 * run (`none`, `full`) with no `pool` on any of its 1,534 cases, so the pricing command has never
 * had an input, has never run in CI, and has never said so. Every output-side claim that depends
 * on a pool — the oracle ceiling, "235 of 350 questions collapse to one answer", the selector
 * rankings — was measured in a run whose per-question candidates were not committed, which is the
 * one family in this repository that cannot be recomputed from a file.
 *
 * These cases fix the distinction the command was missing:
 *
 *   - **absence** — no artefact, no pool key, no key — is exit 2 and says `cannot price`;
 *   - **a nil reading** — a pool where every question has one candidate, so no scope offers a
 *     choice — is exit 0, because the subject was present and the answer is zero.
 *
 * That is defect 26 with the sign flipped: a check that passed on an absent input becomes a check
 * that fails on one, and the case that must keep exiting zero is the case that found something.
 *
 * R61 found a third state, and the first two cases below exist because of it. The lane writes
 * `pool: null` on every case of a run that bought no sampling arm, so the key *is* there and
 * `recorded` is true; the command read that as "a pool exists whose cases carry no database" and
 * exited 2. `arms` defaults to `gated,oracle`, which samples nothing, so the default BIRD dispatch
 * died at this step — `42524907557`, after 1,768 calls and 350 measured questions, delta -0.57pp.
 * The distinction that was missing is whether the file's own arm list says an arm was bought:
 * no arm recorded is a fact about the run (exit 0), an arm recorded with no candidate is a lane
 * that lost what it paid for (exit 2).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const BIN = join(ROOT, 'packages', 'eval', 'src', 'bin', 'prior.ts');

type Run = { readonly status: number; readonly stdout: string };

/** Run the command against a directory holding one artefact, and report what it said. */
function price(artefact: unknown | undefined): Run {
  const dir = mkdtempSync(join(tmpdir(), 'prior-'));
  if (artefact !== undefined) {
    writeFileSync(join(dir, 'poc-sota-bird.json'), JSON.stringify(artefact));
  }
  try {
    const stdout = execFileSync(TSX, [BIN], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, POC_RESULT_DIR: dir, SOTA_ARTEFACT: '' },
    });
    return { status: 0, stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    return { status: failed.status ?? -1, stdout: failed.stdout ?? '' };
  }
}

/** One question with a recorded pool of `draws` candidates, keyed the way the prior needs. */
function question(id: string, draws: number, over: Record<string, unknown> = {}) {
  return {
    id,
    question: 'How many accounts are there?',
    evidence: '',
    dbId: 'financial',
    fold: 0,
    pool: Array.from({ length: draws }, (_, draw) => ({
      draw,
      correct: draw === 0,
      resultKey: draw,
      signature: null,
    })),
    ...over,
  };
}

describe('eval:prior cannot report a price it never computed', () => {
  it('refuses when there is no artefact at all, rather than printing a stack trace', () => {
    const run = price(undefined);
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('cannot price: no artefact at');
  });

  it('refuses when the artefact carries no pool, which is every committed artefact', () => {
    // The shape of `poc-sota-bird-dev.json`: a two-arm run whose cases record no candidates.
    const run = price({
      id: 'poc-sota-bird-dev',
      config: { arms: ['none', 'full'] },
      per_case: [
        {
          id: 'q1',
          question: 'How many accounts are there?',
          dbId: 'financial',
          fold: 0,
        },
        { id: 'q2', question: 'List the cars.', dbId: 'cars', fold: 1 },
      ],
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('cannot price: the artefact carries no pool');
  });

  it('exits zero when the file says no sampling arm ran, because there is nothing to price', () => {
    // Exactly the shape `poc-sota-bird-R61-floor.json` uploaded: 350 cases, `pool: null` on every
    // one, and `config.arms` with no `sample-N` in it. The stage was not bought, and a run that did
    // not buy a stage is not a failed run.
    const run = price({
      id: 'poc-sota-bird',
      config: { arms: ['none', 'full', 'gated', 'oracle'] },
      per_case: [
        {
          id: 'q1',
          question: 'How many accounts are there?',
          dbId: 'financial',
          fold: 0,
          pool: null,
        },
        {
          id: 'q2',
          question: 'List the cars.',
          dbId: 'cars',
          fold: 1,
          pool: null,
        },
      ],
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no sampling arm ran');
    expect(run.stdout).not.toContain('cannot price');
  });

  it('refuses when an arm was recorded and the candidates did not survive', () => {
    // The mirror of the case above, and the one that must stay red: the arm list says a pool was
    // paid for, and every case is empty. Reading that as "no arm ran" would hide a lane losing the
    // data it bought — the failure mode a quiet step is worst at.
    const run = price({
      id: 'poc-sota-bird',
      config: { arms: ['none', 'full', 'sample-2-first'] },
      per_case: [
        {
          id: 'q1',
          question: 'How many accounts are there?',
          dbId: 'financial',
          fold: 0,
          pool: null,
        },
        {
          id: 'q2',
          question: 'List the cars.',
          dbId: 'cars',
          fold: 1,
          pool: null,
        },
      ],
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('cannot price: a sampling arm was recorded (2 draw(s))');
  });

  it('refuses when the pool exists but carries no key to look it up under', () => {
    const run = price({
      id: 'poc-sota-bird',
      config: { arms: ['sample-2-first'] },
      per_case: [question('q1', 2, { dbId: undefined, fold: undefined })],
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('cannot price: the pool carries no database or fold');
  });

  it('prices a keyed pool, so the refusal above is about the input and not about the command', () => {
    const run = price({
      id: 'poc-sota-bird',
      config: { arms: ['sample-2-first'] },
      per_case: [question('q1', 2), question('q2', 2), question('q3', 2)],
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('leave-one-fold-out');
    expect(run.stdout).not.toContain('cannot price');
  });

  it('exits zero on a pool whose draws all collapsed, because that is a finding', () => {
    // One candidate per question is an answer — the draws produced nothing to choose between —
    // and the axis has been priced at "no choice". Treating it as an absence would throw away the
    // reading this repository has already published as "235 of 350 collapse to the same answer".
    const run = price({
      id: 'poc-sota-bird',
      config: { arms: ['sample-1-first'] },
      per_case: [question('q1', 1), question('q2', 1)],
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no scope offered a choice to make');
  });
});
