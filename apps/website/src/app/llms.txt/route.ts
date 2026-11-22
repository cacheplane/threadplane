import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { INTERRUPT_GUIDANCE } from '../../lib/interrupt-guidance';

function loadVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'libs', 'langgraph', 'package.json'),
    path.join(process.cwd(), '..', '..', 'libs', 'langgraph', 'package.json'),
  ];
  const packagePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!packagePath) return '0.0.0';
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
  return packageJson.version ?? '0.0.0';
}

function buildLlmsTxt(): string {
  const version = loadVersion();
  return [
    `# Threadplane v${version}`,
    '',
    "Threadplane is a runtime-neutral chat UI SDK for Angular. The @threadplane/angular/chat entry point provides streaming chat components that read one injected 'Agent'. The Agent is a signal view of a framework-neutral AgentSession (@threadplane/core), and the backend packages (@threadplane/langgraph, @threadplane/ag-ui) each export a createSession() factory that runs their backend behind that contract.",
    '',
    '## Packages',
    '- Full generated Angular, React and shared API reference: https://threadplane.ai/docs/api',
    '- Unpublished development APIs are explicitly labeled in the reference; consult the exact import path and package status.',
    '- @threadplane/angular/chat — chat UI components (messages, input, tool calls, interrupt, debug, etc.) that read the injected Agent',
    '- @threadplane/angular — provideAgent(), injectAgent(), the Agent type, provideThreadDirectory(); the testing entry @threadplane/angular/testing has provideFakeAgent()',
    '- @threadplane/core — the framework-neutral AgentSession contract; @threadplane/core/testing has createFakeAgentSession()',
    '- @threadplane/langgraph — createSession() for LangGraph / LangGraph Platform; no framework code',
    '- @threadplane/ag-ui — createSession() for AG-UI-compatible backends including CrewAI, Mastra, Microsoft AF, AG2, Pydantic AI, and AWS Strands; no framework code',
    '- @threadplane/content — framework-neutral Markdown, message, JSON and A2UI content models',
    '- @threadplane/angular/render — generative UI runtime (Vercel json-render + Google A2UI)',
    '- @threadplane/a2ui — protocol types, JSONL parser, dynamic value resolver, and pointer helpers for A2UI streams',
    '- @threadplane/middleware — LangGraph.js helpers for browser-executed client tools',
    '- threadplane-middleware — Python LangGraph helpers for browser-executed client tools',
    '- @threadplane/telemetry — browser, Node, and shared instrumentation helpers',
    '',
    '## Install',
    '# LangGraph backend:',
    'npm install @threadplane/angular @threadplane/core @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked',
    '# LangGraph backend with browser client tools:',
    'npm install @threadplane/angular @threadplane/core @threadplane/langgraph @langchain/core @langchain/langgraph-sdk @threadplane/middleware marked',
    '# Python LangGraph backend with browser client tools:',
    'pip install threadplane-middleware',
    '# AG-UI backend:',
    'npm install @threadplane/angular @threadplane/core @threadplane/ag-ui @ag-ui/client marked',
    '',
    '## Key API (one Angular surface over either backend)',
    '- provideAgent({ createSession }) from @threadplane/angular — provides one Agent to Angular DI. createSession(context) returns a session from a backend package; pass context.threadId (and, for LangGraph, context.onThreadId) through to it.',
    '- injectAgent() from @threadplane/angular — returns the provided Agent. It must be called in an injection context.',
    '- createSession(options) from @threadplane/langgraph ({ apiUrl, assistantId, threadId, onThreadId, ... }) or from @threadplane/ag-ui ({ url, threadId, ... }) — the session the agent observes. Neither backend package exports provideAgent, injectAgent or toAgent.',
    '- Agent<TSession> — the session snapshot fields as signals (messages(), status(), error(), toolCalls(), state(), interrupts(), ...) plus its commands (submit(text), stop(), resume(responses), retry(), regenerate(messageId)). status() is idle, running or error. Optional fields read undefined and optional commands are undefined when the session lacks them.',
    '- ChatComponent, ChatMessageListComponent, ChatInputComponent from @threadplane/angular/chat — composable Angular components that take the Agent as [agent].',
    '- provideFakeAgent() from @threadplane/angular/testing — the same Agent over an in-memory session that streams a canned reply. mockAgent() from @threadplane/angular/chat — an Agent with writable fields for component tests.',
    '- runAgentSessionConformance from @threadplane/core/testing — the conformance suite for a session implementation.',
    '',
    INTERRUPT_GUIDANCE,
    '',
    '## Minimal LangGraph example',
    "import { provideAgent, injectAgent } from '@threadplane/angular';",
    "import { createSession } from '@threadplane/langgraph';",
    "import { ChatComponent } from '@threadplane/angular/chat';",
    "// app.config.ts: providers: [provideAgent({ createSession: async (context) => createSession({ apiUrl: 'http://localhost:2024', assistantId: 'chat', threadId: context.threadId, onThreadId: context.onThreadId }) })]",
    '// Component: agent = injectAgent();',
    '// Template: <chat [agent]="agent" />',
    '',
    '## Minimal AG-UI example',
    "import { provideAgent, injectAgent } from '@threadplane/angular';",
    "import { createSession } from '@threadplane/ag-ui';",
    "import { ChatComponent } from '@threadplane/angular/chat';",
    "// app.config.ts: providers: [provideAgent({ createSession: async (context) => createSession({ url: 'https://your.endpoint', threadId: context.threadId ?? undefined }) })]",
    '// Component: agent = injectAgent();',
    '// Template: <chat [agent]="agent" />',
    '',
    '## License',
    'Every Threadplane package is available under the MIT License. Optional production assurance and delivery services are available separately.',
    '',
    '## Full reference',
    'https://threadplane.ai/llms-full.txt',
  ].join('\n');
}

export async function GET() {
  return new NextResponse(buildLlmsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
