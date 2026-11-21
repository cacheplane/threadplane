Configure token-by-token streaming in my Angular component that uses angular.

The component already has injectAgent() from '@threadplane/angular' set up from a configured provideAgent({ createSession }) provider. Now:

1. In the template, bind to chat.messages() with @for — each runtime-neutral Message has role and content fields. The template re-renders automatically as tokens arrive because messages() is a Signal.

2. Show a loading indicator while streaming: use chat.status() === 'running' in an @if block.

3. To throttle rapid re-renders (if performance is a concern), pass throttle: 50 to createSession() from '@threadplane/langgraph' — this delivers Signal updates at most once per 50ms while a run streams and always delivers the final value. A session does not throttle unless told to.

4. chat.status() returns 'idle' | 'running' | 'error'. Read chat.error() for the failure when it is 'error'.

Do not use async pipe or subscribe() — the signals update automatically.
