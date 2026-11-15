import type { CallerProfile } from "./actors/caller-profile";
import type { EmployeeLeave } from "./actors/employee-leave";
import type { HrDesk } from "./actors/hr-desk";

/** Names of secrets bound into the Edge Function via `telnyx.toml`. */
export type SecretBindingName =
  | "MCP_BEARER"
  | "OPS_TOKEN"
  | "HASH_KEY"
  | "TELNYX_PUBLIC_KEY"
  | "LANGFUSE_PUBLIC_KEY"
  | "LANGFUSE_SECRET_KEY"
  | "LANGFUSE_HOST";

/** Interface for reading secrets from the runtime secrets binding. */
export interface SecretsBinding {
  /** Returns the secret's value, or `undefined` when it is not bound. Callers treat `undefined` as a failed check. */
  get(binding: SecretBindingName): Promise<string | undefined>;
}

/** Interface for KV namespace operations. */
export interface KvNamespaceBinding {
  /** Reads a key as text. Returns `null` when the key does not exist. */
  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  /** Reads a key and parses it as JSON. Returns `null` when the key does not exist. */
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  /** Writes a value, with an optional time-to-live in seconds. KV keys use `/` as a separator. */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  /** Removes a key. */
  delete(key: string): Promise<void>;
}

/** Minimal interface for SQL database operations as used by this project. */
export interface SqlDatabaseBinding {
  prepare(query: string): SqlPreparedStatement;
  batch<T>(statements: SqlPreparedStatement[]): Promise<SqlQueryResult<T>[]>;
}

/** A prepared SQL statement with bound parameters. */
export interface SqlPreparedStatement {
  bind(...values: unknown[]): SqlPreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<SqlQueryResult<T>>;
  run<T>(): Promise<SqlQueryResult<T>>;
}

/** Result of a SQL query. */
export interface SqlQueryResult<T> {
  results: T[];
}

/** Generic interface for actor namespace bindings. */
export interface ActorNamespace<Stub> {
  /** Returns the stub for the single actor instance with this name, creating it on first use. */
  idFromName(name: string): Stub;
}

/**
 * Stub interface for the CallerProfile actor.
 * Exposes only the methods intended to be called from the Edge Function.
 */
export type CallerProfileStub = Pick<CallerProfile, "recordCall" | "ping">;

/**
 * Stub interface for the EmployeeLeave actor.
 * Exposes only the methods intended to be called from the Edge Function.
 */
export type EmployeeLeaveStub = Pick<
  EmployeeLeave,
  | "verifyPin"
  | "verifySecretAnswer"
  | "setSecretQuestion"
  | "ensureProfile"
  | "summary"
  | "check"
  | "apply"
  | "cancel"
  | "requests"
  | "stats"
  | "reset"
  | "ping"
>;

/**
 * Stub interface for the HrDesk actor.
 * Exposes only the methods intended to be called from the Edge Function.
 */
export type HrDeskStub = Pick<
  HrDesk,
  "addCallback" | "failUnknown" | "listCallbacks" | "stats" | "reset" | "ping"
>;

/**
 * Central application environment interface.
 * Passed into every request handler; binds KV, actors, secrets, and Cloud Storage.
 */
export interface AppEnv {
  HR_KV: KvNamespaceBinding;
  TERADB?: SqlDatabaseBinding;
  EMPLOYEE_LEAVE: ActorNamespace<EmployeeLeaveStub>;
  HR_DESK: ActorNamespace<HrDeskStub>;
  CALLER_PROFILE: ActorNamespace<CallerProfileStub>;
  SECRETS: SecretsBinding;
}

/**
 * Resolves the SQL database binding at runtime.
 * The Telnyx runtime may place SQL bindings on the imported `env` rather than
 * the `fetch` argument; this helper tries both and records which one worked.
 */
export function resolveTeradb(env: AppEnv): SqlDatabaseBinding | undefined {
  if (env.TERADB) {
    return env.TERADB;
  }
  // The wiki warns that SQL bindings may only be present on imported env.
  // Runtime observation wins; this is verified at deploy time in /ops/check.
  const imported = typeof globalThis !== "undefined"
    ? (globalThis as unknown as { env?: { TERADB?: SqlDatabaseBinding } }).env
    : undefined;
  return imported?.TERADB;
}
