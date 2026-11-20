Add thread persistence to my Angular component that uses angular, so conversations survive page refresh.

1. Put thread persistence in an injectable service so provider config can read it from Angular DI.

2. In that service, create a signal from storage: threadId = signal<string | null>(localStorage.getItem('chat-thread-id')).

3. Configure the agent with a provider factory, with provideAgent from '@threadplane/angular' and createSession from '@threadplane/langgraph': provideAgent(() => { const memory = inject(ThreadMemory); return { threadId: memory.threadId, onThreadId: (id) => memory.remember(id), createSession: (context) => createSession({ apiUrl: 'http://localhost:2024', assistantId: 'chat', threadId: context.threadId, onThreadId: context.onThreadId }) }; }).

4. The onThreadId callback fires once when the server creates a new thread. After that, the same thread ID is reused and the conversation history is read from the LangGraph server.

5. To start a new conversation, call memory.threadId.set(null) and clear storage — the injected agent moves to an empty conversation and the next submit creates a fresh thread.

No changes to the template are needed.
