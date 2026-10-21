/**
 * Stable, machine-readable error codes.
 *
 * Every rejection the library can make is named here. A host that cannot branch
 * on a failure will log it and continue, so the code is part of the API, not a
 * diagnostic afterthought.
 */
export type MicrogliaErrorCode =
  | 'MG_E_CONFIG'
  | 'MG_E_SCHEMA_VERSION'
  // A domain pack registered a schema the code cannot use (a missing temporal,
  // category, or measure role). Distinct from MG_E_CONFIG so a host can tell
  // "my registry is wrong" from "my policy is wrong" in a doctor check.
  | 'MG_E_SCHEMA_INVALID'
  | 'MG_E_NOT_OPEN'
  | 'MG_E_RUN_COMMITTED'
  | 'MG_E_NO_OUTPUT'
  | 'MG_E_INVALID_SIGNAL'
  | 'MG_E_UNKNOWN_TASK'
  | 'MG_E_UNKNOWN_SCOPE'
  | 'MG_E_STORE_IO'
  | 'MG_E_STORE_CORRUPT'
  | 'MG_E_KNOWLEDGE_UNSAFE'
  | 'MG_E_BUDGET_EXCEEDED'
  | 'MG_E_NAMESPACE_MISMATCH'
  | 'MG_E_PACK_STALE'
  // A task instance refuses a reused or skipped attempt number; the host has a
  // bookkeeping bug, and silently overwriting the slot would lose a generation.
  | 'MG_E_TASK_CONFLICT'
  // A write after the task's terminal decision. The task is closed, not broken.
  | 'MG_E_TASK_CLOSED'
  // A host asked for a provider that neither an instance nor a registered factory
  // supplies. Distinct from MG_E_CONFIG: the configuration is well formed, the
  // name simply resolves to nothing.
  | 'MG_E_PROVIDER_MISSING';

export class MicrogliaError extends Error {
  public readonly code: MicrogliaErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: MicrogliaErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'MicrogliaError';
    this.code = code;
    this.details = details;
  }
}

export function isMicrogliaError(value: unknown): value is MicrogliaError {
  return value instanceof MicrogliaError;
}
