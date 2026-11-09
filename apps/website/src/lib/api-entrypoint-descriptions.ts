import type { ApiEntrypoint } from './api-reference-model';

/** Presentation copy only; generated API metadata remains the source of status and versions. */
const descriptions: Record<string, string> = {
  a2ui: 'Parse and validate A2UI messages and surfaces.',
  'ag-ui': 'Connect Angular applications to agents using the AG-UI protocol.',
  angular: 'Angular bindings for agent state and runtime integration.',
  chat: 'Conversation components for messages, input, and tool results.',
  'chat/debug': 'Inspect conversation state and runtime events.',
  'chat/testing': 'Test utilities for conversation components.',
  'angular/chat': 'Conversation components for Angular applications.',
  'angular/markdown': 'Render Markdown content in Angular applications.',
  content: 'Shared content models and processing utilities.',
  'content/markdown': 'Process Markdown content for rendering.',
  'content/messages': 'Normalize and transform conversation messages.',
  'content/json': 'Process structured JSON content.',
  'content/a2ui': 'Process A2UI content and surface updates.',
  'content/render-state': 'Track content state during rendering.',
  'content/testing': 'Test utilities for content processing.',
  core: 'Shared agent state, runtime, and event contracts.',
  'core/tools': 'Shared contracts and utilities for agent tools.',
  'core/testing': 'Test utilities for core agent contracts.',
  langgraph: 'Connect Angular applications to LangGraph agents.',
  'middleware/langgraph': 'Server middleware for LangGraph agent integration.',
  react: 'React hooks and providers for agent state and runtimes.',
  'react/chat': 'Conversation components for React applications.',
  'react/markdown': 'Render Markdown content in React applications.',
  'react/render': 'Render agent-generated interfaces in React.',
  'react/debug': 'Inspect React conversation state and runtime events.',
  render: 'Render agent-generated interfaces in Angular.',
  telemetry: 'Trace agent activity and collect runtime telemetry.',
  'telemetry/browser': 'Collect telemetry in browser applications.',
  'telemetry/node': 'Collect telemetry in Node.js applications.',
  'telemetry/shared': 'Shared telemetry types and utilities.',
};

export function apiEntrypointDescription(entry: ApiEntrypoint): string {
  return descriptions[entry.id] ?? `API exports for ${entry.importPath}.`;
}
