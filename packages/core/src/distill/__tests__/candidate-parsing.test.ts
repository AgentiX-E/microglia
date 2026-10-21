import { describe, expect, it } from 'vitest';
import { parseCandidates, parseDistillResponse, repairJson } from '../llm.js';

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
