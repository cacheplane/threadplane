import { createAgentRef } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';
import type { FakeAgentSession } from '@threadplane/core/testing';
import {
  injectFakeAgentSession,
  provideFakeAgent,
  type FakeAgentConfig,
} from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session; no production dependency.
import type { LangGraphSession } from '../../../langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI session; no production dependency.
import type { Session as AgUiSession } from '../../../ag-ui/src/runtime/create-session';

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

/**
 * A ref declared with a backend's session type takes the fake without a cast,
 * and the fake's state and tool names follow that session's declaration.
 */
export function backendRefs() {
  const TRIP = createAgentRef<LangGraphSession<Tools, Board>>('trip');
  provideFakeAgent(TRIP);
  provideFakeAgent(TRIP, { tokens: ['Hi'], delayMs: 0 });
  provideFakeAgent(TRIP, { session: { state: { todos: ['a'] } } });
  // @ts-expect-error The fake's initial state follows the ref's declaration.
  provideFakeAgent(TRIP, { session: { state: { todos: [1] } } });
  provideFakeAgent(TRIP, {
    session: {
      toolCalls: [
        {
          id: 'call',
          name: 'weather',
          args: { city: 'Oslo' },
          status: 'complete',
          result: { temperature: 4 },
        },
      ],
      onSubmit: (_input, fake) => {
        fake.setState({ todos: ['b'] });
      },
    },
  });
  provideFakeAgent(TRIP, {
    session: {
      toolCalls: [
        // @ts-expect-error The fake's tool calls follow the ref's tools.
        { id: 'call', name: 'other', args: {}, status: 'pending' },
      ],
    },
  });
  const trip = injectFakeAgentSession(TRIP);
  trip().setState({ todos: ['a'] });
  // @ts-expect-error The fake's controls are typed by the ref's state.
  trip().setState({ todos: [1] });

  // A LangGraph session that declares neither tools nor state.
  const PLAIN = createAgentRef<LangGraphSession>('plain');
  provideFakeAgent(PLAIN);
  provideFakeAgent(PLAIN, { session: { state: { anything: 1 } } });
  injectFakeAgentSession(PLAIN)().setState({ anything: 2 });

  // The AG-UI session.
  const BOARD = createAgentRef<AgUiSession<Board>>('board');
  provideFakeAgent(BOARD);
  provideFakeAgent(BOARD, { session: { state: { todos: [] } } });
  // @ts-expect-error The fake's initial state follows the ref's declaration.
  provideFakeAgent(BOARD, { session: { state: { todos: [1] } } });
  injectFakeAgentSession(BOARD)().setState({ todos: ['a'] });
  return trip;
}
