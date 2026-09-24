import type { PlainValue } from '@threadplane/core';
import { ownValue, sameToolInvocation } from './ownership';

/** Same-session execution admission, independent of transcript/result lifetime. */
export interface ToolInvocation {
  readonly id: string;
  readonly name: string;
  readonly args: PlainValue;
  readonly conflicted?: true;
}

export function observeInvocation(
  previous: readonly ToolInvocation[],
  call: ToolInvocation,
  admit = false
): readonly ToolInvocation[] {
  const index = previous.findIndex((entry) => entry.id === call.id);
  const prior = previous[index];
  if (!prior) {
    if (!admit) return previous;
    return Object.freeze([
      ...previous,
      Object.freeze({
        id: call.id,
        name: call.name,
        args: ownValue(call.args),
      }),
    ]);
  }
  if (prior.conflicted) return previous;
  // Compare owned snapshots, never recurse through caller/SDK data or getters.
  const incoming = { name: call.name, args: ownValue(call.args) };
  if (sameToolInvocation(prior, incoming)) return previous;
  const next = [...previous];
  next[index] = Object.freeze({ ...prior, conflicted: true });
  return Object.freeze(next);
}

export function hasInvocationConflict(invocations: readonly ToolInvocation[]) {
  return invocations.some((entry) => entry.conflicted);
}
