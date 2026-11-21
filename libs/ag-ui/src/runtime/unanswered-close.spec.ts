import type { RunAgentInput } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The shared wording is compared with its LangGraph source.
import { RECOVERY_COPY } from '../../../langgraph/src/runtime/stream-projection';
import { INTERRUPTED_COPY, UNANSWERED_COPY } from './agent-session';
import { createSession } from './create-session';

type Reply = (input: RunAgentInput) => Response | Promise<Response>;
const sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
/** The stream closes cleanly, having produced no event at all. */
const silent: Reply = () => sse();
const started = (input: RunAgentInput) => ({
  type: 'RUN_STARTED',
  threadId: input.threadId,
  runId: input.runId,
});
const finished = (input: RunAgentInput, outcome?: unknown) => ({
  type: 'RUN_FINISHED',
  threadId: input.threadId,
  runId: input.runId,
  ...(outcome !== undefined && { outcome }),
});
const answer: Reply = (input) =>
  sse(
    started(input),
    { type: 'TEXT_MESSAGE_START', messageId: `m-${input.runId}`, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${input.runId}`, delta: 'Done' },
    { type: 'TEXT_MESSAGE_END', messageId: `m-${input.runId}` },
    finished(input)
  );
const pause: Reply = (input) =>
  sse(
    started(input),
    finished(input, {
      type: 'interrupt',
      interrupts: [{ id: 'approval', reason: 'Approve' }],
    })
  );
const calling: Reply = (input) =>
  sse(
    started(input),
    {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        ...input.messages,
        {
          id: 'a-call',
          role: 'assistant',
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'f', arguments: '{"value":1}' },
            },
          ],
        },
      ],
    },
    finished(input)
  );

/** A session whose responses the test supplies one request at a time. */
function scripted(replies: Reply[], tools = false) {
  const requests: RunAgentInput[] = [];
  const handler = vi.fn(async (args: { value: number }) => args.value + 1);
  const options = {
    threadId: 'thread',
    url: 'https://unanswered.invalid/run',
    fetch: async (_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as RunAgentInput;
      requests.push(input);
      const reply = replies[requests.length - 1];
      if (!reply) throw new Error('No reply was scripted for this request.');
      return reply(input);
    },
  };
  const session = tools
    ? createSession(options, {
        f: { description: 'f', parameters: {}, handler },
      })
    : createSession(options);
  return { session, requests, handler };
}
function retryOf<T>(session: { retry?(): Promise<T> }): Promise<T> {
  if (!session.retry) throw new Error('The session has no retry.');
  return session.retry();
}
const RETRY = {
  kind: 'interrupted',
  message: UNANSWERED_COPY,
  retryable: true,
  recovery: 'retry',
};
const UNCERTAIN = {
  kind: 'interrupted',
  message: INTERRUPTED_COPY.message,
  detail: INTERRUPTED_COPY.detail,
  retryable: false,
  recovery: 'none',
};

describe.each([
  ['without a handler map', false],
  ['with a handler map', true],
])('a stream that closed before any event, %s', (_label, tools) => {
  it('offers retry and sends the same request again', async () => {
    const { session, requests } = scripted([silent, answer], tools);
    try {
      expect(await session.submit('Plan a visit')).toBe('interrupted');
      const failed = session.getSnapshot();
      expect(failed.status).toBe('error');
      expect(failed.error).toEqual(RETRY);
      expect(failed.run?.terminal).toBeUndefined();
      expect(await retryOf(session)).toBe('success');
      expect(requests).toHaveLength(2);
      expect(requests[1].messages).toEqual(requests[0].messages);
      expect(requests[1].runId).not.toBe(requests[0].runId);
      const settled = session.getSnapshot();
      expect(settled.error).toBeUndefined();
      expect(settled.inputBlocked).toBeUndefined();
      expect(settled.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
      ]);
    } finally {
      await session.dispose();
    }
  });

  it('offers retry again when the retry closes the same way', async () => {
    const { session, requests } = scripted([silent, silent, answer], tools);
    try {
      expect(await session.submit('Go')).toBe('interrupted');
      expect(await retryOf(session)).toBe('interrupted');
      expect(session.getSnapshot().error).toEqual(RETRY);
      expect(await retryOf(session)).toBe('success');
      expect(requests).toHaveLength(3);
      expect(requests[2].messages).toEqual(requests[0].messages);
    } finally {
      await session.dispose();
    }
  });

  it('offers retry for a regenerate that closed the same way', async () => {
    const { session, requests } = scripted([answer, silent, answer], tools);
    try {
      expect(await session.submit('Go')).toBe('success');
      const first = session.getSnapshot().messages.at(-1);
      if (!first || !session.regenerate) throw new Error('Nothing to regenerate.');
      expect(await session.regenerate(first.id)).toBe('interrupted');
      expect(session.getSnapshot().error).toEqual(RETRY);
      expect(await retryOf(session)).toBe('success');
      expect(requests[2].messages).toEqual(requests[1].messages);
      expect(requests[2].messages.map((message) => message.role)).toEqual([
        'user',
      ]);
    } finally {
      await session.dispose();
    }
  });

  it('refuses once any event arrived before the close', async () => {
    const { session, requests } = scripted(
      [(input) => sse(started(input))],
      tools
    );
    try {
      expect(await session.submit('Go')).toBe('interrupted');
      expect(session.getSnapshot().error).toEqual(UNCERTAIN);
      await expect(retryOf(session)).rejects.toThrow(/cannot be retried/);
      expect(requests).toHaveLength(1);
    } finally {
      await session.dispose();
    }
  });

  it('refuses a request that failed instead of closing, whatever the failure claims', async () => {
    const { session, requests } = scripted(
      [
        () => {
          throw Object.assign(new Error('untrusted transport claim'), {
            requestNotDispatched: true,
            retryable: true,
          });
        },
      ],
      tools
    );
    try {
      expect(await session.submit('Go')).toBe('error');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'server',
        retryable: false,
        recovery: 'none',
      });
      await expect(retryOf(session)).rejects.toThrow(/cannot be retried/);
      expect(requests).toHaveLength(1);
    } finally {
      await session.dispose();
    }
  });

  it('never offers retry for an answer whose stream closed the same way', async () => {
    const { session, requests } = scripted([pause, silent], tools);
    try {
      expect(await session.submit('Go')).toBe('paused');
      if (!session.resume) throw new Error('The session has no resume.');
      expect(
        await session.resume([
          { interruptId: 'approval', status: 'resolved', value: true },
        ])
      ).toBe('interrupted');
      const failed = session.getSnapshot();
      expect(failed.error).toEqual(UNCERTAIN);
      // The answer may have arrived: the claim is kept.
      expect(failed.decision).toMatchObject({
        kind: 'native',
        attempt: { runId: requests[1].runId },
      });
      await expect(retryOf(session)).rejects.toThrow(/cannot be retried/);
      expect(requests).toHaveLength(2);
    } finally {
      await session.dispose();
    }
  });
});

describe('a continuation whose stream closed before any event', () => {
  it('is not offered for retry: it carried local tool results', async () => {
    const { session, requests, handler } = scripted([calling, silent], true);
    try {
      expect(await session.submit('Go')).toBe('interrupted');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(2);
      expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool' });
      expect(session.getSnapshot().error).toEqual(UNCERTAIN);
      await expect(retryOf(session)).rejects.toThrow(/cannot be retried/);
      expect(requests).toHaveLength(2);
    } finally {
      await session.dispose();
    }
  });
});

describe('the wording for an unanswered request', () => {
  it('matches the LangGraph runtime', () => {
    expect(UNANSWERED_COPY).toBe(RECOVERY_COPY.messages.retry);
  });
});
