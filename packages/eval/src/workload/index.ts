/**
 * The reference workload: chart specification, validation, edit distance.
 *
 * This is the study's domain, not a published package. The same code used to ship
 * as `@agentix-e/microglia-nl2charts`; it lives here because a benchmark has to own
 * the workload it scores, and because a domain pack belongs to the host that has
 * the domain.
 */
export * from './chart.js';
export * from './interpret.js';
