import type { Message } from '@threadplane/core';
import { TextTranscript, type TextTranscriptProps } from './index';

export function textTranscriptContracts(messages: readonly Message[]) {
  const narrow = [
    { id: 'a', role: 'assistant', content: 'Text', extra: true },
  ] as const;
  const props: TextTranscriptProps = { messages: narrow, label: 'Review' };
  // @ts-expect-error Props remain readonly.
  props.messages = [];
  const missingId = (
    // @ts-expect-error Supplied rows need IDs.
    <TextTranscript messages={[{ role: 'user', content: 'Hello' }]} />
  );
  const objectContent = (
    <TextTranscript
      // @ts-expect-error Content must be a string.
      messages={[{ id: 'a', role: 'user', content: { text: 'Hello' } }]}
    />
  );
  const missingContent = (
    // @ts-expect-error Content is required.
    <TextTranscript messages={[{ id: 'a', role: 'user' }]} />
  );
  const command = (
    // @ts-expect-error No session or command props.
    <TextTranscript messages={messages} submit={() => undefined} />
  );
  return [
    <TextTranscript messages={messages} />,
    <TextTranscript {...props} />,
    missingId,
    objectContent,
    missingContent,
    command,
  ];
}
