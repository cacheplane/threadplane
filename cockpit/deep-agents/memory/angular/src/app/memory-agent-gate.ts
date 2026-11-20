import { computed } from '@angular/core';
import {
  withAgentOverrides,
  type Agent,
  type AgentOverrides,
} from '@threadplane/angular';
import { MemoryScope } from './memory-scope';

/** The two members the gate replaces. */
type Gated = Pick<Agent, 'inputBlocked' | 'submit'>;

/** One gate drives both the ordinary Chat composer and older automatic suggestions.
 * A denied submission resolves locally, as `'aborted'`, so void composer handlers
 * cannot reject.
 *
 * The result is derived with `withAgentOverrides`: it serves the two gated
 * members and forwards every other read to the agent at the time of the read.
 * Chat keys its per-agent state on the agent object, so the component hands
 * this one derived agent to everything that takes an agent. */
export function guardMemoryAgent<T extends Gated>(
  agent: T,
  scope: MemoryScope
): T {
  const gate: Gated = {
    inputBlocked: computed(() => {
      const snapshot = scope.snapshot();
      return snapshot.status !== 'ready'
        ? { reason: 'memory-scope', message: snapshot.warning }
        : agent.inputBlocked();
    }),
    submit: async (input, options) => {
      if (!scope.admit()) return 'aborted';
      return agent.submit(input, options);
    },
  };
  return withAgentOverrides(agent, gate as AgentOverrides<T>);
}
