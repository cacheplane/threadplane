import { describe, expect, it } from 'vitest';
import { deferred } from './testing/deferred';
import { controlledTransport } from './testing/controlled-transport';

describe('runtime test harness', () => {
  it('runs without browser globals or Angular test setup', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
    expect(new AbortController().signal.aborted).toBe(false);
  });

  it('releases each stream event only when directed', async () => {
    const transport = controlledTransport<string>();
    const received: string[] = [];
    const first = transport.stream.next().then((result) => {
      if (!result.done) received.push(result.value);
      return result;
    });

    await Promise.resolve();
    expect(received).toEqual([]);
    transport.release('first');
    await expect(first).resolves.toEqual({ value: 'first', done: false });
    const second = transport.stream.next();
    expect(received).toEqual(['first']);
    transport.release('second');
    await expect(second).resolves.toEqual({ value: 'second', done: false });
    transport.finish();
    await expect(transport.stream.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await transport.closed;
  });

  it('buffers released events in order before a reader requests them', async () => {
    const transport = controlledTransport<number>();
    transport.release(1);
    transport.release(2);
    transport.finish();

    const received: number[] = [];
    for await (const event of transport.stream) received.push(event);
    expect(received).toEqual([1, 2]);
    await transport.closed;
  });

  it('can ignore abort and release a late event until the iterator is closed', async () => {
    const controller = new AbortController();
    const transport = controlledTransport<string>({
      signal: controller.signal,
      ignoreAbort: true,
    });
    const pending = transport.stream.next();
    controller.abort();
    transport.release('late');
    await expect(pending).resolves.toEqual({ value: 'late', done: false });

    const waiting = transport.stream.next();
    await transport.stream.return();
    await transport.closed;
    await expect(waiting).resolves.toEqual({ value: undefined, done: true });
    transport.release('after cleanup');
    await expect(transport.stream.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it('closes the iterator when a consumer exits its loop', async () => {
    const transport = controlledTransport<string>();
    transport.release('first');
    transport.release('discarded');
    for await (const event of transport.stream) {
      expect(event).toBe('first');
      break;
    }

    await transport.closed;
    await expect(transport.stream.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it('rejects a pending read on abort unless configured to ignore it', async () => {
    const controller = new AbortController();
    const transport = controlledTransport<string>({
      signal: controller.signal,
    });
    const reason = new Error('cancelled');
    const read = expect(transport.stream.next()).rejects.toBe(reason);
    controller.abort(reason);

    await read;
    await transport.closed;
  });

  it('observes a signal that was already aborted', async () => {
    const reason = new Error('already cancelled');
    const transport = controlledTransport<string>({
      signal: AbortSignal.abort(reason),
    });

    await expect(transport.stream.next()).rejects.toBe(reason);
    await transport.closed;
  });

  it('controls tool, acquire, and settle completions independently', async () => {
    const tool = deferred<string>();
    const acquire = deferred<boolean>();
    const settle = deferred<void>();
    const completed: string[] = [];
    const toolResult = tool.promise.then((value) => {
      completed.push('tool');
      return value;
    });
    const claimResult = acquire.promise.then((value) => {
      completed.push('acquire');
      return value;
    });
    const recordResult = settle.promise.then(() => completed.push('settle'));

    acquire.resolve(true);
    await expect(claimResult).resolves.toBe(true);
    expect(completed).toEqual(['acquire']);
    settle.resolve();
    await recordResult;
    expect(completed).toEqual(['acquire', 'settle']);
    tool.resolve('tool result');
    await expect(toolResult).resolves.toBe('tool result');
    expect(completed).toEqual(['acquire', 'settle', 'tool']);
  });

  it('can reject a deferred completion', async () => {
    const completion = deferred<string>();
    const reason = new Error('failed');
    const rejected = expect(completion.promise).rejects.toBe(reason);
    completion.reject(reason);
    await rejected;
  });
});
