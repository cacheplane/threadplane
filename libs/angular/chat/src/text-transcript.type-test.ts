import type { InputSignal } from '@angular/core';
import type { Message } from '@threadplane/core';
import { TextTranscriptComponent } from './public-api';

type Rows = TextTranscriptComponent['messages'] extends InputSignal<infer T>
  ? T
  : never;
export function textTranscriptContracts(messages: readonly Message[]) {
  const narrow = [
    { id: 'a', role: 'assistant', content: 'Text', extra: true },
  ] as const;
  const accepted: Rows[] = [messages, narrow];
  // @ts-expect-error Supplied rows need IDs.
  const missingId: Rows = [{ role: 'user', content: 'Hello' }];
  const objectContent: Rows = [
    // @ts-expect-error Content must be a string.
    { id: 'a', role: 'user', content: { text: 'Hello' } },
  ];
  // @ts-expect-error Content is required.
  const missingContent: Rows = [{ id: 'a', role: 'user' }];
  // @ts-expect-error Readonly rows cannot be rewritten.
  accepted[0][0].content = 'changed';
  return [accepted, missingId, objectContent, missingContent];
}
