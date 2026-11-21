import { createSession } from '@threadplane/langgraph';
import { createFixtureTools } from './tools.js';

/** Actual installed candidate; inferred return retains the complete backend declarations. */
export function createFixtureSession(
  endpoint: string,
  threadId: string,
  onHandler: () => void = () => undefined
) {
  return createSession({
    assistantId: 'fixture-assistant',
    threadId,
    apiUrl: endpoint,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
    tools: createFixtureTools(onHandler),
  });
}
