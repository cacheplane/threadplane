import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  HttpAgent,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { Observable } from 'rxjs';
import { createSession } from './create-session';

function present<T>(value: T | undefined): T {
  ok(value !== undefined);
  return value;
}
function response(input: RunAgentInput, events: unknown[] = []) {
  return new Response(
    [
      { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
      ...events,
      { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId },
    ]
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session timeout')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
describe('private session command owner', () => {
  it('captures configuration and initial graphs once, observes inertly and dispatches only admitted submissions', async () => {
    const headers = { authorization: 'original' };
    const state = { nested: [1] };
    const messages = [{ id: 'seed', role: 'user' as const, content: 'seed' }];
    const bodies: RunAgentInput[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject(headersAtConstruction);
      const input = JSON.parse(String(init.body)) as RunAgentInput;
      bodies.push(input);
      return response(input);
    });
    const headersAtConstruction = { authorization: 'original' };
    const owner = createSession({
      threadId: 'fixed',
      url: 'http://unused.invalid',
      headers,
      fetch: fetcher,
      messages,
      state,
    });
    headers.authorization = 'changed';
    state.nested.push(2);
    messages[0].content = 'changed';
    const initial = owner.getSnapshot();
    const notify = vi.fn();
    const off = owner.subscribe(notify);
    off();
    expect(fetcher).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(initial.state).toEqual({ nested: [1] });
    expect(initial.transcript[0].content).toBe('seed');
    expect(await bounded(owner.submit('hello'))).toBe('success');
    const settled = owner.getSnapshot();
    expect(settled.status).toBe('idle');
    expect(settled.run?.outcome).toBe('success');
    expect(bodies[0]).toEqual({
      threadId: 'fixed',
      runId: settled.run?.id,
      messages: [
        ...initial.transcript,
        { id: expect.any(String), role: 'user', content: 'hello' },
      ],
      state: { nested: [1] },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(bodies[0].runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[0].messages[1].id).toMatch(/^[0-9a-f-]{36}$/);
    await owner.dispose();
    expect(await owner.submit('ignored')).toBe('aborted');
    expect(owner.getSnapshot()).toBe(settled);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(() => createSession({ threadId: '', url: 'unused' })).toThrow();
  });
  it.each(['stop', 'dispose'] as const)(
    'listener %s before dispatch settles without HTTP and retains all-pass snapshot',
    async (command) => {
      const fetcher = vi.fn();
      const owner = createSession({
        threadId: 't',
        url: 'unused',
        fetch: fetcher,
      });
      const snapshots: unknown[] = [];
      const commands: Promise<void>[] = [];
      owner.subscribe(() => {
        if (owner.getSnapshot().status === 'running')
          commands.push(owner[command]());
      });
      owner.subscribe(() => snapshots.push(owner.getSnapshot()));
      expect(await bounded(owner.submit('hello'))).toBe('aborted');
      await bounded(Promise.all(commands));
      expect(fetcher).not.toHaveBeenCalled();
      expect(snapshots).toEqual([
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({
          status: 'idle',
          run: expect.objectContaining({ outcome: 'aborted' }),
        }),
      ]);
      expect(owner.getSnapshot().transcript).toHaveLength(1);
      await owner.dispose();
    }
  );
  it('preaborted commands do not replace work; option getter reentrancy cannot dispatch stale work', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) =>
      response(JSON.parse(String(init.body)))
    );
    const owner = createSession({
      threadId: 't',
      url: 'unused',
      fetch: fetcher,
    });
    const aborted = new AbortController();
    aborted.abort();
    const initial = owner.getSnapshot();
    expect(await owner.submit('ignored', { signal: aborted.signal })).toBe(
      'aborted'
    );
    expect(owner.getSnapshot()).toBe(initial);
    let stopped: Promise<void> | undefined;
    let reads = 0;
    expect(
      await owner.submit('getter', {
        get signal() {
          reads++;
          stopped = owner.dispose();
          return undefined;
        },
      })
    ).toBe('aborted');
    await stopped;
    expect(reads).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not admit history when a signal getter queues disposal from a listener', async () => {
    const fetcher = vi.fn();
    const owner = createSession({
      threadId: 't',
      url: 'unused',
      fetch: fetcher,
    });
    let nested: Promise<unknown> | undefined;
    let disposed: Promise<void> | undefined;
    owner.subscribe(() => {
      if (owner.getSnapshot().status === 'running' && !nested)
        nested = owner.submit('stale', {
          get signal() {
            disposed = owner.dispose();
            return undefined;
          },
        });
    });
    expect(await bounded(owner.submit('first'))).toBe('aborted');
    expect(await bounded(present(nested))).toBe('aborted');
    await disposed;
    expect(owner.getSnapshot().transcript).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('suppresses outer signal capture when its getter queues a newer submission during notification', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) =>
      response(JSON.parse(String(init.body)))
    );
    const owner = createSession({
      threadId: 't',
      url: 'unused',
      fetch: fetcher,
    });
    let outer: Promise<unknown> | undefined;
    let inner: Promise<unknown> | undefined;
    let triggered = false;
    owner.subscribe(() => {
      if (owner.getSnapshot().status === 'running' && !triggered) {
        triggered = true;
        outer = owner.submit('outer-stale', {
          get signal() {
            inner = owner.submit('inner-newer');
            return undefined;
          },
        });
      }
    });
    try {
      expect(await bounded(owner.submit('first'))).toBe('aborted');
      expect(await bounded(present(outer))).toBe('aborted');
      expect(await bounded(present(inner))).toBe('success');
      expect(owner.getSnapshot().transcript.map((m) => m.content)).toEqual([
        'first',
        'inner-newer',
      ]);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      await owner.dispose();
    }
  });
  it('rejects generated user ID collision before replacing active work or publishing history', async () => {
    const fetcher = vi.fn();
    const owner = createSession({
      threadId: 't',
      url: 'unused',
      fetch: fetcher,
      messages: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          role: 'user',
          content: 'seed',
        },
      ],
    });
    const initial = owner.getSnapshot();
    const uuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-0000-0000-000000000000');
    try {
      expect(await owner.submit('collision')).toBe('error');
      expect(owner.getSnapshot()).toBe(initial);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      uuid.mockRestore();
      await owner.dispose();
    }
  });
  it.each(['stop', 'dispose', 'submit'] as const)(
    'synchronous terminal notification %s beats candidate even when dispatched from queued submit',
    async (command) => {
      // Narrow SDK mock: real fetch cannot synchronously deliver inside start().
      const run = vi.spyOn(HttpAgent.prototype, 'run').mockImplementation(
        (input) =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.next({
              type: EventType.RUN_STARTED,
              threadId: input.threadId,
              runId: input.runId,
            });
            subscriber.next({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
          })
      );
      const owner = createSession({ threadId: 't', url: 'unused' });
      let replacement: Promise<unknown> | undefined;
      let intermediate: Promise<unknown> | undefined;
      let firstRun: string | undefined;
      let secondRun: string | undefined;
      owner.subscribe(() => {
        const value = owner.getSnapshot();
        if (!firstRun && value.status === 'running') {
          firstRun = value.run?.id;
          intermediate = owner.submit('queued');
        } else if (
          value.status === 'running' &&
          value.run?.id !== firstRun &&
          !secondRun
        )
          secondRun = value.run?.id;
        if (
          value.run?.id === secondRun &&
          value.run?.terminal &&
          !value.run.outcome &&
          !replacement
        )
          replacement =
            command === 'submit' ? owner.submit('last') : owner[command]();
      });
      try {
        expect(await bounded(owner.submit('first'))).toBe('aborted');
        expect(await bounded(present(intermediate))).toBe('aborted');
        await bounded(present(replacement));
        expect(owner.getSnapshot().run?.outcome).toBe(
          command === 'submit' ? 'success' : 'aborted'
        );
      } finally {
        await owner.dispose();
        run.mockRestore();
      }
    }
  );
  it('already selected synchronous success survives stop before promise finalization and listener errors', async () => {
    let stopped: Promise<void> | undefined;
    const run = vi.spyOn(HttpAgent.prototype, 'run').mockImplementation(
      (input) =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
          stopped = owner.stop();
        })
    );
    const owner = createSession({ threadId: 't', url: 'unused' });
    owner.subscribe(() => {
      throw new Error('view');
    });
    try {
      expect(await bounded(owner.submit('one'))).toBe('success');
      await stopped;
      expect(owner.getSnapshot().run?.outcome).toBe('success');
    } finally {
      await owner.dispose();
      run.mockRestore();
    }
  });
  it('contains custom-fetch replacement while the prior physical handle is being assigned', async () => {
    let replacement: Promise<unknown> | undefined;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as RunAgentInput;
      if (input.messages.length === 1)
        replacement = owner.submit('replacement');
      return response(input, [
        { type: 'STATE_SNAPSHOT', snapshot: { length: input.messages.length } },
      ]);
    });
    const owner = createSession({
      threadId: 't',
      url: 'unused',
      fetch: fetcher,
    });
    try {
      expect(await bounded(owner.submit('first'))).toBe('aborted');
      expect(await bounded(present(replacement))).toBe('success');
      expect(owner.getSnapshot().state).toEqual({ length: 2 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await owner.dispose();
    }
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores late %s from an old custom fetch that disregards abort',
    async (ending) => {
      let oldResolve!: (value: Response) => void;
      let oldReject!: (reason: unknown) => void;
      let oldInput!: RunAgentInput;
      let announce!: () => void;
      const started = new Promise<void>((yes) => {
        announce = yes;
      });
      const fetcher = vi.fn((_url: string, init: RequestInit) => {
        const input = JSON.parse(String(init.body)) as RunAgentInput;
        if (input.messages.length > 1)
          return Promise.resolve(
            response(input, [
              { type: 'STATE_SNAPSHOT', snapshot: { current: true } },
            ])
          );
        oldInput = input;
        announce();
        return new Promise<Response>((yes, no) => {
          oldResolve = yes;
          oldReject = no;
        });
      });
      const owner = createSession({
        threadId: 't',
        url: 'unused',
        fetch: fetcher,
      });
      const first = owner.submit('first');
      try {
        await bounded(started);
        const second = owner.submit('second');
        expect(await bounded(first)).toBe('aborted');
        expect(await bounded(second)).toBe('success');
        const settled = owner.getSnapshot();
        const notify = vi.fn();
        owner.subscribe(notify);
        if (ending === 'resolve')
          oldResolve(
            response(oldInput, [
              { type: 'STATE_SNAPSHOT', snapshot: { stale: true } },
            ])
          );
        else oldReject(new Error('late old failure'));
        await new Promise((yes) => setTimeout(yes, 0));
        expect(owner.getSnapshot()).toBe(settled);
        expect(notify).not.toHaveBeenCalled();
      } finally {
        oldReject?.(new Error('cleanup'));
        await owner.dispose();
        await first;
      }
    }
  );
  it('rechecks ownership after local terminal capture invokes a reentrant getter', async () => {
    let stop: Promise<void> | undefined;
    let reads = 0;
    const run = vi.spyOn(HttpAgent.prototype, 'run').mockImplementation(
      (input) =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            get result() {
              reads++;
              stop = owner.stop();
              return { ignored: true };
            },
          });
        })
    );
    const owner = createSession({ threadId: 't', url: 'unused' });
    try {
      expect(await bounded(owner.submit('first'))).toBe('aborted');
      await stop;
      expect(reads).toBe(1);
      expect(owner.getSnapshot().run?.terminal).toBeUndefined();
    } finally {
      await owner.dispose();
      run.mockRestore();
    }
  });
});
