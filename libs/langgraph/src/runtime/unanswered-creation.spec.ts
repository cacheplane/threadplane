import { ReadableStream } from 'node:stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { CONNECTION_COPY } from './stream-projection';

/**
 * A session on the default SDK transport, with only `fetch` replaced. What the
 * session may send again is decided by what `fetch` itself did with the
 * run-creation request: rejected with no response, or answered by anything.
 */
type Reply = Response | Error | (() => Response | Error);
interface Backend {
  /** One entry per creation request, in order; the last one repeats. */
  creations: Reply[];
  /** The thread's saved checkpoints, newest first; an Error fails the read. */
  history: unknown[] | Error;
  readonly created: { messages: { id: string; content: string }[] }[];
  historyReads: number;
}

const sse = (messages: unknown[], headers: Record<string, string> = {}) =>
  new Response(`event: values\ndata: ${JSON.stringify({ messages })}\n\n`, {
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
const offline = () => new TypeError('Failed to fetch');
const checkpoint = (messages: unknown[], next: string[] = []) => ({
  values: { messages },
  next,
  tasks: [],
  metadata: {},
  created_at: '',
  parent_checkpoint: null,
  checkpoint: {
    thread_id: 'thread-1',
    checkpoint_ns: '',
    checkpoint_id: `saved-${messages.length}-${next.length}`,
    checkpoint_map: {},
  },
});

function backend(creations: Reply[]): Backend {
  const state: Backend = {
    creations,
    history: [],
    created: [],
    historyReads: 0,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (path.endsWith('/runs/stream')) {
        const body = JSON.parse(String(init?.body)) as {
          input: { messages: { id: string; content: string }[] };
        };
        const reply =
          state.creations[Math.min(state.created.length, creations.length - 1)];
        state.created.push(body.input);
        const made = typeof reply === 'function' ? reply() : reply;
        if (made instanceof Error) throw made;
        return made;
      }
      if (path.endsWith('/history')) {
        state.historyReads += 1;
        if (state.history instanceof Error) throw state.history;
        return Response.json(state.history);
      }
      return new Response(null, { status: 404 });
    })
  );
  return state;
}

/** Answers with the submitted prompt and one reply, as a completed run does. */
const answering = (state: () => Backend) => () =>
  sse([
    ...(state().created.at(-1)?.messages ?? []).map((message) => ({
      type: 'human',
      ...message,
    })),
    { type: 'ai', id: 'answer', content: 'Hi' },
  ]);

// The SDK's own errors, and the generic ones a transport with headers keeps.
const transports = [
  ['the SDK errors kept', undefined],
  ['protected errors', { defaultHeaders: { authorization: 'session-token' } }],
] as const;

function session(clientOptions?: {
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
}) {
  return createSession({
    assistantId: 'assistant-1',
    threadId: 'thread-1',
    apiUrl: 'https://runtime.example/api',
    ...(clientOptions ? { clientOptions } : {}),
  });
}
const transcript = (s: ReturnType<typeof session>) =>
  s.getSnapshot().messages.map((message) => [message.role, message.content]);
const UNANSWERED = {
  kind: 'connection',
  message: CONNECTION_COPY,
  retryable: true,
  recovery: 'retry',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(transports)(
  'a creation request that got no response (%s)',
  (_name, clientOptions) => {
    it('is a connection error that retry sends again, once, with the same message id', async () => {
      const state: Backend = backend([offline(), answering(() => state)]);
      const s = session(clientOptions);
      try {
        expect(await s.submit('say hi briefly')).toBe('error');
        const failed = s.getSnapshot();
        expect(failed.status).toBe('error');
        expect(failed.error).toEqual(UNANSWERED);
        // The copy the chat error view shows; legible, never an SDK string.
        expect(failed.error?.message).toMatch(
          /can't reach|connection|server|interrupted|try again/i
        );
        expect(failed.error?.message).not.toMatch(/HTTP \d{3}|fetch/i);
        expect(transcript(s)).toEqual([['user', 'say hi briefly']]);
        expect(state.created).toHaveLength(1);

        // The thread is read first; it holds nothing of this turn.
        const reads = state.historyReads;
        expect(await s.retry?.()).toBe('success');
        expect(state.historyReads).toBe(reads + 1);
        expect(state.created).toHaveLength(2);
        expect(state.created[1].messages[0].id).toBe(
          state.created[0].messages[0].id
        );
        expect(s.getSnapshot().status).toBe('idle');
        expect(s.getSnapshot().error).toBeUndefined();
        expect(transcript(s)).toEqual([
          ['user', 'say hi briefly'],
          ['assistant', 'Hi'],
        ]);
      } finally {
        await s.dispose();
      }
    });

    it('stays retryable while the server stays unreachable', async () => {
      const state = backend([offline()]);
      state.history = offline();
      const s = session(clientOptions);
      try {
        expect(await s.submit('Hello')).toBe('error');
        expect(s.getSnapshot().error).toEqual(UNANSWERED);
        expect(await s.retry?.()).toBe('error');
        expect(s.getSnapshot().error).toEqual(UNANSWERED);
        expect(state.created).toHaveLength(2);
        expect(transcript(s)).toEqual([['user', 'Hello']]);
      } finally {
        await s.dispose();
      }
    });

    it('adopts the turn instead of sending it again when the thread already holds its answer', async () => {
      const state = backend([offline()]);
      state.history = offline();
      const s = session(clientOptions);
      try {
        expect(await s.submit('Hello')).toBe('error');
        expect(s.getSnapshot().error).toEqual(UNANSWERED);
        // The response was lost on its way back: the run did happen.
        const sent = state.created[0].messages[0];
        state.history = [
          checkpoint([
            { type: 'human', ...sent },
            { type: 'ai', id: 'saved-answer', content: 'Already answered' },
          ]),
        ];
        expect(await s.retry?.()).toBe('success');
        expect(state.created).toHaveLength(1);
        expect(s.getSnapshot().status).toBe('idle');
        expect(transcript(s)).toEqual([
          ['user', 'Hello'],
          ['assistant', 'Already answered'],
        ]);
      } finally {
        await s.dispose();
      }
    });

    it('checks instead of sending again when the thread holds the prompt without an answer', async () => {
      const state = backend([offline()]);
      state.history = offline();
      const s = session(clientOptions);
      try {
        expect(await s.submit('Hello')).toBe('error');
        const sent = state.created[0].messages[0];
        state.history = [checkpoint([{ type: 'human', ...sent }], ['generate'])];
        expect(await s.retry?.()).toBe('interrupted');
        expect(state.created).toHaveLength(1);
        expect(s.getSnapshot().error).toMatchObject({
          kind: 'interrupted',
          retryable: false,
          recovery: 'check',
        });
        // Nothing is left to send again; the status check is what remains.
        await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
        expect(state.created).toHaveLength(1);
      } finally {
        await s.dispose();
      }
    });

    it('is not offered a retry when the thread shows the request arrived', async () => {
      const state: Backend = backend([offline()]);
      const s = session(clientOptions);
      try {
        // The failure-time read already finds the prompt saved.
        vi.mocked(globalThis.fetch).mockImplementationOnce(async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as {
            input: { messages: { id: string; content: string }[] };
          };
          state.created.push(body.input);
          state.history = [
            checkpoint(
              [{ type: 'human', ...body.input.messages[0] }],
              ['generate']
            ),
          ];
          throw offline();
        });
        expect(await s.submit('Hello')).toBe('interrupted');
        expect(s.getSnapshot().error).toMatchObject({
          kind: 'interrupted',
          retryable: false,
          recovery: 'check',
        });
        await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
        expect(state.created).toHaveLength(1);
      } finally {
        await s.dispose();
      }
    });

    it('offers no retry once anything answered the request', async () => {
      const state = backend([new Response(null, { status: 500 })]);
      const s = session(clientOptions);
      try {
        expect(await s.submit('Hello')).not.toBe('success');
        const error = s.getSnapshot().error;
        expect(error?.kind).not.toBe('connection');
        expect(error?.retryable).toBe(false);
        expect(error?.recovery).toBe('check');
        await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
        expect(state.created).toHaveLength(1);
      } finally {
        await s.dispose();
      }
    });

    it('offers no retry when the response began and then dropped', async () => {
      const state = backend([
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new TypeError('Failed to fetch'));
              },
            }) as never,
            { headers: { 'content-type': 'text/event-stream' } }
          ),
      ]);
      const s = session(clientOptions);
      try {
        expect(await s.submit('Hello')).not.toBe('success');
        const error = s.getSnapshot().error;
        expect(error?.kind).not.toBe('connection');
        expect(error?.retryable).toBe(false);
        expect(error?.recovery).toBe('check');
        await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
        expect(state.created).toHaveLength(1);
      } finally {
        await s.dispose();
      }
    });

    it('publishes no error for a request the caller stopped', async () => {
      const held: { reject?: (error: Error) => void } = {};
      const state = backend([
        () => new Response(null, { status: 500 }), // Replaced below.
      ]);
      vi.mocked(globalThis.fetch).mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_done, failed) => {
            state.created.push({ messages: [] });
            held.reject = failed;
            init?.signal?.addEventListener('abort', () =>
              failed(new TypeError('Failed to fetch'))
            );
          })
      );
      const s = session(clientOptions);
      try {
        const running = s.submit('Hello');
        await vi.waitFor(() => expect(held.reject).toBeDefined());
        await s.stop();
        expect(await running).toBe('aborted');
        expect(s.getSnapshot().error).toBeUndefined();
        expect(s.getSnapshot().status).toBe('idle');
      } finally {
        await s.dispose();
      }
    });
  }
);

describe('SDK request retries', () => {
  it('is unanswered only when no attempt got a response', async () => {
    const state: Backend = backend([offline(), offline(), answering(() => state)]);
    const s = session({ maxRetries: 1 });
    try {
      expect(await s.submit('Hello')).toBe('error');
      // Both of the SDK's attempts were rejected with no response.
      expect(state.created).toHaveLength(2);
      expect(s.getSnapshot().error).toEqual(UNANSWERED);
      expect(await s.retry?.()).toBe('success');
      expect(state.created).toHaveLength(3);
    } finally {
      await s.dispose();
    }
  }, 15_000);

  it('offers no retry when an earlier attempt was answered', async () => {
    const state = backend([new Response(null, { status: 503 }), offline()]);
    const s = session({ maxRetries: 1 });
    try {
      expect(await s.submit('Hello')).not.toBe('success');
      expect(state.created).toHaveLength(2);
      const error = s.getSnapshot().error;
      expect(error?.kind).not.toBe('connection');
      expect(error?.retryable).toBe(false);
      await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
    } finally {
      await s.dispose();
    }
  }, 15_000);
});

describe('a custom transport', () => {
  it('is never unanswered, whatever it throws', async () => {
    const s = createSession({
      assistantId: 'assistant-1',
      threadId: 'thread-1',
      transport: {
        // eslint-disable-next-line require-yield -- The stream fails before any event.
        stream: async function* () {
          throw new TypeError('Failed to fetch');
        },
        getHistory: async () => [],
        getRunStatus: async () => 'success' as const,
        joinStream: async function* () {
          /* Nothing to join. */
        },
      },
    });
    try {
      expect(await s.submit('Hello')).toBe('interrupted');
      expect(s.getSnapshot().error).toMatchObject({
        kind: 'interrupted',
        retryable: false,
        recovery: 'check',
      });
      await expect(s.retry?.()).rejects.toThrow(/cannot be retried/);
    } finally {
      await s.dispose();
    }
  });
});
