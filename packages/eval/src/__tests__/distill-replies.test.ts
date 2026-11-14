/**
 * The reply census, which is the only counter that can see a model choosing silence.
 *
 * The four funnel counts cannot: an empty reply is one event asked, zero candidates, zero drops. So
 * these tests assert the classification itself — `[]` is empty, prose is unparsed, `{"candidates":[]}`
 * is empty, a whitespace-only reply is blank — and that the first reply of each kind is kept verbatim
 * while the rest are only counted.
 *
 * The blank case is the one this file previously asserted the other way: `replyIsEmpty('')` was
 * expected to be `false`, on the argument that a reply which is not JSON is the interpreter's to
 * count. R104 showed what that costs — `0 empty` printed beside `63 MG_E_INVALID_SIGNAL` and one
 * fault sample with an empty quote.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_PREVIEW_CHARS, classifyReply, replyCensus, replyCensusLine } from '../distill-replies.js';

describe('classifying one reply', () => {
  it('reads a bare empty array as the model saying nothing', () => {
    expect(classifyReply('[]')).toBe('empty');
    expect(classifyReply('  [ ]  ')).toBe('empty');
  });

  it('reads an empty candidate list inside an object the same way', () => {
    // The two spellings of the same answer, which is exactly the ambiguity the driver could not
    // resolve from its artefact: `[]` and `{"candidates":[]}` are one fact written twice.
    expect(classifyReply('{"candidates":[]}')).toBe('empty');
    expect(classifyReply('{"candidates" : [ ] }')).toBe('empty');
  });

  it('reads a claim as answered, whatever its length', () => {
    expect(classifyReply('{"candidates":[{"kind":"procedure","statement":"x"}]}')).toBe('answered');
  });

  it('reads a whitespace-only reply as blank, which is not the same failure as prose', () => {
    // The distinction the lane could not draw: a model that returned `"\n\n"` and a model that
    // returned a sentence both produced `MG_E_INVALID_SIGNAL`, and only one of them is a parser
    // problem. An empty reply cannot carry a preview, so it has to be counted rather than delegated.
    expect(classifyReply('')).toBe('blank');
    expect(classifyReply('   ')).toBe('blank');
    expect(classifyReply('\n\n\t ')).toBe('blank');
  });

  it('reads prose as unparsed rather than as blank, so the two silences stay apart', () => {
    expect(classifyReply('I could not find a rule in this correction.')).toBe('unparsed');
    expect(classifyReply('null')).toBe('unparsed');
  });
});

describe('the census a driver notes every reply into', () => {
  it('counts calls and characters even when every reply is empty', () => {
    const counter = replyCensus();
    for (let index = 0; index < 15; index += 1) counter.note('[]');
    const reading = counter.reading();
    expect(reading.calls).toBe(15);
    expect(reading.empty).toBe(15);
    expect(reading.answered).toBe(0);
    expect(reading.blank).toBe(0);
    expect(reading.unparsed).toBe(0);
    expect(reading.chars).toBe(30);
    expect(reading.firstEmpty).toBe('[]');
  });

  it('keeps the first empty reply only, because fifteen identical replies say no more than one', () => {
    const counter = replyCensus();
    counter.note('{"candidates":[]}');
    counter.note('[]');
    expect(counter.reading().firstEmpty).toBe('{"candidates":[]}');
    expect(counter.reading().empty).toBe(2);
  });

  it('omits the field when no reply was of that kind, rather than writing an empty string', () => {
    const counter = replyCensus();
    counter.note('{"candidates":[{"kind":"procedure"}]}');
    const reading = counter.reading();
    expect(reading).not.toHaveProperty('firstEmpty');
    expect(reading).not.toHaveProperty('firstBlank');
    expect(reading).not.toHaveProperty('firstUnparsed');
    expect(reading.empty).toBe(0);
    expect(reading.answered).toBe(1);
  });

  it('bounds the quote, so a model that echoes its prompt cannot put the prompt in the artefact', () => {
    const counter = replyCensus();
    counter.note(`[${' '.repeat(500)}]`);
    expect(counter.reading().firstEmpty?.length).toBe(EMPTY_PREVIEW_CHARS);
  });

  it('keeps a blank reply as it arrived, because the invisible characters are the finding', () => {
    const counter = replyCensus();
    counter.note('\n\n  ');
    // Trimmed, this would be the empty string, which is the same sample the interpreter produced
    // and the reason the artefact could not say what came back.
    expect(counter.reading().firstBlank).toBe('\n\n  ');
    expect(counter.reading().blank).toBe(1);
  });

  it('adds up to the number of calls, which is what makes the four states a partition', () => {
    const counter = replyCensus();
    counter.note('{"candidates":[{"kind":"procedure","statement":"x"}]}');
    counter.note('[]');
    counter.note('   ');
    counter.note('Here is the rule: always check the order state.');
    const reading = counter.reading();
    expect(reading.answered + reading.empty + reading.blank + reading.unparsed).toBe(reading.calls);
    expect(reading.calls).toBe(4);
  });

  it('hands the reply back, so a caller can wrap a model seam in one expression', () => {
    const counter = replyCensus();
    expect(counter.note('[]')).toBe('[]');
  });

  it('is readable more than once and never consumed', () => {
    const counter = replyCensus();
    counter.note('[]');
    expect(counter.reading()).toEqual(counter.reading());
  });
});

describe('the line a driver prints', () => {
  it('names all four states, because "0 empty" was the line that hid 63 blanks', () => {
    const counter = replyCensus();
    counter.note('{"candidates":[{"kind":"procedure","statement":"x"}]}');
    expect(replyCensusLine(counter.reading())).toBe(
      '1 call(s), 1 answered, 0 empty, 0 blank, 0 unparsed, 53 character(s) returned',
    );
  });

  it('quotes a blank sample instead of trailing the line with nothing', () => {
    const counter = replyCensus();
    counter.note('\n\n  ');
    // `\n\n  ` printed bare is invisible, which is exactly what the old fault sample looked like.
    expect(replyCensusLine(counter.reading())).toContain('first blank "\\n\\n  "');
  });

  it('omits every sample when no reply carried one', () => {
    const reading = replyCensus().reading();
    expect(replyCensusLine(reading)).toBe(
      '0 call(s), 0 answered, 0 empty, 0 blank, 0 unparsed, 0 character(s) returned',
    );
  });
});
