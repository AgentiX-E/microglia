import { describe, expect, it } from 'vitest';
import { GATE_ORDER } from '@agentix-e/microglia-protocol';
import {
  TAU2_GATE_INDEX,
  createTau2Adapter,
  parseTau2Candidate,
  renderTau2Pack,
  scoreTau2Candidate,
  tau2ArmRecordOf,
  tau2DetectablePp,
  tau2GateAudit,
  tau2ProtocolInput,
  tau2Strata,
  tau2Tasks,
  type Tau2Evidence,
} from '../index.js';
import { L4ParseError } from '../l4.js';

/**
 * The τ² lane's two new obligations, tested where they can fail.
 *
 * Three properties matter and none of them is "the numbers are right", because the numbers are the
 * benchmark's:
 *
 *  1. **The reader survives the document shapes τ² actually ships.** Free-text and structured
 *     instructions, a reward that is `null`, a breakdown whose entries are objects rather than
 *     scalars — each of those is a silent-empty defect waiting to happen.
 *  2. **The projection never invents a fact.** A field that is absent must produce an absent gate,
 *     and a call tally of zero must read as "nobody counted" rather than as perfect reliability.
 *  3. **The index covers the protocol exactly.** Thirteen supplyable plus twenty-six arm-indexed is
 *     thirty-nine, and a gate that appears in neither table is a gate the audit would silently drop
 *     from every future τ² report.
 */

/** A minimal well-formed τ² result document, in the shape upstream's `Results` uses. */
const document = {
  info: { environment_info: { domain_name: 'retail' } },
  tasks: [
    {
      id: '7',
      user_scenario: { instructions: 'Swap my two orders.' },
      evaluation_criteria: {
        actions: [{ name: 'get_order_details' }, { name: 'exchange_delivered_order_items' }],
        reward_basis: ['DB', 'ACTION'],
      },
    },
    {
      id: '9',
      user_scenario: {
        instructions: {
          reason_for_call: 'Refund',
          task_instructions: 'Refund the cheapest item.',
        },
      },
      evaluation_criteria: { reward_basis: ['DB'] },
    },
  ],
};

describe('reading a τ² task document', () => {
  it('keeps document order, because every fold partition is computed over it', () => {
    expect(tau2Tasks(document).map((task) => task.id)).toEqual(['7', '9']);
  });

  it('reads the free-text instruction form', () => {
    expect(tau2Tasks(document)[0]?.instruction).toBe('Swap my two orders.');
  });

  it('reads the structured instruction form, which is a different field', () => {
    // `UserScenario.instructions` is `str | StructuredUserInstructions`. A reader that assumed the
    // string form would return an empty instruction for every structured domain and report a
    // prompt that said nothing.
    expect(tau2Tasks(document)[1]?.instruction).toBe('Refund Refund the cheapest item.');
  });

  it('carries the reference actions and the reward basis', () => {
    const [first, second] = tau2Tasks(document);
    expect(first?.referenceActions).toEqual(['get_order_details', 'exchange_delivered_order_items']);
    expect(first?.rewardBasis).toEqual(['DB', 'ACTION']);
    expect(second?.referenceActions).toEqual([]);
    expect(second?.rewardBasis).toEqual(['DB']);
  });

  it('names the domain from the run info, and says `unknown` rather than guessing', () => {
    expect(tau2Tasks(document)[0]?.domain).toBe('retail');
    expect(tau2Tasks({ tasks: [{ id: '1' }] })[0]?.domain).toBe('unknown');
  });

  it('refuses a document with no task list', () => {
    expect(() => tau2Tasks({})).toThrow(L4ParseError);
    expect(() => tau2Tasks({ tasks: 'seven' })).toThrow(L4ParseError);
  });

  it('refuses a task without an id, because an id is what a pair joins on', () => {
    expect(() => tau2Tasks({ tasks: [{ user_scenario: {} }] })).toThrow(L4ParseError);
  });

  it('refuses two tasks with one id, which would pair a question with itself', () => {
    // `compareArms` builds a Map from the rows, so a duplicated id is dropped there without a word;
    // the loader is the only place it can be caught.
    expect(() => tau2Tasks({ tasks: [{ id: '4' }, { id: '4' }] })).toThrow(L4ParseError);
  });
});

describe('the pack block and the candidate', () => {
  it('renders nothing for an empty pack, rather than a header over nothing', () => {
    // A `## What you know` with no entries tells the model it knows nothing, which is a different
    // condition from the reference arm, which says nothing at all.
    expect(renderTau2Pack({ rendered: '   ', ids: [] })).toBe('');
    expect(renderTau2Pack({ rendered: '- a rule', ids: ['r1'] })).toBe('- a rule\n\n');
  });

  it('reads a receipt into a candidate, with its decomposition sorted', () => {
    const candidate = parseTau2Candidate(
      JSON.stringify({
        task_id: '7',
        reward_info: {
          reward: 1,
          reward_breakdown: { DB: 1, ACTION: 0.5 },
        },
      }),
    );
    expect(candidate).toEqual({
      reward: 1,
      checks: [
        { check: 'ACTION', value: 0.5 },
        { check: 'DB', value: 1 },
      ],
    });
  });

  it('preserves a null reward, which is an infrastructure error and not a failure', () => {
    const candidate = parseTau2Candidate(JSON.stringify({ reward_info: { reward: null } }));
    expect(candidate?.reward).toBeNull();
    expect(scoreTau2Candidate(candidate!)).toBe(false);
  });

  it('returns undefined for an entry with no verdict at all', () => {
    // Undefined is "the model did not answer in a form I can score"; counting it as a wrong answer
    // is how a lane reports its own harness failing as the model failing.
    expect(parseTau2Candidate(JSON.stringify({ task_id: '7' }))).toBeUndefined();
    expect(parseTau2Candidate('not json')).toBeUndefined();
    expect(parseTau2Candidate('[]')).toBeUndefined();
    expect(parseTau2Candidate(JSON.stringify({ reward_info: { reward: 'one' } }))).toBeUndefined();
  });

  it('scores a near miss as a miss', () => {
    // τ²'s reward is a weighted sum of checks; 0.999 is a near miss, not a pass.
    expect(scoreTau2Candidate({ reward: 0.999, checks: [] })).toBe(false);
    expect(scoreTau2Candidate({ reward: 1, checks: [] })).toBe(true);
  });

  it('ignores a breakdown entry that is not a number, rather than coercing it', () => {
    // `reward_breakdown` is `dict[RewardType, float]`. A string here means the document is not the
    // document upstream ships, and a lane that coerced it would publish a decomposition it made up.
    const candidate = parseTau2Candidate(
      JSON.stringify({ reward_info: { reward: 0, reward_breakdown: { DB: 'high', ACTION: 0 } } }),
    );
    expect(candidate?.checks).toEqual([{ check: 'ACTION', value: 0 }]);
  });
});

describe('the strata are outcome-blind by construction', () => {
  it('names the domain and the reward basis', () => {
    expect(tau2Strata(tau2Tasks(document)[0]!)).toEqual(['domain:retail', 'basis:ACTION+DB']);
  });

  it('says the basis is unspecified rather than emitting an empty label', () => {
    expect(tau2Strata({ id: '1', instruction: '', domain: 'airline', rewardBasis: [], referenceActions: [] })).toEqual([
      'domain:airline',
      'basis:unspecified',
    ]);
  });
});

describe('the adapter implements the five-method contract', () => {
  const adapter = createTau2Adapter(tau2Tasks(document));

  it('loads the corpus it was built from, in order', async () => {
    expect((await adapter.load()).map((task) => task.id)).toEqual(['7', '9']);
  });

  it('places the pack above the instruction', async () => {
    const [task] = await adapter.load();
    expect(adapter.prompt(task!, { rendered: '- a rule', ids: ['r1'] })).toBe(
      '- a rule\n\nSwap my two orders.',
    );
    expect(adapter.prompt(task!, { rendered: '', ids: [] })).toBe('Swap my two orders.');
  });

  it('parses and scores through the same functions the lane uses', async () => {
    const [task] = await adapter.load();
    const candidate = adapter.parse(JSON.stringify({ reward_info: { reward: 1 } }));
    expect(candidate).toBeDefined();
    expect(await adapter.score(task!, candidate!)).toBe(true);
  });

  it('stratifies on the task alone, which is the enforcement the signature promises', async () => {
    const [task] = await adapter.load();
    expect(adapter.strata(task!)).toEqual(tau2Strata(task!));
  });
});

describe('the projection supplies what the record holds and nothing else', () => {
  it('states the two facts that are always true of this lane', () => {
    const { input, supplied } = tau2ProtocolInput({ domain: 'retail', trialCount: 4 });
    expect(input.packControls).toEqual([]);
    expect(input.channelBest).toBeUndefined();
    // No pack-based control and no channel control ran, and saying so is what lets those gates fire
    // and be recognised as vacuous rather than be silently omitted.
    expect(supplied).toEqual(['controls', 'channel']);
  });

  it('computes the detectability from the discordance, in percentage points', () => {
    // 68 paired, 27 discordant: sqrt(2.802² × (27/68) / 68) = 0.2141.
    const pp = tau2DetectablePp({
      paired: 68,
      onlyFirst: 0,
      onlySecond: 0,
      lost: 13,
      gained: 14,
      deltaPp: 1.47,
    });
    expect(pp).toBeCloseTo(21.41, 2);
  });

  it('returns no detectability when there was nothing to detect', () => {
    expect(tau2DetectablePp(undefined)).toBeUndefined();
    expect(
      tau2DetectablePp({ paired: 0, onlyFirst: 0, onlySecond: 0, lost: 0, gained: 0, deltaPp: 0 }),
    ).toBeUndefined();
    // Every task agreed: the minimum detectable difference does not exist, and reporting Infinity
    // would be a number where the truth is a refusal.
    expect(
      tau2DetectablePp({ paired: 10, onlyFirst: 0, onlySecond: 0, lost: 0, gained: 0, deltaPp: 0 }),
    ).toBeUndefined();
  });

  it('counts a leak from the split rather than trusting the arm totals', () => {
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 3,
        trials: 4,
        unscored: 0,
        split: { train: ['1', '2'], test: ['3', '2', '3'] },
      },
      comparison: {
        paired: 3,
        onlyFirst: 0,
        onlySecond: 1,
        lost: 1,
        gained: 0,
        deltaPp: -33,
      },
    });
    expect(supplied).toContain('partition');
    // '2' was taught and evaluated, and '3' was evaluated twice: the two defects a split exists to
    // prevent, both invisible in the arm's own totals.
    expect(input.partition).toEqual({ evaluated: 3, total: 4, duplicated: 1, leaked: 1 });
  });

  it('has no partition to state when the split was never recorded', () => {
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: { arm: 'memory', tasks: 68, trials: 4, unscored: 0 },
      comparison: { paired: 68, onlyFirst: 0, onlySecond: 0, lost: 13, gained: 14, deltaPp: 1.47 },
    });
    expect(input.partition).toBeUndefined();
    expect(supplied).not.toContain('partition');
  });

  it('reads a call tally of zero as an absent tally, not as perfect reliability', () => {
    // The committed arms carry `calls: 0` beside sixty-eight scored tasks, which is impossible: the
    // counter was never incremented. Reporting 0% failure from it would be the best possible score
    // for the least possible evidence.
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: { arm: 'memory', tasks: 68, trials: 4, unscored: 0, calls: { calls: 0, failures: 0 } },
    });
    expect(input.callFailureRate).toBeUndefined();
    expect(supplied).not.toContain('callFailureRate');
  });

  it('derives the failure rate when the tally exists', () => {
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: { arm: 'memory', tasks: 68, trials: 4, unscored: 0, calls: { calls: 200, failures: 3 } },
    });
    expect(supplied).toContain('callFailureRate');
    expect(input.callFailureRate).toBeCloseTo(0.015, 6);
    expect(input.calls).toBe(200);
    expect(input.callFailures).toBe(3);
  });

  it('carries the learning and provenance blocks when the driver wrote them', () => {
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 68,
        trials: 4,
        unscored: 0,
        meanPackIds: 2.5,
        learning: { rows: 60, unanswered: 1, edited: 59, distillFailed: 0 },
        domainOrigin: { storedWithDomain: 59, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
      },
    });
    expect(supplied).toEqual(
      expect.arrayContaining(['meanPackIds', 'learning', 'domainOrigin', 'parseRate']),
    );
    expect(input.meanPackIds).toBe(2.5);
    expect(input.learning).toEqual({ rows: 60, unanswered: 1, edited: 59, distillFailed: 0 });
    expect(input.domainOrigin?.storedWithDomain).toBe(59);
  });

  it('computes the parse rate from the denominator the reader actually dropped', () => {
    const { input } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: { arm: 'memory', tasks: 10, trials: 4, unscored: 2 },
    });
    expect(input.parseRate).toBeCloseTo(0.8, 6);
  });

  it('reports no parse rate for an arm that scored nothing', () => {
    const { input, supplied } = tau2ProtocolInput({
      domain: 'retail',
      trialCount: 4,
      memory: { arm: 'memory', tasks: 0, trials: 4, unscored: 0 },
    });
    expect(input.parseRate).toBeUndefined();
    expect(supplied).not.toContain('parseRate');
  });
});

describe('the audit accounts for every gate in the protocol', () => {
  /** The two committed arms, as the projection sees them: a grid, and nothing else. */
  const committed: Tau2Evidence = {
    domain: 'retail',
    trialCount: 4,
    reference: { arm: 'reference', tasks: 68, trials: 4, unscored: 0 },
    memory: { arm: 'memory', tasks: 68, trials: 4, unscored: 0 },
    comparison: { paired: 68, onlyFirst: 0, onlySecond: 0, lost: 13, gained: 14, deltaPp: 1.47 },
  };

  it('fires four gates on the record that exists, and calls two of them vacuous', () => {
    // The measurement stage 2 was registered to make. Two gates fire with an empty arm behind them
    // and pass, so the count of gates that carry information is two, not four.
    const audit = tau2GateAudit(committed);
    expect(audit.evaluable).toEqual([
      'V3-parse-rate',
      'V5-resolution',
      'V6-controls-inject',
      'V7-channel',
    ]);
    expect(audit.vacuous).toEqual(['V6-controls-inject', 'V7-channel']);
  });

  it('fails the resolution gate, at the number the arithmetic gives', () => {
    const audit = tau2GateAudit(committed);
    const resolution = audit.gates.find((entry) => entry.id === 'V5-resolution');
    expect(resolution?.pass).toBe(false);
    expect(resolution?.blocking).toBe(true);
    expect(resolution?.actual).toContain('21.41pp');
  });

  it('gives V1 its population when the arm record carries the census', () => {
    // The sentence the pair report could not print in R43: the artefact held `24 stored / 0 active`
    // and `1,518 requests / 0 served`, `tau2ArmRecordOf` dropped both, and the gate fell back to the
    // bare rate. The reading that separates "never asked" from "asked and served nothing" is the whole
    // difference between a memory that was not used and a memory that could not be reached.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      reference: tau2ArmRecordOf('reference', { n: 50, metrics: { tasks: 50, k: 4 } }),
      memory: tau2ArmRecordOf('memory', {
        n: 50,
        metrics: { tasks: 50, k: 4 },
        tau2: {
          meanPackIds: 0,
          store: { stored: 24, active: 0, servable: 0, statuses: { active: 0, candidate: 24 } },
          recall: { requests: 1518, served: 0, empty: 1518 },
        },
      }),
      comparison: { paired: 50, onlyFirst: 0, onlySecond: 0, lost: 8, gained: 6, deltaPp: -4 },
    });
    const pack = audit.gates.find((entry) => entry.id === 'V1-pack-not-empty');
    expect(pack?.actual).toBe(
      '0.00 rules/question: 0 of 1518 request(s) carried an item, from a store of 24 (0 active, 0 in scope)',
    );
  });

  it('names an arm for every gate it cannot fire', () => {
    const audit = tau2GateAudit(committed);
    expect(audit.absent).toHaveLength(35);
    expect(audit.absent.every((entry) => entry.needs.trim() !== '')).toBe(true);
    expect(audit.absent.map((entry) => entry.id)).toContain('V45-clearance-dose-matched');
  });

  it('distinguishes a gate the lane could feed from one that needs an arm it never ran', () => {
    // `V1-pack-not-empty` needs nothing but a counter the driver forgot to write; `V46-raw-is-verbatim`
    // needs an arm. Reporting both as "absent" would hide the difference between a missing field and
    // a missing experiment, and the two have different fixes.
    const audit = tau2GateAudit(committed);
    const pack = audit.absent.find((entry) => entry.id === 'V1-pack-not-empty');
    const raw = audit.absent.find((entry) => entry.id === 'V46-raw-is-verbatim');
    expect(pack?.needs).toContain('recalled items');
    expect(raw?.needs).toContain('raw arm');
  });

  it('reaches thirteen gates when every field the lane can produce is present', () => {
    // The lane's ceiling, measured on the record type rather than on a run: no τ² run has produced
    // this artefact, and the audit says so by counting it as thirteen supplyable rather than as
    // thirteen measured. The four transfer ids arrived with R29 stage 2, and they come from one
    // reading rather than from four arms.
    const instrumented: Tau2Evidence = {
      domain: 'retail',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 68,
        trials: 4,
        unscored: 0,
        meanPackIds: 2.5,
        calls: { calls: 200, failures: 1 },
        learning: { rows: 60, unanswered: 0, edited: 60, distillFailed: 0 },
        domainOrigin: { storedWithDomain: 60, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
        split: { train: ['1', '2'], test: ['7', '9'] },
      },
      reference: { arm: 'reference', tasks: 68, trials: 4, unscored: 0 },
      comparison: { paired: 2, onlyFirst: 0, onlySecond: 0, lost: 1, gained: 0, deltaPp: -50 },
      transfer: {
        trials: 40,
        informative: 12,
        repaired: 3,
        blankRight: 27,
        unmeasured: 1,
        unmeasuredBlank: 1,
        ledger: 40,
        measured: 39,
        broke: 2,
        netPp: 2.5641,
        verdict: 'unmeasured',
      },
    };
    const audit = tau2GateAudit(instrumented);
    expect(audit.evaluable).toHaveLength(13);
    expect(audit.absent).toHaveLength(26);
    expect(audit.supplyable).toBe(13);
    expect(audit.armIndexed).toBe(26);
  });

  it('grades the record a failed learning half leaves behind, and fails it in four places', () => {
    // The R41 dispatch's shape, as the projection sees it: thirty-two corrections, a distiller that
    // failed on every one, a store with nothing in it, and a client that sent thirty-two prompts and
    // got thirty-two refusals. All four readings were available at the time and none of them reached
    // the artefact — `V32` and `V8` were absent, `V44` passed on `0 <= 0`, and only `V1` said
    // anything was wrong. The gates are the deliverable: the same run now fails for four reasons,
    // each naming a different part of the machinery.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 50,
        trials: 4,
        unscored: 0,
        meanPackIds: 0,
        calls: { calls: 32, failures: 32, scope: 'distillation' },
        learning: { rows: 32, unanswered: 0, edited: 32, distilled: 0, distillFailed: 32 },
        domainOrigin: { storedWithDomain: 0, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
      },
      comparison: { paired: 50, onlyFirst: 0, onlySecond: 0, lost: 7, gained: 2, deltaPp: -10 },
    });
    const byId = new Map(audit.gates.map((gate) => [gate.id, gate]));
    expect(byId.get('V1-pack-not-empty')?.pass).toBe(false);
    expect(byId.get('V32-fold-learning-intact')?.pass).toBe(false);
    expect(byId.get('V44-domain-accounted')?.pass).toBe(false);
    expect(byId.get('V8-call-reliability')?.pass).toBe(false);
    expect(byId.get('V8-call-reliability')?.actual).toContain('32/32 calls');
    expect(audit.absent.map((entry) => entry.id)).not.toContain('V32-fold-learning-intact');
    expect(audit.absent.map((entry) => entry.id)).not.toContain('V8-call-reliability');
  });

  it('passes the same four when the store was built and the calls answered', () => {
    // The other side of the same reading, so the four gates are not simply gates that always fail.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 50,
        trials: 4,
        unscored: 0,
        meanPackIds: 2.1,
        calls: { calls: 32, failures: 0, scope: 'distillation' },
        learning: { rows: 32, unanswered: 0, edited: 32, distilled: 30, distillFailed: 0 },
        domainOrigin: { storedWithDomain: 30, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
      },
      comparison: { paired: 50, onlyFirst: 0, onlySecond: 0, lost: 7, gained: 2, deltaPp: -10 },
    });
    const byId = new Map(audit.gates.map((gate) => [gate.id, gate]));
    expect(byId.get('V1-pack-not-empty')?.pass).toBe(true);
    expect(byId.get('V32-fold-learning-intact')?.pass).toBe(true);
    expect(byId.get('V44-domain-accounted')?.pass).toBe(true);
    expect(byId.get('V8-call-reliability')?.pass).toBe(true);
  });

  it('gives V1 the population behind the rate when the arm recorded one', () => {
    // The R42 shape: fourteen items, all active, all inside the recall scope, and two hundred
    // requests that carried none of them. That is the facade dropping what the store offered — a
    // different defect from R41's empty store — and the gate's sentence now says which.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 50,
        trials: 4,
        unscored: 0,
        meanPackIds: 0,
        calls: { calls: 7, failures: 0, scope: 'distillation' },
        learning: { rows: 32, unanswered: 25, edited: 7, distilled: 14, distillFailed: 0 },
        domainOrigin: { storedWithDomain: 14, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
        store: {
          stored: 14,
          active: 14,
          servable: 14,
          statuses: { active: 14, candidate: 0, quarantined: 0, retired: 0, other: 0 },
        },
        recall: { requests: 200, served: 0, empty: 200 },
      },
      comparison: { paired: 50, onlyFirst: 0, onlySecond: 0, lost: 2, gained: 4, deltaPp: 4 },
    });
    const v1 = audit.gates.find((gate) => gate.id === 'V1-pack-not-empty');
    expect(v1?.pass).toBe(false);
    expect(v1?.actual).toBe(
      '0.00 rules/question: 0 of 200 request(s) carried an item, from a store of 14 (14 active, 14 in scope)',
    );
  });

  it('leaves V1 as a bare rate on an arm that did not record the population', () => {
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      memory: {
        arm: 'memory',
        tasks: 50,
        trials: 4,
        unscored: 0,
        meanPackIds: 0,
        learning: { rows: 32, unanswered: 0, edited: 32, distilled: 0, distillFailed: 32 },
      },
      comparison: { paired: 50, onlyFirst: 0, onlySecond: 0, lost: 7, gained: 2, deltaPp: -10 },
    });
    expect(audit.gates.find((gate) => gate.id === 'V1-pack-not-empty')?.actual).toBe('0.00 rules/question');
  });

  it('grades the four transfer gates on a cross-domain reading, and fails the floor', () => {
    // What R29 stage 2 buys: the transfer family is graded on a second scenario rather than absent
    // from it. `V15` reconciles the three buckets, `V33` counts the pairs, `V17` re-derives the net
    // from its own counts, and `V16` is expected to fail — a foreign pack produces too few
    // informative episodes to clear a hundred, and a pass there would mean the floor was being
    // cleared by episodes that were not informative.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      transfer: {
        trials: 96,
        informative: 21,
        repaired: 4,
        blankRight: 70,
        unmeasured: 5,
        unmeasuredBlank: 2,
        ledger: 96,
        measured: 91,
        broke: 3,
        netPp: 1.0989,
        verdict: 'unmeasured',
      },
    });
    const byId = new Map(audit.gates.map((gate) => [gate.id, gate]));
    expect(byId.get('V15-transfer-reconciles')?.pass).toBe(true);
    expect(byId.get('V33-transfer-ledger')?.pass).toBe(true);
    expect(byId.get('V17-transfer-net-reported')?.pass).toBe(true);
    expect(byId.get('V16-transfer-resolvable')?.pass).toBe(false);
    expect(byId.get('V16-transfer-resolvable')?.blocking).toBe(false);
    expect(audit.evaluable).toContain('V15-transfer-reconciles');
  });

  it('refuses a transfer summary whose net does not follow from its own counts', () => {
    // The one arithmetic V17 exists for: a summary that reports a net the pairs cannot produce is
    // the failure mode the gate was written after, so the projection must not launder it.
    const audit = tau2GateAudit({
      domain: 'airline',
      trialCount: 4,
      transfer: {
        trials: 10,
        informative: 2,
        repaired: 2,
        blankRight: 8,
        unmeasured: 0,
        ledger: 10,
        measured: 10,
        broke: 0,
        netPp: 47,
        verdict: 'unmeasured',
      },
    });
    const net = audit.gates.find((gate) => gate.id === 'V17-transfer-net-reported');
    expect(net?.pass).toBe(false);
  });

  it('fires only the two vacuous gates when the evidence is a domain and a trial count', () => {
    const audit = tau2GateAudit({ domain: 'retail', trialCount: 4 });
    expect(audit.evaluable).toEqual(['V6-controls-inject', 'V7-channel']);
    expect(audit.absent).toHaveLength(37);
  });

  it('keeps the two tables and the protocol in exact agreement', () => {
    // The invariant the whole file rests on. A gate in neither table would vanish from the audit
    // without appearing in `absent`, which is precisely the silent omission this record keeps
    // finding; a gate in both would be counted twice.
    const ids = [
      ...TAU2_GATE_INDEX.supplyable.map((entry) => entry.id),
      ...TAU2_GATE_INDEX.armIndexed.map((entry) => entry.id),
    ];
    expect(ids).toHaveLength(GATE_ORDER.length);
    expect(new Set(ids).size).toBe(GATE_ORDER.length);
    expect([...ids].sort()).toEqual([...GATE_ORDER].sort());
  });

  it('sorts its absences into publication order, so two reports diff line by line', () => {
    const audit = tau2GateAudit(committed);
    const positions = audit.absent.map((entry) => GATE_ORDER.indexOf(entry.id));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });
});

describe('reading an arm artefact', () => {
  it('takes the grid counts from the metrics every version of the lane writes', () => {
    const record = tau2ArmRecordOf('memory', {
      n: 68,
      metrics: { tasks: 68, k: 4, unscored_tasks: 2 },
    });
    expect(record).toMatchObject({ arm: 'memory', tasks: 68, trials: 4, unscored: 2 });
  });

  it('falls back to `n` when the metrics block omits the task count', () => {
    expect(tau2ArmRecordOf('memory', { n: 68, metrics: {} }).tasks).toBe(68);
  });

  it('reports zero rather than NaN for an artefact with no metrics at all', () => {
    const record = tau2ArmRecordOf('reference', {});
    expect(record).toMatchObject({ tasks: 0, trials: 0, unscored: 0 });
  });

  it('carries the optional block forward only when it is there', () => {
    const bare = tau2ArmRecordOf('memory', { n: 1, metrics: {} });
    expect(bare.meanPackIds).toBeUndefined();
    expect(bare.calls).toBeUndefined();
    expect(bare.learning).toBeUndefined();
    expect(bare.domainOrigin).toBeUndefined();
    expect(bare.split).toBeUndefined();
    expect(bare.scenario).toBeUndefined();
    expect(bare.store).toBeUndefined();
    expect(bare.recall).toBeUndefined();
    expect(bare.use).toBeUndefined(); // pre-R46 artefacts report no use census

    const rich = tau2ArmRecordOf('memory', {
      n: 1,
      metrics: {},
      tau2: {
        meanPackIds: 3,
        calls: { calls: 10, failures: 1 },
        learning: { rows: 1, unanswered: 0, edited: 1, distillFailed: 0 },
        domainOrigin: { storedWithDomain: 1, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
        split: { train: ['a'], test: ['b'] },
        scenario: { learn: 'retail', test: 'airline', recall: 'retail' },
        store: { stored: 24, active: 0, servable: 0, statuses: { active: 0, candidate: 24, quarantined: 0, retired: 0, other: 0 } },
        recall: { requests: 1518, served: 0, empty: 1518 },
      },
    });
    expect(rich.meanPackIds).toBe(3);
    expect(rich.calls).toEqual({ calls: 10, failures: 1 });
    expect(rich.split).toEqual({ train: ['a'], test: ['b'] });
    // A cross-domain arm's provenance survives the file: without it a reader of one arm cannot tell
    // which scenario the store learned in, and the transfer measurement's treatment is unnamed.
    expect(rich.scenario).toEqual({ learn: 'retail', test: 'airline', recall: 'retail' });
  });

  it('carries the store census into the record, because the gate that prints it reads the record', () => {
    // R43's pair report printed `0.00 rules/question` with no population -- the sentence this round
    // added. The artefact had the census and this function dropped it, so the gate could not say how
    // many items the zero came from. A block that is present in the file and absent from the record is
    // invisible to every consumer downstream of the record, which is all of them.
    const record = tau2ArmRecordOf('memory', {
      n: 50,
      metrics: { tasks: 50, k: 4 },
      tau2: {
        meanPackIds: 0,
        store: { stored: 24, active: 0, servable: 0, statuses: { active: 0, candidate: 24 } },
        recall: { requests: 1518, served: 0, empty: 1518 },
      },
    });
    expect(record.store).toMatchObject({ stored: 24, active: 0, servable: 0 });
    expect(record.recall).toEqual({ requests: 1518, served: 0, empty: 1518 });
  });

  it('carries the use census forward, so a served pack can be read for relevance', () => {
    // R45 served 1480 of 1480 requests and its artefact could not say what was in
    // them. A projection that dropped `use` would keep that silence forever: the
    // gate layer reads the record, never the file.
    const census = {
      arm: 'as-is' as const,
      recallRequests: 1480,
      recallServed: 1480,
      meanPackIds: 1.84,
      injectedPairs: 2723,
      zeroCoveragePairs: 2066,
      widenedItems: 0,
    };
    const record = tau2ArmRecordOf('memory', {
      n: 50,
      metrics: { tasks: 50, k: 4 },
      tau2: { meanPackIds: 1.84, use: census },
    });
    expect(record.use).toEqual(census);
  });
});
