import { describe, expect, it } from 'vitest';
import { redact, redactJson } from '../index.js';

/**
 * A ten-digit run.
 *
 * It is task 15's `product_id` in the pinned ta2 retail corpus, and it is also the shape the phone
 * rule matches: `\d{3}[ -]?\d{3}[ -]?\d{4}`. Nothing about the digits themselves distinguishes a row
 * key from a telephone number, which is why the guard needs the key to decide.
 */
const PRODUCT_ID = '7363354090';
const OTHER_ID = '3613716226';

/** A customer's contact address, in the ta2 retail corpus's generated shape. */
const CUSTOMER_EMAIL = 'daikisanchez1479@example.com';

/** A synthetic credential: assembled at runtime so the repository audit stays strict. */
const FAKE_KEY = `sk-${'a'.repeat(24)}`;

describe('a reference is not a phone number', () => {
  it('keeps a ten-digit run that a reference key introduces', () => {
    const statement = `get_product_details(product_id="${PRODUCT_ID}")`;
    const result = redact(statement);
    expect(result.text).toBe(statement);
    expect(result.count).toBe(0);
  });

  it('keeps it when the argument is unquoted and last', () => {
    expect(redact(`product_id=${PRODUCT_ID}`).text).toBe(`product_id=${PRODUCT_ID}`);
  });

  it('keeps it when the argument precedes another one', () => {
    const statement = `get_product_details(product_id=${PRODUCT_ID}, verbose=true)`;
    expect(redact(statement).text).toBe(statement);
  });

  it('keeps every element of a reference list, not only the first', () => {
    // The first element sits beside the key and the rest sit beside a comma, so a rule keyed on the
    // key alone would leave `["1615379700", "[phone]"]` -- an identity half kept, which is worse than
    // none kept, because the model would read the placeholder as the answer.
    const statement = `exchange_delivered_order_items(item_ids=["1615379700", "${OTHER_ID}"])`;
    const result = redact(statement);
    expect(result.text).toBe(statement);
    expect(result.count).toBe(0);
  });

  it('keeps the whole record the writer builds for a retail task', () => {
    const statement = [
      'Q: I want a smaller size for the item I bought, order #W5199551.',
      `A: exchange_delivered_order_items(order_id="#W5199551", item_ids=["1615379700"], ` +
        `new_item_ids=["${OTHER_ID}"], payment_method_id="paypal_5364164")`,
    ].join('\n');
    const result = redact(statement);
    expect(result.text).toBe(statement);
    expect(result.count).toBe(0);
  });
});

describe('what the guard still redacts', () => {
  it('redacts the same digits when no key says they are a reference', () => {
    expect(redact(`call me on ${PRODUCT_ID}`).text).toBe('call me on [phone]');
  });

  it('redacts them when the key is not reference-shaped', () => {
    expect(redact(`phone="${PRODUCT_ID}"`).text).toBe('phone="[phone]"');
    expect(redact(`"${PRODUCT_ID}"`).text).toBe('"[phone]"');
  });

  it('redacts a formatted number even under a reference key', () => {
    // `user_id` is a reference key, but `+1 415-555-2671` is not a reference's shape: a row key is a
    // bare digit run, and separators are the one thing an integer identifier never carries.
    // The stray `+` and `(` are delimiters the pattern leaves outside its match, and they predate this
    // change: the digits are gone either way, and the exemption is not allowed to alter what the rule
    // does to a real number.
    expect(redact('user_id="+1 415-555-2671"').text).toBe('user_id="+[phone]"');
    expect(redact('user_id="(415) 555-2671"').text).toBe('user_id="([phone]"');
  });

  it('redacts an email even under a reference key', () => {
    // Deliberately not exempted. A ten-digit run under `*_id` is a row key by the field's own
    // declaration; an address is a person's contact detail in every field, and ta2 retail's
    // `user_id` really is one. Recovering it would trade a real privacy property for a benchmark
    // number, so the loss stays, counted, as `census.redacted`.
    expect(redactJson({ user_id: CUSTOMER_EMAIL })).toEqual({ user_id: '[email]' });
    expect(redact(`user_id="${CUSTOMER_EMAIL}"`).text).toBe('user_id="[email]"');
  });

  it('redacts a credential even under a reference key', () => {
    // An identifier-shaped key is exactly where a leaked key gets stored (`api_key_id`), so the
    // exemption is scoped to the phone rule and no other rule is skipped.
    expect(redactJson({ api_key_id: FAKE_KEY })).toEqual({ api_key_id: '[api-key]' });
  });

  it('leaves a value of mixed shape to the guard, entirely', () => {
    const statement = `product_id="${PRODUCT_ID} or 415-555-2671"`;
    expect(redact(statement).text).toBe('product_id="[phone] or [phone]"');
  });

  it('does not widen what counts as a phone number', () => {
    // The run is followed by letters, so it is neither a phone (no word boundary) nor a lone
    // reference value (the quoted alternative requires the whole value to be digits).
    expect(redact(`product_id="${PRODUCT_ID}abc"`).text).toBe(`product_id="${PRODUCT_ID}abc"`);
  });

  it('counts only the redactions it made', () => {
    const statement = `A: get_product_details(product_id="${PRODUCT_ID}"); call 415-555-2671`;
    const result = redact(statement);
    expect(result.text).toContain(PRODUCT_ID);
    expect(result.text).toContain('[phone]');
    expect(result.count).toBe(1);
  });
});

describe('redactJson carries the key', () => {
  it('keeps a bare digit run under a reference key', () => {
    expect(redactJson({ product_id: PRODUCT_ID })).toEqual({ product_id: PRODUCT_ID });
  });

  it('keeps the elements of an array whose key is a reference', () => {
    expect(redactJson({ item_ids: ['1615379700', OTHER_ID] })).toEqual({
      item_ids: ['1615379700', OTHER_ID],
    });
  });

  it('keeps it through nesting, and decides per key rather than per object', () => {
    expect(redactJson({ order: { item_id: PRODUCT_ID, phone: PRODUCT_ID } })).toEqual({
      order: { item_id: PRODUCT_ID, phone: '[phone]' },
    });
  });

  it('does not carry a reference key into an array that is not one', () => {
    expect(redactJson({ tags: [PRODUCT_ID] })).toEqual({ tags: ['[phone]'] });
  });

  it('requires the whole value to be digits', () => {
    expect(redactJson({ product_id: `${PRODUCT_ID} or 415-555-2671` })).toEqual({
      product_id: '[phone] or [phone]',
    });
  });

  it('recognises the key shapes a reference takes, and only those', () => {
    for (const key of ['id', 'order_id', 'item_ids', 'ORDER_ID', 'sku_id']) {
      expect(redactJson({ [key]: PRODUCT_ID })).toEqual({ [key]: PRODUCT_ID });
    }
    for (const key of ['paid', 'grid', 'identity', 'identifier', 'phone', 'email', 'ids']) {
      expect(redactJson({ [key]: PRODUCT_ID })).toEqual({ [key]: '[phone]' });
    }
  });

  it('leaves non-string leaves alone', () => {
    expect(redactJson({ product_id: 42, ok: true, none: null })).toEqual({
      product_id: 42,
      ok: true,
      none: null,
    });
  });
});
