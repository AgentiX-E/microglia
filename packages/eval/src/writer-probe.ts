/**
 * One correction, every candidate writer, one call each — and a verdict that can say "no".
 *
 * ## Why the pre-flight needed a second dimension
 *
 * R111's pre-flight asks the lane's own interpreter about one fixture correction and refuses an arm
 * whose distiller answers nothing. It runs **one** `(model, form)` pair, because the arm it guards
 * runs one. R104 then ran under that pair and answered **10 of 73** events: the pre-flight passed
 * and the population failed, which is the limit R111 wrote down ("it is not a gate on the arm's
 * corrections: it uses a fixture").
 *
 * That limit makes the pre-flight a test of the *lane*, not of the *writer*. The question this
 * module asks is the one the limit leaves open: **which** writer produces a claim from a correction
 * that states one, and does that claim carry the condition the prompt makes mandatory? A form is a
 * prompt; a model is a capacity; the two are separate axes and R104 moved neither. `procedure`,
 * `repair` and `lexicon` have never been run on this lane at all.
 *
 * ## Why a claim with no `when` is not an answer
 *
 * `parseWhen` drops a condition that is absent, shorter than three characters, longer than 240, or a
 * restatement of the statement. The drop is right — a claim whose condition merely repeats it
 * carries no information about application — but it means `candidates: 1` can be one unusable claim
 * and the funnel cannot tell. R104 stored six items and the artefact cannot say how many of them
 * carried a condition at all. So the trial counts the two separately, and only a claim **with** a
 * usable condition counts as the writer having written one.
 *
 * ## Three verdicts, because two of them look alike
 *
 * | verdict | what happened | what it permits |
 * | --- | --- | --- |
 * | `unanswered` | no candidate was asked, or every call threw | nothing: this is not a measurement |
 * | `no-writer` | every call returned, and no candidate produced a claim carrying a `when` | a refusal, and it is a *result* |
 * | `viable` | at least one candidate wrote a claim with a `when` | the arm may be dispatched, on that pair |
 *
 * Folding `unanswered` into `no-writer` would publish an outage as a finding; folding `no-writer`
 * into `unanswered` would refuse to record the one thing the money bought. This repository has paid
 * for that confusion at both ends (§R41's store that held nothing, §R111's fifteen empty replies
 * read as fifteen healthy calls).
 *
 * ## What a `viable` verdict does not say
 *
 * It does not say the arm will measure anything: the fixture states a rule, and the arm's own
 * corrections may not. R104 is the proof — its pre-flight passed and its population was 86% silent.
 * A `viable` reading therefore *permits* the arm and never certifies it, and the population question
 * stays with the population instrument (`distillReplies`'s four states, now recorded on every arm).
 */
import type { DistillForm } from '@agentix-e/microglia-core/distill';
import { classifyReply, type DistillReplyKind } from './distill-replies.js';

/** A writer is a model and a form. Neither axis alone describes one. */
export type WriterCandidate = {
  readonly model: string;
  readonly form: DistillForm;
};

/** What one call cost, in the four numbers the rate card reads. */
export type ProbeTokens = {
  readonly prompt: number;
  readonly cached: number;
  readonly completion: number;
  /** Absent when the provider reported no reasoning split, which is not the same as zero. */
  readonly reasoning?: number;
  readonly total: number;
};

/** What one candidate did on one correction. */
export type WriterTrial = {
  readonly model: string;
  readonly form: DistillForm;
  /**
   * The reply's shape, from the same classifier the lane's census uses — or `error`, which is the
   * call not returning at all and is not a reply.
   */
  readonly state: DistillReplyKind | 'error';
  /** Claims the interpreter returned, after parsing and the candidate ceiling. */
  readonly claims: number;
  /** Claims carrying a usable `when`. The only number that decides `viable`. */
  readonly withWhen: number;
  /** Characters the model returned. Zero on a blank reply, which is the point of counting it here. */
  readonly chars: number;
  /** A bounded quote, or a description when there is nothing to quote. */
  readonly preview: string;
  /** The `MG_E_*` code, present only when the call threw. */
  readonly code?: string;
  readonly tokens: ProbeTokens;
  readonly ms: number;
};

/** The verdict. */
export type WriterProbeState = 'viable' | 'no-writer' | 'unanswered';

export type WriterProbe = {
  readonly state: WriterProbeState;
  readonly trials: readonly WriterTrial[];
  /** Candidates that wrote at least one claim with a `when`, in the order they were asked. */
  readonly viable: readonly WriterCandidate[];
  /**
   * The candidate the arm should be dispatched under: most claims with a `when`, then most claims,
   * then the shortest reply (output tokens are the expensive side of the bill).
   */
  readonly best?: WriterCandidate;
  /** How many calls threw. Zero is a reading; the same number as `trials.length` is not. */
  readonly errors: number;
  readonly sentence: string;
};

/** How a candidate is named in a sentence or an artefact key. */
export function writerLabel(candidate: WriterCandidate): string {
  return `${candidate.model}/${candidate.form}`;
}

/**
 * The thinking regime every distillation call in this lane runs under.
 *
 * A shared constant rather than the same literal in two places, because R104's defects included
 * exactly that drift in the other direction: one lane stated its regime and the τ² lane did not, so
 * its distiller inherited whatever the endpoint does by default — which is to think, and thinking is
 * billed at the output rate and consumed the budget the reply needed. The probe and the arm must ask
 * under one regime, or a probe that passed certifies a writer that never wrote.
 */
export const DISTILL_THINKING = 'off' as const;

/**
 * What one call produced, before it is turned into a trial.
 *
 * The reply is carried rather than the classification because the classification is this module's
 * decision: a caller that classified its own reply could disagree with the lane's census about the
 * same string, and two classifiers for one artefact is how "blank" became "healthy" the first time.
 */
export type WriterOutcome =
  | {
      readonly ok: true;
      readonly reply: string;
      readonly claims: readonly { readonly when?: string }[];
      readonly tokens: ProbeTokens;
      readonly ms: number;
    }
  | { readonly ok: false; readonly code: string; readonly sample: string; readonly ms: number };

/**
 * How much of a reply a trial keeps.
 *
 * The parser's own bound: enough to recognise an answer's shape, short enough that a model which
 * echoes its prompt cannot put the prompt in the artefact.
 */
export const TRIAL_PREVIEW_CHARS = 200;

/**
 * A bounded quote of a reply, or a description of a reply that has nothing to quote.
 *
 * The description matters more than the quote: a blank reply *is* the finding, and printing it bare
 * leaves a reader looking at a line that ends after a colon — which is exactly the sample R104's
 * artefact carried (`"MG_E_INVALID_SIGNAL: LLM response is not JSON <- "`).
 */
export function trialPreview(reply: string, bound = TRIAL_PREVIEW_CHARS): string {
  const trimmed = reply.trim();
  if (trimmed !== '') return trimmed.slice(0, bound);
  if (reply.length === 0) return 'the reply was empty (0 characters)';
  return `the reply held no visible character (${String(reply.length)} whitespace character(s))`;
}

/** A count that cannot be negative and cannot be a fraction. */
const count = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

/**
 * Turn one call into one trial.
 *
 * `withWhen` is counted from the claims the interpreter returned rather than from the reply text:
 * the interpreter is where `parseWhen` runs, so a claim in this list has already survived the
 * condition's own validity rule, and counting `"when"` occurrences in the reply would count the
 * ones that were dropped.
 */
export function trialOf(candidate: WriterCandidate, outcome: WriterOutcome): WriterTrial {
  const base = { model: candidate.model, form: candidate.form, ms: count(outcome.ms) };
  if (!outcome.ok) {
    return {
      ...base,
      state: 'error',
      claims: 0,
      withWhen: 0,
      chars: 0,
      preview: outcome.sample,
      code: outcome.code,
      tokens: { prompt: 0, cached: 0, completion: 0, total: 0 },
    };
  }
  const claims = outcome.claims;
  return {
    ...base,
    state: classifyReply(outcome.reply),
    claims: claims.length,
    withWhen: claims.filter((claim) => claim.when !== undefined && claim.when.trim() !== '').length,
    chars: outcome.reply.length,
    preview: trialPreview(outcome.reply),
    tokens: outcome.tokens,
  };
}

/** Most conditions first, then most claims, then the shortest reply. */
function better(a: WriterTrial, b: WriterTrial): boolean {
  if (a.withWhen !== b.withWhen) return a.withWhen > b.withWhen;
  if (a.claims !== b.claims) return a.claims > b.claims;
  return a.chars < b.chars;
}

/**
 * Read the trials into a verdict.
 *
 * The order of the tests is the definition, and it is the order that keeps an outage out of a
 * finding: nothing asked, then everything thrown, then the claims.
 */
export function readWriterProbe(trials: readonly WriterTrial[]): WriterProbe {
  const errors = trials.filter((trial) => trial.state === 'error').length;
  const viableTrials = trials.filter((trial) => trial.state === 'answered' && trial.withWhen > 0);
  const viable = viableTrials.map((trial) => ({ model: trial.model, form: trial.form }));
  const tally = (state: DistillReplyKind | 'error'): number =>
    trials.filter((trial) => trial.state === state).length;

  if (trials.length === 0) {
    return {
      state: 'unanswered',
      trials,
      viable: [],
      errors: 0,
      sentence: 'no writer was asked, so this is not a reading about writers',
    };
  }
  if (errors === trials.length) {
    const code = trials[0]?.code ?? 'unknown';
    return {
      state: 'unanswered',
      trials,
      viable: [],
      errors,
      sentence:
        `all ${String(errors)} candidate writer(s) threw (${code}): ` +
        'the provider did not answer, and an outage is not a finding about writers',
    };
  }
  if (viableTrials.length === 0) {
    const blanks = tally('blank');
    const empties = tally('empty');
    const unparsed = tally('unparsed');
    const answered = tally('answered');
    return {
      state: 'no-writer',
      trials,
      viable: [],
      errors,
      sentence:
        `${String(trials.length)} candidate writer(s) returned and none wrote a claim carrying a ` +
        `condition: ${String(answered)} answered without one, ${String(empties)} empty, ` +
        `${String(blanks)} blank, ${String(unparsed)} unparsed, ${String(errors)} threw`,
    };
  }
  const ranked = [...viableTrials].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const best = ranked[0] as WriterTrial;
  return {
    state: 'viable',
    trials,
    viable,
    best: { model: best.model, form: best.form },
    errors,
    sentence:
      `${String(viableTrials.length)} of ${String(trials.length)} candidate writer(s) wrote a claim ` +
      `carrying a condition; the best is ${writerLabel({ model: best.model, form: best.form })} ` +
      `with ${String(best.withWhen)} conditioned claim(s) from ${String(best.claims)} claim(s)`,
  };
}

/**
 * Ask every candidate the same question, once each, and read the answers.
 *
 * Sequential rather than concurrent: the call budget is a run-level fact and eight calls fired at
 * once are eight calls a rate limiter sees as one burst, which is the shape that produces the 429s
 * this lane has already misread as a model refusing to answer.
 */
export async function probeWriters(
  candidates: readonly WriterCandidate[],
  ask: (candidate: WriterCandidate) => Promise<WriterOutcome>,
): Promise<WriterProbe> {
  const trials: WriterTrial[] = [];
  for (const candidate of candidates) {
    trials.push(trialOf(candidate, await ask(candidate)));
  }
  return readWriterProbe(trials);
}

/**
 * The candidate grid, deduplicated and validated.
 *
 * Two spellings of one pair would be two calls and one reading, and the artefact would carry the
 * same label twice; an empty model or form is a configuration error the caller must see before a
 * call is spent, not a trial that fails for an unstated reason.
 */
export function candidateGrid(
  models: readonly string[],
  forms: readonly DistillForm[],
): readonly WriterCandidate[] {
  const seen = new Set<string>();
  const out: WriterCandidate[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed === '') throw new Error('a writer candidate needs a model id');
    for (const form of forms) {
      const key = writerLabel({ model: trimmed, form });
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ model: trimmed, form });
    }
  }
  return out;
}

/**
 * The reading as a step summary, so the one artefact a reader sees on a dispatch's page is the
 * verdict and the table that supports it.
 *
 * Rendered here rather than in the workflow for the reason §R111 recorded: logic inside a `run:` step
 * cannot be tested, and R104's first attempt at one died on a double quote in a comment. A workflow
 * that prints a file cannot be wrong about the file's content.
 */
export function writerProbeMarkdown(
  reading: WriterProbe,
  meta: { readonly context: string; readonly thinking: string; readonly maxTokens: number },
): string {
  const lines = [
    `### ${reading.state}`,
    '',
    reading.sentence,
    '',
    `- context: \`${meta.context}\``,
    `- regime: \`thinking: ${meta.thinking}\`, \`max_tokens: ${String(meta.maxTokens)}\``,
    `- ${String(reading.trials.length)} candidate(s), ${String(reading.errors)} threw`,
    '',
    '| writer | state | claims | with a `when` | chars | tokens |',
    '|---|---|---|---|---|---|',
  ];
  for (const trial of reading.trials) {
    lines.push(
      `| \`${writerLabel(trial)}\` | ${trial.state} | ${String(trial.claims)} | ` +
        `${String(trial.withWhen)} | ${String(trial.chars)} | ${String(trial.tokens.total)} |`,
    );
  }
  lines.push('');
  lines.push(
    reading.best === undefined
      ? 'No candidate wrote a claim carrying a condition. **Do not dispatch this arm on this backend.**'
      : `Dispatch on \`${writerLabel(reading.best)}\` if a dispatch is wanted. ` +
          'It permits the arm; it does not certify that the arm’s own corrections will teach anything.',
  );
  return `${lines.join('\n')}\n`;
}
