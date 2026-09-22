import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';

const sessions: ReturnType<typeof createSession>[] = [];
const complete: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};
const choices = () => ({
  config: {
    tags: ['review'],
    recursion_limit: 50,
    configurable: { user_id: 'user-42', preferences: { language: 'en' } },
  },
  context: { locale: 'en', features: ['memory'] },
  metadata: { source: 'ui', session: { label: 'first' } },
});
function fixture() {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield complete;
  });
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory: async () => [] },
  });
  sessions.push(session);
  return { stream, session };
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

describe('owned run options', () => {
  it.each([null, false, 0, ''])(
    'preserves a falsey context %s',
    async (context) => {
      const f = fixture();
      expect(await f.session.submit('Go', { context })).toBe('success');
      expect(f.stream.mock.calls[0][4]).toEqual({ context });
    }
  );

  it.each([
    { config: { configurable: { value: new Date() } } },
    { metadata: { value: () => true } },
    { config: new Date() },
    { metadata: [] },
  ])(
    'rejects unsupported included option data before dispatch',
    async (options) => {
      const f = fixture();
      const before = f.session.getSnapshot();
      await expect(
        f.session.submit('Invalid', options as never)
      ).rejects.toBeInstanceOf(TypeError);
      expect(f.session.getSnapshot()).toBe(before);
      expect(f.stream).not.toHaveBeenCalled();
    }
  );

  it('captures configuration, context, metadata and signal before dispatch without treating them as graph input', async () => {
    const f = fixture();
    const original = choices();
    const external = new AbortController();
    const signal = vi.fn(() => external.signal);
    const config = vi.fn(() => original.config);
    const context = vi.fn(() => original.context);
    const metadata = vi.fn(() => original.metadata);
    const run = f.session.submit('Go', {
      get signal() {
        return signal();
      },
      get config() {
        return config();
      },
      get context() {
        return context();
      },
      get metadata() {
        return metadata();
      },
    });
    original.config.tags.push('changed');
    original.context.features.push('changed');
    original.metadata.session.label = 'changed';
    expect(await run).toBe('success');
    expect(f.stream.mock.calls[0][4]).toEqual(choices());
    expect(f.stream.mock.calls[0][2]).toEqual({
      messages: [{ id: expect.any(String), type: 'human', content: 'Go' }],
    });
    for (const getter of [signal, config, context, metadata])
      expect(getter).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(f.stream.mock.calls[0][4]?.config?.tags)).toBe(true);
    expect(f.session.getSnapshot().values).toEqual({});
    await f.session.submit('Later');
    expect(f.stream.mock.calls[1][4]).toBeUndefined();
  });

  it('ignores reserved routing and extra root option getters while preserving application configuration', async () => {
    const f = fixture();
    const original = choices();
    const poison = vi.fn(() => {
      throw new Error('must not read');
    });
    for (const key of [
      'thread_id',
      'checkpoint_id',
      'checkpoint_ns',
      'checkpoint_map',
    ])
      Object.defineProperty(original.config.configurable, key, {
        enumerable: true,
        get: poison,
      });
    for (const key of [
      'command',
      'checkpoint',
      'checkpointId',
      'streamMode',
      'streamSubgraphs',
      'onRunCreated',
    ])
      Object.defineProperty(original, key, { enumerable: true, get: poison });
    expect(await f.session.submit('Go', original)).toBe('success');
    expect(f.stream.mock.calls[0][4]).toEqual(choices());
    expect(poison).not.toHaveBeenCalled();
  });

  it('retains owned options through a tool continuation despite caller mutation in the handler', async () => {
    const original = choices();
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      payload,
      _signal,
      options
    ) {
      const input = payload as { messages: { type: string }[] };
      if (input.messages[0].type === 'tool') yield complete;
      else {
        // A transport may replace fields on its envelope, but cannot change the
        // captured settings retained by the logical command.
        expect(() => options?.config?.tags?.push('mutated')).toThrow(TypeError);
        if (options) options.context = { locale: 'transport mutation' };
        yield {
          type: 'values',
          data: {
            messages: [
              {
                type: 'ai',
                id: 'tool',
                content: '',
                tool_calls: [{ id: 'call', name: 'work', args: {} }],
              },
            ],
          },
        };
      }
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream },
      tools: {
        work: {
          description: 'Work',
          handler: () => {
            original.config.configurable.user_id = 'changed';
            original.context.locale = 'changed';
            original.metadata.source = 'changed';
            return 'Done';
          },
        },
      },
    });
    sessions.push(session);
    expect(await session.submit('Go', original)).toBe('success');
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1][4]).toEqual(choices());
    expect(stream.mock.calls[1][4]).not.toBe(stream.mock.calls[0][4]);
  });

  it('captures explicit resume settings and does not inherit settings into a later resume', async () => {
    const f = fixture();
    f.stream.mockImplementationOnce(async function* () {
      yield {
        type: 'updates',
        data: { __interrupt__: [{ id: 'first', value: 'Continue?' }] },
      };
    });
    expect(await f.session.submit('Go', choices())).toBe('paused');
    f.stream.mockImplementationOnce(async function* () {
      yield {
        type: 'updates',
        data: { __interrupt__: [{ id: 'second', value: 'Again?' }] },
      };
    });
    expect(await f.session.resume(false, choices())).toBe('paused');
    expect(f.stream.mock.calls[1][4]).toEqual({
      ...choices(),
      command: { resume: false },
    });
    expect(await f.session.resume(true)).toBe('success');
    expect(f.stream.mock.calls[2][4]).toEqual({ command: { resume: true } });
  });

  it('rejects unsupported nested option data without superseding active work', async () => {
    const f = fixture();
    const started = deferred<void>();
    const released = deferred<void>();
    f.stream.mockImplementationOnce(async function* () {
      started.resolve();
      await released.promise;
      yield complete;
    });
    const active = f.session.submit('Original');
    await started.promise;
    const before = f.session.getSnapshot();
    const context: Record<string, unknown> = {};
    context['self'] = context;
    await expect(
      f.session.submit('Invalid', { context } as never)
    ).rejects.toBeInstanceOf(TypeError);
    expect(f.session.getSnapshot()).toBe(before);
    expect(f.stream).toHaveBeenCalledTimes(1);
    released.resolve();
    expect(await active).toBe('success');
  });

  it.each(['stop', 'dispose', 'submit', 'load'] as const)(
    'does not admit stale options after a getter invokes %s',
    async (command) => {
      const f = fixture();
      let replacement: Promise<unknown> | undefined;
      const run = f.session.submit('Stale', {
        get context() {
          replacement =
            command === 'submit'
              ? f.session.submit('Replacement')
              : command === 'load'
              ? f.session.load?.()
              : f.session[command]();
          return { locale: 'en' };
        },
      });
      expect(await run).toBe('aborted');
      await replacement;
      expect(
        f.session
          .getSnapshot()
          .messages.some((message) => message.content === 'Stale')
      ).toBe(false);
      expect(f.stream).toHaveBeenCalledTimes(command === 'submit' ? 1 : 0);
    }
  );

  it('does not traverse run options for pre-aborted submit or ineligible resume', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const poison = vi.fn(() => {
      throw new Error('must not read');
    });
    expect(
      await f.session.submit('Go', {
        signal: controller.signal,
        get context() {
          return poison();
        },
      })
    ).toBe('aborted');
    await expect(
      f.session.resume(true, {
        get context() {
          return poison();
        },
      })
    ).rejects.toThrow('Resume requires');
    expect(poison).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
  });

  it.each(['stop', 'dispose', 'submit', 'load'] as const)(
    'does not admit stale resume options after a getter invokes %s',
    async (command) => {
      const f = fixture();
      f.stream.mockImplementationOnce(async function* () {
        yield {
          type: 'updates',
          data: { __interrupt__: [{ id: 'pause', value: true }] },
        };
      });
      expect(await f.session.submit('Pause')).toBe('paused');
      let replacement: Promise<unknown> | undefined;
      const run = f.session.resume(true, {
        get context() {
          replacement =
            command === 'submit'
              ? f.session.submit('Replacement')
              : command === 'load'
              ? f.session.load?.()
              : f.session[command]();
          return {};
        },
      });
      expect(await run).toBe('aborted');
      await replacement;
      expect(f.stream).toHaveBeenCalledTimes(command === 'submit' ? 2 : 1);
      expect(
        f.stream.mock.calls.every((call) => call[4]?.command === undefined)
      ).toBe(true);
    }
  );
});
