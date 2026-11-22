import {
  createEnvironmentInjector,
  effect,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
  type AgentSessionContext,
} from './public-api';
import {
  scriptedSession,
  type ScriptedControl,
  type ScriptedSession,
} from './testing/scripted-session';

/**
 * These specs test the agent apart from session timing: the agent adopts a
 * session a factory returns as is, as the in-package testing provider binds.
 * Applications pass an async factory; agent.async-session.spec covers that.
 */
const sync = <A extends unknown[], T>(factory: (...args: A) => T) =>
  factory as unknown as (...args: A) => Promise<T>;

const injectors: EnvironmentInjector[] = [];
afterEach(() => {
  for (const injector of injectors.splice(0))
    if (!injector.destroyed) injector.destroy();
  TestBed.resetTestingModule();
});

type Extra = (context: AgentSessionContext) => object;

/** An agent over scripted sessions, each optionally given extra members. */
function scripted(
  providers: Parameters<typeof createEnvironmentInjector>[0] = [],
  extra: Extra = () => ({})
) {
  const sessions: ScriptedControl[] = [];
  const injector = createEnvironmentInjector(
    providers,
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  const agent = runInInjectionContext(injector, () =>
    createAgent<ScriptedSession>({
      createSession: sync(function (context) {
        const { session, control } = scriptedSession(context);
        sessions.push(control);
        return Object.assign(session, extra(context));
      }),
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

describe('Agent stop listeners', () => {
  it('calls each listener when stop is called, before the session is told', async () => {
    const { agent, current } = scripted();
    const seen: number[] = [];
    agent.onStop(() => seen.push(current.stops));
    agent.onStop(() => seen.push(-1));
    await agent.stop();
    // The session had not been stopped yet when the listeners ran.
    expect(seen).toEqual([0, -1]);
    expect(current.stops).toBe(1);
    await agent.stop();
    expect(seen).toEqual([0, -1, 1, -1]);
  });

  it('reaches a listener through a stop reference taken earlier', async () => {
    const { agent, current } = scripted();
    const stop = agent.stop;
    const listener = vi.fn();
    agent.onStop(listener);
    await stop();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(current.stops).toBe(1);
  });

  it('stops calling a released listener, and releases only that one', async () => {
    const { agent } = scripted();
    const first = vi.fn();
    const second = vi.fn();
    const release = agent.onStop(first);
    agent.onStop(second);
    // The same function registered twice is two registrations.
    const again = agent.onStop(second);
    release();
    release();
    await agent.stop();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
    again();
    await agent.stop();
    expect(second).toHaveBeenCalledTimes(3);
  });

  it('still stops the session, and calls the rest, when a listener throws', async () => {
    const { agent, current } = scripted();
    const after = vi.fn();
    agent.onStop(() => {
      throw new Error('listener failed');
    });
    agent.onStop(after);
    await expect(agent.stop()).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(current.stops).toBe(1);
  });

  it('keeps a listener across a thread switch, which itself notifies no one', async () => {
    const { agent, sessions } = scripted();
    const listener = vi.fn();
    agent.onStop(listener);
    agent.switchThread('next');
    // The switch stopped the old session without a stop command.
    expect(sessions[0].stops).toBe(1);
    expect(listener).not.toHaveBeenCalled();
    await agent.stop();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sessions[1].stops).toBe(1);
  });

  it('does not track what a listener reads, and registers nothing once destroyed', async () => {
    const { agent, current, injector } = scripted();
    let runs = 0;
    agent.onStop(() => void agent.status());
    runInInjectionContext(injector, () =>
      effect(() => {
        runs++;
        void agent.stop();
      })
    );
    TestBed.tick();
    expect(runs).toBe(1);
    current.publish({ status: 'running' });
    TestBed.tick();
    expect(runs).toBe(1);

    injector.destroy();
    const late = vi.fn();
    const release = agent.onStop(late);
    expect(release).toBeTypeOf('function');
    release();
    expect(late).not.toHaveBeenCalled();
  });
});

describe('Agent session epoch', () => {
  it('starts at zero and counts each replacement of the session', () => {
    const { agent } = scripted();
    expect(agent.sessionEpoch()).toBe(0);
    agent.switchThread('a');
    expect(agent.sessionEpoch()).toBe(1);
    // A reload of the same thread is another session too.
    agent.switchThread('a');
    expect(agent.sessionEpoch()).toBe(2);
    agent.switchThread(null);
    expect(agent.sessionEpoch()).toBe(3);
  });

  it('does not move for publications or for a thread the session reports', () => {
    const { agent, current } = scripted();
    current.publish({ status: 'running', messages: ['Hi'] });
    current.context.onThreadId('created');
    expect(agent.threadId()).toBe('created');
    expect(agent.sessionEpoch()).toBe(0);
  });

  it('notifies a consumer once per switch, with the new session already current', () => {
    const { agent, injector } = scripted();
    const seen: [number, unknown][] = [];
    runInInjectionContext(injector, () =>
      effect(() => {
        seen.push([agent.sessionEpoch(), agent.label]);
      })
    );
    TestBed.tick();
    agent.switchThread('a');
    TestBed.tick();
    expect(seen).toEqual([
      [0, 'session:new'],
      [1, 'session:a'],
    ]);
  });

  it('stays where it is when the factory fails for the next thread', () => {
    const sessions: ScriptedControl[] = [];
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector)
    );
    injectors.push(injector);
    const agent = runInInjectionContext(injector, () =>
      createAgent<ScriptedSession>({
        createSession: sync(function (context) {
          if (context.threadId === 'broken') throw new Error('no session');
          const { session, control } = scriptedSession(context);
          sessions.push(control);
          return session;
        }),
      })
    );
    expect(() => agent.switchThread('broken')).toThrow('no session');
    expect(agent.sessionEpoch()).toBe(0);
  });
});

describe('Agent development runtime', () => {
  const registrar = () => {
    const policies = new Map<object, () => boolean>();
    const register = vi.fn((agent: object, policy: () => boolean) => {
      policies.set(agent, policy);
      return agent;
    });
    return {
      policies,
      register,
      provider: {
        provide: ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
        useValue: register,
      },
    };
  };

  it('registers the agent it returns, once, with the host registrar', () => {
    const host = registrar();
    const { agent } = scripted([host.provider]);
    expect(host.register).toHaveBeenCalledTimes(1);
    expect(host.register.mock.calls[0][0]).toBe(agent);
    agent.switchThread('next');
    expect(host.register).toHaveBeenCalledTimes(1);
  });

  it('answers the policy from the current session, across a thread switch', () => {
    const host = registrar();
    const { agent } = scripted([host.provider], (context) => ({
      isDevelopmentRuntimeEnabled: () => context.threadId !== 'off',
    }));
    const policy = host.policies.get(agent);
    expect(policy?.()).toBe(true);
    agent.switchThread('off');
    expect(policy?.()).toBe(false);
    agent.switchThread('on');
    expect(policy?.()).toBe(true);
  });

  it('is off for a session without the hook, or one that answers anything but true', () => {
    const bare = registrar();
    const without = scripted([bare.provider]);
    expect(bare.policies.get(without.agent)?.()).toBe(false);
    // The absent hook reads as an absent command, not as a snapshot field.
    expect(
      (without.agent as unknown as Record<string, unknown>)[
        'isDevelopmentRuntimeEnabled'
      ]
    ).toBeUndefined();

    const loose = registrar();
    const truthy = scripted([loose.provider], () => ({
      isDevelopmentRuntimeEnabled: () => 'yes',
    }));
    expect(loose.policies.get(truthy.agent)?.()).toBe(false);
  });

  it('is off once the agent is destroyed', () => {
    const host = registrar();
    const { agent, injector } = scripted([host.provider], () => ({
      isDevelopmentRuntimeEnabled: () => true,
    }));
    const policy = host.policies.get(agent);
    expect(policy?.()).toBe(true);
    injector.destroy();
    expect(policy?.()).toBe(false);
  });

  it('builds the agent with no registrar, and when the registrar throws', () => {
    expect(scripted().agent.status()).toBe('idle');
    const failing = scripted([
      {
        provide: ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
        useValue: () => {
          throw new Error('registry failed');
        },
      },
    ]);
    expect(failing.agent.status()).toBe('idle');
  });
});
