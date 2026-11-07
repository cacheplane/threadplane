import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODING_AGENT_PROMPT } from './positioning';
import { docsConfig } from './docs-config';

const PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'content',
  'docs',
  'angular',
  'chat',
  'getting-started',
  'coding-agents.mdx'
);

describe('coding-agents docs page', () => {
  it('carries the maintained prompt verbatim inside a fenced block', () => {
    const mdx = readFileSync(PAGE, 'utf8');
    expect(mdx).toContain('```text\n' + CODING_AGENT_PROMPT + '\n```');
    expect(mdx).toContain('/AGENTS.md');
    expect(mdx).toContain('/llms-full.txt');
  });

  it('is registered in the chat getting-started nav', () => {
    const chat = docsConfig.find((lib) => lib.id === 'chat')!;
    const gettingStarted = chat.sections.find((s) => s.id === 'getting-started')!;
    expect(gettingStarted.pages.map((p) => p.slug)).toContain('coding-agents');
  });
});
