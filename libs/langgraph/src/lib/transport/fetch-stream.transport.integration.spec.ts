import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from './fetch-stream.transport';

describe('FetchStreamTransport real SDK retry boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not report a transient branded fetch rejection when AsyncCaller recovers', async () => {
    const reportOperationFailure = vi.fn();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('test-key-redact-me'))
      .mockResolvedValueOnce(new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 1 },
      reportOperationFailure,
    );

    const history = await transport.getHistory('thread-transient', new AbortController().signal);

    expect(history).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportOperationFailure).not.toHaveBeenCalled();
  });

  it('reports network_blocked once after real AsyncCaller retry exhaustion', async () => {
    const reportOperationFailure = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('test-key-redact-me'));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 1 },
      reportOperationFailure,
    );

    const error = await transport.getHistory('thread-exhaustion', new AbortController().signal)
      .catch((reason: unknown) => reason);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith('network_blocked');
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('rejects a hostile AbortSignal proxy before the real default Client invokes fetch', async () => {
    const reportOperationFailure = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const nativeSignal = new AbortController().signal;
    const hostileSignal = new Proxy(nativeSignal, {
      get() {
        throw Object.assign(new Error('test-key-redact-me'), { status: 401 });
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === 'status') {
          return { configurable: true, enumerable: false, writable: false, value: 401 };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      reportOperationFailure,
    );

    const error = await transport.getHistory('thread-hostile-signal', hostileSignal)
      .catch((reason: unknown) => reason);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The LangGraph request failed.' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });
});
