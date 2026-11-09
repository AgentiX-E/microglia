/**
 * The completion budget an answer needs, which depends on whether the model thinks first.
 *
 * `max_tokens` is a budget for the whole completion, and a thinking model spends it before writing
 * anything. The two are not the same quantity and only one of them was ever chosen here: the BIRD
 * lane passes 700 because a SQL statement is a few dozen tokens, and that number was correct for as
 * long as no model thought.
 *
 * It stopped being correct without anything failing. The lane asked for `deepseek-chat`, a retired
 * alias the endpoint keeps answering by routing it somewhere else; the round that corrected the
 * default to `deepseek-flash` also, silently, turned thinking on. Across 1,989 replies the lane spent
 * **1,354,007 reasoning tokens against 1,423,622 completion tokens — 681 per reply** — and left about
 * nineteen for the answer:
 *
 *   | dispatch | model asked for | V3-parse-rate | `none` accuracy |
 *   | 2026-11-09 scheduled | `deepseek-chat` (routed) | 100.00% | 53.14% |
 *   | 2026-11-09 R63 | `deepseek-flash` | 51.43% | 30.29% |
 *
 * Same split, same 350 questions, same lane, same call count. A budget that truncates a statement
 * mid-token does not produce a cheaper measurement; it produces a different question, and the
 * benchmark's own validity gate is what caught it.
 *
 * So the headroom is a measured quantity rather than a worry: 681 observed, 1,200 to cover the tail.
 * A caller that wants 700 tokens of answer from a thinking model now asks for 1,900 and the usage
 * line reports what it cost.
 */
export type ThinkingMode = 'on' | 'off';

/** Tokens a thinking model spends before it can write, rounded up from the 681 observed here. */
export const THINKING_HEADROOM = 1_200;

/**
 * The completion budget to request, given the answer the caller actually wants.
 *
 * Additive rather than a floor: the parameter is the answer budget, and a caller that wants a longer
 * answer than 700 should get that answer *plus* the room to think, not whichever of the two is
 * larger.
 */
export function answerBudget(answerTokens: number, thinking: ThinkingMode): number {
  return answerTokens + (thinking === 'on' ? THINKING_HEADROOM : 0);
}
