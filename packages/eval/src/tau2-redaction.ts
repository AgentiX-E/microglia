/**
 * R88's missing 46 values: the guard, not the writer.
 *
 * R88 read `faithfulness 82 of 128` with two records clipped, which left three explanations on the
 * table and no instrument able to choose between them: the ceiling cut the text, the writer abstracted
 * it, or the measure was wrong. A model-free reconstruction of the same twelve corrections from the
 * pinned corpus keeps **all 128** entities at the same 2,000-character ceiling and clips the same two
 * records, so the ceiling and the writer are both cleared. What removes the values is
 * `kernel/guard.ts`, whose second rule is a North-American phone pattern — ten digits — and a τ² retail
 * answer is made of ten-digit product ids:
 *
 *     find_user_id_by_name_zip(first_name="Fatima", …); get_product_details(product_id="[phone]")
 *
 * `7363354090` is task 15's `product_id`. It is not a phone number, it never was, and the guard cannot
 * tell the difference; `redactJson` runs on the edit's `after` payload in `capture/normalize.ts` and
 * `redact` runs on the statement in `distill/distiller.ts`, so the value is gone before the interpreter
 * builds a record out of it and gone again before the record is stored.
 *
 * The guard is right and this module does not weaken it. A memory that persists a user's phone number
 * because the number arrived as a tool argument has shipped the defect the guard exists to prevent.
 * What was wrong was the *reading*: every artefact in this lane reported the consequence as
 * `recall.empty`, as low coverage, or as a writer that abstracted, and none of them said "a safety rule
 * edible by product ids". This module is the one definition of that sentence, so the census can count
 * the loss apart from the loss the writer caused.
 *
 * It is deliberately a predicate rather than a second redaction implementation: two definitions of what
 * the guard eats would drift, and the drift would be invisible in exactly the direction that flatters a
 * dispatch. `guardReplaces` asks the guard itself.
 */
import { redact } from '@agentix-e/microglia-core';

/** Whether the redaction guard would replace this value, which is why the store cannot contain it. */
export function guardReplaces(text: string): boolean {
  return redact(text).text !== text;
}
