import type { Config } from '@langchain/langgraph-sdk';
import type { DeepReadonly, PlainValue } from '@threadplane/core';
import { ownValue } from './ownership';
import type { LangGraphSubmitOptions } from './transport.types';

type Configurable = Readonly<Record<string, PlainValue>> & {
  readonly thread_id?: never;
  readonly checkpoint_id?: never;
  readonly checkpoint_ns?: never;
  readonly checkpoint_map?: never;
};

/** Per-command execution settings. Graph input and routing have separate owners. */
export interface LangGraphRunOptions {
  readonly signal?: AbortSignal;
  readonly config?: Omit<DeepReadonly<Config>, 'configurable'> & {
    readonly configurable?: Configurable;
  };
  readonly context?: PlainValue;
  readonly metadata?: Readonly<Record<string, PlainValue>>;
}

/** SDK-facing shape; every included object is already owned and frozen. */
export type CapturedRunOptions = Readonly<
  Pick<LangGraphSubmitOptions, 'config' | 'context' | 'metadata'>
>;

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
  if (config === undefined && context === undefined && metadata === undefined)
    return undefined;
  if (metadata !== undefined) requireRecord(metadata);
  return Object.freeze({
    ...(config !== undefined ? { config: captureConfig(config) } : {}),
    ...(context !== undefined ? { context: ownValue(context) } : {}),
    ...(metadata !== undefined ? { metadata: ownValue(metadata) } : {}),
  }) as CapturedRunOptions;
}
