import { describe, expect, it } from 'vitest';
import { loadFonts } from './fonts';

describe('loadFonts', () => {
  it('returns four font entries with expected names + weights', async () => {
    const fonts = await loadFonts();
    expect(fonts).toHaveLength(4);
    const byName = fonts.map((f) => `${f.name}:${f.weight}`);
    // Archivo Black is single-weight, so it registers at 400: a 700 entry here
    // would send satori looking for a bold the face does not contain.
    expect(byName).toContain('Archivo Black:400');
    expect(byName).toContain('Archivo:400');
    expect(byName).toContain('Archivo:600');
    expect(byName).toContain('JetBrains Mono:700');
    for (const f of fonts) {
      expect(f.data.byteLength).toBeGreaterThan(1000);
      expect(f.style).toBe('normal');
    }
  });

  it('memoizes — second call returns the same array reference', async () => {
    const a = await loadFonts();
    const b = await loadFonts();
    expect(a).toBe(b);
  });
});
