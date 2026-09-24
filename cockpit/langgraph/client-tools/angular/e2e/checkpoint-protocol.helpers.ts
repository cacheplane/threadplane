import { expect } from '@playwright/test';
import { Client, type Checkpoint, type ThreadState } from '@langchain/langgraph-sdk';

export const prompt = 'Checkpoint protocol weather in Paris';
export const input = {
  messages: [{ id: 'protocol-question', type: 'human', content: prompt }],
  client_tools: [{
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: { type: 'object', properties: { location: { type: 'string' } } },
  }],
};
type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type State = { messages: { id: string; type: string; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }[] };
export type CheckpointEvent = {
  id?: string;
  event: string;
  data: { config: { configurable?: Record<string, unknown> }; values: State; next: string[]; metadata: Record<string, unknown> };
};

export function backendUrl(): string {
  const url = process.env['CLIENT_TOOLS_API_URL'];
  if (!url) throw new Error('Global setup must expose the local client-tools API URL');
  return url;
}

export function client() {
  return new Client<State>({ apiUrl: backendUrl(), apiKey: null, callerOptions: { maxRetries: 0 }, timeoutMs: 20_000 });
}

// This is test-only protocol normalization. Never forward the full configurable
// object: it can contain authentication, run and request-specific metadata.
export function position(config: Record<string, unknown> | undefined): Checkpoint & { checkpoint_id: string } {
  if (!config) throw new Error('Checkpoint response must include routing configuration');
  expect(config['thread_id']).toEqual(expect.stringMatching(/\S/));
  expect(config['checkpoint_ns']).toEqual(expect.any(String));
  expect(config['checkpoint_id']).toEqual(expect.stringMatching(/\S/));
  const map = config['checkpoint_map'];
  if (map !== undefined) {
    expect(map).not.toBeNull();
    expect(typeof map).toBe('object');
    expect(Array.isArray(map)).toBe(false);
    for (const id of Object.values(map as object)) expect(id).toEqual(expect.any(String));
  }
  return {
    thread_id: config['thread_id'] as string,
    checkpoint_ns: config['checkpoint_ns'] as string,
    checkpoint_id: config['checkpoint_id'] as string,
    checkpoint_map: map === undefined ? undefined : { ...map as Record<string, string> },
  };
}

export async function run(api: Client<State>, threadId: string, checkpoint?: Checkpoint, values: Record<string, unknown> | null = null) {
  let final: CheckpointEvent | undefined;
  let runId: string | undefined;
  for await (const event of api.runs.stream(threadId, 'client-tools', {
    input: values, checkpoint, streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
  })) {
    expect(event.event).not.toBe('error');
    if (event.event === 'metadata') runId = event.data.run_id;
    if (event.event === 'checkpoints') final = event as CheckpointEvent;
  }
  if (!final || !runId) throw new Error('Run must emit its identity and checkpoint evidence');
  // A terminal replay can report the unchanged checkpoint from an earlier run.
  // New checkpoint evidence must identify this run; unchanged evidence must
  // exactly identify the explicit checkpoint we asked to replay.
  const exact = position(final.data.config.configurable);
  expect(exact.thread_id).toBe(threadId);
  if (exact.checkpoint_id !== checkpoint?.checkpoint_id) {
    expect(final.data.config.configurable?.['run_id']).toBe(runId);
  }
  const saved = await api.threads.getState(threadId, exact);
  expect(saved.checkpoint.checkpoint_id).toBe(exact.checkpoint_id);
  expect(saved.values).toEqual(final.data.values);
  expect(saved.next).toEqual(final.data.next);
  if (exact.checkpoint_id !== checkpoint?.checkpoint_id) expect(saved.metadata?.['run_id']).toBe(runId);
  return saved;
}

export function calls(state: ThreadState<State>) {
  return state.values.messages.flatMap((message) => message.tool_calls ?? []);
}

export async function modelJournal(userPrompt = prompt) {
  const url = process.env['CLIENT_TOOLS_AIMOCK_URL'];
  if (!url) throw new Error('Global setup must expose the local aimock journal URL');
  const response = await fetch(`${url}/__aimock/journal`, { signal: AbortSignal.timeout(5_000) });
  expect(response.ok).toBe(true);
  const entries = await response.json() as { body?: { messages?: { role: string; content: unknown }[] } }[];
  return entries.filter((entry) => entry.body?.messages?.some((message) => message.role === 'user' && message.content === userPrompt));
}

export async function modelRequests(userPrompt = prompt) {
  return (await modelJournal(userPrompt)).length;
}
