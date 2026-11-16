import type { AgentSession } from '@threadplane/core';
import type {
  CheckedTools,
  FunctionTool,
  ToolContracts,
} from '@threadplane/core/tools';
import {
  Chat,
  MessageList,
  ask,
  createClientTools,
  type AskToolViewProps,
  type ChatClientTools,
} from './index.js';

declare const session: AgentSession;
interface DayArgs {
  days: string[];
}
interface DayResult {
  day: string;
}
const clientTools = createClientTools({
  pick_day: ask<DayArgs, DayResult>({
    description: 'Ask which day to plan.',
    render: ({ args, answer }) => (
      <button type="button" onClick={() => answer({ day: args.days[0] })}>
        Pick
      </button>
    ),
  }),
  confirm: ask<{ summary: string }, boolean>({
    description: 'Confirm.',
    followUp: false,
    render: (props: AskToolViewProps<{ summary: string }, boolean>) =>
      props.answer(true) ? null : props.args.summary,
  }),
});

// Each ask is the function tool a session accepts, with its authored types.
const pick: FunctionTool<DayArgs, DayResult> = clientTools.tools.pick_day;
void pick;
// A session's `tools` option is `T & CheckedTools<T>`.
const checked: CheckedTools<typeof clientTools.tools> = clientTools.tools;
void checked;
type Contracts = ToolContracts<typeof clientTools.tools>;
const contract: Contracts['confirm'] = {
  args: { summary: 'Trip' },
  result: true,
};
void contract;
// @ts-expect-error The result type follows the declaration.
const wrong: Contracts['pick_day']['result'] = { day: 1 };
void wrong;
// @ts-expect-error Only declared tools exist.
void clientTools.tools.missing;

const face: ChatClientTools = clientTools;
<Chat session={session} clientTools={face} />;
<Chat session={session} clientTools={clientTools} />;
<Chat session={session} />;
<MessageList rows={[]} renderToolCallPrompt={(call) => face.render(call)} />;
// @ts-expect-error A prompt is a function of the call, not the controller.
<MessageList rows={[]} renderToolCallPrompt={face} />;
// @ts-expect-error The function-tool catalog alone has no views.
<Chat session={session} clientTools={clientTools.tools} />;

createClientTools({
  bad: ask<DayArgs, DayResult>({
    description: 'Wrong answer type.',
    // @ts-expect-error The answer must match the declared result.
    render: ({ answer }) => (answer({ day: 2 }) ? null : null),
  }),
});
