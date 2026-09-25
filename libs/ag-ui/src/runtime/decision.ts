import type { Interrupt } from '@ag-ui/client';
import type {
  CompleteOutcome,
  DeepReadonly,
  PlainValue,
} from '@threadplane/core';
import type { OwnedRootTerminal } from './session-observation';
import { copyData } from '../lib/internal/copy-data';

declare const pauseId: unique symbol;
export type PauseId = string & { readonly [pauseId]: true };
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
export type OwnedInterrupt = DeepReadonly<Interrupt>;
export type NativeDecision = {
  readonly kind: 'native';
  readonly id: PauseId;
  readonly sourceRunId: string;
  readonly interrupts: readonly OwnedInterrupt[];
  readonly attempt?: {
    readonly runId: string;
    readonly responses: readonly NativeResponse[];
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
  responses: readonly NativeResponse[]
): readonly NativeResponse[] {
  if (!Array.isArray(responses))
    throw new TypeError('A native response array is required');
  const length = responses.length;
  const selected: NativeResponse[] = [];
  for (let index = 0; index < length; index++) {
    const { interruptId, status, payload, metadata } = responses[index];
    if (
      typeof interruptId !== 'string' ||
      (status !== 'resolved' && status !== 'cancelled')
    )
      throw new TypeError(
        'Explicit interruptId and native status are required'
      );
    if (status === 'cancelled' && payload !== undefined)
      throw new TypeError('Cancelled decisions cannot have a payload');
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
          ...(payload !== undefined && { payload }),
          ...(metadata !== undefined && { metadata }),
        },
        true
      ) as NativeResponse
    );
  }
  return Object.freeze(selected);
}

/** Evidence is already selected and owned. IDs are allocated by the owner. */
export function observeDecision(
  previous: Decision | undefined,
  sourceRunId: string,
  evidence: OwnedRootTerminal,
  id?: PauseId
): Decision | undefined {
  if (evidence.type === 'CUSTOM')
    return previous ?? Object.freeze({ kind: 'unsupported', sourceRunId });
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
  if (id === undefined)
    throw new TypeError('A fresh pause generation is required');
  return Object.freeze({ kind: 'native', id, sourceRunId, interrupts });
}

export function assertResumeEligible(
  decision: Decision | undefined,
  run: DecisionRun | undefined,
  pause: PauseId,
  now: number
): NativeDecision {
  if (
    !decision ||
    decision.kind !== 'native' ||
    decision.id !== pause ||
    decision.attempt ||
    run?.outcome === undefined
  )
    throw new TypeError(
      'No settled unclaimed native decision matches this pause'
    );
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
  return Object.freeze({
    ...decision,
    attempt: Object.freeze({ runId, responses }),
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
    });
  }
  return decision;
}
