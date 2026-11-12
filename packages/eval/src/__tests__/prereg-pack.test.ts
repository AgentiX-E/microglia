import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPrereg } from '../prereg.js';
import { packBudgetOf, packCouplingProblems, recordCapacityOf } from '../prereg-pack.js';

/**
 * The ceiling and the budget, held against each other.
 *
 * R88 raised the record ceiling from 700 to 2,000 characters and left the pack at 1,200. The two numbers
 * had never been compared anywhere in this repository, and the consequence is not an error: a record
 * above what the pack can carry is retrieved, ranked, dropped at render, and reported — by every
 * artefact this lane has produced — as a request that found nothing relevant. 41.2% of the retail corpus
 * is above the 810 characters a 1,200-character pack can carry.
 *
 * These tests hold the arithmetic and then hold every registration in the repository to it, which is the
 * half that makes the check a gate rather than a function.
 */

const PREREG_DIR = join(process.cwd(), 'prereg');

describe('packBudgetOf', () => {
  it('falls back to the lane default, which is the number every published arm ran with', () => {
    expect(packBudgetOf({})).toBe(1200);
    expect(packBudgetOf({ packBudget: 2400 })).toBe(2400);
  });
});

describe('recordCapacityOf', () => {
  it('measures the capacity a record needs, not the capacity a claim needs', () => {
    // The record shape carries a domain dimension and a provenance payload, which is 149 characters of
    // pack a bare claim does not spend. A capacity quoted for the wrong shape passes on a pack that
    // cannot render the item it was quoted for.
    expect(recordCapacityOf({})).toBe(810);
    expect(recordCapacityOf({ packBudget: 2400 })).toBe(2010);
  });

  it('buys one character of capacity per character of budget, so the cost is a constant', () => {
    expect(recordCapacityOf({ packBudget: 2400 }) - recordCapacityOf({})).toBe(1200);
  });
});

describe('packCouplingProblems', () => {
  it('says nothing about a registration that states only a ceiling, because finished runs keep their reading', () => {
    expect(packCouplingProblems({ rawCeiling: 2000 })).toEqual([]);
    expect(packCouplingProblems({ packBudget: 1200 })).toEqual([]);
  });

  it('accepts a ceiling the declared budget can carry, on the boundary as well as below it', () => {
    expect(packCouplingProblems({ rawCeiling: 2000, packBudget: 2400 })).toEqual([]);
    expect(packCouplingProblems({ rawCeiling: 2010, packBudget: 2400 })).toEqual([]);
  });

  it("refuses R88's pair, in the number the reader will need to change", () => {
    expect(packCouplingProblems({ rawCeiling: 2000, packBudget: 1200 })).toEqual([
      {
        where: "header 'rawCeiling'",
        problem:
          '2000 exceeds the 810 characters a 1200-character pack can carry, so records above 810 would be written and never rendered',
      },
    ]);
  });

  it('reads 2,011 as one character too far, because the boundary is inclusive', () => {
    expect(packCouplingProblems({ rawCeiling: 2011, packBudget: 2400 })).toHaveLength(1);
  });
});

describe('every registration in the repository', () => {
  it('states a ceiling its own pack can carry, or states no budget at all', () => {
    // The gate. A registration is the one artefact written before a dispatch and read by every later
    // one, so a pair that cannot work has to fail on the push rather than in a run whose store writes
    // records the pack drops.
    const files = readdirSync(PREREG_DIR)
      .filter((entry) => entry.endsWith('.md') && entry !== 'TEMPLATE.md')
      .sort();
    expect(files.length).toBeGreaterThan(50);
    const failures: string[] = [];
    for (const name of files) {
      const path = join(PREREG_DIR, name);
      const reading = readPrereg(readFileSync(path, 'utf8'), path);
      const prereg = reading.prereg;
      if (prereg === undefined) {
        failures.push(`${name}: ${reading.problems.length} problem(s)`);
        continue;
      }
      for (const problem of packCouplingProblems(prereg)) {
        failures.push(`${name} at ${problem.where}: ${problem.problem}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
