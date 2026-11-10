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
