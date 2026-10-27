/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "^_" }] */
import type { AgentSession, ToolCall } from '../index.js';
import type { ExecutionContext, FunctionTool, ToolContracts } from './index.js';

interface Args {
  city: string;
  flags?: string[];
}
interface Result {
  temperature: number;
}
const weather: FunctionTool<Args, Result> = {
  description: 'Weather',
  handler: async (args, context) => {
    const signal: AbortSignal = context.signal;
    args.flags?.push('authored mutable args');
    void signal;
    return { temperature: args.city.length };
  },
};
const ping: FunctionTool<void, void> = {
  description: 'Ping',
  handler: (_args, _context: ExecutionContext) => undefined,
};
const catalog = { weather, ping };
const maybe: FunctionTool<void, string | void> = {
  description: 'Maybe',
  handler: () => undefined,
};
const maybeCall: ToolCall<ToolContracts<{ maybe: typeof maybe }>> = {
  id: 'maybe',
  name: 'maybe',
  args: undefined,
  status: 'complete',
  result: undefined,
};
declare const maybeSession: AgentSession<
  ToolContracts<{ maybe: typeof maybe }>
>;
const maybeObserver: AgentSession = maybeSession;
const wrongMaybe: ToolCall<ToolContracts<{ maybe: typeof maybe }>> = {
  id: 'bad',
  name: 'maybe',
  args: undefined,
  status: 'complete',
  // @ts-expect-error a void union still rejects wrong concrete results
  result: 2,
};
void [maybeCall, maybeObserver, wrongMaybe];
const nestedVoid: ToolCall<{
  nested: { args: void; result: { value: void } };
}> = {
  id: 'nested',
  name: 'nested',
  args: undefined,
  status: 'complete',
  result: { value: undefined },
};
void nestedVoid;
type Contracts = ToolContracts<typeof catalog>;
declare const call: ToolCall<Contracts>;
if (call.name === 'weather' && call.status === 'complete') {
  const city: string = call.args.city;
  const temperature: number = call.result.temperature;
  // @ts-expect-error snapshot retains authored types, no any fallback
  const wrong: string = call.result.temperature;
  // @ts-expect-error immutable snapshot arguments
  call.args.flags?.push('wrong');
  void [city, temperature, wrong];
}
declare const session: AgentSession<Contracts>;
const observer: AgentSession = session;
const wrongArgs: FunctionTool<Args, Result> = {
  description: 'Wrong',
  // @ts-expect-error handler argument must match authored interface
  handler: (_args: { query: string }) => ({ temperature: 2 }),
};
const wrongResult: FunctionTool<Args, Result> = {
  description: 'Wrong',
  // @ts-expect-error handler result must match authored interface
  handler: () => ({ temperature: 'wrong' }),
};
// @ts-expect-error Date is not portable argument data
const date: FunctionTool<Date, string> = {
  description: 'No',
  handler: () => '',
};
// @ts-expect-error executable results are not portable data
const executable: FunctionTool<void, { execute(): void }> = {
  description: 'No',
  handler: () => ({
    execute() {
      return undefined;
    },
  }),
};
const untyped: FunctionTool<unknown, string> = {
  description: 'No',
  handler: () => '',
};
const wrongName: ToolCall<Contracts> = {
  id: 'c',
  // @ts-expect-error wrong discriminant
  name: 'other',
  status: 'pending',
  args: { city: 'Paris' },
};
void [
  observer,
  wrongArgs,
  wrongResult,
  date,
  executable,
  untyped,
  wrongName,
  catalog,
  maybe,
];
