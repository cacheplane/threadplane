// libs/chat/src/lib/styles/chat-style-contract.spec.ts
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentStyleSources, declarations } from './style-contract';

function sourceOf(name: string): string {
  const found = componentStyleSources().find(({ file }) => basename(file) === name);
  if (!found) throw new Error(`no component style source named ${name}`);
  return found.source;
}

describe('style contract harness', () => {
  it('scans component styles, not the token file', () => {
    const files = componentStyleSources().map(({ file }) => basename(file));
    expect(files).toContain('chat-input.styles.ts');
    expect(files).toContain('chat-tool-activity.component.ts');
    expect(files).not.toContain('chat-tokens.ts');
    expect(declarations(sourceOf('chat-input.styles.ts'), /^border-radius$/).length).toBeGreaterThan(0);
  });

  it('ignores declarations inside comments and quoted JS values', () => {
    const source = [
      '/* border-radius: 1px; */',
      'a { border-radius: 2px; }',
      "const t = { 'border-radius': '3px', border-radius: '4px' };",
      'b { border-radius: 5px }`',
    ].join('\n');
    const values = declarations(source, /^border-radius$/).map(({ value }) => value);
    expect(values).toEqual(['2px', '5px']);
  });

  it('reads a multi-line value through to its semicolon', () => {
    const source = 'a {\n  box-shadow:\n    0 1px 2px red,\n    0 4px 8px blue;\n  color: red;\n}';
    expect(declarations(source, /^box-shadow$/).map(({ value }) => value)).toEqual([
      '0 1px 2px red, 0 4px 8px blue',
    ]);
  });
});

function offendersOf(property: RegExp, bad: (value: string) => boolean): string[] {
  return componentStyleSources().flatMap(({ file, source }) =>
    declarations(source, property, file)
      .filter(({ value }) => bad(value))
      .map(({ file: f, line, value }) => `${basename(f)}:${line} ${value}`),
  );
}

describe('status colors', () => {
  it('uses no literal colors in component styles', () => {
    const offenders = offendersOf(
      /^(color|background(-color)?|border(-[a-z]+)?-color|border|fill|stroke|outline-color)$/,
      (value) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value.replace(/var\([^)]*\)/g, '')),
    );
    expect(offenders).toEqual([]);
  });

  it('does not read the undeclared --tplane-chat-error token', () => {
    expect(
      componentStyleSources()
        .filter(({ source }) => /var\(--tplane-chat-error[,)]/.test(source))
        .map(({ file }) => basename(file)),
    ).toEqual([]);
  });
});

describe('focus ring', () => {
  it('draws every focus outline with the focus token', () => {
    const offenders = offendersOf(
      /^outline$/,
      (value) =>
        value !== 'none' &&
        value !== '0' &&
        value !== '2px solid var(--tplane-chat-focus-ring)' &&
        value !== 'var(--a2ui-focus-ring-width) solid var(--a2ui-focus-ring-color)',
    );
    expect(offenders).toEqual([]);
  });

  it('gives every focus-ring outline an outline-offset in the same rule', () => {
    const offenders = componentStyleSources().flatMap(({ file, source }) =>
      [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)]
        .filter(([, body]) => /outline:\s*2px solid var\(--tplane-chat-focus-ring\)/.test(body))
        .filter(([, body]) => !/outline-offset:/.test(body))
        .map(([, body]) => `${basename(file)} ${body.trim().slice(0, 60)}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('radii', () => {
  const ALLOWED =
    /^(0|50%|var\(--tplane-chat-radius-(sm|card|button|bubble|input|launcher)\)|var\(--tplane-chat-citation-radius\)|var\(--tplane-chat-debug-radius-(panel|input|pill)\)|var\(--a2ui-shape-[a-z-]+\))$/;
  it('uses only radius tokens, 0 or 50% in every border-radius', () => {
    const offenders = offendersOf(/^border-radius$/, (value) =>
      !value.split(/\s+/).every((part) => part === '/' || ALLOWED.test(part)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('outline removal', () => {
  /** Selectors allowed to drop the outline without a ring, with the reason. */
  const ALLOWLIST: Record<string, string> = {
    // Rename inputs are mounted focused and keep an always-on primary border.
    '.chat-thread-list__edit': 'always-on primary border while editing',
    '.chat-project-list__edit': 'always-on primary border while editing',
    // The pill (.chat-input__pill:focus-within) draws the ring around the textarea.
    '.chat-input__textarea': 'the pill ancestor carries the focus ring',
    // Timeline inspector host is not focusable; keydown bubbles from its list.
    ':host': 'non-focusable host element',
  };
  const RING = /outline:\s*(2px solid var\(--tplane-chat-focus-ring\)|var\(--a2ui-focus-ring-width\) solid var\(--a2ui-focus-ring-color\))/;

  function rulesOf(source: string): { selectors: string[]; body: string }[] {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
      selectors: (sel.split(/[`;]/).pop() ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      body,
    }));
  }
  const stripPseudo = (sel: string): string =>
    sel.replace(/:(hover|focus-visible|focus-within|focus|active|not\([^)]*\)|disabled)/g, '');

  it('pairs every outline removal with a focus-ring rule for the same element', () => {
    const offenders: string[] = [];
    for (const { file, source } of componentStyleSources()) {
      const rules = rulesOf(source);
      const ringRules = rules.filter(
        (r) => RING.test(r.body) && r.selectors.some((s) => /:focus(-visible|-within)?\b/.test(s)),
      );
      for (const rule of rules.filter((r) => /outline:\s*(none|0)\s*(;|$)/.test(r.body))) {
        for (const selector of rule.selectors) {
          const base = stripPseudo(selector);
          if (ALLOWLIST[base]) continue;
          const covered = ringRules.some((r) =>
            r.selectors.some((s) => {
              if (/:focus-within\b/.test(s)) {
                // An ancestor ring covers a descendant only when the offender's selector
                // lives under that ring's base (the same component root).
                const ringBase = stripPseudo(s);
                return selector.startsWith(ringBase) || selector.includes(ringBase);
              }
              return stripPseudo(s) === base && /:focus/.test(s);
            }),
          );
          if (!covered) offenders.push(`${basename(file)} ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('elevation', () => {
  const ALLOWED = [
    /^none$/,
    /^var\(--tplane-chat-elevation-float\)$/,
    /^var\(--a2ui-elevation-\d\)$/,
    // Debug dock tokens alias the float elevation.
    /^var\(--tplane-chat-debug-shadow-(panel|pill)\)$/,
    // Inset hairline or token-colored halo: no offset, token-derived color only.
    /^inset 0 0 0 \d+px var\(--[a-z0-9-]+\)$/,
    /^0 0 \d+px (var\(--[a-z0-9-]+\)|color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, transparent\))$/,
  ];
  it('uses only the float token, none, a2ui elevations or token-colored halos in box-shadow', () => {
    const offenders = offendersOf(/^box-shadow$/, (value) => !ALLOWED.some((ok) => ok.test(value)));
    expect(offenders).toEqual([]);
  });
});

describe('motion', () => {
  const stripVars = (value: string): string => {
    let out = value;
    for (let i = 0; i < 4; i++) out = out.replace(/var\([^()]*\)/g, '');
    return out;
  };
  it('writes every transition duration and easing as a motion token', () => {
    const offenders = offendersOf(/^transition(-duration|-timing-function)?$/, (value) =>
      /(^|[\s,])-?\d*\.?\d+m?s\b|\b(ease|ease-in|ease-out|ease-in-out|linear)\b|cubic-bezier|steps\(/.test(
        stripVars(value),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('moves the welcome mount animation onto the motion tokens', () => {
    const [mount] = declarations(sourceOf('chat-welcome.styles.ts'), /^animation$/).filter(({ value }) =>
      value.includes('tplane-chat-welcome-mount'),
    );
    expect(mount.value).toContain('var(--tplane-chat-motion-duration-slow)');
    expect(mount.value).toContain('var(--tplane-chat-motion-ease)');
  });
});

describe('layers', () => {
  it('names every z-index layer with a token, or keeps a local 0-2 stacking value', () => {
    const offenders = componentStyleSources().flatMap(({ file, source }) =>
      declarations(source, /^z-index$/, file)
        .filter(({ value }) => {
          if (/^var\(--tplane-chat-z-[a-z0-9-]+(,\s*\d+)?\)$/.test(value) || value === 'auto') return false;
          // A local stacking value inside a positioned or isolated component.
          return !(/^[0-2]$/.test(value) && /isolation:\s*isolate|position:\s*(relative|absolute|fixed)/.test(source));
        })
        .map(({ line, value }) => `${basename(file)}:${line} ${value}`),
    );
    expect(offenders).toEqual([]);
  });
});
