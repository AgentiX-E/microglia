import { describe, expect, it } from 'vitest';
import {
  SCAFFOLD_EMPTY_PACK,
  TAU2_ARM_KINDS,
  declaresEmptyStore,
  resolveArmKind,
} from '../tau2-arm-kind.js';

describe('which arm a dispatch is', () => {
  it('leaves the two arms that existed exactly where they were', () => {
    // Every committed τ² artefact was produced by this mapping. A default that moved would make the
    // lane's history incomparable to its future, which is the one thing an additive switch must not do.
    expect(resolveArmKind({})).toBe('memory');
    expect(resolveArmKind({ TAU_MEMORY: 'true' })).toBe('memory');
    expect(resolveArmKind({ TAU_MEMORY: 'false' })).toBe('reference');
    expect(resolveArmKind({ TAU_MEMORY: '', TAU_SCAFFOLD: '' })).toBe('memory');
  });

  it('reads the scaffold arm from the word, not from a boolean', () => {
    // `true` would say the store is empty without saying it was declared empty, and the declaration is
    // the whole difference between this arm and a run whose distillation happened to produce nothing.
    expect(resolveArmKind({ TAU_SCAFFOLD: SCAFFOLD_EMPTY_PACK })).toBe('scaffold');
    expect(resolveArmKind({ TAU_MEMORY: 'true', TAU_SCAFFOLD: SCAFFOLD_EMPTY_PACK })).toBe('scaffold');
  });

  it('trims, because a hand-set variable carries the whitespace it was typed with', () => {
    expect(resolveArmKind({ TAU_SCAFFOLD: ` ${SCAFFOLD_EMPTY_PACK} ` })).toBe('scaffold');
  });

  it('refuses two arms at once instead of picking one', () => {
    // The losing variable leaves no trace in the artefact, so a silent precedence would produce a
    // record whose `arm` disagrees with the dispatch and cannot be audited afterwards.
    expect(() =>
      resolveArmKind({ TAU_MEMORY: 'false', TAU_SCAFFOLD: SCAFFOLD_EMPTY_PACK }),
    ).toThrow(/TAU_MEMORY=false name two different arms/);
  });

  it('refuses a spelling it would otherwise resolve to the memory arm', () => {
    // `TAU_SCAFFOLD=true` is the value an operator will try first. Read as "not empty-pack" it would
    // run the memory arm while the dispatch believed it had bought the control.
    expect(() => resolveArmKind({ TAU_SCAFFOLD: 'true' })).toThrow(/not 'true'/);
    expect(() => resolveArmKind({ TAU_SCAFFOLD: 'empty' })).toThrow(/not 'empty'/);
  });

  it('states which arms declare an empty store, and only that one does', () => {
    expect(TAU2_ARM_KINDS.filter(declaresEmptyStore)).toEqual(['scaffold']);
  });
});
