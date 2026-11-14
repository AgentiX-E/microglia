/**
 * Grouping corrections into the units a guideline can be written from.
 *
 * Two decisions here are the whole design, and both come from a measurement rather than a
 * preference.
 *
 * **Only repairs may be consolidated.** R99's store held 73 records of which 58 were
 * pass-derived and carried the `order_id` of the run that produced them; the arm scored
 * 62.5% against 70.0% for a 15-record store of repairs. A pass record says "this attempt
 * worked", which is not a rule — it is an anecdote with an identifier. Consolidating
 * anecdotes produces confident generalities whose support is one lucky run, so passes are
 * admitted to the corpus as *counter-evidence* (does the guideline also match a task that
 * needed nothing?) and never as members.
 *
 * **Grouping is lexical and task-scoped, not embedding-based.** ALTK-Evolve clusters on
 * cosine similarity over `task_description` or `guideline_text`, which is the right unit
 * for a system whose guidelines have no condition field. This project's corrections do
 * have one, and a condition is a better clustering key than a distance: two corrections
 * that fire in the same situation belong together even when their wording diverges, and
 * two that share vocabulary but fire in different situations do not. The price is that a
 * synonym pair lands in different clusters; the benefit is that every grouping decision is
 * reproducible from the strings, which is what lets a reviewer see why a card exists.
 *
 * The `seed` proposal at the bottom is the consequence, and it is deliberately not a model
 * call: the trigger is the *intersection* of the members' triggers, so it is entailed by
 * every member by construction, and the statement is the medoid member's own sentence — a
 * merge that copies rather than paraphrases, which is the one thing ACE's `brevity bias`
 * measurement says must not happen.
 */
import { hashText } from '../kernel/index.js';
import type { KnowledgeItem } from '../kernel/index.js';
import { contentWords } from './witness.js';
import type { GuidelineProposal, RetrospectSource } from './types.js';

export type RetrospectCluster = {
  readonly id: string;
  readonly task: string;
  readonly members: readonly RetrospectSource[];
  /** The trigger every member's trigger entails: their content words, intersected. */
  readonly seedTrigger: string;
  /** The member closest to the cluster's centre; its statement is the seed's claim. */
  readonly medoid: RetrospectSource;
  /** Mean pairwise similarity of the members, so a reviewer can see a loose cluster. */
  readonly cohesion: number;
};

export type SourcesOptions = {
  /**
   * How to decide whether a record came from a correction or from a success.
   *
   * Injected because `kind` is not a reliable polarity signal across lanes. The τ² lane writes
   * *every* record as an `exemplar` — including the fifteen distilled from corrections — so a
   * kind-based classifier called 73 records 73 successes, and the retrospection pipeline then
   * refused to build a batch for the one reason it must: a corpus with no repairs has nothing
   * to consolidate. The default stays kind-based, because for a host that distinguishes its
   * writes it is right and costs nothing; a lane that does not, passes its own.
   */
  readonly outcomeOf?: (item: KnowledgeItem) => 'repair' | 'pass';
};

/** Read the store's items as sources, keeping the outcome the record was written under. */
export function sourcesOf(items: readonly KnowledgeItem[], options: SourcesOptions = {}): RetrospectSource[] {
  const classify = options.outcomeOf ?? outcomeOf;
  return items.map((item) => ({
    id: item.id,
    statement: item.statement,
    ...(item.when === undefined ? {} : { when: item.when }),
    task: item.scope.task,
    // Distinct-task identity is the support unit ALTK counts, and a record that never
    // declared a task is its own task rather than everyone's.
    taskId: item.scope.intent ?? item.scope.domain ?? item.scope.task,
    outcome: classify(item),
    confidence: item.confidence,
    at: item.createdAt,
  }));
}

/**
 * Which side of the fence an item sits on.
 *
 * The distiller writes a negative or a constraint from a correction and an exemplar or a
 * procedure from a success, and the evidence tier is the recorded distinction. Anything the
 * store cannot classify is treated as a repair, because the cost of a pass in the corpus is
 * a guideline over an anecdote and the cost of a repair outside it is a guideline that was
 * never proposed.
 */
function outcomeOf(item: KnowledgeItem): 'repair' | 'pass' {
  if (item.kind === 'exemplar' || item.kind === 'procedure') return 'pass';
  return 'repair';
}

function triggerWords(source: RetrospectSource): Set<string> {
  return new Set(contentWords(source.when ?? ''));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export type ClusterOptions = {
  /** Jaccard floor for two corrections to belong to one guideline. */
  readonly threshold: number;
  /** Whether corrections from different tasks may merge. Off: a task is a scope, not a topic. */
  readonly crossTask: boolean;
};

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { threshold: 0.6, crossTask: false };

/**
 * Cluster by connected components, in a fixed order.
 *
 * Single-link rather than complete-link because a cluster is an *argument for a merge*: one
 * pair of corrections that clearly share a situation is enough to write a guideline from,
 * and complete-link would refuse exactly the chain that shows a rule generalising in steps.
 * The cost is chaining — a run of near-neighbours can pull two distant corrections together
 * — which is why every member is still witnessed individually against the guideline and a
 * loose cluster shows up as a low `cohesion` rather than as silent over-coverage.
 */
export function clusterSources(
  sources: readonly RetrospectSource[],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): RetrospectCluster[] {
  const repairs = sources
    .filter((source) => source.outcome === 'repair')
    .slice()
    .sort((a, b) => (a.task === b.task ? a.id.localeCompare(b.id) : a.task.localeCompare(b.task)));
  const words = new Map(repairs.map((source) => [source.id, triggerWords(source)]));

  const parent = new Map(repairs.map((source) => [source.id, source.id]));
  const find = (id: string): string => {
    let cursor = id;
    while (parent.get(cursor) !== cursor) cursor = parent.get(cursor) as string;
    return cursor;
  };
  const union = (a: string, b: string): void => {
    const left = find(a);
    const right = find(b);
    if (left === right) return;
    // The lexicographically smaller root wins so the parent map does not depend on the
    // order pairs were visited, which is what makes the cluster ids stable across runs.
    if (left < right) parent.set(right, left);
    else parent.set(left, right);
  };

  for (let i = 0; i < repairs.length; i += 1) {
    for (let j = i + 1; j < repairs.length; j += 1) {
      const a = repairs[i] as RetrospectSource;
      const b = repairs[j] as RetrospectSource;
      if (!options.crossTask && a.task !== b.task) continue;
      const score = jaccard(words.get(a.id) as Set<string>, words.get(b.id) as Set<string>);
      if (score >= options.threshold) union(a.id, b.id);
    }
  }

  const groups = new Map<string, RetrospectSource[]>();
  for (const source of repairs) {
    const root = find(source.id);
    const bucket = groups.get(root);
    if (bucket === undefined) groups.set(root, [source]);
    else bucket.push(source);
  }

  const clusters: RetrospectCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = members.slice().sort((a, b) => a.id.localeCompare(b.id));
    const cohesion = cohesionOf(ordered, words);
    clusters.push({
      id: `cl_${hashText(ordered.map((member) => member.id).join('|')).slice(0, 12)}`,
      // A cluster is never empty: it exists because two members were unioned.
      task: (ordered[0] as RetrospectSource).task,
      members: ordered,
      seedTrigger: seedTriggerOf(ordered),
      medoid: medoidOf(ordered, words),
      cohesion,
    });
  }
  return clusters.sort((a, b) => (a.task === b.task ? a.id.localeCompare(b.id) : a.task.localeCompare(b.task)));
}

/**
 * What the grouping did with the corpus, before any proposal is written.
 *
 * These are the M1 numbers — compile time, no model, deterministic — and two of them exist because
 * this pipeline's known weakness is *recall of the grouping* rather than the prose:
 *
 *  - **fragmentation** is the share of repairs that no cluster claims. Lexical clustering pays for
 *    its reproducibility with a synonym problem: two corrections that fire in the same situation and
 *    share no word land in different clusters, or in none. A high fragmentation with a high witness
 *    rate says the bottleneck is grouping, which is the case for an embedding edge or a model
 *    splitter; a low one says those would buy nothing and the money belongs elsewhere.
 *  - **chained** counts clusters whose mean pairwise cohesion is under the floor. Single-link
 *    clustering is chosen because one clear pair is enough to argue for a merge, and its cost is
 *    that a run of near-neighbours can drag two distant corrections together. A chained cluster is
 *    where a `split` should be offered first.
 *
 * Both are derived from the same objects the batch is built from, so a reviewer reading a card can
 * be shown the state of the corpus that produced it.
 */
export type ClusterCensus = {
  /** Repairs the corpus offered to the consolidator. */
  readonly repairs: number;
  /** Repairs a cluster claims. */
  readonly clustered: number;
  /** Repairs left alone: the number the grouping failed to reach. */
  readonly orphans: number;
  /** `orphans / repairs`, so 1.0 means nothing was grouped at all. */
  readonly fragmentation: number;
  readonly clusters: number;
  /** Clusters whose mean pairwise cohesion is under the floor. */
  readonly chained: number;
  readonly meanCohesion: number;
};

/** The cohesion below which a cluster is a chain of near-neighbours rather than a group. */
export const CHAIN_COHESION_FLOOR = 0.5;

export function clusterCensusOf(
  sources: readonly RetrospectSource[],
  clusters: readonly RetrospectCluster[],
  floor: number = CHAIN_COHESION_FLOOR,
): ClusterCensus {
  const repairs = sources.filter((source) => source.outcome === 'repair').length;
  const clustered = clusters.reduce((total, cluster) => total + cluster.members.length, 0);
  const orphans = repairs - clustered;
  const meanCohesion =
    clusters.length === 0
      ? 0
      : Number(
          (clusters.reduce((total, cluster) => total + cluster.cohesion, 0) / clusters.length).toFixed(4),
        );
  return {
    repairs,
    clustered,
    orphans,
    // `repairs === 0` is a corpus with nothing to group rather than a perfect grouping, and a share
    // with a zero denominator is the vacuous reading this project keeps finding. Zero says "no
    // fragmentation was measured", and the counts beside it say why.
    fragmentation: repairs === 0 ? 0 : Number((orphans / repairs).toFixed(4)),
    clusters: clusters.length,
    chained: clusters.filter((cluster) => cluster.cohesion < floor).length,
    meanCohesion,
  };
}

function cohesionOf(members: readonly RetrospectSource[], words: Map<string, Set<string>>): number {
  let total = 0;
  // Every caller has at least two members, which is what makes the divisor non-zero.
  let pairs = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      total += jaccard(
        words.get((members[i] as RetrospectSource).id) as Set<string>,
        words.get((members[j] as RetrospectSource).id) as Set<string>,
      );
      pairs += 1;
    }
  }
  return Number((total / pairs).toFixed(4));
}

/**
 * The intersection of the members' trigger words, in the order the shortest trigger uses.
 *
 * By construction this trigger is entailed by every member, so the seed proposal cannot fail
 * its own coverage check — which is the point of computing it rather than asking for it. A
 * model that writes a better-sounding trigger has to pass the same test; a fallback that
 * cannot pass it was never a fallback.
 */
export function seedTriggerOf(members: readonly RetrospectSource[]): string {
  const sets = members.map((member) => contentWords(member.when ?? ''));
  if (sets.length === 0) return '';
  const shortest = sets.reduce((best, current) => (current.length < best.length ? current : best));
  const shared = shortest.filter((word) => sets.every((set) => set.includes(word)));
  // De-duplicated while keeping the first position, so a trigger that repeats a word does
  // not produce "refund refund requested".
  const seen = new Set<string>();
  const ordered = shared.filter((word) => (seen.has(word) ? false : (seen.add(word), true)));
  return ordered.join(' ');
}

function medoidOf(
  members: readonly RetrospectSource[],
  words: Map<string, Set<string>>,
): RetrospectSource {
  let best = members[0] as RetrospectSource;
  let bestScore = -1;
  for (const member of members) {
    let total = 0;
    for (const other of members) {
      if (other.id === member.id) continue;
      total += jaccard(words.get(member.id) as Set<string>, words.get(other.id) as Set<string>);
    }
    const score = total / (members.length - 1);
    // Ties broken by id so the medoid is a function of the cluster and not of iteration order.
    if (score > bestScore || (score === bestScore && member.id < best.id)) {
      best = member;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The no-model proposal: the shared trigger, the medoid's claim, every member claimed.
 *
 * This exists as an arm and not as a convenience. If a model-written guideline cannot beat a
 * merge that copies a sentence, then the model's contribution is the *selection* rather than
 * the writing, and the whole HITL design should be about which corrections group together
 * rather than about polishing prose. Running this first makes that comparison free.
 */
export function deterministicProposal(cluster: RetrospectCluster): GuidelineProposal {
  return {
    id: `gp_${cluster.id.slice(3)}`,
    statement: cluster.medoid.statement,
    when: cluster.seedTrigger,
    covers: cluster.members.map((member) => member.id),
    rationale: `the ${cluster.medoid.id} claim under the condition all ${cluster.members.length} members share`,
  };
}
