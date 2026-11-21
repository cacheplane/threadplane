import type { AgentSession } from '../contracts/agent-session.js';
import type {
  AgentInterrupt,
  AgentInterruptResponse,
} from '../contracts/interrupt.js';
import type { PlainValue } from '../contracts/tool.js';
import {
  check,
  registerScenarios,
  same,
  type ConformanceRunner,
  type ConformanceScenarios,
} from './conformance.js';

/** The two approval interrupts a session must keep whole through every interrupt scenario. */
export function interruptConformanceBatch(): readonly AgentInterrupt[] {
  return [
    { id: 'approval-a', value: { question: 'Approve A?' } },
    { id: 'approval-b', value: { question: 'Approve B?' } },
  ];
}

/** What one request to the backend meant; the harness keeps the wire assertions. */
export interface InterruptConformanceRequest {
  /** The answers the request carried, in the order they were given. */
  readonly responses: readonly AgentInterruptResponse[];
  /** The state update the request carried; empty when it carried none. */
  readonly state: Readonly<Record<string, PlainValue>>;
  /** The text of each user message the request carried. */
  readonly messages: readonly string[];
}

/**
 * What a runtime supplies to have its interrupts checked. The pause and the
 * failure must come through the real session, from the backend or a fake of
 * it, never from a snapshot the harness writes itself.
 */
export interface InterruptConformanceHarness {
  readonly session: AgentSession;
  /** Answers every interrupt in {@link interruptConformanceBatch}, in the backend's terms. */
  readonly responses: readonly AgentInterruptResponse[];
  /** Runs the agent until it pauses on the fixture batch. */
  pause(): Promise<void>;
  /** Makes the next request fail before the backend accepts it, with an error that can be retried. */
  failNextDispatch(): void;
  /** Every request sent so far, oldest first. */
  readonly requests: readonly InterruptConformanceRequest[];
  /** How many times the backend was told to cancel the paused work. */
  backendCancellationCount(): number;
  /** Starts a run and holds what it delivers until `deliverLateEvents` is called. */
  startLateDelivery(): Promise<void>;
  /** Releases the held delivery, also after the session is disposed. */
  deliverLateEvents(): Promise<void>;
  /** Disposes the session and whatever the harness created. Safe to call twice. */
  cleanup(): void | Promise<void>;
  /** Optional: restores the pause from backend history; never writes a local pause. */
  restore?(): Promise<void>;
}

/** Which optional scenarios to include. */
export interface InterruptConformanceOptions {
  /** Checks that a pause is restored from backend history through `harness.restore`. */
  readonly restoration?: boolean;
}

const combined = {
  state: { reviewer: 'Ada' },
  message: 'Approved, continue',
} as const;

function pending(session: AgentSession) {
  return (session.getSnapshot().interrupts ?? []).map(({ id, value }) => ({
    id,
    value,
  }));
}

function observed(session: AgentSession) {
  const { state, messages, interrupts } = session.getSnapshot();
  return JSON.stringify({ state, messages, interrupts });
}

/** The interrupt checks, as named scenarios. Each takes a fresh harness and cleans it up. */
export function interruptConformanceScenarios(
  factory: () => InterruptConformanceHarness,
  options: InterruptConformanceOptions = {}
): ConformanceScenarios {
  const scenarios = new Map<string, () => Promise<void>>();
  const register = (
    name: string,
    scenario: (harness: InterruptConformanceHarness) => Promise<void>
  ) =>
    scenarios.set(name, async () => {
      const harness = factory();
      try {
        await scenario(harness);
      } finally {
        await harness.cleanup();
      }
    });
  const resume = (harness: InterruptConformanceHarness) => {
    const command = harness.session.resume;
    check(command, 'a session that pauses must have resume.');
    return command.bind(harness.session);
  };

  register(
    'lists the whole paused batch and is not running',
    async (harness) => {
      await harness.pause();
      const snapshot = harness.session.getSnapshot();
      check(
        typeof harness.session.resume === 'function',
        'a session that pauses must have resume.'
      );
      check(snapshot.status === 'idle', 'a paused session must be idle.');
      check(
        same(pending(harness.session), interruptConformanceBatch()),
        'interrupts must list every interrupt of the pause, in order.'
      );
      check(
        (snapshot.interrupts ?? []).every(
          (interrupt) => interrupt.resumable !== false
        ),
        'the fixture interrupts must be resumable.'
      );
    }
  );

  register(
    'sends the answers, a state update and a message in one request',
    async (harness) => {
      await harness.pause();
      await resume(harness)(harness.responses, combined);
      check(
        same(harness.requests.at(-1), {
          responses: harness.responses,
          state: combined.state,
          messages: [combined.message],
        }),
        'the request must carry the answers, the state and the message together.'
      );
    }
  );

  for (const together of [false, true])
    register(
      `retries a failed ${
        together ? 'combined' : 'resume-only'
      } request unchanged`,
      async (harness) => {
        await harness.pause();
        const before = harness.requests.length;
        harness.failNextDispatch();
        await resume(harness)(
          harness.responses,
          together ? combined : undefined
        ).then(undefined, () => undefined);
        check(
          harness.session.getSnapshot().error !== undefined,
          'a failed request must publish an error.'
        );
        check(
          harness.requests.length === before + 1,
          'a failed resume must be sent exactly once.'
        );
        const failed = harness.requests.at(-1);
        const retry = harness.session.retry;
        check(retry, 'a session that resumes must have retry.');
        await retry.call(harness.session);
        check(
          harness.requests.length === before + 2,
          'retry must send exactly one more request.'
        );
        check(
          same(harness.requests.at(-1), failed),
          'retry must send the failed request again, unchanged.'
        );
        check(
          same(harness.requests.at(-1), {
            responses: harness.responses,
            state: together ? combined.state : {},
            messages: together ? [combined.message] : [],
          }),
          'the retried request must carry what the resume carried.'
        );
        const snapshot = harness.session.getSnapshot();
        check(
          snapshot.error === undefined,
          'a retry that works clears the error.'
        );
        check(snapshot.status !== 'running', 'the retry must have settled.');
      }
    );

  register(
    'stops local work without cancelling the backend pause',
    async (harness) => {
      await harness.pause();
      const before = harness.backendCancellationCount();
      await harness.session.stop();
      check(
        harness.backendCancellationCount() === before,
        'stop must not cancel paused backend work.'
      );
      check(
        same(pending(harness.session), interruptConformanceBatch()),
        'stop must leave the pause in place.'
      );
    }
  );

  register(
    'applies a held delivery while the session is live',
    async (harness) => {
      await harness.startLateDelivery();
      const before = observed(harness.session);
      await harness.deliverLateEvents();
      check(
        observed(harness.session) !== before,
        'a live session must apply what the run delivers.'
      );
    }
  );

  register('ignores a held delivery after disposal', async (harness) => {
    await harness.startLateDelivery();
    await harness.cleanup();
    const disposed = observed(harness.session);
    await harness.deliverLateEvents();
    check(
      observed(harness.session) === disposed,
      'a disposed session must ignore late delivery.'
    );
  });

  if (options.restoration)
    register(
      'restores the whole pause from backend history',
      async (harness) => {
        check(
          harness.restore,
          'the restoration scenario needs harness.restore.'
        );
        await harness.restore();
        check(
          same(pending(harness.session), interruptConformanceBatch()),
          'a restored pause must list every interrupt, in order.'
        );
        check(
          typeof harness.session.resume === 'function',
          'a restored pause must be resumable.'
        );
      }
    );

  return scenarios;
}

/**
 * Registers the interrupt checks with a test runner. Separate from the base
 * checks, so a session that cannot pause is still a conforming session.
 */
export function runInterruptConformance(
  label: string,
  factory: () => InterruptConformanceHarness,
  runner: ConformanceRunner,
  options: InterruptConformanceOptions = {}
): void {
  registerScenarios(
    `${label}: interrupt conformance`,
    interruptConformanceScenarios(factory, options),
    runner
  );
}
