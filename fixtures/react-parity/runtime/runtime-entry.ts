import type {
  AgentSession,
  CompleteOutcome,
  PlainValue,
} from '@threadplane/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This development-only entry composes private source into a temporary fixture bundle, never a package export.
import { createSession } from '../../../libs/langgraph/src/runtime/create-session';
import type {
  FixtureCheckpoint,
  FixtureRunOptions,
  FixtureSnapshot,
  FixtureSubmitInput,
  FixtureTools,
} from './scenarios';
import { createFixtureTools } from './tools.js';

/** Development-only composition, never a package entry or a shipped factory. */
export function createFixtureSession(
  endpoint: string,
  threadId: string,
  onHandler: () => void = () => undefined
): Omit<AgentSession<FixtureTools>, 'getSnapshot' | 'submit'> & {
  getSnapshot(): FixtureSnapshot;
  submit(
    input: FixtureSubmitInput,
    options?: FixtureRunOptions
  ): Promise<CompleteOutcome>;
  fork(
    checkpoint: FixtureCheckpoint,
    input: FixtureSubmitInput,
    options?: FixtureRunOptions
  ): Promise<CompleteOutcome>;
  load?: (options?: { signal?: AbortSignal }) => Promise<void>;
  resume(
    value?: PlainValue,
    options?: FixtureRunOptions
  ): Promise<CompleteOutcome>;
  reconnect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CompleteOutcome>;
} {
  return createSession({
    assistantId: 'fixture-assistant',
    threadId,
    apiUrl: endpoint,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
    tools: createFixtureTools(onHandler),
  });
}
