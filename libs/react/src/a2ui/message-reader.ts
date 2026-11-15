import {
  createA2uiSurfaces,
  type A2uiSurfaces,
  type A2uiSurfacesSnapshot,
} from '@threadplane/content/a2ui';

type Envelope = Parameters<A2uiSurfaces['apply']>[0];

const ENVELOPE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One line of the source as an envelope the store accepts, or null. Follows
 * the protocol parser: a malformed line and an unknown envelope key are
 * skipped, and a missing `version` reads as v0.9. The store does not validate
 * shape, so the fields it relies on are checked here.
 */
function envelope(line: string): Envelope | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (!record(json)) return null;
  for (const key of ENVELOPE_KEYS) {
    const body = json[key];
    if (!record(body) || typeof body['surfaceId'] !== 'string') continue;
    if (key === 'updateComponents' && !Array.isArray(body['components']))
      return null;
    const version = typeof json['version'] === 'string' ? json['version'] : 'v0.9';
    return { version, [key]: body } as unknown as Envelope;
  }
  return null;
}

/** @internal Reads one message's growing envelope source into a surfaces store it owns. */
export interface A2uiMessageReader {
  /**
   * Applies what `source` adds to what was read before: finished lines only
   * while `streaming`, the last line too once it is not. A source that does
   * not extend what was read starts over with an empty store.
   */
  read(source: string, streaming: boolean): void;
  /** The current store; a new one after the reader started over. */
  surfaces(): A2uiSurfaces;
  /** Notifies of edits and of nothing `read` did itself. */
  readonly subscribe: (notify: () => void) => () => void;
  readonly getSnapshot: () => A2uiSurfacesSnapshot;
}

/** @internal */
export function createA2uiMessageReader(): A2uiMessageReader {
  const listeners = new Set<() => void>();
  let reading = false;
  let consumed = '';
  /** True once a last line without a newline was read; nothing may follow it. */
  let closed = false;
  let store: A2uiSurfaces;
  let release: () => void;

  function open(): void {
    store = createA2uiSurfaces();
    release = store.subscribe(() => {
      // `read` runs while its caller renders, and that caller reads the snapshot next.
      if (!reading) for (const notify of [...listeners]) notify();
    });
    consumed = '';
    closed = false;
  }
  open();

  return {
    read(source, streaming) {
      if (
        !source.startsWith(consumed) ||
        (closed && source.length !== consumed.length)
      ) {
        release();
        open();
      }
      const end = streaming ? source.lastIndexOf('\n') + 1 : source.length;
      if (end <= consumed.length) return;
      reading = true;
      try {
        for (const line of source.slice(consumed.length, end).split('\n')) {
          const message = envelope(line);
          if (message === null) continue;
          try {
            store.apply(message);
          } catch {
            /* One envelope the store rejects does not cost the rest of the message. */
          }
        }
      } finally {
        reading = false;
      }
      consumed = source.slice(0, end);
      closed = !consumed.endsWith('\n');
    },
    surfaces: () => store,
    subscribe(notify) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    getSnapshot: () => store.getSnapshot(),
  };
}
