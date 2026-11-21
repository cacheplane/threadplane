import type { Message } from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { copyData } from './copy-data.js';

/** A thread's protocol messages, in order and frozen. */
export type Transcript = readonly DeepReadonly<Message>[];

/**
 * True for an activity record and a tool result. Those two are named
 * independently: a backend may give a delegation's activity record the
 * identifier of that delegation's tool result, and the transcript then holds
 * one record of each. Any other two records with one identifier are the same
 * record.
 */
export function namedApart(
  a: Transcript[number]['role'],
  b: Transcript[number]['role']
): boolean {
  return (
    (a === 'activity' && b === 'tool') || (a === 'tool' && b === 'activity')
  );
}

/** Captures full observed protocol data without interpreting or normalizing it. */
export function ownTranscript(
  messages: readonly Message[] | Transcript
): Transcript {
  return copyData(messages, true) as Transcript;
}

/** Explicit SDK preparation policy; each request owns its mutable data graph. */
export function requestMessages(transcript: Transcript): Message[] {
  const selected = [];
  // Skip holes as filter did, without interpreting own filter/constructor data.
  for (let index = 0; index < transcript.length; index++) {
    if (Object.hasOwn(transcript, index)) {
      const message = transcript[index];
      if (message.role !== 'activity') selected.push(message);
    }
  }
  const messages = copyData(selected, false) as Message[];
  for (const message of messages) {
    if (message.subagentRunId === null) delete message.subagentRunId;
  }
  return messages;
}
