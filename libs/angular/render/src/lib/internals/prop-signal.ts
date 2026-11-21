import type { StateStore, ComputedFunction, PropResolutionContext } from '@json-render/core';
import type { RepeatScope } from '../contexts/repeat-scope';

export function buildPropResolutionContext(
  store: StateStore,
  repeatScope?: RepeatScope,
  functions?: Record<string, ComputedFunction>,
): PropResolutionContext {
  const ctx: PropResolutionContext = {
    stateModel: store.getSnapshot(),
  };
  if (repeatScope) {
    ctx.repeatItem = repeatScope.item;
    ctx.repeatIndex = repeatScope.index;
    ctx.repeatBasePath = repeatScope.basePath;
  }
  if (functions) {
    ctx.functions = functions;
  }
  return ctx;
}
