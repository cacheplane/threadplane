Configure angular globally and per-component in my Angular application.

Global config:
In app.config.ts, add provideAgent({ createSession: (context) => createSession({ apiUrl: 'https://my-langgraph-server.com', assistantId: 'my-agent', threadId: context.threadId, onThreadId: context.onThreadId }) }) to the providers array. Import provideAgent from '@threadplane/angular' and createSession from '@threadplane/langgraph'.

Scoped override for one component subtree:
Add providers: [provideAgent({ createSession: (context) => createSession({ apiUrl: 'https://other-server.com', assistantId: 'other-agent', threadId: context.threadId, onThreadId: context.onThreadId }) })] on that component. Components under that subtree call injectAgent() from '@threadplane/angular' and receive the scoped agent.

Values from Angular DI:
Pass a factory, provideAgent(() => ({ createSession: ... })). It runs once in an injection context, and createSession itself may call inject(). Request headers and other SDK client options go through provideAgentClientOptions(options) from '@threadplane/angular'; read them in the factory as context.clientOptions and pass them to createSession({ clientOptions }).

Custom transport (for logging or testing):
Implement the AgentTransport interface from @threadplane/langgraph. Its required method is stream(assistantId, threadId, payload, signal, options), and optional methods cover queued runs, cancellation, history, and updateState. Pass an AgentTransport instance as transport: myTransport to createSession(). FetchStreamTransport is the default.

To pass per-run LangGraph config, pass it when submitting:
chat.submit(message, { config: { configurable: { system_prompt: 'You are a helpful assistant.' } } })
Per-run settings such as multitaskStrategy go under run: chat.submit(message, { run: { multitaskStrategy: 'enqueue' } }).
