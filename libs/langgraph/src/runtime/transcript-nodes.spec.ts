import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { isTranscriptEvent } from './stream-projection';
import type { StreamEvent } from './transport.types';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const chunk = (id: string, content: string, node?: string): StreamEvent => ({
  type: 'messages',
  messages: [{ type: 'AIMessageChunk', id, content }],
  messageMetadata: node === undefined ? {} : { langgraph_node: node },
});

function run(
  events: readonly StreamEvent[],
  transcriptNodeNames?: readonly string[]
) {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transcriptNodeNames,
    transport: {
      async *stream() {
        yield* events;
      },
    },
  });
  sessions.push(session);
  return session;
}

describe('transcript node names', () => {
  it('keeps chunks from unlisted nodes out of the transcript', async () => {
    const session = run(
      [
        chunk('title', 'A title', 'title'),
        chunk('answer', 'Hello', 'agent'),
        {
          type: 'values',
          data: { messages: [{ type: 'ai', id: 'answer', content: 'Hello' }] },
        },
      ],
      ['agent']
    );
    expect(await session.submit('Hi')).toBe('success');
    expect(
      session
        .getSnapshot()
        .messages.filter((message) => message.role === 'assistant')
        .map((message) => [message.id, message.content])
    ).toEqual([['answer', 'Hello']]);
  });

  it('accepts every root node when no names are given', async () => {
    const session = run([
      chunk('title', 'A title', 'title'),
      chunk('answer', 'Hello', 'agent'),
      {
        type: 'values',
        data: {
          messages: [
            { type: 'ai', id: 'title', content: 'A title' },
            { type: 'ai', id: 'answer', content: 'Hello' },
          ],
        },
      },
    ]);
    expect(await session.submit('Hi')).toBe('success');
    expect(
      session
        .getSnapshot()
        .messages.filter((message) => message.role === 'assistant')
        .map((message) => message.id)
    ).toEqual(['title', 'answer']);
  });

  it('still shows a filtered message the graph saved to its state', async () => {
    const session = run(
      [
        chunk('title', 'A title', 'title'),
        {
          type: 'values',
          data: { messages: [{ type: 'ai', id: 'title', content: 'A title' }] },
        },
      ],
      ['agent']
    );
    expect(await session.submit('Hi')).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('A title');
  });

  it('never filters child graphs, unnamed chunks or full-state events', () => {
    const names = ['agent'];
    expect(isTranscriptEvent(chunk('a', 'x', 'title'), names)).toBe(false);
    expect(isTranscriptEvent(chunk('a', 'x', 'agent'), names)).toBe(true);
    expect(isTranscriptEvent(chunk('a', 'x'), names)).toBe(true);
    expect(isTranscriptEvent(chunk('a', 'x', 'title'), [])).toBe(true);
    expect(
      isTranscriptEvent(
        { ...chunk('a', 'x', 'title'), namespace: ['child:1'] },
        names
      )
    ).toBe(true);
    expect(
      isTranscriptEvent(
        { ...chunk('a', 'x', 'title'), type: 'messages|child:1' },
        names
      )
    ).toBe(true);
    expect(
      isTranscriptEvent(
        { type: 'values', data: {}, messageMetadata: { langgraph_node: 't' } },
        names
      )
    ).toBe(true);
  });

  it('copies the list, so a later change by the caller has no effect', async () => {
    const names = ['agent'];
    const session = run(
      [
        chunk('title', 'A title', 'title'),
        {
          type: 'values',
          data: { messages: [{ type: 'ai', id: 'answer', content: 'Hello' }] },
        },
      ],
      names
    );
    names.push('title');
    expect(await session.submit('Hi')).toBe('success');
    expect(
      session.getSnapshot().messages.some((message) => message.id === 'title')
    ).toBe(false);
  });
});
