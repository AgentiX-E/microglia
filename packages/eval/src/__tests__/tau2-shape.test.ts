/**
 * The shape parser, tested against the strings the lane actually writes.
 *
 * Every case below is a record `rawLogInterpreterFor` could produce from a τ² correction: `renderCall`
 * serialises arguments with `JSON.stringify`, so a string argument may contain a separator, a quote, a
 * bracket or an escape, and each of those is a way a naive split produces a routine no task taught.
 */
import { describe, expect, it } from 'vitest';
import { callsOfStatement, tau2ShapeOf } from '../tau2-shape.js';

const record = (...lines: readonly string[]): string => lines.join('\n');
/** The extractor takes a record, which is what the fold hands it; the tests write the text. */
const shapeOf = (statement: string): string | undefined => tau2ShapeOf({ statement });

describe('callsOfStatement', () => {
  it('reads the call names in order, without their arguments', () => {
    expect(
      callsOfStatement(
        record(
          'Q: exchange a delivered item for another',
          'A: get_order_details(order_id="W1"); exchange_delivered_order_items(order_id="W1", item_ids=["a"])',
          'note: confirm the address first',
        ),
      ),
    ).toEqual(['get_order_details', 'exchange_delivered_order_items']);
  });

  it('does not split on a separator inside an argument', () => {
    // `JSON.stringify` of `'a; b'` is `"a; b"`, and a split on `;` would report two calls here.
    expect(
      callsOfStatement(record('Q: q', 'A: cancel_pending_order(order_id="W1", reason="a; b")')),
    ).toEqual(['cancel_pending_order']);
  });

  it('does not split on a separator inside nested brackets', () => {
    expect(
      callsOfStatement(record('Q: q', 'A: pay(order_id="W1", split={"a": [1, 2], "b": "x;y"})')),
    ).toEqual(['pay']);
  });

  it('survives an escaped quote inside an argument', () => {
    expect(
      callsOfStatement(record('Q: q', 'A: reply(text="say \\"hi; there\\" now"); done()')),
    ).toEqual(['reply', 'done']);
  });

  it('reads a call that takes no arguments', () => {
    expect(callsOfStatement(record('Q: q', 'A: list_all()))'))).toEqual(['list_all']);
  });

  it('ignores a trailing separator rather than inventing an empty name', () => {
    expect(callsOfStatement(record('Q: q', 'A: a(); '))).toEqual(['a']);
  });

  it('states no routine for a record with no answer line', () => {
    // A rubric-only correction writes `A: <the expectation as prose>` — one segment with no parenthesis.
    // It is still a shape here, because the prose is the routine that task stated; what is not a shape
    // is a record with no `A:` line at all.
    expect(callsOfStatement(record('Q: q', 'note: nothing happened'))).toEqual([]);
    expect(callsOfStatement(record('Q: q', 'A: '))).toEqual([]);
    expect(callsOfStatement('')).toEqual([]);
  });

  it('reads prose on the answer line as one routine, which is what that task taught', () => {
    expect(shapeOf(record('Q: q', 'A: ask the customer to confirm the address first'))).toEqual(
      'ask the customer to confirm the address first',
    );
  });

  it('is a shape of names and not of values, so two failures of one routine agree', () => {
    const first = record('Q: q', 'A: get_order_details(order_id="W1"); cancel_pending_order(order_id="W1")');
    const second = record('Q: q', 'A: get_order_details(order_id="W9"); cancel_pending_order(order_id="W9")');
    expect(shapeOf(first)).toBe(shapeOf(second));
    expect(shapeOf(first)).toBe('get_order_details > cancel_pending_order');
  });

  it('states no shape for a record whose answer line names nothing', () => {
    expect(shapeOf(record('Q: q'))).toBeUndefined();
  });
});
