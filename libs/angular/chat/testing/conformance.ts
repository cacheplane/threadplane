import { describe, it } from 'vitest';
import type { AgentSession } from '@threadplane/core';
import {
  runAgentSessionConformance,
  runAgentSessionHistoryConformance,
  runInterruptConformance as runSessionInterruptConformance,
  type HistoryConformanceFactory,
  type InterruptConformanceHarness,
  type InterruptConformanceOptions,
} from '@threadplane/core/testing';

const runner = { describe, it };

/**
 * Checks, under Vitest, that a session satisfies the contract `<chat>` renders
 * from: the required members, the snapshot's shape, stability and freezing,
 * subscription and disposal. Pass a factory for the session your
 * `provideAgent({ createSession })` creates.
 *
 * @example
 * ```ts
 * runAgentConformance('my backend', () => createSession({ apiUrl: '/agent' }));
 * ```
 */
export function runAgentConformance(
  label: string,
  factory: () => AgentSession | Promise<AgentSession>,
): void {
  runAgentSessionConformance(label, factory, runner);
}

/**
 * The base checks, then that a session seeded with saved history publishes it
 * in `checkpoints`, in order, with the state values of each point.
 */
export function runAgentWithHistoryConformance(label: string, factory: HistoryConformanceFactory): void {
  runAgentSessionHistoryConformance(label, factory, runner);
}

/**
 * The interrupt checks: the whole paused batch is listed, answers travel with
 * a state update and a message in one request, a failed resume is retried
 * unchanged, `stop` leaves the backend pause alone, and late delivery is
 * ignored after disposal. Separate from the base checks, so a session that
 * cannot pause stays conformant.
 */
export function runInterruptConformance(
  label: string,
  factory: () => InterruptConformanceHarness,
  options: InterruptConformanceOptions = {},
): void {
  runSessionInterruptConformance(label, factory, runner, options);
}
