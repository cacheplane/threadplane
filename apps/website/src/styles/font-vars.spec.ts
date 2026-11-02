import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Every `--font-*` custom property this app references must be one the app
 * actually supplies.
 *
 * `layout.tsx` loads sans, mono and diagram via `next/font` on `<html>`;
 * brand.css aliases display to sans. A reference
 * to anything else resolves to nothing, and an undefined custom property in a
 * `font-family` declaration is invalid at computed-value time — the whole
 * declaration is dropped and the element silently falls back to the inherited
 * or system face. Nothing else catches it: jsdom does not resolve custom
 * properties, and the Next build does not type-check CSS.
 *
 * This guard exists because it happened twice in one day. The 2026-09-07
 * aviation retheme renamed `--font-garamond`/`--font-inter` to
 * `--font-display`/`--font-sans`, and a PR that landed on main in between
 * added two new rules still using the old names. They would have shipped as
 * system-font fallbacks that look almost right.
 */
const SUPPLIED = new Set([
  '--font-display', // Hanken alias in brand.css
  '--font-sans', // Hanken Grotesk
  '--font-diagram', // Inter — diagram geometry is pinned to its metrics
  '--font-mono', // JetBrains Mono
]);

describe('font custom properties', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

  it('reads a non-trivial number of stylesheets', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('references only font vars that layout.tsx supplies', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const css = readFileSync(join(dir, file), 'utf-8');
      for (const match of css.matchAll(/var\((--font-[a-z0-9-]+)/g)) {
        if (!SUPPLIED.has(match[1])) {
          offenders.push(`${file}: ${match[1]}`);
        }
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });
});
