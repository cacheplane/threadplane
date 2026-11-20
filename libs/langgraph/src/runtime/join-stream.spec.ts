import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const answer = (id: string, content: string, sseId?: string): StreamEvent => ({
  type: 'values',
  data: { messages: [{ type: 'ai', id, content }] },
  ...(sseId ? { sseId } : {}),
});

function fixture(extra: Partial<AgentTransport> = {}, threadId: string | null = 'thread') {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield answer('first', 'One');
  });
  const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
    async function* () {
      yield answer('joined', 'From the other run');
    }
  );
  const session = createSession({
    assistantId: 'agent',
    threadId,
    transport: {
      stream,
      joinStream,
      createThread: async () => 'created',
      ...extra,
    },
  });
  sessions.push(session);
  return { session, stream, joinStream };
}

describe('joining a run by id', () => {
  it('projects the run from its first event without adding a user message', async () => {
    const { session, stream, joinStream } = fixture();
    await session.submit('Hi');
    expect(await session.joinStream('run-2')).toBe('success');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(joinStream.mock.calls[0].slice(0, 3)).toEqual([
      'thread',
      'run-2',
      undefined,
    ]);
    expect(
      session.getSnapshot().messages.map((message) => message.content)
    ).toEqual(['Hi', 'One', 'From the other run']);
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('continues after a given event id', async () => {
    const { session, joinStream } = fixture();
    expect(await session.joinStream('run-2', 'event-7')).toBe('success');
    expect(joinStream.mock.calls[0][2]).toBe('event-7');
  });

  it('replaces an active run, as a submit does', async () => {
    const active = controlledTransport<StreamEvent>();
    const { session } = fixture({ stream: () => active.stream });
    const first = session.submit('Hi');
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('running'));
    const joined = session.joinStream('run-2');
    expect(await first).toBe('interrupted');
    expect(await joined).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.id).toBe('joined');
  });

  it('settles from the exact run status when the transport reports it', async () => {
    const { session } = fixture({ getRunStatus: async () => 'error' });
    expect(await session.joinStream('run-2')).toBe('error');
    expect(session.getSnapshot().error?.kind).toBe('server');
  });

  it('stops with its signal', async () => {
    const joined = controlledTransport<StreamEvent>();
    const { session } = fixture({ joinStream: () => joined.stream });
    const controller = new AbortController();
    const run = session.joinStream('run-2', undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('running'));
    controller.abort();
    expect(await run).toBe('aborted');
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('rejects an invalid run id or a transport that cannot join, and does nothing without a thread', async () => {
    const { session, joinStream } = fixture();
    await expect(session.joinStream('../other')).rejects.toBeInstanceOf(
      TypeError
    );
    await expect(session.joinStream('run', 1 as never)).rejects.toBeInstanceOf(
      TypeError
    );
    expect(joinStream).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe('idle');
    const plain = fixture({ joinStream: undefined });
    await expect(plain.session.joinStream('run-2')).rejects.toThrow(
      'transport.joinStream'
    );
    const lazy = fixture({}, null);
    expect(await lazy.session.joinStream('run-2')).toBe('aborted');
    expect(lazy.joinStream).not.toHaveBeenCalled();
    await lazy.session.dispose();
    expect(await lazy.session.joinStream('run-2')).toBe('aborted');
  });
});
