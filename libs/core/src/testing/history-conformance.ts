import type { AgentSession } from '../contracts/agent-session.js';
import type { AgentCheckpoint } from '../contracts/checkpoint.js';
import {
  agentSessionConformanceScenarios,
  check,
  registerScenarios,
  same,
  type ConformanceRunner,
  type ConformanceScenarios,
} from './conformance.js';

/** The history a conforming session is asked to publish, oldest first. */
export function historyConformanceCheckpoints(): readonly AgentCheckpoint[] {
  return [
    { id: 'c1', label: 'Step 1', values: { foo: 1 } },
    { id: 'c2', label: 'Step 2', values: { foo: 2 } },
  ];
}

/**
 * Returns a session whose backend holds `seed.checkpoints`, loaded so the
 * snapshot lists them, or a session with an empty loaded history when there
 * is no seed.
 */
export type HistoryConformanceFactory = (seed?: {
  readonly checkpoints: readonly AgentCheckpoint[];
}) => AgentSession | Promise<AgentSession>;

/** The history checks, as named scenarios. */
export function agentSessionHistoryConformanceScenarios(
  factory: HistoryConformanceFactory
): ConformanceScenarios {
  const scenarios = new Map<string, () => Promise<void>>();
  scenarios.set('publishes its loaded history as a list', async () => {
    const session = await factory();
    try {
      check(
        Array.isArray(session.getSnapshot().checkpoints),
        'checkpoints must be an array once a history is loaded.'
      );
    } finally {
      await session.dispose();
    }
  });
  scenarios.set(
    'publishes the seeded checkpoints in order with their values',
    async () => {
      const seed = historyConformanceCheckpoints();
      const session = await factory({ checkpoints: seed });
      try {
        const { checkpoints, messageCheckpoints } = session.getSnapshot();
        check(
          checkpoints?.length === seed.length,
          `checkpoints must list the ${seed.length} seeded entries.`
        );
        seed.forEach((expected, index) => {
          check(
            checkpoints[index].id === expected.id,
            `checkpoint ${index} must keep its id.`
          );
          check(
            same(checkpoints[index].values, expected.values),
            `checkpoint ${index} must carry its state values.`
          );
        });
        check(Object.isFrozen(checkpoints), 'checkpoints must be frozen.');
        for (const id of Object.values(messageCheckpoints ?? {}))
          check(
            checkpoints.some((checkpoint) => checkpoint.id === id),
            'messageCheckpoints must name checkpoints the snapshot lists.'
          );
      } finally {
        await session.dispose();
      }
    }
  );
  return scenarios;
}

/**
 * Registers the base session checks and the history checks with a test
 * runner, for sessions whose backend keeps a history.
 */
export function runAgentSessionHistoryConformance(
  label: string,
  factory: HistoryConformanceFactory,
  runner: ConformanceRunner
): void {
  registerScenarios(
    `${label}: session conformance`,
    agentSessionConformanceScenarios(() => factory()),
    runner
  );
  registerScenarios(
    `${label}: history conformance`,
    agentSessionHistoryConformanceScenarios(factory),
    runner
  );
}
