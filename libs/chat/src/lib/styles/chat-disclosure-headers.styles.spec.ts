// libs/chat/src/lib/styles/chat-disclosure-headers.styles.spec.ts
import { describe, expect, it } from 'vitest';
import { CHAT_REASONING_STYLES } from './chat-reasoning.styles';
import { CHAT_TRACE_STYLES } from './chat-trace.styles';

describe.each([
  ['chat-trace', CHAT_TRACE_STYLES, 'chat-trace__header'],
  ['chat-reasoning', CHAT_REASONING_STYLES, 'chat-reasoning__header'],
])('%s disclosure header', (_name, styles, className) => {
  const normalized = styles.replace(/\s+/g, ' ');

  it('draws a visible focus ring for keyboard focus', () => {
    expect(normalized).toMatch(
      new RegExp(
        `\\.${className}:focus-visible\\s*\\{[^}]*outline:\\s*2px\\s+solid\\s+var\\(--tplane-chat-primary\\)\\s*;`,
      ),
    );
  });

  it('is a target at least 24px tall', () => {
    expect(normalized).toMatch(
      new RegExp(`\\.${className}\\s*\\{[^}]*min-height:\\s*24px\\s*;`),
    );
  });
});
