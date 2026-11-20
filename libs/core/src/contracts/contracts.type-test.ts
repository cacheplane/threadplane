import type {
  AgentError,
  AgentInterrupt,
  AgentInterruptResponse,
  AgentSession,
  AgentSnapshot,
  AgentSubagent,
  AgentSubagentStatus,
  AgentUsage,
  Citation,
  CompleteOutcome,
  Message,
  MessageDelivery,
  PlainValue,
  ToolCall,
} from '../index';

declare const snapshot: AgentSnapshot;
declare const session: AgentSession;
declare const citation: Citation;
const reasoning: Message['reasoning'] = snapshot.messages[0].reasoning;
// @ts-expect-error reasoning is readonly display data
snapshot.messages[0].reasoning = 'changed';
// @ts-expect-error reasoning accepts strings only
const invalidReasoning: Message['reasoning'] = { text: 'hidden' };
void [reasoning, invalidReasoning];
const citationList: Message['citations'] = [citation];
// @ts-expect-error citation collections are readonly
citationList.push(citation);
// @ts-expect-error citation fields are readonly
citation.title = 'changed';
if (citation.extra) {
  // @ts-expect-error provider metadata is readonly
  citation.extra['changed'] = true;
}
// @ts-expect-error timestamps are portable primitives
const datedCitation: Citation = { id: 'c', index: 1, publishedAt: new Date() };
const opaqueCitation: Citation = {
  id: 'c',
  index: 1,
  // @ts-expect-error SDK instances are not portable metadata
  extra: { date: new Date() },
};
const callableCitation: Citation = {
  id: 'c',
  index: 1,
  // @ts-expect-error functions are not portable metadata
  extra: { run: () => 1 },
};
void [datedCitation, opaqueCitation, callableCitation];
// @ts-expect-error snapshot fields are readonly
snapshot.status = 'running';
// @ts-expect-error snapshot collections are readonly
snapshot.messages.push(snapshot.messages[0]);
// @ts-expect-error tool-call collections are readonly
snapshot.toolCalls.push(snapshot.toolCalls[0]);
// @ts-expect-error message fields are readonly
snapshot.messages[0].content = 'changed';
// @ts-expect-error nested collections are readonly
snapshot.messages[0].toolCallIds?.push('call-2');
// @ts-expect-error delivery fields are readonly
snapshot.messages[0].delivery.generation = 'run-2';
if (snapshot.error) {
  // @ts-expect-error errors are readonly plain projections
  snapshot.error.message = 'changed';
}
// @ts-expect-error full message payload submission is outside the text session slice
session.submit({ messages: [] });
// @ts-expect-error custom events are optional on the core session
session.onCustomEvent(() => undefined);
const releaseCustom: (() => void) | undefined = session.onCustomEvent?.(
  (event) => {
    const name: string = event.name;
    const data: PlainValue = event.data;
    // @ts-expect-error custom events are readonly
    event.name = name;
    return data;
  }
);
void releaseCustom;
// @ts-expect-error strict null checking must remain enabled for these fixtures
const invalidStatus: AgentSnapshot['status'] = null;

type Tools = {
  weather: {
    args: { city: string; coordinates: number[] };
    result: { temperature: number };
  };
  search: { args: { query: string }; result: { hits: string[] } };
};
interface WeatherArgs {
  city: string;
  preferences?: { units: 'c' | 'f' };
}
interface WeatherResult {
  temperature: number;
}
type InterfaceTools = {
  weather: { args: WeatherArgs; result: WeatherResult };
  ping: { args: void; result: void };
};
const interfaceCall: ToolCall<InterfaceTools> = {
  id: 'i',
  name: 'weather',
  args: { city: 'P' },
  status: 'complete',
  result: { temperature: 20 },
};
const noInput: ToolCall<InterfaceTools> = {
  id: 'p',
  name: 'ping',
  args: undefined,
  status: 'complete',
  result: undefined,
};
const rejected: ToolCall<InterfaceTools> = {
  id: 'p',
  name: 'ping',
  args: undefined,
  status: 'error',
  error: 'Handler declined',
};
declare const unionCall: ToolCall<InterfaceTools>;
declare const declaredCall: ToolCall<Tools>;
if (declaredCall.name === 'search' && declaredCall.status === 'complete') {
  // @ts-expect-error authored nested result arrays are readonly
  declaredCall.result.hits.push('new');
}
declare const authoredSession: AgentSession<InterfaceTools>;
const observerSession: AgentSession = authoredSession;
if (unionCall.name === 'weather' && unionCall.status === 'complete') {
  const temperature: number = unionCall.result.temperature;
  const city: string = unionCall.args.city;
  void [temperature, city];
}
const weather: ToolCall<Tools> = {
  id: 'call-1',
  name: 'weather',
  status: 'complete',
  args: { city: 'Portland', coordinates: [45, -122] },
  result: { temperature: 20 },
};
// @ts-expect-error nested authored arguments become readonly
weather.args.coordinates.push(0);
// @ts-expect-error nested authored fields become readonly
weather.result.temperature = 21;
const badArgs: ToolCall<Tools> = {
  id: 'c',
  name: 'weather',
  status: 'running',
  // @ts-expect-error name and arguments remain correlated
  args: { query: 'rain' },
};
const badResult: ToolCall<Tools> = {
  id: 'c',
  name: 'weather',
  status: 'complete',
  args: { city: 'P', coordinates: [] },
  // @ts-expect-error name and result remain correlated
  result: { hits: [] },
};
// @ts-expect-error missing result on completed call
const incomplete: ToolCall<Tools> = {
  id: 'c',
  name: 'weather',
  status: 'complete',
  args: { city: 'P', coordinates: [] },
};
// @ts-expect-error arbitrary SDK values are not portable data
const sdkData: PlainValue = new Date();
// @ts-expect-error callable values are not portable data
const functionData: PlainValue = { execute: () => 1 };
const unsupportedTool: ToolCall<{
  run: { args: { execute: () => void }; result: string };
}> = {
  id: 'x',
  name: 'run',
  status: 'running',
  // @ts-expect-error declared tools cannot introduce executable snapshot data
  args: { execute: () => undefined },
};
const richMessage: Message = {
  id: 'm',
  role: 'assistant',
  // @ts-expect-error structured content has not been ported in this slice
  content: [{ type: 'text', text: 'hi' }],
  delivery: { generation: 'g', phase: 'streaming' },
};
const premature: MessageDelivery = {
  generation: 'g',
  phase: 'streaming',
  // @ts-expect-error streaming delivery does not have an outcome
  outcome: 'success',
};
const cause: AgentError = {
  kind: 'server',
  message: 'failed',
  retryable: true,
  // @ts-expect-error errors cannot expose arbitrary mutable causes
  cause: new Error(),
};

void [
  weather,
  interfaceCall,
  noInput,
  rejected,
  observerSession,
  unsupportedTool,
  badArgs,
  badResult,
  incomplete,
  sdkData,
  functionData,
  richMessage,
  premature,
  cause,
  invalidStatus,
];

// retry is optional and reports the re-run's outcome, like submit.
const retried: Promise<CompleteOutcome> | undefined = session.retry?.();
// @ts-expect-error retry resolves with an outcome, not a string of any kind
const retriedText: Promise<number> | undefined = session.retry?.();
const usage: AgentUsage | undefined = snapshot.usage;
// @ts-expect-error usage entries are readonly
usage?.entries.push({ inputTokens: 1 });
void [retried, retriedText, usage];

// Interrupts: optional on the snapshot, readonly, and answered through resume.
const interrupts: readonly AgentInterrupt[] | undefined = snapshot.interrupts;
const interruptValue: PlainValue = interrupts?.[0]?.value;
// @ts-expect-error pending interrupts are readonly
interrupts?.push({ id: 'i' });
// @ts-expect-error an interrupt's fields are readonly
if (interrupts?.[0]) interrupts[0].id = 'other';
const resolved: AgentInterruptResponse = {
  interruptId: 'i',
  status: 'resolved',
  value: { approved: true },
};
const cancelled: AgentInterruptResponse = {
  interruptId: 'i',
  status: 'cancelled',
};
// @ts-expect-error a cancelled response carries no value
const cancelledWithValue: AgentInterruptResponse = {
  interruptId: 'i',
  status: 'cancelled',
  value: 1,
};
// @ts-expect-error a response names its interrupt
const unnamed: AgentInterruptResponse = { status: 'resolved' };
const unsendable: AgentInterruptResponse = {
  interruptId: 'i',
  status: 'resolved',
  // @ts-expect-error a response value is plain data
  value: new Date(),
};
// resume is optional and reports the continued run's outcome, like submit.
const resumed: Promise<CompleteOutcome> | undefined = session.resume?.(
  [resolved, cancelled],
  { signal: new AbortController().signal }
);
// @ts-expect-error resume takes the responses as a list
session.resume?.(resolved);
// A session with no resume command is still an AgentSession.
const cannotPause: AgentSession = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  submit: async () => 'success',
  stop: async () => undefined,
  dispose: async () => undefined,
};
void [
  interruptValue,
  cancelledWithValue,
  unnamed,
  unsendable,
  resumed,
  cannotPause,
];

// Child agents: optional on the snapshot, each with its own readonly transcript.
const subagents: readonly AgentSubagent[] | undefined = snapshot.subagents;
const childMessages: readonly Message[] | undefined = subagents?.[0]?.messages;
const childCalls: readonly ToolCall[] | undefined = subagents?.[0]?.toolCalls;
const childStatus: AgentSubagentStatus | undefined = subagents?.[0]?.status;
const pendingChildStatus: AgentSubagentStatus = 'pending';
// @ts-expect-error a child agent has no status outside the declared ones
const invalidChildStatus: AgentSubagentStatus = 'cancelled';
// @ts-expect-error a child's messages are readonly
subagents?.[0]?.messages.push();
// @ts-expect-error a child agent needs its transcript
const bare: AgentSubagent = { id: 'c', status: 'running' };
// A session typed with authored tools reports the same child shape.
declare const authored: AgentSnapshot<{
  weather: { args: { city: string }; result: { temp: number } };
}>;
const authoredChildren: readonly AgentSubagent[] | undefined =
  authored.subagents;
void [
  childMessages,
  childCalls,
  childStatus,
  pendingChildStatus,
  invalidChildStatus,
  bare,
  authoredChildren,
];

// Structured content sits beside the text, never in place of it.
import type {
  AgentCheckpoint,
  AgentClientTools,
  AgentErrorDiagnostic,
  AgentInputBlock,
  AgentResumeOptions,
  ClientToolResult,
  ClientToolSpec,
  ContentBlock,
  StreamingToolCall,
} from '../index';
import { onAgentStateUpdate, projectErrorDiagnostic } from '../index';

const blocks: readonly ContentBlock[] | undefined = snapshot.messages[0].blocks;
const text: string = snapshot.messages[0].content;
// @ts-expect-error block lists are readonly
snapshot.messages[0].blocks?.push({ type: 'text', text: 'more' });
const firstBlock = blocks?.[0];
if (firstBlock?.type === 'text') {
  // @ts-expect-error block fields are readonly
  firstBlock.text = 'changed';
}
// @ts-expect-error a block needs a known type
const unknownBlock: ContentBlock = { type: 'video', url: 'u' };
const callableBlock: ContentBlock = {
  type: 'tool_use',
  id: 't',
  name: 'lookup',
  // @ts-expect-error block arguments are plain data
  args: { run: () => 1 },
};
const extra: PlainValue = snapshot.messages[0].extra?.['tool_calls'];
if (snapshot.messages[0].extra) {
  // @ts-expect-error message extras are readonly
  snapshot.messages[0].extra['changed'] = true;
}
const sdkExtra: Message = {
  id: 'm',
  role: 'assistant',
  content: '',
  delivery: { generation: 'g', phase: 'streaming' },
  // @ts-expect-error extras are plain data, not SDK instances
  extra: { at: new Date() },
};
void [text, unknownBlock, callableBlock, extra, sdkExtra];

// A submission may add blocks to its message; it always has the message.
void session.submit({
  message: 'Look',
  blocks: [{ type: 'text', text: 'Look' }],
});
// @ts-expect-error blocks do not replace the message text
void session.submit({ blocks: [{ type: 'text', text: 'Look' }] });
// run carries state only, and is optional.
const ran: Promise<CompleteOutcome> | undefined = session.run?.({
  state: { step: 1 },
});
// @ts-expect-error run appends no message
void session.run?.({ message: 'Hello' });
void ran;

// A resume may carry a message and a state update in the same request.
const resumeOptions: AgentResumeOptions = {
  message: 'Approved',
  state: { reviewer: 'Ada' },
  signal: new AbortController().signal,
};
void session.resume?.([], resumeOptions);
// @ts-expect-error resume state is plain data
void session.resume?.([], { state: { run: () => 1 } });

// Result parts belong to finished calls only.
const withParts: ToolCall = {
  id: 'c',
  name: 'lookup',
  args: {},
  status: 'complete',
  result: 'ok',
  parts: [{ type: 'text', text: 'ok' }],
};
const pendingParts: ToolCall = {
  id: 'c',
  name: 'lookup',
  args: {},
  status: 'pending',
  // @ts-expect-error an unfinished call has no result parts
  parts: [],
};
void [withParts, pendingParts];

// Calls whose arguments still stream are listed apart from finished ones.
const streaming: readonly StreamingToolCall[] | undefined =
  snapshot.streamingToolCalls;
const partialText: string | undefined = streaming?.[0]?.argsText;
// @ts-expect-error streaming calls are readonly
snapshot.streamingToolCalls?.push();
// @ts-expect-error a streaming call is not a tool call: it has no status
const notFinal: ToolCall = { id: 'c', name: 'lookup', argsText: '{' };
void [partialText, notFinal];

// The diagnostic is plain data; the raw cause stays out.
const diagnostic: AgentErrorDiagnostic | undefined = snapshot.errorDiagnostic;
const described: AgentErrorDiagnostic = projectErrorDiagnostic(new Error('x'));
if (diagnostic) {
  // @ts-expect-error diagnostics are readonly
  diagnostic.message = 'changed';
}
const rawDiagnostic: AgentError = {
  kind: 'server',
  message: 'failed',
  retryable: false,
  // @ts-expect-error the diagnostic sits beside the error, not on it
  diagnostic: described,
};
// @ts-expect-error a diagnostic is a description, not the thrown value's data
const liveDiagnostic: AgentErrorDiagnostic = { message: 'x', data: new Map() };
void [described, rawDiagnostic, liveDiagnostic];

// Child agents may report their own state.
const childState: PlainValue = snapshot.subagents?.[0]?.state?.['step'];
if (snapshot.subagents?.[0]?.state) {
  // @ts-expect-error child state is readonly
  snapshot.subagents[0].state['step'] = 2;
}
const childStreaming: readonly StreamingToolCall[] | undefined =
  snapshot.subagents?.[0]?.streamingToolCalls;
void [childState, childStreaming];

// An interrupt may say that it can be shown and not answered.
const resumable: boolean | undefined = snapshot.interrupts?.[0]?.resumable;
void resumable;

// History, the message map and the input block are optional plain data.
const checkpoints: readonly AgentCheckpoint[] | undefined =
  snapshot.checkpoints;
const checkpointValue: PlainValue = checkpoints?.[0]?.values['todos'];
const checkpointOf: string | undefined = snapshot.messageCheckpoints?.['m1'];
// @ts-expect-error checkpoints are readonly
snapshot.checkpoints?.push();
if (checkpoints?.[0]) {
  // @ts-expect-error checkpoint values are readonly
  checkpoints[0].values['todos'] = [];
}
// @ts-expect-error a checkpoint carries its state values
const bare: AgentCheckpoint = { id: 'c' };
// @ts-expect-error the message map is plain data, not a Map
const mapped: AgentSnapshot['messageCheckpoints'] = new Map<string, string>();
const block: AgentInputBlock | undefined = snapshot.inputBlocked;
// @ts-expect-error an input block names its reason
const unexplained: AgentInputBlock = { message: 'Wait' };
void [checkpointValue, checkpointOf, bare, mapped, block, unexplained];

// Client tools: commands on the session, pending calls in the snapshot.
const clientTools: AgentClientTools | undefined = session.clientTools;
const awaiting: readonly ToolCall[] | undefined = snapshot.pendingClientTools;
const spec: ClientToolSpec = {
  name: 'locate',
  description: 'Finds the user.',
  parameters: { type: 'object' },
};
clientTools?.setCatalog([spec]);
clientTools?.resolve('c', { ok: true, value: { city: 'Oslo' } });
clientTools?.settle?.('c', { ok: false, error: 'Denied' });
const flushed: void | Promise<void> = clientTools?.flush?.();
// @ts-expect-error a failed result carries display text, not a value
const mixed: ClientToolResult = { ok: false, value: 1 };
// @ts-expect-error a result value is plain data
clientTools?.resolve('c', { ok: true, value: new Date() });
// @ts-expect-error a tool's parameters are a plain JSON Schema
const liveSpec: ClientToolSpec = { ...spec, parameters: { check: () => true } };
// @ts-expect-error the capability cannot be replaced on a session
session.clientTools = undefined;
void [awaiting, flushed, mixed, liveSpec];

// Render-store updates ride on custom events.
const releaseUpdates: () => void = onAgentStateUpdate(session, (update) => {
  const value: PlainValue = update['/path'];
  // @ts-expect-error an update is readonly
  update['/path'] = value;
});
void releaseUpdates;
