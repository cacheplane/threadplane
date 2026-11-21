import type { RunAgentInput } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';

interface Held {
  readonly input: RunAgentInput;
  send(...events: unknown[]): void;
  end(): void;
}
/** A fetch whose responses stay open until the test writes to them. */
function held() {
  const requests: Held[] = [];
  const waiting = new Map<number, (request: Held) => void>();
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as RunAgentInput;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const request: Held = {
      input,
      send: (...events) => {
        for (const event of events)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
          );
      },
      end: () => controller.close(),
    };
    requests.push(request);
    waiting.get(requests.length - 1)?.(request);
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    requests,
    next: (index: number) =>
      requests[index]
        ? Promise.resolve(requests[index])
        : new Promise<Held>((resolve) => waiting.set(index, resolve)),
  };
}
const started = (input: RunAgentInput) => ({
  type: 'RUN_STARTED',
  threadId: input.threadId,
  runId: input.runId,
});
const finished = (input: RunAgentInput) => ({
  type: 'RUN_FINISHED',
  threadId: input.threadId,
  runId: input.runId,
});
const calling = (input: RunAgentInput, id = 'c') => ({
  type: 'MESSAGES_SNAPSHOT',
  messages: [
    ...input.messages,
    {
      id: `a-${id}`,
      role: 'assistant',
      toolCalls: [
        {
          id,
          type: 'function',
          function: { name: 'f', arguments: '{"value":1}' },
        },
      ],
    },
  ],
});
function owner(handler = vi.fn(async (args: { value: number }) => args.value + 1)) {
  const wire = held();
  const session = createSession(
    { threadId: 't', url: 'unused', fetch: wire.fetch },
    { f: { description: 'f', parameters: {}, handler } }
  );
  return { wire, session, handler };
}
/** Runs one tool round trip and its answer, leaving the session idle. */
async function answered(fixture: ReturnType<typeof owner>, at = 0) {
  const done = fixture.session.submit('first');
  const first = await fixture.wire.next(at);
  first.send(started(first.input), calling(first.input), finished(first.input));
  const second = await fixture.wire.next(at + 1);
  second.send(
    started(second.input),
    { type: 'TEXT_MESSAGE_START', messageId: 'final', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'final', delta: 'Two' },
    { type: 'TEXT_MESSAGE_END', messageId: 'final' },
    finished(second.input)
  );
  expect(await done).toBe('success');
  return { first, second };
}

describe('retry with client tools', () => {
  it('sends a submission that ended in RUN_ERROR again and lifts its blocker', async () => {
    const { wire, session } = owner();
    const failed = session.submit('first');
    const first = await wire.next(0);
    first.send(started(first.input), { type: 'RUN_ERROR', message: 'Busy' });
    expect(await failed).toBe('error');
    const snapshot = session.getSnapshot();
    expect(snapshot.error).toMatchObject({
      message: 'Busy',
      retryable: true,
      recovery: 'retry',
    });
    expect(snapshot.clientTools.blocker?.reason).toBe('uncertain');
    // An ordinary submission still cannot bypass the failed one.
    expect(await session.submit('bypass')).toBe('error');

    const retried = session.retry?.();
    const second = await wire.next(1);
    expect(second.input.messages).toEqual(first.input.messages);
    expect(second.input.runId).not.toBe(first.input.runId);
    expect(session.getSnapshot().clientTools.blocker).toBeUndefined();
    second.send(started(second.input), finished(second.input));
    expect(await retried).toBe('success');
    expect(session.getSnapshot()).toMatchObject({ status: 'idle' });
    expect(await session.retry?.()).toBe('aborted');
    expect(wire.requests).toHaveLength(2);
    await session.dispose();
  });

  it('sends a failed continuation again without running the handler twice', async () => {
    const { wire, session, handler } = owner();
    const done = session.submit('first');
    const first = await wire.next(0);
    first.send(started(first.input), calling(first.input), finished(first.input));
    const second = await wire.next(1);
    second.send(
      started(second.input),
      { type: 'TEXT_MESSAGE_START', messageId: 'half', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'half', delta: 'Ha' },
      { type: 'RUN_ERROR', message: 'Busy' }
    );
    expect(await done).toBe('error');
    expect(session.getSnapshot().error?.recovery).toBe('retry');

    const retried = session.retry?.();
    const third = await wire.next(2);
    // The same history, with the local result and without the failed output.
    expect(third.input.messages).toEqual(second.input.messages);
    expect(
      session.getSnapshot().transcript.some((record) => record.id === 'half')
    ).toBe(false);
    third.send(started(third.input), finished(third.input));
    expect(await retried).toBe('success');
    expect(handler).toHaveBeenCalledOnce();
    expect(session.getSnapshot().clientTools.calls).toHaveLength(1);
    await session.dispose();
  });

  it('refuses a stream that ended without a terminal and keeps the blocker', async () => {
    const { wire, session } = owner();
    const failed = session.submit('first');
    const first = await wire.next(0);
    first.send(started(first.input));
    first.end();
    expect(await failed).toBe('interrupted');
    expect(session.getSnapshot().error).toMatchObject({
      retryable: false,
      recovery: 'none',
    });
    await expect(session.retry?.()).rejects.toThrow(/cannot be retried/);
    expect(session.getSnapshot().clientTools.blocker?.reason).toBe('uncertain');
    expect(wire.requests).toHaveLength(1);
    await session.dispose();
  });

  it('does not offer retry for a failed answer to a decision', async () => {
    const { wire, session } = owner();
    const paused = session.submit('first');
    const first = await wire.next(0);
    first.send(started(first.input), {
      ...finished(first.input),
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'i', reason: 'approval' }],
      },
    });
    expect(await paused).toBe('paused');
    const answered = session.resume([{ interruptId: 'i', status: 'resolved' }]);
    const second = await wire.next(1);
    second.send(started(second.input), { type: 'RUN_ERROR', message: 'Busy' });
    expect(await answered).toBe('error');
    expect(session.getSnapshot().error?.recovery).toBe('none');
    await expect(session.retry?.()).rejects.toThrow(/cannot be retried/);
    await session.dispose();
  });
});

describe('regenerate with client tools', () => {
  it('drops the answer with its client-tool calls and runs the handler again', async () => {
    const fixture = owner();
    const { wire, session, handler } = fixture;
    const { first } = await answered(fixture);
    expect(session.getSnapshot().clientTools.calls).toHaveLength(1);

    const regenerated = session.regenerate?.('final');
    const third = await wire.next(2);
    expect(third.input.messages).toEqual(first.input.messages);
    expect(session.getSnapshot().clientTools.calls).toEqual([]);
    expect(session.getSnapshot().transcript).toHaveLength(1);
    // The new answer may reuse the dropped call's identifier.
    third.send(started(third.input), calling(third.input), finished(third.input));
    const fourth = await wire.next(3);
    expect(fourth.input.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c',
      content: '2',
    });
    fourth.send(started(fourth.input), finished(fourth.input));
    expect(await regenerated).toBe('success');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().clientTools.blocker).toBeUndefined();
    await session.dispose();
  });

  it('keeps the calls of the turns before the regenerated one', async () => {
    const fixture = owner();
    const { wire, session } = fixture;
    await answered(fixture);
    const again = session.submit('second');
    const third = await wire.next(2);
    third.send(
      started(third.input),
      { type: 'TEXT_MESSAGE_START', messageId: 'later', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'later', delta: 'More' },
      { type: 'TEXT_MESSAGE_END', messageId: 'later' },
      finished(third.input)
    );
    expect(await again).toBe('success');

    const regenerated = session.regenerate?.('later');
    const fourth = await wire.next(3);
    expect(fourth.input.messages).toEqual(third.input.messages);
    expect(session.getSnapshot().clientTools.calls).toHaveLength(1);
    fourth.send(started(fourth.input), finished(fourth.input));
    expect(await regenerated).toBe('success');
    await session.dispose();
  });

  it('rejects without sending for a wrong id, an active run, a blocker and after disposal', async () => {
    const fixture = owner();
    const { wire, session } = fixture;
    await answered(fixture);
    await expect(session.regenerate?.('missing')).rejects.toThrow(
      'Regenerate needs the id of an assistant message.'
    );
    const failed = session.submit('second');
    const third = await wire.next(2);
    await expect(session.regenerate?.('final')).rejects.toThrow(
      'Cannot regenerate while a response is running.'
    );
    third.send(started(third.input));
    third.end();
    expect(await failed).toBe('interrupted');
    await expect(session.regenerate?.('final')).rejects.toThrow(
      'Cannot regenerate while client tool calls are unresolved.'
    );
    expect(wire.requests).toHaveLength(3);
    await session.dispose();
    await expect(session.regenerate?.('final')).rejects.toThrow(
      'The session is disposed.'
    );
  });

  it('regenerates after a backend RUN_ERROR, and retry repeats a failed regenerate', async () => {
    const fixture = owner();
    const { wire, session } = fixture;
    const { first } = await answered(fixture);
    const failed = session.submit('second');
    const third = await wire.next(2);
    third.send(started(third.input), { type: 'RUN_ERROR', message: 'Busy' });
    expect(await failed).toBe('error');

    const regenerated = session.regenerate?.('final');
    const fourth = await wire.next(3);
    expect(fourth.input.messages).toEqual(first.input.messages);
    fourth.send(started(fourth.input), { type: 'RUN_ERROR', message: 'Busy' });
    expect(await regenerated).toBe('error');
    const retried = session.retry?.();
    const fifth = await wire.next(4);
    expect(fifth.input.messages).toEqual(first.input.messages);
    fifth.send(started(fifth.input), finished(fifth.input));
    expect(await retried).toBe('success');
    await session.dispose();
  });
});
