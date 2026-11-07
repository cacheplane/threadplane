import { describe, expect, it, vi } from 'vitest';
import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
} from '@threadplane/core';
import { createStreamingApplication } from './application';
import { createStreamingInspection } from './inspection';
import type { InspectionFrame } from './inspection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const creation = deferred<string>();
  const run = deferred<CompleteOutcome>();
  const snapshot: AgentSnapshot = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
  });
  const release = vi.fn();
  const session: AgentSession = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => release),
    submit: vi.fn(() => run.promise),
    stop: vi.fn(async () => {
      run.resolve('aborted');
    }),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn((signal: AbortSignal) => {
    void signal;
    return creation.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    void id;
    return session;
  });
  const application = createStreamingApplication({
    createThread,
    sessionFactory,
  });
  return {
    application,
    creation,
    run,
    session,
    release,
    createThread,
    sessionFactory,
  };
}

describe('streaming cockpit application admission', () => {
  it('records real lifecycle snapshots and exactly one delegated submit, then fences reset and disposal', async () => {
    const first = setup();
    const frames: InspectionFrame[] = [];
    const subscribe = vi.spyOn(first.application, 'subscribe');
    const inspection = createStreamingInspection((frame) => frames.push(frame));
    inspection.attach(first.application);
    expect(frames.at(-1)?.state).toEqual({
      creation: 'idle',
      busy: false,
      canSubmit: true,
      outcome: null,
      hasFailure: false,
    });
    const pending = inspection.submit(first.application, 'Hello');
    expect(frames.at(-1)?.state?.creation).toBe('pending');
    expect(frames.at(-1)?.calls).toHaveLength(1);
    expect(frames.at(-1)?.calls[0].status).toBe('pending');
    first.creation.resolve('thread');
    await Promise.resolve();
    expect(first.session.submit).toHaveBeenCalledTimes(1);
    first.session.getSnapshot = () => ({
      status: 'running',
      toolCalls: [],
      messages: [
        {
          id: 'answer',
          role: 'assistant',
          content: 'An actual streamed answer',
          reasoning: 'private reasoning',
          delivery: { phase: 'streaming', generation: 'turn' },
        },
      ],
    });
    vi.mocked(first.session.subscribe).mock.calls[0][0]();
    expect(frames.at(-1)?.messages).toEqual([
      { id: 'answer', role: 'assistant', text: 'An actual streamed answer' },
    ]);
    expect(JSON.stringify(frames)).not.toContain('private reasoning');
    first.run.resolve('success');
    await pending;
    expect(frames.at(-1)?.calls[0].status).toBe('settled');
    expect(frames.at(-1)?.state?.outcome).toBe('success');
    inspection.reset();
    const second = setup();
    inspection.attach(second.application);
    expect(frames.at(-1)?.calls).toEqual([]);
    const count = frames.length;
    subscribe.mock.calls[0][0]();
    await first.application.submit('old conversation');
    expect(frames).toHaveLength(count);
    inspection.dispose();
    await second.application.stop();
    expect(frames).toHaveLength(count);
    await first.application.dispose();
    await second.application.dispose();
  });

  it('preserves submit rejection and ignores settlement from an old conversation', async () => {
    const first = setup();
    const frames: InspectionFrame[] = [];
    const inspection = createStreamingInspection((frame) => frames.push(frame));
    const completion = deferred<void>();
    const application = {
      ...first.application,
      submit: vi.fn(() => completion.promise),
    };
    inspection.attach(application);
    const submitted = inspection.submit(application, 'Hello');
    const failure = new Error('private detail');
    completion.reject(failure);
    await expect(submitted).rejects.toBe(failure);
    expect(application.submit).toHaveBeenCalledExactlyOnceWith('Hello');
    expect(frames.at(-1)?.calls[0].status).toBe('rejected');
    expect(JSON.stringify(frames)).not.toContain('private detail');
    const pending = inspection.submit(first.application, 'late');
    inspection.reset();
    const count = frames.length;
    first.creation.reject(failure);
    await pending;
    expect(frames).toHaveLength(count);
    inspection.dispose();
    await first.application.dispose();
  });
  it('creates once lazily and sends only after confirmed creation', async () => {
    const {
      application,
      creation,
      run,
      session,
      createThread,
      sessionFactory,
    } = setup();
    expect(createThread).not.toHaveBeenCalled();
    const first = application.submit('First');
    await application.submit('Duplicate');
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(session.submit).not.toHaveBeenCalled();
    creation.resolve('confirmed-thread');
    await Promise.resolve();
    expect(sessionFactory).toHaveBeenCalledWith('confirmed-thread');
    expect(session.submit).toHaveBeenCalledWith('First', expect.any(Object));
    run.resolve('success');
    await first;
    await application.submit('Second');
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(session.submit).toHaveBeenCalledTimes(2);
  });

  it('does not replay unconfirmed creation or expose its raw failure', async () => {
    const { application, creation, createThread, sessionFactory } = setup();
    const first = application.submit('First');
    creation.reject(new Error('PRIVATE credential response'));
    await first;
    await application.submit('Retry');
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(application.getSnapshot().creation).toBe('unconfirmed');
    expect(JSON.stringify(application.getSnapshot())).not.toContain('PRIVATE');
  });

  it('fences late creation after Stop and never sends the original message', async () => {
    const { application, creation, createThread, sessionFactory } = setup();
    const first = application.submit('First');
    await application.stop();
    expect(createThread.mock.calls[0][0].aborted).toBe(true);
    creation.resolve('late-thread');
    await first;
    await application.submit('Retry');
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(application.getSnapshot().creation).toBe('unconfirmed');
  });

  it('disposes without late publication or session installation', async () => {
    const { application, creation, sessionFactory } = setup();
    const notify = vi.fn();
    application.subscribe(notify);
    const first = application.submit('First');
    await application.dispose();
    const count = notify.mock.calls.length;
    creation.resolve('late-thread');
    await first;
    await application.submit('After disposal');
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(count);
  });

  it('stops the admitted run and releases the owned session exactly once', async () => {
    const { application, creation, session, release } = setup();
    const first = application.submit('First');
    creation.resolve('thread');
    await Promise.resolve();
    await application.stop();
    await first;
    expect(session.stop).toHaveBeenCalledTimes(1);
    await application.dispose();
    await application.dispose();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
