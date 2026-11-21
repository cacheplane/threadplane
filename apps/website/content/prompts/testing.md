Write unit tests for my Angular component that uses angular, without hitting a real LangGraph server.

Start with provideFakeAgent from '@threadplane/angular/testing'. It provides the same injected agent over an in-memory session that streams a canned reply:
providers: [provideFakeAgent({ tokens: ['Hello', ' world'], delayMs: 0 })]
const chat = TestBed.runInInjectionContext(() => injectAgent());
await chat.submit('Hi');
expect(chat.messages().at(-1)?.content).toBe('Hello world');

Use MockAgentTransport from '@threadplane/langgraph' only when the test has to run the real LangGraph session. It implements AgentTransport and lets you script exactly what events the stream emits.

Test setup:
const transport = new MockAgentTransport();
providers: [provideAgent({ threadId: 'thread-1', createSession: (context) => createSession({ assistantId: 'test', transport, threadId: context.threadId, onThreadId: context.onThreadId }) })]
const chat = TestBed.runInInjectionContext(() => injectAgent());

Import provideAgent and injectAgent from '@threadplane/angular', and createSession from '@threadplane/langgraph'. Give the agent a threadId: MockAgentTransport does not create threads.

To emit a streaming response, await every emit and end the run with a values event:
const submitted = chat.submit('Hi');
await transport.emit([{ type: 'messages', messages: [{ id: 'ai-1', type: 'ai', content: 'Hello' }] }]);
await transport.emit([{ type: 'values', data: { messages: [{ id: 'ai-1', type: 'ai', content: 'Hello' }] } }]);
await transport.close();
await submitted;

Assertions:
expect(chat.messages().at(-1)?.content).toBe('Hello');
expect(chat.status()).toBe('idle');

To test error state:
const submitted = chat.submit('Hi');
await transport.emitError(new Error('Network failure'));
await submitted;
expect(chat.status()).toBe('error');
expect(chat.error()?.kind).toBe('interrupted');

chat.error() is a plain object with kind, message and retryable, not an Error instance. Never mock injectAgent() itself — test through provideFakeAgent() or the real provider.
