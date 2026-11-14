/**
 * The witness step: does a proposed guideline actually cover what it claims?
 *
 * ALTK-Evolve's consolidation is *support-conserving* — a merged guideline records how
 * many sources it absorbed, and the total is preserved. That is the property worth
 * copying, and the property that a similarity threshold alone cannot deliver: cosine
 * similarity says two sentences are near each other, not that one *is* an instance of the
 * other. A guideline written by a model can be plausible, fluent and slightly narrower
 * than the corrections it claims, and the difference is invisible in the text.
 *
 * So the check is lexical and one-directional. A guideline is *wider* than its source
 * when every content word of the guideline's trigger appears in the source's trigger:
 *
 *     source   "when a refund is requested after the order has shipped"
 *     guideline "when a refund is requested"                             -> entailed
 *
 * The reverse is not generalisation but narrowing — a guideline carrying a word its source
 * lacks describes a situation the source was not in — and it is the direction this step
 * refuses. Nothing here is a judge of meaning; it is a judge of *direction*, and its output
 * is a number a reviewer can check by reading two strings.
 */
import type {
  Admissibility,
  CollateralFinding,
  GuidelineProposal,
  RetrospectSource,
  WitnessFinding,
  WitnessReport,
  WitnessVerdict,
} from './types.js';

/**
 * Words that carry the trigger's connective grammar rather than its content.
 *
 * Deliberately short. A long list would make more pairs "entailed" by deleting the words
 * that distinguish them, which is the failure this function exists to catch — the cost of a
 * missed entailment is a guideline a reviewer has to read, and the cost of a wrong one is a
 * guideline that claims support it does not have.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'when', 'whenever', 'while', 'then', 'than',
  'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'over', 'under',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'done', 'has', 'have', 'had', 'having',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'any', 'all', 'some', 'each', 'every', 'such', 'same',
  'as', 'so', 'up', 'out', 'off', 'per', 'via', 'i', 'you', 'we', 'they', 'he', 'she',
  'user', 'customer', 'request', 'requests', 'asked', 'asks',
]);

/** Negations, in the spellings a distiller actually writes. */
const NEGATION = /\b(not|no|never|without|avoid|cannot|cant|dont|doesnt|didnt|shouldnt|mustnt|wont)\b/;

/**
 * Content words of a trigger or statement.
 *
 * `n't` is folded before splitting, because `don't` → `don t` would otherwise leave `t` as
 * a content word and make every negated trigger one word longer than its affirmative twin.
 */
export function contentWords(text: string): string[] {
  const normalised = text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/n['’]t\b/g, ' not')
    .replace(/[^a-z0-9]+/g, ' ');
  return normalised
    .split(' ')
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

function wordSet(text: string): Set<string> {
  return new Set(contentWords(text));
}

export function isNegated(text: string): boolean {
  return NEGATION.test(
    text
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/n't\b/g, ' not')
      .replace(/[^a-z0-9 ]+/g, ' '),
  );
}

/**
 * How a single source relates to a guideline's trigger.
 *
 * `partial` exists because synonyms are real: "after shipment" and "after the order has
 * shipped" share no content word and mean the same thing, so a strict subset test would
 * mark a correct merge unwitnessed and a reviewer would learn to ignore the flag. It is
 * *not* counted as covered — it is reported, so a human decides, and the default policy
 * refuses it in the mode that claims to preserve everything.
 */
export function verdictOf(guidelineWhen: string, sourceWhen: string | undefined): {
  readonly verdict: WitnessVerdict;
  readonly overlap: number;
} {
  const wanted = wordSet(guidelineWhen);
  if (wanted.size === 0) return { verdict: 'unconditional', overlap: 1 };
  if (sourceWhen === undefined) return { verdict: 'unwitnessed', overlap: 0 };
  const have = wordSet(sourceWhen);
  let matched = 0;
  for (const word of wanted) if (have.has(word)) matched += 1;
  const overlap = matched / wanted.size;
  if (matched === wanted.size) return { verdict: 'entailed', overlap };
  if (overlap >= 0.5) return { verdict: 'partial', overlap };
  return { verdict: 'unwitnessed', overlap };
}

/** Covered means "the guideline is at least as wide as the source", which is `entailed`. */
function covered(verdict: WitnessVerdict): boolean {
  return verdict === 'entailed' || verdict === 'unconditional';
}

/**
 * Witness a proposal against the whole corpus, not only against what it claimed.
 *
 * The corpus matters because a rule's damage is done where it fires, not where it was
 * derived: a guideline that covers its four claimed corrections and also matches nine
 * others is a rule about a category, and the reviewer has to be shown the nine. This is the
 * quantity AutoGuide's context key makes cheap — if the key is part of the item, the
 * question "what else matches it" is a set intersection rather than a judgement.
 */
export function witnessOf(
  proposal: GuidelineProposal,
  corpus: readonly RetrospectSource[],
): WitnessReport {
  const byId = new Map(corpus.map((source) => [source.id, source]));
  const findings: WitnessFinding[] = [];
  for (const id of proposal.covers) {
    const source = byId.get(id);
    // A claim about a source that is not in the corpus is not coverage, it is a dangling
    // reference, and counting it as covered would let a proposer inflate support by naming
    // ids that do not exist.
    if (source === undefined) {
      findings.push({ sourceId: id, verdict: 'unwitnessed', overlap: 0 });
      continue;
    }
    const { verdict, overlap } = verdictOf(proposal.when, source.when);
    findings.push({ sourceId: id, verdict, overlap });
  }

  const claimed = new Set(proposal.covers);
  const collateral: CollateralFinding[] = [];
  for (const source of corpus) {
    if (claimed.has(source.id)) continue;
    const { verdict } = verdictOf(proposal.when, source.when);
    if (!covered(verdict)) continue;
    collateral.push({ sourceId: source.id, verdict, outcome: source.outcome });
  }

  const coveredSources = findings
    .filter((finding) => covered(finding.verdict))
    .map((finding) => byId.get(finding.sourceId))
    .filter((source): source is RetrospectSource => source !== undefined);

  const guidelineNegated = isNegated(proposal.statement);
  const polarityConflicts = coveredSources
    .filter((source) => isNegated(source.statement) !== guidelineNegated)
    .map((source) => source.id);

  return {
    guidelineId: proposal.id,
    findings,
    covered: coveredSources.length,
    unwitnessed: findings.filter((finding) => !covered(finding.verdict)).length,
    collateral,
    distinctTasks: new Set(coveredSources.map((source) => source.taskId)).size,
    polarityConflicts,
    unconditional: wordSet(proposal.when).size === 0,
  };
}

export type RetrospectPolicy = {
  /** Fewest covered sources a guideline may claim. Two is the floor: one is a restatement. */
  readonly minSources: number;
  /** Most sources outside `covers` the guideline may also match. */
  readonly maxCollateral: number;
  /**
   * Whether `partial` coverage may stand in for `entailed`.
   *
   * Off by default, and the default is the claim: a mode that preserves what it absorbed
   * cannot accept a synonym match on the proposer's word.
   */
  readonly allowPartial: boolean;
};

export const DEFAULT_RETROSPECT_POLICY: RetrospectPolicy = {
  minSources: 2,
  maxCollateral: 4,
  allowPartial: false,
};

export type AdmissibilityReport = {
  readonly state: Admissibility;
  readonly sentence: string;
  readonly report: WitnessReport;
};

/**
 * The gate between a proposal and a reviewer.
 *
 * Order is not arbitrary, and the first two swapped during the tests. Coverage comes before
 * the support floor: "you claimed two, the trigger reaches one" is an unsupported claim,
 * while "you claimed one and the trigger reaches it" is a restatement. Grading the first as
 * a restatement tells the proposer its merge was too small when what happened is that it
 * was wrong, and the sentence a reviewer reads should name the defect that is actually there.
 * Then width, then polarity — each a strictly worse defect than the one before it, so a
 * reviewer shown the first does not have to read the rest.
 */
export function admissibilityOf(
  proposal: GuidelineProposal,
  corpus: readonly RetrospectSource[],
  policy: RetrospectPolicy = DEFAULT_RETROSPECT_POLICY,
): AdmissibilityReport {
  const report = witnessOf(proposal, corpus);
  const state = (value: Admissibility, sentence: string): AdmissibilityReport => ({
    state: value,
    sentence,
    report,
  });

  if (report.unconditional) {
    return state(
      'unconditional',
      'the trigger names no condition, so the rule would apply to every request; state when it applies',
    );
  }
  const unsupported = report.findings.filter(
    (finding) => !covered(finding.verdict) && !(policy.allowPartial && finding.verdict === 'partial'),
  );
  if (unsupported.length > 0) {
    const names = unsupported.map((finding) => `${finding.sourceId} (${finding.verdict})`).join(', ');
    return state('unwitnessed', `claims coverage of ${names}, which the trigger does not reach`);
  }
  // The floor counts what the policy will accept, not what the strict witness proved: with
  // `allowPartial` on, a synonym match is a member, and counting it as unproven here would
  // make the option change the sentence without changing the decision.
  const usable = report.findings.length - unsupported.length;
  if (usable < policy.minSources) {
    return state(
      'restatement',
      `covers ${usable} source(s) against a floor of ${policy.minSources}: this is a correction with a new id, not a guideline`,
    );
  }
  if (report.polarityConflicts.length > 0) {
    return state(
      'polarity',
      `${report.polarityConflicts.join(', ')} say the opposite of this guideline; merging them would invert a rule`,
    );
  }
  if (report.collateral.length > policy.maxCollateral) {
    return state(
      'over-general',
      `also matches ${report.collateral.length} source(s) it did not claim, against a ceiling of ${policy.maxCollateral}`,
    );
  }
  return state(
    'reviewable',
    `${report.covered} source(s) over ${report.distinctTasks} task(s), ${report.collateral.length} collateral`,
  );
}
