import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AgentSession } from '@threadplane/core';
import { createFakeAgentSession } from '@threadplane/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_LIFECYCLE,
  AgentLifecycleRegistry,
  createAgent,
  createAgentRef,
  injectAgent,
  provideAgent,
  type Agent,
} from '@threadplane/angular';
import {
  injectFakeAgentSession,
  provideAgentValue,
  provideFakeAgent,
} from './public-api';

afterEach(() => TestBed.resetTestingModule());

const inContext = <T>(run: () => T) => TestBed.runInInjectionContext(run);

/** A hand-built agent: only what the component under test reads. */
function handBuilt(lifecycle?: object) {
  const messages = signal<readonly { id: string; content: string }[]>([]);
  const submit = vi.fn(async (text: string) => {
    messages.update((all) => [...all, { id: `${all.length}`, content: text }]);
    return 'success' as const;
  });
  const agent = {
    messages,
    status: signal('idle'),
    submit,
    ...(lifecycle && { lifecycle }),
  };
  return { agent: agent as unknown as Agent, submit };
}

@Component({
  selector: 'test-count',
  template: `{{ agent.messages().length }}`,
})
class Count {
  readonly agent = injectAgent();
}

describe('provideAgentValue', () => {
  it('makes the ref-less injectAgent() return the given agent', async () => {
    const { agent, submit } = handBuilt();
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const view = TestBed.createComponent(Count);
    expect(view.componentInstance.agent).toBe(agent);

    await view.componentInstance.agent.submit('Hello');
    expect(submit).toHaveBeenCalledExactlyOnceWith('Hello');
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('1');
  });

  it('answers injectAgent(ref) and the ref-less form with one agent', () => {
    const DEMO = createAgentRef<AgentSession>('demo');
    const { agent } = handBuilt();
    TestBed.configureTestingModule({
      providers: [provideAgentValue(DEMO, agent)],
    });
    expect(inContext(() => injectAgent(DEMO))).toBe(agent);
    expect(inContext(() => injectAgent())).toBe(agent);
  });

  it('replaces the agent of a provider given before it', () => {
    const DEMO = createAgentRef<AgentSession>('demo');
    const { agent } = handBuilt();
    const createSession = vi.fn(() => createFakeAgentSession().session);
    TestBed.configureTestingModule({
      providers: [
        provideAgent(DEMO, { createSession }),
        provideAgentValue(DEMO, agent),
      ],
    });
    expect(inContext(() => injectAgent(DEMO))).toBe(agent);
    expect(inContext(() => injectAgent())).toBe(agent);
    // The replaced provider never built its agent.
    expect(createSession).not.toHaveBeenCalled();
  });

  it('overrides a component-level agent through a component provider', () => {
    @Component({
      selector: 'test-owner',
      template: `{{ agent.messages().length }}`,
      providers: [provideFakeAgent({ delayMs: 0 })],
    })
    class Owner {
      readonly agent = injectAgent();
    }
    const { agent } = handBuilt();
    TestBed.overrideComponent(Owner, {
      set: { providers: [provideAgentValue(agent)] },
    });
    const view = TestBed.createComponent(Owner);
    expect(view.componentInstance.agent).toBe(agent);
  });

  it('resolves AGENT_LIFECYCLE to the lifecycle the agent carries', () => {
    const lifecycle = { streamStartedAt: signal<number | null>(null) };
    const { agent } = handBuilt(lifecycle);
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const resolved = inContext(() => inject(AGENT_LIFECYCLE));
    expect(resolved).toBe(lifecycle);
    lifecycle.streamStartedAt.set(7);
    expect(resolved.streamStartedAt()).toBe(7);
  });

  it('gives an agent without a lifecycle one whose milestones stay null', () => {
    const { agent } = handBuilt();
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const resolved = inContext(() => inject(AGENT_LIFECYCLE));
    expect(Object.keys(resolved).sort()).toEqual([
      'interruptReceivedAt',
      'interruptResolvedAt',
      'streamErrorAt',
      'streamStartedAt',
      'threadCreatedAt',
      'threadPersistedAt',
      'toolCallCompletedAt',
      'toolCallStartedAt',
    ]);
    for (const read of Object.values(resolved)) expect(read()).toBeNull();
  });

  it('leaves the agent to the test: not registered, not stopped, not disposed', () => {
    const stop = vi.fn();
    const dispose = vi.fn();
    const { agent } = handBuilt({ streamStartedAt: signal(null) });
    Object.assign(agent, { stop, dispose });
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    const view = TestBed.createComponent(Count);
    expect(TestBed.inject(AgentLifecycleRegistry).lifecycles()).toEqual([]);
    view.destroy();
    TestBed.resetTestingModule();
    expect(stop).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('provides a real agent built elsewhere, which keeps working', async () => {
    const fake = createFakeAgentSession();
    // Built once by the test, in its own injection context.
    const built = inContext(() =>
      createAgent({ createSession: () => fake.session })
    );
    @Component({
      selector: 'test-child',
      template: `{{ agent.messages().length }}`,
      providers: [provideAgentValue(built)],
    })
    class Child {
      readonly agent = injectAgent();
    }
    const view = TestBed.createComponent(Child);
    expect(view.componentInstance.agent).toBe(built);
    await built.submit('Hello');
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('1');
    view.destroy();
    // The component's injector did not own it.
    expect(fake.disposed).toBe(false);
  });

  it('is not a fake agent: its controls are refused', () => {
    const { agent } = handBuilt();
    TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
    expect(() => inContext(() => injectFakeAgentSession())).toThrow(
      /not provided by provideFakeAgent/
    );
  });

  it('refuses a call with no agent', () => {
    expect(() => provideAgentValue(undefined as never)).toThrow(TypeError);
    const DEMO = createAgentRef<AgentSession>('demo');
    expect(() => provideAgentValue(DEMO, null as never)).toThrow(TypeError);
  });
});
