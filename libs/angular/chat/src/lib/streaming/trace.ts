// libs/angular/chat/src/lib/streaming/trace.ts
//
// localStorage / window-flag-gated debug tracer for @threadplane/angular/chat streaming.
// Off by default. Enable via:
//   window.__threadplaneChatTrace = true
//   localStorage.THREADPLANE_CHAT_STREAM_TRACE = '1'
//
// All call sites should be guarded with `if (isTraceEnabled())` so the
// argument-collection cost is paid only when tracing is on.

export function isTraceEnabled(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const win = (globalThis as { window?: { __threadplaneChatTrace?: boolean; localStorage?: Storage } }).window;
  if (!win) return false;
  if (win.__threadplaneChatTrace === true) return true;
  try {
    return win.localStorage?.getItem('THREADPLANE_CHAT_STREAM_TRACE') === '1';
  } catch {
    return false;
  }
}

export function trace(...args: unknown[]): void {
  if (isTraceEnabled()) {
    // eslint-disable-next-line no-console
    console.debug('[tplane-chat-stream]', ...args);
  }
}
