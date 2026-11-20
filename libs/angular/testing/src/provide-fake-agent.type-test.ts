import { createAgentRef } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';
import type { FakeAgentSession } from '@threadplane/core/testing';
import {
  injectFakeAgentSession,
  provideFakeAgent,
  type FakeAgentConfig,
} from './public-api.js';

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
}
interface Board {
  todos: string[];
}

/** The fake provider follows the ref's session type, as `provideAgent` does. */
export function fakeAgent() {
  const FAKE = createAgentRef<AgentSession<Tools, Board>>('fake');
  provideFakeAgent(FAKE, { session: { state: { todos: [] } } });
  // @ts-expect-error The fake's initial state follows the ref's declaration.
  provideFakeAgent(FAKE, { session: { state: { todos: [1] } } });
  provideFakeAgent({ tokens: ['Hi'], delayMs: 0 });
  const config: FakeAgentConfig = { reasoningTokens: ['Thinking'] };
  provideFakeAgent(config);
  const fake = injectFakeAgentSession(FAKE);
  const read: () => FakeAgentSession<never, never> | object = fake;
  fake().setState({ todos: ['a'] });
  // @ts-expect-error The fake's controls are typed by the ref.
  fake().setState({ todos: [1] });
  return read;
}
