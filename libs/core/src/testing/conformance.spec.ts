import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../index';
import {
  agentSessionConformanceScenarios,
  agentSessionHistoryConformanceScenarios,
  assertReasoningFixtureMessages,
  createFakeAgentSession,
  interruptConformanceBatch,
  interruptConformanceScenarios,
  reasoningFixture,
  runAgentSessionConformance,
  runAgentSessionHistoryConformance,
  runInterruptConformance,
  type InterruptConformanceHarness,
  type InterruptConformanceRequest,
} from './index';

const runner = { describe, it };
const everything = [
  'run',
  'regenerate',
  'retry',
  'checkStatus',
  'onCustomEvent',
  'clientTools',
] as const;

runAgentSessionConformance(
  'fake session',
  () => createFakeAgentSession().session,
  runner
);
runAgentSessionConformance(
  'fake session with every optional member',
  () =>
    createFakeAgentSession({
      commands: everything,
      messages: [{ role: 'assistant', content: 'Hi' }],
      state: { a: 1 },
      usage: { entries: [] },
      interrupts: [],
      subagents: [{ id: 's' }],
      inputBlocked: { reason: 'interrupt' },
      pendingClientTools: [],
      streamingToolCalls: [],
    }).session,
  runner
);
runAgentSessionHistoryConformance(
  'fake session',
  (seed) =>
    createFakeAgentSession({
      checkpoints: seed?.checkpoints ?? [],
      ...(seed && { messageCheckpoints: { m1: 'c2' } }),
    }).session,
  runner
);

function interruptHarness(): InterruptConformanceHarness {
  const requests: InterruptConformanceRequest[] = [];
  let fail = false;
  let held: (() => void) | undefined;
  const fake = createFakeAgentSession({
    commands: ['retry'],
    onResume: (responses, session, options) => {
      requests.push({
        responses,
        state: options?.state ?? {},
        messages: options?.message === undefined ? [] : [options.message],
      });
      if (!fail) return;
      fail = false;
      session.setError({
        kind: 'connection',
        message: 'Offline',
        retryable: true,
        recovery: 'retry',
      });
      throw new Error('The request did not leave.');
    },
  });
  return {
    session: fake.session,
    responses: interruptConformanceBatch().map(({ id }) => ({
      interruptId: id,
      status: 'resolved' as const,
      value: { approved: true },
    })),
    requests,
    pause: async () => fake.setInterrupts(interruptConformanceBatch()),
    failNextDispatch: () => {
      fail = true;
    },
    backendCancellationCount: () => 0,
    startLateDelivery: async () => {
      // The fake has no backend: its controls are the delivery, so the
      // harness is what stops delivering once the session is disposed.
      held = () => {
        if (!fake.disposed) fake.push({ role: 'assistant', content: 'Late' });
      };
    },
    deliverLateEvents: async () => held?.(),
    cleanup: () => fake.session.dispose(),
    restore: async () => fake.setInterrupts(interruptConformanceBatch()),
  };
}

runInterruptConformance('fake session', interruptHarness, runner, {
  restoration: true,
});

describe('session conformance suites', () => {
  const broken = (change: (session: AgentSession) => object) => () => {
    const { session } = createFakeAgentSession();
    return { ...session, ...change(session) } as AgentSession;
  };
  const failures = async (
    scenarios: ReadonlyMap<string, () => Promise<void>>
  ) => {
    const failed: string[] = [];
    for (const [name, scenario] of scenarios)
      await scenario().catch((error: Error) =>
        failed.push(`${name}: ${error.message}`)
      );
    return failed;
  };

  it('reports no failure for a conforming session', async () => {
    await expect(
      failures(
        agentSessionConformanceScenarios(() => createFakeAgentSession().session)
      )
    ).resolves.toEqual([]);
  });

  it.each([
    [
      'an unstable snapshot',
      (session: AgentSession) => ({
        getSnapshot: () => ({ ...session.getSnapshot() }),
      }),
      'same object until something changes',
    ],
    [
      'an unfrozen snapshot',
      (session: AgentSession) => {
        const snapshot = { ...session.getSnapshot() };
        return { getSnapshot: () => snapshot };
      },
      'the snapshot must be frozen',
    ],
    [
      'an unknown status',
      (session: AgentSession) => {
        const snapshot = Object.freeze({
          ...session.getSnapshot(),
          status: 'loading',
        });
        return { getSnapshot: () => snapshot };
      },
      'status must be one of',
    ],
    [
      'block content in place of text',
      (session: AgentSession) => {
        const snapshot = Object.freeze({
          ...session.getSnapshot(),
          messages: Object.freeze([
            { id: 'm', role: 'user', content: [], delivery: {} },
          ]),
        });
        return { getSnapshot: () => snapshot };
      },
      'structured content goes in blocks',
    ],
    [
      'a submit that returns no promise',
      () => ({ submit: () => 'success' }),
      'submit must return a promise',
    ],
    [
      'a command that is not a function',
      () => ({ retry: true }),
      'retry must be a function when present',
    ],
    [
      'a subscription that notifies at once',
      (session: AgentSession) => ({
        subscribe: (notify: () => void) => {
          notify();
          return session.subscribe(notify);
        },
      }),
      'must not notify for the initial state',
    ],
  ])('rejects %s', async (_label, change, problem) => {
    const failed = await failures(
      agentSessionConformanceScenarios(broken(change))
    );
    expect(failed.join('\n')).toContain(problem);
  });

  it('rejects a history that loses its state values', async () => {
    const failed = await failures(
      agentSessionHistoryConformanceScenarios(
        (seed) =>
          createFakeAgentSession({
            checkpoints: (seed?.checkpoints ?? []).map(({ id }) => ({
              id,
              values: {},
            })),
          }).session
      )
    );
    expect(failed.join('\n')).toContain('must carry its state values');
  });

  it('rejects an interrupt harness whose session drops part of the batch', async () => {
    const failed = await failures(
      interruptConformanceScenarios(() => {
        const harness = interruptHarness();
        const fake = createFakeAgentSession();
        return {
          ...harness,
          session: fake.session,
          pause: async () =>
            fake.setInterrupts(interruptConformanceBatch().slice(0, 1)),
        };
      })
    );
    expect(failed.join('\n')).toContain(
      'interrupts must list every interrupt of the pause'
    );
  });

  it('rejects a harness whose retry sends nothing', async () => {
    const failed = await failures(
      interruptConformanceScenarios(() => {
        const harness = interruptHarness();
        return {
          ...harness,
          session: {
            ...harness.session,
            retry: async () => 'success',
          } as AgentSession,
        };
      })
    );
    expect(failed.join('\n')).toContain('retry must send exactly one more');
  });

  it('includes the restoration scenario only when asked', () => {
    const name = 'restores the whole pause from backend history';
    expect(interruptConformanceScenarios(interruptHarness).has(name)).toBe(
      false
    );
    expect(
      interruptConformanceScenarios(interruptHarness, {
        restoration: true,
      }).has(name)
    ).toBe(true);
  });
});

describe('reasoning fixture', () => {
  it('is satisfied by a fake reply driven from its events', () => {
    const fake = createFakeAgentSession();
    const fixture = reasoningFixture();
    const reply = fake.stream({ id: fixture.messageId });
    for (const event of fixture.events) {
      if (event.kind === 'reasoning-chunk')
        reply.appendReasoning(event.delta ?? '');
      if (event.kind === 'text-chunk') reply.append(event.delta ?? '');
      if (event.kind === 'text-end') reply.complete();
    }
    expect(() =>
      assertReasoningFixtureMessages(fake.session.getSnapshot().messages)
    ).not.toThrow();
  });

  it.each([
    ['no message', [], 'Expected exactly 1 message'],
    [
      'the wrong role',
      [{ role: 'user' as const, content: 'Hello!' }],
      'Expected assistant role',
    ],
    [
      'the wrong content',
      [{ role: 'assistant' as const, content: 'Hi' }],
      'Expected content',
    ],
    [
      'missing reasoning',
      [{ role: 'assistant' as const, content: 'Hello!' }],
      'Expected reasoning',
    ],
    [
      'an unmeasured duration',
      [
        {
          role: 'assistant' as const,
          content: 'Hello!',
          reasoning: reasoningFixture().reasoning,
        },
      ],
      'Expected reasoningDurationMs to be a number',
    ],
    [
      'a negative duration',
      [
        {
          role: 'assistant' as const,
          content: 'Hello!',
          reasoning: reasoningFixture().reasoning,
          reasoningDurationMs: -1,
        },
      ],
      'Expected reasoningDurationMs >= 0',
    ],
  ])('rejects %s', (_label, messages, problem) => {
    const fake = createFakeAgentSession({ messages });
    expect(() =>
      assertReasoningFixtureMessages(fake.session.getSnapshot().messages)
    ).toThrow(problem);
  });
});
