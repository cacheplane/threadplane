import type { ThreadState } from '@langchain/langgraph-sdk';
import type { AgentError, PlainValue } from '@threadplane/core';
import type { LangGraphSnapshot } from './langgraph-snapshot.js';
import type { StreamEvent } from './transport.types.js';
import { record } from './wire-message.js';

/** The runtime telemetry events a session reports, as the Angular agent named them. */
export type LangGraphTelemetryEvent =
  | 'tplane:runtime_instance_created'
  | 'tplane:runtime_request_created'
  | 'tplane:stream_started'
  | 'tplane:stream_ended'
  | 'tplane:stream_errored';

export interface LangGraphTelemetryPayload {
  readonly event: LangGraphTelemetryEvent;
  readonly properties: {
    readonly transport: 'langgraph';
    readonly surface: 'agent';
    /** What created the request: `submit`, `resume`, `continue`, `retry`,
     * `fork`, `reconnect`, `join`, `join_queued` or `enqueue`. */
    readonly requestType?: string;
    readonly durationMs?: number;
    /** The published error's kind. */
    readonly errorClass?: string;
  };
}

/** Receives runtime telemetry. It may be asynchronous; failures are ignored. */
export type LangGraphTelemetrySink = (
  payload: LangGraphTelemetryPayload
) => void | Promise<void>;

/** A development-install collector the host supplies; the session only calls it. */
export interface LangGraphDevelopmentRuntime {
  touch(): void;
  milestone(kind: 'transport.connected' | 'thread.persisted'): void;
  dispose(): void;
}

/**
 * A development tool's view of what each event changed. `begin` and `end`
 * bracket one stream event by its type; `outside` brackets a change that no
 * stream event caused, by a label (`run:start`, `run:end`, `history`, `queue`,
 * `branch`). Inside a bracket, `wrote` names each published field that changed.
 * Names and timing only: no value is ever passed.
 */
export interface LangGraphDevtoolsSink {
  begin(eventType: string): void;
  end(): void;
  wrote(name: LangGraphDevtoolsSignal): void;
  outside<R>(label: string, run: () => R): R;
}

export type LangGraphDevtoolsSignal =
  | 'status'
  | 'values'
  | 'messages'
  | 'error'
  | 'interrupt'
  | 'interrupts'
  | 'branch'
  | 'history'
  | 'isThreadLoading'
  | 'toolProgress'
  | 'toolCalls'
  | 'messageMetadata'
  | 'subagents'
  | 'queue'
  | 'custom';

/** A run a development tool scripted: its frames stand in for the network. */
export interface LangGraphScriptedRun {
  readonly frames: readonly { readonly event: string; readonly data: unknown }[];
}
export interface LangGraphScriptedRuns {
  /** The armed run, taken once, or null when none is armed. */
  take(): LangGraphScriptedRun | null;
}

const signals: readonly (readonly [
  keyof LangGraphSnapshot,
  readonly LangGraphDevtoolsSignal[]
])[] = [
  ['status', ['status']],
  ['state', ['values']],
  ['messages', ['messages']],
  ['error', ['error']],
  ['interrupts', ['interrupt', 'interrupts']],
  ['branch', ['branch']],
  ['history', ['history']],
  ['checkpoints', ['history']],
  ['loading', ['isThreadLoading']],
  ['toolProgress', ['toolProgress']],
  ['toolCalls', ['toolCalls']],
  ['messageMetadata', ['messageMetadata']],
  ['subgraphs', ['subagents']],
  ['queue', ['queue']],
];

/** The devtools names of the fields that differ between two snapshots. */
export function changedSignals(
  before: LangGraphSnapshot,
  after: LangGraphSnapshot
): readonly LangGraphDevtoolsSignal[] {
  const names = new Set<LangGraphDevtoolsSignal>();
  for (const [field, reported] of signals)
    if (before[field] !== after[field])
      for (const name of reported) names.add(name);
  return [...names];
}

/** Calls a host hook, containing a throw and a rejected promise alike. */
export function safely(run: () => unknown): void {
  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function')
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    /* A host hook cannot affect the session. */
  }
}

export function errorClass(error: AgentError | undefined): string {
  return error?.kind ?? 'unknown';
}

/**
 * Limits how often a listener is told about changes: at once when `urgent`
 * says so or when `ms` has passed since the last call, and otherwise once,
 * `ms` after that call. The snapshot itself is never delayed.
 */
export function throttleListener(
  notify: () => void,
  ms: number,
  urgent: () => boolean
): { (): void; cancel(): void } {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    timer = undefined;
    last = Date.now();
    notify();
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const throttled = () => {
    const wait = last + ms - Date.now();
    if (urgent() || wait <= 0) {
      cancel();
      fire();
    } else if (timer === undefined) timer = setTimeout(fire, wait);
  };
  throttled.cancel = cancel;
  return throttled;
}

type Convert = (message: unknown) => unknown;

function convertList(messages: unknown, convert: Convert): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => {
    try {
      return convert(message);
    } catch {
      // One unreadable message cannot end the run; it is projected as sent.
      return message;
    }
  });
}

/** Applies the caller's message deserializer to every wire message of a
 * stream event, root or child, before anything is projected. */
export function convertEventMessages(
  event: StreamEvent,
  convert: Convert | undefined
): StreamEvent {
  if (!convert) return event;
  const next: StreamEvent = { ...event };
  if (Array.isArray(event.messages))
    next.messages = convertList(event.messages, convert) as unknown[];
  const data = record(event['data']);
  const checkpoint = event.type.split('|')[0] === 'checkpoints';
  const holder = checkpoint ? record(data?.['values']) : data;
  if (data && holder && Array.isArray(holder['messages'])) {
    const converted = {
      ...holder,
      messages: convertList(holder['messages'], convert),
    };
    next['data'] = checkpoint ? { ...data, values: converted } : converted;
  }
  return next;
}

/** The same for a saved checkpoint's state. */
export function convertSavedMessages<T extends ThreadState | undefined>(
  saved: T,
  convert: Convert | undefined
): T {
  const values = record(saved?.values);
  if (!convert || !saved || !values || !Array.isArray(values['messages']))
    return saved;
  return {
    ...saved,
    values: { ...values, messages: convertList(values['messages'], convert) },
  };
}

/** What a session advertises to the graph for generated UI negotiation. */
export interface A2uiClientCapabilities {
  readonly supportedCatalogIds: readonly string[];
  readonly inlineCatalogs?: readonly PlainValue[];
}
