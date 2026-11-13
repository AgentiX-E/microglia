import { describe, expect, it } from 'vitest';
import { COVERAGE_FLOORS } from '../tau2-use-census.js';
import {
  LEARNING_FIELDS,
  PROJECTION,
  armRecordFromDriver,
  storeCensus,
  type Tau2Raw,
} from '../tau2-instrument.js';

function raw(over: Partial<Tau2Raw> = {}): Tau2Raw {
  return {
    train: ['t1', 't2'],
    test: ['e1', 'e2'],
    trials: 4,
    unscored: 0,
    servedPackSizes: [1, 2],
    learning: {
      rows: 2,
      unanswered: 0,
      edited: 2,
      distilled: 2,
      distillFailed: 0,
    },
    calls: { total: 40, failed: 0, scope: 'run' },
    domains: { stored: 2, withoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
    scenario: { learn: 'retail', test: 'retail', recall: 'retail' },
    ...over,
  };
}

describe('storeCensus', () => {
  const item = (status: string, domain?: string, statusReason?: string, when?: string) => ({
    status,
    scope: domain === undefined ? {} : { domain },
    ...(statusReason === undefined ? {} : { statusReason }),
    ...(when === undefined ? {} : { when }),
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
    expect(census.statuses).toEqual({
      active: 3,
      candidate: 0,
      quarantined: 1,
      retired: 1,
      other: 0,
    });
  });

  it('counts the conditions of the servable items, because a rule with none is recalled by nothing', () => {
    // R51. The R49 store held ten rules, all ten servable, and not one of them
    // stated a condition: every rule was "a request of this shape is resolved by
    // calling ...", which shares no term with the question and says nothing about
    // where it applies. Thirty-eight percent of requests were served an empty pack
    // and the pack that did arrive carried 0.76 rules. A census that counts
    // servable items alone would have called that store healthy.
    const census = storeCensus(
      [
        item('active', 'retail', undefined, 'the customer asks to cancel a shipment'),
        item('active', 'retail', undefined, '   '),
        item('active', 'retail'),
        // Out of scope: unconditioned for a different reason, and folding the two
        // populations together would let one defect hide behind the other.
        item('active', 'airline', undefined, 'a refund on a delayed flight'),
      ],
      'retail',
    );
    expect(census.servable).toBe(3);
    expect(census.conditioned).toBe(1);
    expect(census.unconditioned).toBe(2);
  });

  it('separates "nothing active" from "nothing in scope"', () => {
    expect(storeCensus([item('candidate', 'retail')], 'retail')).toMatchObject({
      active: 0,
      servable: 0,
    });
    expect(storeCensus([item('active', 'airline')], 'retail')).toMatchObject({
      active: 1,
      servable: 0,
    });
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
      statuses: {
        active: 0,
        candidate: 0,
        quarantined: 0,
        retired: 0,
        other: 0,
      },
      conditioned: 0,
      unconditioned: 0,
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
    expect(record.scenario).toEqual({
      learn: 'retail',
      test: 'airline',
      recall: 'retail',
    });
  });

  it('carries the scenario sizes when the driver listed them, and says nothing when it did not', () => {
    // The arm is scored on a split, and a split of fifty says nothing about whether the scenario had
    // fifty tasks or a thousand. The pair reads this to state the ceiling a dispatch cannot lift.
    expect(
      armRecordFromDriver(raw({ scenarioTasks: { learn: 115, test: 115 } })).scenarioTasks,
    ).toEqual({
      learn: 115,
      test: 115,
    });
    // Absent on every artefact written before the field existed: the pair then reports no ceiling
    // rather than one built from a guess about the scenario's size.
    expect(armRecordFromDriver(raw()).scenarioTasks).toBeUndefined();
  });

  it("carries the store's own text, the form and the note — the three fields R56 lost", () => {
    // The driver wrote all three and the arm record dropped all three, so R56's artefact came back
    // with no item text, no `distillForm` and no note: two of its four predictions could not be
    // graded and the third could not be explained. A projection that silently drops a field is worse
    // than one that refuses, because the artefact still looks complete.
    const sample = {
      items: [
        {
          id: 'a',
          kind: 'procedure',
          status: 'active',
          when: 'when the customer asks to cancel an order',
          statement: 'confirm which order the customer means',
          trust: 0.9,
          scope: { domain: 'retail' },
          supportTasks: 2,
          evidence: 2,
        },
      ],
      limit: 64,
      maxChars: 240,
      omitted: 0,
      truncated: 0,
    };
    const record = armRecordFromDriver(
      raw({
        storeItems: sample,
        distillForm: {
          form: 'procedure',
          toolInventory: ['find_user'],
          refused: 3,
        },
        injectionNote: { mode: 'standard', declared: false },
      }),
    );
    expect(record.storeItems?.items[0]?.supportTasks).toBe(2);
    expect(record.distillForm).toEqual({
      form: 'procedure',
      toolInventory: ['find_user'],
      refused: 3,
    });
    expect(record.injectionNote).toEqual({ mode: 'standard', declared: false });
  });

  it('omits all three when an older driver wrote none of them', () => {
    const record = armRecordFromDriver(raw());
    expect(record.storeItems).toBeUndefined();
    expect(record.distillForm).toBeUndefined();
    expect(record.injectionNote).toBeUndefined();
  });

  it('carries the store census and the recall tally, so a zero rate has a population', () => {
    const record = armRecordFromDriver(
      raw({
        store: {
          stored: 14,
          active: 14,
          servable: 14,
          statuses: {
            active: 14,
            candidate: 0,
            quarantined: 0,
            retired: 0,
            other: 0,
          },
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

  it('builds the use census from the facade observations, beside V1', () => {
    // Real kernel values: 'cancel my reservation' vs 'cancel reservation' is full
    // coverage, 'refund order' vs it is zero, and a content-free query is reported
    // as unmeasurable by the profile. The census counts zero-coverage pairs.
    const record = armRecordFromDriver(
      raw({
        useObservations: [
          {
            query: 'cancel my reservation',
            statements: ['cancel reservation'],
          },
          { query: 'refund order', statements: ['cancel reservation'] },
        ],
        widenedItems: 3,
      }),
    );
    expect(record.use).toEqual({
      arm: 'as-is',
      recallRequests: 2,
      recallServed: 2,
      meanPackIds: 1,
      injectedPairs: 2,
      zeroCoveragePairs: 1,
      widenedItems: 3,
    });
  });

  it('names a non-default use arm when the driver collected under one', () => {
    const record = armRecordFromDriver(
      raw({
        useObservations: [{ query: 'cancel', statements: [] }],
        useArm: 'coverage-floored',
      }),
    );
    expect(record.use?.arm).toBe('coverage-floored');
    expect(record.use?.recallServed).toBe(0);
    expect(record.use?.widenedItems).toBe(0); // absent widenedItems defaults to 0
  });

  it('commits a coverage histogram beside the census from the same observations', () => {
    // The seven-field census is a scalar U3 cannot compute a floor from. The
    // histogram is reduced here, in-process, from the very observations that
    // produced the census, so the two readings cannot describe two populations.
    const record = armRecordFromDriver(
      raw({
        useObservations: [
          {
            query: 'cancel my reservation',
            statements: ['cancel reservation'],
          },
          { query: 'refund order', statements: ['cancel reservation'] },
        ],
      }),
    );
    expect(record.use?.injectedPairs).toBe(2);
    expect(record.coverage?.measuredPairs).toBe(2);
    expect(record.coverage?.floors).toHaveLength(COVERAGE_FLOORS.length);
    // floor 0 keeps every measurable pair; the first nonzero point empties the
    // one pack whose rule shares none of its question's content terms.
    expect(record.coverage?.floors[0]?.retainedPairs).toBe(2);
    const first = COVERAGE_FLOORS.find((f) => f > 0) as number;
    const row = record.coverage?.floors.find((r) => r.minCoverage === first);
    expect(row?.emptiedPacks).toBe(1);
    expect(row?.retainedPacks).toBe(1);
  });

  it('reports neither census nor histogram when the driver did not instrument it', () => {
    // Every artefact before R46 has none. An older run is "not measured", never a
    // run that served a perfectly relevant empty pack, and never a histogram
    // full of zeros standing in for a population that was never observed.
    expect(armRecordFromDriver(raw()).use).toBeUndefined();
    expect(armRecordFromDriver(raw()).coverage).toBeUndefined();
    expect(armRecordFromDriver(raw({ store: undefined })).use).toBeUndefined();
    expect(armRecordFromDriver(raw({ store: undefined })).coverage).toBeUndefined();
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
      raw({
        learning: {
          rows: 32,
          unanswered: 0,
          edited: 32,
          distilled: 0,
          distillFailed: 32,
        },
      }),
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
    expect(record.learning).toMatchObject({
      candidates: 41,
      events: 32,
      llmFailed: 12,
    });
    // The count without the reasons is one number for three different failures: a provider that
    // refused, a reply that did not parse, and a timeout have three different fixes. R58 recorded
    // `llmFailed: 11` of 15 and the artefact could not say which one it was, so the store looked
    // like a thin store rather than like a failing one.
    expect(record.learning?.llmFailedReasons).toBeUndefined();
  });

  it('carries why the fallback answered, by code, so the count has a cause', () => {
    const record = armRecordFromDriver(
      raw({
        learning: {
          rows: 15,
          unanswered: 0,
          edited: 15,
          distilled: 6,
          distillFailed: 0,
          candidates: 6,
          events: 15,
          llmFailed: 11,
          llmFailedReasons: { MG_E_INVALID_SIGNAL: 9, MG_E_PROVIDER: 2 },
        },
      }),
    );
    expect(record.learning?.llmFailedReasons).toEqual({ MG_E_INVALID_SIGNAL: 9, MG_E_PROVIDER: 2 });
  });

  it('carries one specimen per fault code, because a code names a category and not a reply', () => {
    const record = armRecordFromDriver(
      raw({
        learning: {
          rows: 15,
          unanswered: 0,
          edited: 15,
          distilled: 6,
          distillFailed: 0,
          events: 15,
          llmFailed: 11,
          llmFailedReasons: { MG_E_INVALID_SIGNAL: 11 },
          llmFailedSamples: { MG_E_INVALID_SIGNAL: 'MG_E_INVALID_SIGNAL: LLM response is not JSON <- {"cand' },
        },
      }),
    );
    expect(record.learning?.llmFailedSamples).toEqual({
      MG_E_INVALID_SIGNAL: 'MG_E_INVALID_SIGNAL: LLM response is not JSON <- {"cand',
    });
  });

  it('names the population a call tally covers, because a subset is not a rate over everything', () => {
    // The episodes' calls belong to the agent process; the distillation calls are the driver's own.
    // Supplying the second as if it were the first is the mistake; supplying nothing was the mistake
    // that let a run whose every distillation prompt was refused reach a reader as a quiet store.
    const record = armRecordFromDriver(
      raw({ calls: { total: 32, failed: 32, scope: 'distillation' } }),
    );
    expect(record.calls).toEqual({
      calls: 32,
      failures: 32,
      scope: 'distillation',
    });
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
      raw({
        domains: { stored: 5, withoutDomain: 2, unscopedIn: 1, widenedIn: 1 },
      }),
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
      raw({
        domains: { stored: 1, withoutDomain: 3, unscopedIn: 0, widenedIn: 0 },
      }),
    );
    expect(record.domainOrigin?.storedWithDomain).toBe(0);
    expect(record.domainOrigin?.storedWithoutDomain).toBe(3);
  });

  it('names the arm it was asked for, so one function serves both arms', () => {
    expect(armRecordFromDriver(raw(), 'reference').arm).toBe('reference');
  });
});

describe('the projection has a decision for every field, and keeps it', () => {
  // R56 lost three fields here and nothing failed. `PROJECTION` is typed with `-?` over
  // `keyof Tau2Raw`, so a field added to the driver's record does not compile until it is given a
  // decision -- verified by adding one and watching `tsc` refuse. These two tests hold the runtime
  // side: the table says what the mapping does, and the mapping does what the table says.
  const full = (over: Partial<Tau2Raw> = {}): Tau2Raw =>
    raw({
      ...over,
      scenarioTasks: { learn: 115, test: 115 },
      store: {
        stored: 14,
        active: 14,
        servable: 14,
        statuses: {
          active: 14,
          candidate: 0,
          quarantined: 0,
          retired: 0,
          other: 0,
        },
      },
      recall: { requests: 200, served: 200, empty: 0 },
      // R89: what the pack served and what it refused. Carried rather than reduced, because the two
      // numbers it separates -- nothing relevant, and relevant but too long -- are the difference
      // between a retrieval fix and a budget fix.
      pack: {
        budget: 2400,
        capacity: 2010,
        requests: 200,
        filled: 198,
        empty: 2,
        emptiedBySize: 1,
        droppedForSize: 3,
        summary: { meanIds: 2, meanChars: 1720 },
      },
      storeItems: {
        items: [
          {
            id: 'a',
            kind: 'lesson',
            status: 'active',
            when: 'when the customer asks to cancel an order',
            statement: 'confirm which order the customer means',
            trust: 0.9,
            scope: { domain: 'retail' },
            supportTasks: 1,
            evidence: 1,
          },
        ],
        limit: 64,
        maxChars: 240,
        omitted: 0,
        truncated: 0,
      },
      distillForm: { form: 'lesson', toolInventory: ['find_user'], refused: 0 },
      // R85: the raw unit's census, carried for the same reason as every other field here — the
      // guard is only as good as the fixture, and a fixture without it would let the projection drop
      // it silently.
      rawlog: { records: 14, clipped: 0, toolBan: false },
      faithfulness: { corrections: 14, withoutEntities: 0, entities: 40, kept: 31, whole: 9 },
      // R58: the carried fixture holds the unit, because a `carried` decision is only checked
      // against the fields the fixture defines — and the guard that catches a dropped field would
      // otherwise be silent about the one this iteration added.
      distillUnit: {
        unit: 'trace',
        traces: 3,
        traced: 3,
        claims: 7,
        consolidation: {
          considered: 3,
          groups: 1,
          merged: 1,
          retained: 2,
          threshold: 0.6,
          conditionMinShared: 3,
          refusedCondition: 0,
          refusedPayload: 0,
          refusedDuplicateEvidence: 0,
          // R61: the four readings the linkage and condition changes added. The census fixture has
          // to carry them for the same reason every other carried field does.
          refusedLinkage: 0,
          supportBefore: { 1: 3 },
          supportAfter: { 1: 1, 2: 1 },
          maxSupportBefore: 1,
          maxSupportAfter: 2,
          groupDetail: [
            {
              ids: ['k1', 'k2'],
              supportTasks: 2,
              weakestPair: 0.64,
              conditionShared: 2,
              crossTask: true,
            },
          ],
          weakestPair: 0.64,
          largestGroup: 2,
          crossTaskGroups: 1,
        },
      },
      // R61: the floor sweep, carried because it is the instrument that separates "the floor was
      // too high" from "the population does not corroborate".
      consolidationSweep: {
        points: [
          {
            threshold: 0.6,
            conditionMinShared: 0,
            groups: 1,
            merged: 1,
            maxSupport: 2,
            support: { 1: 1, 2: 1 },
            crossTaskGroups: 1,
            largestGroup: 2,
            weakestPair: 0.64,
          },
        ],
        operating: {
          threshold: 0.6,
          conditionMinShared: 0,
          groups: 1,
          merged: 1,
          maxSupport: 2,
          support: { 1: 1, 2: 1 },
          crossTaskGroups: 1,
          largestGroup: 2,
          weakestPair: 0.64,
        },
        groups: [
          {
            ids: ['k1', 'k2'],
            supportTasks: 2,
            weakestPair: 0.64,
            conditionShared: 2,
            crossTask: true,
          },
        ],
      },
      // R60: the ceiling the dispatch ran under, carried beside the yield it explains.
      traceClaims: { ceiling: 3, declared: true },
      // R62: the population switch and the store split by it. Both are carried rather than reduced,
      // because the round's only reading is a comparison between two populations and a reader that
      // had to infer one from the other would be comparing a store with itself.
      distillScope: 'all' as const,
      provenance: {
        edited: 2,
        passed: 5,
        tasksEdited: 2,
        tasksPassed: 5,
        itemsEditedOnly: 3,
        itemsPassedOnly: 4,
        itemsMixed: 1,
        itemsUnattributed: 0,
        evidenceUnattributed: 0,
      },
      // R60: the yield rides beside the unit, and the guard forces this fixture to say so — a carried
      // field no fixture mentions is a field the projection could drop in silence.
      yieldCensus: {
        corrections: 2,
        assertions: 3,
        claims: 4,
        maxClaims: 3,
        medianClaims: 2,
        perCorrection: [
          { taskId: 'retail/0', assertions: 2, claims: 3 },
          { taskId: 'retail/1', assertions: 1, claims: 1 },
        ],
      },
      // R57: the planted arm's census, carried because a `carried` decision is checked against the
      // fields the fixture defines — a fixture that omitted it would let the projection drop it in
      // silence, which is the defect this guard was written for.
      plant: {
        arm: 'near',
        declared: true,
        planted: 200,
        inBand: 152,
        createdBlock: 12,
        terms: [1, 2, 5],
        coverages: [0.02, 0.05, 0.13],
        byRule: { 'near-address': 120, 'near-refund': 80 },
        digest: 'abc123abc123abcd',
      },
      // R92: the questions the packs were ranked on. Carried because a pack is a function of the store
      // *and* the query, and R91's artefact held the first while the second moved.
      queries: {
        requests: 200,
        distinct: 187,
        meanChars: 214.5,
        p50Chars: 203,
        digest: 'abcd1234abcd1234',
        askedDigest: 'abcd1234abcd1234',
        replaced: 0,
        pin: null,
        texts: [{ index: 0, text: 'cancel my reservation' }],
      },
      // R92: which benchmark generation this is. Carried because a number is comparable only to one
      // from the same release, and the release moved every retail task body between v0.2.0 and v1.0.1.
      benchmark: { version: 'v1.0.1', commit: 'f2c1ab3d4e5f60718293a4b5c6d7e8f901234567' },
      // R92: what the score was bought for. The competitor publishes this beside its own number.
      cost: { usd: 13.4857, band: 'off_peak', conversations: 160, perConversation: 0.0843 },
      injectionNote: { mode: 'standard', declared: false },
      funnel: {
        corrections: 2,
        candidates: 4,
        admitted: 2,
        stored: 2,
        servable: 2,
        refused: 0,
        failed: 0,
      },
      writeAdmission: { mode: 'off', rephrased: 0, suppressed: 0 },
      useObservations: [{ query: 'cancel my reservation', statements: ['cancel reservation'] }],
      useArm: 'as-is',
      widenedItems: 0,
      coverageObservations: [
        { query: 'cancel my reservation', statements: ['cancel reservation'] },
      ],
      inaction: {
        state: 'OBSERVED',
        tasks: [{ id: 'retail/5', trials: 4, inactive: 1 }],
        inactiveTrials: 1,
        totalTrials: 4,
      },
    });

  const carried = Object.entries(PROJECTION)
    .filter(([, decision]) => decision === 'carried')
    .map(([field]) => field);
  const reduced = Object.entries(PROJECTION)
    .filter(([, decision]) => decision === 'reduced')
    .map(([field]) => field);

  it('carries the abstention census, which the single-facade path computed and threw away', () => {
    // R53's fourth prediction is "a licence to disregard a rule must not become a licence to stop
    // acting", and the census is its subject. `evaluateFacade` built one per facade and the
    // single-facade path -- every dispatch since R49 unless the paired facade is switched on --
    // dropped it on the floor, so the prediction had nothing to read. R49's paired path kept its
    // copy, which is how the loss went unnoticed: one of the two callers used the field.
    const inaction = {
      state: 'OBSERVED' as const,
      tasks: [{ id: 'retail/5', trials: 4, inactive: 1 }],
      inactiveTrials: 1,
      totalTrials: 4,
    };
    const record = armRecordFromDriver(full({ inaction }));
    expect(record.inaction).toEqual(inaction);
  });

  it('carries the pack census, which is the only place a dropped record is not read as no memory', () => {
    // `recall.empty` counts both "nothing relevant" and "the relevant record did not fit the budget" as
    // one number. R88 wrote 2,000-character records into a 1,200-character pack, where the capacity is
    // 810 characters of statement, so the second state was live on that run and unreadable in its
    // artefact.
    const pack = {
      budget: 1200,
      capacity: 810,
      requests: 228,
      filled: 216,
      empty: 12,
      emptiedBySize: 12,
      droppedForSize: 47,
      summary: { meanIds: 1, meanChars: 1086 },
    };
    // Spread after `full()` rather than through it: the fixture states its own `pack`, and an override
    // passed through its argument is overwritten by the fixture's copy — the same trap that once made
    // three tests assert the fixture's value instead of the case's.
    expect(armRecordFromDriver({ ...full(), pack }).pack).toEqual(pack);
  });

  it('carries every field it says it carries', () => {
    const record = armRecordFromDriver(full()) as Record<string, unknown>;
    const missing = carried.filter((field) => record[field] === undefined);
    expect(missing).toEqual([]);
    // And the list is not trivially everything: the decision has two values and both are used.
    expect(reduced.length).toBeGreaterThan(0);
    expect(carried.length + reduced.length).toBe(Object.keys(full()).length);
  });

  it('carries every learning field, including the two the block used to drop', () => {
    // The table above is exhaustive over the top level and the `learning` block was still hand-written
    // inside the projection, so two fields were dropped in silence: `dropped` (written since R56, which
    // is why a refused claim had no explanation in any file) and `pin` (R91's, whose absence made the
    // first replayed store read as a drawn one). `LEARNING_FIELDS` makes the next one a compile error;
    // this test holds the runtime half.
    const learning: Tau2Raw['learning'] = {
      rows: 57,
      unanswered: 0,
      edited: 15,
      distilled: 15,
      distillFailed: 0,
      candidates: 15,
      events: 15,
      dropped: { 'schema-refused': 2 },
      llmFailed: 0,
      llmFailedReasons: { MG_E_TIMEOUT: 1 },
      llmFailedSamples: { MG_E_TIMEOUT: 'read timed out' },
      pin: {
        source: 'R90 (run 43273198959)',
        failures: 15,
        tasks: 57,
        corpus: '/work/.tau2-bench/data/tau2/domains/retail/tasks.json',
      },
    };
    const record = armRecordFromDriver({ ...full(), learning });
    const out = record.learning as unknown as Record<string, unknown>;
    expect(out).toEqual(learning);
    const missing = Object.keys(LEARNING_FIELDS).filter((field) => out[field] === undefined);
    expect(missing).toEqual([]);
  });

  it('omits a learning field the driver did not report, rather than inventing a value', () => {
    // Absent is not zero: an artefact written before the pin existed must not claim a store was drawn.
    const record = armRecordFromDriver({
      ...full(),
      learning: { rows: 57, unanswered: 0, edited: 15, distilled: 15, distillFailed: 0 },
    });
    const out = record.learning as unknown as Record<string, unknown>;
    expect(out['pin']).toBeUndefined();
    expect(out['dropped']).toBeUndefined();
  });

  it('carries the query census beside the store it was ranked against', () => {
    // R92. R91's artefact carried the store and not the question, so a pack that moved under a pinned
    // store had no explanation in any file and read as a nondeterministic renderer.
    const queries = {
      requests: 228,
      distinct: 228,
      meanChars: 214.5,
      p50Chars: 203,
      digest: 'abcd1234abcd1234',
      askedDigest: 'abcd1234abcd1234',
      replaced: 0,
      pin: null,
      texts: [{ index: 0, text: 'cancel my reservation' }],
    };
    expect(armRecordFromDriver({ ...full(), queries }).queries).toEqual(queries);
  });

  it('carries the benchmark release beside the number, because the number is about that release', () => {
    // R92's first dispatch died on a file that does not exist before v1.0.0, and the same release
    // boundary rewrote every retail task body. An artefact quoting `pass^4` without this cannot be
    // ranked against a published figure, and the omission reads as a compatible run.
    const benchmark = { version: 'v1.0.1', commit: 'f2c1ab3d4e5f60718293a4b5c6d7e8f901234567' };
    expect(armRecordFromDriver({ ...full(), benchmark }).benchmark).toEqual(benchmark);
  });

  it('carries the bill and the cost of one conversation, which is the number beside the score', () => {
    // T.4 of the competitive record: the competitor reports USD per conversation on the same run that
    // produced its pass^4, and this lane printed a token census and left the arithmetic to a reader.
    const cost = { usd: 13.4857, band: 'off_peak', conversations: 160, perConversation: 0.0843 };
    expect(armRecordFromDriver({ ...full(), cost }).cost).toEqual(cost);
  });

  it('omits the cost when the phase could not price itself, rather than writing a zero', () => {
    // A zero would read as "the run was free" — the same defect as an unscored attempt counted as a
    // failure, one field over. Absent reads as "not priced".
    const record = armRecordFromDriver({ ...full(), cost: undefined } as Tau2Raw);
    expect(record.cost).toBeUndefined();
  });

  it('omits the release when the checkout could not say, rather than guessing one', () => {
    const record = armRecordFromDriver({ ...full(), benchmark: undefined } as Tau2Raw);
    expect(record.benchmark).toBeUndefined();
  });

  it('omits the query census when the arm did not record one, rather than implying it was pinned', () => {
    // An artefact written before R92 cannot say whether two arms asked the same questions. The absence
    // has to read as "not recorded", because a `replaced: 0` would read as "the same queries ran".
    const record = armRecordFromDriver({
      ...full(),
      queries: undefined,
    } as Tau2Raw);
    expect(record.queries).toBeUndefined();
  });

  it('folds every field it says it folds, and does not pass it through under its own name', () => {
    // A `reduced` decision flipped without the mapping moving would leave a field both folded and
    // copied, which is how a projection starts carrying two copies of one fact. `coverage` and
    // `use` are the reduced names, and they are different keys, so the raw names must be absent.
    const record = armRecordFromDriver(full()) as Record<string, unknown>;
    const leaked = reduced.filter((field) => field in record);
    expect(leaked).toEqual([]);
  });
});

describe('the write path is recorded beside its result', () => {
  it('carries the mode and the census when the driver reported them', () => {
    const record = armRecordFromDriver(
      raw({
        writeAdmission: { mode: 'neighbours', rephrased: 3, suppressed: 5 },
      }),
    );
    // Without this field an arm that switched admission on and an arm that never
    // asked produce indistinguishable artefacts, and the delta between them is the
    // whole experiment.
    expect(record.writeAdmission).toEqual({
      mode: 'neighbours',
      rephrased: 3,
      suppressed: 5,
    });
  });

  it('reports nothing on an artefact written before the switch existed', () => {
    // Absent is not `off`: every artefact before the switch ran a store that accepted
    // every claim, but none of them measured what that accepted, and a default here
    // would publish a census for a run that never took one.
    expect(armRecordFromDriver(raw()).writeAdmission).toBeUndefined();
  });
});

describe('the coverage curve is not computed from a filtered population', () => {
  const observed = [
    { query: 'q1', statements: ['a'] },
    { query: 'q2', statements: [] },
  ];
  const ungated = [
    { query: 'q1', statements: ['a'] },
    { query: 'q2', statements: ['b'] },
    { query: 'q3', statements: [] },
  ];

  it('prices the floor against the observations it was applied to', () => {
    // The graded facade of a paired run has already passed the floor, so a curve
    // over its own observations reports the floor as free. The `use` census keeps
    // describing the graded facade; only the curve moves to the ungated one.
    const record = armRecordFromDriver(
      raw({ useObservations: observed, coverageObservations: ungated }),
    );
    expect(record.coverage?.measuredPairs).toBe(2);
    expect(record.use?.recallRequests).toBe(2);
    expect(record.use?.injectedPairs).toBe(1);
  });

  it('falls back to the graded facade when no ungated population was recorded', () => {
    const record = armRecordFromDriver(raw({ useObservations: observed }));
    expect(record.coverage?.measuredPairs).toBe(1);
    expect(record.use?.recallRequests).toBe(2);
  });
});
