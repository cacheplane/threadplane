import { describe, it, expect } from 'vitest';
import { CHAT_MESSAGE_ACTIONS_STYLES } from '../../styles/chat-message-actions.styles';

describe('CHAT_MESSAGE_ACTIONS_STYLES', () => {
  it('sets 16px top / 12px bottom padding on :host so the actions row has breathing room', () => {
    const normalized = CHAT_MESSAGE_ACTIONS_STYLES.replace(/\s+/g, ' ');
    expect(normalized).toMatch(/:host\s*\{[^}]*padding:\s*16px\s+0\s+12px\s+0\s*;/);
  });

  it('compacts the reserved row under earlier answers to 4px top / 0 bottom', () => {
    const normalized = CHAT_MESSAGE_ACTIONS_STYLES.replace(/\s+/g, ' ');
    expect(normalized).toMatch(
      /:host-context\(chat-message\[data-role="assistant"\]:not\(\[data-current="true"\]\)\)\s*\{\s*padding:\s*4px\s+0\s+0\s+0\s*;\s*\}/,
    );
  });
});
