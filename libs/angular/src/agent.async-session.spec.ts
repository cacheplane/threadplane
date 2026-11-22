import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentSession } from '@threadplane/core';
import {
  createFakeAgentSession,
  type FakeAgentSession,
} from '@threadplane/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type AgentSessionContext } from './public-api';

const injectors: EnvironmentInjector[] = [];
afterEach(() => {
  for (const injector of injectors.splice(0))
    if (!injector.destroyed) injector.destroy();
  TestBed.resetTestingModule();
});

function context() {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}

/** A factory whose sessions resolve when the test says so. */
function deferredFactory() {
  const calls: {
    context: AgentSessionContext;
    fake: FakeAgentSession;
    resolve(): void;
    reject(error: unknown): void;
  }[] = [];
  const createSession = (sessionContext: AgentSessionContext) =>
    new Promise<AgentSession>((resolve, reject) => {
      const fake = createFakeAgentSession();
      calls.push({
        context: sessionContext,
        fake,
        resolve: () => resolve(fake.session),
        reject,
      });
    });
  return { createSession, calls };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createAgent with an async session factory', () => {
  it('shows an empty idle conversation until the first session resolves', async () => {
    const factory = deferredFactory();
    const injector = context();
    const agent = runInInjectionContext(injector, () =>
      createAgent({ createSession: factory.createSession })
    );
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toEqual([]);
    expect(agent.toolCalls()).toEqual([]);
    // The collections a first-party backend always holds read as empty lists.
    const loose = agent as unknown as Record<string, () => unknown>;
    for (const key of ['interrupts', 'subgraphs', 'subagents'])
      expect(loose[key]()).toEqual([]);
    expect(typeof agent.submit).toBe('function');
    expect(typeof agent.stop).toBe('function');
    expect('submit' in agent).toBe(true);

    factory.calls[0].resolve();
    await tick();
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toBe(
      factory.calls[0].fake.session.getSnapshot().messages
    );
  });

  it('queues a command called before the session resolves and runs it on that session', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession })
    );
    const outcome = agent.submit({ message: 'Hello' });
    await tick();
    const fake = factory.calls[0].fake;
    const submit = vi.spyOn(fake.session, 'submit');
    expect(submit).not.toHaveBeenCalled();

    factory.calls[0].resolve();
    await expect(outcome).resolves.toBe('success');
    expect(submit).toHaveBeenCalledWith({ message: 'Hello' });
    expect(
      agent.messages().some((message) => message.role === 'user')
    ).toBe(true);
  });

  it('stops nothing before the first session, and stops the current one at once during a switch', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession })
    );
    await expect(agent.stop()).resolves.toBeUndefined();
    factory.calls[0].resolve();
    await tick();
    const first = factory.calls[0].fake;
    const stop = vi.spyOn(first.session, 'stop');
    agent.switchThread('other');
    await agent.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the current thread while a switch is pending, then adopts only the latest switch', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession })
    );
    factory.calls[0].resolve();
    await tick();
    const first = factory.calls[0].fake.session;

    agent.switchThread('a');
    agent.switchThread('b');
    expect(agent.threadId()).toBeNull();
    expect(agent.isThreadLoading()).toBe(true);
    const [, a, b] = factory.calls;
    const disposeA = vi.spyOn(a.fake.session, 'dispose');
    const disposeFirst = vi.spyOn(first, 'dispose');

    // The superseded session resolves later and is disposed, never shown.
    b.resolve();
    await tick();
    expect(agent.threadId()).toBe('b');
    expect(disposeFirst).toHaveBeenCalled();
    a.resolve();
    await tick();
    expect(disposeA).toHaveBeenCalled();
    expect(agent.threadId()).toBe('b');
    expect(a.context.threadId).toBe('a');
    expect(b.context.threadId).toBe('b');
  });

  it('sends a command called during a switch to the new session, never the old one', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession })
    );
    factory.calls[0].resolve();
    await tick();
    const oldSubmit = vi.spyOn(factory.calls[0].fake.session, 'submit');
    agent.switchThread('next');
    const outcome = agent.submit({ message: 'For the next thread' });
    const next = factory.calls[1];
    const newSubmit = vi.spyOn(next.fake.session, 'submit');
    next.resolve();
    await outcome;
    expect(oldSubmit).not.toHaveBeenCalled();
    expect(newSubmit).toHaveBeenCalledWith({ message: 'For the next thread' });
  });

  it('keeps the current session when a switch rejects, and rejects the commands that waited', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession })
    );
    factory.calls[0].resolve();
    await tick();
    const messages = agent.messages();
    agent.switchThread('broken');
    const waiting = agent.submit({ message: 'Lost' });
    const failure = new Error('Offline');
    factory.calls[1].reject(failure);
    await expect(waiting).rejects.toBe(failure);
    expect(agent.threadId()).toBeNull();
    expect(agent.isThreadLoading()).toBe(false);
    expect(agent.messages()).toBe(messages);
    // The agent still works on the session it kept.
    await expect(agent.submit({ message: 'Still here' })).resolves.toBe(
      'success'
    );
  });

  it('keeps its first session pending when a followed thread is read before it resolves', async () => {
    // The followed signal's first read matches the thread the first session
    // is being created for. That is not a switch back: nothing is shown yet.
    const factory = deferredFactory();
    const followed = signal<string | null>(null);
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession, threadId: followed })
    );
    TestBed.tick();
    const outcome = agent.submit({ message: 'Hello' });
    const submit = vi.spyOn(factory.calls[0].fake.session, 'submit');
    factory.calls[0].resolve();
    await expect(outcome).resolves.toBe('success');
    expect(submit).toHaveBeenCalledWith({ message: 'Hello' });
    expect(factory.calls).toHaveLength(1);
    expect(agent.messages()).toBe(factory.calls[0].fake.session.getSnapshot().messages);
  });

  it('drops a pending switch when the followed thread changes back to the shown one', async () => {
    const factory = deferredFactory();
    const followed = signal<string | null>('shown');
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession, threadId: followed })
    );
    factory.calls[0].resolve();
    await tick();
    expect(agent.threadId()).toBe('shown');

    followed.set('elsewhere');
    TestBed.tick();
    expect(factory.calls).toHaveLength(2);
    followed.set('shown');
    TestBed.tick();
    expect(factory.calls).toHaveLength(2);
    const late = vi.spyOn(factory.calls[1].fake.session, 'dispose');
    factory.calls[1].resolve();
    await tick();
    expect(agent.threadId()).toBe('shown');
    expect(late).toHaveBeenCalled();
  });

  it('disposes a session that resolves after the agent is destroyed, and rejects waiting commands', async () => {
    const factory = deferredFactory();
    const injector = context();
    const agent = runInInjectionContext(injector, () =>
      createAgent({ createSession: factory.createSession })
    );
    const waiting = agent.submit({ message: 'Too late' });
    injector.destroy();
    await expect(waiting).rejects.toThrow('The agent was destroyed.');
    const dispose = vi.spyOn(factory.calls[0].fake.session, 'dispose');
    factory.calls[0].resolve();
    await tick();
    expect(dispose).toHaveBeenCalled();
  });

  it('reports isThreadLoading while a session for a saved thread is pending', async () => {
    const factory = deferredFactory();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: factory.createSession, threadId: 'saved' })
    );
    expect(agent.isThreadLoading()).toBe(true);
    factory.calls[0].resolve();
    await tick();
    // The fake session has no load: nothing else to wait for.
    expect(agent.isThreadLoading()).toBe(false);
  });
});
