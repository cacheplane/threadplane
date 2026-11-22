import {
  createEnvironmentInjector,
  EnvironmentInjector,
  isSignal,
  runInInjectionContext,
  type Signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CompleteOutcome } from '@threadplane/core';
import { createFakeAgentSession } from '@threadplane/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  withAgentOverrides,
  ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
  ɵagentConfig,
  ɵsetAgentDevelopmentHost,
  type AgentConfig,
} from './public-api';
import { ɵresetAgentDevelopmentHost } from './development-host';
import {
  scriptedSession,
  type ScriptedControl,
  type ScriptedOptions,
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
  ɵresetAgentDevelopmentHost();
  TestBed.resetTestingModule();
});

function context(
  providers: Parameters<typeof createEnvironmentInjector>[0] = []
) {
  const injector = createEnvironmentInjector(
    providers,
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}

/** An agent over scripted sessions, with every session it was given. */
function scripted(
  options: ScriptedOptions = {},
  providers: Parameters<typeof createEnvironmentInjector>[0] = []
) {
  const sessions: ScriptedControl[] = [];
  const config: AgentConfig<ScriptedSession> = {
    createSession: sync(function (sessionContext) {
      const { session, control } = scriptedSession(sessionContext, options);
      sessions.push(control);
      return session;
    }),
  };
  const agent = runInInjectionContext(context(providers), () =>
    createAgent<ScriptedSession>(config)
  );
  return {
    agent,
    config,
    sessions,
    get current() {
      return sessions[sessions.length - 1];
    },
  };
}

/** The agent as an untyped bag, to read names its type does not declare. */
const loose = (agent: object) =>
  agent as unknown as Record<string | symbol, unknown>;

describe('withAgentOverrides', () => {
  it('serves a field that is published after the agent was derived', () => {
    const fake = createFakeAgentSession();
    const agent = runInInjectionContext(context(), () =>
      createAgent({ createSession: sync(() => fake.session) })
    );
    // The premise: the snapshot holds no error when the copy is made.
    expect('error' in fake.session.getSnapshot()).toBe(false);
    const submit = vi.fn(() => Promise.resolve<CompleteOutcome>('aborted'));
    const derived = withAgentOverrides(agent, { submit });

    expect(isSignal(derived.error)).toBe(true);
    expect(derived.error()).toBeUndefined();
    expect(derived.inputBlocked()).toBeUndefined();

    fake.setError({ kind: 'server', message: 'Down', retryable: false });
    expect(derived.error()).toEqual(
      expect.objectContaining({ kind: 'server', message: 'Down' })
    );
    expect(derived.status()).toBe('error');
    // The same signal as the original's, read before or after publication.
    expect(derived.error).toBe(agent.error);
  });

  it('is what a spread is not: a spread copy never gains a later field', () => {
    const { agent, current } = scripted();
    const spread = { ...agent };
    const derived = withAgentOverrides(agent, {});
    expect('note' in spread).toBe(false);

    current.publish({ note: 'late' });
    expect((spread as { note?: Signal<unknown> }).note).toBeUndefined();
    expect(derived.note()).toBe('late');
  });

  it('reads a not-yet-present optional field as a signal of undefined', () => {
    const { agent } = scripted();
    const derived = withAgentOverrides(agent, {
      submit: () => Promise.resolve<CompleteOutcome>('aborted'),
    });
    const note = derived.note;
    expect(isSignal(note)).toBe(true);
    expect(note()).toBeUndefined();
    expect(() => derived.note()).not.toThrow();
    // An optional command the session lacks still reads as absent.
    expect(derived.regenerate).toBeUndefined();
    expect('regenerate' in derived).toBe(false);
    // And a name tools probe is still not answered with a signal.
    expect(loose(derived)['then']).toBeUndefined();
    expect(loose(derived)[Symbol.iterator]).toBeUndefined();
  });

  it('uses the overridden submit and leaves the original untouched', async () => {
    const { agent, current } = scripted();
    const original = agent.submit;
    let locked = true;
    const derived = withAgentOverrides(agent, {
      submit: (input, options) =>
        locked
          ? Promise.resolve<CompleteOutcome>('aborted')
          : agent.submit(input, options),
    });

    await expect(derived.submit('refused')).resolves.toBe('aborted');
    expect(current.calls).toEqual([]);
    expect(derived.messages()).toEqual([]);

    locked = false;
    await expect(derived.submit('sent')).resolves.toBe('success');
    expect(current.calls).toEqual([['submit', 'sent', undefined]]);
    expect(derived.messages()).toEqual(['sent']);

    expect(agent.submit).toBe(original);
    expect(derived.submit).not.toBe(original);
    await agent.submit('direct');
    expect(current.calls.map((call) => call[1])).toEqual(['sent', 'direct']);
  });

  it('keeps signals and other commands the same references', () => {
    const { agent } = scripted({ regenerate: true });
    const derived = withAgentOverrides(agent, {
      submit: () => Promise.resolve<CompleteOutcome>('aborted'),
    });
    expect(derived.status).toBe(agent.status);
    expect(derived.messages).toBe(agent.messages);
    expect(derived.note).toBe(agent.note);
    expect(derived.threadId).toBe(agent.threadId);
    expect(derived.isThreadLoading).toBe(agent.isThreadLoading);
    expect(derived.sessionEpoch).toBe(agent.sessionEpoch);
    expect(derived.customEvents).toBe(agent.customEvents);
    expect(derived.lifecycle).toBe(agent.lifecycle);
    expect(derived.stop).toBe(agent.stop);
    expect(derived.describe).toBe(agent.describe);
    expect(derived.regenerate).toBe(agent.regenerate);
    expect(derived.switchThread).toBe(agent.switchThread);
    expect(derived.onStop).toBe(agent.onStop);
    expect(derived.onCustomEvent).toBe(agent.onCustomEvent);
    expect(derived.label).toBe(agent.label);
    // Plumbing stays hidden.
    expect(loose(derived)['getSnapshot']).toBeUndefined();
    expect(loose(derived)['dispose']).toBeUndefined();
  });

  it('reflects a thread switch made on the original, and makes one itself', async () => {
    const { agent, sessions } = scripted();
    const submit = vi.fn((input: string) => agent.submit(`[${input}]`));
    const derived = withAgentOverrides(agent, { submit });
    const messages = derived.messages;

    await derived.submit('one');
    expect(messages()).toEqual(['[one]']);

    agent.switchThread('thread-b');
    expect(sessions).toHaveLength(2);
    expect(derived.threadId()).toBe('thread-b');
    expect(derived.sessionEpoch()).toBe(1);
    expect(derived.label).toBe('session:thread-b');
    expect(derived.messages).toBe(messages);
    expect(messages()).toEqual([]);

    // The override wraps the agent, so it reaches the new session.
    await derived.submit('two');
    expect(sessions[1].calls).toEqual([
      ['load'],
      ['submit', '[two]', undefined],
    ]);
    expect(sessions[0].calls).toHaveLength(1);

    derived.switchThread(null);
    expect(agent.threadId()).toBeNull();
    expect(agent.sessionEpoch()).toBe(2);
  });

  it('passes the original agent to an overrides function, once', async () => {
    const { agent, current } = scripted();
    const build = vi.fn((inner: typeof agent) => ({
      submit: (input: string) => inner.submit(input.toUpperCase()),
    }));
    const derived = withAgentOverrides(agent, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0]).toBe(agent);

    await derived.submit('hello');
    await derived.submit('again');
    expect(build).toHaveBeenCalledTimes(1);
    expect(current.calls.map((call) => call[1])).toEqual(['HELLO', 'AGAIN']);
  });

  it('reads the overrides once', async () => {
    const { agent, current } = scripted();
    const overrides: { submit?: typeof agent.submit } = {
      submit: () => Promise.resolve<CompleteOutcome>('aborted'),
    };
    const derived = withAgentOverrides(agent, overrides);
    delete overrides.submit;
    await expect(derived.submit('kept')).resolves.toBe('aborted');
    expect(current.calls).toEqual([]);
  });

  it('hides an optional member overridden with undefined', () => {
    const { agent } = scripted({ regenerate: true });
    const derived = withAgentOverrides(agent, { regenerate: undefined });
    expect(agent.regenerate).toBeTypeOf('function');
    expect(derived.regenerate).toBeUndefined();
    expect('regenerate' in derived).toBe(false);
    expect(Object.keys(derived)).not.toContain('regenerate');
    expect(Object.keys(agent)).toContain('regenerate');
  });

  it('enumerates like the original, with the overrides in place', () => {
    const { agent, current } = scripted();
    const submit = () => Promise.resolve<CompleteOutcome>('aborted');
    const derived = withAgentOverrides(agent, { submit });
    expect(Object.keys(derived).sort()).toEqual(Object.keys(agent).sort());
    expect('submit' in derived).toBe(true);
    expect('note' in derived).toBe(false);
    expect({ ...derived }.submit).toBe(submit);
    expect(
      Object.getOwnPropertyDescriptor(derived, 'submit')?.value
    ).toBe(submit);
    expect(Object.getOwnPropertyDescriptor(derived, 'status')?.value).toBe(
      agent.status
    );

    current.publish({ note: 'now' });
    expect('note' in derived).toBe(true);
    expect(Object.keys(derived)).toContain('note');
  });

  it('cannot be written to', () => {
    const { agent } = scripted();
    const derived = withAgentOverrides(agent, {});
    expect(Reflect.set(derived, 'submit', () => undefined)).toBe(false);
    expect(Reflect.deleteProperty(derived, 'submit')).toBe(false);
    expect(
      Reflect.defineProperty(derived, 'extra', { value: 1, configurable: true })
    ).toBe(false);
    expect(derived.submit).toBe(agent.submit);
  });

  it('can be derived from again', async () => {
    const { agent, config, current } = scripted();
    const first = withAgentOverrides(agent, (inner) => ({
      submit: (input: string) => inner.submit(`a:${input}`),
    }));
    const stop = vi.fn(() => Promise.resolve());
    const second = withAgentOverrides(first, (inner) => ({
      submit: (input: string) => inner.submit(`b:${input}`),
      stop,
    }));

    await second.submit('x');
    expect(current.calls.map((call) => call[1])).toEqual(['a:b:x']);
    expect(second.stop).toBe(stop);
    expect(first.stop).toBe(agent.stop);
    expect(ɵagentConfig(second)).toBe(config);

    current.publish({ note: 'through both' });
    expect(second.note()).toBe('through both');
  });

  it("resolves to the original agent's config", () => {
    const { agent, config } = scripted();
    const derived = withAgentOverrides(agent, {});
    expect(ɵagentConfig(agent)).toBe(config);
    expect(ɵagentConfig(derived)).toBe(config);
  });

  it('registers the derived agent with the provided registrar, under the same policy', () => {
    const register = vi.fn();
    const { agent } = scripted({}, [
      { provide: ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR, useValue: register },
    ]);
    expect(register).toHaveBeenCalledTimes(1);
    const derived = withAgentOverrides(agent, {});
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0][0]).toBe(agent);
    expect(register.mock.calls[1][0]).toBe(derived);
    expect(register.mock.calls[1][1]).toBe(register.mock.calls[0][1]);
  });

  it('registers the derived agent with the page host, now or when one loads', () => {
    const policies = new Map<object, () => boolean>();
    const { agent } = scripted();
    const early = withAgentOverrides(agent, {});
    expect(policies.size).toBe(0);

    ɵsetAgentDevelopmentHost({
      createRuntime: () => ({
        touch: () => undefined,
        milestone: () => undefined,
        dispose: () => undefined,
      }),
      registerPolicy: (target, policy) => policies.set(target, policy),
    });
    const late = withAgentOverrides(agent, {});

    expect(policies.get(early)).toBe(policies.get(agent));
    expect(policies.get(late)).toBe(policies.get(agent));
    expect(policies.get(agent)).toBeTypeOf('function');
    // A scripted session has no isDevelopmentRuntimeEnabled.
    expect(policies.get(late)?.()).toBe(false);
  });

  it('is unaffected by a registrar that throws', () => {
    let calls = 0;
    const { agent } = scripted({}, [
      {
        provide: ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
        useValue: () => {
          calls++;
          throw new Error('registrar failed');
        },
      },
    ]);
    const derived = withAgentOverrides(agent, {});
    expect(calls).toBe(2);
    expect(derived.status()).toBe('idle');
  });

  it('derives from a hand-built agent that createAgent did not build', () => {
    const plain = { label: 'plain', submit: (input: string) => input.length };
    const derived = withAgentOverrides(plain, { submit: () => -1 });
    expect(derived.submit('abc')).toBe(-1);
    expect(derived.label).toBe('plain');
    expect(plain.submit('abc')).toBe(3);
    expect(ɵagentConfig(derived)).toBeUndefined();
    expect(Object.keys(derived).sort()).toEqual(['label', 'submit']);
  });

  it('rejects overrides that are not an object', () => {
    const { agent } = scripted();
    expect(() => withAgentOverrides(agent, null as never)).toThrow(TypeError);
    expect(() => withAgentOverrides(agent, (() => 'no') as never)).toThrow(
      TypeError
    );
  });
});
