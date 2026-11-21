// libs/angular/chat/src/lib/compositions/chat/pin-state.spec.ts
import { describe, expect, it } from 'vitest';
import { isPinned } from './chat.component';

describe('isPinned', () => {
  // Container is 500px tall with 2000px of content. scrollTop=1500 => fully at bottom.
  const scrollHeight = 2000;
  const clientHeight = 500;

  it('is true when exactly at bottom', () => {
    expect(isPinned(scrollHeight, 1500, clientHeight)).toBe(true);
  });

  it('is true when within tolerance (149px above bottom)', () => {
    expect(isPinned(scrollHeight, 1500 - 149, clientHeight)).toBe(true);
  });

  it('is false when 150px above bottom (boundary is strict <)', () => {
    expect(isPinned(scrollHeight, 1500 - 150, clientHeight)).toBe(false);
  });

  it('is false when far from bottom', () => {
    expect(isPinned(scrollHeight, 0, clientHeight)).toBe(false);
  });

  it('respects a custom tolerance', () => {
    expect(isPinned(scrollHeight, 1500 - 49, clientHeight, 50)).toBe(true);
    expect(isPinned(scrollHeight, 1500 - 50, clientHeight, 50)).toBe(false);
  });
});
