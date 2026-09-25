import type { Message } from '@ag-ui/client';
import type { DeepReadonly } from '@threadplane/core';
import { copyData } from '../lib/internal/copy-data';

export type Transcript = readonly DeepReadonly<Message>[];

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
