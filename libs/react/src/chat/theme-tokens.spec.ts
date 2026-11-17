/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * A theme written for Angular chat sets --tplane-chat-* custom properties.
 * React chat reads those names first, so the same theme restyles it. These
 * checks keep the React stylesheets on that contract:
 *   - every --tplane-chat-* name React reads is one Angular declares;
 *   - every React chat token reads an Angular name before its own default;
 *   - colors, shadows and transition timings are token defaults (a var()
 *     fallback), never bare literals in a component rule.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const STYLESHEETS = {
  'chat/styles.css': read('./styles.css'),
  'debug/styles.css': read('../debug/styles.css'),
  'a2ui/styles.css': read('../a2ui/styles.css'),
};

const ANGULAR_TOKENS = new Set(
  [
    ...read('../../../chat/src/lib/styles/chat-tokens.ts').matchAll(
      /(--tplane-chat-[a-z0-9-]+)\s*:/g,
    ),
  ].map((match) => match[1]),
);

/* Angular tokens that are set at runtime or are consumer knobs, so they have
   no default declaration (see docs/design/chat-ui-guide.md, section 8). */
const ANGULAR_RUNTIME_TOKENS = new Set<string>([
  '--tplane-chat-sidebar-width-drawer',
]);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Declaration {
  file: string;
  line: number;
  property: string;
  value: string;
}

function declarations(file: string, css: string): Declaration[] {
  const source = stripComments(css);
  const found: Declaration[] = [];
  // A declaration is "property: value" after "{" or ";", ending at ";" or "}".
  const pattern = /(?<=[{;])\s*([-a-z]+)\s*:\s*([^;{}]+)(?=[;}])/g;
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].indexOf(match[1]);
    found.push({
      file,
      line: source.slice(0, start).split('\n').length,
      property: match[1],
      value: match[2].replace(/\s+/g, ' ').trim(),
    });
  }
  return found;
}

const ALL = Object.entries(STYLESHEETS).flatMap(([file, css]) =>
  declarations(file, css),
);

/** Removes every var(...) so only the literal part of a value remains. */
function withoutVars(value: string): string {
  let out = value;
  for (;;) {
    const next = out.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, 'VAR');
    if (next === out) return out;
    out = next;
  }
}

const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\blight-dark\(|\b(white|black)\b/i;

/* Literal colors that are not chat-token concepts, reviewed one by one. */
const ALLOWED_LITERALS = new Set([
  // Glyph color drawn on the web citation icon, not a themeable surface.
  'chat/styles.css .tp-citation-card__visual--web color: white',
]);

function selectorBefore(file: string, line: number): string {
  const lines = stripComments(STYLESHEETS[file as keyof typeof STYLESHEETS])
    .split('\n')
    .slice(0, line);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('{')) return lines[i].slice(0, lines[i].indexOf('{')).trim();
  }
  return '';
}

describe('React chat theme tokens', () => {
  it('reads Angular token names', () => {
    expect(ANGULAR_TOKENS.size).toBeGreaterThan(80);
    expect(ANGULAR_TOKENS.has('--tplane-chat-focus-ring')).toBe(true);
  });

  it('only reads --tplane-chat-* tokens that Angular declares', () => {
    const referenced = new Set(
      Object.values(STYLESHEETS).flatMap((css) =>
        [...css.matchAll(/var\(\s*(--tplane-chat-[a-z0-9-]+)/g)].map(
          (match) => match[1],
        ),
      ),
    );
    expect(referenced.size).toBeGreaterThan(30);
    const unknown = [...referenced].filter(
      (name) => !ANGULAR_TOKENS.has(name) && !ANGULAR_RUNTIME_TOKENS.has(name),
    );
    expect(unknown).toEqual([]);
  });

  it('maps each React chat token to its Angular name first', () => {
    const root = ALL.filter(
      ({ file, property }) =>
        file === 'chat/styles.css' && property.startsWith('--tp-chat-'),
    );
    // Tokens with no Angular counterpart keep their own default.
    const reactOnly = new Set(['--tp-chat-gap']);
    const unmapped = root
      .filter(({ property }) => !reactOnly.has(property))
      // Local re-mappings (user bubble) read other --tp-chat-* tokens.
      .filter(({ value }) => !/^var\(--tp-chat-|^color-mix\(/.test(value))
      .filter(({ value }) => !/^var\(\s*--tplane-chat-[a-z0-9-]+\s*,/.test(value))
      .map(({ line, property, value }) => `${line} ${property}: ${value}`);
    expect(unmapped).toEqual([]);
  });

  it('keeps colors and shadows as token defaults, not bare literals', () => {
    const offenders = ALL.filter(
      ({ property }) =>
        // Token definitions (--a2ui-*, --tp-*) are where defaults live.
        !property.startsWith('--') &&
        /^(color|background(-color)?|border(-[a-z]+)*|outline(-color)?|box-shadow|fill|stroke)$/.test(
          property,
        ),
    )
      .filter(({ value }) => COLOR_LITERAL.test(withoutVars(value)))
      .map(
        ({ file, line, property, value }) =>
          `${file} ${selectorBefore(file, line)} ${property}: ${value}`,
      )
      .filter((entry) => !ALLOWED_LITERALS.has(entry));
    expect(offenders).toEqual([]);
  });

  it('uses no literal shadows outside a token', () => {
    const offenders = ALL.filter(
      ({ property, value }) =>
        property === 'box-shadow' &&
        value !== 'none' &&
        withoutVars(value).trim() !== 'VAR',
    ).map(({ file, line, value }) => `${file}:${line} ${value}`);
    expect(offenders).toEqual([]);
  });

  it('times transitions with the motion tokens', () => {
    const offenders = ALL.filter(
      ({ property, value }) =>
        property === 'transition' && /\d(m?s)\b/.test(withoutVars(value)),
    ).map(({ file, line, value }) => `${file}:${line} ${value}`);
    expect(offenders).toEqual([]);
  });

  it('draws every focus ring with the focus-ring token', () => {
    const offenders = ALL.filter(
      ({ property, value }) =>
        property === 'outline' &&
        /solid/.test(value) &&
        // Forced colors keep the system highlight.
        !/^\d+px solid Highlight$/.test(value) &&
        !/var\(--(a2ui-focus-ring-color, var\(--)?tplane-chat-focus-ring\b/.test(value),
    ).map(({ file, line, value }) => `${file}:${line} ${value}`);
    expect(offenders).toEqual([]);
  });
});
