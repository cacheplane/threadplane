import type { Tool } from '@ag-ui/client';
import type {
  CompleteOutcome,
  DeepReadonly,
  ToolContract,
} from '@threadplane/core';
import type { FunctionToolDefinition } from '@threadplane/core/tools';
import { copyData } from './copy-data.js';
import type { SessionSnapshot } from './agent-session.js';

/**
 * One call to a client tool the session runs, with its typed arguments and
 * result, how far it has run and whether the backend has its result.
 */
export type ClientToolCall<C extends Record<string, ToolContract>> = {
  [K in keyof C & string]: {
    readonly name: K;
    readonly callId: string;
    readonly assistantMessageId: string;
    readonly sourceRunId: string;
    readonly rawArguments: string;
    readonly args?: DeepReadonly<C[K]['args']>;
    readonly result?: DeepReadonly<C[K]['result']>;
    readonly error?: string;
    readonly status: 'pending' | 'running' | 'complete' | 'error' | 'cancelled';
    readonly delivery: 'unsent' | 'sent-unconfirmed' | 'observed';
    readonly provenance: 'local';
  };
}[keyof C & string];

/** Why a session's client tools stopped before the run could continue. */
export interface ClientToolBlocker {
  /** What stopped the calls. */
  readonly reason:
    | 'unsupported'
    | 'conflict'
    | 'cancelled'
    | 'uncertain'
    | 'limit';
  /** The run that made the blocked calls. */
  readonly sourceRunId: string;
  /** The blocked calls, by `callId`. */
  readonly callIds: readonly string[];
}

/**
 * The snapshot of a session that runs client tools: the session snapshot, with
 * the tool calls, what blocks them and the outcome of the last tool command.
 */
export type ClientToolSessionSnapshot<
  C extends Record<string, ToolContract>,
  TState = unknown
> = SessionSnapshot<TState> & {
  readonly clientTools: {
    readonly calls: readonly ClientToolCall<C>[];
    readonly blocker?: ClientToolBlocker;
    readonly commandOutcome?: CompleteOutcome;
  };
};

interface CapturedClientTool {
  readonly description: string;
  readonly parameters: unknown;
  readonly followUp: boolean;
  readonly handler: FunctionToolDefinition['handler'];
}

/** Select fields before ownership copying: unrelated metadata grants no authority. */
export function captureClientTools(
  tools: Record<string, FunctionToolDefinition>
): ReadonlyMap<string, CapturedClientTool> {
  const captured = new Map<string, CapturedClientTool>();
  for (const name of Object.keys(tools)) {
    const definition = tools[name];
    const { description, parameters, followUp = true, handler } = definition;
    if (
      typeof description !== 'string' ||
      typeof followUp !== 'boolean' ||
      typeof handler !== 'function'
    )
      throw new TypeError('Invalid client tool definition');
    captured.set(
      name,
      Object.freeze({
        description,
        parameters: copyData(parameters, true),
        followUp,
        handler,
      })
    );
  }
  return captured;
}

/** Each physical request owns independent mutable wire metadata. */
export function requestClientTools(
  tools: ReadonlyMap<string, CapturedClientTool>
): Tool[] {
  return [...tools].map(([name, definition]) => ({
    name,
    description: definition.description,
    ...(definition.parameters !== undefined && {
      parameters: copyData(definition.parameters, false) as Tool['parameters'],
    }),
  }));
}
