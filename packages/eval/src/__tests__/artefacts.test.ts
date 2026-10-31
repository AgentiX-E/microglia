import { describe, expect, it } from 'vitest';
import {
  ARTEFACT_IDS,
  DEV_SPLIT_NAME,
  MINIDEV_SPLIT_NAME,
  artefactIdOf,
  artefactPathOf,
  artefactWriteIdOf,
  chooseArtefact,
  preregIdOf,
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

describe('which name a run writes', () => {
  it('names the file after the design when a pre-registration is given', () => {
    // The case this exists for. R24 measured four arms on the dev split, and the canonical dev
    // artefact is the run R8.3b's `reproduced` cell is recomputed from; a write over it would
    // replace a closed line's evidence with a different design's, and nothing would say so at the
    // write because the new file is a valid artefact.
    expect(artefactWriteIdOf({ split: 'dev', prereg: 'R24-dev-split' })).toBe(
      'poc-sota-bird-dev-R24-dev-split',
    );
    expect(artefactWriteIdOf({ split: 'minidev', prereg: 'R23-evidence' })).toBe(
      'poc-sota-bird-R23-evidence',
    );
  });

  it('gives one design one file, however many times it is dispatched', () => {
    // A second measurement of one claim is one file: a re-dispatch replaces the number a reader
    // should see, while a different design can never touch it.
    const first = artefactWriteIdOf({ split: 'dev', prereg: 'R24-dev-split' });
    const again = artefactWriteIdOf({ split: 'dev', prereg: 'prereg/R24-dev-split.md' });
    expect(again).toBe(first);
  });

  it('leaves a hand-run on the split name', () => {
    // No pre-registration means no design to name: a by-hand run keeps the split's own file,
    // which is the behaviour every lane had before this rule existed.
    expect(artefactWriteIdOf({ split: 'minidev', prereg: '' })).toBe('poc-sota-bird');
    expect(artefactWriteIdOf({ split: 'dev', prereg: '   ' })).toBe('poc-sota-bird-dev');
  });

  it('refuses an id that is a path', () => {
    // A name that climbs out of the results directory is a run writing its evidence where no
    // reader and no gate looks, which is the failure the artefact path exists to prevent.
    expect(() => artefactWriteIdOf({ split: 'dev', prereg: '../escaped' })).toThrow(
      /pre-registration id/,
    );
    expect(() => artefactWriteIdOf({ split: 'dev', prereg: 'R24/../../x' })).toThrow(
      /pre-registration id/,
    );
  });
});

describe('the id a recorded artefact is compared under', () => {
  it('reads an id out of either spelling', () => {
    // `SOTA_PREREG` arrives as an id and is recorded as a path; the two are compared, so a rule
    // that compared raw strings would suffix every name.
    expect(preregIdOf('prereg/R24-dev-split.md')).toBe('R24-dev-split');
    expect(preregIdOf(' R24-dev-split ')).toBe('R24-dev-split');
    expect(preregIdOf('')).toBe('');
  });
});
