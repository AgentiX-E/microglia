/**
 * R57's controlled distractor: one rule planted in every pack, at a level fixed in advance.
 *
 * ## Why a planted item and not an observed one
 *
 * Every harm reading this project has produced came from attributing failures to items after the
 * fact, over a store the distiller chose. That attribution cannot be causal here: an item is
 * retrieved *because* it resembles the question, so the questions it resembles are the ones it is
 * most likely to help and the ones it is most likely to hurt, and "related" and "useful" are
 * confounded by construction. Iteration 62's finding makes the shape concrete — the rules credited
 * with a hurt sat at median cosine 0.232 from the question they harmed, the rules credited with a
 * help at 0.228, p = 0.86.
 *
 * Planting removes the confound by removing the choice: the same authored rule, in every pack, at a
 * level this module measures rather than asserts. Four arms differ in exactly that:
 *
 * | arm | shared content terms | what it is |
 * | --- | --- | --- |
 * | `none` | — | the store as the previous round left it |
 * | `far` | 0 | grammatical, domain-flavoured, topically unrelated |
 * | `near` | 2 or more | shares the topic, states the wrong action |
 * | `adversarial` | its `near` twin's | the same words as `near`, the correct action forbidden |
 *
 * ## Why the level is a term count and not a share
 *
 * R57's registration first wrote the level as a *share* of the request's content terms — `far` under
 * 5%, `near` and `adversarial` 10–20%. Measured against the domain's own requests before the
 * dispatch, that band is unreachable: a retail request carries 11 to 126 content terms (median 40,
 * p90 78), so a rule that shares four of them measures 0.10 on a short request and 0.03 on a long
 * one, and no rule that shares a request's topic lands in 10–20% of it. The band would have reported
 * `inBand: false` on almost every request — a measurement of its own arithmetic.
 *
 * The count is the same distinction without the length in it: "shares the topic" is *at least two of
 * the request's content terms present in the rule*, and "topically unrelated" is *none of them*. The
 * share is still recorded, because it is the quantity the recall floor uses and it makes the two
 * arms comparable across requests; it is not what decides the band.
 *
 * ## Why the pair is measured on one text
 *
 * `adversarial` is its `near` twin with the action forbidden, so the two rules differ by a negation
 * marker and nothing else — `validatePlanted` refuses a pair whose token sets differ by anything
 * else, which is how an authoring drift of one word (`keep`, in the first draft) would otherwise
 * have raised the adversarial arm's level by 40% and confounded polarity with relatedness. A marker
 * is still a token, though, and a third of retail requests say "not" themselves, so measuring each
 * text on its own would raise the adversarial arm's level on exactly those requests. The level a
 * pair is planted at is therefore measured on the twin's text and inherited by both arms: polarity
 * is the treatment, and it is not allowed to move the dose.
 */
import { encodeItemLine, renderPack } from '@agentix-e/microglia-core/apply';
import {
  hashText,
  queryCoverage,
  recallText,
  tokenize,
  type KnowledgeScope,
} from '@agentix-e/microglia-core';
import type { RenderableItem, RenderOptions } from '@agentix-e/microglia-core/apply';

export type PlantBand = 'far' | 'near' | 'adversarial';
export type PlantArm = 'none' | PlantBand;

/** One authored rule. `twin` names the `near` rule an `adversarial` rule forbids the action of. */
export type PlantedRule = {
  readonly id: string;
  readonly band: PlantBand;
  readonly when: string;
  readonly statement: string;
  readonly twin?: string;
};

export type PlantedDocument = {
  readonly domain: string;
  readonly rules: readonly PlantedRule[];
};

/**
 * The interval of shared content terms each band is defined by.
 *
 * `far` is the single point 0 — a rule that mentions nothing the request mentions is the point of
 * the arm. `near` has no ceiling: a rule sharing twelve of a request's terms is still "about the
 * topic", and what makes it a distractor is the action it prescribes, not how much of the request
 * it echoes.
 */
export const PLANT_BANDS: Readonly<
  Record<PlantBand, { readonly minTerms: number; readonly maxTerms: number | null }>
> = {
  far: { minTerms: 0, maxTerms: 0 },
  near: { minTerms: 2, maxTerms: null },
  adversarial: { minTerms: 2, maxTerms: null },
};

export const PLANT_ARMS: readonly PlantArm[] = ['none', 'far', 'near', 'adversarial'];

/**
 * The words an `adversarial` twin may add to its `near` rule.
 *
 * The list is what makes the pair a controlled contrast rather than a second rule: an adversarial
 * rule's tokens minus its twin's must be a subset of this, and the twin's minus the adversarial's
 * must be empty. Anything else — a different object, an extra reason, a hedge — changes what the
 * request shares with the rule and so changes the level, which is the one thing the arms must hold
 * equal.
 */
export const PLANT_NEGATIONS: ReadonlySet<string> = new Set(['not', 'never', 'no']);

/** The content terms a request and a text share, which is the quantity the bands are written in. */
export function sharedContentTerms(query: string, text: string): number {
  const wanted = new Set(tokenize(query));
  const present = new Set(tokenize(text));
  let shared = 0;
  for (const token of wanted) if (present.has(token)) shared += 1;
  return shared;
}

/**
 * The text a rule's level is measured on.
 *
 * For an `adversarial` rule this is its twin's text: see the header on why polarity must not move
 * the dose. The twin is resolved against the same document and its absence is refused here rather
 * than defaulted, because a default would plant a pair whose level is the adversarial text's and
 * report it under the `near` arm's name.
 */
function levelText(rule: PlantedRule, document: PlantedDocument): string {
  if (rule.twin === undefined) return recallText(rule);
  const twin = document.rules.find((candidate) => candidate.id === rule.twin);
  if (twin === undefined) {
    throw new Error(
      `adversarial rule '${rule.id}' names twin '${rule.twin}', which the document does not carry`,
    );
  }
  return recallText(twin);
}

/** What a request's planted rule was, and whether it landed in its band. */
export type PlantedItem = {
  readonly rule: PlantedRule;
  /** Content terms the pair shares with the request — what the band is defined on. */
  readonly sharedTerms: number;
  /**
   * Share of the request's content terms the pair covers.
   *
   * Recorded alongside the count because it is the quantity the recall floor uses and it is
   * comparable across requests of different lengths. It is not what decides `inBand`.
   */
  readonly coverage: number;
  /**
   * Whether the reading is inside the band the arm is named for.
   *
   * A false here is not a failure of the run: it is the reading that says this request could not
   * carry the level — a retail request about an exchange shares nothing with a rule about addresses,
   * and no authoring fixes that — and the census counts how often it happened so an arm whose band
   * collapsed is a distribution rather than a surprise.
   */
  readonly inBand: boolean;
};

export type PlantCensus = {
  readonly arm: PlantArm;
  readonly declared: boolean;
  /** Requests that received a planted rule. */
  readonly planted: number;
  /** How many landed inside their band, and the share is `inBand / planted`. */
  readonly inBand: number;
  /**
   * Requests whose pack said nothing until the rule arrived.
   *
   * An empty pack renders as no text at all, so on those requests an armed arm is the only arm that
   * carries a block, and the block itself has a price — 1.14pp on the public lane, measured. A
   * readback that wants the item's price rather than the block's subtracts this count's population.
   */
  readonly createdBlock: number;
  /** The shared-term readings, sorted, because the band is written in these. */
  readonly terms: readonly number[];
  /** The coverage readings, sorted, for the same reason on the measure the floor uses. */
  readonly coverages: readonly number[];
  /** The rules used, by id, each with the number of requests it was planted in. */
  readonly byRule: Readonly<Record<string, number>>;
  /** The committed file's digest, so an arm cannot be authored after seeing the failures. */
  readonly digest: string;
};

export type PlantPlan = {
  readonly arm: PlantArm;
  /** Whether the dispatch chose the arm, as opposed to inheriting `none`. */
  readonly declared: boolean;
};

/** The one switch, spelled once. */
export const PLANT_ENV = 'TAU_PLANTED_RULES';

export function resolvePlantArm(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlantPlan {
  const raw = (env[PLANT_ENV] ?? '').trim().toLowerCase();
  if (raw === '') return { arm: 'none', declared: false };
  if (!(PLANT_ARMS as readonly string[]).includes(raw)) {
    throw new Error(
      `${PLANT_ENV} must be unset or one of ${PLANT_ARMS.join(', ')}, not '${raw}': ` +
        'an unknown spelling would run a pack whose planted level no readback can name',
    );
  }
  return { arm: raw as PlantArm, declared: true };
}

/** Tokens present in one set and not the other, as a sorted list. */
function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((token) => !right.has(token)).sort();
}

/**
 * Check the committed document before a dispatch spends an hour on it.
 *
 * Three failures are refused, each because it quietly produces a comparison nobody can read: two
 * rules with one id (so `byRule` in the census adds two rules together), an `adversarial` rule whose
 * `near` twin does not exist (so the "same words, forbidden action" claim is false), and a twin pair
 * whose token sets differ by more than a negation (so the polarity contrast also moves the level).
 */
export function validatePlanted(document: PlantedDocument): PlantedDocument {
  const ids = new Set<string>();
  for (const rule of document.rules) {
    if (ids.has(rule.id)) throw new Error(`planted rule id '${rule.id}' appears twice`);
    ids.add(rule.id);
    if (!(rule.band in PLANT_BANDS)) {
      throw new Error(`planted rule '${rule.id}' has band '${rule.band}', which is not a level`);
    }
    if (rule.band === 'adversarial') {
      if (rule.twin === undefined) {
        throw new Error(`adversarial rule '${rule.id}' names no \`near\` twin to negate`);
      }
      const twin = document.rules.find((candidate) => candidate.id === rule.twin);
      if (twin === undefined || twin.band !== 'near') {
        throw new Error(
          `adversarial rule '${rule.id}' twins '${rule.twin}', which is not a \`near\` rule`,
        );
      }
      const own = new Set(tokenize(recallText(rule)));
      const theirs = new Set(tokenize(recallText(twin)));
      const dropped = difference(theirs, own);
      const added = difference(own, theirs).filter((token) => !PLANT_NEGATIONS.has(token));
      if (dropped.length > 0 || added.length > 0) {
        throw new Error(
          `adversarial rule '${rule.id}' and its twin '${twin.id}' differ by ` +
            `[${[...dropped, ...added].join(', ')}] beyond a negation: ` +
            'the pair would differ in level as well as in polarity, which is the confound the arm exists to remove',
        );
      }
    }
  }
  return document;
}

/**
 * The digest of the rules this dispatch may plant, which is what makes them prior to the run.
 *
 * Over a canonical line per rule rather than over the JSON: the file's key order and whitespace are
 * formatting, and a digest that changed when the file was reformatted would be a digest of the
 * formatting. Every field the arm plants is in it, so an edit to a sentence changes the digest.
 */
export function plantedDigest(document: PlantedDocument): string {
  const canonical = document.rules
    .map((rule) => [rule.id, rule.band, rule.when, rule.statement, rule.twin ?? ''].join('\u0000'))
    .sort()
    .join('\n');
  return hashText(`${document.domain}\n${canonical}`);
}

/**
 * The rule this arm plants for this query, or `undefined` for the `none` arm.
 *
 * Each arm plants the most extreme rule it authored in the direction the arm needs: `near` and
 * `adversarial` plant the rule that shares the most content terms with the request, because a
 * distractor the store would not have retrieved is not a distractor, and `far` plants the one that
 * shares the fewest, because sharing a term is the failure mode of that arm. Ties break on id, so
 * two runs of the same request plant the same rule.
 *
 * The choice is not filtered by the band. An arm that planted nothing on the requests where its
 * band could not be reached would be measuring a different store than the one it reports, so the
 * rule is planted anyway and `inBand` records the drift.
 */
export function plantedFor(
  arm: PlantArm,
  query: string,
  document: PlantedDocument,
): PlantedItem | undefined {
  if (arm === 'none') return undefined;
  const band = PLANT_BANDS[arm];
  const candidates = document.rules.filter((rule) => rule.band === arm);
  if (candidates.length === 0) {
    throw new Error(`no planted rule is authored for band '${arm}'`);
  }
  const measured = candidates.map((rule) => {
    const text = levelText(rule, document);
    return {
      rule,
      sharedTerms: sharedContentTerms(query, text),
      coverage: queryCoverage(query, text),
    };
  });
  const preferMore = arm !== 'far';
  const chosen = measured.reduce((best, row) => {
    if (row.sharedTerms === best.sharedTerms) return row.rule.id < best.rule.id ? row : best;
    const better = preferMore ? row.sharedTerms > best.sharedTerms : row.sharedTerms < best.sharedTerms;
    return better ? row : best;
  });
  const above = chosen.sharedTerms >= band.minTerms;
  const below = band.maxTerms === null || chosen.sharedTerms <= band.maxTerms;
  return {
    rule: chosen.rule,
    sharedTerms: chosen.sharedTerms,
    coverage: chosen.coverage,
    inBand: above && below,
  };
}

/** Fold the requests' readings into the census the artefact carries. */
export function plantCensus(
  plan: PlantPlan,
  observations: readonly PlantedItem[],
  document: PlantedDocument,
  createdBlock = 0,
): PlantCensus {
  const byRule: Record<string, number> = {};
  for (const observation of observations) {
    byRule[observation.rule.id] = (byRule[observation.rule.id] ?? 0) + 1;
  }
  const ascending = (left: number, right: number): number => left - right;
  return {
    arm: plan.arm,
    declared: plan.declared,
    planted: observations.length,
    inBand: observations.filter((observation) => observation.inBand).length,
    createdBlock,
    terms: observations.map((observation) => observation.sharedTerms).sort(ascending),
    coverages: observations.map((observation) => observation.coverage).sort(ascending),
    byRule,
    digest: plantedDigest(document),
  };
}

/**
 * The confidence a planted rule is rendered with.
 *
 * Fixed rather than derived, because a planted rule has no evidence to derive it from, and held
 * equal across the three armed arms so the reader's view of how much to trust the line is not a
 * second difference between them. It is the top of the range: a rule the reader discounts is not
 * the distractor this arm is asking about.
 */
export const PLANT_CONFIDENCE = 1;

/** What a planted line needs to look like its neighbours in the block. */
export type PlantTarget = {
  /** The host's character budget, used only when the pack is empty and the block is new. */
  readonly budget: number;
  readonly scope: KnowledgeScope;
  readonly tag?: string;
  readonly note?: RenderOptions['note'];
};

/**
 * The pack with exactly one authored rule appended, and whether the block is new.
 *
 * Appended rather than re-rendered: a re-render would re-decide which of the host's items fit the
 * budget, so an armed pack could differ from the control in what it *drops* as well as in what it
 * adds, and the arm would be measuring two things. The cost is stated rather than hidden — an armed
 * pack is one line longer than the same pack unarmed, and can exceed the host's budget by that line.
 * The alternative, dropping a store item to make room, would remove a rule the reader was going to
 * see in the control arm.
 *
 * `created` is the reading that separates "this pack carried the distractor" from "this pack had
 * nothing to say and the distractor is all it carried": an empty pack renders as no text at all, and
 * a block that exists only because of the plant costs what any block costs — 1.14pp on the public
 * lane, measured. A readback that wants the item's price rather than the block's can subtract the
 * requests where `created` is true.
 */
export function plantedRendered(
  rendered: string,
  rule: PlantedRule,
  target: PlantTarget,
): { readonly rendered: string; readonly created: boolean } {
  const item: RenderableItem = {
    id: `planted:${rule.id}`,
    kind: 'constraint',
    confidence: PLANT_CONFIDENCE,
    scope: target.scope,
    when: rule.when,
    statement: rule.statement,
  };
  const options: RenderOptions = {
    budget: target.budget,
    ...(target.tag === undefined ? {} : { tag: target.tag }),
    ...(target.note === undefined ? {} : { note: target.note }),
  };
  if (rendered === '') {
    return { rendered: renderPack([item], options).rendered, created: true };
  }
  const tag = target.tag ?? 'microglia-knowledge';
  const close = `</${tag}>`;
  const at = rendered.lastIndexOf(close);
  if (at < 0) {
    throw new Error(
      `the pack does not carry its own '${close}': a block that cannot be appended to is a block ` +
        'whose item count no reader could trust',
    );
  }
  // The header's count is bumped with the line, because a block that says `items="3"` and carries
  // four lines is a block a readback counts wrong.
  const head = rendered
    .slice(0, at)
    .replace(/items="(\d+)"/, (_match, count: string) => `items="${Number(count) + 1}"`);
  return { rendered: `${head}${encodeItemLine(item, true)}\n${close}`, created: false };
}

/**
 * The census on one line, for the run's own log.
 *
 * The band is printed as a range rather than a share, and `created` beside it, because a reader who
 * sees `inBand=0` needs to know whether the rules missed the requests or the block was the only
 * thing planted that request carried.
 */
export function plantSummary(census: PlantCensus): string {
  const share = census.planted === 0 ? 0 : census.inBand / census.planted;
  const terms = census.terms;
  const range =
    terms.length === 0 ? 'none' : `${String(terms[0])}..${String(terms[terms.length - 1])}`;
  const rules = Object.entries(census.byRule)
    .map(([id, count]) => `${id}x${count}`)
    .sort()
    .join(',');
  return (
    `arm=${census.arm} declared=${String(census.declared)} planted=${census.planted} ` +
    `inBand=${census.inBand} (${(share * 100).toFixed(1)}%) terms=${range} ` +
    `created=${census.createdBlock} rules=${rules} digest=${census.digest}`
  );
}
