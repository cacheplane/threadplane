import {
  computed,
  createEnvironmentInjector,
  effect,
  EnvironmentInjector,
  inject,
  InjectionToken,
  isSignal,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentSessionCustomEvent } from '@threadplane/core';
import { createFakeAgentSession } from '@threadplane/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_CLIENT_OPTIONS,
  AgentLifecycleRegistry,
  createAgent,
  provideAgentClientOptions,
  ɵAGENT_OPERATION_FAILURE_REPORTER,
  type AgentConfig,
  type AgentSessionContext,
} from './public-api';
import {
  scriptedSession,
  type ScriptedControl,
  type ScriptedOptions,
  type ScriptedSession,
} from './testing/scripted-session';

const injectors: EnvironmentInjector[] = [];
afterEach(() => {
  for (const injector of injectors.splice(0))
    if (!injector.destroyed) injector.destroy();
  TestBed.resetTestingModule();
});

function context(providers: Parameters<typeof createEnvironmentInjector>[0] = []) {
  const injector = createEnvironmentInjector(
    providers,
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}

/** An agent over scripted sessions, with every session it was given. */
function scripted(
  config: Omit<AgentConfig<ScriptedSession>, 'createSession'> = {},
  options: ScriptedOptions | ((context: AgentSessionContext) => ScriptedOptions) = {},
  providers: Parameters<typeof createEnvironmentInjector>[0] = []
) {
  const sessions: ScriptedControl[] = [];
  const injector = context(providers);
  const agent = runInInjectionContext(injector, () =>
    createAgent<ScriptedSession>({
      ...config,
      createSession(sessionContext) {
        const { session, control } = scriptedSession(
          sessionContext,
          typeof options === 'function' ? options(sessionContext) : options
        );
        sessions.push(control);
        return session;
      },
    })
  );
  return {
    agent,
    injector,
    sessions,
    get current() {
      return sessions[sessions.length - 1];
    },
  };
}

/** The agent as an untyped bag, to read names its type does not declare. */
const loose = (agent: object) =>
  agent as unknown as Record<string | symbol, unknown>;

/** `onCustomEvent` is optional in the contract; these sessions supply it. */
function listen(
  agent: {
    onCustomEvent?: (
      listener: (event: AgentSessionCustomEvent) => void
    ) => () => void;
  },
  listener: (event: AgentSessionCustomEvent) => void
) {
  if (!agent.onCustomEvent) throw new Error('The session has no custom events');
  return agent.onCustomEvent(listener);
}

/** Counts how often a signal notifies a consumer. */
function notifications(injector: EnvironmentInjector, read: () => unknown) {
  let count = 0;
  runInInjectionContext(injector, () =>
    effect(() => {
      read();
      count++;
    })
  );
  TestBed.tick();
  return () => {
    TestBed.tick();
    return count;
  };
}

describe('Agent signal view', () => {
  it('exposes each snapshot field as a read-only signal that follows the session', () => {
    const { agent, current } = scripted();
    expect(isSignal(agent.status)).toBe(true);
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toEqual([]);
    expect(agent.thread()).toBeNull();
    expect(agent.messages).not.toHaveProperty('set');

    current.publish({ status: 'running', messages: ['Hello'] });
    expect(agent.status()).toBe('running');
    expect(agent.messages()).toEqual(['Hello']);
  });

  it('returns the same signal and command for a name every time', () => {
    const { agent } = scripted();
    expect(agent.messages).toBe(agent.messages);
    expect(agent.note).toBe(agent.note);
    expect(agent.submit).toBe(agent.submit);
    expect(agent.switchThread).toBe(agent.switchThread);
    expect(agent.lifecycle).toBe(agent.lifecycle);
  });

  it('gives an optional field a signal before the snapshot holds it', () => {
    const { agent, current } = scripted();
    const note = agent.note;
    expect(isSignal(note)).toBe(true);
    expect(note()).toBeUndefined();
    current.publish({ note: 'ready' });
    expect(note()).toBe('ready');
    expect(agent.note).toBe(note);
  });

  it('does not notify a field whose own value is unchanged', () => {
    const { agent, current, injector } = scripted();
    const messages = notifications(injector, agent.messages);
    const status = notifications(injector, agent.status);
    const note = notifications(injector, agent.note);
    expect([messages(), status(), note()]).toEqual([1, 1, 1]);

    current.publish({ status: 'running' });
    expect([messages(), status(), note()]).toEqual([1, 2, 1]);

    current.publish({ messages: ['a'] });
    expect([messages(), status(), note()]).toEqual([2, 2, 1]);

    // A notification with the same aggregate changes nothing.
    current.notify();
    expect([messages(), status(), note()]).toEqual([2, 2, 1]);

    // A derived value recomputes only for its own field.
    const count = vi.fn(() => agent.messages().length);
    const derived = computed(count);
    expect(derived()).toBe(1);
    current.publish({ note: 'x' });
    expect(derived()).toBe(1);
    expect(count).toHaveBeenCalledTimes(1);
    expect(note()).toBe(2);
  });

  it('passes commands through with their arguments, receiver and result', async () => {
    const { agent, current } = scripted();
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const run = agent.submit('Hello', options);
    expect(current.calls).toEqual([['submit', 'Hello', options]]);
    await expect(run).resolves.toBe('success');
    expect(agent.messages()).toEqual(['Hello']);
    // A command detached from the agent still reaches the session with its receiver.
    const detached = agent.describe as (prefix: string) => string;
    expect(detached('at')).toBe('at:session:new');
    await agent.stop();
    expect(current.stops).toBe(1);
    expect(agent.status()).toBe('idle');
  });

  it('leaves an optional command undefined when the session lacks it', () => {
    const without = scripted();
    expect(without.agent.regenerate).toBeUndefined();
    expect('regenerate' in without.agent).toBe(false);
    for (const name of [
      'retry',
      'resume',
      'checkStatus',
      'run',
      'clientTools',
      'fork',
      'reconnect',
    ])
      expect(loose(without.agent)[name]).toBeUndefined();

    const withCommand = scripted({}, { regenerate: true });
    expect(withCommand.agent.regenerate).toBeTypeOf('function');
    expect('regenerate' in withCommand.agent).toBe(true);
    void withCommand.agent.regenerate?.('m1');
    expect(withCommand.current.calls).toEqual([['regenerate', 'm1']]);
  });

  it('treats a configured optional command name as a command, not a field', () => {
    const plain = scripted();
    // An unknown name reads as an optional field the snapshot does not hold yet.
    expect(isSignal(loose(plain.agent)['joinStream'])).toBe(true);
    const declared = scripted({ optionalCommands: ['joinStream'] });
    expect(loose(declared.agent)['joinStream']).toBeUndefined();
  });

  it('passes plain session members through and keeps session plumbing private', () => {
    const { agent } = scripted();
    expect(agent.label).toBe('session:new');
    const members = loose(agent);
    expect(members['getSnapshot']).toBeUndefined();
    expect(members['subscribe']).toBeUndefined();
    expect(members['dispose']).toBeUndefined();
    expect('dispose' in agent).toBe(false);
  });

  it('exposes the session member where a snapshot field shares its name', () => {
    const injector = context();
    const session = {
      getSnapshot: () => ({ status: 'idle' as const, reconnect: { runId: 'r' } }),
      subscribe: () => () => undefined,
      dispose: async () => undefined,
      reconnect: () => Promise.resolve('success' as const),
    };
    const agent = runInInjectionContext(injector, () =>
      createAgent({ createSession: () => session })
    );
    expect(isSignal(agent.reconnect)).toBe(false);
    expect(agent.reconnect()).toBeInstanceOf(Promise);
    expect(agent.status()).toBe('idle');
  });

  it('is not mistaken for a promise, a matcher, a node or an Angular hook', () => {
    const { agent } = scripted();
    const probe = loose(agent);
    for (const name of [
      'then',
      'toJSON',
      'asymmetricMatch',
      'nodeType',
      'ngOnDestroy',
      'constructor',
      '$$typeof',
      '__proto__',
      '_private',
      'ɵprov',
    ])
      expect(probe[name], name).toBeUndefined();
    expect(probe[Symbol.iterator]).toBeUndefined();
    expect(probe[Symbol.toPrimitive]).toBeUndefined();
    expect(isSignal(agent)).toBe(false);
  });

  it('cannot be written to', () => {
    const { agent } = scripted();
    const writable = loose(agent);
    expect(() => {
      writable['messages'] = signal([]);
    }).toThrow(TypeError);
    expect(() => {
      delete writable['submit'];
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(agent, 'extra', { value: 1 })
    ).toThrow(TypeError);
  });

  it('lists its controls, commands and fields', () => {
    const { agent, current } = scripted();
    current.publish({ note: 'x' });
    const keys = Object.keys(agent);
    expect(keys).toEqual(
      expect.arrayContaining([
        'threadId',
        'isThreadLoading',
        'switchThread',
        'customEvents',
        'lifecycle',
        'submit',
        'stop',
        'status',
        'messages',
        'note',
        'label',
      ])
    );
    expect(keys).not.toContain('getSnapshot');
    expect(keys).not.toContain('dispose');
    expect('messages' in agent).toBe(true);
    expect('missing' in agent).toBe(false);
  });

  it('views a core session, with optional core fields as signals', async () => {
    const fake = createFakeAgentSession();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: () => fake.session })
    );
    expect(agent.error()).toBeUndefined();
    expect(agent.plan()).toBeUndefined();
    expect(agent.interrupts()).toBeUndefined();
    expect(agent.usage()).toBeUndefined();
    expect(agent.regenerate).toBeUndefined();
    expect(agent.resume).toBeTypeOf('function');

    await agent.submit('Hello');
    expect(agent.messages().map((message) => message.content)).toEqual([
      'Hello',
    ]);
    fake.setError({ kind: 'server', message: 'Down', retryable: false });
    expect(agent.status()).toBe('error');
    expect(agent.error()?.message).toBe('Down');
    fake.set({ plan: [{ label: 'Step', status: 'pending' }] });
    expect(agent.plan()).toHaveLength(1);
  });

  it('disposes the session, and releases every subscription, with its injector', () => {
    const { agent, current, injector } = scripted();
    expect(current.subscribers).toBe(1);
    expect(current.customSubscribers).toBe(1);
    expect(current.lifecycleSubscribers).toBe(1);
    injector.destroy();
    expect(current.disposals).toBe(1);
    expect(current.subscribers).toBe(0);
    expect(current.customSubscribers).toBe(0);
    expect(current.lifecycleSubscribers).toBe(0);
    // Reads keep the final values; nothing later is published.
    current.publish({ messages: ['late'] });
    expect(agent.messages()).toEqual([]);
  });

  it('requires an injection context', () => {
    expect(() =>
      createAgent({ createSession: (c) => scriptedSession(c).session })
    ).toThrow();
  });
});

describe('Agent session options', () => {
  it('runs the session factory in the injection context, for every session', () => {
    const TOKEN = new InjectionToken<string>('token');
    const seen: string[] = [];
    const injector = context([{ provide: TOKEN, useValue: 'injected' }]);
    const agent = runInInjectionContext(injector, () =>
      createAgent({
        createSession(sessionContext) {
          seen.push(inject(TOKEN));
          return scriptedSession(sessionContext).session;
        },
      })
    );
    agent.switchThread('a');
    expect(seen).toEqual(['injected', 'injected']);
  });

  it('hands the app-wide client options and failure reporter to the factory', () => {
    const report = vi.fn();
    const clientOptions = { maxRetries: 2 };
    const { current, agent, sessions } = scripted({}, {}, [
      provideAgentClientOptions(clientOptions),
      { provide: ɵAGENT_OPERATION_FAILURE_REPORTER, useValue: report },
    ]);
    expect(current.context.clientOptions).toBe(clientOptions);
    expect(current.context.reportOperationFailure).toBe(report);
    agent.switchThread('next');
    expect(sessions[1].context.clientOptions).toBe(clientOptions);
    expect(sessions[1].context.reportOperationFailure).toBe(report);
    expect(TestBed.inject(AGENT_CLIENT_OPTIONS, null, { optional: true })).toBeNull();
  });

  it('passes undefined when neither token is provided', () => {
    const { current } = scripted();
    expect(current.context.clientOptions).toBeUndefined();
    expect(current.context.reportOperationFailure).toBeUndefined();
  });
});

describe('Agent thread switching', () => {
  it('starts on the configured thread and reads its history', async () => {
    const { agent, current } = scripted({ threadId: 'a' });
    expect(current.context.threadId).toBe('a');
    expect(agent.threadId()).toBe('a');
    expect(agent.thread()).toBe('a');
    expect(current.calls).toEqual([['load']]);
    expect(agent.isThreadLoading()).toBe(true);
    current.loads[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.isThreadLoading()).toBe(false);
  });

  it('reads no history for a new thread or a session that cannot load', () => {
    const fresh = scripted();
    expect(fresh.current.calls).toEqual([]);
    expect(fresh.agent.isThreadLoading()).toBe(false);
    expect(fresh.agent.threadId()).toBeNull();

    const unable = scripted({ threadId: 'a' }, { load: false });
    expect(unable.agent.isThreadLoading()).toBe(false);
  });

  it('settles a failed history read without failing the agent', async () => {
    const { agent, current } = scripted({ threadId: 'a' });
    current.loads[0].reject(new Error('unreachable'));
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.isThreadLoading()).toBe(false);
    expect(agent.status()).toBe('idle');
  });

  it('replaces the session while every signal and command carries on', async () => {
    const { agent, sessions, injector } = scripted({ threadId: 'a' });
    const { messages, status, submit, threadId, customEvents, lifecycle } =
      agent;
    const seen = notifications(injector, messages);
    sessions[0].publish({ messages: ['from a'] });
    expect(seen()).toBe(2);

    agent.switchThread('b');
    expect(sessions).toHaveLength(2);
    expect(sessions[1].context.threadId).toBe('b');
    expect(agent.messages).toBe(messages);
    expect(agent.status).toBe(status);
    expect(agent.submit).toBe(submit);
    expect(agent.threadId).toBe(threadId);
    expect(agent.customEvents).toBe(customEvents);
    expect(agent.lifecycle).toBe(lifecycle);
    expect(threadId()).toBe('b');
    expect(agent.thread()).toBe('b');
    expect(messages()).toEqual([]);
    expect(seen()).toBe(3);
    expect(agent.label).toBe('session:b');

    // The same command function now reaches the new session.
    await submit('to b');
    expect(sessions[1].calls).toContainEqual(['submit', 'to b', undefined]);
    expect(sessions[0].calls).not.toContainEqual(['submit', 'to b', undefined]);
    expect(messages()).toEqual(['to b']);
  });

  it('stops and disposes the old session and releases everything it held', () => {
    const { agent, sessions } = scripted({ threadId: 'a' });
    agent.switchThread('b');
    expect(sessions[0].stops).toBe(1);
    expect(sessions[0].disposals).toBe(1);
    expect(sessions[0].subscribers).toBe(0);
    expect(sessions[0].customSubscribers).toBe(0);
    expect(sessions[0].lifecycleSubscribers).toBe(0);
    expect(sessions[1].stops).toBe(0);
    expect(sessions[1].disposals).toBe(0);
  });

  it('lets nothing from the old thread publish into the new one', async () => {
    const { agent, sessions } = scripted({ threadId: 'a' });
    const listener = vi.fn();
    const release = listen(agent, listener);
    agent.switchThread('b');

    sessions[0].publish({ status: 'running', messages: ['late answer'] });
    sessions[0].emit({ name: 'late', data: 1 });
    sessions[0].mark({ streamStartedAt: 5 });
    sessions[0].context.onThreadId('stolen');
    sessions[0].loads[0].resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.messages()).toEqual([]);
    expect(agent.status()).toBe('idle');
    expect(agent.customEvents()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(agent.lifecycle.streamStartedAt()).toBeNull();
    expect(agent.threadId()).toBe('b');
    // The old thread finishing its read says nothing about the new one.
    expect(agent.isThreadLoading()).toBe(true);
    release();
  });

  it('switches during a run: the run is stopped and its result stays behind', async () => {
    const { agent, sessions } = scripted({ threadId: 'a' });
    const run = agent.submit('Hello');
    expect(agent.status()).toBe('running');
    agent.switchThread('b');
    expect(sessions[0].stops).toBe(1);
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toEqual([]);
    // The caller of the old command still gets its own outcome.
    await expect(run).resolves.toBe('success');
    sessions[0].publish({ status: 'idle', messages: ['Hello', 'Answer'] });
    expect(agent.messages()).toEqual([]);
  });

  it('settles on the last of two switches in a row', async () => {
    const { agent, sessions } = scripted({ threadId: 'a' });
    agent.switchThread('b');
    agent.switchThread('c');
    expect(sessions.map((session) => session.context.threadId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(sessions[1].disposals).toBe(1);
    expect(sessions[1].subscribers).toBe(0);
    expect(agent.threadId()).toBe('c');
    expect(agent.isThreadLoading()).toBe(true);

    // The skipped thread's history arrives late, then the first one's.
    sessions[1].publish({ messages: ['history of b'] });
    sessions[1].loads[0].resolve();
    sessions[0].loads[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.messages()).toEqual([]);
    expect(agent.isThreadLoading()).toBe(true);

    sessions[2].publish({ messages: ['history of c'] });
    sessions[2].loads[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.messages()).toEqual(['history of c']);
    expect(agent.isThreadLoading()).toBe(false);
  });

  it('switches to a new empty thread with null, and reloads on the same id', () => {
    const { agent, sessions } = scripted({ threadId: 'a' });
    agent.switchThread('a');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].disposals).toBe(1);
    expect(sessions[1].calls).toEqual([['load']]);

    agent.switchThread(null);
    expect(sessions[2].context.threadId).toBeNull();
    expect(agent.threadId()).toBeNull();
    expect(agent.isThreadLoading()).toBe(false);
    expect(sessions[2].calls).toEqual([]);
  });

  it('rejects a thread id that is not a nonempty string or null', () => {
    const { agent, sessions } = scripted();
    for (const invalid of ['', undefined, 3, {}])
      expect(() => agent.switchThread(invalid as never)).toThrow(TypeError);
    expect(sessions).toHaveLength(1);
  });

  it('stays on its session when the factory fails for the next thread', () => {
    const injector = context();
    const controls: ScriptedControl[] = [];
    const agent = runInInjectionContext(injector, () =>
      createAgent({
        createSession(sessionContext) {
          if (sessionContext.threadId === 'broken') throw new Error('No session');
          const { session, control } = scriptedSession(sessionContext);
          controls.push(control);
          return session;
        },
      })
    );
    expect(() => agent.switchThread('broken')).toThrow('No session');
    expect(controls[0].disposals).toBe(0);
    expect(agent.threadId()).toBeNull();
    controls[0].publish({ messages: ['still here'] });
    expect(agent.messages()).toEqual(['still here']);
  });

  it('follows a thread id signal from the config', () => {
    const selected = signal<string | null>('a');
    const { agent, sessions } = scripted({ threadId: selected });
    expect(agent.threadId()).toBe('a');
    TestBed.tick();
    // The first value is the starting thread, not a switch.
    expect(sessions).toHaveLength(1);

    selected.set('b');
    TestBed.tick();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].disposals).toBe(1);
    expect(agent.threadId()).toBe('b');

    selected.set(null);
    TestBed.tick();
    expect(sessions).toHaveLength(3);
    expect(agent.threadId()).toBeNull();
  });

  it('does not track what the session factory reads', () => {
    const selected = signal<string | null>('a');
    const unrelated = signal(0);
    const sessions: ScriptedControl[] = [];
    runInInjectionContext(context(), () =>
      createAgent({
        threadId: selected,
        createSession(sessionContext) {
          unrelated();
          const { session, control } = scriptedSession(sessionContext);
          sessions.push(control);
          return session;
        },
      })
    );
    selected.set('b');
    TestBed.tick();
    unrelated.set(1);
    TestBed.tick();
    expect(sessions).toHaveLength(2);
  });

  it('adopts the thread a session creates without switching', async () => {
    const selected = signal<string | null>(null);
    const onThreadId = vi.fn((id: string) => selected.set(id));
    const { agent, sessions } = scripted({ threadId: selected, onThreadId });
    const run = agent.submit('Hello');
    // The session reports the thread it created while its run is under way.
    sessions[0].context.onThreadId('created');
    expect(agent.threadId()).toBe('created');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('created');
    expect(agent.lifecycle.threadCreatedAt()).toBeTypeOf('number');

    // The host mirrors the id into its signal: that is not a switch.
    TestBed.tick();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].stops).toBe(0);
    expect(agent.status()).toBe('running');
    await run;

    // Reporting the same id again does nothing.
    sessions[0].context.onThreadId('created');
    expect(onThreadId).toHaveBeenCalledTimes(1);
  });

  it('adopts an id the factory reports while it creates the session', () => {
    const onThreadId = vi.fn();
    const agent = runInInjectionContext(context(), () =>
      createAgent({
        onThreadId,
        createSession(sessionContext) {
          sessionContext.onThreadId('chosen');
          return scriptedSession(sessionContext).session;
        },
      })
    );
    expect(agent.threadId()).toBe('chosen');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('chosen');
  });

  it('survives a thread id callback that throws', () => {
    const { agent, current } = scripted({
      onThreadId: () => {
        throw new Error('callback');
      },
    });
    expect(() => current.context.onThreadId('created')).not.toThrow();
    expect(agent.threadId()).toBe('created');
  });

  it('does nothing after its injector is destroyed', () => {
    const selected = signal<string | null>('a');
    const { agent, sessions, injector } = scripted({ threadId: selected });
    injector.destroy();
    agent.switchThread('b');
    selected.set('c');
    TestBed.tick();
    expect(sessions).toHaveLength(1);
    expect(agent.threadId()).toBe('a');
  });
});

describe('Agent custom events', () => {
  it('retains the current run events and starts each run empty', async () => {
    const { agent, current, injector } = scripted();
    const seen = notifications(injector, agent.customEvents);
    expect(agent.customEvents()).toEqual([]);

    void agent.submit('one');
    const first = { name: 'progress', data: { step: 1 } };
    const second = { name: 'progress', data: { step: 2 } };
    current.emit(first);
    current.emit(second);
    expect(agent.customEvents()).toEqual([first, second]);
    expect(agent.customEvents()[0]).toBe(first);
    expect(seen()).toBe(2);

    // The events stay readable after the run ends.
    current.publish({ status: 'idle' });
    expect(agent.customEvents()).toEqual([first, second]);

    // Streaming more of the same run does not clear them.
    void agent.submit('two');
    expect(agent.customEvents()).toEqual([]);
    current.emit(first);
    current.publish({ messages: ['one', 'two', 'answer'] });
    expect(agent.customEvents()).toEqual([first]);
  });

  it('clears the retained events on a thread switch', () => {
    const { agent, sessions } = scripted();
    sessions[0].emit({ name: 'a', data: null });
    expect(agent.customEvents()).toHaveLength(1);
    agent.switchThread('b');
    expect(agent.customEvents()).toEqual([]);
    sessions[1].emit({ name: 'b', data: null });
    expect(agent.customEvents()).toEqual([{ name: 'b', data: null }]);
  });

  it('stays empty, with no listener command, on a session without events', () => {
    const { agent } = scripted({}, { bare: true });
    expect(agent.customEvents()).toEqual([]);
    expect(agent.onCustomEvent).toBeUndefined();
  });

  it('keeps an onCustomEvent listener across a thread switch', () => {
    const { agent, sessions } = scripted();
    const listener = vi.fn();
    const failing = vi.fn(() => {
      throw new Error('listener');
    });
    listen(agent, failing);
    const release = listen(agent, listener);
    const first = { name: 'a', data: 1 };
    sessions[0].emit(first);
    expect(listener).toHaveBeenCalledExactlyOnceWith(first);

    agent.switchThread('b');
    const second = { name: 'b', data: 2 };
    sessions[1].emit(second);
    expect(listener).toHaveBeenLastCalledWith(second);
    expect(failing).toHaveBeenCalledTimes(2);

    release();
    release();
    sessions[1].emit(second);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(agent.onCustomEvent).toBe(agent.onCustomEvent);
  });
});

describe('Agent lifecycle', () => {
  const blank = {
    streamStartedAt: null,
    streamErrorAt: null,
    interruptReceivedAt: null,
    interruptResolvedAt: null,
    threadCreatedAt: null,
    threadPersistedAt: null,
    toolCallStartedAt: null,
    toolCallCompletedAt: null,
  };
  const read = (lifecycle: Record<string, () => unknown>) =>
    Object.fromEntries(
      Object.keys(blank).map((key) => [key, lifecycle[key]()])
    );

  it('mirrors the milestones the session records', () => {
    const { agent, current } = scripted();
    const lifecycle = agent.lifecycle as unknown as Record<string, () => unknown>;
    expect(Object.keys(lifecycle).sort()).toEqual(Object.keys(blank).sort());
    expect(Object.values(lifecycle).every(isSignal)).toBe(true);
    expect(read(lifecycle)).toEqual(blank);

    const failure = { at: 30, kind: 'server' };
    current.mark({ streamStartedAt: 10, interruptResolvedAt: 20 });
    current.mark({ streamErrorAt: failure, threadPersistedAt: 40 });
    current.mark({ toolCallStartedAt: 50, toolCallCompletedAt: 60 });
    current.mark({ interruptReceivedAt: 15 });
    expect(read(lifecycle)).toEqual({
      streamStartedAt: 10,
      streamErrorAt: failure,
      interruptReceivedAt: 15,
      interruptResolvedAt: 20,
      threadCreatedAt: null,
      threadPersistedAt: 40,
      toolCallStartedAt: 50,
      toolCallCompletedAt: 60,
    });
  });

  it('returns every milestone to null on a thread switch', () => {
    const { agent, sessions } = scripted();
    const lifecycle = agent.lifecycle as unknown as Record<string, () => unknown>;
    sessions[0].mark({ streamStartedAt: 10, toolCallStartedAt: 20 });
    sessions[0].context.onThreadId('created');
    expect(lifecycle['threadCreatedAt']()).not.toBeNull();

    agent.switchThread('b');
    expect(read(lifecycle)).toEqual(blank);
    sessions[1].mark({ streamStartedAt: 99 });
    expect(lifecycle['streamStartedAt']()).toBe(99);
  });

  it('prefers a thread-created milestone the session itself records', () => {
    const injector = context();
    const lifecycleSnapshot = { threadCreatedAt: 7 };
    const agent = runInInjectionContext(injector, () =>
      createAgent({
        createSession: () => ({
          getSnapshot: () => ({}),
          subscribe: () => () => undefined,
          dispose: async () => undefined,
          lifecycle: {
            getSnapshot: () => lifecycleSnapshot,
            subscribe: () => () => undefined,
          },
        }),
      })
    );
    expect(agent.lifecycle.threadCreatedAt()).toBe(7);
    expect(agent.lifecycle.streamStartedAt()).toBeNull();
  });

  it('leaves every milestone null on a session with no lifecycle', () => {
    const { agent } = scripted({ threadId: 'a' }, { bare: true });
    expect(
      read(agent.lifecycle as unknown as Record<string, () => unknown>)
    ).toEqual(blank);
  });

  it('registers with the root registry for the life of its injector', () => {
    const registry = TestBed.inject(AgentLifecycleRegistry);
    expect(registry.lifecycles()).toEqual([]);
    const first = scripted();
    const second = scripted();
    expect(registry.lifecycles()).toEqual([
      first.agent.lifecycle,
      second.agent.lifecycle,
    ]);
    // A thread switch keeps the same lifecycle registered.
    first.agent.switchThread('b');
    expect(registry.lifecycles()).toEqual([
      first.agent.lifecycle,
      second.agent.lifecycle,
    ]);
    first.injector.destroy();
    expect(registry.lifecycles()).toEqual([second.agent.lifecycle]);
    second.injector.destroy();
    expect(registry.lifecycles()).toEqual([]);
  });
});
