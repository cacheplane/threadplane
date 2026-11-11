import { agentPlanFromState, type AgentPlanStep } from '@threadplane/core';
import type { SessionSnapshot } from './session-observation.js';

type Plan = readonly AgentPlanStep[];

/** Reuses each unchanged step, and the whole list when no step changed. */
function sharePlan(next: Plan | undefined, previous: Plan | undefined) {
  if (!next || !previous) return next && Object.freeze(next.map(freezeStep));
  let changed = next.length !== previous.length;
  const steps = next.map((step, index) => {
    const before = previous[index];
    if (before && before.label === step.label && before.status === step.status)
      return before;
    changed = true;
    return freezeStep(step);
  });
  return changed ? Object.freeze(steps) : previous;
}
const freezeStep = (step: AgentPlanStep) => Object.freeze({ ...step });

/**
 * Fills `plan` from the `todos` key of the published state, so every path that
 * changes state (server snapshots and deltas, submitted patches, restore) also
 * keeps the plan current. Unchanged state keeps the previous plan reference.
 */
function withPlan<T extends SessionSnapshot>(
  next: T,
  previous: SessionSnapshot | undefined
): T {
  const plan =
    previous && Object.is(next.state, previous.state)
      ? previous.plan
      : sharePlan(agentPlanFromState(next.state), previous?.plan);
  if (next.plan === plan) return next;
  const { plan: _stale, ...rest } = next;
  return Object.freeze(plan ? { ...rest, plan } : rest) as T;
}

export function createPublication(initial: SessionSnapshot) {
  let current = withPlan(initial, undefined);
  const listeners = new Set<{ notify: () => void }>();
  const commands: (() => void)[] = [];
  let notifying = false;
  let draining = false;
  const drain = () => {
    if (notifying || draining) return;
    draining = true;
    try {
      while (commands.length) commands.shift()?.();
    } finally {
      draining = false;
    }
  };
  const command = (action: () => void) => {
    commands.push(action);
    drain();
  };
  const publish = (next: SessionSnapshot) => {
    if (notifying) {
      command(() => publish(next));
      return;
    }
    if (next === current) return;
    current = withPlan(next, current);
    notifying = true;
    try {
      for (const registration of [...listeners]) {
        if (!listeners.has(registration)) continue;
        try {
          registration.notify();
        } catch {
          /* A view cannot fail a run. */
        }
      }
    } finally {
      notifying = false;
      drain();
    }
  };
  return {
    getSnapshot: () => current,
    subscribe: (notify: () => void): (() => void) => {
      const registration = { notify };
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
      };
    },
    publish,
    command,
    clear: (): void => {
      listeners.clear();
    },
  };
}
