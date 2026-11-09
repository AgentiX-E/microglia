/**
 * Assert a lookup that the surrounding code has already made impossible to miss.
 *
 * The pattern this replaces is the defensive default: `if (!item) continue`, `?? []`, `?.x ?? 0` on a
 * lookup whose key was established a few lines above. None of those is wrong at the point it is written.
 * They are wrong as a category, because a fallback that no input can reach is a branch no test can pin,
 * and a branch the reader is told is safety is a branch the reader stops reading. This repository paid
 * for that twice: four such fallbacks were the only uncovered lines in their files, and one file carried
 * 94.44% branch coverage for a year because of a single `??` (`AUDIT 34.88`).
 *
 * Replacing them with this function keeps the loud failure and removes the silent one. An invariant
 * that breaks now stops the caller where it broke, which is where the stack trace is useful; the
 * fallback it replaces would have returned a smaller answer that reads as a normal, slightly worse one.
 *
 * **When not to call it.** Never on input from a host, a file, a network response, or a stranger's
 * JSON — those are allowed to be wrong, and their wrongness belongs in a validation error with a
 * message about the data. Only call it where the answer is guaranteed by code within the same module:
 * a map written and read under one lock, a guard three lines up, a key the caller constructed.
 *
 * **Why a helper and not an `!`.** The compiler's non-null assertion asserts to the compiler and
 * disappears at runtime, so the invariant has no expression and the failure surfaces later as a
 * `TypeError` on `undefined`, some frames away from the cause. This keeps the check, and pays for it
 * once: the two branches of this function are covered by one unit test, so every call site is total.
 */
export function present<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`invariant violated: ${what}`);
  }
  return value;
}
