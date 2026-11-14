import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy, type DistillCandidate, type KnowledgeItem } from '../../kernel/index.js';
import {
  clusterCensusOf,
  clusterSources,
  deterministicProposal,
  seedTriggerOf,
  sourcesOf,
  type RetrospectCluster,
} from '../cluster.js';
import type { RetrospectSource } from '../types.js';

const at = 1_700_000_000_000;

function item(overrides: Partial<DistillCandidate> = {}, id = 'k1'): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.support' },
    statement: 'Refund the shipping fee when the item arrived damaged.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

function source(overrides: Partial<RetrospectSource> = {}): RetrospectSource {
  return {
    id: 'k1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested for a damaged item',
    task: 'retail.support',
    taskId: 'task-a',
    outcome: 'repair',
    confidence: 0.8,
    at,
    ...overrides,
  };
}

describe('what the store calls a correction is decided by kind, not by age', () => {
  it('reads a constraint as a repair and a procedure as a success', () => {
    // R99's store was 79% pass-derived and the arm lost three points to a smaller store of
    // repairs. The distinction has to be mechanical, or every future run has to be read.
    const [constraint, procedure] = sourcesOf([
      item({ kind: 'constraint' }, 'k1'),
      item({ kind: 'procedure' }, 'k2'),
    ]);
    expect(constraint?.outcome).toBe('repair');
    expect(procedure?.outcome).toBe('pass');
  });

  it('treats an exemplar as a success and a negative as a repair', () => {
    const [exemplar, negative] = sourcesOf([item({ kind: 'exemplar' }, 'k1'), item({ kind: 'negative' }, 'k2')]);
    expect(exemplar?.outcome).toBe('pass');
    expect(negative?.outcome).toBe('repair');
  });

  it('takes the host’s classifier when its kind field does not carry the polarity', () => {
    // The τ² lane writes every record as an exemplar, including the ones distilled from
    // corrections, so the default classifier read a 73-record store as 73 successes and the
    // pipeline then refused to build a batch. A lane that knows better says so.
    const [record] = sourcesOf([item({ kind: 'exemplar' }, 'k1')], {
      outcomeOf: () => 'repair',
    });
    expect(record?.outcome).toBe('repair');
  });

  it('carries the condition only when the record has one', () => {
    const [bare, conditioned] = sourcesOf([item({}, 'k1'), item({ when: 'when a refund is requested' }, 'k2')]);
    expect('when' in (bare as RetrospectSource)).toBe(false);
    expect(conditioned?.when).toBe('when a refund is requested');
  });

  it('takes the distinct-task identity from the narrowest scope that declares one', () => {
    // Support is counted per task, so a record whose scope carries an intent or a domain is
    // about that sub-population rather than about the whole task.
    const [byIntent, byDomain, byTask] = sourcesOf([
      item({ scope: { task: 'retail.support', intent: 'refund' } }, 'k1'),
      item({ scope: { task: 'retail.support', domain: 'retail' } }, 'k2'),
      item({ scope: { task: 'retail.support' } }, 'k3'),
    ]);
    expect(byIntent?.taskId).toBe('refund');
    expect(byDomain?.taskId).toBe('retail');
    expect(byTask?.taskId).toBe('retail.support');
  });
});

describe('clustering groups by situation, not by topic', () => {
  it('merges two repairs whose triggers overlap above the floor', () => {
    const clusters = clusterSources([
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item and the box is open' }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members.map((member) => member.id)).toEqual(['k1', 'k2']);
  });

  it('leaves a success out of the group it would otherwise join', () => {
    const clusters = clusterSources([
      source({ id: 'k1' }),
      source({ id: 'k2' }),
      source({ id: 'p1', outcome: 'pass' }),
    ]);
    expect(clusters[0]?.members.map((member) => member.id)).toEqual(['k1', 'k2']);
  });

  it('refuses to merge across tasks, because a task is a scope rather than a topic', () => {
    const clusters = clusterSources([
      source({ id: 'k1', task: 'retail.support' }),
      source({ id: 'k2', task: 'airline.support' }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('merges across tasks when the policy asks for it', () => {
    const clusters = clusterSources(
      [source({ id: 'k1', task: 'retail.support' }), source({ id: 'k2', task: 'airline.support' })],
      { threshold: 0.6, crossTask: true },
    );
    expect(clusters).toHaveLength(1);
  });

  it('drops a group of one, which is a correction with a new name', () => {
    expect(clusterSources([source({ id: 'k1' }), source({ id: 'k2', when: 'when an exchange is requested' })])).toEqual(
      [],
    );
  });

  it('gives the same cluster id whatever order the store returns', () => {
    const a = source({ id: 'k1' });
    const b = source({ id: 'k2' });
    expect(clusterSources([a, b])[0]?.id).toBe(clusterSources([b, a])[0]?.id);
  });

  it('reports cohesion, so a loose cluster looks loose', () => {
    const clusters = clusterSources([
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item and the box is open' }),
    ]);
    expect(clusters[0]?.cohesion).toBeGreaterThan(0.5);
    expect(clusters[0]?.cohesion).toBeLessThan(1);
  });

  it('survives a triangle of similar triggers without unioning a pair twice', () => {
    const clusters = clusterSources([
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k3', when: 'when a refund is requested for a damaged item' }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toHaveLength(3);
  });

  it('cannot cluster a correction that never declared a condition', () => {
    const clusters = clusterSources([source({ id: 'k1', when: undefined }), source({ id: 'k2', when: undefined })]);
    expect(clusters).toEqual([]);
  });
});

describe('the seed trigger is the one every member entails', () => {
  it('intersects the members and keeps the shortest trigger order', () => {
    const trigger = seedTriggerOf([
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item and the box is open' }),
    ]);
    expect(trigger).toBe('refund requested damaged item');
  });

  it('does not repeat a word that appears twice', () => {
    // The duplicate is in the shortest trigger, because that is the one the order comes
    // from — a de-duplication that only ever runs on the other member never runs.
    expect(
      seedTriggerOf([
        source({ id: 'k1', when: 'when a refund refund is requested' }),
        source({ id: 'k2', when: 'when a refund refund is requested for a damaged item' }),
      ]),
    ).toBe('refund requested');
  });

  it('drops a word the other member does not share, even from the shortest', () => {
    // The intersection is the whole point: a word only one member names would make the
    // guideline narrower than that member and it would fail its own witness on it.
    expect(
      seedTriggerOf([
        source({ id: 'k1', when: 'when a refund shipping' }),
        source({ id: 'k2', when: 'when a refund is requested for a damaged item' }),
      ]),
    ).toBe('refund');
  });

  it('takes its order from whichever member is shortest, in either position', () => {
    const long = source({ id: 'k1', when: 'when a refund is requested for a damaged item' });
    const short = source({ id: 'k2', when: 'when a refund is requested' });
    expect(seedTriggerOf([long, short])).toBe('refund requested');
    expect(seedTriggerOf([short, long])).toBe('refund requested');
  });

  it('is empty for an empty group', () => {
    expect(seedTriggerOf([])).toBe('');
  });

  it('is empty when a member never declared a condition', () => {
    // A group containing an unconditional correction has no shared condition to state, and
    // saying nothing is the honest answer: the proposer then has to write one and be judged.
    expect(seedTriggerOf([source({ id: 'k1', when: undefined }), source({ id: 'k2' })])).toBe('');
  });
});

describe('the medoid is a function of the cluster, not of iteration order', () => {
  it('picks the member closest to the others', () => {
    const clusters = clusterSources([
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item and the box is open' }),
      source({ id: 'k3', when: 'when a refund is requested for a damaged item that arrived broken' }),
    ]);
    expect(clusters[0]?.medoid).toBeDefined();
    expect(clusters[0]?.medoid.id).toBe('k1');
  });

  it('breaks a tie by id so two runs cannot disagree', () => {
    const twin = (id: string): RetrospectSource => source({ id, when: 'when a refund is requested' });
    const first = clusterSources([twin('k1'), twin('k2')]);
    const second = clusterSources([twin('k2'), twin('k1')]);
    expect(first[0]?.medoid.id).toBe(second[0]?.medoid.id);
  });
});

describe('the no-model proposal copies rather than paraphrases', () => {
  const cluster = clusterSources([
    source({ id: 'k1', statement: 'Refund the shipping fee for a damaged item.' }),
    source({ id: 'k2', statement: 'Refund the shipping fee when the box arrived open.' }),
  ])[0] as RetrospectCluster;

  it('claims every member and takes the medoid claim verbatim', () => {
    const proposal = deterministicProposal(cluster);
    expect(proposal.covers).toEqual(['k1', 'k2']);
    expect(proposal.statement).toBe(cluster.medoid.statement);
  });

  it('carries the id of the cluster it came from, so a decision can be traced back', () => {
    expect(deterministicProposal(cluster).id).toBe(`gp_${cluster.id.slice(3)}`);
  });

  it('states the condition as the intersection rather than as the medoid’s own', () => {
    // The medoid's trigger would be narrower than the other member's, and a narrower
    // guideline does not cover the member it was merged with.
    expect(deterministicProposal(cluster).when).toBe('refund requested damaged item');
  });
});

describe('the census prices the grouping before a proposal is written', () => {
  it('counts the repairs no cluster claims, which is the price of a lexical key', () => {
    // Two repairs that fire together and one that shares no word with them: the synonym case this
    // pipeline's own header names as its cost. The orphan count is what an embedding edge or a model
    // splitter would have to earn back, so it is measured rather than argued.
    const sources = [
      source({ id: 'k1', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k2', when: 'when a refund is requested for a damaged item' }),
      source({ id: 'k3', when: 'when an address change arrives mid-delivery' }),
    ];
    const clusters = clusterSources(sources);
    const census = clusterCensusOf(sources, clusters);
    expect(census.repairs).toBe(3);
    expect(census.clustered).toBe(2);
    expect(census.orphans).toBe(1);
    expect(census.fragmentation).toBe(0.3333);
    expect(census.clusters).toBe(1);
  });

  it('reads a corpus nothing grouped as total fragmentation rather than as a perfect merge', () => {
    const sources = [
      source({ id: 'k1', when: 'when a refund is requested' }),
      source({ id: 'k2', when: 'when an address change arrives' }),
    ];
    const census = clusterCensusOf(sources, clusterSources(sources));
    expect(census.clusters).toBe(0);
    expect(census.fragmentation).toBe(1);
    expect(census.meanCohesion).toBe(0);
  });

  it('does not price a corpus with no repair at all, and says so with the counts', () => {
    // `0/0` is the vacuous share this project keeps catching. Zero here means "not measured", and
    // `repairs: 0` beside it is what says why.
    const sources = [source({ id: 'k1', outcome: 'pass' }), source({ id: 'k2', outcome: 'pass' })];
    const census = clusterCensusOf(sources, clusterSources(sources));
    expect(census.repairs).toBe(0);
    expect(census.fragmentation).toBe(0);
    expect(census.orphans).toBe(0);
  });

  it('names the clusters single-link pulled together, which are where a split belongs', () => {
    // A chain: `a~b` and `b~c` are each above the floor and `a~c` is not, so the cluster holds three
    // members whose mean pairwise cohesion is under it. The reviewer is offered a split, and this
    // count is what says how often that offer is worth making.
    const loose = [
      source({ id: 'k1', when: 'refund requested damaged item arrived' }),
      source({ id: 'k2', when: 'refund requested damaged item arrived late' }),
      source({ id: 'k3', when: 'refund requested late parcel' }),
    ];
    const clusters = clusterSources(loose, { threshold: 0.4, crossTask: false });
    const census = clusterCensusOf(loose, clusters, 0.9);
    // The floor is set above every observable cohesion on purpose: the assertion is that the count
    // follows the number the cluster already reports rather than a second definition of "loose".
    expect(census.chained).toBe(clusters.length);
    const strict = clusterCensusOf(loose, clusters, 0);
    expect(strict.chained).toBe(0);
  });
});
