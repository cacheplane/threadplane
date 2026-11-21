import { describe, it, expect } from 'vitest';
import { A2uiIconComponent, toMaterialSymbolName } from './icon.component';

describe('A2uiIconComponent — v0.9 protocol', () => {
  // v0.9: the `name` input is either a string (Material Symbols ligature,
  // camelCase converted to snake_case) or an object { svgPath } rendered as
  // an inline <svg><path> (viewBox "0 -960 960 960").
  // Signal-based inputs require the angular() vite plugin for TestBed tests.

  it('exports the component class', () => {
    expect(A2uiIconComponent).toBeDefined();
  });

  describe('name shape discrimination', () => {
    const svgPathOf = (name: string | { svgPath: string } | undefined): string | null =>
      typeof name === 'object' && name !== null && typeof name.svgPath === 'string'
        ? name.svgPath
        : null;

    it('treats a string name as a ligature (no svgPath)', () => {
      expect(svgPathOf('check')).toBeNull();
    });

    it('extracts svgPath from an object name', () => {
      expect(svgPathOf({ svgPath: 'M480-480Z' })).toBe('M480-480Z');
    });

    it('returns null for undefined', () => {
      expect(svgPathOf(undefined)).toBeNull();
    });
  });
});

describe('toMaterialSymbolName', () => {
  it('converts camelCase identifiers to snake_case ligatures', () => {
    expect(toMaterialSymbolName('accountCircle')).toBe('account_circle');
    expect(toMaterialSymbolName('shoppingCart')).toBe('shopping_cart');
    expect(toMaterialSymbolName('moreVert')).toBe('more_vert');
    expect(toMaterialSymbolName('visibilityOff')).toBe('visibility_off');
    expect(toMaterialSymbolName('arrowForward')).toBe('arrow_forward');
  });

  it('passes single-word and already-snake_case names through unchanged', () => {
    expect(toMaterialSymbolName('check')).toBe('check');
    expect(toMaterialSymbolName('star')).toBe('star');
    expect(toMaterialSymbolName('trending_up')).toBe('trending_up');
  });

  it('leaves non-identifier glyphs (emoji) untouched', () => {
    expect(toMaterialSymbolName('✓')).toBe('✓');
    expect(toMaterialSymbolName('⚠️')).toBe('⚠️');
  });
});
