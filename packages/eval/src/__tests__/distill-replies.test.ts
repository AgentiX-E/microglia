/**
 * The reply census, which is the only counter that can see a model choosing silence.
 *
 * The four funnel counts cannot: an empty reply is one event asked, zero candidates, zero drops. So
 * these tests assert the classification itself — `[]` is empty, prose is not, `{"candidates":[]}` is —
 * and that the first empty reply is kept verbatim while the rest are only counted.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_PREVIEW_CHARS, replyCensus, replyIsEmpty } from '../distill-replies.js';

describe('classifying one reply', () => {
  it('reads a bare empty array as the model saying nothing', () => {
    expect(replyIsEmpty('[]')).toBe(true);
    expect(replyIsEmpty('  [ ]  ')).toBe(true);
  });

  it('reads an empty candidate list inside an object the same way', () => {
    // The two spellings of the same answer, which is exactly the ambiguity the driver could not
    // resolve from its artefact: `[]` and `{"candidates":[]}` are one fact written twice.
    expect(replyIsEmpty('{"candidates":[]}')).toBe(true);
    expect(replyIsEmpty('{"candidates" : [ ] }')).toBe(true);
  });

  it('does not read a claim as empty, whatever its length', () => {
    expect(replyIsEmpty('{"candidates":[{"kind":"procedure","statement":"x"}]}')).toBe(false);
  });

  it('does not fold prose into the empty count, because that is an error with its own sample', () => {
    // A reply the parser cannot read throws, is counted as a fault, and carries a preview. Counting
    // it here as well would report one failure twice and hide that the model answered.
    expect(replyIsEmpty('I could not find a rule in this correction.')).toBe(false);
    expect(replyIsEmpty('')).toBe(false);
  });
});

describe('the census a driver notes every reply into', () => {
  it('counts calls and characters even when every reply is empty', () => {
    const counter = replyCensus();
    for (let index = 0; index < 15; index += 1) counter.note('[]');
    const reading = counter.reading();
    expect(reading.calls).toBe(15);
    expect(reading.empty).toBe(15);
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

  it('omits the field when no reply was empty, rather than writing an empty string', () => {
    const counter = replyCensus();
    counter.note('{"candidates":[{"kind":"procedure"}]}');
    const reading = counter.reading();
    expect(reading).not.toHaveProperty('firstEmpty');
    expect(reading.empty).toBe(0);
  });

  it('bounds the quote, so a model that echoes its prompt cannot put the prompt in the artefact', () => {
    const counter = replyCensus();
    counter.note(`[${' '.repeat(500)}]`);
    expect(counter.reading().firstEmpty?.length).toBe(EMPTY_PREVIEW_CHARS);
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
