import { describe, it, expect, afterEach } from 'vitest';
import { getOverlayContainer } from './overlay-container';

afterEach(() => {
  document.querySelector('.chat-overlay-container')?.remove();
  document.getElementById('chat-overlay-structure')?.remove();
});

describe('getOverlayContainer', () => {
  it('creates a single body-level container and injects structural CSS once', () => {
    const a = getOverlayContainer(document);
    const b = getOverlayContainer(document);
    expect(a).toBe(b); // singleton
    expect(a.parentElement).toBe(document.body);
    expect(document.querySelectorAll('.chat-overlay-container').length).toBe(1);
    expect(document.querySelectorAll('#chat-overlay-structure').length).toBe(1);
    expect(document.getElementById('chat-overlay-structure')!.textContent).toContain('position: fixed');
  });
});
