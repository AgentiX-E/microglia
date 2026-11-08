/**
 * The form that reads a trace: several claims from one episode, in the user's register.
 *
 * R58. The `lesson` form asks a model to read *one correction* — a sentence stating what should
 * have happened — and write one rule. Two things follow from that, and both are measured: the
 * `when` guidance is written for a database ("which tables or columns it involves"), which in a
 * conversational lane can only be satisfied by naming the tools (R54, R56), and a single sentence
 * of a single failure carries one claim, so no item ever recurs (R55.0: `{1: 7}`).
 *
 * This form is asked for a *trace* instead — the request, what the agent did, what the reference
 * trajectory does, and which checks failed — and for up to three claims about it, each stated in
 * the words the request used. The event's payload carries the trace; the tests below are about what
 * the prompt asks for and what the interpreter keeps, not about what a model will answer.
 */
import { describe, expect, it } from 'vitest';
import type { FeedbackEvent, RunRecord } from '../../kernel/index.js';
import { buildDistillPrompt, createLlmInterpreter } from '../llm.js';
import type { InterpretContext } from '../types.js';

const AT = 1_700_000_000_000;

const event: FeedbackEvent = {
  schema: 'microglia.feedback/1',
  id: 'fb_1',
  at: AT,
  namespace: 'tau2',
  sessionId: 's',
  runId: 'run_1',
  task: 'retail',
  kind: 'edit',
  actor: { type: 'user' },
  trust: 0.9,
  signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 1 },
  provenance: { knowledgeIds: [] },
  redactions: 0,
  taskId: 'task-42',
} as FeedbackEvent;

const run: RunRecord = {
  schema: 'microglia.run/1',
  id: 'run_1',
  at: AT,
  namespace: 'tau2',
  sessionId: 's',
  task: 'retail',
  input: {
    question: 'I need to cancel the order I placed yesterday.',
    taskId: 'task-42',
    trace: {
      attempt: ['find_user(user_id="u_1")', 'cancel_pending_order(order_id="#W1")'],
      expected: ['find_user(user_id="u_1")', 'get_order_details(order_id="#W1")', 'cancel_pending_order(order_id="#W1")'],
      rubric: ['The agent must confirm the order is still pending before cancelling it.'],
    },
  },
  output: { actions: [{ name: 'find_user', arguments: {} }] },
  provenance: { knowledgeIds: [] },
  feedbackIds: [],
};

const context: InterpretContext = { event, run };

describe('the trace form', () => {
  it('shows the model the attempt beside the reference trajectory', () => {
    const prompt = buildDistillPrompt(context, [], undefined, 'trace');
    // Both halves, because the claim this form exists for is the *difference* between them: a
    // trace with one side shown is the correction again, one sentence later.
    expect(prompt).toContain('find_user(user_id=\\"u_1\\")');
    expect(prompt).toContain('get_order_details');
    expect(prompt).toContain('cancel_pending_order');
    expect(prompt).toContain('must confirm the order is still pending');
  });

  it('asks for up to three claims, because one trace teaches more than one thing', () => {
    const prompt = buildDistillPrompt(context, [], undefined, 'trace');
    expect(prompt).toContain('at most three candidates');
    expect(prompt).toContain('"candidates"');
  });

  it('forbids the tools by name, which is the ban stated before it has to be enforced', () => {
    const prompt = buildDistillPrompt(context, [], undefined, 'trace');
    expect(prompt).toContain('Never name a tool, a function, an endpoint or an identifier');
  });

  it('asks for the trigger in the words of the request, not in the words of the procedure', () => {
    const prompt = buildDistillPrompt(context, [], undefined, 'trace');
    expect(prompt).toContain('the words the person making the request used');
  });

  it('is not the lesson prompt: the two forms ask for different objects', () => {
    const lesson = buildDistillPrompt(context, [], undefined, 'lesson');
    const trace = buildDistillPrompt(context, [], undefined, 'trace');
    expect(trace).not.toBe(lesson);
    // The lesson form's guidance is the one R56 measured as unreachable in this lane; a trace arm
    // that silently fell back to it would be the R54 dispatch again.
    expect(trace).not.toContain('which tables or columns it involves');
  });

  it('keeps three candidates when the model returns four, and keeps the event it came from', async () => {
    const reply = JSON.stringify({
      candidates: [1, 2, 3, 4].map((index) => ({
        kind: 'procedure',
        statement: `claim number ${index} about confirming the state before changing anything`,
        when: 'the person asks to change something that is already in progress',
      })),
    });
    const interpreter = createLlmInterpreter({
      llm: { complete: async () => reply },
      form: 'trace',
      maxCandidates: 3,
    });
    const candidates = await interpreter(context);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]?.evidence.feedbackId).toBe('fb_1');
    expect(candidates[0]?.evidence.taskId).toBe('task-42');
    expect(candidates[0]?.scope.task).toBe('retail');
  });

  it('still defaults to two candidates for every earlier form', async () => {
    const reply = JSON.stringify({
      candidates: [1, 2, 3].map((index) => ({
        kind: 'procedure',
        statement: `claim number ${index} about confirming the state before changing anything`,
        when: 'the person asks to change something that is already in progress',
      })),
    });
    const interpreter = createLlmInterpreter({ llm: { complete: async () => reply } });
    expect(await interpreter(context)).toHaveLength(2);
  });
});
