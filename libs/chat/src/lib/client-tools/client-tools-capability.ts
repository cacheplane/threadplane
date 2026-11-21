import type { AgentClientTools, ClientToolResult as SessionClientToolResult } from '@threadplane/core';
import type { Agent } from '../agent';
import type { ClientToolSpec } from './to-json-schema';

/**
 * The outcome of running a client tool in the browser. `value` is whatever the
 * handler returned; it is handed to the agent's `clientTools` capability,
 * which carries plain data to the backend.
 */
export type ClientToolResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** The agent members the client-tools wiring reads. */
export type ClientToolsAgent = Pick<Agent, 'clientTools' | 'pendingClientTools'>;

/**
 * The session's result type holds plain data. A handler's return value is
 * plain data by contract (it has to reach the model), so the two differ only
 * in what the type can promise.
 */
export function toSessionResult(result: ClientToolResult): SessionClientToolResult {
  return result as SessionClientToolResult;
}

/** The catalog as the session's capability takes it; JSON Schema is plain data. */
export function toSessionCatalog(specs: readonly ClientToolSpec[]): Parameters<AgentClientTools['setCatalog']>[0] {
  return specs as Parameters<AgentClientTools['setCatalog']>[0];
}

/**
 * True while the agent still lists the call as waiting for a result. A result
 * for any other call has nowhere to go: the session that asked was replaced by
 * a thread switch, or the call was answered or dropped some other way.
 */
export function isPendingClientTool(agent: ClientToolsAgent, toolCallId: string): boolean {
  return (agent.pendingClientTools() ?? []).some((call) => call.id === toolCallId);
}
