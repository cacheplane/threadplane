Add angular to my Angular 20–22 application.

Install: npm install @threadplane/chat @threadplane/angular @threadplane/core @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked

1. In app.config.ts, add provideAgent({ createSession: (context) => createSession({ apiUrl: 'http://localhost:2024', assistantId: 'chat', threadId: context.threadId, onThreadId: context.onThreadId }) }) to the providers array. Import provideAgent from '@threadplane/angular' and createSession from '@threadplane/langgraph'.

2. Create a component that imports ChatComponent from '@threadplane/chat' and calls injectAgent() from '@threadplane/angular' in the constructor or as a field initializer. injectAgent() MUST be called inside an Angular injection context — constructor or field initializer is correct; ngOnInit is not.

3. The component template can start with <chat [agent]="chat" />. For custom layouts, loop over chat.messages() with @for and call chat.submit(inputValue) from your input.

4. In the createSession call, the apiUrl should point to the LangGraph server. For local dev this is http://localhost:2024. For production use the LangGraph Platform URL from environment.ts.

The library is framework-integrated: no subscriptions, no async pipe needed — chat.messages() is an Angular Signal that updates token by token as the LLM responds.
