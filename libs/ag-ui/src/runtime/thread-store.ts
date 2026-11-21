import type { PlainValue } from '@threadplane/core';
import { copyData } from './copy-data.js';
import type {
  CommandProps,
  NativeDecision,
  NativeResponse,
  OwnedInterrupt,
  PauseId,
} from './decision.js';
import type { InterruptTransport } from './interrupt-mode.js';
import {
  assertTranscriptIdentity,
  initialObservation,
  type Observation,
} from './session-observation.js';
import { NO_STATE } from './state.js';
import { earlierSubagents, type Subagents } from './subagents.js';
import { ownTranscript, type Transcript } from './transcript.js';

/** A pause as a thread record keeps it. */
export interface SavedPause {
  /** The run that paused. */
  readonly sourceRunId: string;
  readonly interrupts: readonly OwnedInterrupt[];
  /** Set when the pause is answered through `forwardedProps.command`. */
  readonly command?: {
    readonly transport: Exclude<InterruptTransport, 'protocol'>;
    readonly notice?: PlainValue;
  };
  /**
   * The answer that was sent, when one was. A record that still holds it was
   * saved before the answering run was known to have succeeded.
   */
  readonly attempt?: {
    readonly runId: string;
    readonly responses: readonly NativeResponse[];
    readonly forwardedProps?: CommandProps;
    /** The answering run reported `RUN_STARTED`. */
    readonly acknowledged?: true;
  };
}

/** What a session saves of its thread, as plain JSON data. */
export interface ThreadContent {
  /** The transcript, child-attributed records included. */
  readonly messages: Transcript;
  /** The state document. Absent for a session that has none yet. */
  readonly state?: PlainValue;
  /** Evidence of the child agents that have ended. */
  readonly subagents?: Subagents;
  /** The pause that is waiting, if any. */
  readonly pause?: SavedPause;
}

/** One saved thread, scoped by namespace and thread, with a revision for compare-and-swap writes. */
export interface ThreadRecord extends ThreadContent {
  readonly version: 1;
  readonly namespace: string;
  readonly threadId: string;
  readonly revision: number;
}

/** What an authoritative backend reports about a saved thread. */
export type ReconcileAnswer =
  | { readonly status: 'unknown' }
  | ({
      /**
       * - `pending`: the pause still waits; no answer arrived. `pause` is
       *   present and has no `attempt`.
       * - `acknowledged`: the answer arrived and its run started; how it ended
       *   is not known. `pause` is present with its `attempt`.
       * - `completed`: the answer's run ended. `pause` is absent, or is a new
       *   pause from another run.
       */
      readonly status: 'pending' | 'acknowledged' | 'completed';
    } & ThreadContent);

/** Application-owned durable storage for one session's thread. */
export interface SessionPersistence {
  /** Scopes the keys, so two applications sharing a store never collide. */
  readonly namespace: string;
  readonly store: {
    load(key: string): Promise<ThreadRecord | null>;
    /**
     * Writes `next` only when the stored revision is `expectedRevision`
     * (`null` for no record yet). Resolves whether it wrote.
     */
    compareAndSwap(
      key: string,
      expectedRevision: number | null,
      next: ThreadRecord
    ): Promise<boolean>;
  };
  /**
   * Asks the backend what became of the saved thread. Read-only: it must not
   * send the answer again. Enables `checkStatus` and `reconcileInterrupt`.
   */
  readonly reconcile?: (record: ThreadRecord) => Promise<ReconcileAnswer>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function nonempty(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError('Thread storage identifiers must be nonempty');
}

function ownPause(value: unknown): SavedPause | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError('Invalid saved pause');
  const pause = copyData(value, true) as SavedPause;
  nonempty(pause.sourceRunId);
  if (!Array.isArray(pause.interrupts) || !pause.interrupts.length)
    throw new TypeError('A saved pause needs its interrupts');
  const ids = new Set<string>();
  for (const interrupt of pause.interrupts) {
    const id: unknown = isRecord(interrupt) ? interrupt['id'] : undefined;
    nonempty(id);
    if (ids.has(id)) throw new TypeError('Duplicate saved interrupt id');
    ids.add(id);
  }
  const { command, attempt } = pause;
  if (
    command !== undefined &&
    (!isRecord(command) ||
      !['auto', 'legacy-command', 'mastra-command'].includes(command.transport))
  )
    throw new TypeError('Invalid saved command pause');
  if (attempt !== undefined) {
    if (!isRecord(attempt) || !Array.isArray(attempt.responses))
      throw new TypeError('Invalid saved answer');
    nonempty(attempt.runId);
    const answered = new Set<string>();
    for (const response of attempt.responses) {
      const id: unknown = isRecord(response)
        ? response['interruptId']
        : undefined;
      if (
        typeof id !== 'string' ||
        !ids.has(id) ||
        answered.has(id) ||
        (response.status !== 'resolved' && response.status !== 'cancelled')
      )
        throw new TypeError('A saved answer does not match its interrupts');
      answered.add(id);
    }
    if (answered.size !== ids.size)
      throw new TypeError('A saved answer does not match its interrupts');
    if (
      attempt.forwardedProps !== undefined &&
      !isRecord(attempt.forwardedProps.command)
    )
      throw new TypeError('Invalid saved command answer');
  }
  return pause;
}

/** Owns and checks the content of a record or of a reconciler's answer. */
export function ownContent(value: unknown): ThreadContent {
  if (!isRecord(value) || !Array.isArray(value['messages']))
    throw new TypeError('Invalid saved thread');
  const messages = ownTranscript(value['messages']);
  assertTranscriptIdentity(messages);
  const state = value['state'];
  const subagents = value['subagents'];
  const pause = ownPause(value['pause']);
  return Object.freeze({
    messages,
    ...(state !== undefined && { state: copyData(state, true) as PlainValue }),
    ...(subagents !== undefined && {
      subagents: copyData(subagents, true) as Subagents,
    }),
    ...(pause && { pause }),
  });
}

/** What the observation's thread is worth saving. Unanswerable pauses are not kept. */
export function contentOf(observation: Observation): ThreadContent {
  const decision = observation.decision;
  const subagents = earlierSubagents(
    observation.earlierSubagents,
    observation.subagents
  );
  return Object.freeze({
    messages: observation.transcript,
    ...(observation.state !== NO_STATE && { state: observation.state }),
    ...(subagents?.length && { subagents }),
    ...(decision?.kind === 'native' && {
      pause: Object.freeze({
        sourceRunId: decision.sourceRunId,
        interrupts: decision.interrupts,
        ...(decision.command && { command: decision.command }),
        ...(decision.attempt && { attempt: decision.attempt }),
      }),
    }),
  });
}

/**
 * The observation a saved thread restores to: idle, with its pause waiting. A
 * pause saved with its answer restores as an uncertain one, because the record
 * cannot say how the answering run ended.
 */
export function observationOf(content: ThreadContent): Observation {
  const initial = initialObservation(
    content.messages,
    content.state,
    content.subagents
  );
  const pause = content.pause;
  if (!pause) return initial;
  const decision: NativeDecision = Object.freeze({
    kind: 'native',
    id: crypto.randomUUID() as PauseId,
    sourceRunId: pause.sourceRunId,
    interrupts: pause.interrupts,
    ...(pause.command && { command: pause.command }),
    ...(pause.attempt && { attempt: pause.attempt }),
  });
  return Object.freeze({
    ...initial,
    decision,
    run: Object.freeze(
      pause.attempt
        ? { id: pause.attempt.runId, outcome: 'interrupted' as const }
        : { id: pause.sourceRunId, outcome: 'paused' as const }
    ),
  });
}

/**
 * One thread's record in the application's store. Operations run one at a
 * time. A write that loses its compare-and-swap is not retried: another writer
 * owns the thread until this one loads again.
 */
export function createThreadStore(
  config: SessionPersistence,
  threadId: string
) {
  nonempty(config.namespace);
  nonempty(threadId);
  const { namespace } = config;
  const key = JSON.stringify([namespace, threadId]);
  let record: ThreadRecord | null = null;
  let loaded = false;
  let conflicted = false;
  let queue: Promise<void> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
  const check = (value: unknown): ThreadRecord => {
    if (
      !isRecord(value) ||
      value['version'] !== 1 ||
      value['namespace'] !== namespace ||
      value['threadId'] !== threadId ||
      !Number.isSafeInteger(value['revision']) ||
      (value['revision'] as number) < 0
    )
      throw new TypeError('Invalid thread record identity or revision');
    return Object.freeze({
      ...ownContent(value),
      version: 1,
      namespace,
      threadId,
      revision: value['revision'] as number,
    });
  };
  const reload = async () => {
    const value = await config.store.load(key);
    record = value === null ? null : check(value);
    loaded = true;
    conflicted = false;
  };
  const write = async (content: ThreadContent) => {
    const expected = record?.revision ?? null;
    const next = check({
      ...content,
      version: 1,
      namespace,
      threadId,
      revision: expected === null ? 0 : expected + 1,
    });
    if (
      !(await config.store.compareAndSwap(
        key,
        expected,
        copyData(next, false) as ThreadRecord
      ))
    ) {
      conflicted = true;
      throw new Error(
        'Thread storage conflict: another writer owns this thread'
      );
    }
    record = next;
  };
  return {
    canReconcile: config.reconcile !== undefined,
    /** Reads the stored record, replacing what this owner remembers of it. */
    load: (): Promise<ThreadRecord | null> =>
      serialize(async () => {
        await reload();
        return record;
      }),
    /** `content` is already owned frozen data, captured by the caller. */
    save: (content: ThreadContent): Promise<void> =>
      serialize(async () => {
        if (conflicted)
          throw new Error(
            'Thread storage conflict: another writer owns this thread'
          );
        if (!loaded) await reload();
        await write(content);
      }),
    /**
     * Loads the latest record, asks the backend about it and stores the
     * answer. Resolves the stored record, or `null` when nothing is saved.
     * Rejects when the backend does not know, or answers inconsistently.
     */
    reconcile: (): Promise<ThreadRecord | null> =>
      serialize(async () => {
        await reload();
        const before = record;
        if (!before) return null;
        if (!config.reconcile)
          throw new Error('Recovery requires a persistence reconciler');
        const answer = await config.reconcile(
          copyData(before, false) as ThreadRecord
        );
        if (!isRecord(answer) || answer.status === 'unknown')
          throw new Error('Recovery requires an authoritative outcome');
        const content = ownContent(answer);
        const pause = content.pause;
        const { status } = answer;
        if (
          (status !== 'pending' &&
            status !== 'acknowledged' &&
            status !== 'completed') ||
          (status === 'pending' && (!pause || pause.attempt)) ||
          (status === 'acknowledged' && !pause?.attempt) ||
          (status === 'completed' &&
            pause &&
            (pause.attempt || pause.sourceRunId === before.pause?.sourceRunId))
        )
          throw new Error('Invalid authoritative recovery answer');
        await write(content);
        return record;
      }),
    /** Resolves when every operation queued so far has ended. */
    idle: (): Promise<void> => queue,
  };
}
