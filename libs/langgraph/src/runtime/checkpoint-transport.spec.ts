import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';

afterEach(() => vi.unstubAllGlobals());
const checkpoint = {
  thread_id: 'thread',
  checkpoint_ns: '' as const,
  checkpoint_id: 'a',
  checkpoint_map: { '': 'a' },
};
describe('exact checkpoint transport', () => {
  it('reads the exact checkpoint and normalizes a write response without leaking configuration', async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/checkpoint')
        ? Response.json({ checkpoint, values: {}, next: [], tasks: [] })
        : Response.json({
            configurable: {
              ...checkpoint,
              checkpoint_id: 'written',
              secret: 'omit',
            },
          })
    );
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0 }
    );
    const signal = new AbortController().signal;
    expect(
      (await transport.getState('thread', checkpoint, signal)).checkpoint
    ).toEqual(checkpoint);
    expect(
      await transport.updateState('thread', { messages: [] }, signal, {
        asNode: '__start__',
        checkpoint,
      })
    ).toEqual({ ...checkpoint, checkpoint_id: 'written' });
    expect(
      request.mock.calls.map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      }))
    ).toEqual([
      {
        url: 'https://runtime.example/threads/thread/state/checkpoint',
        body: { checkpoint },
      },
      {
        url: 'https://runtime.example/threads/thread/state',
        body: { values: { messages: [] }, checkpoint, as_node: '__start__' },
      },
    ]);
    expect(
      request.mock.calls.every(
        ([, init]) => init?.signal instanceof AbortSignal
      )
    ).toBe(true);
  });
  it('permits a legacy successful write without routing and requests checkpoint delivery when joining', async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/stream')
        ? new Response('', { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({})
    );
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0 }
    );
    const signal = new AbortController().signal;
    expect(await transport.updateState('thread', {}, signal)).toBeUndefined();
    for await (const event of transport.joinStream(
      'thread',
      'run',
      'cursor',
      signal,
      { streamMode: ['values', 'checkpoints'] }
    ))
      void event;
    expect(
      JSON.parse(
        new URL(String(request.mock.calls[1][0])).searchParams.get(
          'stream_mode'
        )!
      )
    ).toEqual(['values', 'checkpoints']);
    expect(
      new Headers(request.mock.calls[1][1]?.headers).get('last-event-id')
    ).toBe('cursor');
  });
  it('protects exact-state errors and does not retry a lost write acknowledgment', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('NetworkError secret');
    });
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0, defaultHeaders: { authorization: 'secret' } }
    );
    const signal = new AbortController().signal;
    await expect(
      transport.getState('thread', checkpoint, signal)
    ).rejects.not.toThrow('secret');
    await expect(
      transport.updateState('thread', {}, signal, { checkpoint })
    ).rejects.not.toThrow('secret');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['read', 'write'] as const)(
    'forwards cancellation to an outstanding exact %s request',
    async (operation) => {
      const aborted = vi.fn();
      const request = vi.fn<typeof fetch>(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted();
                reject(init.signal?.reason);
              },
              { once: true }
            );
          })
      );
      vi.stubGlobal('fetch', request);
      const transport = new FetchStreamTransport(
        'https://runtime.example',
        undefined,
        { maxRetries: 0, defaultHeaders: {} }
      );
      const controller = new AbortController();
      const result =
        operation === 'read'
          ? transport.getState('thread', checkpoint, controller.signal)
          : transport.updateState('thread', {}, controller.signal, {
              checkpoint,
            });
      const rejection = expect(result).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      controller.abort();
      await rejection;
      expect(aborted).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledTimes(1);
    }
  );
});
