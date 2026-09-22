import type {
  AgentSnapshot,
  DeepReadonly,
  PlainValue,
  ToolContract,
} from '@threadplane/core';
import type { Interrupt } from '@langchain/langgraph-sdk';

/** Backend wire metadata and a plain payload. DeepReadonly maps the SDK's
 * unknown payload to PlainValue without recursively re-mapping PlainValue. */
export type LangGraphInterrupt = DeepReadonly<Interrupt>;

/** Observed backend application data, not a validated application schema. */
export type LangGraphValues = Readonly<Record<string, PlainValue>>;

/** Backend-private extension; the core snapshot remains backend-independent. */
export type LangGraphSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = AgentSnapshot<TTools> & {
  readonly values: LangGraphValues | undefined;
  readonly interrupts: readonly LangGraphInterrupt[];
};
