import type {
  AgentSnapshot,
  AgentError,
  DeepReadonly,
  PlainValue,
  Message,
  ToolContract,
} from '@threadplane/core';
import type { Interrupt } from '@langchain/langgraph-sdk';

/** Backend wire metadata and a plain payload. DeepReadonly maps the SDK's
 * unknown payload to PlainValue without recursively re-mapping PlainValue. */
export type LangGraphInterrupt = DeepReadonly<Interrupt>;

/** Observed backend application data, not a validated application schema. */
export type LangGraphValues = Readonly<Record<string, PlainValue>>;

/** Full-path child observations, with no execution or command authority. */
export interface LangGraphSubgraph {
  readonly namespace: readonly string[];
  readonly messages: readonly Message[];
  readonly values: LangGraphValues | undefined;
  readonly interrupts: readonly LangGraphInterrupt[];
  readonly error?: AgentError;
}

/** Backend-private extension; the core snapshot remains backend-independent. */
export type LangGraphSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = AgentSnapshot<TTools> & {
  readonly values: LangGraphValues | undefined;
  readonly reconnect?: { readonly runId: string };
  readonly interrupts: readonly LangGraphInterrupt[];
  readonly subgraphs: readonly LangGraphSubgraph[];
};
