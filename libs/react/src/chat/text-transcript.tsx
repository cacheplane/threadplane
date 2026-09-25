import type { Message } from '@threadplane/core';

/** Readonly text rows with IDs unique within this list. Lifetime belongs to the caller. */
export interface TextTranscriptProps {
  readonly messages: readonly Pick<Message, 'id' | 'role' | 'content'>[];
  readonly label?: string;
}
const speakers = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

export function TextTranscript({
  messages,
  label = 'Conversation',
}: TextTranscriptProps) {
  return (
    <section
      aria-label={label}
      style={{
        color: 'var(--ds-text-primary, #142435)',
        fontFamily: 'inherit',
      }}
    >
      {/* Explicit role preserves list semantics when markers are hidden in WebKit. */}
      <ol role="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {messages.map((message) => (
          <li key={message.id} style={{ marginBlock: '1rem' }}>
            <span style={{ fontWeight: 600 }}>{speakers[message.role]}</span>
            <p
              style={{
                marginBlock: '.25rem',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {message.content}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
