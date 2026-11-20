import type {
  AgentSessionCustomEvent,
  CompleteOutcome,
} from '@threadplane/core';
import type { AgentSessionContext } from '../agent';

/** A hand-written snapshot with one required and one optional backend extra. */
export interface ScriptedSnapshot {
  readonly status: 'idle' | 'running' | 'error';
  readonly messages: readonly string[];
  readonly thread: string | null;
  readonly note?: string;
}

export interface ScriptedLifecycle {
  readonly streamStartedAt: number | null;
  readonly streamErrorAt: { readonly at: number; readonly kind: string } | null;
  readonly interruptReceivedAt: number | null;
  readonly interruptResolvedAt: number | null;
  readonly threadPersistedAt: number | null;
  readonly toolCallStartedAt: number | null;
  readonly toolCallCompletedAt: number | null;
}

export interface ScriptedOptions {
  /** Omit `load`, as a session with no history capability does. */
  readonly load?: boolean;
  /** Omit `onCustomEvent` and `lifecycle`. */
  readonly bare?: boolean;
  /** Offer the optional `regenerate` command. */
  readonly regenerate?: boolean;
}

/** Test-only session whose every publication the spec decides. */
export function scriptedSession(
  context: AgentSessionContext,
  options: ScriptedOptions = {}
) {
  let snapshot: ScriptedSnapshot = Object.freeze({
    status: 'idle',
    messages: Object.freeze([]),
    thread: context.threadId,
  });
  let lifecycle: ScriptedLifecycle = Object.freeze({
    streamStartedAt: null,
    streamErrorAt: null,
    interruptReceivedAt: null,
    interruptResolvedAt: null,
    threadPersistedAt: null,
    toolCallStartedAt: null,
    toolCallCompletedAt: null,
  });
  const listeners = new Set<() => void>();
  const lifecycleListeners = new Set<() => void>();
  const customListeners = new Set<(event: AgentSessionCustomEvent) => void>();
  const loads: {
    resolve(): void;
    reject(error: Error): void;
  }[] = [];
  const calls: unknown[][] = [];
  const control = {
    context,
    calls,
    loads,
    stops: 0,
    disposals: 0,
    /** Live subscriptions of each kind, to prove release. */
    get subscribers() {
      return listeners.size;
    },
    get customSubscribers() {
      return customListeners.size;
    },
    get lifecycleSubscribers() {
      return lifecycleListeners.size;
    },
    publish(patch: Partial<ScriptedSnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...patch });
      for (const notify of [...listeners]) notify();
    },
    /** Notifies without a new aggregate, as an unrelated change would. */
    notify() {
      for (const notify of [...listeners]) notify();
    },
    emit(event: AgentSessionCustomEvent) {
      for (const listener of [...customListeners]) listener(event);
    },
    mark(patch: Partial<ScriptedLifecycle>) {
      lifecycle = Object.freeze({ ...lifecycle, ...patch });
      for (const notify of [...lifecycleListeners]) notify();
    },
  };
  const session = {
    /** A plain member, passed through as it is. */
    label: `session:${context.threadId ?? 'new'}`,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit(
      input: string,
      options?: { readonly signal?: AbortSignal }
    ): Promise<CompleteOutcome> {
      calls.push(['submit', input, options]);
      control.publish({
        status: 'running',
        messages: Object.freeze([...snapshot.messages, input]),
      });
      return Promise.resolve('success');
    },
    /** Reads its receiver, so a detached call would fail. */
    describe(this: { label: string }, prefix: string) {
      return `${prefix}:${this.label}`;
    },
    async stop() {
      control.stops++;
      if (snapshot.status === 'running') control.publish({ status: 'idle' });
    },
    async dispose() {
      control.disposals++;
    },
    ...(options.regenerate && {
      regenerate(messageId: string): Promise<CompleteOutcome> {
        calls.push(['regenerate', messageId]);
        return Promise.resolve('success');
      },
    }),
    ...(options.load !== false && {
      load() {
        calls.push(['load']);
        return new Promise<void>((resolve, reject) => {
          loads.push({ resolve, reject });
        });
      },
    }),
    ...(!options.bare && {
      onCustomEvent(listener: (event: AgentSessionCustomEvent) => void) {
        customListeners.add(listener);
        return () => {
          customListeners.delete(listener);
        };
      },
      lifecycle: {
        getSnapshot: () => lifecycle,
        subscribe(notify: () => void) {
          lifecycleListeners.add(notify);
          return () => {
            lifecycleListeners.delete(notify);
          };
        },
      },
    }),
  };
  return { session, control };
}

export type ScriptedSession = ReturnType<typeof scriptedSession>['session'];
export type ScriptedControl = ReturnType<typeof scriptedSession>['control'];
