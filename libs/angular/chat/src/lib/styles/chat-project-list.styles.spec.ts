import { describe, it, expect } from 'vitest';
import { CHAT_PROJECT_LIST_STYLES } from './chat-project-list.styles';

describe('CHAT_PROJECT_LIST_STYLES — New project button', () => {
  const normalized = CHAT_PROJECT_LIST_STYLES.replace(/\s+/g, ' ');

  it('uses --tplane-chat-surface-alt fill (solid secondary, not outlined)', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*background:\s*var\(--tplane-chat-surface-alt\)\s*;/,
    );
  });

  it('uses --tplane-chat-text color (full strength, not muted)', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*color:\s*var\(--tplane-chat-text\)\s*;/,
    );
  });

  it('removes the separator border', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*border:\s*0\s*;/,
    );
  });

  it('uses 10px / 16px padding for more presence', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*padding:\s*10px\s+16px\s*;/,
    );
  });

  it('lifts hover via color-mix on top of surface-alt', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new:hover\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--tplane-chat-text\)\s*8%,\s*var\(--tplane-chat-surface-alt\)\)\s*;/,
    );
  });

  it('uses the card radius token (consistent with thread items)', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*border-radius:\s*var\(--tplane-chat-radius-(card|button)\)\s*;/,
    );
  });
});

describe('CHAT_PROJECT_LIST_STYLES — New project button font', () => {
  const normalized = CHAT_PROJECT_LIST_STYLES.replace(/\s+/g, ' ');

  it('uses font-family: inherit (matches sidenav action buttons)', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*font-family:\s*inherit\s*;/,
    );
  });

  it('uses font-size: var(--tplane-chat-font-size-sm) (not hard-coded 12px)', () => {
    expect(normalized).toMatch(
      /\.chat-project-list__new\s*\{[^}]*font-size:\s*var\(--tplane-chat-font-size-sm\)\s*;/,
    );
  });

  it('does NOT use hard-coded 12px for font-size', () => {
    expect(normalized).not.toMatch(
      /\.chat-project-list__new\s*\{[^}]*font-size:\s*12px/,
    );
  });
});

describe('CHAT_PROJECT_LIST_STYLES — active item', () => {
  const normalized = CHAT_PROJECT_LIST_STYLES.replace(/\s+/g, ' ');
  it('does NOT use a left-accent box-shadow for the active item (symmetric bg-only indication)', () => {
    expect(normalized).not.toMatch(
      /\.chat-project-list__item\[data-active="true"\]\s*\{[^}]*box-shadow:\s*inset\s+2px\s+0\s+0/,
    );
  });
});
