import type { CallerProfile } from "./actors/caller-profile";
import type { EmployeeLeave } from "./actors/employee-leave";
import type { HrDesk } from "./actors/hr-desk";
import type { CloudStorageBucket } from "@telnyx/edge-runtime";

/** Names of secrets bound into the Edge Function via `telnyx.toml`. */
export type SecretBindingName =
  | "MCP_BEARER"
  | "OPS_TOKEN"
  | "HASH_KEY"
  | "TELNYX_PUBLIC_KEY"
  | "LANGFUSE_PUBLIC_KEY"
  | "LANGFUSE_SECRET_KEY"
  | "LANGFUSE_HOST"
  | "TELNYX_API_KEY";

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
  EMPLOYEE_LEAVE: ActorNamespace<EmployeeLeaveStub>;
  HR_DESK: ActorNamespace<HrDeskStub>;
  CALLER_PROFILE: ActorNamespace<CallerProfileStub>;
  SECRETS: SecretsBinding;
  HR_POLICY_BUCKET: CloudStorageBucket;
}
