import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';
import type { LangGraphSubmitOptions } from './transport.types';

afterEach(() => vi.unstubAllGlobals());

const checkpoint = Object.freeze({
  checkpoint_id: 'full-checkpoint',
  checkpoint_ns: 'child:task',
  checkpoint_map: null,
});
const cases: {
  name: string;
  options?: LangGraphSubmitOptions;
  expected?: unknown;
}[] = [
  {
    name: 'ID alias',
    options: { checkpointId: 'chosen-checkpoint' },
    expected: {
      checkpoint_id: 'chosen-checkpoint',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
  },
  {
    name: 'full object over alias',
    options: { checkpoint, checkpointId: 'ignored' },
    expected: checkpoint,
  },
  {
    name: 'explicit null over alias',
    options: { checkpoint: null, checkpointId: 'ignored' },
    expected: null,
  },
  {
    name: 'undefined object with alias',
    options: { checkpoint: undefined, checkpointId: 'chosen-checkpoint' },
    expected: {
      checkpoint_id: 'chosen-checkpoint',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
  },
  { name: 'no checkpoint', options: undefined },
];

describe.each(['stream', 'queue'] as const)(
  'SDK %s checkpoint routing',
  (mode) => {
    it.each(cases)(
      'serializes $name without mutating caller options',
      async ({ options, expected }) => {
        const bodies: unknown[] = [];
        const request = vi.fn<typeof fetch>(async (url, init) => {
          expect(String(url)).toBe(
            `https://runtime.example/threads/thread-a/runs${
              mode === 'stream' ? '/stream' : ''
            }`
          );
          expect(init?.method).toBe('POST');
          bodies.push(JSON.parse(String(init?.body)));
          return mode === 'stream'
            ? new Response('event: values\ndata: {"messages":[]}\n\n', {
                headers: { 'content-type': 'text/event-stream' },
              })
            : Response.json({
                run_id: 'queued',
                thread_id: 'thread-a',
                status: 'pending',
              });
        });
        vi.stubGlobal('fetch', request);
        const transport = new FetchStreamTransport(
          'https://runtime.example',
          undefined,
          { maxRetries: 0 }
        );
        const before = options && { ...options };
        if (options) Object.freeze(options);
        const signal = new AbortController().signal;
        if (mode === 'stream') {
          for await (const event of transport.stream(
            'assistant',
            'thread-a',
            null,
            signal,
            options
          )) {
            expect(event.type).toBe('values');
          }
        } else {
          await transport.createQueuedRun(
            'assistant',
            'thread-a',
            null,
            signal,
            options
          );
        }
        expect(bodies).toEqual([
          {
            input: null,
            assistant_id: 'assistant',
            stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
            stream_subgraphs: true,
            ...(mode === 'queue' ? { multitask_strategy: 'enqueue' } : {}),
            ...(expected === undefined ? {} : { checkpoint: expected }),
          },
        ]);
        expect(options).toEqual(before);
        expect(request).toHaveBeenCalledTimes(1);
      }
    );
  }
);
