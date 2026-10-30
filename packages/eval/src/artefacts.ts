/**
 * Which file a run writes, and what it calls the split it measured.
 *
 * Two decisions that look like string constants and are not. A split's name decides an
 * admissibility verdict — the rule in `reproduction.ts` compares split names, so a run on the
 * right 1,534 questions filed under the wrong name is `indicative` forever. And a split's artefact
 * decides whether a reading can still be recomputed: overwriting the 350-question file with a
 * 1,534-question one deletes the evidence for every row that quotes the smaller number.
 *
 * Both live here rather than in the lane because the lane is a CLI entry point — excluded from
 * coverage by the repository's own rule — and a naming rule that decides a verdict should not be
 * the one piece of logic no test can reach.
 */
import { join } from 'node:path';
import type { Split } from './bird-data.js';

/**
 * The artefact each split writes.
 *
 * Two files, not one file rewritten. `poc-sota-bird.json` is the Mini-Dev run every earlier
 * reading came from and the protocol gate still recomputes its cell from; `poc-sota-bird-dev.json`
 * is the dev run that can be called a reproduction. Deleting either one turns a checkable claim
 * into prose.
 */
export const ARTEFACT_IDS: Readonly<Record<Split, string>> = {
  minidev: 'poc-sota-bird',
  dev: 'poc-sota-bird-dev',
};

/** How the Mini-Dev slice names itself in an artefact. */
export const MINIDEV_SPLIT_NAME = 'BIRD Mini-Dev (sqlite)';

/**
 * How the full dev split names itself.
 *
 * Spelled exactly as the published cell spells it, because `compareCell` decides same-split by
 * comparing these strings. `artefacts.test.ts` asserts the equality against `PUBLISHED_CELLS`
 * rather than trusting this comment: a catalogue entry that renames its split has to break a test,
 * not quietly downgrade every future reproduction to `indicative`.
 */
export const DEV_SPLIT_NAME = 'BIRD dev';

/** The artefact id for a split. */
export function artefactIdOf(split: Split): string {
  return ARTEFACT_IDS[split];
}

/** The name a split reports as its dataset. */
export function splitNameOf(split: Split): string {
  return split === 'dev' ? DEV_SPLIT_NAME : MINIDEV_SPLIT_NAME;
}

/** Where a lane's artefact lives, given the split it measured. */
export function artefactPathOf(dir: string, split: Split): string {
  return join(dir, `${artefactIdOf(split)}.json`);
}

export type ArtefactChoice = {
  readonly dir: string;
  /** `SOTA_ARTEFACT`, when the caller named one. */
  readonly explicit: string | undefined;
  readonly exists: (path: string) => boolean;
};

/**
 * The BIRD artefact a downstream lane should read.
 *
 * Every reader of this run — attribution, the pool, the signals, the density family, the union
 * price — used to spell one file name, which was correct while there was one split and silent
 * once there were two: each of them opens with "if the artefact is missing, print a line and exit
 * zero", so a reader pointed at the wrong split does not fail, it reports nothing.
 *
 * Resolution order: an explicit `SOTA_ARTEFACT` wins, then Mini-Dev, then dev. Mini-Dev first
 * because the documents quote the 350-question numbers and a lane that works on both should keep
 * reporting the one they quote; dev is read only when it is the only run present.
 */
export function chooseArtefact(choice: ArtefactChoice): string {
  const explicit = choice.explicit;
  if (explicit !== undefined && explicit !== '') {
    return explicit.includes('/') ? explicit : join(choice.dir, explicit);
  }
  const dev = artefactPathOf(choice.dir, 'dev');
  if (choice.exists(dev)) {
    const mini = artefactPathOf(choice.dir, 'minidev');
    // Mini-Dev wins when both exist, because the documents quote its numbers.
    return choice.exists(mini) ? mini : dev;
  }
  return artefactPathOf(choice.dir, 'minidev');
}
