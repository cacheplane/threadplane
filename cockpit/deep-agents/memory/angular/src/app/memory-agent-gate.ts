import { computed } from '@angular/core';
import type { LangGraphAgent } from '@threadplane/langgraph';
import { MemoryScope } from './memory-scope';
/** One gate drives both the ordinary Chat composer and older automatic suggestions.
 * A denied submission resolves locally so void composer handlers cannot reject. */
export function guardMemoryAgent<T>(
  agent: LangGraphAgent<T>,
  scope: MemoryScope
): LangGraphAgent<T> {
  return {
    ...agent,
    isInputBlocked: computed(
      () => scope.snapshot().status !== 'ready' || !!agent.isInputBlocked?.()
    ),
    submit: async (input, options) => {
      if (!scope.admit()) return;
      await agent.submit(input, options);
    },
  };
}
