import type {
  AgentInterrupt,
  PlainValue,
  StreamingToolCall,
  ToolCall,
} from '@threadplane/core';
import type { Agent } from './angular-agent';

/** True while the agent is running a request. */
export function isAgentRunning(agent: Pick<Agent, 'status'>): boolean {
  return agent.status() === 'running';
}

/**
 * True while the agent refuses ordinary submissions (`agent.inputBlocked()` is
 * present). Commands that clear the block, such as `resume`, stay available.
 */
export function isAgentInputBlocked(agent: Pick<Agent, 'inputBlocked'>): boolean {
  return !!agent.inputBlocked();
}

/**
 * The interrupt a view shows for a paused run: the first one `agent.interrupts()`
 * lists, or undefined when nothing is pending or the session cannot pause.
 */
export function pendingInterrupt(agent: Pick<Agent, 'interrupts'>): AgentInterrupt | undefined {
  return agent.interrupts()?.[0];
}

/** A finished call's result; undefined for a call that has none. */
export function toolCallResult(call: ToolCall): PlainValue | undefined {
  return call.status === 'complete' ? call.result : undefined;
}

/** A failed call's error text; undefined for a call that did not fail. */
export function toolCallError(call: ToolCall): string | undefined {
  return call.status === 'error' ? call.error : undefined;
}

const projected = new WeakMap<StreamingToolCall, ToolCall>();

/** A call the model is still writing, shown as a running call with the arguments read so far. */
function streamingCall(call: StreamingToolCall): ToolCall {
  let view = projected.get(call);
  if (!view) {
    view = { id: call.id, name: call.name, args: call.args ?? {}, status: 'running' };
    projected.set(call, view);
  }
  return view;
}

const merged = new WeakMap<readonly ToolCall[], WeakMap<readonly StreamingToolCall[], readonly ToolCall[]>>();

/**
 * Every tool call a view can show: `agent.toolCalls()`, followed by the calls
 * in `agent.streamingToolCalls()` whose arguments are still being written. A
 * streaming call appears as a `running` call holding the arguments read so
 * far, and is replaced by the finished call with the same id once that
 * arrives. The list keeps its reference while neither source changes.
 *
 * Call it in a reactive context so both signal reads register.
 */
export function agentToolCalls(agent: Pick<Agent, 'toolCalls' | 'streamingToolCalls'>): readonly ToolCall[] {
  const calls = agent.toolCalls();
  const streaming = agent.streamingToolCalls();
  if (!streaming?.length) return calls;
  let byStreaming = merged.get(calls);
  if (!byStreaming) merged.set(calls, (byStreaming = new WeakMap()));
  let all = byStreaming.get(streaming);
  if (!all) {
    const known = new Set(calls.map((call) => call.id));
    all = [...calls, ...streaming.filter((call) => !known.has(call.id)).map(streamingCall)];
    byStreaming.set(streaming, all);
  }
  return all;
}
