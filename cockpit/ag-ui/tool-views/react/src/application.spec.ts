import { EventType } from '@ag-ui/client';
import { expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import type { Session } from '@threadplane/ag-ui';
import { createToolViewsApplication } from './application';
import type { NativeSnapshot } from './tool-view-policy';

const weatherData = {
  location: 'San Francisco',
  temperatureF: 68,
  conditions: 'Sunny',
  humidity: 55,
  windMph: 8,
};
function toolWork(session: ReturnType<typeof fakeSession>, count = 1) {
  const native = session.getSnapshot();
  const run = native.run!.id;
  const calls = Array.from({ length: count }, (_, index) => ({
    id: `${run}-call-${index}`,
    type: 'function' as const,
    function: {
      name: 'weather_card',
      arguments: JSON.stringify({ location: 'San Francisco' }),
    },
  }));
  return [
    ...native.transcript,
    {
      id: `${run}-owner`,
      role: 'assistant' as const,
      content: '',
      toolCalls: calls,
    },
    ...calls.map((call, index) => ({
      id: `${run}-result-${index}`,
      role: 'tool' as const,
      toolCallId: call.id,
      content: JSON.stringify(weatherData),
    })),
    {
      id: `${run}-final`,
      role: 'assistant' as const,
      content: 'Actual reading ready.',
    },
  ];
}
it('retains complete server-tool history across native followups and creates no browser execution', async () => {
  const { app, sessions, calls } = fixture();
  const first = app.submit('Weather');
  const native = sessions[0];
  native.finish({ transcript: toolWork(native, 2) });
  await first;
  expect(app.getSnapshot().canSubmit).toBe(true);
  expect(app.getSnapshot().views[1].tools).toHaveLength(2);
  expect(app.getSnapshot().views[1].tools[0].weather).toEqual(weatherData);
  const prefix = native.getSnapshot().transcript;
  const next = app.submit('Another reading');
  expect(native.getSnapshot().transcript.slice(0, -1)).toEqual(prefix);
  native.finish({ transcript: toolWork(native) });
  await next;
  expect(app.getSnapshot().canSubmit).toBe(true);
  expect(app.getSnapshot().native!.transcript).toHaveLength(9);
  expect(calls).toHaveLength(1);
  expect(native.resume).not.toHaveBeenCalled();
  await app.dispose();
});
it('observes partial tool data without authorizing completion and rejects pending terminal work', async () => {
  const { app, sessions } = fixture();
  const pending = app.submit('Weather');
  const native = sessions[0],
    full = toolWork(native);
  native.publish({ transcript: full.slice(0, 2) });
  expect(app.getSnapshot().views[1].tools[0].weather).toBeUndefined();
  expect(app.getSnapshot().busy).toBe(true);
  native.finish({
    transcript: full,
    run: {
      id: 'run-1',
      outcome: 'success',
      terminal: {
        type: EventType.RUN_FINISHED,
        threadId: app.getSnapshot().threadId!,
        runId: 'run-1',
        outcome: { type: 'success', pendingToolCallIds: ['hidden'] },
      },
    },
  });
  await pending;
  expect(app.getSnapshot().canSubmit).toBe(false);
  await app.submit('Replay');
  expect(native.submit).toHaveBeenCalledTimes(1);
  await app.dispose();
});

function fixture() {
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const calls: string[] = [];
  const app = createToolViewsApplication({
    sessionFactory: (id) => {
      calls.push(id);
      const session = fakeSession(id);
      sessions.push(session);
      return session;
    },
  });
  return { app, sessions, calls };
}
function fakeSession(threadId: string) {
  let snapshot: NativeSnapshot = {
    status: 'idle',
    transcript: [],
    state: {},
    subagents: [],
  };
  const listeners = new Set<() => void>();
  let resolve: ((outcome: CompleteOutcome) => void) | undefined;
  let runCount = 0;
  const publish = (update: Partial<NativeSnapshot>) => {
    snapshot = { ...snapshot, ...update };
    for (const notify of listeners) notify();
  };
  const submit = vi.fn((text: string) => {
    const runId = 'run-' + ++runCount;
    const pending = new Promise<CompleteOutcome>((done) => {
      resolve = done;
    });
    publish({
      status: 'running',
      transcript: [
        ...snapshot.transcript,
        { id: 'human-' + runCount, role: 'user', content: text },
      ],
      run: { id: runId },
    });
    return pending;
  });
  const stop = vi.fn(async () => {
    resolve?.('aborted');
  });
  const dispose = vi.fn(async () => {
    resolve?.('aborted');
  });
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit,
    stop,
    dispose,
    resume: vi.fn(async () => 'success' as CompleteOutcome),
    publish,
    finish(
      update: Partial<NativeSnapshot> = {},
      outcome: CompleteOutcome = 'success'
    ) {
      publish({
        status: 'idle',
        transcript: [
          ...snapshot.transcript,
          {
            id: 'answer-' + runCount,
            role: 'assistant',
            content: 'Reply ' + runCount,
          },
        ],
        run: {
          id: snapshot.run!.id,
          outcome,
          terminal: {
            type: EventType.RUN_FINISHED,
            threadId,
            runId: snapshot.run!.id,
          },
        },
        ...update,
      });
      resolve?.(outcome);
    },
  };
  return session satisfies Session;
}

it('creates nothing until Send, retains native history across two runs and New stays lazy', async () => {
  const { app, sessions, calls } = fixture();
  expect(calls).toEqual([]);
  expect(app.getSnapshot()).toMatchObject({
    threadId: null,
    busy: false,
    canSubmit: true,
    views: [],
  });
  const first = app.submit('  First question  ');
  expect(calls).toHaveLength(1);
  expect(app.getSnapshot()).toMatchObject({ busy: true, canSubmit: false });
  expect(sessions[0].submit).toHaveBeenCalledWith('  First question  ', {
    signal: expect.any(AbortSignal),
  });
  const id = app.getSnapshot().threadId;
  sessions[0].finish();
  await first;
  expect(app.getSnapshot().native).toBe(sessions[0].getSnapshot());
  expect(app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: 'success',
  });
  expect(app.getSnapshot().views).toHaveLength(2);
  const second = app.submit('Second question');
  sessions[0].finish();
  await second;
  expect(calls).toHaveLength(1);
  expect(app.getSnapshot().threadId).toBe(id);
  expect(app.getSnapshot().views).toHaveLength(4);
  await app.newConversation();
  expect(calls).toHaveLength(1);
  expect(app.getSnapshot()).toMatchObject({
    threadId: null,
    views: [],
    viewGeneration: 1,
    canSubmit: true,
  });
  const third = app.submit('Fresh question');
  expect(calls).toHaveLength(2);
  expect(calls[1]).not.toBe(calls[0]);
  sessions[1].finish();
  await third;
  expect(app.getSnapshot().views).toHaveLength(2);
  await app.dispose();
});
it('admits before notifications and rejects concurrent Send or New', async () => {
  const { app, sessions } = fixture();
  let called = false;
  app.subscribe(() => {
    if (!called && app.getSnapshot().busy) {
      called = true;
      void app.submit('Reentrant');
      void app.newConversation();
    }
  });
  const pending = app.submit('One');
  await app.submit('Two');
  await app.newConversation();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].submit).toHaveBeenCalledTimes(1);
  sessions[0].finish();
  await pending;
  await app.dispose();
});
it('rejects blank input without creating a session', async () => {
  const { app, calls } = fixture();
  await app.submit(' \n ');
  expect(calls).toEqual([]);
  await app.dispose();
});
it('protects constructor failure and never retries until New', async () => {
  const factory = vi.fn(() => {
    throw new Error('PRIVATE endpoint key');
  });
  const app = createToolViewsApplication({ sessionFactory: factory });
  await app.submit('Question');
  await app.submit('Replay');
  expect(factory).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot().canSubmit).toBe(false);
  expect(JSON.stringify(app.getSnapshot())).not.toContain('PRIVATE');
  await app.newConversation();
  await app.submit('New question');
  expect(factory).toHaveBeenCalledTimes(2);
  await app.dispose();
});
it.each(['error', 'interrupted', 'paused', 'aborted'] as const)(
  'requires New after native %s',
  async (outcome) => {
    const { app, sessions } = fixture();
    const pending = app.submit('Question');
    sessions[0].finish({}, outcome);
    await pending;
    await app.submit('Replay');
    expect(app.getSnapshot().canSubmit).toBe(false);
    expect(sessions[0].submit).toHaveBeenCalledTimes(1);
    await app.dispose();
  }
);
it.each([
  'notice',
  'tool',
  'child',
  'pending-tools',
  'wrong-terminal',
  'truncated-prefix',
  'no-terminal',
] as const)(
  'success cannot override unsupported or unconfirmed %s',
  async (kind) => {
    const { app, sessions } = fixture();
    const initial = app.submit('First');
    sessions[0].finish();
    await initial;
    const pending = app.submit('Second');
    const s = sessions[0],
      root = s.getSnapshot();
    if (kind === 'notice')
      s.publish({
        run: {
          ...root.run!,
          legacyInterrupt: {
            type: EventType.CUSTOM,
            name: 'on_interrupt',
            value: {},
          },
        },
      });
    if (kind === 'tool')
      s.publish({
        transcript: [
          ...root.transcript,
          {
            id: 'call-message',
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call',
                type: 'function',
                function: { name: 'weather', arguments: '{}' },
              },
            ],
          },
        ],
      });
    if (kind === 'child')
      s.publish({
        subagents: [
          {
            started: {
              type: EventType.SUBAGENT_STARTED,
              subagentRunId: 'child',
              name: 'worker',
            },
          },
        ],
      });
    if (['notice', 'tool', 'child'].includes(kind)) s.publish({ ...root });
    let update: Partial<NativeSnapshot> = {};
    if (kind === 'pending-tools')
      update = {
        run: {
          id: root.run!.id,
          outcome: 'success',
          terminal: {
            type: EventType.RUN_FINISHED,
            threadId: app.getSnapshot().threadId!,
            runId: root.run!.id,
            outcome: { type: 'success', pendingToolCallIds: ['call'] },
          },
        },
      };
    if (kind === 'wrong-terminal')
      update = {
        run: {
          id: root.run!.id,
          outcome: 'success',
          terminal: {
            type: EventType.RUN_FINISHED,
            threadId: 'other',
            runId: root.run!.id,
          },
        },
      };
    if (kind === 'truncated-prefix')
      update = {
        transcript: [
          root.transcript.at(-1)!,
          { id: 'answer-2', role: 'assistant', content: 'Second answer' },
        ],
      };
    if (kind === 'no-terminal')
      update = { run: { id: root.run!.id, outcome: 'success' } };
    s.finish(update);
    await pending;
    expect(app.getSnapshot().canSubmit).toBe(false);
    await app.submit('Replay');
    expect(s.submit).toHaveBeenCalledTimes(2);
    await app.dispose();
  }
);
it('Stop releases active work and fences a late success before a fresh lazy New', async () => {
  const { app, sessions, calls } = fixture();
  const pending = app.submit('Held');
  const old = sessions[0];
  await app.stop();
  await pending;
  const stopped = app.getSnapshot();
  old.finish();
  expect(app.getSnapshot()).toBe(stopped);
  expect(stopped.canSubmit).toBe(false);
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(old.dispose).toHaveBeenCalledTimes(1);
  await app.newConversation();
  expect(calls).toHaveLength(1);
  const fresh = app.submit('Fresh');
  sessions[1].finish();
  await fresh;
  expect(app.getSnapshot().canSubmit).toBe(true);
  await app.dispose();
});
it('dispose revokes synchronously, is idempotent and rejects future submission', async () => {
  const { app, sessions } = fixture();
  const pending = app.submit('Held');
  const detached = app.getSnapshot(),
    one = app.dispose(),
    two = app.dispose();
  expect(one).toBe(two);
  await one;
  await pending;
  sessions[0].finish();
  await app.submit('After exit');
  expect(app.getSnapshot()).toBe(detached);
  expect(sessions[0].submit).toHaveBeenCalledTimes(1);
  expect(sessions[0].dispose).toHaveBeenCalledTimes(1);
});
it('reentrant factory disposal never installs or dispatches its returned candidate', async () => {
  const candidate = fakeSession('candidate');
  const app = createToolViewsApplication({
    sessionFactory: () => {
      void app.dispose();
      return candidate;
    },
  });
  await app.submit('Question');
  await app.dispose();
  expect(candidate.submit).not.toHaveBeenCalled();
  expect(candidate.dispose).toHaveBeenCalledTimes(1);
});
it('New admits replacement before reentrant cleanup and stays lazy', async () => {
  const { app, sessions, calls } = fixture();
  const pending = app.submit('Question');
  sessions[0].finish();
  await pending;
  sessions[0].dispose.mockImplementation(async () => {
    await app.submit('Reentrant');
  });
  await app.newConversation();
  expect(calls).toHaveLength(1);
  expect(app.getSnapshot()).toMatchObject({
    threadId: null,
    views: [],
    canSubmit: true,
  });
  await app.dispose();
});
it('borrowed native getSnapshot revocation cannot authorize an old result', async () => {
  const { app, sessions } = fixture();
  const pending = app.submit('Question');
  const old = sessions[0],
    read = old.getSnapshot;
  old.getSnapshot = () => {
    void app.stop();
    return read();
  };
  old.finish();
  await pending;
  expect(app.getSnapshot().canSubmit).toBe(false);
  await app.dispose();
});

it('a throwing view subscriber cannot prevent native admission, completion or cleanup', async () => {
  const { app, sessions } = fixture();
  app.subscribe(() => {
    throw new Error('View failure');
  });
  const pending = app.submit('Question');
  expect(sessions).toHaveLength(1);
  sessions[0].finish();
  await pending;
  expect(app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: 'success',
  });
  await app.dispose();
  expect(sessions[0].dispose).toHaveBeenCalledTimes(1);
});
