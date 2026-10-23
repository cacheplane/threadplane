import type { AGUIEvent } from '@ag-ui/client';
import type { ToolContract } from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data.js';
import type { ClientToolBlocker, ClientToolCall } from './client-tools.js';
import { assertTranscriptIdentity } from './session-observation.js';
import { ownTranscript, type Transcript } from './transcript.js';

type Assistant = Extract<Transcript[number], { role: 'assistant' }>;
type ToolMessage = Extract<Transcript[number], { role: 'tool' }>;
interface Invocation {
  id: string;
  owner: Assistant;
  name: string;
  raw: string;
  child?: string;
  args?: unknown;
  error?: string;
  identity: string;
}
interface Physical {
  runId: string;
  threadId: string;
  baseline: Set<string>;
  baselineTranscript: Transcript;
  transcript: Transcript;
  seen: Map<string, Invocation>;
  finalized: Set<string>;
  ended: Set<string>;
  backendResults: Set<string>;
  started: boolean;
  success: boolean;
  paused: boolean;
  pendingDeclared: boolean;
  pending?: unknown;
  processed: boolean;
}
export interface ClientToolRequestCapture {
  readonly transcript: Transcript;
  readonly resultMessageIds: readonly string[];
}

/** JSON invocation equality ignores formatting and object key order, never raw
 * malformed input. Entry arrays avoid treating __proto__/constructor as code. */
function canonical(value: unknown): string {
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || Object.is(value, -0))
  )
    return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical(
          (value as Record<string, unknown>)[key]
        )}`
    )
    .join(',')}}`;
}
function invocations(transcript: Transcript): Invocation[] {
  assertTranscriptIdentity(transcript);
  const result: Invocation[] = [];
  for (const owner of transcript) {
    if (owner.role !== 'assistant') continue;
    for (const call of owner.toolCalls ?? []) {
      const raw = call.function.arguments;
      let args: unknown;
      let error: string | undefined;
      try {
        args = copyData(JSON.parse(raw), true);
      } catch {
        error = 'Invalid JSON arguments';
      }
      result.push({
        id: call.id,
        owner,
        name: call.function.name,
        raw,
        ...(typeof owner.subagentRunId === 'string' && {
          child: owner.subagentRunId,
        }),
        ...(error ? { error } : { args }),
        identity: error ? `raw:${raw}` : `json:${canonical(args)}`,
      });
    }
  }
  return result;
}
function sameOwner(a: Invocation, b: Invocation): boolean {
  return a.owner.id === b.owner.id && a.name === b.name && a.child === b.child;
}
function sameInvocation(a: Invocation, b: Invocation): boolean {
  return sameOwner(a, b) && a.identity === b.identity;
}
function backendResult(transcript: Transcript, call: Invocation): boolean {
  return transcript.some(
    (message) =>
      message.role === 'tool' &&
      message.toolCallId === call.id &&
      (typeof message.subagentRunId === 'string'
        ? message.subagentRunId
        : undefined) === call.child
  );
}
/** Result wire encoding must not silently discard undefined fields, symbols,
 * array holes/extra keys, non-finite numbers or custom serialization. */
function assertEncodable(value: unknown, top = true): void {
  if (value === undefined && top) return;
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null)
    throw new TypeError('Result cannot be encoded losslessly');
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError('Result contains symbol keys');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      throw new TypeError('Result contains array holes or extra keys');
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        throw new TypeError('Result contains array holes');
      assertEncodable(value[index], false);
    }
  } else
    for (const key of Object.keys(value))
      assertEncodable((value as Record<string, unknown>)[key], false);
}

/** Own result data in one traversal, rejecting symbols at every depth before
 * they could be discarded. copyData's plain-data/prototype policy is retained. */
function ownResult(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value !== 'object') return copyData(value, true);
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError('Result contains symbol keys');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    throw new TypeError('Result must use plain objects or arrays');
  if (ancestors.has(value)) throw new TypeError('Result must be acyclic');
  ancestors.add(value);
  try {
    const copied = array ? new Array(value.length) : Object.create(prototype);
    for (const key of Object.keys(value))
      Object.defineProperty(copied, key, {
        value: ownResult((value as Record<string, unknown>)[key], ancestors),
        enumerable: true,
      });
    return Object.freeze(copied);
  } finally {
    ancestors.delete(value);
  }
}

/** Session-lifetime facts only. The command owner executes handlers, decides
 * cancellation/continuation and invokes the fetch guard; this module does not. */
export function createClientToolLedger<C extends Record<string, ToolContract>>(
  names: readonly (keyof C & string)[],
  initial: Transcript
) {
  const catalog = new Set<string>(names);
  const attempts = new WeakMap<object, Physical>();
  const captures = new WeakMap<
    ClientToolRequestCapture,
    readonly ToolMessage[]
  >();
  const consumed = new Map<string, Invocation>();
  const calls = new Map<string, ClientToolCall<C>>();
  const results = new Map<string, ToolMessage>();
  // Keep only observed placement facts for omitted messages. Their native
  // content is not retained or reconstructed; only legitimate local owners and
  // results survive omission. This preserves their position between anchors.
  const ownedOrder: string[] = [];
  const ownedRoles = new Map<string, Transcript[number]['role']>();
  const rememberOrder = (history: Transcript) => {
    for (let index = 0; index < history.length; index++) {
      const message = history[index];
      if (ownedRoles.has(message.id)) continue;
      const following = history
        .slice(index + 1)
        .find((candidate) => ownedRoles.has(candidate.id));
      const insertion = following
        ? ownedOrder.indexOf(following.id)
        : ownedOrder.length;
      ownedOrder.splice(insertion, 0, message.id);
      ownedRoles.set(message.id, message.role);
    }
  };
  rememberOrder(ownTranscript(initial));
  let blocker: ClientToolBlocker | undefined;
  let latestRunId = '';
  let activePhysical: object | undefined;
  const block = (
    reason: ClientToolBlocker['reason'],
    callIds: readonly string[],
    sourceRunId = latestRunId
  ) => {
    blocker ??= Object.freeze({
      reason,
      sourceRunId,
      callIds: Object.freeze([...callIds]),
    });
  };
  const physicalFor = (token: object) => {
    const physical = attempts.get(token);
    if (!physical) throw new TypeError('Unknown physical request');
    return physical;
  };
  const change = (id: string, fields: Partial<ClientToolCall<C>>) => {
    const previous = calls.get(id);
    if (!previous) throw new TypeError('Call has not been admitted');
    calls.set(
      id,
      Object.freeze({ ...previous, ...fields }) as ClientToolCall<C>
    );
  };
  const invocationFor = (id: string): Invocation => {
    const invocation = consumed.get(id);
    if (!invocation) throw new TypeError('Call has not been admitted');
    return invocation;
  };
  const validateConsumed = (history: Transcript) => {
    for (const invocation of invocations(history)) {
      const previous = consumed.get(invocation.id);
      if (previous && !sameInvocation(previous, invocation))
        block('conflict', [invocation.id]);
    }
  };
  const integrity = (
    history: Transcript,
    selected: readonly string[] = [],
    sourceRunId = latestRunId
  ) => {
    validateConsumed(history);
    const unresolved = invocations(history).filter(
      (call) =>
        !call.child &&
        !backendResult(history, call) &&
        !(
          results.has(call.id) && sameInvocation(invocationFor(call.id), call)
        ) &&
        !selected.includes(call.id)
    );
    if (unresolved.length)
      block(
        'unsupported',
        unresolved.map((call) => call.id),
        sourceRunId
      );
    return !blocker;
  };
  const observeEchoes = (history: Transcript) => {
    for (const [id, result] of results) {
      for (const message of history) {
        if (
          message.id === result.id ||
          (message.role === 'tool' && message.toolCallId === id)
        ) {
          if (
            message.role !== 'tool' ||
            message.id !== result.id ||
            message.toolCallId !== id ||
            message.content !== result.content ||
            typeof message.subagentRunId === 'string'
          )
            block('conflict', [id]);
          else
            change(id, { delivery: 'observed' } as Partial<ClientToolCall<C>>);
        }
      }
    }
  };
  const overlayHistory = (
    nativeHistory: Transcript,
    nativeEcho: boolean
  ): Transcript => {
    const history = ownTranscript(nativeHistory);
    rememberOrder(history);
    validateConsumed(history);
    // Conflicts are checked even for request preparation; acknowledgement only
    // comes from explicitly native evidence.
    if (nativeEcho) observeEchoes(history);
    else
      for (const [id, result] of results)
        for (const message of history) {
          if (
            (message.id === result.id ||
              (message.role === 'tool' && message.toolCallId === id)) &&
            (message.role !== 'tool' ||
              message.id !== result.id ||
              message.toolCallId !== id ||
              message.content !== result.content ||
              typeof message.subagentRunId === 'string')
          )
            block('conflict', [id]);
        }
    const protectedMessages = new Map<string, Transcript[number]>();
    for (const [id, result] of results) {
      const invocation = invocationFor(id);
      // Preserve the legitimate result's owning assistant if an authoritative
      // native snapshot omitted it. Never manufacture an owner for pending calls.
      const currentOwner = history.find(
        (message) => message.id === invocation.owner.id
      );
      if (currentOwner && !invocations(history).some((call) => call.id === id))
        block('conflict', [id]);
      protectedMessages.set(
        invocation.owner.id,
        currentOwner ?? invocation.owner
      );
      protectedMessages.set(result.id, result);
    }
    // Restore protected rows before their surviving later anchors. With no
    // anchors, their prior owned order still precedes newly observed rows.
    // Keep the current native rows in their supplied order.
    const retained = history.filter(
      (message) => !protectedMessages.has(message.id)
    );
    const positions = new Map(ownedOrder.map((id, index) => [id, index]));
    for (const id of ownedOrder) {
      const protectedMessage = protectedMessages.get(id);
      if (!protectedMessage) continue;
      const position = positions.get(id) ?? ownedOrder.length;
      const insertion = retained.findIndex(
        (message) => (positions.get(message.id) ?? ownedOrder.length) > position
      );
      retained.splice(
        insertion === -1 ? retained.length : insertion,
        0,
        protectedMessage
      );
    }
    return ownTranscript(retained);
  };
  const finish = (
    id: string,
    messageId: string,
    history: Transcript,
    value: unknown,
    failure?: string,
    completionAuthority?: () => boolean
  ) => {
    if (completionAuthority?.() === false)
      throw new TypeError('Call lost command completion authority');
    const invocation = consumed.get(id);
    const projection = calls.get(id);
    if (
      !invocation ||
      !projection ||
      !['pending', 'running'].includes(projection.status) ||
      blocker
    )
      throw new TypeError('Call has no completion authority');
    validateConsumed(history);
    if (blocker)
      throw new TypeError('Invocation conflicts with retained history');
    if (
      ownedRoles.has(messageId) ||
      history.some((message) => message.id === messageId) ||
      [...results.values()].some((message) => message.id === messageId)
    ) {
      block('conflict', [id]);
      throw new TypeError('Local result message ID collision');
    }
    let captured: unknown;
    let error = failure ?? invocation.error;
    let content: string;
    try {
      // Copy before encoding: custom getter results are read once, and neither
      // JSON encoding nor a caller can mutate the retained typed value.
      captured = ownResult(value);
      assertEncodable(captured);
      content =
        typeof captured === 'string'
          ? captured
          : captured === undefined
          ? ''
          : JSON.stringify(captured);
    } catch {
      error ??= 'Client tool result is not portable or encodable';
      content = '';
    }
    if (error !== undefined) content = `Error: ${error}`;
    // Getter evaluation can reenter the command owner. Completion must not
    // overwrite a cancellation, blocker or another legitimate completion.
    if (
      completionAuthority?.() === false ||
      blocker ||
      calls.get(id) !== projection
    )
      throw new TypeError(
        'Call lost completion authority while copying result'
      );
    const message = Object.freeze({
      id: messageId,
      role: 'tool' as const,
      toolCallId: id,
      content,
    });
    results.set(id, message);
    // An authored tool message belongs directly after its assistant's existing
    // result rows, even if a later native snapshot has already omitted them.
    rememberOrder(ownTranscript(history));
    let insertion = ownedOrder.indexOf(invocation.owner.id) + 1;
    while (
      insertion < ownedOrder.length &&
      ownedRoles.get(ownedOrder[insertion]) === 'tool'
    )
      insertion++;
    ownedOrder.splice(insertion, 0, messageId);
    ownedRoles.set(messageId, 'tool');
    change(
      id,
      error !== undefined
        ? ({ status: 'error', error, delivery: 'unsent' } as Partial<
            ClientToolCall<C>
          >)
        : ({
            status: 'complete',
            result: captured,
            delivery: 'unsent',
          } as Partial<ClientToolCall<C>>)
    );
    return message;
  };
  integrity(ownTranscript(initial), [], '');
  return {
    startPhysical(input: {
      runId: string;
      threadId: string;
      transcript: Transcript;
    }): object {
      const transcript = ownTranscript(input.transcript);
      const token = Object.freeze({});
      activePhysical = token;
      latestRunId = input.runId;
      attempts.set(token, {
        runId: input.runId,
        threadId: input.threadId,
        transcript,
        baselineTranscript: transcript,
        baseline: new Set(invocations(transcript).map((call) => call.id)),
        seen: new Map(),
        finalized: new Set(),
        ended: new Set(),
        backendResults: new Set(),
        started: false,
        success: false,
        paused: false,
        pendingDeclared: false,
        processed: false,
      });
      return token;
    },
    /** Call after the existing observation owner has applied a normalized event. */
    observe(token: object, event: AGUIEvent, observed: Transcript): void {
      const physical = physicalFor(token);
      if (physical.processed || activePhysical !== token) return;
      physical.transcript = ownTranscript(observed);
      const child =
        'subagentRunId' in event && typeof event.subagentRunId === 'string';
      if (event.type === 'RUN_STARTED') {
        physical.started =
          !child &&
          event.runId === physical.runId &&
          event.threadId === physical.threadId;
      }
      if (event.type === 'RUN_FINISHED') {
        physical.paused =
          physical.started &&
          !child &&
          event.runId === physical.runId &&
          event.threadId === physical.threadId &&
          event.outcome?.type === 'interrupt';
        physical.success =
          physical.started &&
          !child &&
          event.runId === physical.runId &&
          event.threadId === physical.threadId &&
          (event.outcome == null || event.outcome.type === 'success');
        if (
          physical.success &&
          event.outcome?.type === 'success' &&
          Object.hasOwn(event.outcome, 'pendingToolCallIds')
        ) {
          physical.pendingDeclared = true;
          physical.pending = copyData(event.outcome.pendingToolCallIds, true);
        }
      } else if (event.type === 'RUN_ERROR') physical.success = false;
      if (event.type === 'TOOL_CALL_END' && !child)
        physical.ended.add(event.toolCallId);
      for (const message of physical.transcript)
        if (
          message.role === 'tool' &&
          typeof message.subagentRunId !== 'string'
        )
          physical.backendResults.add(message.toolCallId);
      if (
        event.type === 'TOOL_CALL_START' ||
        event.type === 'TOOL_CALL_ARGS' ||
        event.type === 'TOOL_CALL_END'
      ) {
        const target = invocations(physical.transcript).find(
          (call) => call.id === event.toolCallId
        );
        const tag =
          'subagentRunId' in event && typeof event.subagentRunId === 'string'
            ? event.subagentRunId
            : undefined;
        if (
          target &&
          (target.child !== tag ||
            (event.type === 'TOOL_CALL_START' &&
              (target.name !== event.toolCallName ||
                (typeof event.parentMessageId === 'string' &&
                  target.owner.id !== event.parentMessageId))))
        )
          block('conflict', [event.toolCallId], physical.runId);
      }
      for (const invocation of invocations(physical.transcript)) {
        if (physical.baseline.has(invocation.id)) continue;
        const previous = physical.seen.get(invocation.id);
        if (previous && !sameOwner(previous, invocation))
          block('conflict', [invocation.id], physical.runId);
        else if (!previous) physical.seen.set(invocation.id, invocation);
      }
      if (event.type === 'MESSAGES_SNAPSHOT') {
        physical.finalized = new Set(
          invocations(ownTranscript(event.messages)).map((call) => call.id)
        );
        observeEchoes(ownTranscript(event.messages));
      } else if (event.type === 'TOOL_CALL_RESULT') {
        observeEchoes(
          ownTranscript(
            physical.transcript.filter(
              (message) => message.id === event.messageId
            )
          )
        );
      }
      physical.transcript = overlayHistory(physical.transcript, false);
    },
    admitSuccess(token: object, allowGroup = true): readonly string[] {
      const physical = physicalFor(token);
      if (
        physical.processed ||
        activePhysical !== token ||
        !physical.success ||
        blocker
      )
        return Object.freeze([]);
      physical.processed = true;
      validateConsumed(physical.transcript);
      const current = invocations(physical.transcript);
      const eligible = current.filter(
        (call) =>
          !call.child &&
          !physical.baseline.has(call.id) &&
          physical.seen.has(call.id) &&
          (physical.finalized.has(call.id) ||
            (physical.ended.has(call.id) && !call.error)) &&
          !backendResult(physical.transcript, call) &&
          !physical.backendResults.has(call.id) &&
          !consumed.has(call.id)
      );
      let selected = eligible;
      if (physical.pendingDeclared) {
        const ids = physical.pending;
        if (
          !Array.isArray(ids) ||
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) =>
              typeof id !== 'string' ||
              (!eligible.some((call) => call.id === id) &&
                !(
                  consumed.has(id) &&
                  results.has(id) &&
                  current.some(
                    (call) =>
                      call.id === id && sameInvocation(invocationFor(id), call)
                  )
                ))
          )
        ) {
          block(
            'conflict',
            Array.isArray(ids)
              ? ids.filter((id): id is string => typeof id === 'string')
              : [],
            physical.runId
          );
          return Object.freeze([]);
        }
        selected = eligible.filter((call) => ids.includes(call.id));
      }
      const unknown = selected.filter((call) => !catalog.has(call.name));
      if (unknown.length)
        block(
          'unsupported',
          unknown.map((call) => call.id),
          physical.runId
        );
      if (
        !integrity(
          physical.transcript,
          selected.map((call) => call.id),
          physical.runId
        )
      )
        return Object.freeze([]);
      if (selected.length && !allowGroup) {
        block(
          'limit',
          selected.map((call) => call.id),
          physical.runId
        );
        return Object.freeze([]);
      }
      for (const call of selected) {
        consumed.set(call.id, call);
        calls.set(
          call.id,
          Object.freeze({
            name: call.name,
            callId: call.id,
            assistantMessageId: call.owner.id,
            sourceRunId: physical.runId,
            rawArguments: call.raw,
            ...(call.error ? { error: call.error } : { args: call.args }),
            status: 'pending',
            delivery: 'unsent',
            provenance: 'local',
          }) as ClientToolCall<C>
        );
      }
      return Object.freeze(selected.map((call) => call.id));
    },
    snapshot(): {
      readonly calls: readonly ClientToolCall<C>[];
      readonly blocker?: ClientToolBlocker;
    } {
      return Object.freeze({
        calls: Object.freeze([...calls.values()]),
        ...(blocker && { blocker }),
      });
    },
    /** The command owner supplies uncertainty/limit facts; first blocker wins. */
    installBlocker(fact: ClientToolBlocker): void {
      block(fact.reason, fact.callIds, fact.sourceRunId);
    },
    argumentsFor(id: string): unknown {
      const call = consumed.get(id);
      if (!call || call.error) throw new TypeError('No decoded arguments');
      return copyData(call.args, false);
    },
    markRunning(id: string): void {
      if (
        blocker ||
        calls.get(id)?.status !== 'pending' ||
        consumed.get(id)?.error
      )
        throw new TypeError('Call cannot run');
      change(id, { status: 'running' } as Partial<ClientToolCall<C>>);
    },
    complete(
      id: string,
      messageId: string,
      value: unknown,
      history: Transcript,
      completionAuthority?: () => boolean
    ): ToolMessage {
      return finish(
        id,
        messageId,
        history,
        value,
        undefined,
        completionAuthority
      );
    },
    fail(
      id: string,
      messageId: string,
      error: string,
      history: Transcript,
      completionAuthority?: () => boolean
    ): ToolMessage {
      return finish(
        id,
        messageId,
        history,
        undefined,
        error,
        completionAuthority
      );
    },
    cancelIncomplete(sourceRunId: string): void {
      const incomplete = [...calls.values()].filter(
        (call) => call.status === 'pending' || call.status === 'running'
      );
      for (const call of incomplete)
        change(call.callId, { status: 'cancelled' } as Partial<
          ClientToolCall<C>
        >);
      if (incomplete.length)
        block(
          'cancelled',
          incomplete.map((call) => call.callId),
          sourceRunId
        );
    },
    /** Overlay local facts; carrying one's own result is not a native echo. */
    retainHistory(history: Transcript): Transcript {
      return overlayHistory(history, false);
    },
    /** Only pass native messages from normalized snapshot/result observations. */
    reconcileNativeHistory(history: Transcript): Transcript {
      return overlayHistory(history, true);
    },
    historyIntegrity(history: Transcript): boolean {
      return integrity(overlayHistory(history, false));
    },
    captureRequest(history: Transcript): ClientToolRequestCapture {
      const transcript = overlayHistory(history, false);
      if (!integrity(transcript))
        throw new TypeError('Request history is blocked');
      const batch = Object.freeze(
        [...results.values()].filter((result) =>
          transcript.some((message) => message.id === result.id)
        )
      );
      const capture = Object.freeze({
        transcript,
        resultMessageIds: Object.freeze(batch.map((result) => result.id)),
      });
      captures.set(capture, batch);
      return capture;
    },
    /** The owner must correlate and claim the native decision first. Only the
     * exact unresolved invocations observed at that physical pause may travel
     * as baseline; this grants no admission or handler authority. */
    captureNativeResumeRequest(
      history: Transcript,
      pauseToken: object
    ): ClientToolRequestCapture {
      const paused = physicalFor(pauseToken);
      const transcript = overlayHistory(history, false);
      if (!paused.paused || blocker)
        throw new TypeError('No owned native pause');
      const prior = invocations(paused.transcript);
      const unresolved = invocations(transcript).filter(
        (call) =>
          !call.child &&
          !backendResult(transcript, call) &&
          !results.has(call.id)
      );
      if (
        unresolved.some(
          (call) =>
            !prior.some(
              (previous) =>
                previous.id === call.id && sameInvocation(previous, call)
            )
        )
      ) {
        block(
          'conflict',
          unresolved.map((call) => call.id),
          paused.runId
        );
        throw new TypeError('Resume history differs from owned pause');
      }
      const batch = Object.freeze(
        [...results.values()].filter((result) =>
          transcript.some((message) => message.id === result.id)
        )
      );
      const capture = Object.freeze({
        transcript,
        resultMessageIds: Object.freeze(batch.map((result) => result.id)),
      });
      captures.set(capture, batch);
      return capture;
    },
    markFetchInvoked(capture: ClientToolRequestCapture): void {
      const batch = captures.get(capture);
      if (!batch) throw new TypeError('Unknown request capture');
      for (const message of batch)
        if (calls.get(message.toolCallId)?.delivery !== 'observed')
          change(message.toolCallId, {
            delivery: 'sent-unconfirmed',
          } as Partial<ClientToolCall<C>>);
    },
  };
}
