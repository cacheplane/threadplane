import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  inject,
  InjectionToken,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_LIFECYCLE,
  AgentLifecycleRegistry,
  createAgentRef,
  injectAgent,
  provideAgent,
  provideAgentClientOptions,
  type AgentConfig,
} from './public-api';
import {
  scriptedSession,
  type ScriptedControl,
  type ScriptedSession,
} from './testing/scripted-session';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

function scriptedConfig(
  sessions: ScriptedControl[] = [],
  extra: Omit<AgentConfig<ScriptedSession>, 'createSession'> = {}
): AgentConfig<ScriptedSession> {
  return {
    ...extra,
    createSession(context) {
      const { session, control } = scriptedSession(context);
      sessions.push(control);
      return session;
    },
  };
}
const inContext = <T>(run: () => T) => TestBed.runInInjectionContext(run);

describe('provideAgent', () => {
  it('provides one agent, built on first injection', () => {
    const sessions: ScriptedControl[] = [];
    TestBed.configureTestingModule({
      providers: [provideAgent(scriptedConfig(sessions))],
    });
    expect(sessions).toHaveLength(0);
    const agent = inContext(() => injectAgent<ScriptedSession>());
    expect(sessions).toHaveLength(1);
    expect(inContext(() => injectAgent())).toBe(agent);
    expect(agent.status()).toBe('idle');
  });

  it('runs a config factory once, in an injection context', () => {
    const THREAD = new InjectionToken<string>('thread');
    const factory = vi.fn(() =>
      scriptedConfig([], { threadId: inject(THREAD) })
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: THREAD, useValue: 'from-di' },
        provideAgent(factory),
      ],
    });
    expect(factory).not.toHaveBeenCalled();
    const agent = inContext(() => injectAgent());
    inContext(() => injectAgent());
    TestBed.inject(AGENT_LIFECYCLE);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(agent.threadId()).toBe('from-di');
  });

  it('follows a thread id signal the config factory reads from the injector', () => {
    const THREAD = new InjectionToken('thread', {
      factory: () => signal<string | null>('a'),
    });
    const sessions: ScriptedControl[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideAgent(() =>
          scriptedConfig(sessions, { threadId: inject(THREAD) })
        ),
      ],
    });
    const agent = inContext(() => injectAgent());
    TestBed.inject(THREAD).set('b');
    TestBed.tick();
    expect(agent.threadId()).toBe('b');
    expect(sessions.map((session) => session.context.threadId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('rejects a config without a session factory when the agent is injected', () => {
    TestBed.configureTestingModule({
      providers: [provideAgent({} as AgentConfig<ScriptedSession>)],
    });
    expect(() => inContext(() => injectAgent())).toThrow(
      'provideAgent: `createSession` is required to build the agent.'
    );
  });

  it('fails clearly when no agent is provided', () => {
    TestBed.configureTestingModule({});
    expect(() => inContext(() => injectAgent())).toThrow(/AGENT/);
  });

  it('provides the lifecycle of the injected agent', () => {
    TestBed.configureTestingModule({
      providers: [provideAgent(scriptedConfig())],
    });
    const agent = inContext(() => injectAgent());
    expect(TestBed.inject(AGENT_LIFECYCLE)).toBe(agent.lifecycle);
    expect(TestBed.inject(AgentLifecycleRegistry).lifecycles()).toEqual([
      agent.lifecycle,
    ]);
  });

  it('passes app-wide client options to the session factory', () => {
    const sessions: ScriptedControl[] = [];
    const options = { maxRetries: 3 };
    TestBed.configureTestingModule({
      providers: [
        provideAgentClientOptions(options),
        provideAgent(scriptedConfig(sessions)),
      ],
    });
    inContext(() => injectAgent());
    expect(sessions[0].context.clientOptions).toBe(options);
  });

  it('scopes an agent to the injector that provides it and disposes it there', () => {
    const rootSessions: ScriptedControl[] = [];
    const childSessions: ScriptedControl[] = [];
    TestBed.configureTestingModule({
      providers: [provideAgent(scriptedConfig(rootSessions))],
    });
    const root = inContext(() => injectAgent());
    const child = createEnvironmentInjector(
      [provideAgent(scriptedConfig(childSessions))],
      TestBed.inject(EnvironmentInjector)
    );
    const scoped = runInInjectionContext(child, () => injectAgent());
    expect(scoped).not.toBe(root);
    expect(child.get(AGENT_LIFECYCLE)).toBe(scoped.lifecycle);

    child.destroy();
    expect(childSessions[0].disposals).toBe(1);
    expect(rootSessions[0].disposals).toBe(0);
    expect(TestBed.inject(AgentLifecycleRegistry).lifecycles()).toEqual([
      root.lifecycle,
    ]);
  });

  it('gives a component its own agent through its providers', () => {
    const sessions: ScriptedControl[] = [];
    @Component({
      selector: 'test-scoped',
      template: `{{ agent.status() }}`,
      providers: [provideAgent(scriptedConfig(sessions))],
    })
    class Scoped {
      readonly agent = injectAgent<ScriptedSession>();
    }
    const view = TestBed.createComponent(Scoped);
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('idle');
    sessions[0].publish({ status: 'running' });
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('running');
    view.destroy();
    expect(sessions[0].disposals).toBe(1);
  });

  it('follows a thread id signal for an agent a component provides', () => {
    const sessions: ScriptedControl[] = [];
    const selected = signal<string | null>('a');
    @Component({
      selector: 'test-routed',
      template: `{{ agent.threadId() }}`,
      providers: [
        provideAgent(() => scriptedConfig(sessions, { threadId: selected })),
      ],
    })
    class Routed {
      readonly agent = injectAgent<ScriptedSession>();
    }
    const view = TestBed.createComponent(Routed);
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('a');
    selected.set('b');
    view.detectChanges();
    expect(view.nativeElement.textContent).toBe('b');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].disposals).toBe(1);
    view.destroy();
    expect(sessions[1].disposals).toBe(1);
  });
});

describe('provideAgent with typed refs', () => {
  it('carries the agent from the provider to injectAgent(ref)', () => {
    const TRIP = createAgentRef<ScriptedSession>('trip');
    const factory = vi.fn(() => scriptedConfig());
    TestBed.configureTestingModule({ providers: [provideAgent(TRIP, factory)] });
    const agent = inContext(() => injectAgent(TRIP));
    // With one ref the ref-less form is the same instance, built once.
    expect(inContext(() => injectAgent())).toBe(agent);
    expect(TestBed.inject(AGENT_LIFECYCLE)).toBe(agent.lifecycle);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(agent.label).toBe('session:new');
  });

  it('names the ref in Angular injection errors', () => {
    const TRIP = createAgentRef<ScriptedSession>('trip');
    const unnamed = createAgentRef<ScriptedSession>();
    expect(TRIP.token.toString()).toBe('InjectionToken trip');
    expect(unnamed.token.toString()).toBe('InjectionToken ThreadplaneAgent');
    TestBed.configureTestingModule({});
    expect(() => inContext(() => injectAgent(TRIP))).toThrow(/trip/);
  });

  it('builds a distinct agent for each ref at one injector level', () => {
    const LIVE = createAgentRef<ScriptedSession>('live');
    const REPLAY = createAgentRef<ScriptedSession>('replay');
    const live: ScriptedControl[] = [];
    const replay: ScriptedControl[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideAgent(LIVE, scriptedConfig(live, { threadId: 'live-thread' })),
        provideAgent(
          REPLAY,
          scriptedConfig(replay, { threadId: 'replay-thread' })
        ),
      ],
    });
    const first = inContext(() => injectAgent(LIVE));
    const second = inContext(() => injectAgent(REPLAY));
    expect(first).not.toBe(second);
    expect(first.threadId()).toBe('live-thread');
    expect(second.threadId()).toBe('replay-thread');
    expect(live).toHaveLength(1);
    expect(replay).toHaveLength(1);
    // Injecting by ref is unambiguous, so nothing is logged.
    expect(warn).not.toHaveBeenCalled();
    expect(TestBed.inject(AgentLifecycleRegistry).lifecycles()).toEqual([
      first.lifecycle,
      second.lifecycle,
    ]);
  });

  it('resolves the ref-less form to the last ref and warns in development', () => {
    const LIVE = createAgentRef<ScriptedSession>('live');
    const REPLAY = createAgentRef<ScriptedSession>('replay');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideAgent(LIVE, scriptedConfig()),
        provideAgent(REPLAY, scriptedConfig()),
      ],
    });
    const shared = inContext(() => injectAgent());
    expect(shared).toBe(inContext(() => injectAgent(REPLAY)));
    expect(TestBed.inject(AGENT_LIFECYCLE)).toBe(shared.lifecycle);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('[@threadplane/angular] provideAgent(): 2 agent refs');
    expect(message).toContain('(live, replay)');
    expect(message).toContain('returns the last one provided (replay)');
    expect(message).toContain('injectAgent(live) / injectAgent(replay)');
  });

  it('does not warn for one ref, or for refs at different injector levels', () => {
    const OUTER = createAgentRef<ScriptedSession>('outer');
    const INNER = createAgentRef<ScriptedSession>('inner');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [provideAgent(OUTER, scriptedConfig())],
    });
    const outer = inContext(() => injectAgent());
    const child = createEnvironmentInjector(
      [provideAgent(INNER, scriptedConfig())],
      TestBed.inject(EnvironmentInjector)
    );
    const inner = runInInjectionContext(child, () => injectAgent());
    expect(inner).toBe(runInInjectionContext(child, () => injectAgent(INNER)));
    expect(runInInjectionContext(child, () => injectAgent(OUTER))).toBe(outer);
    expect(warn).not.toHaveBeenCalled();
    child.destroy();
  });
});
