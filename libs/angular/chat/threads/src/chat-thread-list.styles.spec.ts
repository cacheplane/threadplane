import { describe, it, expect } from 'vitest';
import { CHAT_THREAD_LIST_STYLES } from './chat-thread-list.styles';

describe('CHAT_THREAD_LIST_STYLES — active item', () => {
  const normalized = CHAT_THREAD_LIST_STYLES.replace(/\s+/g, ' ');
  it('does NOT use a left-accent box-shadow for the active item (symmetric bg-only indication)', () => {
    expect(normalized).not.toMatch(
      /\.chat-thread-list__item\[data-active="true"\]\s*\{[^}]*box-shadow:\s*inset\s+2px\s+0\s+0/,
    );
  });
});
