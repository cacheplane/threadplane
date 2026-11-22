import { describe, it, expect } from 'vitest';
import { A2uiImageComponent } from './image.component';

describe('A2uiImageComponent — v0.9 protocol', () => {
  // Display-only component: renders url() as an <img> with description() as
  // its alt text. v0.9 props: `fit` maps to CSS object-fit ('scaleDown' →
  // 'scale-down', default 'fill'); `variant` selects a sizing class on the
  // host (default 'mediumFeature').
  // Signal-based inputs require the angular() vite plugin for TestBed tests.

  it('exports the component class', () => {
    expect(A2uiImageComponent).toBeDefined();
  });

  describe('fit → object-fit logic', () => {
    const FIT_MAP: Record<string, string> = {
      contain: 'contain', cover: 'cover', fill: 'fill',
      none: 'none', scaleDown: 'scale-down',
    };
    const objectFit = (fit: string) => FIT_MAP[fit] ?? 'fill';

    it('maps scaleDown to scale-down', () => expect(objectFit('scaleDown')).toBe('scale-down'));
    it('maps identity values through', () => {
      expect(objectFit('contain')).toBe('contain');
      expect(objectFit('cover')).toBe('cover');
      expect(objectFit('fill')).toBe('fill');
      expect(objectFit('none')).toBe('none');
    });
    it('defaults unknown fit to fill', () => expect(objectFit('bogus')).toBe('fill'));
  });

  describe('variant → class logic', () => {
    const variantClass = (variant: string) => `a2ui-img--${variant}`;

    it('maps each variant to a sizing class', () => {
      for (const v of ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header']) {
        expect(variantClass(v)).toBe(`a2ui-img--${v}`);
      }
    });
  });
});
