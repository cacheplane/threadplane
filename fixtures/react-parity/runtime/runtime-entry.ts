import type { AgentSession } from '@threadplane/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This development-only entry composes private source into a temporary fixture bundle, never a package export.
import { createSession } from '../../../libs/langgraph/src/runtime/create-session';
import type { FixtureTools } from './scenarios';

/** Development-only composition, never a package entry or a shipped factory. */
export function createFixtureSession(
  endpoint: string,
  threadId: string,
  onHandler: () => void = () => undefined
): AgentSession<FixtureTools> & {
  load?: (options?: { signal?: AbortSignal }) => Promise<void>;
} {
  return createSession({
    assistantId: 'fixture-assistant',
    threadId,
    apiUrl: endpoint,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
    tools: {
      weather: {
        description: 'Current weather',
        handler: ({ city }: { city: string }) => {
          onHandler();
          return { city, temperature: 20 };
        },
      },
      count: {
        description: 'Count values',
        handler: ({ values }: { values: readonly string[] }) => {
          onHandler();
          return values.length;
        },
      },
    },
  });
}
