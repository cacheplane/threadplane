import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpAgent } from '@ag-ui/client';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react';
import { useAgUiRuntime } from '@assistant-ui/react-ag-ui';
import {
  CopilotKitProvider,
  CopilotChat,
  useDefaultRenderTool,
  HttpAgent as CopilotHttpAgent,
} from '@copilotkit/react-core/v2';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart } from 'ai';
import { ToolFallback } from './tool-fallback';
import {
  Trace,
  TraceLine,
  TraceTitle,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from './trace';
import { getScenario } from './scenarios.mjs';
import './vendor.css';

const params = new URLSearchParams(location.search);
const participant = params.get('participant') ?? 'assistant-ui';
const scenario = params.get('scenario') ?? 'references';
const endpoint = (protocol: string) =>
  `http://127.0.0.1:4809/${protocol}?participant=${participant}&scenario=${scenario}`;
const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function Message() {
  return (
    <MessagePrimitive.Root className="native-message">
      <MessagePrimitive.Parts
        components={{ tools: { Fallback: ToolFallback } }}
      />
      <MessagePrimitive.Error />
    </MessagePrimitive.Root>
  );
}
function AssistantUi() {
  const agent = useMemo(() => new HttpAgent({ url: endpoint('ag-ui') }), []);
  const runtime = useAgUiRuntime({ agent });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="native-thread">
        <ThreadPrimitive.Viewport className="native-viewport">
          <ThreadPrimitive.Messages
            components={{ UserMessage: Message, AssistantMessage: Message }}
          />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="native-composer">
          <ComposerPrimitive.Input aria-label="Message" />
          <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
          <ComposerPrimitive.Cancel>Stop</ComposerPrimitive.Cancel>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
function Copilot() {
  const agents = useMemo(
    () => ({ default: new CopilotHttpAgent({ url: endpoint('ag-ui') }) }),
    []
  );
  return (
    <CopilotKitProvider
      selfManagedAgents={agents}
      enableInspector={false}
      showIntelligenceIndicator={false}
    >
      <CopilotDefault />
    </CopilotKitProvider>
  );
}
function CopilotDefault() {
  useDefaultRenderTool();
  return (
    <CopilotChat
      agentId="default"
      threadId="benchmark"
      style={{ height: '100%' }}
    />
  );
}
// App-authored mapping of real AI SDK parts to the official shadcn Trace components.
function Shadcn() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: endpoint('ai-sdk') }),
    []
  );
  const { messages, status, error, sendMessage, stop } = useChat({ transport });
  const [draft, setDraft] = useState(getScenario(scenario).prompt);
  const busy = status === 'submitted' || status === 'streaming';
  return (
    <div className="native-thread">
      <div className="native-viewport">
        {messages.map((message) => (
          <article className="native-message" key={message.id}>
            {message.parts.map((part, index) => {
              if (part.type === 'text') return <p key={index}>{part.text}</p>;
              if (!isToolUIPart(part)) return null;
              const name =
                part.type === 'dynamic-tool'
                  ? part.toolName
                  : part.type.slice(5);
              const running =
                part.state === 'input-streaming' ||
                part.state === 'input-available';
              const line = (
                <TraceLine
                  status={
                    running
                      ? 'running'
                      : part.state === 'output-error'
                      ? 'error'
                      : undefined
                  }
                >
                  <TraceTitle>
                    {running
                      ? 'Running'
                      : part.state === 'output-error'
                      ? 'Failed'
                      : 'Used'}{' '}
                    {name}
                  </TraceTitle>
                </TraceLine>
              );
              return (
                <Trace key={part.toolCallId}>
                  {running ? (
                    line
                  ) : (
                    <TraceCollapsible>
                      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                      <TraceCollapsibleContent>
                        <pre>{literal(part.input)}</pre>
                        <pre>
                          {part.state === 'output-error'
                            ? part.errorText
                            : part.state === 'output-available'
                            ? literal(part.output)
                            : part.state}
                        </pre>
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  )}
                </Trace>
              );
            })}
          </article>
        ))}
        {error && <p role="alert">{error.message}</p>}
      </div>
      <form
        className="native-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && draft.trim()) {
            void sendMessage({ text: draft });
            setDraft('');
          }
        }}
      >
        <textarea
          aria-label="Message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button disabled={busy}>Send</button>
        <button type="button" disabled={!busy} onClick={() => void stop()}>
          Stop
        </button>
      </form>
    </div>
  );
}
function App() {
  return (
    <>
      <header className="benchmark-header">
        <div>
          <h1>Tool conversation benchmark · {participant}</h1>
          <p>
            Scripted agent · real local tools · {scenario} · native transport
          </p>
        </div>
        <button
          onClick={async () => {
            await fetch(`http://127.0.0.1:4809/reset/${participant}`, {
              method: 'POST',
            });
            location.reload();
          }}
        >
          New conversation
        </button>
      </header>
      <main className="benchmark-chat">
        {participant === 'copilotkit' ? (
          <Copilot />
        ) : participant === 'shadcn' ? (
          <Shadcn />
        ) : (
          <AssistantUi />
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
