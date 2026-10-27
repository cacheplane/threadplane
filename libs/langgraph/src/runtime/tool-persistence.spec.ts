import { describe, expect, it, vi } from 'vitest';
import { createToolBuffer, type ToolMessage } from './function-tools';
import { createToolPersistence } from './tool-persistence';
import { deferred } from './testing/deferred';

describe('terminal tool persistence', () => {
  it('rejects an aborted queued flush before I/O without blocking independent cleanup', async () => {
    const buffer = createToolBuffer();
    const started = deferred<void>();
    const released = deferred<void>();
    const write = vi.fn(
      async (_messages: readonly ToolMessage[], _signal: AbortSignal) => {
        if (write.mock.calls.length === 1) {
          started.resolve();
          await released.promise;
        }
      }
    );
    const persistence = createToolPersistence(buffer, write);
    buffer.stage('first', { ok: true, value: 'first' });
    const first = persistence.flush(new AbortController().signal);
    expect(persistence.pending).toBe(1);
    await started.promise;
    buffer.stage('second', { ok: true, value: 'second' });
    const controller = new AbortController();
    const second = persistence.flush(controller.signal);
    const rejected = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(persistence.pending).toBe(2);
    controller.abort();
    released.resolve();
    await first;
    await rejected;
    expect(write).toHaveBeenCalledTimes(1);
    expect(persistence.pending).toBe(0);
    expect(
      buffer.snapshot().messages.map((message) => message.tool_call_id)
    ).toEqual(['second']);
    await persistence.flush(new AbortController().signal);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      write.mock.calls[1][0].map((message) => message.tool_call_id)
    ).toEqual(['second']);
    expect(buffer.snapshot().messages).toEqual([]);
  });

  it('does not clear failed persistence when an explicit acknowledgement leaves replaced entries', async () => {
    const buffer = createToolBuffer();
    const failure = new Error('write may have committed');
    const write = vi.fn<
      (_messages: readonly ToolMessage[], _signal: AbortSignal) => Promise<void>
    >(async () => {
      throw failure;
    });
    const persistence = createToolPersistence(buffer, write);
    buffer.stage('same', { ok: true, value: 'original' });
    const old = buffer.snapshot();
    await expect(persistence.flush(new AbortController().signal)).rejects.toBe(
      failure
    );
    buffer.stage('same', { ok: true, value: 'replacement' });
    persistence.acknowledge(old);
    await expect(
      persistence.flush(new AbortController().signal)
    ).rejects.toThrow(/previous tool result write/);
    expect(write).toHaveBeenCalledTimes(1);
    expect(buffer.snapshot().messages[0].content).toBe('replacement');
    expect(persistence.pending).toBe(0);

    // Only successful delivery of the remaining exact batch releases the latch.
    persistence.acknowledge(buffer.snapshot());
    write.mockImplementation(async () => undefined);
    buffer.stage('fresh', { ok: true, value: 'fresh' });
    await persistence.flush(new AbortController().signal);
    expect(write).toHaveBeenCalledTimes(2);
    expect(buffer.snapshot().messages).toEqual([]);
  });
});
