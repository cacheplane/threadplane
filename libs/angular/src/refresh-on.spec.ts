import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  createThreadDirectoryView,
  refreshOnRunEnd,
  refreshOnTransition,
} from './public-api';
import { scriptedDirectory } from './testing/scripted-directory';
import {
  scriptedSession,
  type ScriptedControl,
  type ScriptedSession,
} from './testing/scripted-session';

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

function scripted() {
  const sessions: ScriptedControl[] = [];
  const injector = context();
  const agent = runInInjectionContext(injector, () =>
    createAgent<ScriptedSession>({
      createSession(sessionContext) {
        const { session, control } = scriptedSession(sessionContext);
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

describe('refreshOnRunEnd', () => {
  it('calls the function each time the agent leaves running, however the run ended', () => {
    const { agent, current, injector } = scripted();
    const fn = vi.fn();
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();

    current.publish({ status: 'running' });
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);

    current.publish({ status: 'running' });
    TestBed.tick();
    current.publish({ status: 'error' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(2);

    // Leaving a state that is not running is not the end of a run.
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not call the function for an agent that was never running', () => {
    const { agent, current, injector } = scripted();
    const fn = vi.fn();
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    current.publish({ messages: ['Hi'] });
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('sees the end of a run that was already under way when it was registered', () => {
    const { agent, current, injector } = scripted();
    current.publish({ status: 'running' });
    const fn = vi.fn();
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    TestBed.tick();
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps following the agent across a thread switch', () => {
    const { agent, sessions, injector } = scripted();
    const fn = vi.fn();
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    TestBed.tick();
    agent.switchThread('next');
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();
    sessions[1].publish({ status: 'running' });
    TestBed.tick();
    sessions[1].publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats a switch away from a running thread as the end of that run', () => {
    const { agent, current, injector } = scripted();
    const fn = vi.fn();
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    current.publish({ status: 'running' });
    TestBed.tick();
    agent.switchThread('next');
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refreshes a thread directory view passed in place of a function', () => {
    const { agent, current, injector } = scripted();
    const { directory, control } = scriptedDirectory();
    runInInjectionContext(injector, () => {
      const threads = createThreadDirectoryView({
        createDirectory: () => directory,
      });
      refreshOnRunEnd(agent, threads);
    });
    current.publish({ status: 'running' });
    TestBed.tick();
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(control.calls.map((call) => call[0])).toEqual(['refresh']);
  });

  it('swallows a rejected refresh', async () => {
    const { agent, current, injector } = scripted();
    const fn = vi.fn(() => Promise.reject(new Error('offline')));
    runInInjectionContext(injector, () => refreshOnRunEnd(agent, fn));
    current.publish({ status: 'running' });
    TestBed.tick();
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
    // An unhandled rejection would fail this run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('stops with its injection context', () => {
    const { agent, current } = scripted();
    const own = context();
    const fn = vi.fn();
    runInInjectionContext(own, () => refreshOnRunEnd(agent, fn));
    current.publish({ status: 'running' });
    TestBed.tick();
    own.destroy();
    current.publish({ status: 'idle' });
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('requires an injection context', () => {
    const { agent } = scripted();
    expect(() => refreshOnRunEnd(agent, () => undefined)).toThrow();
  });
});

describe('refreshOnTransition', () => {
  it('calls the function when the watched value goes from active to inactive', () => {
    const phase = signal<'idle' | 'syncing' | 'saving'>('idle');
    const fn = vi.fn();
    runInInjectionContext(context(), () =>
      refreshOnTransition(phase, (value) => value !== 'idle', fn)
    );
    TestBed.tick();
    phase.set('syncing');
    TestBed.tick();
    // Active to active is not a transition out.
    phase.set('saving');
    TestBed.tick();
    expect(fn).not.toHaveBeenCalled();
    phase.set('idle');
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not track what the function reads', () => {
    const active = signal(true);
    const other = signal(0);
    const fn = vi.fn(() => void other());
    runInInjectionContext(context(), () =>
      refreshOnTransition(active, (value) => value, fn)
    );
    TestBed.tick();
    active.set(false);
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
    other.set(1);
    TestBed.tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
