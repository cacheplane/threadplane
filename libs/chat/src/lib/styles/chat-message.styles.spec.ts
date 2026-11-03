// libs/chat/src/lib/styles/chat-message.styles.spec.ts
import { describe, it, expect } from 'vitest';
import { CHAT_MESSAGE_STYLES } from './chat-message.styles';
import { CHAT_MESSAGE_ACTIONS_STYLES } from './chat-message-actions.styles';

describe('CHAT_MESSAGE_STYLES — controls positioning', () => {
  const normalized = CHAT_MESSAGE_STYLES.replace(/\s+/g, ' ');
  it('does NOT absolute-position the actions controls (so they flow inside .chat-message__main, indented past the gutter)', () => {
    expect(normalized).not.toMatch(
      /\.chat-message__controls\s*\{[^}]*position:\s*absolute/,
    );
  });
  it('does NOT pin the controls to a negative bottom offset (would overlap with the next message)', () => {
    expect(normalized).not.toMatch(
      /\.chat-message__controls\s*\{[^}]*bottom:\s*-/,
    );
  });
});

describe('CHAT_MESSAGE_STYLES — controls reveal stays in sync with the actions row', () => {
  // The controls wrapper and the actions row each hide on non-current
  // messages. If one reveals under a media query the other does not, the
  // buttons are tappable but invisible (or visible but inert).
  const revealQuery = (css: string, selector: string) =>
    [...css.replace(/\s+/g, ' ').matchAll(/@media ([^{]+)\{([^}]*\})/g)]
      .find(([, , body]) => body.includes(selector))?.[1].trim();

  it('reveals the wrapper under the same media query as the actions row', () => {
    const wrapper = revealQuery(CHAT_MESSAGE_STYLES, '.chat-message__controls');
    const row = revealQuery(CHAT_MESSAGE_ACTIONS_STYLES, ':host-context(chat-message[data-role="assistant"])');
    expect(wrapper).toBeDefined();
    expect(wrapper).toBe(row);
    expect(wrapper).toContain('(hover: none)');
  });
});
