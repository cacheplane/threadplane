import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const lib = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|css)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

describe('chat style tokens', () => {
  // `var(--tplane-chat-x)` with no fallback and no definition makes the whole declaration
  // invalid: a `border` using it silently renders no border at all.
  it('defines every --tplane-chat-* token the library uses without a fallback', () => {
    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const path of sources(lib)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/(--tplane-chat-[a-z0-9-]+)\s*:/g)) defined.add(match[1]);
      for (const match of text.matchAll(/var\(\s*(--tplane-chat-[a-z0-9-]+)\s*\)/g)) used.set(match[1], path);
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter(([token]) => !defined.has(token))).toEqual([]);
  });
});
