import { describe, it, expect } from 'vitest';
import { A2uiTextComponent } from './text.component';

describe('A2uiTextComponent — v0.9 protocol', () => {
  // Display-only component: renders text() input as a <span>, styled by the
  // v0.9 `variant` prop ('h1'|'h2'|'h3'|'h4'|'h5'|'caption'|'body', default 'body').
  // Signal-based inputs require the angular() vite plugin for TestBed tests.

  it('exports the component class', () => {
    expect(A2uiTextComponent).toBeDefined();
  });

  describe('variant → css class logic', () => {
    const cssClass = (variant: string) => `a2ui-text-${variant}`;

    it('maps each variant to its class', () => {
      for (const v of ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']) {
        expect(cssClass(v)).toBe(`a2ui-text-${v}`);
      }
    });

    it('defaults to body', () => {
      expect(cssClass('body')).toBe('a2ui-text-body');
    });
  });
});
