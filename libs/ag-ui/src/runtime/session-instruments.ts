import type { AGUIEvent, HttpAgentConfig } from '@ag-ui/client';
import type { CompleteOutcome, PlainValue } from '@threadplane/core';
import { copyData } from './copy-data.js';
import { buildDevelopmentRuntime } from './development-install.js';
import {
  protectedFetch,
  type OperationFailureReporter,
} from './protected-fetch.js';

/** Which command opened a request. */
export type SessionRequestType =
  | 'submit'
  | 'resume'
  | 'retry'
  | 'regenerate'
  | 'client-tool-continuation';

/** The lifecycle moments a session reports to a telemetry sink. */
export type SessionTelemetryEvent =
  | 'tplane:runtime_instance_created'
  | 'tplane:runtime_request_created'
  | 'tplane:stream_started'
  | 'tplane:stream_ended'
  | 'tplane:stream_errored';

export interface SessionTelemetryProperties {
  readonly transport: 'ag-ui';
  readonly surface: 'session';
  readonly requestType?: SessionRequestType;
  readonly durationMs?: number;
  readonly errorClass?: string;
}

/** Receives a session's lifecycle moments. It may be asynchronous and may throw. */
export type SessionTelemetrySink = (payload: {
  readonly event: SessionTelemetryEvent;
  readonly properties: SessionTelemetryProperties;
}) => void | Promise<void>;

/** A development-install collector the host supplies; the session only calls it. */
export interface SessionDevelopmentRuntime {
  touch(): void;
  milestone(
    kind:
      | 'transport.connected'
      | 'runtime.first_stream_completed'
      | 'interrupt.handled',
    durationMs?: number
  ): void;
  dispose(): void;
}

/**
 * What this package tells a host that builds the collector for it: which
 * package is installed, and whether this session may collect.
 */
export interface SessionDevelopmentInstall {
  readonly integration: 'ag-ui';
  readonly packageName: '@threadplane/ag-ui';
  readonly packageVersion: string;
  /**
   * The package-local token the install step wrote, in an Angular development
   * build. Null everywhere else, and in a package installed without scripts.
   */
  readonly installationToken: string | null;
  /** False once the app supplied its own `telemetry` option, `false` included. */
  readonly enabled: () => boolean;
}

/** Builds the collector for one session from what the package knows of itself. */
export type SessionDevelopmentRuntimeFactory = (
  install: SessionDevelopmentInstall
) => SessionDevelopmentRuntime | undefined;

/** One scripted run: the protocol events to serve in place of a request. */
export interface ScriptedRun {
  readonly events: readonly {
    readonly type: string;
    readonly [key: string]: unknown;
  }[];
}

/** Development hooks a host passes to follow or drive a session. */
export interface SessionDevtools {
  /**
   * Called after each publication with what caused it and the names of the
   * snapshot fields that changed. The cause is a protocol event's type, or
   * `run:start`, `run:end`, `history` or `reset` for a change no event
   * caused. Values are never passed. Publications that change no listed
   * field are not reported.
   */
  report?(cause: string, changed: readonly string[]): void;
  /**
   * Asked before each request. A run it returns is served in place of the
   * network, through the same pipeline; its `RUN_STARTED` and `RUN_FINISHED`
   * take the request's own thread and run identifiers.
   */
  takeScriptedRun?(): ScriptedRun | null | undefined;
}

/** The options a session takes for observing and protecting its operation. */
export interface InstrumentOptions {
  /**
   * A2UI client capabilities to advertise to the agent. Every request's state
   * carries them under `a2ui_client_capabilities`. They are not part of the
   * session's own state and are not published.
   */
  readonly a2uiClientCapabilities?: {
    readonly supportedCatalogIds: readonly string[];
    readonly inlineCatalogs?: readonly PlainValue[];
  };
  /** Receives the session's lifecycle moments. Absent or `false` reports nothing. */
  readonly telemetry?: SessionTelemetrySink | false;
  /**
   * A development-install collector to keep informed, or a factory that builds
   * one from what this package knows of its own installation. The host owns
   * the collector; the session only calls it, and sends nothing itself.
   */
  readonly developmentRuntime?:
    | SessionDevelopmentRuntime
    | SessionDevelopmentRuntimeFactory;
  /**
   * Told when a request is refused for its credential (`unauthorized`) or gets
   * no response (`network_blocked`). A session with a reporter also protects
   * what a failure shows: the backend's `RUN_ERROR` text and code, a failed
   * response's body and its status are replaced by a fixed message, in the
   * snapshot, in its evidence and on the raw event stream.
   */
  readonly reportOperationFailure?: OperationFailureReporter | undefined;
  readonly devtools?: SessionDevtools;
}

/** What a protected session shows for any failure a server described. */
export const PROTECTED_COPY =
  'The server ran into an error. You can try again.';

/** The snapshot fields a devtools report can name. */
const REPORTED = [
  'messages',
  'status',
  'error',
  'toolCalls',
  'state',
  'interrupts',
  'subagents',
  'plan',
  'usage',
  'decision',
  'inputBlocked',
  'clientTools',
] as const;

/** The events that show a backend answered, as the Angular adapter counted them. */
const CONNECTED = new Set([
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_ERROR',
  'TEXT_MESSAGE_START',
  'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END',
  'REASONING_MESSAGE_START',
  'REASONING_MESSAGE_CONTENT',
  'REASONING_MESSAGE_CHUNK',
  'REASONING_MESSAGE_END',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_CALL_END',
  'TOOL_CALL_RESULT',
  'STATE_SNAPSHOT',
  'STATE_DELTA',
  'MESSAGES_SNAPSHOT',
  'CUSTOM',
  'SUBAGENT_STARTED',
  'SUBAGENT_FINISHED',
  'SUBAGENT_ERROR',
  'ACTIVITY_SNAPSHOT',
  'ACTIVITY_DELTA',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The observation and protection a session was asked for. Every hook is inert
 * when its option is absent, and none can fail a run.
 */
export function createInstruments(options: InstrumentOptions) {
  const { telemetry, reportOperationFailure, devtools } = options;
  const capabilities =
    options.a2uiClientCapabilities === undefined
      ? undefined
      : (copyData(options.a2uiClientCapabilities, true) as PlainValue);
  const listeners = new Set<{ listener: (event: AGUIEvent) => void }>();
  // The legacy rule: collection is on unless the app chose a destination of
  // its own, and `telemetry: false` is such a choice.
  const developmentEnabled = () => options.telemetry === undefined;
  const development: SessionDevelopmentRuntime | undefined =
    typeof options.developmentRuntime === 'function'
      ? buildDevelopmentRuntime(options.developmentRuntime, developmentEnabled)
      : options.developmentRuntime;
  /** The collector is the host's: nothing it does can change a run. */
  const collect = (use: (runtime: SessionDevelopmentRuntime) => void) => {
    if (!development) return;
    try {
      use(development);
    } catch {
      /* Optional collection cannot change what the session does. */
    }
  };
  // What the collector may still learn from the request being served.
  let awaitingFirstEvent = false;
  let scripted = false;
  let cause = 'reset';
  const tell = (
    event: SessionTelemetryEvent,
    properties: Omit<SessionTelemetryProperties, 'transport' | 'surface'> = {}
  ) => {
    if (!telemetry) return;
    try {
      void Promise.resolve(
        telemetry({
          event,
          properties: { transport: 'ag-ui', surface: 'session', ...properties },
        })
      ).catch(() => undefined);
    } catch {
      /* Telemetry cannot change what the session does. */
    }
  };
  collect((runtime) => runtime.touch());
  tell('tplane:runtime_instance_created');
  return {
    /** Whether a host may run development-install collection for this session. */
    developmentEnabled,
    /** Failures are shown and reported without what the server said. */
    protect: reportOperationFailure !== undefined,
    /** The fetch a session sends with: guarded when a reporter is configured. */
    fetch: (send: HttpAgentConfig['fetch']): HttpAgentConfig['fetch'] =>
      reportOperationFailure
        ? protectedFetch(
            (send ?? globalThis.fetch.bind(globalThis)) as typeof fetch,
            reportOperationFailure
          )
        : send,
    /** A `RUN_ERROR` as a protected session admits it: the event, and nothing the server put in it. */
    redact: <T extends AGUIEvent>(event: T): T =>
      reportOperationFailure && event.type === 'RUN_ERROR'
        ? ({ type: 'RUN_ERROR', message: PROTECTED_COPY } as T)
        : event,
    /** The state a request sends, with the advertised capabilities when it is a record. */
    requestState: (state: unknown): unknown =>
      capabilities !== undefined && isRecord(state)
        ? { ...state, a2ui_client_capabilities: copyData(capabilities, false) }
        : state,
    /** Reports a request and returns how to report its end. */
    request: (requestType: SessionRequestType) => {
      collect((runtime) => runtime.touch());
      awaitingFirstEvent = development !== undefined;
      scripted = false;
      if (!telemetry && !development) return () => undefined;
      const startedAt = Date.now();
      tell('tplane:runtime_request_created', { requestType });
      tell('tplane:stream_started');
      let settled = false;
      return (outcome: CompleteOutcome) => {
        if (settled) return;
        settled = true;
        const durationMs = Date.now() - startedAt;
        // A run the backend completed, with nothing left to answer. A
        // scripted run never reached a backend, so it proves nothing.
        if (outcome === 'success' && !scripted)
          collect((runtime) => {
            runtime.milestone('runtime.first_stream_completed', durationMs);
            if (requestType === 'resume') runtime.milestone('interrupt.handled');
          });
        if (outcome === 'error' || outcome === 'interrupted')
          tell('tplane:stream_errored', {
            durationMs,
            errorClass:
              outcome === 'interrupted'
                ? 'InterruptedError'
                : reportOperationFailure
                ? 'UnknownError'
                : 'Error',
          });
        else tell('tplane:stream_ended', { durationMs });
      };
    },
    /** A scripted run a host armed for the next request, as that request's fetch. */
    scriptedFetch: (): HttpAgentConfig['fetch'] | undefined => {
      let script: ScriptedRun | null | undefined;
      try {
        script = devtools?.takeScriptedRun?.();
      } catch {
        return undefined;
      }
      if (!script || !Array.isArray(script.events)) return undefined;
      scripted = true;
      const events = script.events;
      return async (_url, init) => {
        const input = JSON.parse(String(init?.body)) as {
          threadId: string;
          runId: string;
        };
        const body = events
          .map((event) =>
            event.type === 'RUN_STARTED' || event.type === 'RUN_FINISHED'
              ? { ...event, threadId: input.threadId, runId: input.runId }
              : event
          )
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join('');
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        });
      };
    },
    /** Tells the collector the backend answered, on a request's first event. */
    received: (event: AGUIEvent): void => {
      if (!awaitingFirstEvent || !CONNECTED.has(event.type)) return;
      awaitingFirstEvent = false;
      if (!scripted)
        collect((runtime) => runtime.milestone('transport.connected'));
    },
    /** Names what causes the publications that follow. */
    cause: (label: string): void => {
      cause = label;
    },
    /** Follows a session's publications for the devtools report. */
    follow: <S extends object>(source: {
      getSnapshot(): S;
      subscribe(notify: () => void): () => void;
    }): void => {
      const report = devtools?.report;
      if (!report) return;
      let previous = source.getSnapshot() as Record<string, unknown>;
      source.subscribe(() => {
        const next = source.getSnapshot() as Record<string, unknown>;
        const changed = REPORTED.filter(
          (field) => !Object.is(previous[field], next[field])
        );
        previous = next;
        if (!changed.length) return;
        try {
          report.call(devtools, cause, changed);
        } catch {
          /* A host's report cannot fail a run. */
        }
      });
    },
    onRawEvent: (listener: (event: AGUIEvent) => void): (() => void) => {
      const registration = { listener };
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
      };
    },
    /** Delivers one event the session has applied, to the listeners registered now. */
    raw: (event: AGUIEvent): void => {
      for (const registration of [...listeners]) {
        if (!listeners.has(registration)) continue;
        try {
          registration.listener(event);
        } catch {
          /* A listener cannot fail a run. */
        }
      }
    },
    clear: (): void => {
      collect((runtime) => runtime.dispose());
      listeners.clear();
    },
  };
}

export type Instruments = ReturnType<typeof createInstruments>;
