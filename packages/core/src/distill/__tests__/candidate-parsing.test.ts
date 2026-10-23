import { describe, expect, it } from 'vitest';
import { createLlmInterpreter, parseCandidates, parseDistillResponse, repairJson } from '../llm.js';

const base = { namespace: 'n', task: 't', eventId: 'e', runId: 'r', at: 1 };

describe('candidate parsing', () => {
  it('reads the documented shape, a bare array, and a single object', () => {
    const wrapped = parseCandidates('{"candidates":[{"kind":"constraint","statement":"a"}]}');
    expect(wrapped).toHaveLength(1);

    const bare = parseCandidates('[{"kind":"constraint","statement":"a"},{"kind":"negative","statement":"b"}]');
    expect(bare).toHaveLength(2);

    const single = parseCandidates('{"kind":"constraint","statement":"only one"}');
    expect(single).toEqual([{ kind: 'constraint', statement: 'only one' }]);
  });

  it('accepts a reply wrapped in prose and a fence', () => {
    const fenced = parseCandidates('Here it is:\n```json\n{"candidates":[{"kind":"lexicon","statement":"x"}]}\n```');
    expect(fenced).toHaveLength(1);
  });

  it('escapes a raw newline inside a statement instead of rejecting the reply', () => {
    const raw = '{"candidates":[{"kind":"constraint","statement":"line one\nline two"}]}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(repairJson(raw)).toContain('line one\\nline two');
    const parsed = parseCandidates(raw);
    expect(parsed).toHaveLength(1);
    expect(parseDistillResponse(raw, base)[0]?.statement).toBe('line one\nline two');
  });

  it('tolerates a trailing comma left by a model', () => {
    const parsed = parseCandidates('{"candidates":[{"kind":"constraint","statement":"a"},]}');
    expect(parsed).toHaveLength(1);
  });

  it('leaves legal whitespace between tokens alone', () => {
    const pretty = '{\n  "candidates": [\n    {"kind": "constraint", "statement": "a"}\n  ]\n}';
    expect(repairJson(pretty)).toBe(pretty);
    expect(parseCandidates(pretty)).toHaveLength(1);
  });

  it('finds the payload after prose that contains its own brackets', () => {
    // Both of these are ordinary model replies, and both used to be thrown away as
    // "not JSON": the extractor took the slice from the first bracket it found,
    // which was prose. The candidates were right there.
    const afterBrace = parseCandidates('A {brace} then [{"kind":"constraint","statement":"a"}]');
    expect(afterBrace).toHaveLength(1);
    const afterBracket = parseCandidates('Note [1] here: {"candidates":[{"kind":"constraint","statement":"a"}]}');
    expect(afterBracket).toHaveLength(1);
  });

  it('skips a decoy array and keeps looking for candidates', () => {
    // `[1]` parses, but it is not a candidate list. Treating it as one returned an
    // empty distillation with no error — "the model said nothing" and "the model
    // said nonsense" have to be different observations.
    expect(parseCandidates('[1] then {"candidates":[{"kind":"constraint","statement":"a"}]}')).toHaveLength(1);
    expect(() => parseCandidates('[1, 2, 3]')).toThrow(/not JSON/);
  });

  it('does not end the payload at a bracket inside a string', () => {
    const raw = '{"candidates":[{"kind":"constraint","statement":"use } as the separator"}]}';
    expect(parseCandidates(raw)).toHaveLength(1);
    expect(parseDistillResponse(raw, base)[0]?.statement).toBe('use } as the separator');
  });

  it('escapes every control character a model leaves raw, not only the newline', () => {
    // A tab and a carriage return inside a statement are the same defect as a raw
    // newline, and an escape that handled one of the three would pass the old test.
    const raw = '{"candidates":[{"kind":"constraint","statement":"a\tb\rc"}]}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseDistillResponse(raw, base)[0]?.statement).toBe('a\tb\rc');
  });

  it('reports a literal that parses and is not a candidate list', () => {
    expect(() => parseCandidates('null')).toThrow(/not JSON/);
    expect(() => parseCandidates('42')).toThrow(/not JSON/);
    expect(() => parseCandidates('text { unclosed')).toThrow(/not JSON/);
    expect(() => parseCandidates('')).toThrow(/not JSON/);
  });

  it('reads an empty array as "nothing to learn", and nothing else as that', () => {
    expect(parseCandidates('[]')).toEqual([]);
    // The same array inside a wrong-shaped answer is a fragment, not an answer.
    expect(() => parseCandidates('{"rules":[]}')).toThrow(/not JSON/);
  });

  it('refuses to scan an unbounded number of bracketed starts', () => {
    // A pathological reply full of braces must not turn the parser into a quadratic
    // search. The payload is beyond the cap, so the reply is reported as unparseable
    // rather than accepted with the wrong slice.
    const flood = '{'.repeat(40) + '{"candidates":[{"kind":"constraint","statement":"a"}]}';
    expect(() => parseCandidates(flood)).toThrow(/not JSON/);
  });

  it('stamps the event task instance onto every candidate it accepts', async () => {
    // Evidence without the task instance cannot be traced back to the job it was
    // learned on, and the erasure-by-task path then misses it.
    const interpreter = createLlmInterpreter({
      llm: {
        complete: async () => '{"candidates":[{"kind":"constraint","statement":"a"}]}',
      },
    });
    const base = {
      schema: 'microglia.feedback/1',
      id: 'fb_1',
      at: 1,
      namespace: 'n',
      sessionId: 's',
      runId: 'r',
      task: 't',
      attempt: 1,
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: {} },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    };
    const withTask = await interpreter({ event: { ...base, taskId: 't_1' } } as never);
    expect(withTask[0]?.evidence.taskId).toBe('t_1');
    const without = await interpreter({ event: base } as never);
    expect(without[0]?.evidence).not.toHaveProperty('taskId');
  });

  it('carries the task instance into the evidence when the event has one', () => {
    const parsed = parseDistillResponse('{"candidates":[{"kind":"constraint","statement":"a"}]}', {
      ...base,
      taskId: 't_1',
    });
    expect(parsed[0]?.evidence.taskId).toBe('t_1');
    expect(parseDistillResponse('{"candidates":[{"kind":"constraint","statement":"a"}]}', base)[0]?.evidence)
      .not.toHaveProperty('taskId');
  });

  it('rejects a reply with no candidate at all, and says what it saw', () => {
    expect(() => parseCandidates('{"candidates":"none"}')).toThrow(/not JSON/);
    try {
      parseCandidates('the model refused');
    } catch (error) {
      const details = (error as { details?: Record<string, unknown> }).details;
      expect(String(details?.['preview'])).toContain('the model refused');
    }
  });
});
