import type { ReactNode } from 'react';
import type { Message } from '@threadplane/core';
import {
  approvalRecordsByRow,
  renderApprovalRecords,
  type ApprovalRecordEntry,
} from './approval-card.js';

/** Readonly text rows with IDs unique within this list. Lifetime belongs to the caller. */
export interface TextTranscriptProps {
  readonly messages: readonly Pick<Message, 'id' | 'role' | 'content'>[];
  readonly label?: string;
  /** Answered approvals as one-line records after the message each follows; see `MessageListProps.approvalRecords`. */
  readonly approvalRecords?: readonly ApprovalRecordEntry[];
  /** Application-owned content after the messages, such as a pending `ApprovalCard`. */
  readonly children?: ReactNode;
}
const speakers = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

/** Renders messages as an ordered plain-text transcript with speaker labels and preserved whitespace. */
export function TextTranscript({
  messages,
  label = 'Conversation',
  approvalRecords,
  children,
}: TextTranscriptProps) {
  const records = approvalRecordsByRow(
    approvalRecords,
    messages.map((message) => message.id)
  );
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
            {renderApprovalRecords(records, message.id)}
          </li>
        ))}
      </ol>
      {renderApprovalRecords(records, undefined)}
      {children}
    </section>
  );
}
