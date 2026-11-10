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
