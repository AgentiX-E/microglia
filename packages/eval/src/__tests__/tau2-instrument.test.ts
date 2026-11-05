import { describe, expect, it } from 'vitest';
import { armRecordFromDriver, storeCensus, type Tau2Raw } from '../tau2-instrument.js';

function raw(over: Partial<Tau2Raw> = {}): Tau2Raw {
  return {
    train: ['t1', 't2'],
    test: ['e1', 'e2'],
    trials: 4,
    unscored: 0,
    servedPackSizes: [1, 2],
    learning: { rows: 2, unanswered: 0, edited: 2, distilled: 2, distillFailed: 0 },
    calls: { total: 40, failed: 0, scope: 'run' },
    domains: { stored: 2, withoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
    scenario: { learn: 'retail', test: 'retail', recall: 'retail' },
    ...over,
  };
}

describe('storeCensus', () => {
  const item = (status: string, domain?: string, statusReason?: string) => ({
    status,
    scope: domain === undefined ? {} : { domain },
    ...(statusReason === undefined ? {} : { statusReason }),
  });

  it('counts the store by status and by what the recall scope can reach', () => {
    const census = storeCensus(
      [
        item('active', 'retail'),
        item('active', 'retail'),
        item('active', 'airline'),
        item('quarantined', 'retail'),
        item('retired'),
      ],
      'retail',
    );
    expect(census.stored).toBe(5);
    expect(census.active).toBe(3);
    // Two of the three active items were stored under the scenario this run recalls in; the third
    // is active and unreachable, which is a different defect from being inactive.
    expect(census.servable).toBe(2);
    expect(census.statuses).toEqual({ active: 3, candidate: 0, quarantined: 1, retired: 1, other: 0 });
  });

  it('separates "nothing active" from "nothing in scope"', () => {
    expect(storeCensus([item('candidate', 'retail')], 'retail')).toMatchObject({ active: 0, servable: 0 });
    expect(storeCensus([item('active', 'airline')], 'retail')).toMatchObject({ active: 1, servable: 0 });
  });

  it('counts a status it does not know as other rather than as active', () => {
    const census = storeCensus([item('archived', 'retail')], 'retail');
    expect(census.statuses.other).toBe(1);
    expect(census.active).toBe(0);
    expect(census.servable).toBe(0);
  });

  it('counts why an item was not activated, because the status alone does not say', () => {
    // R43's store held 24 items, none active, and the status could not say whether the admission gate
    // refused them for evidence, for confidence, or for the corroboration rule that prose needs two
    // tasks to clear. Three different repairs wear one status; the reason is what makes the next round
    // a hypothesis rather than a guess.
    const census = storeCensus(
      [
        item('candidate', 'retail', 'insufficient-evidence'),
        item('candidate', 'retail', 'insufficient-evidence'),
        item('candidate', 'retail', 'needs-corroboration'),
        item('active', 'retail', 'confidence-cleared'),
        item('retired'),
      ],
      'retail',
    );
    expect(census.reasons).toEqual({
      'insufficient-evidence': 2,
      'needs-corroboration': 1,
      'confidence-cleared': 1,
    });
  });

  it('invents no reason for an item that records none', () => {
    expect(storeCensus([item('active', 'retail')], 'retail').reasons).toEqual({});
  });

  it('reads an empty store as zero everywhere', () => {
    expect(storeCensus([], 'retail')).toEqual({
      stored: 0,
      active: 0,
      servable: 0,
      reasons: {},
      statuses: { active: 0, candidate: 0, quarantined: 0, retired: 0, other: 0 },
      admission: {
        measured: 0,
        trustMin: 0,
        trustMax: 0,
        trustMean: 0,
        supportMin: 0,
        supportMax: 0,
        supportMean: 0,
        confidenceMin: 0,
        confidenceMax: 0,
        confidenceMean: 0,
        supportOnly: 0,
      },
    });
  });
});

describe('armRecordFromDriver', () => {
  it('records what the four gate families read, on a clean run', () => {
    const record = armRecordFromDriver(raw());
    expect(record.arm).toBe('memory');
    expect(record.tasks).toBe(2);
    expect(record.trials).toBe(4);
    expect(record.unscored).toBe(0);
    expect(record.meanPackIds).toBeCloseTo(1.5, 12);
    expect(record.calls).toEqual({ calls: 40, failures: 0, scope: 'run' });
    expect(record.learning).toEqual({
      rows: 2,
      unanswered: 0,
      edited: 2,
      distilled: 2,
      distillFailed: 0,
    });
    expect(record.domainOrigin).toEqual({
      storedWithDomain: 2,
      storedWithoutDomain: 0,
      unscopedIn: 0,
      widenedIn: 0,
    });
  });

  it('carries the three scenario names a cross-domain arm has', () => {
    // Without this the record cannot say whether a transfer happened: a store learned in `retail`
    // and recalled under `retail` while answering `airline` is a foreign pack by construction, and
    // the difference between that and a `retail` run is one field.
    const record = armRecordFromDriver(
      raw({ scenario: { learn: 'retail', test: 'airline', recall: 'retail' } }),
    );
    expect(record.scenario).toEqual({ learn: 'retail', test: 'airline', recall: 'retail' });
  });

  it('carries the scenario sizes when the driver listed them, and says nothing when it did not', () => {
    // The arm is scored on a split, and a split of fifty says nothing about whether the scenario had
    // fifty tasks or a thousand. The pair reads this to state the ceiling a dispatch cannot lift.
    expect(armRecordFromDriver(raw({ scenarioTasks: { learn: 115, test: 115 } })).scenarioTasks).toEqual({
      learn: 115,
      test: 115,
    });
    // Absent on every artefact written before the field existed: the pair then reports no ceiling
    // rather than one built from a guess about the scenario's size.
    expect(armRecordFromDriver(raw()).scenarioTasks).toBeUndefined();
  });

  it('carries the store census and the recall tally, so a zero rate has a population', () => {
    const record = armRecordFromDriver(
      raw({
        store: {
          stored: 14,
          active: 14,
          servable: 14,
          statuses: { active: 14, candidate: 0, quarantined: 0, retired: 0, other: 0 },
        },
        recall: { requests: 200, served: 0, empty: 200 },
      }),
    );
    expect(record.store).toMatchObject({ stored: 14, servable: 14 });
    expect(record.recall).toEqual({ requests: 200, served: 0, empty: 200 });
  });

  it('omits both when the driver did not count them, rather than reporting zeros', () => {
    const record = armRecordFromDriver(raw());
    expect(record.store).toBeUndefined();
    expect(record.recall).toBeUndefined();
  });

  it('counts distinct held-out tasks in the denominator and keeps repeats in the split', () => {
    // V2 asks whether every question was evaluated exactly once. A record that de-duplicated the list
    // before the gate saw it would answer its own question, and answer it yes.
    const record = armRecordFromDriver(raw({ test: ['e1', 'e2', 'e2'] }));
    expect(record.tasks).toBe(2);
    expect(record.split?.test).toEqual(['e1', 'e2', 'e2']);
    expect(record.split?.train).toEqual(['t1', 't2']);
  });

  it('reports an empty pack set as zero items rather than as absent', () => {
    // The lane ran and served nothing: that is V1's failure case, and reporting `undefined` would turn
    // "the memory injected nothing" into "the gate was not applicable".
    expect(armRecordFromDriver(raw({ servedPackSizes: [] })).meanPackIds).toBe(0);
  });

  it('omits the reliability record when the run made no call', () => {
    // Zero calls is not perfect reliability, and a default of zero would say it was.
    const record = armRecordFromDriver(raw({ calls: { total: 0, failed: 0 } }));
    expect(record.calls).toBeUndefined();
    expect(Object.hasOwn(record, 'calls')).toBe(false);
  });

  it('reports the learning record even when it says nothing was learned', () => {
    // The first version omitted the record whenever the distiller's failure count was unavailable,
    // on the argument that a zero would hand V32 a perfect score for a quantity nobody measured. The
    // count was measurable all along — `host.distill` returns it — so omission became the worse lie:
    // the run whose store was empty reported no learning record at all, and `V32` was absent on the
    // one dispatch where it would have fired.
    const record = armRecordFromDriver(
      raw({ learning: { rows: 32, unanswered: 0, edited: 32, distilled: 0, distillFailed: 32 } }),
    );
    expect(record.learning).toEqual({
      rows: 32,
      unanswered: 0,
      edited: 32,
      distilled: 0,
      distillFailed: 32,
    });
  });

  it('carries the distiller\u2019s own detail, and each count only when it was observed', () => {
    const record = armRecordFromDriver(
      raw({
        learning: {
          rows: 32,
          unanswered: 0,
          edited: 32,
          distilled: 30,
          distillFailed: 2,
          candidates: 41,
          events: 32,
          llmFailed: 12,
        },
      }),
    );
    expect(record.learning).toMatchObject({ candidates: 41, events: 32, llmFailed: 12 });
  });

  it('names the population a call tally covers, because a subset is not a rate over everything', () => {
    // The episodes' calls belong to the agent process; the distillation calls are the driver's own.
    // Supplying the second as if it were the first is the mistake; supplying nothing was the mistake
    // that let a run whose every distillation prompt was refused reach a reader as a quiet store.
    const record = armRecordFromDriver(raw({ calls: { total: 32, failed: 32, scope: 'distillation' } }));
    expect(record.calls).toEqual({ calls: 32, failures: 32, scope: 'distillation' });
  });

  it('leaves the scope unnamed when the arm did not name one', () => {
    // Every artefact written before this field existed. Inventing a scope for them would be a claim
    // about which calls the tally covered, and nobody made it.
    const record = armRecordFromDriver(raw({ calls: { total: 40, failed: 1 } }));
    expect(record.calls).toEqual({ calls: 40, failures: 1 });
    expect(record.calls === undefined ? true : Object.hasOwn(record.calls, 'scope')).toBe(false);
  });

  it('splits the store into the two domain buckets the ledger compares', () => {
    // V44's inequality is `storedWithoutDomain <= unscopedIn + widenedIn`, so the two sides have to be
    // counted from the same population: an item is either carrying a domain or it is not.
    const record = armRecordFromDriver(
      raw({ domains: { stored: 5, withoutDomain: 2, unscopedIn: 1, widenedIn: 1 } }),
    );
    expect(record.domainOrigin).toEqual({
      storedWithDomain: 3,
      storedWithoutDomain: 2,
      unscopedIn: 1,
      widenedIn: 1,
    });
  });

  it('never reports a negative count when the buckets disagree with the total', () => {
    // A store that reports more domain-free items than items is broken, and a negative "with domain"
    // would make V44's sum true for the wrong reason instead of exposing the disagreement.
    const record = armRecordFromDriver(
      raw({ domains: { stored: 1, withoutDomain: 3, unscopedIn: 0, widenedIn: 0 } }),
    );
    expect(record.domainOrigin?.storedWithDomain).toBe(0);
    expect(record.domainOrigin?.storedWithoutDomain).toBe(3);
  });

  it('names the arm it was asked for, so one function serves both arms', () => {
    expect(armRecordFromDriver(raw(), 'reference').arm).toBe('reference');
  });
});
