import type { Config, StreamMode } from '@langchain/langgraph-sdk';
import type { DeepReadonly, PlainValue } from '@threadplane/core';
import { ownValue } from './ownership.js';
import type { LangGraphSubmitOptions } from './transport.types.js';

/**
 * The `configurable` record of a run's `config`: plain data. The thread and
 * checkpoint routing keys are the session's own and cannot be given here.
 */
export type LangGraphRunConfigurable = Readonly<Record<string, PlainValue>> & {
  readonly thread_id?: never;
  readonly checkpoint_id?: never;
  readonly checkpoint_ns?: never;
  readonly checkpoint_map?: never;
};

/**
 * LangGraph settings for the run a command creates, passed to the run-creation
 * request. They are grouped under `run` so that a caller states them on
 * purpose: nothing at the root of the options is ever read as one.
 */
export interface LangGraphRunSettings {
  /**
   * A graph command sent with the run: a state `update` and a `goto`. With
   * `resume`, the session adds the answer, so one command both answers a pause
   * and updates the state. The answer itself is never given here.
   */
  readonly command?: {
    readonly update?: PlainValue;
    readonly goto?: PlainValue;
    readonly resume?: never;
  };
  /**
   * Start the run from a saved checkpoint instead of the thread's newest one.
   * `checkpointId` is the short form for a root checkpoint. The thread gains a
   * branch there; see the runtime README for what the session does with its
   * transcript. `fork` is the guarded alternative for a completed checkpoint.
   */
  readonly checkpoint?: {
    readonly checkpoint_id: string;
    readonly checkpoint_ns?: string;
    readonly checkpoint_map?: Readonly<Record<string, PlainValue>> | null;
  };
  readonly checkpointId?: string;
  /** What the backend does when the thread already has a run going. With
   * `'enqueue'` during a run, the session queues the run instead: see `queue`. */
  readonly multitaskStrategy?: LangGraphSubmitOptions['multitaskStrategy'];
  readonly interruptBefore?: '*' | readonly string[];
  readonly interruptAfter?: '*' | readonly string[];
  /** Extra stream modes. The modes the session itself needs are always kept. */
  readonly streamMode?: readonly StreamMode[];
  readonly streamSubgraphs?: boolean;
  readonly durability?: LangGraphSubmitOptions['durability'];
  readonly checkpointDuring?: boolean;
  readonly onCompletion?: LangGraphSubmitOptions['onCompletion'];
  readonly onDisconnect?: LangGraphSubmitOptions['onDisconnect'];
  readonly webhook?: string;
  readonly afterSeconds?: number;
  readonly ifNotExists?: LangGraphSubmitOptions['ifNotExists'];
  readonly feedbackKeys?: readonly string[];
  /** Called with each run the command creates. A throwing callback is ignored. */
  readonly onRunCreated?: (run: {
    readonly run_id: string;
    readonly thread_id?: string;
  }) => void;
}

/** Per-command execution settings. Graph input and routing have separate owners. */
export interface LangGraphRunOptions {
  readonly signal?: AbortSignal;
  readonly run?: LangGraphRunSettings;
  readonly config?: Omit<DeepReadonly<Config>, 'configurable'> & {
    readonly configurable?: LangGraphRunConfigurable;
  };
  readonly context?: PlainValue;
  readonly metadata?: Readonly<Record<string, PlainValue>>;
}

/** The captured `run` settings: owned frozen data and the caller's callback. */
export type CapturedRunSettings = Readonly<
  Pick<
    LangGraphSubmitOptions,
    | 'command'
    | 'checkpoint'
    | 'checkpointId'
    | 'multitaskStrategy'
    | 'interruptBefore'
    | 'interruptAfter'
    | 'streamMode'
    | 'streamSubgraphs'
    | 'durability'
    | 'checkpointDuring'
    | 'onCompletion'
    | 'onDisconnect'
    | 'webhook'
    | 'afterSeconds'
    | 'ifNotExists'
    | 'feedbackKeys'
    | 'onRunCreated'
  >
>;

/** SDK-facing shape; every included object is already owned and frozen. */
export type CapturedRunOptions = Readonly<
  Pick<LangGraphSubmitOptions, 'config' | 'context' | 'metadata'>
> & { readonly run?: CapturedRunSettings };

const plainSettings = [
  'multitaskStrategy',
  'interruptBefore',
  'interruptAfter',
  'streamMode',
  'streamSubgraphs',
  'durability',
  'checkpointDuring',
  'onCompletion',
  'onDisconnect',
  'webhook',
  'afterSeconds',
  'ifNotExists',
  'feedbackKeys',
] as const;

function captureRunSettings(run: LangGraphRunSettings): CapturedRunSettings {
  requireRecord(run);
  const captured: Record<string, unknown> = {};
  const command = run.command;
  if (command !== undefined) {
    requireRecord(command);
    if (Object.hasOwn(command, 'resume'))
      throw new TypeError('Answer a pause with resume(), not run.command.');
    const { update, goto } = command;
    captured['command'] = ownValue({
      ...(update !== undefined ? { update } : {}),
      ...(goto !== undefined ? { goto } : {}),
    });
  }
  const checkpoint = run.checkpoint;
  if (checkpoint !== undefined) {
    requireRecord(checkpoint);
    if (
      typeof checkpoint.checkpoint_id !== 'string' ||
      !checkpoint.checkpoint_id
    )
      throw new TypeError('run.checkpoint requires a checkpoint_id.');
    captured['checkpoint'] = ownValue(checkpoint as PlainValue);
  }
  const checkpointId = run.checkpointId;
  if (checkpointId !== undefined) {
    if (typeof checkpointId !== 'string' || !checkpointId)
      throw new TypeError('run.checkpointId must be a non-empty string.');
    captured['checkpointId'] = checkpointId;
  }
  for (const key of plainSettings) {
    const value = run[key];
    if (value !== undefined) captured[key] = ownValue(value as PlainValue);
  }
  const onRunCreated = run.onRunCreated;
  if (onRunCreated !== undefined) {
    if (typeof onRunCreated !== 'function')
      throw new TypeError('run.onRunCreated must be a function.');
    captured['onRunCreated'] = onRunCreated;
  }
  return Object.freeze(captured) as CapturedRunSettings;
}

const routingKeys = new Set([
  'thread_id',
  'checkpoint_id',
  'checkpoint_ns',
  'checkpoint_map',
]);

function requireRecord(value: object) {
  if (
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new TypeError('Run options require plain data records.');
}

function captureConfig(config: NonNullable<LangGraphRunOptions['config']>) {
  requireRecord(config);
  const { tags, recursion_limit, configurable } = config;
  let application: Readonly<Record<string, PlainValue>> | undefined;
  if (configurable !== undefined) {
    requireRecord(configurable);
    const ancestors = new Set<object>([configurable]);
    application = Object.freeze(
      Object.fromEntries(
        Object.keys(configurable)
          .filter((key) => !routingKeys.has(key))
          .map((key) => [key, ownValue(configurable[key], ancestors)])
      )
    );
  }
  return ownValue({
    ...(tags !== undefined ? { tags } : {}),
    ...(recursion_limit !== undefined ? { recursion_limit } : {}),
    ...(application !== undefined ? { configurable: application } : {}),
  });
}

/** Read only supported settings. Signal capture and command admission belong to
 * the session. Reserved routing and untyped extra option getters stay unread. */
export function captureRunOptions(
  options?: LangGraphRunOptions
): CapturedRunOptions | undefined {
  const config = options?.config;
  const context = options?.context;
  const metadata = options?.metadata;
  const run = options?.run;
  if (
    config === undefined &&
    context === undefined &&
    metadata === undefined &&
    run === undefined
  )
    return undefined;
  if (metadata !== undefined) requireRecord(metadata);
  return Object.freeze({
    ...(config !== undefined ? { config: captureConfig(config) } : {}),
    ...(context !== undefined ? { context: ownValue(context) } : {}),
    ...(metadata !== undefined ? { metadata: ownValue(metadata) } : {}),
    ...(run !== undefined ? { run: captureRunSettings(run) } : {}),
  }) as CapturedRunOptions;
}
