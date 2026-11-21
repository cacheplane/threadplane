import type { AgentSession } from '@threadplane/core';
import type { Agent } from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session; no production dependency.
import type { LangGraphSession } from '../../langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph run options.
import type { LangGraphRunOptions } from '../../langgraph/src/runtime/run-options';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI session; no production dependency.
import type { Session as AgUiSession } from '../../ag-ui/src/runtime/create-session';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
/** The members a type declares with `?`. */
type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * The optional members of each session type. `OPTIONAL_MEMBERS` in `agent.ts`
 * is the union of these three lists, less `threadId` and `lifecycle`, which
 * the agent replaces with controls of its own. A member added to or made
 * required on a session type fails here until that list follows.
 */
export type CoreOptional = Expect<
  Same<
    OptionalKeys<AgentSession>,
    | 'onCustomEvent'
    | 'runWithoutMessage'
    | 'regenerate'
    | 'resume'
    | 'clientTools'
    | 'checkStatus'
    | 'retry'
  >
>;
export type LangGraphOptional = Expect<
  Same<
    OptionalKeys<LangGraphSession>,
    'regenerate' | 'clientTools' | 'checkStatus' | 'retry' | 'load'
  >
>;
export type AgUiOptional = Expect<
  Same<
    OptionalKeys<AgUiSession>,
    | 'onCustomEvent'
    | 'runWithoutMessage'
    | 'regenerate'
    | 'clientTools'
    | 'checkStatus'
    | 'retry'
    | 'load'
    | 'onRawEvent'
    | 'reconcileInterrupt'
    | 'ready'
    | 'agentId'
    | 'stateType'
    | 'threadId'
    | 'lifecycle'
  >
>;

/** What is always present on a LangGraph agent is called with no check. */
export function langGraphCommands(agent: Agent<LangGraphSession>) {
  void agent.fork(
    { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c' },
    'Again'
  );
  void agent.reconnect();
  void agent.joinStream('run');
  void agent.setBranch('');
  void agent.cancelQueued('run');
  void agent.clearQueue();
  void agent.resume([]);
  void agent.runWithoutMessage();
  agent.onCustomEvent(() => undefined)();
  const enabled: boolean = agent.isDevelopmentRuntimeEnabled();

  // The optional ones are asked for first.
  void agent.load?.();
  void agent.retry?.();
  void agent.checkStatus?.();
  // @ts-expect-error An optional command must be checked before it is called.
  void agent.load();
  // @ts-expect-error An optional command must be checked before it is called.
  void agent.retry();
  return enabled;
}

/** `regenerate` takes the run options `submit` takes, not only a signal. */
export function langGraphRegenerate(agent: Agent<LangGraphSession>) {
  type Options = Expect<
    Same<
      Parameters<NonNullable<typeof agent.regenerate>>[1],
      LangGraphRunOptions | undefined
    >
  >;
  void agent.regenerate?.('message', {
    signal: new AbortController().signal,
    config: { configurable: { model: 'small' } },
    context: { tone: 'brief' },
    metadata: { reason: 'regenerate' },
    run: { interruptBefore: ['tools'], streamMode: ['debug'] },
  });
  // @ts-expect-error A run setting belongs under `run`, where it is read.
  void agent.regenerate?.('message', { interruptBefore: ['tools'] });
  return {} as Options;
}

/** The LangGraph-only commands are not AG-UI members. */
export function agUiCommands(agent: Agent<AgUiSession>) {
  void agent.resume([]);
  void agent.onRawEvent?.(() => undefined);
  void agent.reconcileInterrupt?.();
  const ready: Promise<void> | undefined = agent.ready;
  const agentId: string | undefined = agent.agentId;
  // @ts-expect-error LangGraph reconnect is not an AG-UI command.
  void agent.reconnect;
  // @ts-expect-error LangGraph joinStream is not an AG-UI command.
  void agent.joinStream;
  return [ready, agentId];
}
