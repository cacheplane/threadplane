import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { assertPublicDocOutput } from './public-doc-projection';
import { readApiIndex, readApiSymbol, apiSymbolMarkdown } from '../src/lib/api-reference';

/** The six libraries whose generated API docs the website publishes. */
const PUBLIC_API_LIBRARIES = [
  'a2ui',
  'ag-ui',
  'chat',
  'langgraph',
  'middleware',
  'render',
] as const;

const client = new Anthropic();
const MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6';
const DOCS_DIR = 'apps/website/content/docs';

const TOPICS = [
  {
    slug: 'introduction',
    prompt: 'Write an introduction to the Threadplane library. Explain what it does, who it is for, and why it exists. Include a minimal getting-started example.',
  },
  {
    slug: 'streaming',
    prompt: 'Explain how token-by-token streaming works with agent(). Cover the messages signal, how chunks arrive, and how Angular re-renders on each chunk.',
  },
  {
    slug: 'thread-persistence',
    prompt: 'Explain thread persistence in agent(). Cover threadId, onThreadId, and how to resume threads across page refreshes with localStorage.',
  },
  {
    slug: 'configuration',
    prompt: 'Explain provideAgent() and per-call configuration. Show how to set a global apiUrl and how to override it per-call.',
  },
  {
    slug: 'testing',
    prompt: 'Explain how to unit test components that use agent() with MockAgentTransport. Show a complete test example.',
  },
];

async function generateDoc(slug: string, prompt: string, apiDocsJson: string): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are writing documentation for the Threadplane library.
Here is the extracted API reference:\n\n${apiDocsJson}\n\n${prompt}

Write clean, developer-friendly MDX documentation. Use precise, no-fluff prose. Include code examples. Start with a single # heading.`,
    }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

function loadApiDocs(): string {
  const index = readApiIndex();
  // Keep the existing narrative allowlist; technical API generation covers all SDKs.
  return index.entrypoints.filter(entrypoint => PUBLIC_API_LIBRARIES.some(library => library === entrypoint.docLibrary))
    .map(entrypoint => index.symbols.filter(summary => summary.entrypointId === entrypoint.id).map(summary => {
      const symbol = readApiSymbol(entrypoint.id, summary.name);
      if (!symbol) throw new Error(`Missing API symbol: ${summary.href}`);
      const source = apiSymbolMarkdown(symbol, entrypoint);
      assertPublicDocOutput(entrypoint.id, source);
      return source;
    }).join('\n\n')).join('\n\n');
}

async function main() {
  const apiDocsJson = loadApiDocs();
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  for (const topic of TOPICS) {
    console.log(`Generating ${topic.slug}...`);
    const mdx = await generateDoc(topic.slug, topic.prompt, apiDocsJson);
    fs.writeFileSync(path.join(DOCS_DIR, `${topic.slug}.mdx`), mdx);
    console.log(`✓ ${topic.slug}.mdx`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
