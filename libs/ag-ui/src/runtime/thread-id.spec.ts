import { describe, expect, it, vi } from 'vitest';
import type { RunAgentInput } from '@ag-ui/client';
import { createSession } from './create-session';
import { FakeAgent } from './fake-agent';

const url = 'https://agent.invalid/run';

function serving() {
  const threads: string[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as RunAgentInput;
    threads.push(input.threadId);
    const ids = { threadId: input.threadId, runId: input.runId };
    return new Response(
      [
        { type: 'RUN_STARTED', ...ids },
        { type: 'RUN_FINISHED', ...ids },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  };
  return { threads, fetch: fetch as typeof globalThis.fetch };
}

describe('the thread a session names itself', () => {
  it('reads a null threadId as absent: the session generates one and reports it once', async () => {
    const server = serving();
    const onThreadId = vi.fn();
    const session = createSession({
      url,
      fetch: server.fetch,
      threadId: null,
      onThreadId,
    });
    expect(session.threadId).toEqual(expect.any(String));
    expect(session.threadId).not.toBe('');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith(session.threadId);

    await expect(session.submit('Hello')).resolves.toBe('success');
    await expect(session.submit('Again')).resolves.toBe('success');
    expect(server.threads).toEqual([session.threadId, session.threadId]);
    // Requests do not report it again.
    expect(onThreadId).toHaveBeenCalledTimes(1);
    await session.dispose();
    expect(onThreadId).toHaveBeenCalledTimes(1);
  });

  it('reports a generated id when the option is absent, and a different one for each session', () => {
    const reported: string[] = [];
    const onThreadId = (id: string) => void reported.push(id);
    const first = createSession({ url, onThreadId });
    const second = createSession({ url, threadId: undefined, onThreadId });
    expect(reported).toEqual([first.threadId, second.threadId]);
    expect(first.threadId).not.toBe(second.threadId);
  });

  it('never reports a threadId the caller gave', async () => {
    const server = serving();
    const onThreadId = vi.fn();
    const session = createSession({
      url,
      fetch: server.fetch,
      threadId: 'chosen',
      onThreadId,
    });
    expect(session.threadId).toBe('chosen');
    await expect(session.submit('Hello')).resolves.toBe('success');
    expect(server.threads).toEqual(['chosen']);
    expect(onThreadId).not.toHaveBeenCalled();
  });

  it('reports the id it takes from a handed agent, and not when the option names the thread', () => {
    const agent = new FakeAgent({ delayMs: 0 });
    agent.threadId = 'from-agent';
    const onThreadId = vi.fn();
    expect(createSession({ agent, threadId: null, onThreadId }).threadId).toBe(
      'from-agent'
    );
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('from-agent');

    onThreadId.mockClear();
    expect(
      createSession({ agent, threadId: 'chosen', onThreadId }).threadId
    ).toBe('chosen');
    expect(onThreadId).not.toHaveBeenCalled();
  });

  it('reports for a session created with client tools', () => {
    const onThreadId = vi.fn();
    const session = createSession({ url, threadId: null, onThreadId }, {});
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith(session.threadId);
  });

  it('is unaffected by a throwing callback', async () => {
    const server = serving();
    const session = createSession({
      url,
      fetch: server.fetch,
      onThreadId: () => {
        throw new Error('callback failed');
      },
    });
    expect(session.threadId).toEqual(expect.any(String));
    await expect(session.submit('Hello')).resolves.toBe('success');
    expect(server.threads).toEqual([session.threadId]);
    expect(session.getSnapshot().error).toBeUndefined();
  });

  it('reports nothing when creation fails', () => {
    const onThreadId = vi.fn();
    expect(() => createSession({ url, threadId: '', onThreadId })).toThrow(
      'A nonempty threadId is required'
    );
    expect(() =>
      createSession({
        url,
        threadId: null,
        onThreadId,
        persistence: {} as never,
      })
    ).toThrow('Persistence requires a stable threadId');
    expect(() =>
      createSession({ url, onThreadId: 'no' as never })
    ).toThrow('onThreadId must be a function.');
    expect(onThreadId).not.toHaveBeenCalled();
  });

  it('skips replay for a null threadId, as for an absent one', async () => {
    const replay = vi.fn(async () => []);
    const session = createSession({ url, threadId: null, replay });
    await session.ready;
    expect(replay).not.toHaveBeenCalled();
  });

  it('accepts and ignores clientOptions', () => {
    const session = createSession({
      url,
      threadId: 'chosen',
      clientOptions: { apiUrl: 'https://ignored.invalid' },
    });
    expect(session.threadId).toBe('chosen');
  });
});
