import type { AGUIEvent, BaseEvent, RunAgentInput } from '@ag-ui/client';
import { createHttpRequest } from './create-http-request.js';
import { finishedOutcome } from './create-run.js';
import {
  observeDecision,
  pausedByNotice,
  pauseFor,
  settleDecision,
} from './decision.js';
import {
  isLegacyInterruptTerminal,
  type InterruptMode,
  type InterruptTransport,
} from './interrupt-mode.js';
import {
  applyObservation,
  assertTranscriptIdentity,
  initialObservation,
  type Observation,
} from './session-observation.js';
import { nextInvocation } from './subagents.js';
import { ownTranscript } from './transcript.js';

/** The part of an observable a replay source may return. */
export interface ReplaySubscribable {
  subscribe(observer: {
    next(event: BaseEvent): void;
    error(error: unknown): void;
    complete(): void;
  }): { unsubscribe(): void };
}

/**
 * Loads a thread's AG-UI protocol events from the server, in the order a live
 * stream delivered them, so a session can rebuild the thread as the live view
 * showed it.
 *
 * Return the events as a promise of an array or as an observable that
 * completes. Resolve to an empty array when the server has nothing for the
 * thread; reject, or error, for any other failure. `signal` aborts when the
 * session is disposed.
 */
export type ReplaySource = (
  threadId: string,
  signal: AbortSignal
) => Promise<readonly BaseEvent[]> | ReplaySubscribable;

/** Options for {@link httpReplay}. */
export interface HttpReplayOptions {
  /** Builds the GET URL for a thread, such as `(id) => '/api/threads/' + id + '/events'`. */
  readonly url: (threadId: string) => string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Extra request headers, such as a credential. */
  readonly headers?: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A replay source for the common HTTP shape: `GET url(threadId)` answering
 * JSON `{ events: BaseEvent[] }`.
 *
 * A `404` resolves to no events, so the session falls back to `persistence`
 * or starts empty. Any other status that is not OK, a body without an `events`
 * array, or an entry without a string `type` rejects; the session treats that
 * as a failed replay and falls back the same way.
 */
export function httpReplay(options: HttpReplayOptions): ReplaySource {
  return async (threadId, signal) => {
    const send = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await send(options.url(threadId), {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers },
      signal,
    });
    if (response.status === 404) return [];
    if (!response.ok)
      throw new Error(
        `Thread replay request failed with status ${response.status}`
      );
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body['events']))
      throw new Error(
        'Thread replay response must be a JSON object with an events array'
      );
    for (const event of body['events'])
      if (!isRecord(event) || typeof event['type'] !== 'string')
        throw new Error(
          'Thread replay events must be objects with a string type'
        );
    return body['events'] as BaseEvent[];
  };
}

function abortError(): Error {
  const error = new Error('Thread replay aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Runs a replay source to completion and returns its events. Rejects with an
 * `AbortError` when `signal` aborts first, and releases the source then.
 */
export function collectReplay(
  source: ReplaySource,
  threadId: string,
  signal: AbortSignal
): Promise<readonly BaseEvent[]> {
  return new Promise<readonly BaseEvent[]>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let release = () => undefined as void;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      release();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let result: ReturnType<ReplaySource>;
    try {
      result = source(threadId, signal);
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    if (typeof (result as ReplaySubscribable).subscribe === 'function') {
      const events: BaseEvent[] = [];
      let ended = false;
      const subscription = (result as ReplaySubscribable).subscribe({
        next: (event) => events.push(event),
        error: (error) => {
          ended = true;
          cleanup();
          reject(error);
        },
        complete: () => {
          ended = true;
          cleanup();
          resolve(events);
        },
      });
      if (!ended && !signal.aborted)
        release = () => subscription.unsubscribe();
      else if (signal.aborted) subscription.unsubscribe();
      return;
    }
    Promise.resolve(result as Promise<readonly BaseEvent[]>).then(
      (events) => {
        cleanup();
        if (!Array.isArray(events))
          reject(new Error('Thread replay must resolve to an array of events'));
        else resolve([...events]);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

/**
 * Puts one run's stored events through the pipeline a live response goes
 * through (retired shapes, enforcement, chunk expansion, verification), by
 * serving them as that response's body. A stored stream that ends without a
 * terminal is a run that was cut off, not a replay failure.
 */
async function normalize(
  threadId: string,
  runId: string,
  events: readonly BaseEvent[]
): Promise<AGUIEvent[]> {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  const normalized: AGUIEvent[] = [];
  const outcome = await createHttpRequest({
    url: 'replay:',
    fetch: async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  }).start(
    {
      threadId,
      runId,
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    } as RunAgentInput,
    (event) => {
      normalized.push(event as AGUIEvent);
    }
  ).done;
  if (outcome.status === 'failed') throw outcome.error;
  return normalized;
}

const timestampOf = (event: AGUIEvent): number | undefined =>
  typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? event.timestamp
    : undefined;

/** What a folded replay leaves: the thread, and the events it was built from. */
export interface ReplayResult {
  readonly observation: Observation;
  /** Every event that was applied, in order, as a live stream delivers them. */
  readonly events: readonly AGUIEvent[];
}

/**
 * Rebuilds a thread from its stored protocol events. Each `RUN_STARTED` opens
 * a run as a live request does, and every event is applied the way the session
 * applies a live one, so the result matches what the live stream left behind.
 * The differences are forced by the replay having ended:
 *
 * - a run with no terminal event is settled `interrupted`, and the thread is
 *   left idle: nothing is attached to that run, so how it ended is not known;
 * - a run started after a paused one clears the pause, because a server only
 *   starts another run on the thread once the pause was answered;
 * - user messages a `RUN_STARTED.input` carries are added, since a live
 *   transcript got them from the local submission;
 * - reasoning durations come from event `timestamp`s, and are absent when a
 *   message's start or end carries none.
 *
 * Rejects on events it cannot fold; the caller then discards the replay.
 */
export async function foldReplay(
  threadId: string,
  events: readonly BaseEvent[],
  options: {
    readonly interruptMode?: InterruptMode;
    readonly interruptTransport?: InterruptTransport;
    /** Replaces each `RUN_ERROR` before it is applied or reported. */
    readonly redact?: (event: AGUIEvent) => AGUIEvent;
  } = {}
): Promise<ReplayResult> {
  const { interruptMode = 'native', interruptTransport, redact } = options;
  const runs: BaseEvent[][] = [];
  for (const event of events) {
    if (!isRecord(event) || typeof event.type !== 'string')
      throw new TypeError('Thread replay events must have a string type');
    if (event.type === 'RUN_STARTED') runs.push([event]);
    else if (!runs.length)
      throw new TypeError('Thread replay must begin with RUN_STARTED');
    else runs[runs.length - 1].push(event);
  }
  let observation = initialObservation();
  const applied: AGUIEvent[] = [];
  const durations: Record<string, number> = Object.create(null);
  for (const stored of runs) {
    const runId = (stored[0] as { runId?: unknown }).runId;
    if (typeof runId !== 'string' || !runId)
      throw new TypeError('A replayed run needs its runId');
    // The run after a pause is its answer: the pause is over.
    const { decision: _answered, ...rest } = observation;
    observation = Object.freeze({
      ...rest,
      status: 'running' as const,
      ...nextInvocation(
        observation,
        observation.transcript.length,
        observation.transcript.length
      ),
      run: Object.freeze({ id: runId }),
    });
    // A live run stops listening at its terminal event; so does its replay.
    const end = stored.findIndex(
      (event) =>
        event.type === 'RUN_FINISHED' ||
        event.type === 'RUN_ERROR' ||
        isLegacyInterruptTerminal(event, interruptMode)
    );
    const normalized = await normalize(
      threadId,
      runId,
      end < 0 ? stored : stored.slice(0, end + 1)
    );
    const startedAt = new Map<string, number | undefined>();
    let outcome: NonNullable<Observation['run']>['outcome'];
    for (const raw of normalized) {
      const event = raw.type === 'RUN_ERROR' && redact ? redact(raw) : raw;
      if (event.type === 'RUN_STARTED') {
        if (event.threadId !== threadId)
          throw new TypeError('A replayed run belongs to another thread');
        observation = withInputMessages(observation, event);
        applied.push(event);
        continue;
      }
      const previous = observation;
      let next = applyObservation(previous, event, interruptMode);
      const root =
        typeof (event as { subagentRunId?: unknown }).subagentRunId !==
        'string';
      if (event.type === 'REASONING_MESSAGE_START' && root)
        startedAt.set(event.messageId, timestampOf(event));
      if (event.type === 'REASONING_MESSAGE_END' && root) {
        const from = startedAt.get(event.messageId);
        const to = timestampOf(event);
        if (from !== undefined && to !== undefined && to >= from)
          durations[event.messageId] = to - from;
      }
      const evidence =
        next.run?.terminal !== previous.run?.terminal
          ? next.run?.terminal
          : next.run?.legacyInterrupt !== previous.run?.legacyInterrupt
          ? next.run?.legacyInterrupt
          : undefined;
      if (evidence)
        next = Object.freeze({
          ...next,
          decision: observeDecision(
            previous.decision,
            runId,
            evidence,
            pauseFor(evidence, interruptTransport),
            interruptTransport
          ),
        });
      observation = next;
      applied.push(event);
      if (event.type === 'RUN_ERROR') outcome = 'error';
      else if (event.type === 'RUN_FINISHED')
        outcome = finishedOutcome(event.outcome);
      else if (isLegacyInterruptTerminal(event, interruptMode))
        outcome = 'paused';
      if (outcome) break;
    }
    outcome ??= 'interrupted';
    const decision = settleDecision(
      observation.decision,
      { id: runId, outcome, terminal: observation.run?.terminal },
      true
    );
    if (outcome === 'success' && pausedByNotice(decision, runId))
      outcome = 'paused';
    const { decision: _settled, ...settled } = observation;
    observation = Object.freeze({
      ...settled,
      ...(decision && { decision }),
      // A run the replay ends in the middle of is not a failure of this thread.
      status: outcome === 'error' ? ('error' as const) : ('idle' as const),
      run: Object.freeze({ ...observation.run, id: runId, outcome }),
    });
  }
  assertTranscriptIdentity(observation.transcript);
  const measured = Object.keys(durations).length
    ? Object.freeze({ ...durations })
    : undefined;
  return {
    observation: measured
      ? Object.freeze({ ...observation, reasoningDurations: measured })
      : observation,
    events: applied,
  };
}

/** Adds the user messages a run's input carried that the thread does not hold. */
function withInputMessages(
  observation: Observation,
  event: AGUIEvent
): Observation {
  const input = (event as { input?: unknown }).input;
  const messages =
    isRecord(input) && Array.isArray(input['messages'])
      ? input['messages']
      : [];
  const known = new Set(observation.transcript.map((record) => record.id));
  const added: unknown[] = [];
  for (const message of messages) {
    if (
      !isRecord(message) ||
      message['role'] !== 'user' ||
      typeof message['id'] !== 'string' ||
      known.has(message['id'])
    )
      continue;
    known.add(message['id']);
    added.push(message);
  }
  if (!added.length) return observation;
  return Object.freeze({
    ...observation,
    transcript: Object.freeze([
      ...observation.transcript,
      ...ownTranscript(added as Parameters<typeof ownTranscript>[0]),
    ]),
  });
}
