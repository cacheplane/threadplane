// libs/chat/src/lib/styles/style-contract.ts
// Test helper for the style-contract specs. Not exported from the package.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEBUG_ROOT = join(LIB_ROOT, '..', '..', 'debug', 'src');

/** Every non-spec source file in the chat lib and its debug entry point, minus the token file. */
export function componentStyleSources(): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        entry.name !== 'chat-tokens.ts'
      ) {
        out.push({ file: path, source: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(LIB_ROOT);
  walk(DEBUG_ROOT);
  return out;
}

/** Blanks `/* *\/` comments, keeping newlines so line numbers stay true. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Returns each CSS declaration whose property matches, with the value read through
 * to `;`, a closing backtick, or a brace (so multi-line values stay whole,
 * with whitespace collapsed). Comments are
 * ignored, as are values that begin with a quote: those are JS object
 * properties (such as a2ui theme configs), not component styles.
 */
export function declarations(
  source: string,
  property: RegExp,
  file = '',
): { file: string; line: number; value: string }[] {
  const text = stripComments(source);
  const out: { file: string; line: number; value: string }[] = [];
  const pattern = /(?<=^|[\s{;])(-{0,2}[A-Za-z][\w-]*)\s*:\s*([^;`{}]*)/g;
  for (const match of text.matchAll(pattern)) {
    if (!property.test(match[1])) continue;
    const value = match[2].trim().replace(/\s+/g, ' ');
    if (!value || /^['"`]/.test(value)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    out.push({ file, line, value });
  }
  return out;
}
