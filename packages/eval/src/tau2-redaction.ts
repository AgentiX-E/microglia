/**
 * R88's missing 46 values: the guard, not the writer — and what was done about it.
 *
 * R88 read `faithfulness 82 of 128` with two records clipped, which left three explanations on the
 * table and no instrument able to choose between them: the ceiling cut the text, the writer abstracted
 * it, or the measure was wrong. A model-free reconstruction of the same twelve corrections from the
 * pinned corpus keeps **all 128** entities at the same 2,000-character ceiling and clips the same two
 * records, so the ceiling and the writer are both cleared. What removed the values was
 * `kernel/guard.ts`, whose second rule is a North-American phone pattern — ten digits — and a τ² retail
 * answer is made of ten-digit product ids:
 *
 *     find_user_id_by_name_zip(first_name="Fatima", …); get_product_details(product_id="[phone]")
 *
 * `7363354090` is task 15's `product_id`. It is not a phone number, it never was, and the pattern could
 * not tell the difference; `redactJson` runs on the edit's `after` payload in `capture/normalize.ts` and
 * `redact` runs on the statement in `distill/distiller.ts`, so the value was gone before the interpreter
 * built a record out of it and gone again before the record was stored.
 *
 * **The guard was not weakened.** A memory that persists a user's phone number because the number
 * arrived as a tool argument has shipped the defect the guard exists to prevent. What the guard lacked
 * was a signal it already had: the field name. A bare digit run under `product_id` is a row key, and a
 * bare digit run under `phone` is a number; the rule now asks. Measured on R88's own twelve statements
 * the write keeps **127 of 128** values and the one it still loses is the email address in `user_id`,
 * which is personal data in every position and stays redacted.
 *
 * This module is the census's half of the sentence: it decides, per value, whether a missing value is
 * the guard's doing or the arm's. It is deliberately a predicate rather than a second redaction
 * implementation — two definitions of what the guard eats would drift, and the drift would be invisible
 * in exactly the direction that flatters a dispatch. `guardReplaces` asks the guard itself.
 */
import { redact } from '@agentix-e/microglia-core';

/**
 * Whether the redaction guard would replace this value **in the slot it came from**, which is why the
 * store cannot contain it.
 *
 * Two questions, because one is not enough any more. The first asks whether the guard objects to the
 * string at all; if it does not, the answer is no and the string's position never matters. The second
 * asks the guard again with the value in a reference slot, because that is where every value a census
 * counts came from — `entitiesOf` reads tool arguments — and a bare digit run there is a row key. A
 * value that survives the second question is one the guard would have taken anywhere, which is the
 * only loss this counter is allowed to attribute to the guard.
 *
 * The probe is a call to `redact`, not a re-derived rule: a second definition of what counts as
 * personal data would drift from the first, and the drift would be invisible in the direction that
 * flatters a dispatch.
 */
export function guardReplaces(value: string): boolean {
  if (redact(value).text === value) return false;
  return redact(`id="${value}"`).text !== `id="${value}"`;
}
