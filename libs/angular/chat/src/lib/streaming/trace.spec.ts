// libs/angular/chat/src/lib/streaming/trace.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTraceEnabled, trace } from './trace';

describe('trace', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let originalWindow: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Completely restore the original window
    (globalThis as any).window = originalWindow;
  });

  it('returns false when no flag is set', () => {
    expect(isTraceEnabled()).toBe(false);
  });

  it('returns true when window.__threadplaneChatTrace === true', () => {
    (globalThis as any).window = { ...((globalThis as any).window ?? {}), __threadplaneChatTrace: true };
    expect(isTraceEnabled()).toBe(true);
  });

  it('returns true when localStorage THREADPLANE_CHAT_STREAM_TRACE === "1"', () => {
    const ls = { getItem: (k: string) => (k === 'THREADPLANE_CHAT_STREAM_TRACE' ? '1' : null) };
    (globalThis as any).window = { ...((globalThis as any).window ?? {}), localStorage: ls };
    expect(isTraceEnabled()).toBe(true);
  });

  it('does not call console.debug when disabled', () => {
    trace('hello');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('calls console.debug with prefix when enabled', () => {
    (globalThis as any).window = { ...((globalThis as any).window ?? {}), __threadplaneChatTrace: true };
    trace('hello', { foo: 1 });
    expect(consoleSpy).toHaveBeenCalledWith('[tplane-chat-stream]', 'hello', { foo: 1 });
  });
});
