import type {
  AGUIEvent,
  Message,
  RunFinishedEvent,
  RunErrorEvent,
  CustomEvent,
} from '@ag-ui/client';
import type {
  CompleteOutcome,
  DeepReadonly,
  PlainValue,
} from '@threadplane/core';
import { ownTranscript, type Transcript } from './transcript';
import { applySubagent, type Subagents } from './subagents';
import { ownState, applyState } from './state';
import { reconcileTranscript } from './reconcile-transcript';
import { applyTextMessage } from './text-messages';
import { applyToolMessage } from './tool-messages';
import { applyActivityMessage } from './activity-messages';
import { applyEncryptedValue } from './encrypted-messages';
import { copyData } from '../lib/internal/copy-data';
import { assertAttribution } from './session-attribution';
import type { Decision } from './decision';
import {
  isLegacyInterruptTerminal,
  type InterruptMode,
} from './interrupt-mode';

export type OwnedLegacyInterrupt = DeepReadonly<
  Pick<CustomEvent, 'type' | 'name' | 'value' | 'timestamp' | 'metadata'>
>;

export type OwnedRootTerminal = DeepReadonly<
  | Pick<
      RunFinishedEvent,
      | 'type'
      | 'threadId'
      | 'runId'
      | 'result'
      | 'outcome'
      | 'timestamp'
      | 'metadata'
    >
  | Pick<RunErrorEvent, 'type' | 'message' | 'code' | 'timestamp' | 'metadata'>
  | Pick<CustomEvent, 'type' | 'name' | 'value' | 'timestamp' | 'metadata'>
>;
export interface SessionSnapshot {
  readonly status: 'idle' | 'running' | 'error';
  readonly transcript: Transcript;
  readonly state: PlainValue;
  readonly subagents: Subagents;
  readonly decision?: Decision;
  readonly run?: {
    readonly id: string;
    readonly outcome?: CompleteOutcome;
    readonly terminal?: OwnedRootTerminal;
    readonly legacyInterrupt?: OwnedLegacyInterrupt;
  };
}
/** Session policy, not an SDK guarantee: identifiers are global in history. */
export function assertTranscriptIdentity(transcript: Transcript): void {
  const messages = new Set<string>();
  const calls = new Set<string>();
  for (const message of transcript) {
    if (messages.has(message.id)) throw new TypeError('Duplicate message ID');
    messages.add(message.id);
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) {
      if (calls.has(call.id)) throw new TypeError('Duplicate tool call ID');
      calls.add(call.id);
    }
  }
}
export function initialObservation(
  messages: readonly Message[] | Transcript = [],
  state: unknown = {}
): SessionSnapshot {
  const transcript = ownTranscript(messages);
  assertTranscriptIdentity(transcript);
  return Object.freeze({
    status: 'idle',
    transcript,
    state: ownState(state),
    subagents: Object.freeze([]),
  });
}

/** Input is a stable SDK-normalized event; this is selection, not validation.
 * RAW, STEP, REASONING_START/END and other CUSTOM events have no retained
 * projection in this slice. Child state still updates the one shared document. */
export function applyObservation(
  previous: SessionSnapshot,
  event: AGUIEvent,
  interruptMode: InterruptMode = 'native'
): SessionSnapshot {
  assertAttribution(previous.transcript, event);
  let { transcript, state, subagents, run } = previous;
  switch (event.type) {
    case 'MESSAGES_SNAPSHOT':
      transcript = reconcileTranscript(transcript, event.messages);
      assertTranscriptIdentity(transcript);
      break;
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_CONTENT':
    case 'TEXT_MESSAGE_END':
    case 'REASONING_MESSAGE_START':
    case 'REASONING_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_END':
      transcript = applyTextMessage(transcript, event);
      break;
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END':
    case 'TOOL_CALL_RESULT':
      transcript = applyToolMessage(transcript, event);
      break;
    case 'ACTIVITY_SNAPSHOT':
    case 'ACTIVITY_DELTA':
      transcript = applyActivityMessage(transcript, event);
      break;
    case 'REASONING_ENCRYPTED_VALUE':
      transcript = applyEncryptedValue(transcript, event);
      break;
    case 'STATE_SNAPSHOT':
    case 'STATE_DELTA':
      state = applyState(state, event);
      break;
    case 'SUBAGENT_STARTED':
    case 'SUBAGENT_FINISHED':
    case 'SUBAGENT_ERROR':
      subagents = applySubagent(subagents, event);
      break;
    case 'RUN_FINISHED':
    case 'RUN_ERROR':
    case 'CUSTOM': {
      if (!run || typeof event.subagentRunId === 'string') break;
      const { type } = event;
      const name = type === 'CUSTOM' ? event.name : undefined;
      if (type === 'CUSTOM' && name !== 'on_interrupt') break;
      const { timestamp, metadata } = event;
      const common = {
        ...(timestamp !== undefined && { timestamp }),
        ...(metadata !== undefined && { metadata }),
      };
      let selected: OwnedRootTerminal;
      if (type === 'RUN_FINISHED') {
        const { threadId, runId, result, outcome } = event;
        selected = {
          type,
          threadId,
          runId,
          ...common,
          ...(result !== undefined && { result }),
          ...(outcome !== undefined && { outcome }),
        };
      } else if (type === 'RUN_ERROR') {
        const { message, code } = event;
        selected = {
          type,
          message,
          ...common,
          ...(code !== undefined && { code }),
        };
      } else {
        const { value } = event;
        selected = { type, name: name as string, value, ...common };
      }
      const owned = copyData(selected, true) as OwnedRootTerminal;
      run = Object.freeze(
        type === 'CUSTOM'
          ? {
              ...run,
              legacyInterrupt: owned as OwnedLegacyInterrupt,
              ...(isLegacyInterruptTerminal(event, interruptMode) && {
                terminal: owned,
              }),
            }
          : { ...run, terminal: owned }
      );
      break;
    }
  }
  if (
    transcript === previous.transcript &&
    Object.is(state, previous.state) &&
    subagents === previous.subagents &&
    run === previous.run
  )
    return previous;
  return Object.freeze({
    ...previous,
    transcript,
    state,
    subagents,
    ...(run && { run }),
  });
}
