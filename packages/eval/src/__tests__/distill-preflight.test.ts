/**
 * The pre-flight's own tests.
 *
 * Three things are worth testing here and the third is the one that would rot silently: that the
 * fixture is a coherent event (an interpreter reads `event`, `run`, and the signal's `after`), that
 * the verdict distinguishes the three ways one call can end, and that the prompt the pre-flight
 * sends is **the arm's prompt** rather than a second, hand-written one that can drift from it.
 */
import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '@agentix-e/microglia-core';
import { buildDistillPrompt, createLlmInterpreter } from '@agentix-e/microglia-core/distill';
import {
  PREFLIGHT_TASK,
  classifyPreflight,
  preflightContext,
  previewOf,
  runDistillPreflight,
} from '../distill-preflight.js';

describe('the fixture', () => {
  it('is one coherent event, because an interpreter reads both halves', () => {
    const { event, run } = preflightContext();
    expect(event.schema).toBe('microglia.feedback/1');
    expect(event.runId).toBe(run.id);
    expect(event.taskId).toBe(run.taskId);
    expect(event.task).toBe(PREFLIGHT_TASK);
    expect(event.kind).toBe('edit');
    expect(run.provenance.knowledgeIds).toEqual([]);
  });

  it('carries the difference the lesson is in: the attempt, the reference, and the note', () => {
    const { event, run } = preflightContext();
    expect(event.signal.type).toBe('edit');
    if (event.signal.type !== 'edit') throw new Error('unreachable');
    expect(event.signal.after).toBeDefined();
    expect(event.signal.note).toContain('returned');
    // The trace half: the wrong attempt cancelled a pending order, the reference returns the items.
    expect(JSON.stringify(run.input)).toContain('cancel_pending_order');
    expect(JSON.stringify(run.input)).toContain('return_delivered_order_items');
    expect(run.output).toEqual({ actions: ['get_order_details', 'cancel_pending_order'] });
  });

  it('is deterministic, so two pre-flights of one arm compare', () => {
    expect(preflightContext()).toEqual(preflightContext());
  });
});

describe('the prompt the pre-flight sends is the arm prompt', () => {
  /** Everything the model reads before the event: the instructions, and nothing else. */
  function instructionsOf(prompt: string): string {
    const marker = prompt.indexOf('<event>');
    expect(marker).toBeGreaterThan(0);
    return prompt.slice(0, marker);
  }

  it('is byte-identical to the instructions an arm event of the same form carries', async () => {
    // The failure this rules out is the one that would never fail a test of the fixture: a pre-flight
    // written as its own prompt, passing on a model that cannot answer the prompt the arm sends.
    const prompts: string[] = [];
    const interpreter = createLlmInterpreter({
      llm: {
        complete: async (prompt) => {
          prompts.push(prompt);
          return '[]';
        },
      },
      form: 'lesson',
    });
    const preflight = preflightContext();
    const other = preflightContext();
    await interpreter(preflight);
    await interpreter({
      ...other,
      event: { ...other.event, id: 'fb_2', taskId: 'other' },
    });
    expect(prompts).toHaveLength(2);
    const [first, second] = prompts as [string, string];
    expect(instructionsOf(first)).toBe(instructionsOf(second));
    // And the instructions are the ones the parser's form builds, not an empty prefix.
    const literal = buildDistillPrompt(preflight, [], undefined, 'lesson', 2, false);
    expect(instructionsOf(first)).toBe(instructionsOf(literal));
  });
});

describe('the verdict, which is the only thing that lets an arm proceed', () => {
  it('accepts an answer with claims', () => {
    const reading = classifyPreflight({ ok: true, candidates: [{}, {}], reply: '{"candidates":[{},{}]}' });
    expect(reading.state).toBe('answered');
    expect(reading.reason).toContain('2 claim(s)');
  });

  it('refuses an empty reply and quotes what came back', () => {
    const reading = classifyPreflight({ ok: true, candidates: [], reply: '  []  ' });
    expect(reading.state).toBe('empty');
    expect(reading.preview).toBe('[]');
    expect(reading.reason).toContain('returned no claim');
    expect(reading.reason).toContain('[]');
  });

  it('refuses a throw as a different fact from a silence', () => {
    const reading = classifyPreflight({ ok: false, code: 'MG_E_INVALID_SIGNAL', sample: 'not json <- {' });
    expect(reading.state).toBe('error');
    expect(reading.reason).toContain('MG_E_INVALID_SIGNAL');
    expect(reading.reason).toContain('<- {');
  });

  it('bounds the quote, because a reply is not a document', () => {
    expect(previewOf(`  ${'x'.repeat(500)}  `)).toHaveLength(200);
  });
});

describe('one call, and what it produced', () => {
  it('reads the candidates an interpreter returns', async () => {
    const reading = await runDistillPreflight(async () => [
      {
        kind: 'procedure',
        statement: 's',
        scope: { task: PREFLIGHT_TASK },
        evidence: { feedbackId: 'fb_preflight_1', runId: 'run_preflight_1', at: 0, weight: 1 },
        namespace: 'microglia-l4',
        trust: 0.6,
        dedupeKey: 'k',
      },
    ]);
    expect(reading.state).toBe('answered');
    expect(reading.candidates).toBe(1);
  });

  it('carries the reply when the caller kept it, because `[]` is a fact about the model', async () => {
    const reading = await runDistillPreflight(async () => [], { replyOf: () => '[]' });
    expect(reading.state).toBe('empty');
    if (reading.state !== 'empty') throw new Error('unreachable');
    expect(reading.preview).toBe('[]');
    expect(reading.chars).toBe(2);
  });

  it('names the code a host error carries, and reports an unknown throw as unknown', async () => {
    const coded = await runDistillPreflight(async () => {
      throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'LLM response is not JSON');
    });
    expect(coded.state).toBe('error');
    if (coded.state !== 'error') throw new Error('unreachable');
    expect(coded.code).toBe('MG_E_INVALID_SIGNAL');

    const plain = await runDistillPreflight(async () => {
      throw new Error('socket hang up');
    });
    expect(plain.state).toBe('error');
    if (plain.state !== 'error') throw new Error('unreachable');
    expect(plain.code).toBe('unknown');
    expect(plain.sample).toContain('socket hang up');
  });

  it('reports a thrown non-Error as a sample rather than as an empty message', async () => {
    // A rejected promise can carry anything, and `error.message` on a string is `undefined`: the
    // refusal would then read `(unknown): undefined`, which is the sentence shape this lane counts
    // as an instrument failure rather than as a reading.
    const thrown = await runDistillPreflight(async () => {
      throw 'the endpoint returned 502';
    });
    expect(thrown.state).toBe('error');
    if (thrown.state !== 'error') throw new Error('unreachable');
    expect(thrown.sample).toBe('the endpoint returned 502');
    expect(thrown.reason).toContain('the endpoint returned 502');
  });

  it('asks about the fixture when the caller names no context', async () => {
    const asked: string[] = [];
    const reading = await runDistillPreflight(async (context) => {
      asked.push(context.event.id);
      return [];
    });
    expect(asked).toEqual(['fb_preflight_1']);
    expect(reading.state).toBe('empty');
  });
});
