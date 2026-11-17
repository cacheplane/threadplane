// libs/chat/src/lib/styles/chat-theme-presets.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT_TOKEN_STYLES } from './chat-tokens';
import { componentStyleSources } from './style-contract';

const names = ['default-light', 'default-dark', 'material-light', 'material-dark'] as const;
const preset = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../themes', `${name}.css`), 'utf8');
function declared(css: string): Map<string, string> {
  return new Map(
    [...css.matchAll(/(--a2ui-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ])
  );
}
/** The A2UI tokens the chat itself declares for one scheme. */
function canonical(scheme: 'light' | 'dark'): Map<string, string> {
  const start = ROOT_TOKEN_STYLES.indexOf(`/* --a2ui-* ${scheme} variant`);
  expect(start).toBeGreaterThan(-1);
  // The scheme's A2UI tokens run to the next comment or the end of the rule.
  const rest = ROOT_TOKEN_STYLES.slice(start + 4);
  const end = Math.min(...['/*', '}'].map((mark) => rest.indexOf(mark)).filter((at) => at > -1));
  const tokens = declared(rest.slice(0, end));
  expect(tokens.size).toBeGreaterThan(15);
  return tokens;
}
const scheme = (name: string) => (name.endsWith('dark') ? 'dark' : 'light');

describe('A2UI theme presets', () => {
  it.each(names)('%s is one unlayered :root rule', (name) => {
    const css = preset(name).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    expect(rules[0][1].trim()).toBe(':root');
    expect(css).not.toMatch(/@layer|@import|!important/);
  });

  it.each(['default-light', 'default-dark'])(
    '%s repeats the values the chat declares for that scheme',
    (name) => {
      const tokens = declared(preset(name));
      const source = canonical(scheme(name));
      expect(tokens.size).toBeGreaterThan(15);
      for (const [token, value] of tokens)
        expect(value, `${name} ${token}`).toBe(source.get(token));
    }
  );

  it.each(names)('%s pins every scheme-dependent A2UI token', (name) => {
    const tokens = declared(preset(name));
    const light = canonical('light');
    const dark = canonical('dark');
    // A token whose light and dark values differ would otherwise keep following
    // the page scheme under a preset that fixes the palette.
    for (const [token, value] of light)
      if (dark.get(token) !== value)
        expect(tokens.has(token), `${name} leaves ${token} to the page scheme`).toBe(true);
  });

  it('gives every preset the same tokens, all of them declared by the chat', () => {
    const known = new Set([...canonical('light').keys(), ...canonical('dark').keys()]);
    const [first, ...rest] = names.map((name) => [...declared(preset(name)).keys()].sort());
    for (const token of first) expect(known.has(token), token).toBe(true);
    for (const tokens of rest) expect(tokens).toEqual(first);
  });

  it.each(names)('%s sets every scheme-dependent token a component reads', (name) => {
    const read = new Set(
      componentStyleSources()
        .flatMap(({ source }) => [...source.matchAll(/var\(\s*(--a2ui-[a-z0-9-]+)/g)])
        .map((match) => match[1])
    );
    expect(read.has('--a2ui-primary')).toBe(true);
    const tokens = declared(preset(name));
    const light = canonical('light');
    const dark = canonical('dark');
    for (const token of read)
      if (light.has(token) && light.get(token) !== dark.get(token))
        expect(tokens.has(token), `${name} misses ${token}`).toBe(true);
  });

  /** WCAG contrast ratio of two opaque hex colours. */
  function contrast(a: string, b: string): number {
    const luminance = (hex: string) => {
      const [r, g, bl] = [1, 3, 5].map((at) => {
        const value = parseInt(hex.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  const palettes: [string, Map<string, string>][] = [
    ['chat light', canonical('light')],
    ['chat dark', canonical('dark')],
    ...names.map((name): [string, Map<string, string>] => [name, declared(preset(name))]),
  ];

  // The chat UI guide asks for 4.5:1 on text in both schemes.
  it.each(palettes)('%s keeps button, body, link and error text readable', (_label, tokens) => {
    const value = (token: string) => tokens.get(`--a2ui-${token}`) ?? '';
    for (const [text, background] of [
      ['on-primary', 'primary'],
      ['on-primary', 'primary-hover'],
      ['on-surface', 'surface'],
      ['primary', 'surface'],
      ['error', 'surface'],
    ]) {
      expect(value(text)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(value(background)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(
        contrast(value(text), value(background)),
        `${text} on ${background}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
