import type { Message } from '@threadplane/core';
import type { Transcript } from './transcript';

export type TextTranscriptRow = Readonly<
  Pick<Message, 'id' | 'content'> & {
    role: 'user' | 'assistant';
  }
>;

const empty: readonly TextTranscriptRow[] = Object.freeze([]);

/** Display only: request history remains owned by the session. Selection is O(N).
 * Previous output is an optional, disposable current-row identity hint. */
export function projectTextTranscript(
  transcript: Transcript,
  previous: readonly TextTranscriptRow[] = empty
): readonly TextTranscriptRow[] {
  const prior = new Map(previous.map((row) => [row.id, row]));
  const rows: TextTranscriptRow[] = [];
  for (const message of transcript) {
    const { id, role, content, subagentRunId } = message;
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof subagentRunId === 'string'
    )
      continue;
    const text =
      typeof content === 'string'
        ? content
        : role === 'user' && Array.isArray(content)
        ? content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : '';
    if (text === '') continue;
    const old = prior.get(id);
    rows.push(
      old?.role === role && old.content === text
        ? old
        : Object.freeze({ id, role, content: text })
    );
  }
  return rows.length === previous.length &&
    rows.every((row, index) => row === previous[index])
    ? previous
    : Object.freeze(rows);
}
