import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';
import project from '../../project.json';

// This package type-checks its specs without Node types, so the file reader is
// loaded by a computed name and typed here.
const files: { readFileSync(path: string, encoding: 'utf8'): string } =
  await import(/* @vite-ignore */ `node:${'fs'}`);
const here = (import.meta as unknown as { dirname: string }).dirname;
const read = (path: string) => files.readFileSync(`${here}/${path}`, 'utf8');
const names = ['default-light', 'default-dark', 'material-light', 'material-dark'];
const base = read('styles.css');
/** The custom properties one rule block declares, with their values. */
function declared(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/(--a2ui-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ])
  );
}
const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*\.a2ui-surface \{([^}]*)\}/.exec(base)?.[1];
const used = new Set(
  [...base.matchAll(/var\((--a2ui-[a-z0-9-]+)/g)].map((match) => match[1])
);

describe('A2UI theme stylesheets', () => {
  it('finds the base dark block it guards against', () => {
    expect(darkBlock).toBeDefined();
    expect(declared(darkBlock ?? '').size).toBeGreaterThan(8);
  });

  it('forces the same dark and light values from the theme attributes', () => {
    const rules = [...base.matchAll(/:where\(\[data-theme="(light|dark)"\][^{]*\{([^}]*)\}/g)];
    const byScheme = new Map(rules.map((m) => [m[1], declared(m[2])]));
    const dark = declared(darkBlock ?? '');
    expect([...(byScheme.get('dark') ?? new Map())]).toEqual([...dark]);
    const light = byScheme.get('light') ?? new Map();
    for (const token of dark.keys()) expect(light.has(token)).toBe(true);
  });

  it.each(names)('%s is one rule that outranks the base tokens', (name) => {
    const css = read(`themes/${name}.css`).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    // One class more specific than `.a2ui-surface`, so import order does not matter.
    expect(rules[0][1].trim()).toBe(':root .a2ui-surface');
    expect(css).not.toMatch(/@import|url\(|!important/);
    expect(css).toMatch(
      new RegExp(`color-scheme: ${name.endsWith('dark') ? 'dark' : 'light'};`)
    );
  });

  it.each(names)('%s sets every colour the system dark scheme would change', (name) => {
    const tokens = declared(read(`themes/${name}.css`));
    for (const token of declared(darkBlock ?? '').keys())
      expect(tokens.has(token), `${name} leaves ${token} to the system scheme`).toBe(true);
  });

  it.each(names)('%s sets only tokens the components read', (name) => {
    for (const token of declared(read(`themes/${name}.css`)).keys())
      expect(used.has(token), `${token} is not read by styles.css`).toBe(true);
  });

  it('makes the default themes repeat the base stylesheet for each scheme', () => {
    const light = declared(base.slice(0, base.indexOf('min-width: 0;')));
    const dark = declared(darkBlock ?? '');
    for (const [token, value] of declared(read('themes/default-light.css')))
      expect(value, `default-light ${token}`).toBe(light.get(token));
    for (const [token, value] of declared(read('themes/default-dark.css')))
      expect(value, `default-dark ${token}`).toBe(dark.get(token));
  });

  it('gives every theme the same tokens', () => {
    const [first, ...rest] = names.map((name) =>
      [...declared(read(`themes/${name}.css`)).keys()].sort()
    );
    for (const tokens of rest) expect(tokens).toEqual(first);
  });

  it('keeps light text dark and dark text light', () => {
    const light = (hex: string) => parseInt(hex.slice(1, 3), 16) > 127;
    for (const name of names) {
      const tokens = declared(read(`themes/${name}.css`));
      const dark = name.endsWith('dark');
      expect(light(tokens.get('--a2ui-surface') ?? '')).toBe(!dark);
      expect(light(tokens.get('--a2ui-on-surface') ?? '')).toBe(dark);
    }
  });

  it('is exported and packaged', () => {
    for (const name of names)
      expect(
        (manifest.exports as Record<string, unknown>)[`./a2ui/themes/${name}.css`]
      ).toBe(`./src/a2ui/themes/${name}.css`);
    expect(project.targets.build.options.assets).toContainEqual({
      input: 'libs/react/src/a2ui/themes',
      glob: '*.css',
      output: 'src/a2ui/themes',
    });
  });
});
