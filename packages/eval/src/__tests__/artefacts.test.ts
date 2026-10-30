import { describe, expect, it } from 'vitest';
import {
  ARTEFACT_IDS,
  DEV_SPLIT_NAME,
  MINIDEV_SPLIT_NAME,
  artefactIdOf,
  artefactPathOf,
  chooseArtefact,
  splitNameOf,
} from '../artefacts.js';
import { publishedCell } from '../reproduction.js';

const DIR = '/repo/eval/results';

function present(...paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe('which artefact a split writes', () => {
  it('gives the two splits two files', () => {
    // One file rewritten is how the 350-question evidence would disappear the first time a
    // 1,534-question run happened, taking the recomputable half of the comparison table with it.
    expect(ARTEFACT_IDS.minidev).toBe('poc-sota-bird');
    expect(ARTEFACT_IDS.dev).toBe('poc-sota-bird-dev');
    expect(artefactIdOf('minidev')).not.toBe(artefactIdOf('dev'));
  });

  it('puts the artefact under the results directory', () => {
    expect(artefactPathOf(DIR, 'minidev')).toBe(`${DIR}/poc-sota-bird.json`);
    expect(artefactPathOf(DIR, 'dev')).toBe(`${DIR}/poc-sota-bird-dev.json`);
  });
});

describe('what a split calls itself', () => {
  it('names the dev split exactly as the published cell does', () => {
    // This equality is load-bearing: `compareCell` decides same-split by comparing these strings,
    // so a rename here silently downgrades every future reproduction to `indicative`. Asserting it
    // against the catalogue means the failure is a red test rather than a footnote.
    const cell = publishedCell('xiyan-deepseek-ddl');
    expect(cell).toBeDefined();
    expect(splitNameOf('dev')).toBe(cell?.split.name);
    expect(DEV_SPLIT_NAME).toBe('BIRD dev');
  });

  it('keeps the Mini-Dev slice distinguishable from dev', () => {
    // Two splits that share a name would both be judged same-split, and the 350-question run would
    // be reported as a reproduction of a 1,534-question cell.
    expect(splitNameOf('minidev')).toBe(MINIDEV_SPLIT_NAME);
    expect(splitNameOf('minidev')).not.toBe(splitNameOf('dev'));
  });
});

describe('which artefact a downstream lane reads', () => {
  it('honours an explicit absolute path', () => {
    const path = chooseArtefact({
      dir: DIR,
      explicit: '/tmp/run-1234/poc-sota-bird.json',
      exists: present(),
    });
    expect(path).toBe('/tmp/run-1234/poc-sota-bird.json');
  });

  it('resolves an explicit bare name against the results directory', () => {
    expect(chooseArtefact({ dir: DIR, explicit: 'poc-sota-bird-dev.json', exists: present() })).toBe(
      `${DIR}/poc-sota-bird-dev.json`,
    );
  });

  it('ignores an empty explicit value, which is how an unset workflow input arrives', () => {
    expect(chooseArtefact({ dir: DIR, explicit: '', exists: present(`${DIR}/poc-sota-bird.json`) })).toBe(
      `${DIR}/poc-sota-bird.json`,
    );
  });

  it('prefers Mini-Dev when both splits have run', () => {
    const both = present(`${DIR}/poc-sota-bird.json`, `${DIR}/poc-sota-bird-dev.json`);
    expect(chooseArtefact({ dir: DIR, explicit: undefined, exists: both })).toBe(
      `${DIR}/poc-sota-bird.json`,
    );
  });

  it('falls through to dev when it is the only run present', () => {
    // The case a dev-only dispatch produces: the Mini-Dev file was never committed, and a reader
    // that named it would print "no artefact" and exit zero while a valid run sat beside it.
    expect(chooseArtefact({ dir: DIR, explicit: undefined, exists: present(`${DIR}/poc-sota-bird-dev.json`) })).toBe(
      `${DIR}/poc-sota-bird-dev.json`,
    );
  });

  it('names the Mini-Dev file when neither exists, so the message quotes a path', () => {
    expect(chooseArtefact({ dir: DIR, explicit: undefined, exists: present() })).toBe(
      `${DIR}/poc-sota-bird.json`,
    );
  });
});
