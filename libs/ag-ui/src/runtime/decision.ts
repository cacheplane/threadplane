import type { Interrupt } from '@ag-ui/client';
import type {
  AgentInterruptResponse,
  CompleteOutcome,
  DeepReadonly,
  PlainValue,
} from '@threadplane/core';
import type { OwnedRootTerminal } from './session-observation.js';
import { copyData } from '../lib/internal/copy-data.js';
import { answersNotice, type InterruptTransport } from './interrupt-mode.js';

declare const pauseId: unique symbol;
export type PauseId = string & { readonly [pauseId]: true };
/**
 * One answer for `resume`: the core response, which names a pending interrupt
 * and resolves it with an optional `value` or cancels it, plus the protocol's
 * optional `metadata`.
 */
export type InterruptResponse = AgentInterruptResponse & {
  readonly metadata?: Readonly<Record<string, PlainValue>>;
  /** The request's name for the answer. `resume` reads `value`. */
  readonly payload?: never;
};
/** A response as the protocol carries it, with the value as its `payload`. */
export type NativeResponse =
  | {
      readonly interruptId: string;
      readonly status: 'resolved';
      readonly payload?: PlainValue;
      readonly metadata?: Readonly<Record<string, PlainValue>>;
    }
  | {
      readonly interruptId: string;
      readonly status: 'cancelled';
      readonly payload?: never;
      readonly metadata?: Readonly<Record<string, PlainValue>>;
    };
export type OwnedInterrupt = DeepReadonly<Interrupt> & {
  /** What a `CUSTOM on_interrupt` notice carried, read as JSON when it is. */
  readonly value?: PlainValue;
};
/** What a request's `forwardedProps` carries for a command answer. */
export type CommandProps = {
  readonly command: {
    readonly resume: PlainValue;
    readonly interruptEvent?: {
      readonly toolCallId: string;
      readonly runId?: string;
    };
  };
};
export type NativeDecision = {
  readonly kind: 'native';
  readonly id: PauseId;
  readonly sourceRunId: string;
  readonly interrupts: readonly OwnedInterrupt[];
  /**
   * Set on a pause that is answered through `forwardedProps.command` and not
   * through the protocol's `resume`: the profile that decided so, and the
   * notice's value when a `CUSTOM on_interrupt` notice announced the pause.
   */
  readonly command?: {
    readonly transport: Exclude<InterruptTransport, 'protocol'>;
    readonly notice?: PlainValue;
  };
  readonly attempt?: {
    readonly runId: string;
    readonly responses: readonly NativeResponse[];
    /** The command a command answer sends in place of `resume`. */
    readonly forwardedProps?: CommandProps;
    /** The answering run reported `RUN_STARTED`: the backend has the answer. */
    readonly acknowledged?: true;
  };
};
export type Decision =
  | NativeDecision
  | { readonly kind: 'unsupported'; readonly sourceRunId: string };
export interface DecisionRun {
  readonly id: string;
  readonly outcome?: CompleteOutcome;
  readonly terminal?: OwnedRootTerminal;
}

export function captureResponses(
  responses: readonly InterruptResponse[]
): readonly NativeResponse[] {
  if (!Array.isArray(responses))
    throw new TypeError('Resume takes an array of responses.');
  const length = responses.length;
  const selected: NativeResponse[] = [];
  for (let index = 0; index < length; index++) {
    const { interruptId, status, value: payload, metadata } = responses[index];
    if (
      typeof interruptId !== 'string' ||
      (status !== 'resolved' && status !== 'cancelled')
    )
      throw new TypeError(
        'Explicit interruptId and native status are required'
      );
    if (status === 'cancelled' && payload !== undefined)
      throw new TypeError('A cancelled response cannot carry a value.');
    if (
      metadata !== undefined &&
      (metadata === null ||
        typeof metadata !== 'object' ||
        (Object.getPrototypeOf(metadata) !== Object.prototype &&
          Object.getPrototypeOf(metadata) !== null))
    )
      throw new TypeError('Metadata must be a plain record');
    selected.push(
      copyData(
        {
          interruptId,
          status,
          // The 1.0 client sends a whole-optional `payload: null` as absent;
          // normalize here so the owned snapshot matches the wire.
          ...(payload !== undefined && payload !== null && { payload }),
          ...(metadata !== undefined && { metadata }),
        },
        true
      ) as NativeResponse
    );
  }
  return Object.freeze(selected);
}

/** A fresh pause generation for evidence that can begin an answerable pause. */
export function pauseFor(
  evidence: OwnedRootTerminal,
  transport: InterruptTransport | undefined
): PauseId | undefined {
  return (evidence.type === 'RUN_FINISHED' &&
    evidence.outcome?.type === 'interrupt') ||
    (evidence.type === 'CUSTOM' && answersNotice(transport))
    ? (crypto.randomUUID() as PauseId)
    : undefined;
}

/**
 * Records that the run answering `decision` has started on the backend.
 * Returns the same decision for any other run, and once it is recorded.
 */
export function acknowledgeDecision(
  decision: Decision | undefined,
  runId: string
): Decision | undefined {
  if (
    decision?.kind !== 'native' ||
    decision.attempt?.runId !== runId ||
    decision.attempt.acknowledged
  )
    return decision;
  return Object.freeze({
    ...decision,
    attempt: Object.freeze({
      ...decision.attempt,
      acknowledged: true as const,
    }),
  });
}

/** A notice's value as the Angular adapter read it: JSON text becomes its data. */
function noticeValue(value: unknown): PlainValue | undefined {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      /* Keep text that is not JSON. */
    }
  }
  return parsed === undefined
    ? undefined
    : (copyData(parsed, true) as PlainValue);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Evidence is already selected and owned. IDs are allocated by the owner.
 * `transport` is the session's resume profile; without one, or with
 * `protocol`, a notice is a pause this owner cannot answer.
 */
export function observeDecision(
  previous: Decision | undefined,
  sourceRunId: string,
  evidence: OwnedRootTerminal,
  id?: PauseId,
  transport?: InterruptTransport
): Decision | undefined {
  if (evidence.type === 'CUSTOM') {
    if (!answersNotice(transport))
      return previous ?? Object.freeze({ kind: 'unsupported', sourceRunId });
    const answering =
      previous?.kind === 'native' && previous.attempt?.runId === sourceRunId;
    // A pause from another run that nothing answered still owns the session.
    if (previous && !answering && previous.sourceRunId !== sourceRunId)
      return previous;
    if (previous?.kind === 'unsupported') return previous;
    // A repeated notice in one run updates the same pause.
    const pause = previous?.kind === 'native' && !answering ? previous.id : id;
    if (pause === undefined)
      throw new TypeError('A fresh pause generation is required');
    const value = noticeValue(evidence.value);
    const toolCallId = isRecord(value) ? value['toolCallId'] : undefined;
    return Object.freeze({
      kind: 'native',
      id: pause,
      sourceRunId,
      interrupts: Object.freeze([
        Object.freeze({
          id: pause,
          reason: 'on_interrupt',
          ...(value !== undefined && { value }),
          ...(typeof toolCallId === 'string' && { toolCallId }),
        }),
      ]),
      command: Object.freeze({
        transport: transport as Exclude<InterruptTransport, 'protocol'>,
        ...(value !== undefined && { notice: value }),
      }),
    });
  }
  if (
    evidence.type !== 'RUN_FINISHED' ||
    evidence.runId !== sourceRunId ||
    evidence.outcome?.type !== 'interrupt'
  )
    return previous;
  const interrupts = evidence.outcome.interrupts;
  if (
    !interrupts.length ||
    new Set(interrupts.map((interrupt) => interrupt.id)).size !==
      interrupts.length
  )
    return Object.freeze({ kind: 'unsupported', sourceRunId });
  if (transport === 'legacy-command' || transport === 'mastra-command') {
    // The notice this run already sent is what a command profile answers.
    if (
      previous?.kind === 'native' &&
      previous.command &&
      !previous.attempt &&
      previous.sourceRunId === sourceRunId
    )
      return previous;
    if (id === undefined)
      throw new TypeError('A fresh pause generation is required');
    return Object.freeze({
      kind: 'native',
      id,
      sourceRunId,
      interrupts,
      command: Object.freeze({ transport }),
    });
  }
  if (id === undefined)
    throw new TypeError('A fresh pause generation is required');
  return Object.freeze({ kind: 'native', id, sourceRunId, interrupts });
}

/**
 * The command that answers a command pause. One interrupt takes one resolved
 * response with a value: a command has no way to cancel, and none to address
 * several interrupts.
 */
function commandProps(
  decision: NativeDecision,
  responses: readonly NativeResponse[]
): CommandProps | undefined {
  const command = decision.command;
  if (!command) return undefined;
  const [response] = responses;
  if (responses.length !== 1 || response.status !== 'resolved')
    throw new TypeError(
      'A command resume answers one interrupt, and cannot cancel it.'
    );
  if (response.payload === undefined)
    throw new TypeError('A command resume needs a value.');
  const notice = command.notice;
  const named = isRecord(notice) && typeof notice['toolCallId'] === 'string';
  if (
    command.transport === 'mastra-command' ||
    (command.transport === 'auto' && named)
  ) {
    if (!named) throw new TypeError('Mastra interrupt requires a toolCallId');
    const runId =
      typeof notice['runId'] === 'string'
        ? notice['runId']
        : decision.sourceRunId;
    return copyData(
      {
        command: {
          resume: response.payload,
          interruptEvent: { toolCallId: notice['toolCallId'], runId },
        },
      },
      true
    ) as CommandProps;
  }
  return copyData(
    { command: { resume: response.payload } },
    true
  ) as CommandProps;
}

export function assertResumeEligible(
  decision: Decision | undefined,
  run: DecisionRun | undefined,
  now: number
): NativeDecision {
  if (
    !decision ||
    decision.kind !== 'native' ||
    decision.attempt ||
    run?.outcome === undefined
  )
    throw new TypeError('No interrupt is waiting for an answer.');
  if (!Number.isFinite(now))
    throw new TypeError('A finite admission time is required');
  for (const interrupt of decision.interrupts) {
    if (interrupt.expiresAt === undefined) continue;
    const expiry = Date.parse(interrupt.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now)
      throw new TypeError('The interrupt has expired or has an invalid expiry');
  }
  return decision;
}

/** Responses have already been captured; only exact protocol addressing is checked. */
export function claimDecision(
  decision: NativeDecision,
  responses: readonly NativeResponse[],
  runId: string
): NativeDecision {
  const expected = new Set(
    decision.interrupts.map((interrupt) => interrupt.id)
  );
  if (decision.attempt || responses.length !== expected.size)
    throw new TypeError('Exactly one response per interrupt is required');
  for (const response of responses)
    if (!expected.delete(response.interruptId))
      throw new TypeError('Unknown or duplicate interrupt response');
  if (expected.size) throw new TypeError('Missing interrupt response');
  const forwardedProps = commandProps(decision, responses);
  return Object.freeze({
    ...decision,
    attempt: Object.freeze({
      runId,
      responses,
      ...(forwardedProps && { forwardedProps }),
    }),
  });
}

export function settleDecision(
  decision: Decision | undefined,
  run: DecisionRun,
  fetchInvoked: boolean
): Decision | undefined {
  if (!decision) return decision;
  const attempt = decision.kind === 'native' ? decision.attempt : undefined;
  if (decision.sourceRunId !== run.id && attempt?.runId !== run.id)
    return decision;
  const terminal = run.terminal;
  // A command pause outlives the ordinary finish of the run that announced it:
  // only the success of the run that answers it clears it.
  if (
    decision.kind === 'native' &&
    decision.command &&
    attempt?.runId !== run.id
  )
    return decision;
  if (
    terminal?.type === 'RUN_FINISHED' &&
    terminal.runId === run.id &&
    (terminal.outcome === undefined || terminal.outcome.type === 'success')
  )
    return undefined;
  if (
    decision.kind === 'native' &&
    attempt?.runId === run.id &&
    !fetchInvoked
  ) {
    return Object.freeze({
      kind: decision.kind,
      id: decision.id,
      sourceRunId: decision.sourceRunId,
      interrupts: decision.interrupts,
      ...(decision.command && { command: decision.command }),
    });
  }
  return decision;
}

/**
 * True when `runId` announced a command pause that nothing has answered. Its
 * ordinary `RUN_FINISHED` is then a pause, as the notice said, not a success.
 */
export function pausedByNotice(
  decision: Decision | undefined,
  runId: string
): boolean {
  return (
    decision?.kind === 'native' &&
    decision.command !== undefined &&
    !decision.attempt &&
    decision.sourceRunId === runId
  );
}

/**
 * What a view can do about the session's pending decision.
 *
 * - `observing`: the pausing run has not settled locally yet; do not answer.
 * - `ready`: the pause can be answered with `session.resume(responses)`.
 * - `answering`: an answer was sent and its run is still going.
 * - `uncertain`: the answering run ended without proof that the backend took
 *   the answer. It cannot be sent again; only a new session can continue.
 *
 * `unsupported` is a pause this owner cannot answer, such as a legacy custom
 * interrupt or a batch with duplicate identifiers.
 */
export type DecisionState =
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'native';
      readonly id: PauseId;
      readonly interrupts: readonly OwnedInterrupt[];
      readonly phase: 'observing' | 'ready' | 'answering' | 'uncertain';
    };

const unsupported: DecisionState = Object.freeze({ kind: 'unsupported' });
const states = new WeakMap<NativeDecision, Map<string, DecisionState>>();

/**
 * Display only: reads the pending decision and how far it has got from a
 * session snapshot. Absent when nothing is waiting. The same decision in the
 * same phase returns the same reference.
 *
 * `ready` does not look at the clock. An interrupt with an `expiresAt` in the
 * past still reads `ready`, and `resume` then rejects it.
 */
export function decisionState(snapshot: {
  readonly decision?: Decision;
  readonly run?: DecisionRun;
}): DecisionState | undefined {
  const { decision, run } = snapshot;
  if (!decision) return undefined;
  if (decision.kind !== 'native') return unsupported;
  const settled = run?.outcome !== undefined;
  const phase = decision.attempt
    ? settled
      ? 'uncertain'
      : 'answering'
    : settled
    ? 'ready'
    : 'observing';
  let known = states.get(decision);
  if (!known) states.set(decision, (known = new Map()));
  let state = known.get(phase);
  if (!state) {
    state = Object.freeze({
      kind: 'native',
      id: decision.id,
      interrupts: decision.interrupts,
      phase,
    });
    known.set(phase, state);
  }
  return state;
}

/**
 * The pending pause with its request ownership, as the Angular adapter's
 * `interruptSession` reported it.
 *
 * - `none`: nothing is waiting.
 * - `collecting`: the pausing run has not settled locally yet.
 * - `pending`: the pause can be answered.
 * - `resuming`: an answer was claimed and its run is going. Claiming and
 *   sending are one step here, so there is no separate `claimed`.
 * - `acknowledged`: the answering run reported `RUN_STARTED` and is going.
 * - `uncertain`: the answering run ended with no proof the backend took the
 *   answer, before it reported `RUN_STARTED`.
 * - `recovery-required`: the answering run ended after it had started on the
 *   backend. Only reconciliation can say how.
 * - `unsupported`: a pause this session cannot answer.
 */
export interface InterruptSession {
  readonly phase:
    | 'none'
    | 'collecting'
    | 'pending'
    | 'resuming'
    | 'acknowledged'
    | 'uncertain'
    | 'recovery-required'
    | 'unsupported';
  /** Changes with every new pause, as the legacy `generation` did. */
  readonly id?: PauseId;
  readonly interrupts: readonly OwnedInterrupt[];
  /** The run that paused. */
  readonly runId?: string;
  /** Present when the pause is answered through `forwardedProps.command`. */
  readonly command?: NativeDecision['command'];
  /** The answer that was claimed: its run, responses and command. */
  readonly attempt?: NativeDecision['attempt'];
}

const noInterrupts: readonly OwnedInterrupt[] = Object.freeze([]);
const noSession: InterruptSession = Object.freeze({
  phase: 'none',
  interrupts: noInterrupts,
});
const sessions = new WeakMap<Decision, Map<string, InterruptSession>>();

/**
 * Display only: reads the full interrupt batch and how far its answer has got
 * from a session snapshot. The same decision in the same phase returns the
 * same reference.
 */
export function interruptSession(snapshot: {
  readonly decision?: Decision;
  readonly run?: DecisionRun;
}): InterruptSession {
  const { decision, run } = snapshot;
  if (!decision) return noSession;
  const settled = run?.outcome !== undefined;
  const attempt = decision.kind === 'native' ? decision.attempt : undefined;
  const phase: InterruptSession['phase'] =
    decision.kind !== 'native'
      ? 'unsupported'
      : !attempt
      ? settled
        ? 'pending'
        : 'collecting'
      : attempt.acknowledged
      ? settled
        ? 'recovery-required'
        : 'acknowledged'
      : settled
      ? 'uncertain'
      : 'resuming';
  let known = sessions.get(decision);
  if (!known) sessions.set(decision, (known = new Map()));
  let session = known.get(phase);
  if (!session) {
    session = Object.freeze(
      decision.kind === 'native'
        ? {
            phase,
            id: decision.id,
            interrupts: decision.interrupts,
            runId: decision.sourceRunId,
            ...(decision.command && { command: decision.command }),
            ...(attempt && { attempt }),
          }
        : { phase, interrupts: noInterrupts, runId: decision.sourceRunId }
    );
    known.set(phase, session);
  }
  return session;
}
