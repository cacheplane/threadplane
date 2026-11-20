import { computed } from '@angular/core';
import type { Agent } from '@threadplane/angular';
import { MemoryScope } from './memory-scope';

/** The two members the gate replaces. */
type Gated = Pick<Agent, 'inputBlocked' | 'submit'>;

/** One gate drives both the ordinary Chat composer and older automatic suggestions.
 * A denied submission resolves locally, as `'aborted'`, so void composer handlers
 * cannot reject.
 *
 * The result forwards every other read to the agent. The injected agent reads
 * each member from its current session when asked, so a spread copy would miss
 * a field the session publishes later. */
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
  return new Proxy(agent, {
    get: (target, key) =>
      Object.hasOwn(gate, key)
        ? gate[key as keyof Gated]
        : Reflect.get(target, key),
  });
}
