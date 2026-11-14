/**
 * Who wrote the store and how much of the population it covers, on the numbers a run printed.
 *
 * The first version of this module decided authorship from the fault share, and R104 is the case
 * that falsifies it: 63 of 73 events fell back, the fallback returned **no candidates at all**, and
 * the six stored items were the model's. A fallback that is invoked and files, so `faults/asked` is
 * a statement about calls and not about output. These tests pin authorship to claims.
 */
import { describe, expect, it } from 'vitest';
import { writerOf } from '../distill-writer.js';

describe('reading which writer produced a store', () => {
  it('says nobody wrote it when no event was asked, which is not a clean model store', () => {
    const reading = writerOf({ asked: 0, faults: 0, primaryClaims: 0, fallbackClaims: 0 });
    expect(reading.state).toBe('none');
    expect(reading.modelCoverage).toBe(0);
    expect(reading.sentence).toContain('not written by one');
  });

  it('says nobody wrote it when both sides were asked and neither produced a claim', () => {
    const reading = writerOf({ asked: 15, faults: 15, primaryClaims: 0, fallbackClaims: 0 });
    expect(reading.state).toBe('none');
    expect(reading.modelCoverage).toBe(0);
    expect(reading.sentence).toContain('written by nobody');
  });

  it('keeps the store the model’s when the fallback answered many events and filed nothing', () => {
    // R104 exactly: 73 asked, 63 fell back, 16 claims all the model's. Reading authorship off the
    // fault share called this a fallback store; reading it off the claims calls it the model's, with
    // coverage of 10 events.
    const reading = writerOf({ asked: 73, faults: 63, primaryClaims: 16, fallbackClaims: 0 });
    expect(reading.state).toBe('model');
    expect(reading.modelCoverage).toBeCloseTo(10 / 73, 10);
    expect(reading.sentence).toContain('16 claim(s) from 10 of 73 event(s)');
    expect(reading.sentence).toContain('the fallback was invoked on 63 and contributed nothing');
  });

  it('says the fallback wrote it only when the model produced nothing at all', () => {
    const reading = writerOf({ asked: 32, faults: 32, primaryClaims: 0, fallbackClaims: 32 });
    expect(reading.state).toBe('fallback');
    expect(reading.sentence).toContain('the fallback’s');
  });

  it('says both wrote it when both produced claims, because no arm can separate them', () => {
    const reading = writerOf({ asked: 20, faults: 5, primaryClaims: 12, fallbackClaims: 5 });
    expect(reading.state).toBe('mixed');
    expect(reading.sentence).toContain('holds both writers');
  });

  it('does not mention the fallback when no event fell back', () => {
    const reading = writerOf({ asked: 73, faults: 0, primaryClaims: 73, fallbackClaims: 0 });
    expect(reading.state).toBe('model');
    expect(reading.modelCoverage).toBe(1);
    expect(reading.sentence).toContain('no event fell back');
  });

  it('refuses counts that cannot be a run, rather than reading them as a share', () => {
    // A fault is an event the model threw on, so there can never be more faults than events.
    const reading = writerOf({ asked: 5, faults: 9, primaryClaims: 1, fallbackClaims: 0 });
    expect(reading.faults).toBe(5);
    expect(reading.modelCoverage).toBe(0);
    expect(writerOf({ asked: -3, faults: -1, primaryClaims: 0, fallbackClaims: 0 }).state).toBe('none');
    expect(writerOf({ asked: 2, faults: 0, primaryClaims: -4, fallbackClaims: 0 }).primaryClaims).toBe(0);
  });
});
