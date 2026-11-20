import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { INTERRUPT_GUIDANCE } from '../../lib/interrupt-guidance';
import { readApiIndex, readApiSymbol, apiSymbolMarkdown } from '../../lib/api-reference';

function loadApiDocs(): string {
  const index = readApiIndex();
  return index.entrypoints.map(entrypoint => `### ${entrypoint.importPath}\n\n${index.symbols
    .filter(summary => summary.entrypointId === entrypoint.id)
    .map(summary => {
      const symbol = readApiSymbol(entrypoint.id, summary.name);
      if (!symbol) throw new Error(`Missing API symbol: ${summary.href}`);
      return apiSymbolMarkdown(symbol, entrypoint);
    }).join('\n\n')}`).join('\n\n');
}

function loadAllPrompts(): string {
  const roots = [
    path.join(process.cwd(), 'apps', 'website', 'content', 'prompts'),
    path.join(process.cwd(), 'content', 'prompts'),
  ];
  const dir = roots.find((root) => fs.existsSync(root));
  if (!dir) return '(no prompt recipes found)';
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const content = fs.readFileSync(path.join(dir, f), 'utf8').trim();
      return `## Prompt: ${slug}\n\n${content}`;
    })
    .join('\n\n---\n\n');
}

export async function GET() {
  const sections = [
    '# Threadplane — Full Reference\n\nSee /llms.txt for a compact summary.\n',
    '## API Reference (API Extractor)\n\n' + loadApiDocs(),
    '## Prompt Recipes\n\n' + loadAllPrompts(),
    INTERRUPT_GUIDANCE,
    [
      '## Common Gotchas',
      '',
      'injectAgent() MUST be called inside an Angular injection context.',
      'Do not call it in ngOnInit — use constructor or field initializer.',
      'provideAgent() and injectAgent() come from @threadplane/angular. @threadplane/langgraph and @threadplane/ag-ui export createSession() and no Angular code.',
      'Do not mock injectAgent() in tests — use provideFakeAgent() from @threadplane/angular/testing, or pass a MockAgentTransport to createSession({ transport }) inside provideAgent({ createSession }).',
      'The agent has no isLoading(), interrupt() or events$: read status() === "running", interrupts() and onCustomEvent(listener).',
      'Consumer code reads signals and awaits commands; it does not need to import rxjs.',
    ].join('\n'),
  ];

  return new NextResponse(sections.join('\n\n---\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
