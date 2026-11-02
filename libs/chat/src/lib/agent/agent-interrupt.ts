/** A runtime interrupt payload, its identifier, and whether the agent can resume it. */
export interface AgentInterrupt {
  /** Stable identifier for this interrupt instance. */
  id: string;
  /** Opaque payload the app renders. Runtime-specific shape. */
  value: unknown;
  /** True when the runtime supports resuming via `submit({ resume })`. */
  resumable: boolean;
}
