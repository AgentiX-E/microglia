/**
 * R85 — the arm that stores the record instead of a claim about the record.
 *
 * Two preprints published within the last month say the abstraction is the defect rather than its
 * implementation, and both measure it against the same baseline: the raw material the abstraction was
 * made from.
 *
 * `More Memory, Worse Agents` (Indiana University / Tencent HY, 19 Oct 2026) ran nine settings of
 * ALFWorld / WebShop / ScienceWorld across three open models. Stored lessons scored **49.0%**, plain
 * raw logs scored **53.5%**, and per-task guidance built from the logs and then *discarded* scored
 * **59.9%**. Stored lessons were worse than logs in seven of nine settings. `Memory Tax`
 * (UIUC / Tsinghua / RUC) normalised eleven memory systems by retrieval scope and found two beating
 * single-round RAG, while two-round RAG over raw history scored **90.0%** against all eleven.
 *
 * This lane has its own version of the number and it points the same way. R58's store produced a
 * **median non-zero coverage of 10.53%**: the pack's text and the question's text shared almost no
 * content word. That is what an abstraction does to a lexical retriever — a claim about *how to
 * cancel an order* does not contain the order id the next customer quotes.
 *
 * Two things have to be said about that number before it is used as evidence, and the first is a
 * correction of how it was first described here. **The lane does not gate on coverage**: every
 * registration so far fixes `recallFloor: 0`, so the pack carries whatever is servable and coverage
 * is *measured* rather than enforced. A low reading therefore means "the block the model read was
 * almost unrelated to the question", not "the item was dropped" — the same text-level fact, one
 * mechanism further from the effect, and the honest version of it. The second is that the number is
 * what a *floor* would act on: `tau2-rawlog-recall.test.ts` shows one record surviving at
 * `minCoverage: 0.2` for a request that shares its words and vanishing for a request about the
 * weather, which is the discrimination an abstracted claim does not have.
 *
 * ## What this arm changes
 *
 * Exactly one thing: the object stored. The corpus, the split, the admission rules, the recall
 * floor, the budget, the ceiling, the model that answers and the four trials are the ones the
 * dispatch already fixed. The interpreter below writes one record per correction, in the words the
 * episode produced, and it calls no model at all.
 *
 * ## Four decisions, and what each one is protecting
 *
 * **The question is part of the record.** The retrieval that serves it is lexical, so a record that
 * omits the words the user typed cannot be found by the words the next user types. This is the whole
 * mechanism the arm exists to test: an abstracted claim is *about* a class of question, a record *is*
 * a question, and only the second can be matched by overlap.
 *
 * **The arguments are part of the record.** `order_id="W237"` is the entity a later task quotes, and
 * it is the first thing an abstracting distiller drops — the instruction to write a rule "in the
 * reader's own terms" is an instruction to generalise, and generalising is the operation that removes
 * it. `Memory Tax` names this failure `faithfulness`: the detail was destroyed when the item was
 * written. A record cannot lose a detail it never removed.
 *
 * **One record per event, never merged by content.** `dedupeKey` carries the run id, so two
 * corrections with identical text are two records and not one claim with support 2. That is what a
 * log *is*, and it is the property that makes the support census read differently on this arm: a raw
 * log has no item at support 2 by construction, so a readback that grades "nothing recurs" on it is
 * grading the wrong object. The registration says so rather than leaving it to the reader.
 *
 * **The record is bounded, and truncation is marked.** A τ² trace can run to thousands of characters
 * and a pack is a budget; an unbounded record would make this arm win or lose on context length
 * rather than on faithfulness. The cap is stated here, the marker is part of the text, and the
 * artefact counts how many records hit it.
 */
import { contentKey } from '@agentix-e/microglia-core';
import type { DistillCandidate, FeedbackEvent, Json, RunRecord } from '@agentix-e/microglia-core';
import type { Interpreter } from '@agentix-e/microglia-core/distill';

/**
 * The default ceiling on one record, in characters.
 *
 * **This number was wrong, and R85 is how it was found.** 700 was borrowed from R84's 640-character
 * statement ceiling, which bounds a *trace* unit — a summary of one tool call. A record is the whole
 * question and the whole answer, and the two are not the same size: `eval/tools/record_length_census.py`
 * over the retail corpus puts the length of a rebuilt record at p50 744, p95 1260 and max 1532
 * characters. R85 ran with 700 and clipped **twelve of twelve** records, which turns the arm into the
 * thing it was the control for — a summary, written by `slice`.
 *
 * The constant stays at 700 for one reason and it is not preference: every arm published with it keeps
 * the reading it was published with, and a registration that wants a different ceiling states it in
 * its header (`rawCeiling`) rather than editing the meaning of a finished run. The census's number —
 * 2000, the corpus maximum plus the `note:` line the run also writes — belongs to a registration.
 */
export const RAWLOG_STATEMENT_CEILING = 700;

/** Appended to a record that was clipped, so a reader never mistakes the end of a cap for the end of an episode. */
export const RAWLOG_TRUNCATION_MARK = ' …';

/**
 * The trust a record carries, before the channel's own ceiling is applied.
 *
 * 0.9 is not a preference, it is the lowest weight that produces a *servable* item. The default
 * policy's `minSupport` is 0.8 and its own comment states the case it was set for: "one trusted edit
 * (weight 0.9) must clear this; two thumbs-down (0.5 each) do not". A τ² correction is that trusted
 * edit — the task's `evaluation_criteria.actions` is the gold answer, not a reader's opinion — so 0.9
 * is the weight the evidence actually carries.
 *
 * The first version of this constant was 0.7, reasoning that a record asserts nothing and should sit
 * below a reviewer's stated clarification. The end-to-end test refused it: one correction, one
 * candidate, one admitted, one **stored**, and **0 servable**, because support 0.7 sits under the
 * 0.8 floor and the store marked it a candidate. A store of candidates is the R55.0 defect in another
 * coat — items that exist, are counted, and are reachable by nothing.
 */
export const RAWLOG_TRUST = 0.9;

/** How one call is written: `name(key=value, …)`, with strings quoted so an empty value stays visible. */
function renderCall(call: { readonly name?: unknown; readonly arguments?: unknown }): string {
  const name = typeof call.name === 'string' ? call.name : '';
  const args = call.arguments;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return name;
  const entries = Object.entries(args as Record<string, Json>).map(
    ([key, value]) => `${key}=${JSON.stringify(value) ?? 'null'}`,
  );
  return entries.length === 0 ? `${name}()` : `${name}(${entries.join(', ')})`;
}

/** The calls the correction recorded, or an empty list when the episode corrected prose rather than actions. */
function callsOf(after: Json): readonly string[] {
  if (after === null || typeof after !== 'object' || Array.isArray(after)) return [];
  const actions = (after as Record<string, Json>)['actions'];
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((entry): entry is Record<string, Json> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => renderCall(entry))
    .filter((line) => line !== '');
}

/** What the correction said the answer should have been, when it had no calls to state it. */
function expectationOf(after: Json): string | undefined {
  if (after === null || typeof after !== 'object' || Array.isArray(after)) return undefined;
  const expectation = (after as Record<string, Json>)['expectation'];
  return typeof expectation === 'string' && expectation.trim() !== '' ? expectation.trim() : undefined;
}

/** The question the episode was answering, when the run recorded one. */
function questionOf(run: RunRecord | undefined): string | undefined {
  const question = run?.input?.['question'];
  return typeof question === 'string' && question.trim() !== '' ? question.trim() : undefined;
}

/**
 * One record, in the words the episode produced, or `undefined` when the event carries nothing to
 * record.
 *
 * Exported because the shape is the treatment and a treatment that is only observable through a
 * store is a treatment whose tests all assert the same thing.
 */
export function rawLogStatement(
  event: FeedbackEvent,
  run: RunRecord | undefined,
  ceiling: number = RAWLOG_STATEMENT_CEILING,
): string | undefined {
  if (event.signal.type !== 'edit') return undefined;
  const question = questionOf(run);
  const calls = callsOf(event.signal.after);
  const expectation = expectationOf(event.signal.after);
  const note = (event.signal.note ?? '').trim();

  const lines: string[] = [];
  // The question first, because it is the half a lexical retriever matches on. A record without it is
  // an answer to nothing, and a store of answers to nothing is what this arm exists to test against.
  if (question !== undefined) lines.push(`Q: ${question}`);
  if (calls.length > 0) {
    lines.push(`A: ${calls.join('; ')}`);
  } else if (expectation !== undefined) {
    lines.push(`A: ${expectation}`);
  }
  // The note only when it says something the answer line does not: in this lane the note *is* the
  // correction's statement, so appending it unconditionally would double every record and spend the
  // ceiling on a duplicate.
  if (note !== '' && !lines.some((line) => line.includes(note))) lines.push(`note: ${note}`);

  if (lines.length === 0) return undefined;
  const text = lines.join('\n');
  return text.length <= ceiling
    ? text
    : `${text.slice(0, ceiling - RAWLOG_TRUNCATION_MARK.length)}${RAWLOG_TRUNCATION_MARK}`;
}

/** Whether one record was clipped by the ceiling. Counted by the driver, so the artefact can say so. */
export function rawLogTruncated(statement: string): boolean {
  return statement.endsWith(RAWLOG_TRUNCATION_MARK);
}

/**
 * The interpreter slot this arm fills, at a stated ceiling.
 *
 * Synchronous on purpose: there is nothing to wait for. A model call here would make the arm a
 * different treatment — an abstracting writer asked to be verbatim is still an abstracting writer,
 * and the eleven faults of R58 are what asking one costs.
 *
 * The ceiling is a parameter rather than a constant because it is the one number this arm was
 * mismeasured by, and a number a registration has to state is a number a reader can check. A ceiling
 * at or below the truncation marker's own length is refused instead of producing a record whose text
 * is the marker: that item would be stored, counted, and serve nothing, which is the failure this
 * repository has recorded twice.
 */
export function rawLogInterpreterFor(ceiling: number): Interpreter {
  if (!Number.isInteger(ceiling) || ceiling <= RAWLOG_TRUNCATION_MARK.length) {
    throw new Error(`rawlog ceiling ${String(ceiling)} cannot hold a record`);
  }
  return (context) => {
    const statement = rawLogStatement(context.event, context.run, ceiling);
    if (statement === undefined) return [];
    const { event } = context;
    // The event's own id first and the run's second: `begin({taskId})` stamps the event, and a capture
    // path that did not would otherwise write records whose support cannot be counted per task -- the
    // defect R55.0 found, where `distinctTasks` was 1 for every item by construction.
    const taskId = event.taskId ?? context.run?.taskId;
    const candidate: DistillCandidate = {
      namespace: event.namespace,
      // `exemplar`, and this arm is the first writer of one in this repository: the store's other
      // writers produce claims (`constraint`, `procedure`, `negative`), and an exemplar is the one kind
      // that is an *instance* rather than a statement about instances. The admission path has no
      // kind-specific rule other than abstention's, so nothing downstream has to learn a new word.
      kind: 'exemplar',
      // The task, not the domain: `stampDomain` adds the domain at the host boundary, and a record
      // scoped to a domain here would pre-empt the one switch that decides what a pack can serve.
      scope: { task: event.task },
      statement,
      payload: {
        taskId: taskId ?? event.runId,
        runId: event.runId,
        calls: callsOf(event.signal.type === 'edit' ? event.signal.after : null).length,
        ceiling,
      },
      evidence: {
        feedbackId: event.id,
        runId: event.runId,
        at: event.at,
        ...(taskId === undefined ? {} : { taskId }),
        weight: RAWLOG_TRUST,
      },
      trust: Math.min(event.trust, RAWLOG_TRUST),
      // The run id, not the text: two corrections that happen to read the same are two episodes, and
      // collapsing them would silently give one record the support of two — which is the abstraction
      // this arm is the control for.
      dedupeKey: contentKey(`rawlog|${event.runId}`),
    };
    return [candidate];
  };
}

/** The same arm at the historical ceiling, for every run that did not state one. */
export const rawLogInterpreter: Interpreter = rawLogInterpreterFor(RAWLOG_STATEMENT_CEILING);

/**
 * What the store holds on this unit, counted from the store rather than from the interpreter's reply.
 *
 * The three numbers are the arm's own accounting and nothing else: how many records it wrote, how many
 * the ceiling clipped, and the fact that the tool-name ban was not installed. The last one is a field
 * rather than an inference because `distillForm.refused` is zero on this arm for the same reason it is
 * zero on any arm the ban never fired on — the ban was absent — and a reader who had to infer which
 * from a zero would be reading two different runs as one.
 */
export type RawLogCensus = {
  readonly records: number;
  readonly clipped: number;
  readonly toolBan: false;
  /**
   * The ceiling these records were written under, when the arm was told one.
   *
   * R85 recorded twelve clipped records and no ceiling, so an artefact could not say whether it had
   * been cut by a number a registration chose or by a module default nobody measured on this unit.
   * Absent means the default stands, which is the honest reading of a run that did not state one.
   */
  readonly ceiling?: number;
};

/** The census, from the items the store kept. */
export function rawLogCensus(
  items: readonly { readonly statement: string }[],
  ceiling?: number,
): RawLogCensus {
  return {
    records: items.length,
    clipped: items.filter((item) => rawLogTruncated(item.statement)).length,
    toolBan: false,
    ...(ceiling === undefined ? {} : { ceiling }),
  };
}
