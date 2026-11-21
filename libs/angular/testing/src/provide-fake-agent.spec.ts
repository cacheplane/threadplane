import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentSession, ToolContract } from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentRef, injectAgent, provideAgent } from '@threadplane/angular';
import { scriptedSession } from '../../src/testing/scripted-session';
import { injectFakeAgentSession, provideFakeAgent } from './public-api';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session; no production dependency.
import type { LangGraphSession } from '../../../langgraph/src/runtime/create-session';

afterEach(() => {
  vi.useRealTimers();
  TestBed.resetTestingModule();
});

const inContext = <T>(run: () => T) => TestBed.runInInjectionContext(run);
const contents = (agent: { messages(): readonly { content: string }[] }) =>
  agent.messages().map((message) => message.content);

describe('provideFakeAgent', () => {
  it('answers a submit with the canned reply and no backend', async () => {
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ delayMs: 0 })],
    });
    const agent = inContext(() => injectAgent());
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toEqual([]);

    await expect(agent.submit('Hello')).resolves.toBe('success');
    expect(contents(agent)).toEqual(['Hello', 'Hello from the fake agent.']);
    expect(agent.messages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(agent.messages()[1].delivery).toMatchObject({
      phase: 'complete',
      outcome: 'success',
    });
    expect(agent.status()).toBe('idle');
  });

  it('streams the configured tokens one at a time', async () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ tokens: ['One', ' two'], delayMs: 10 })],
    });
    const agent = inContext(() => injectAgent());
    const run = agent.submit('Count');
    expect(agent.status()).toBe('running');
    expect(contents(agent)).toEqual(['Count', 'One']);
    await vi.advanceTimersByTimeAsync(10);
    expect(contents(agent)).toEqual(['Count', 'One two']);
    expect(agent.status()).toBe('running');
    await vi.advanceTimersByTimeAsync(10);
    await expect(run).resolves.toBe('success');
    expect(agent.status()).toBe('idle');
  });

  it('streams reasoning before the reply', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideFakeAgent({
          reasoningTokens: ['Think', 'ing'],
          tokens: ['Done'],
          delayMs: 0,
        }),
      ],
    });
    const agent = inContext(() => injectAgent());
    await agent.submit('Why');
    expect(agent.messages()[1]).toMatchObject({
      content: 'Done',
      reasoning: 'Thinking',
    });
  });

  it('stops the reply when the agent is stopped', async () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ tokens: ['a', 'b', 'c'], delayMs: 10 })],
    });
    const agent = inContext(() => injectAgent());
    const run = agent.submit('Go');
    await agent.stop();
    expect(agent.status()).toBe('idle');
    await vi.advanceTimersByTimeAsync(50);
    await expect(run).resolves.toBe('aborted');
    expect(contents(agent)).toEqual(['Go', 'a']);
  });

  it('names a new thread on its first submit', async () => {
    const onThreadId = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ delayMs: 0, onThreadId })],
    });
    const agent = inContext(() => injectAgent());
    expect(agent.threadId()).toBeNull();
    await agent.submit('Hello');
    expect(agent.threadId()).toBe('fake-thread-1');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('fake-thread-1');
    await agent.submit('Again');
    expect(onThreadId).toHaveBeenCalledTimes(1);
  });

  it('brings a thread back with its messages when the agent returns to it', async () => {
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ tokens: ['ok'], delayMs: 0 })],
    });
    const agent = inContext(() => injectAgent());
    await agent.submit('First thread');
    const first = agent.threadId();
    expect(first).toBe('fake-thread-1');

    agent.switchThread(null);
    expect(agent.messages()).toEqual([]);
    await agent.submit('Second thread');
    expect(agent.threadId()).toBe('fake-thread-2');

    agent.switchThread(first);
    expect(contents(agent)).toEqual(['First thread', 'ok']);
    agent.switchThread('never-seen');
    expect(agent.messages()).toEqual([]);
  });

  it('seeds every unseen thread from the session init, and lets it replace the reply', async () => {
    const onSubmit = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAgent({
          threadId: 'seeded',
          session: {
            messages: [{ role: 'assistant', content: 'Welcome' }],
            onSubmit,
          },
        }),
      ],
    });
    const agent = inContext(() => injectAgent());
    expect(contents(agent)).toEqual(['Welcome']);
    await agent.submit('Hello');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(contents(agent)).toEqual(['Welcome', 'Hello']);
  });

  it('hands a test the controls of the current fake session', async () => {
    TestBed.configureTestingModule({
      providers: [provideFakeAgent({ delayMs: 0 })],
    });
    const agent = inContext(() => injectAgent());
    const fake = inContext(() => injectFakeAgentSession());
    fake().push({ role: 'assistant', content: 'Pushed' });
    expect(contents(agent)).toEqual(['Pushed']);
    fake().setError({ kind: 'server', message: 'Down', retryable: false });
    expect(agent.error()?.message).toBe('Down');
    await agent.submit('Hello');
    expect(fake().submits).toHaveLength(1);

    // A thread switch gives the agent another fake session.
    const before = fake();
    agent.switchThread('other');
    expect(fake()).not.toBe(before);
    expect(before.disposed).toBe(true);
    fake().push({ role: 'assistant', content: 'On the other thread' });
    expect(contents(agent)).toEqual(['On the other thread']);
  });

  it('provides by ref, and disposes the fake with its injector', async () => {
    const DEMO = createAgentRef<AgentSession>('demo');
    @Component({
      selector: 'test-demo',
      template: `{{ agent.messages().length }}`,
      providers: [provideFakeAgent(DEMO, { delayMs: 0 })],
    })
    class Demo {
      readonly agent = injectAgent(DEMO);
      readonly fake = injectFakeAgentSession(DEMO);
    }
    const view = TestBed.createComponent(Demo);
    const { agent, fake } = view.componentInstance;
    await agent.submit('Hello');
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('2');
    const session = fake();
    view.destroy();
    expect(session.disposed).toBe(true);
  });

  it('stands in under a ref declared with a backend session type', async () => {
    const TRIP = createAgentRef<
      LangGraphSession<Record<string, ToolContract>, { todos: string[] }>
    >('trip');
    TestBed.configureTestingModule({
      providers: [
        provideFakeAgent(TRIP, {
          delayMs: 0,
          session: { state: { todos: ['a'] } },
        }),
      ],
    });
    const agent = inContext(() => injectAgent(TRIP));
    const fake = inContext(() => injectFakeAgentSession(TRIP));
    await expect(agent.submit('Hello')).resolves.toBe('success');
    expect(contents(agent)).toEqual(['Hello', 'Hello from the fake agent.']);
    expect(agent.state()).toEqual({ todos: ['a'] });
    fake().setState({ todos: ['a', 'b'] });
    expect(agent.state()).toEqual({ todos: ['a', 'b'] });
    // The fake is the core session: what only the backend publishes is unset.
    expect(agent.subgraphs()).toBeUndefined();
    expect(agent.history()).toBeUndefined();
  });

  it('refuses to hand out controls for an agent that is not fake', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgent({
          createSession: (context) => scriptedSession(context).session,
        }),
      ],
    });
    expect(() => inContext(() => injectFakeAgentSession())).toThrow(
      'injectFakeAgentSession: the agent here was not provided by provideFakeAgent.'
    );
  });
});
