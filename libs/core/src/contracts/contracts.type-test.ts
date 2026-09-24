import type {
  AgentError,
  AgentSession,
  AgentSnapshot,
  Citation,
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
