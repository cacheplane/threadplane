import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
  ɵsetAgentDevelopmentHost,
  type AgentDevelopmentInstall,
  type AgentDevelopmentRuntime,
  type AgentSessionContext,
} from './public-api';
import {
  ɵrelayDevelopmentRuntime,
  ɵresetAgentDevelopmentHost,
} from './development-host';
import {
  scriptedSession,
  type ScriptedSession,
} from './testing/scripted-session';

const injectors: EnvironmentInjector[] = [];
afterEach(() => {
  for (const injector of injectors.splice(0))
    if (!injector.destroyed) injector.destroy();
  ɵresetAgentDevelopmentHost();
  TestBed.resetTestingModule();
});

const install = (enabled = true): AgentDevelopmentInstall => ({
  integration: 'langgraph',
  packageName: '@threadplane/langgraph',
  packageVersion: '1.2.3',
  installationToken: '11111111-1111-4111-8111-111111111111',
  enabled: () => enabled,
});

/** A collector host that records what it was asked to build and register. */
function host() {
  const runtimes: {
    install: AgentDevelopmentInstall;
    calls: unknown[][];
  }[] = [];
  const policies = new Map<object, () => boolean>();
  return {
    runtimes,
    policies,
    createRuntime: vi.fn(
      (given: AgentDevelopmentInstall): AgentDevelopmentRuntime => {
        const calls: unknown[][] = [];
        runtimes.push({ install: given, calls });
        return {
          touch: () => calls.push(['touch']),
          milestone: (kind, durationMs) =>
            calls.push(['milestone', kind, durationMs]),
          dispose: () => calls.push(['dispose']),
        };
      }
    ),
    registerPolicy: vi.fn((agent: object, policy: () => boolean) => {
      policies.set(agent, policy);
      return agent;
    }),
  };
}

/** An agent whose sessions use the context the way a first-party session does. */
function agentOver(
  providers: Parameters<typeof createEnvironmentInjector>[0] = [],
  enabled: (context: AgentSessionContext) => boolean = () => true
) {
  const injector = createEnvironmentInjector(
    providers,
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  const agent = runInInjectionContext(injector, () =>
    createAgent<ScriptedSession>({
      createSession(context) {
        const { session } = scriptedSession(context);
        const collector = context.developmentRuntime(install(enabled(context)));
        collector.touch();
        const dispose = session.dispose.bind(session);
        return Object.assign(session, {
          isDevelopmentRuntimeEnabled: () => enabled(context),
          dispose: () => {
            collector.dispose();
            return dispose();
          },
        });
      },
    })
  );
  return { agent, injector };
}

describe('development collector relay', () => {
  it('is inert without a host: nothing is built, and every call is safe', () => {
    const relay = ɵrelayDevelopmentRuntime(install());
    relay.touch();
    relay.milestone('transport.connected');
    relay.dispose();
    relay.touch();
    const late = host();
    ɵsetAgentDevelopmentHost(late);
    // The relay was disposed before a host existed: it never reaches one.
    expect(late.createRuntime).not.toHaveBeenCalled();
  });

  it('forwards to the collector of a host registered first', () => {
    const registered = host();
    ɵsetAgentDevelopmentHost(registered);
    const given = install();
    const relay = ɵrelayDevelopmentRuntime(given);
    expect(registered.createRuntime).toHaveBeenCalledTimes(1);
    expect(registered.runtimes[0].install).toBe(given);
    relay.touch();
    relay.milestone('runtime.first_stream_completed', 12);
    relay.dispose();
    relay.touch();
    expect(registered.runtimes[0].calls).toEqual([
      ['touch'],
      ['milestone', 'runtime.first_stream_completed', 12],
      ['dispose'],
    ]);
  });

  it('replays what a session did before a host loaded, in order', () => {
    const relay = ɵrelayDevelopmentRuntime(install());
    relay.touch();
    relay.milestone('transport.connected');
    const late = host();
    ɵsetAgentDevelopmentHost(late);
    relay.touch();
    expect(late.runtimes[0].calls).toEqual([
      ['touch'],
      ['milestone', 'transport.connected', undefined],
      ['touch'],
    ]);
  });

  it('keeps a bounded number of calls while it waits', () => {
    const relay = ɵrelayDevelopmentRuntime(install());
    for (let index = 0; index < 100; index++) relay.touch();
    const late = host();
    ɵsetAgentDevelopmentHost(late);
    expect(late.runtimes[0].calls).toHaveLength(16);
  });

  it('keeps the first host and survives one that throws', () => {
    const relay = ɵrelayDevelopmentRuntime(install());
    relay.touch();
    ɵsetAgentDevelopmentHost({
      createRuntime: () => {
        throw new Error('host failed');
      },
      registerPolicy: () => {
        throw new Error('host failed');
      },
    });
    const second = host();
    ɵsetAgentDevelopmentHost(second);
    relay.touch();
    relay.dispose();
    expect(second.createRuntime).not.toHaveBeenCalled();
    expect(() => ɵrelayDevelopmentRuntime(install()).touch()).not.toThrow();
  });
});

describe('Agent and the development collector host', () => {
  it('gives each session a collector and registers the agent, with no provider', () => {
    const registered = host();
    ɵsetAgentDevelopmentHost(registered);
    const { agent } = agentOver([], (context) => context.threadId !== 'off');
    expect(registered.runtimes).toHaveLength(1);
    expect(registered.runtimes[0].calls).toEqual([['touch']]);
    expect(registered.registerPolicy).toHaveBeenCalledTimes(1);
    expect(registered.registerPolicy.mock.calls[0][0]).toBe(agent);
    const policy = registered.policies.get(agent);
    expect(policy?.()).toBe(true);

    // A thread switch replaces the session: the old collector is disposed,
    // the new session gets its own, and the one policy follows.
    agent.switchThread('off');
    expect(registered.runtimes).toHaveLength(2);
    expect(registered.runtimes[0].calls).toEqual([['touch'], ['dispose']]);
    expect(registered.runtimes[1].install.enabled()).toBe(false);
    expect(policy?.()).toBe(false);
    expect(registered.registerPolicy).toHaveBeenCalledTimes(1);
  });

  it('connects an agent built before the host loaded', () => {
    const { agent, injector } = agentOver();
    const late = host();
    ɵsetAgentDevelopmentHost(late);
    expect(late.runtimes[0].calls).toEqual([['touch']]);
    expect(late.policies.get(agent)?.()).toBe(true);
    injector.destroy();
    expect(late.runtimes[0].calls).toEqual([['touch'], ['dispose']]);
    expect(late.policies.get(agent)?.()).toBe(false);
  });

  it('never reaches a host that loads after the agent was destroyed', () => {
    const { injector } = agentOver();
    injector.destroy();
    const late = host();
    ɵsetAgentDevelopmentHost(late);
    expect(late.createRuntime).not.toHaveBeenCalled();
    expect(late.registerPolicy).not.toHaveBeenCalled();
  });

  it('prefers a registrar provided through DI for the policy', () => {
    const registered = host();
    ɵsetAgentDevelopmentHost(registered);
    const register = vi.fn();
    const { agent } = agentOver([
      { provide: ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR, useValue: register },
    ]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0]).toBe(agent);
    expect(registered.registerPolicy).not.toHaveBeenCalled();
  });

  it('builds the agent whatever the host does', () => {
    ɵsetAgentDevelopmentHost({
      createRuntime: () => {
        throw new Error('host failed');
      },
      registerPolicy: () => {
        throw new Error('host failed');
      },
    });
    const { agent } = agentOver();
    expect(agent.status()).toBe('idle');
    expect(() => agent.switchThread('next')).not.toThrow();
  });
});
