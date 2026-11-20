import type { Agent } from '../agent';

/** Per agent: the abort of every executor that is running its client tools. */
const executors = new WeakMap<object, Set<() => void>>();

/**
 * Registers what cancels one executor's running client tools for an agent.
 * Returns the release. The agent itself is never changed: {@link stopAgent}
 * looks the aborts up here.
 * @internal
 */
export function registerClientToolAbort(agent: object, abort: () => void): () => void {
  let aborts = executors.get(agent);
  if (!aborts) executors.set(agent, (aborts = new Set()));
  const registered = aborts;
  registered.add(abort);
  return () => {
    registered.delete(abort);
    if (registered.size === 0 && executors.get(agent) === registered) executors.delete(agent);
  };
}

/**
 * Stops the agent the way the chat's own Stop control does: cancels the client
 * tools the browser is running for it, then calls `agent.stop()`.
 *
 * A client tool runs in the browser after the run that asked for it has ended,
 * so `agent.stop()` alone cannot reach its handler. Call this from an
 * application-owned stop control; a cancelled call is recorded as cancelled
 * and does not continue the run.
 */
export function stopAgent(agent: Pick<Agent, 'stop'>): Promise<void> {
  for (const abort of [...(executors.get(agent) ?? [])]) abort();
  return agent.stop();
}
